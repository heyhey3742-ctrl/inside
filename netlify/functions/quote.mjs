// 試算價格：前台選時間時即時顯示金額與明細
import { quoteFor } from '../lib/booking.mjs';
import { json, handle } from '../lib/http.mjs';

export default handle(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  return json(quoteFor(await req.json()));
});
export const config = { path: '/api/quote' };
