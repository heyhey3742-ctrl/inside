// 在 LINE 裡查詢「我的預約」：用 LINE 身分列出近期預約
import { ordersForLineUser, publicOrder } from '../lib/booking.mjs';
import { verifyIdToken } from '../lib/line.mjs';
import { json, handle } from '../lib/http.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { idToken } = await req.json();
  const me = await verifyIdToken(idToken);
  if (!me) return json({ error: '請在 LINE 裡開啟此頁面' }, 401);
  const list = await ordersForLineUser(me.userId);
  return json({ orders: list.map(publicOrder) });
});
export const config = { path: '/api/my' };
