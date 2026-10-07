// 客人付款完後，綠界把瀏覽器導回來這裡（OrderResultURL），再轉到成功或失敗頁
import { markPaid, markFailed } from '../lib/booking.mjs';
import { orders, readJSON } from '../lib/db.mjs';
import { verify } from '../lib/ecpay.mjs';
import { formParams, originOf } from '../lib/http.mjs';

const go = (req, path) => Response.redirect(originOf(req) + path, 303);

export default async (req) => {
  const p = await formParams(req);
  const id = p.CustomField1 || '';
  if (!verify(p)) return go(req, `/fail.html?id=${encodeURIComponent(id)}&reason=verify`);
  const order = await readJSON(orders(), id);
  if (!order) return go(req, '/fail.html?reason=notfound');
  try {
    if (p.RtnCode === '1' && Number(p.TradeAmt) === order.amount) {
      await markPaid(id, {
        tradeNo: p.MerchantTradeNo,
        ecpayTradeNo: p.TradeNo,
        paymentDate: p.PaymentDate,
        simulated: p.SimulatePaid === '1',
      });
      return go(req, `/success.html?id=${id}`);
    }
    await markFailed(id, p.RtnMsg || '付款失敗');
  } catch (e) {
    console.error(e);
  }
  return go(req, `/fail.html?id=${id}&reason=${encodeURIComponent(p.RtnMsg || 'failed')}`);
};
export const config = { path: '/api/ecpay-result' };
