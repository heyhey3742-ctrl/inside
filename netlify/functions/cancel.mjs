// 客人取消預約並退款（開始前 N 小時以前），需要手機末三碼
import { cancelOrder, publicOrder } from '../lib/booking.mjs';
import { json, handle } from '../lib/http.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { id, phone } = await req.json();
  return json(publicOrder(await cancelOrder(String(id || ''), { phone: String(phone || '') })));
});
export const config = { path: '/api/cancel' };
