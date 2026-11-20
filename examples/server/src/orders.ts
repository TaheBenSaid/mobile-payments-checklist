export type OrderStatus = 'awaiting_payment' | 'pending' | 'paid' | 'failed';

export type Order = {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  paymentIntentId?: string;
};

const orders = new Map<string, Order>();

export function createOrder(order: Order): Order {
  orders.set(order.id, order);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function findByPaymentIntent(paymentIntentId: string): Order | undefined {
  for (const order of orders.values()) {
    if (order.paymentIntentId === paymentIntentId) return order;
  }
  return undefined;
}

// Events can arrive late or out of order. A paid order never goes back to pending or failed.
export function setStatus(order: Order, next: OrderStatus): void {
  if (order.status === 'paid') return;
  if (order.status === 'failed' && next === 'pending') return;
  order.status = next;
}
