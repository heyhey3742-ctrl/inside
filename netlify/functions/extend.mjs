// 加訂下一個時段：沿用同一組入場密碼，單獨計價
import { createExtension } from '../lib/booking.mjs';
import { checkoutForm, tradeNoFor } from '../lib/ecpay.mjs';
import { json, handle, originOf } from '../lib/http.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { id } = await req.json();
  const order = await createExtension(String(id || ''), originOf(req));
  const form = checkoutForm({ order, tradeNo: tradeNoFor(order.id, 1), origin: originOf(req) });
  return json({ orderId: order.id, amount: order.amount, form });
});
export const config = { path: '/api/extend' };
