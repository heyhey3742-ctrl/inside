import { availability } from '../lib/booking.mjs';
import { json, handle } from '../lib/http.mjs';

export default handle(async (req) => {
  const u = new URL(req.url);
  return json(await availability(u.searchParams.get('location'), u.searchParams.get('date')));
});
export const config = { path: '/api/availability' };
