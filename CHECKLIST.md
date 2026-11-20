# Mobile payments checklist

Paste this into a PR or a ticket. Every box should be checked before a payment change ships.

## 1. Price comes from the server

- [ ] The app sends product or plan IDs and quantities, never an amount or a currency the server charges as-is.
- [ ] The server looks up prices and computes the total, discounts included.
- [ ] Quantities are validated on the server (integer, at least 1, a sane max).

## 2. Idempotency

- [ ] The app creates one idempotency key (UUID) per checkout attempt.
- [ ] The same key is reused on every retry of that attempt, automatic or user-triggered.
- [ ] A new key is created when the cart changes or after a successful payment.
- [ ] The server stores key to result and returns the stored result for a repeated key.
- [ ] Keys are scoped per user, and a known key with a different body is rejected.
- [ ] Two concurrent requests with the same key can't both create a charge (unique constraint or lock).
- [ ] The server passes an idempotency key to the provider (for Stripe, `Idempotency-Key` / `idempotencyKey`).

## 3. The server confirms payment

- [ ] No endpoint lets the app mark an order as paid.
- [ ] Orders become paid only from a verified provider webhook or a server-side status check.
- [ ] The app shows the status the server returns, not the payment sheet's callback.
- [ ] If the app is killed after paying, the order still ends up paid.

## 4. Store purchases verified on the server

- [ ] Apple: the server verifies the StoreKit 2 signed transaction (JWS) or uses the App Store Server API. No calls to the deprecated `verifyReceipt`.
- [ ] Apple: App Store Server Notifications V2 are set up and handled.
- [ ] Apple: the app calls `transaction.finish()` only after the server granted the content.
- [ ] Google Play: the server verifies the `purchaseToken` with the Google Play Developer API.
- [ ] Google Play: tokens are stored and a token already used can't grant again (not `orderId`).
- [ ] Google Play: purchases are acknowledged (or consumed) after granting, well within three days.
- [ ] Google Play: Real-time developer notifications are set up and handled.

## 5. Pending payments

- [ ] The UI has an explicit pending state, separate from failed.
- [ ] The Pay button is disabled while a payment for the same order is pending.
- [ ] 3D Secure / SCA (`requires_action`) and slow methods (`processing`) are handled as pending.
- [ ] Apple Ask to Buy (`.pending`) is handled, and the app listens to `Transaction.updates` from launch.
- [ ] Google Play `PENDING` purchases aren't granted, and `queryPurchasesAsync()` runs in `onResume()`.
- [ ] A pending order finishes when the webhook or store notification arrives, with the app closed.

## Bonus: webhooks

- [ ] Signatures are verified on the raw body before anything else.
- [ ] Processed event IDs are stored and duplicates are skipped.
- [ ] Every handler is safe to run twice.
- [ ] Out-of-order events can't move an order backwards (paid stays paid).
- [ ] The handler returns 2xx quickly, and an error when processing fails so the provider retries.

## Hygiene

- [ ] No secret keys in the app or in the repo. Server keys come from the environment.
- [ ] Payment requests and webhooks don't log card data, tokens or secrets.
