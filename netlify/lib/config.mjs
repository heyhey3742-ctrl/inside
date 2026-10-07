// 網站設定：同一套程式，用環境變數 SITE 決定是哪個網站
//   SITE=cafe → 無人咖啡廳（sites/cafe.mjs）
//   SITE=hj   → Hour Jungle 各館（sites/hj.mjs）
// 改價格、時段、地點、介紹，請到 sites/ 資料夾裡對應的檔案
import cafe from './sites/cafe.mjs';
import hj from './sites/hj.mjs';

const SITES = { cafe, hj };
export const SITE = SITES[process.env.SITE] || cafe;

export const BRAND = SITE.brand;
export const FEATURES = SITE.features;
export const VENUE = SITE.venue;
export const PERIODS = SITE.periods;
export const BRANCHES = SITE.branches;
export const LOCATIONS = SITE.locations;
export const HOLIDAYS = SITE.holidays || [];
export const POLICY = SITE.policy || { changeHours: 24, refundHours: 24, maxChanges: 1 };

export const MAX_DAYS_AHEAD = 60; // 最多可預約幾天後
export const HOLD_MINUTES = 20;   // 付款未完成時，時段先保留幾分鐘

export function getLocation(id) {
  return LOCATIONS.find((l) => l.id === id);
}

export function getBranch(id) {
  return BRANCHES.find((b) => b.id === id);
}

// 這筆預約佔掉多少容量
export function unitsFor(loc, people) {
  return loc.pricing === 'perPerson' ? people : 1;
}

const env = (k, d) => process.env[k] || d;

// 綠界設定：沒填環境變數時，使用綠界官方公開的「測試帳號」
export function ecpayConfig() {
  const prod = env('ECPAY_ENV', 'stage') === 'prod';
  return {
    prod,
    merchantId: env('ECPAY_MERCHANT_ID', '2000132'),
    hashKey: env('ECPAY_HASH_KEY', '5294y06JbISpM5x9'),
    hashIV: env('ECPAY_HASH_IV', 'v77hoKGq4kWxNNIS'),
    // 退刷／取消授權用的 API
    actionUrl: env('ECPAY_ACTION_URL', prod
      ? 'https://payment.ecpay.com.tw/CreditDetail/DoAction'
      : 'https://payment-stage.ecpay.com.tw/CreditDetail/DoAction'),
    checkoutUrl: env('ECPAY_CHECKOUT_URL', prod
      ? 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
      : 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'),
  };
}

export function invoiceConfig() {
  const prod = env('ECPAY_ENV', 'stage') === 'prod';
  return {
    enabled: env('INVOICE_ENABLED', 'true') !== 'false',
    merchantId: env('INVOICE_MERCHANT_ID', '2000132'),
    hashKey: env('INVOICE_HASH_KEY', 'ejCk326UnaZWKisg'),
    hashIV: env('INVOICE_HASH_IV', 'q9jcZX8Ib9LM8wYk'),
    baseUrl: env('INVOICE_BASE_URL', prod ? 'https://einvoice.ecpay.com.tw' : 'https://einvoice-stage.ecpay.com.tw'),
  };
}

export function adminPassword() {
  return env('ADMIN_PASSWORD', '');
}

// LINE 設定：三個值都填了才會啟用 LINE 功能
export function lineConfig() {
  const liffId = env('LIFF_ID', '');
  const loginChannelId = env('LINE_LOGIN_CHANNEL_ID', '') || liffId.split('-')[0];
  const accessToken = env('LINE_CHANNEL_ACCESS_TOKEN', '');
  return {
    liffId,
    loginChannelId,
    accessToken,
    apiBase: env('LINE_API_BASE', 'https://api.line.me'),
    // 官方帳號 ID（例如 @hourjungle），用來顯示「聯絡客服」按鈕
    oaId: env('LINE_OA_ID', ''),
    loginEnabled: !!liffId,
    pushEnabled: !!accessToken,
  };
}
