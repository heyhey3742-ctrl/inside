// 場地與營業設定：改價格、時段、地點都在這裡
export const SITE_NAME = 'Hour Jungle 中山';

// 場地介紹：首頁「場地介紹」區塊的內容，直接改文字即可
export const VENUE = {
  title: '無人自助共享空間',
  intro: '安靜、舒適的自助工作空間。線上預約付款後取得入場密碼，到現場輸入密碼即可入場，全程不用排隊等櫃台。',
  photos: ['/img/desk.svg', '/img/meeting.svg'],
  features: [
    { icon: 'key', text: '密碼自助入場' },
    { icon: 'wifi', text: '高速 Wi‑Fi' },
    { icon: 'plug', text: '每個座位都有插座' },
    { icon: 'cup', text: '飲用水免費取用' },
    { icon: 'clock', text: '07:00 – 隔日 02:00' },
    { icon: 'nofood', text: '不供餐，可自備輕食' },
  ],
  steps: [
    '選擇時段並線上付款',
    '付款完成立即取得入場密碼',
    '到現場在門口輸入密碼入場',
    '時間快到了？可以直接加訂下一個時段，密碼不變',
  ],
  rules: [
    '本空間為無人自助，不提供餐點',
    '請保持安靜，通話請到走廊',
    '離場前請帶走個人物品與垃圾',
    '入場密碼僅限預約時段內使用，請勿轉傳',
  ],
};

export const MAX_DAYS_AHEAD = 60; // 最多可預約幾天後
export const HOLD_MINUTES = 20;   // 付款未完成時，時段先保留幾分鐘

// 三個時段：end 超過 24 代表跨到隔天（26 = 隔日 02:00）
export const PERIODS = [
  { id: 'morning', name: '早上', start: 7, end: 12, icon: 'bird' },
  { id: 'afternoon', name: '下午', start: 12, end: 18, icon: 'sun' },
  { id: 'evening', name: '晚上', start: 18, end: 26, icon: 'moon' },
];

export const LOCATIONS = [
  {
    id: 'desk',
    name: '共享座位',
    desc: '開放式辦公座位，含 Wi‑Fi、插座、茶水，適合遠端工作、讀書。',
    address: '台北市中山區',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Hour+Jungle+中山',
    image: '/img/desk.svg',
    // perPerson：每人計價；capacity 是每個時段最多幾個座位
    pricing: 'perPerson',
    capacity: 20,
    maxPeople: 10,
    prices: {
      single: { morning: 130, afternoon: 180, evening: 160 },
      combos: {
        'morning+afternoon': 250,
        'afternoon+evening': 250,
        'morning+afternoon+evening': 300,
      },
    },
  },
  {
    id: 'meeting',
    name: '會議室',
    desc: '6–8 人會議室，含大螢幕、白板、Wi‑Fi，適合會議、面試、小型講座。',
    address: '台北市中山區',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Hour+Jungle+中山',
    image: '/img/meeting.svg',
    // perRoom：整間包場，價格不看人數，同時段只能一組（價格為示意，請換成實際價格）
    pricing: 'perRoom',
    capacity: 1,
    maxPeople: 8,
    prices: {
      single: { morning: 1000, afternoon: 1200, evening: 1000 },
      combos: {
        'morning+afternoon': 2000,
        'afternoon+evening': 2000,
        'morning+afternoon+evening': 2800,
      },
    },
  },
];

export function getLocation(id) {
  return LOCATIONS.find((l) => l.id === id);
}

// 這筆預約佔掉多少容量
export function unitsFor(loc, people) {
  return loc.pricing === 'perRoom' ? 1 : people;
}

// 把選到的時段整理成固定順序，並確認是連續的（早＋晚不行）
export function normalizePeriods(ids) {
  const idx = [...new Set(ids)].map((id) => PERIODS.findIndex((p) => p.id === id)).sort((a, b) => a - b);
  if (!idx.length || idx.includes(-1)) return null;
  for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) return null;
  return idx.map((i) => PERIODS[i].id);
}

// 單價（每人或每間）
export function unitPrice(loc, periods) {
  if (periods.length === 1) return loc.prices.single[periods[0]];
  return loc.prices.combos[periods.join('+')];
}

export function priceFor(loc, periods, people) {
  const p = unitPrice(loc, periods);
  if (p == null) return null;
  return loc.pricing === 'perRoom' ? p : p * people;
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
