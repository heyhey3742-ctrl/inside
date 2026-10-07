import { publicConfig } from '../lib/booking.mjs';
import { json, handle } from '../lib/http.mjs';

export default handle(async () => json(publicConfig()));
export const config = { path: '/api/config' };
