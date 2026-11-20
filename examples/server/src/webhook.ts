import express, { Router } from 'express';
import type Stripe from 'stripe';
import { findByPaymentIntent, setStatus } from './orders.js';
import { stripe } from './stripe.js';

export const webhooks = Router();

// Use a table with the event ID as primary key in production.
const processedEvents = new Set<string>();

// Signature checks need the raw body, so this route must not go through express.json().
webhooks.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.get('stripe-signature') ?? '',
      process.env.STRIPE_WEBHOOK_SECRET ?? '',
    );
  } catch {
    res.status(400).send('Invalid signature');
    return;
  }

  if (processedEvents.has(event.id)) {
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    handle(event);
  } catch {
    // Not marked as processed, so the provider's retry gets another chance.
    res.status(500).send('Handler failed');
    return;
  }

  processedEvents.add(event.id);
  res.json({ received: true });
});

function handle(event: Stripe.Event): void {
  switch (event.type) {
    case 'payment_intent.succeeded':
      update(event.data.object, 'paid');
      break;
    case 'payment_intent.processing':
    case 'payment_intent.requires_action':
      update(event.data.object, 'pending');
      break;
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled':
      update(event.data.object, 'failed');
      break;
  }
}

function update(intent: Stripe.PaymentIntent, status: 'paid' | 'pending' | 'failed'): void {
  const order = findByPaymentIntent(intent.id);
  if (order) setStatus(order, status);
}
