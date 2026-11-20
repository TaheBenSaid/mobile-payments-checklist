import express from 'express';
import { payments } from './create-payment.js';
import { storePurchases } from './store-purchases.js';
import { webhooks } from './webhook.js';

const app = express();

app.use(webhooks);
app.use(express.json());
app.use(payments);
app.use(storePurchases);

app.listen(Number(process.env.PORT ?? 3000));
