import { createOrder } from '../lib/booking.mjs';
import { checkoutForm, tradeNoFor } from '../lib/ecpay.mjs';
import { verifyIdToken } from '../lib/line.mjs';
import { json, handle, originOf } from '../lib/http.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = await req.json();
  // 在 LINE 裡預約時，用 LINE 帳號當作客人 ID
  const line = await verifyIdToken(body.lineIdToken);
  const order = await createOrder(body, { line: line || undefined, origin: originOf(req) });
  const form = checkoutForm({ order, tradeNo: tradeNoFor(order.id, 1), origin: originOf(req) });
  return json({ orderId: order.id, amount: order.amount, form });
});
export const config = { path: '/api/create-order' };
