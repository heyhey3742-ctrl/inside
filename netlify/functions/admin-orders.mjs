import crypto from 'node:crypto';
import { adminPassword } from '../lib/config.mjs';
import { orders, readJSON } from '../lib/db.mjs';
import { tryIssueInvoice, cancelOrder, rescheduleOrder } from '../lib/booking.mjs';
import { json, handle } from '../lib/http.mjs';

function authorized(req) {
  const pw = adminPassword();
  const got = req.headers.get('x-admin-password') || '';
  if (!pw) return false;
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

export default handle(async (req) => {
  if (!adminPassword()) return json({ error: '尚未設定 ADMIN_PASSWORD 環境變數' }, 503);
  if (!authorized(req)) return json({ error: '密碼錯誤' }, 401);

  if (req.method === 'POST') {
    const body = await req.json();
    const { id } = body;
    // 後台退款、改期（不受客人自助的時間限制）
    if (body.action === 'refund') return json(await cancelOrder(String(id), { byAdmin: true, reason: body.reason || '後台取消' }));
    if (body.action === 'reschedule') return json(await rescheduleOrder(String(id), String(body.date || ''), { byAdmin: true }));
    // 補開發票
    const o = await readJSON(orders(), String(id));
    if (!o || o.status !== 'paid') return json({ error: '只有已付款的訂單可以補開發票' }, 400);
    if (o.invoiceResult?.invoiceNo) return json({ error: '這筆已經開過發票' }, 400);
    await tryIssueInvoice(o);
    return json(await readJSON(orders(), o.id));
  }

  const st = orders();
  const { blobs } = await st.list();
  const list = (await Promise.all(blobs.map((b) => readJSON(st, b.key)))).filter(Boolean);
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return json({ orders: list.slice(0, 500) });
});
export const config = { path: '/api/admin/orders' };
