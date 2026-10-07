// 排程：每 10 分鐘檢查一次，時段結束前 30 分鐘用 LINE 提醒加訂
import { sendReminders } from '../lib/booking.mjs';

export default async () => {
  const sent = await sendReminders();
  if (sent) console.log(`已送出 ${sent} 則加訂提醒`);
  return new Response('ok');
};
export const config = { schedule: '*/10 * * * *' };
