// 綠界全方位金流（AIO）：產生付款表單、驗證回傳簽章
import crypto from 'node:crypto';
import { ecpayConfig } from './config.mjs';
import { ecpayDate } from './time.mjs';

// 模仿 .NET HttpUtility.UrlEncode 的編碼規則（綠界文件指定）
function dotnetUrlEncode(s) {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/'/g, '%27')
    .replace(/~/g, '%7E')
    .toLowerCase()
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
}

export function checkMacValue(params, { hashKey, hashIV } = ecpayConfig()) {
  const query = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const raw = dotnetUrlEncode(`HashKey=${hashKey}&${query}&HashIV=${hashIV}`);
  return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
}

export function verify(params, cfg = ecpayConfig()) {
  if (!params.CheckMacValue) return false;
  const expected = checkMacValue(params, cfg);
  const got = String(params.CheckMacValue).toUpperCase();
  return expected.length === got.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

// 綠界訂單編號：最多 20 碼英數字，每次付款嘗試都要不同
export function tradeNoFor(orderId, attempt) {
  return `${orderId}${String(attempt).padStart(2, '0')}`.slice(0, 20);
}

// 移除綠界不接受的字元（# & 等會讓表單出錯）
const clean = (s) => String(s).replace(/[#&<>"'\\]/g, ' ').slice(0, 200);

export function checkoutForm({ order, tradeNo, origin }) {
  const cfg = ecpayConfig();
  const params = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: ecpayDate(),
    PaymentType: 'aio',
    TotalAmount: String(order.amount),
    TradeDesc: clean('場地預約'),
    ItemName: clean(order.itemName),
    ReturnURL: `${origin}/api/ecpay-notify`,
    OrderResultURL: `${origin}/api/ecpay-result`,
    ClientBackURL: `${origin}/fail.html?id=${order.id}&reason=cancel`,
    ChoosePayment: 'Credit',
    EncryptType: '1',
    CustomField1: order.id,
    NeedExtraPaidInfo: 'N',
  };
  params.CheckMacValue = checkMacValue(params, cfg);
  return { action: cfg.checkoutUrl, params };
}
