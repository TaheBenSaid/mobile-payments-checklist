# mobile-payments-checklist

_By [Tahe Ben Said](https://tahebensaid.dev), senior mobile engineer. More apps and tools at [tahebensaid.dev](https://tahebensaid.dev)._

Five payment mistakes that pass every test and still cost real money. Each one ends with a customer charged twice, a customer charged with nothing to show for it, or you giving the product away. None of them are about the payment provider. They're about where the app ends and the server begins.

It works the same on iOS, Android, Flutter and React Native, because the fix is almost always on the backend.

This repo has:

- the five mistakes below, each with a scenario, the fix and a short sample,
- [`CHECKLIST.md`](CHECKLIST.md), one page you can paste into a PR or a ticket,
- [`examples`](examples): a TypeScript server and client code in Swift, Kotlin and Dart,
- an agent skill, so your AI coding agent can review your own checkout against the list.

## 1. Trusting the price the app sends

**What goes wrong.** The app sends `{ "amount": 4900, "currency": "eur" }` and the server charges it. Someone puts a proxy between their phone and your API, changes 4900 to 100, and gets the order for 1 euro. An old app version with an outdated price list does the same thing by accident.

**The fix.** The app sends product or plan IDs and quantities. The server looks up the price, applies discounts it can check itself, and computes the total.

```ts
// The body only carries { items: [{ productId, quantity }] }.
const price = priceCart(req.body.items);
if (!price.ok) return res.status(400).json({ error: price.error });

await stripe.paymentIntents.create({ amount: price.amount, currency: price.currency });
```

Validate quantities too (integer, above zero, a sane max). A quantity of `-1` is a price change in disguise.

## 2. No idempotency key, so a retry charges twice

**What goes wrong.** The user taps Pay in an elevator. The request reaches your server, the card is charged, and the response never makes it back. The app times out and retries, or the user taps Pay again. A second charge.

**The fix.** The app creates one key per checkout attempt (a UUID), keeps it across every retry of that attempt, and sends it with the request. The server stores key to result and returns the stored result when the same key comes back. When the server calls the provider, it passes the key along. Stripe takes it as the `Idempotency-Key` header, and its Node SDK as `idempotencyKey`.

App side:

```swift
let key = attemptKey ?? UUID().uuidString   // reused on every retry of this checkout
attemptKey = key
req.setValue(key, forHTTPHeaderField: "Idempotency-Key")
```

Server side:

```ts
const scopedKey = `${userId}:${key}`;
const existing = claim(scopedKey, hashRequest(items));
if (existing.kind === 'replay') return res.status(existing.status).json(existing.body);

const intent = await stripe.paymentIntents.create(params, { idempotencyKey: scopedKey });
```

A few details that matter:

- Make a new key when the cart changes or after a successful payment. Same cart, same attempt, same key.
- Scope keys per user so one user can't replay another's.
- Reject a known key with a different body. Stripe does the same: it compares the parameters to the first request and returns an error if they differ.
- Keep keys long enough to cover retries. Stripe may prune them once they're at least 24 hours old.
- If two requests with the same key arrive at once, let one run and answer the other with a 409 so it retries.

## 3. Marking the order paid from the app's success callback

**What goes wrong.** The payment sheet reports success, and the app calls `POST /orders/42/mark-paid`. Now three things can break it:

- The app is killed or loses network between the charge and that call. The customer paid, and you have no paid order.
- The payment needed more steps and the callback said nothing useful.
- Someone calls `mark-paid` without paying at all.

**The fix.** Only the server decides that an order is paid. It learns it from the provider's webhook, or by asking the provider directly (a server-side status check). The app shows whatever the server says.

```ts
case 'payment_intent.succeeded':
  setStatus(order, 'paid');   // only the webhook or a server-side check gets here
```

```ts
// GET /orders/:id, polled by the app after the payment sheet closes
const intent = await stripe.paymentIntents.retrieve(order.paymentIntentId);
if (intent.status === 'succeeded') setStatus(order, 'paid');
```

There is no `mark-paid` endpoint the app can call.

## 4. Not verifying store purchases on the server

**What goes wrong.** The app turns on premium as soon as StoreKit or Play Billing says the purchase went through, and tells the server "this user is premium now". A tampered app or a replayed request makes anyone premium. On Google Play there's a second trap: if nobody acknowledges the purchase, Google refunds it.

**The fix, Apple.** Send the StoreKit 2 signed transaction (`jwsRepresentation`, a JWS) to your server and verify it there, or look the transaction up with the App Store Server API. Apple's App Store Server Library does the signature checks. Listen to App Store Server Notifications V2 for renewals, refunds and revocations. The old `verifyReceipt` endpoint is deprecated, and so are version 1 notifications.

```ts
const tx = await verifier.verifyAndDecodeTransaction(signedTransaction);
grant(`apple:${tx.transactionId}`, userId);
```

On the device, call `transaction.finish()` only after your server has granted the content. Unfinished transactions come back through `Transaction.unfinished`, so a crash in between doesn't lose the purchase.

**The fix, Google Play.** Send the `purchaseToken` to your server and verify it with the Google Play Developer API (`purchases.products.get` for one-time products, `purchases.subscriptionsv2.get` for subscriptions). Grant only when the state is purchased. Store every token: Google says it's globally unique and safe to use as a primary key, and that `orderId` isn't, because some purchases (promo codes, for example) don't have one. Then acknowledge from the server, or consume if it's a consumable. Purchases that aren't acknowledged within three days are refunded automatically and the entitlement is revoked. Set up Real-time developer notifications so the server hears about purchases even when the app isn't open.

```ts
const { data } = await play.purchases.products.get({ packageName, productId, token });
if (data.purchaseState !== 0) return;               // 0 purchased, 1 canceled, 2 pending
grant(`google:${token}`, userId);
if (data.acknowledgementState === 0) {
  await play.purchases.products.acknowledge({ packageName, productId, token });
}
```

## 5. Ignoring pending payments

**What goes wrong.** A payment that isn't finished yet looks like a failure to the app. The user sees "Payment failed", taps Pay again, and both payments go through later.

Pending is normal:

- Cards that need 3D Secure under SCA. A Stripe PaymentIntent sits in `requires_action` while the customer authenticates, and some payment methods stay in `processing` for a while.
- Apple's Ask to Buy. `product.purchase()` returns `.pending` and the parent approves later, maybe on another device. StoreKit then delivers the transaction through `Transaction.updates`.
- Google Play pending purchases, like paying cash at a physical store with a code. The purchase is `PENDING` until the user pays. Only grant it once it's `PURCHASED`. The three-day acknowledgement window starts at that point, not before.

**The fix.** Give the UI an explicit pending state. While an order is pending, the Pay button is disabled and the screen says the payment is being confirmed. The server finishes the order when the webhook or store notification arrives, and the app picks it up next time it asks.

```kotlin
_state.value = CheckoutState.Pending(orderId)   // canPay is false until the server answers
waitForServer(orderId)
```

On Android, also call `queryPurchasesAsync()` in `onResume()` to catch purchases that completed while the app was closed. On iOS, start listening to `Transaction.updates` at launch.

## Bonus: webhooks arrive more than once and out of order

Stripe says it doesn't guarantee event order and that an endpoint can receive the same event more than once. Google's notifications come through Cloud Pub/Sub, which delivers at least once. So:

- Verify the signature first. With Stripe, `stripe.webhooks.constructEvent(rawBody, signature, secret)` needs the raw body, before any JSON parser touches it.
- Store processed event IDs and skip ones you've seen.
- Make every handler safe to run twice. Setting a status is safe. Adding credit to a balance isn't unless you check first.
- Never move an order backwards. A late `processing` event must not turn a paid order back into pending.
- Return a 2xx quickly. If processing fails, return an error and let the provider retry.

```ts
if (processedEvents.has(event.id)) return res.json({ received: true });
handle(event);
processedEvents.add(event.id);
```

## The examples

```
examples/
  server/            TypeScript, Express
    src/create-payment.ts    server-side pricing, idempotency, GET /orders/:id
    src/webhook.ts           signature check, event ID dedupe, no status going backwards
    src/store-purchases.ts   App Store and Google Play verification
    src/idempotency.ts       key to result store
  client/
    Checkout.swift
    Checkout.kt
    checkout.dart
```

The stores in the server example are in memory so the code stays short. Use database tables with unique constraints in production. Keys and secrets come from `process.env`, see `.env.example`.

Each client does the same thing: one idempotency key per attempt, retries that reuse it, an explicit pending state, and polling the server for the final status. Plug your provider's payment sheet into `presentPaymentSheet`. React Native follows the same flow in TypeScript.

What was checked: the server type-checks with `tsc --noEmit` against stripe 23, express 5, `@apple/app-store-server-library` 3 and `@googleapis/androidpublisher` 42. `Checkout.swift` passes `swiftc -typecheck`, `Checkout.kt` compiles with Kotlin 2.2 and kotlinx-coroutines against the Android SDK (for `org.json`), and `checkout.dart` passes `dart analyze`. None of it has been run against a live provider.

```bash
cd examples/server
npm install
npm run typecheck
```

## Use it as a skill

Clone it into your agent's skills folder, for example:

```bash
git clone https://github.com/TaheBenSaid/mobile-payments-checklist.git ~/.claude/skills/mobile-payments-checklist
```

Then ask something like "review our checkout" or "can a retry charge someone twice?". The skill finds the checkout and purchase code in the app and on the server, goes through the five mistakes and the webhook check, and reports each finding with a file and line and a proposed fix. It never touches real keys or `.env` files and never runs a real charge.

## License

MIT
