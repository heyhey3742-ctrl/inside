import { publicOrder, groupInfo, nextPeriodFor, periodLabel } from '../lib/booking.mjs';
import { orders, readJSON } from '../lib/db.mjs';
import { json, handle } from '../lib/http.mjs';

export default handle(async (req) => {
  const q = new URL(req.url).searchParams;
  const id = q.get('id') || '';
  if (!/^HJ[0-9A-F]{14}$/.test(id)) return json({ error: '找不到這筆預約' }, 404);
  const order = await readJSON(orders(), id);
  // 用「預約編號＋手機末三碼」查詢時，要核對手機
  const tail = q.get('phone');
  if (!order || (tail && !order.customer.phone.endsWith(tail))) return json({ error: '找不到這筆預約' }, 404);
  const out = publicOrder(order);
  if (order.status === 'paid' && order.access) {
    const group = await groupInfo(order);
    out.access = {
      code: order.access.code,
      start: group.start,
      end: group.end,
      periodLabel: periodLabel(group.periods),
      bookings: group.count,
    };
    out.next = await nextPeriodFor(order, group);
  }
  return json(out);
});
export const config = { path: '/api/order' };
