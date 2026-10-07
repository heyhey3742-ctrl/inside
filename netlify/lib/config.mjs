// 場地與營業設定：改價格、時段、地點都在這裡
export const SITE_NAME = 'Hour Jungle 中山';

export const OPEN_HOUR = 9;   // 09:00 開放
export const CLOSE_HOUR = 21; // 21:00 結束（最後一格 20:00–21:00）
export const MAX_DAYS_AHEAD = 60; // 最多可預約幾天後
export const HOLD_MINUTES = 20;   // 付款未完成時，時段先保留幾分鐘

export const LOCATIONS = [
  {
    id: 'meeting',
    name: '會議室',
    desc: '6–8 人會議室，含大螢幕、白板、Wi‑Fi，適合會議、面試、小型講座。',
    address: '台北市中山區',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Hour+Jungle+中山',
    image: '/img/meeting.svg',
    // perRoom：整間包場，一次只能一組；價格以「每小時」計
    pricing: 'perRoom',
    price: 500,
    capacity: 1,
    maxPeople: 8,
  },
  {
    id: 'desk',
    name: '共享座位',
    desc: '開放式辦公座位，含 Wi‑Fi、插座、茶水，適合遠端工作、讀書。',
    address: '台北市中山區',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Hour+Jungle+中山',
    image: '/img/desk.svg',
    // perPerson：按人頭計價；capacity 是同時段最多座位數
    pricing: 'perPerson',
    price: 100,
    capacity: 20,
    maxPeople: 10,
  },
];

export function getLocation(id) {
  return LOCATIONS.find((l) => l.id === id);
}

// 這筆預約佔掉多少容量
export function unitsFor(loc, people) {
  return loc.pricing === 'perRoom' ? 1 : people;
}

export function priceFor(loc, hours, people) {
  return loc.pricing === 'perRoom' ? loc.price * hours : loc.price * hours * people;
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
