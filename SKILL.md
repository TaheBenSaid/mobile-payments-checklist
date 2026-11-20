---
name: mobile-payments-checklist
description: Review a mobile app's payment flow for double charges, lost payments and free purchases. Use when the user asks to review checkout, payments, in-app purchases, subscriptions, StoreKit, Play Billing, Stripe, webhooks, idempotency, 3D Secure, Ask to Buy, pending purchases, or asks "can a retry charge twice?". Works for iOS, Android, Flutter, React Native and the backend behind them.
---

# Mobile payments checklist

The checklist is `CHECKLIST.md` in this skill's folder. `README.md` explains each item, and `examples/` has reference code for the server (TypeScript) and the client (Swift, Kotlin, Dart).

## Rules

- Read only. Don't edit code until the user agrees to a fix.
- Never open, print or change `.env` files, keystores, service account JSON, `.p8` keys or anything holding real credentials. If a secret is committed in source, report the file and line, don't repeat the value, and tell the user to rotate it.
- Never run a real charge, call a live payment API, or trigger a purchase. No `stripe` CLI commands against live mode, no curl to provider APIs.
- Don't guess. If the server code isn't in the workspace, say which items you couldn't check and what to look for.

## Steps

1. Find the payment code. Search the app and the server for:

   - Client: `Idempotency-Key`, `checkout`, `payment`, `purchase`, `PaymentSheet`, `clientSecret`, `StoreKit`, `Product.purchase`, `Transaction.updates`, `jwsRepresentation`, `BillingClient`, `launchBillingFlow`, `purchaseToken`, `acknowledgePurchase`, `in_app_purchase`, `react-native-iap`.
   - Server: payment routes, `paymentIntents.create`, `idempotencyKey`, `webhooks.constructEvent`, `verifyReceipt`, `SignedDataVerifier`, `androidpublisher`, `purchases.products`, `subscriptionsv2`, webhook and notification routes.

   List the files you found and tell the user what flow you're reviewing (card payments, App Store, Google Play, or several).

2. Check each item of `CHECKLIST.md` against the code, in order:

   1. Price: does any request from the app carry an amount, price or total that the server charges or trusts?
   2. Idempotency: is there one key per attempt, reused on retry, sent to the server, stored server-side, and passed to the provider? Look at retry logic (interceptors, retry policies) and at what happens when the user taps Pay twice.
   3. Confirmation: can the app mark an order paid? Is paid set only from a verified webhook or a server-side status check?
   4. Store purchases: is every App Store and Google Play purchase verified on the server? Is `verifyReceipt` still used? Are Play purchases acknowledged or consumed, and from where? Is `finish()` called before the server grants?
   5. Pending: is there a pending state distinct from failed? Are `requires_action`, `processing`, Apple `.pending` and Play `PENDING` handled? Can the user pay again while pending?
   6. Webhooks: signature check on the raw body, event ID dedupe, handlers safe to repeat, no status going backwards.

3. Report. One line per finding, grouped by checklist item:

   ```
   2. Idempotency
     lib/features/checkout/data/checkout_api.dart:48  Retry interceptor resends POST /payments with no idempotency key. A timeout after the charge creates a second charge.
     server/routes/payments.ts:31  Stripe call has no idempotencyKey.
   ```

   Then list the items that pass, and the items you couldn't check and why. Keep it short.

4. Propose fixes, ordered by risk of losing money: double charges and free purchases first. For each, say what changes on the client and on the server. Point to the matching file in `examples/` and adapt it to the project's stack and architecture instead of pasting it as-is. Ask before editing.

5. After the user agrees and you've made changes, run the project's own checks (type-check, analyzer, tests) and report the result. Test payment flows only with the provider's test mode and test keys the user already set up.

## Facts to get right

- Stripe compares parameters on a repeated idempotency key and errors if they differ. Keys may be pruned once they're at least 24 hours old.
- Stripe doesn't guarantee event order and can deliver an event more than once. Signature checks need the raw request body.
- Apple's `verifyReceipt` endpoint and version 1 server notifications are deprecated. Use signed transactions, the App Store Server API and App Store Server Notifications V2.
- Google Play refunds and revokes purchases that aren't acknowledged within three days. For pending purchases the window starts when the state becomes `PURCHASED`. Use the `purchaseToken` as the unique key, not `orderId`.
