import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { androidpublisher, auth } from '@googleapis/androidpublisher';
import express, { Router } from 'express';
import { requireUser } from './auth.js';

export const storePurchases = Router();

// Use a table with a unique index on the store's transaction ID or purchase token.
const granted = new Map<string, string>();

// Apple's root certificates, downloaded from apple.com/certificateauthority.
const appleRoots = readdirSync(process.env.APPLE_ROOT_CA_DIR ?? 'certs').map((f) =>
  readFileSync(join(process.env.APPLE_ROOT_CA_DIR ?? 'certs', f)),
);

const appleVerifier = new SignedDataVerifier(
  appleRoots,
  true,
  process.env.APPLE_ENVIRONMENT === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX,
  process.env.APPLE_BUNDLE_ID ?? '',
  process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined,
);

const play = androidpublisher({
  version: 'v3',
  auth: new auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] }),
});

// The app sends Transaction.jwsRepresentation from StoreKit 2.
storePurchases.post('/purchases/apple', requireUser, express.json(), async (req, res) => {
  const userId = res.locals.userId as string;
  try {
    const tx = await appleVerifier.verifyAndDecodeTransaction(String(req.body?.signedTransaction ?? ''));
    if (!tx.transactionId || !tx.productId || tx.revocationDate) {
      res.status(400).json({ error: 'transaction not valid' });
      return;
    }
    if (!grant(`apple:${tx.transactionId}`, userId)) {
      res.status(409).json({ error: 'transaction already used by another account' });
      return;
    }
    res.json({ status: 'paid', productId: tx.productId });
  } catch {
    res.status(400).json({ error: 'transaction could not be verified' });
  }
});

storePurchases.post('/purchases/google', requireUser, express.json(), async (req, res) => {
  const userId = res.locals.userId as string;
  const productId = String(req.body?.productId ?? '');
  const token = String(req.body?.purchaseToken ?? '');
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME ?? '';

  try {
    const { data } = await play.purchases.products.get({ packageName, productId, token });

    if (data.purchaseState === 2) {
      res.json({ status: 'pending' });
      return;
    }
    if (data.purchaseState !== 0) {
      res.status(400).json({ error: 'purchase not completed' });
      return;
    }
    if (!grant(`google:${token}`, userId)) {
      res.status(409).json({ error: 'purchase already used by another account' });
      return;
    }
    // Unacknowledged purchases are refunded by Google after three days.
    if (data.acknowledgementState === 0) {
      await play.purchases.products.acknowledge({ packageName, productId, token });
    }
    res.json({ status: 'paid', productId });
  } catch {
    res.status(502).json({ error: 'could not verify with Google Play. Retry later.' });
  }
});

function grant(key: string, userId: string): boolean {
  const owner = granted.get(key);
  if (owner && owner !== userId) return false;
  granted.set(key, userId);
  return true;
}
