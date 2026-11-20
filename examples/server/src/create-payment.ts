import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { priceCart } from './catalog.js';
import { claim, complete, hashRequest, release } from './idempotency.js';
import { createOrder, getOrder, setStatus } from './orders.js';
import { stripe } from './stripe.js';
import { requireUser } from './auth.js';

export const payments = Router();

payments.post('/payments', requireUser, async (req, res) => {
  const userId = res.locals.userId as string;
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 255) {
    res.status(400).json({ error: 'Idempotency-Key header is required' });
    return;
  }

  // Only product IDs and quantities are read from the body. Any price the app sends is ignored.
  const items = req.body?.items;
  const scopedKey = `${userId}:${key}`;
  const requestHash = hashRequest(items);

  const existing = claim(scopedKey, requestHash);
  if (existing.kind === 'replay') {
    res.status(existing.status).json(existing.body);
    return;
  }
  if (existing.kind === 'in_progress') {
    res.status(409).json({ error: 'This checkout is already being processed. Retry shortly.' });
    return;
  }
  if (existing.kind === 'mismatch') {
    res.status(422).json({ error: 'Idempotency-Key was already used with a different cart' });
    return;
  }

  const price = priceCart(items);
  if (!price.ok) {
    complete(scopedKey, requestHash, 400, { error: price.error });
    res.status(400).json({ error: price.error });
    return;
  }

  try {
    const order = createOrder({
      id: randomUUID(),
      userId,
      amount: price.amount,
      currency: price.currency,
      status: 'awaiting_payment',
    });

    const intent = await stripe.paymentIntents.create(
      {
        amount: price.amount,
        currency: price.currency,
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: order.id },
      },
      { idempotencyKey: scopedKey },
    );
    order.paymentIntentId = intent.id;

    const body = { orderId: order.id, clientSecret: intent.client_secret, amount: order.amount, currency: order.currency };
    complete(scopedKey, requestHash, 201, body);
    res.status(201).json(body);
  } catch {
    release(scopedKey);
    res.status(502).json({ error: 'Payment provider unavailable. Retry with the same key.' });
  }
});

// The app polls this after the payment sheet closes. If the webhook hasn't
// arrived yet, ask the provider directly instead of trusting the app.
payments.get('/orders/:id', requireUser, async (req, res) => {
  const order = getOrder(String(req.params.id));
  if (!order || order.userId !== res.locals.userId) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  if (order.paymentIntentId && (order.status === 'awaiting_payment' || order.status === 'pending')) {
    try {
      const intent = await stripe.paymentIntents.retrieve(order.paymentIntentId);
      if (intent.status === 'succeeded') setStatus(order, 'paid');
      else if (intent.status === 'processing' || intent.status === 'requires_action') setStatus(order, 'pending');
      else if (intent.status === 'canceled') setStatus(order, 'failed');
    } catch {
      // Provider unreachable: return what we have, the app keeps showing pending.
    }
  }

  res.json({ orderId: order.id, status: order.status });
});
