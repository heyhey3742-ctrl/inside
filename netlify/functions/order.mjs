import { publicOrder } from '../lib/booking.mjs';
import { orders, readJSON } from '../lib/db.mjs';
import { json, handle } from '../lib/http.mjs';

export default handle(async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^HJ[0-9A-F]{14}$/.test(id)) return json({ error: '找不到這筆預約' }, 404);
  const o = publicOrder(await readJSON(orders(), id));
  return o ? json(o) : json({ error: '找不到這筆預約' }, 404);
});
export const config = { path: '/api/order' };
