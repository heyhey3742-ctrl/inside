// 綠界「伺服器對伺服器」付款結果通知（ReturnURL），以這個為準
import { markPaid, markFailed } from '../lib/booking.mjs';
import { orders, readJSON } from '../lib/db.mjs';
import { verify } from '../lib/ecpay.mjs';
import { formParams } from '../lib/http.mjs';

const text = (s, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain' } });

export default async (req) => {
  const p = await formParams(req);
  if (!verify(p)) return text('0|CheckMacValue error', 400);
  const id = p.CustomField1;
  const order = id && await readJSON(orders(), id);
  if (!order) return text('0|Order not found', 404);
  try {
    if (p.RtnCode === '1') {
      if (Number(p.TradeAmt) !== order.amount) {
        console.error('金額不符', id, p.TradeAmt, order.amount);
        return text('0|Amount mismatch', 400);
      }
      await markPaid(id, {
        tradeNo: p.MerchantTradeNo,
        ecpayTradeNo: p.TradeNo,
        paymentDate: p.PaymentDate,
        simulated: p.SimulatePaid === '1',
      });
    } else {
      await markFailed(id, p.RtnMsg || '付款失敗');
    }
  } catch (e) {
    console.error(e);
    return text('0|Error', 500); // 回非 1|OK，綠界會再通知
  }
  return text('1|OK');
};
export const config = { path: '/api/ecpay-notify' };
