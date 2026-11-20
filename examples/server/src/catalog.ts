export type Product = { id: string; name: string; unitAmount: number; currency: string };

// In a real app this comes from your database. The point is that it lives on the server.
const products = new Map<string, Product>([
  ['tshirt-basic', { id: 'tshirt-basic', name: 'Basic T-shirt', unitAmount: 1900, currency: 'eur' }],
  ['mug-large', { id: 'mug-large', name: 'Large mug', unitAmount: 1200, currency: 'eur' }],
]);

export type LineItem = { productId: string; quantity: number };

export type PriceResult =
  | { ok: true; amount: number; currency: string }
  | { ok: false; error: string };

export function priceCart(items: unknown): PriceResult {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return { ok: false, error: 'items must be a non-empty array' };
  }

  let amount = 0;
  let currency: string | undefined;

  for (const item of items as Partial<LineItem>[]) {
    const product = typeof item?.productId === 'string' ? products.get(item.productId) : undefined;
    if (!product) return { ok: false, error: 'unknown product' };

    const qty = item.quantity;
    if (!Number.isInteger(qty) || qty! < 1 || qty! > 99) {
      return { ok: false, error: 'quantity must be an integer from 1 to 99' };
    }

    if (currency && currency !== product.currency) return { ok: false, error: 'mixed currencies' };
    currency = product.currency;
    amount += product.unitAmount * qty!;
  }

  return { ok: true, amount, currency: currency! };
}
