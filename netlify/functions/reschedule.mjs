// 客人自己改期（同一個時間換到另一天），需要手機末三碼
import { rescheduleOrder, publicOrder } from '../lib/booking.mjs';
import { json, handle } from '../lib/http.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { id, phone, date } = await req.json();
  return json(publicOrder(await rescheduleOrder(String(id || ''), String(date || ''), { phone: String(phone || '') })));
});
export const config = { path: '/api/reschedule' };
