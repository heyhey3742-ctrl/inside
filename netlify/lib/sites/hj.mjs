// 網站 B：Hour Jungle 各館（會議室時租／日租、共同工作空間、諮詢預約）
//
// 價格依官網價目表；★ 標記的是尚未確認、先用預設值的地方，請核對後修改

const map = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

// 各館營業時間：open／close 是營業時間，lateUntil 是營業時間外最晚可預約到幾點
// weekend 為 null 代表假日不開放；★ 為尚未確認的預設值
const HOURS = {
  'tpe-xinyi': { weekday: { open: 9, close: 19 }, weekend: null, lateFrom: 8, lateUntil: 22 },
  'txg-dazhong': { weekday: { open: 9, close: 18 }, weekend: { open: 9, close: 18 }, lateFrom: 8, lateUntil: 22 }, // ★ 假日時段
  'tnn-dongning': { weekday: { open: 9, close: 18 }, weekend: { open: 9, close: 22 }, lateFrom: 8, lateUntil: 22 }, // 六日預約制 9–22
  'tnn-zhongshan': { weekday: { open: 9, close: 18 }, weekend: { open: 12, close: 18 }, lateFrom: 8, lateUntil: 22 },
  'tnn-chongxue': { weekday: { open: 9, close: 19 }, weekend: null, lateFrom: 9, lateUntil: 19 },  // 六日休息
};

// 會議室／教室
//   rate 平日時租、dayRate 日租（滿額封頂）
//   afterRate 營業時間外每小時、afterBlock 營業時間外套裝（例：3 小時 $5,500）
//   weekendBlock 假日 N 小時套裝，extraRate 為超過後每小時（＝該場地假日每小時價：套裝價 ÷ 時數）
//   weekendAfterRate 假日營業時間外每小時
//   keyword：分館日曆裡，標題含這個字的活動才算佔用這間
function room({ id, branch, name, keyword, people, image, rate, dayRate, afterRate, afterBlock, weekendBlock, weekendAfterRate }) {
  const h = HOURS[branch];
  const late = afterRate || afterBlock;
  const weekendLate = weekendAfterRate;
  return {
    id, branch, mode: 'hourly', name,
    desc: `可容納 ${people} 人，含投影設備、白板、Wi‑Fi。`,
    image,
    pricing: 'perRoom',
    capacity: 1,
    maxPeople: Number(String(people).split('-').pop()),
    calendarKeyword: keyword,
    schedule: {
      weekday: {
        ...h.weekday, rate, dayRate, afterRate, afterBlock,
        bookFrom: late ? h.lateFrom : h.weekday.open,
        bookUntil: late ? h.lateUntil : h.weekday.close,
      },
      weekend: weekendBlock && h.weekend ? {
        ...h.weekend, block: weekendBlock, afterRate: weekendLate || null,
        bookFrom: h.weekend.open,
        bookUntil: weekendLate ? h.lateUntil : h.weekend.close,
      } : null,
    },
  };
}

// 共同工作空間：每人時租，滿日租價封頂；可加甜點優惠套裝
function seats({ id, branch, rate, dayRate, monthRate, dessert, weekend, capacity = 20, image }) {
  const h = HOURS[branch];
  const day = (w) => ({ ...w, bookFrom: w.open, bookUntil: w.close, rate, dayRate,
    packages: dessert ? [{ name: '低消甜點優惠', hours: 3, price: dessert }] : [] });
  return {
    id, branch, mode: 'hourly', name: '共同工作空間',
    desc: `開放式座位，時租 $${rate}、日租 $${dayRate}${monthRate ? `，月租 ${monthRate}（請洽客服）` : ''}。`,
    image,
    pricing: 'perPerson',
    capacity, // 每館座位數
    maxPeople: 10,
    schedule: { weekday: day(h.weekday), weekend: weekend && h.weekend ? day(h.weekend) : null },
  };
}

// 獨立辦公室：以預約參觀為主（月租簽約），寫入分館日曆
function office({ id, branch, people, priceNote, image }) {
  const h = HOURS[branch];
  return {
    id, branch, mode: 'consult', name: '獨立辦公室｜預約參觀',
    desc: `${people} 人辦公室，${priceNote}。預約參觀，由專人帶看與報價。`,
    image,
    pricing: 'free',
    capacity: 1,
    maxPeople: 12,
    calendarKeyword: '諮詢', // 跟公司設立諮詢共用同一位專人的時間
    topics: ['參觀獨立辦公室', '月租方案諮詢'],
    schedule: { weekday: { open: Math.max(10, h.weekday.open), close: Math.min(17, h.weekday.close) }, weekend: null },
  };
}

// 公司設立／工商登記諮詢：客人選館，寫入該館日曆（免費）
function consult({ id, branch, image }) {
  const h = HOURS[branch];
  return {
    id, branch, mode: 'consult', name: '公司設立・工商登記諮詢',
    desc: '公司設立、工商登記、營業登記地址等問題，免費預約專人諮詢（到館或線上）。',
    image,
    pricing: 'free',
    capacity: 1,
    maxPeople: 5,
    calendarKeyword: '諮詢',
    topics: ['公司設立', '工商登記', '營業登記地址', '其他'],
    schedule: { weekday: { open: Math.max(10, h.weekday.open), close: Math.min(17, h.weekday.close) }, weekend: null },
  };
}

export default {
  id: 'hj',
  brand: {
    name: 'Hour Jungle',
    tagline: '共享辦公室・會議室線上預約',
    footer: '台灣維百股份有限公司・Hour Jungle Co-Working',
    icon: 'leaf',
    theme: {
      brand: '#f0784f', brandDark: '#d45f38', brandSoft: '#fdebe3',
      cream: '#f4f1ec', bg: '#f1eee8', heroFrom: '#3f5a46', heroTo: '#1f2d24',
    },
  },
  features: { accessCode: false, extend: false },
  // 改期／退款規則：開始前 N 小時以前可以自己線上操作
  policy: { changeHours: 24, refundHours: 24, maxChanges: 1 },
  venue: {
    title: '全台共享辦公空間',
    intro: '台北、台中、台南多個據點，提供共同工作空間、會議室、教室與獨立辦公室。線上預約、刷卡付款、電子發票一次完成。',
    photos: ['/img/hj/zhongshan-room.jpg', '/img/hj/dongning-class.jpg', '/img/hj/zhongshan-seat.jpg', '/img/hj/dongning-room.jpg'],
    features: [
      { icon: 'wifi', text: '高速 Wi‑Fi' },
      { icon: 'plug', text: '插座、投影設備' },
      { icon: 'cup', text: '茶水免費取用' },
      { icon: 'clock', text: '平日營業時間外可預約' },
    ],
    steps: ['選擇據點與空間', '選日期、時間，線上刷卡', '付款完成收到預約確認與電子發票', '當天直接到館使用'],
    rules: ['請準時入場與離場，超時將依時租計費', '假日會議室依各館規定起租時數', '取消或改期請聯絡客服'],
  },
  periods: [],
  // 國定假日（依假日價計算），格式 YYYY-MM-DD ★ 請每年更新
  holidays: ['2026-10-09', '2026-10-10', '2027-01-01'],
  branches: [
    // calendarEnv：這館的 Google 日曆 ID 放在哪個環境變數（同一個 Gmail 底下，每館一本日曆）
    { id: 'tpe-xinyi', name: '台北信義安和館', city: '台北', address: '台北市大安區信義路四段170號3樓', mapUrl: map('台北市大安區信義路四段170號'), calendarEnv: 'GCAL_XINYI' },
    { id: 'txg-dazhong', name: '台中大忠館', city: '台中', address: '台中市', mapUrl: map('Hour Jungle 台中大忠館'), calendarEnv: 'GCAL_DAZHONG' }, // ★ 地址
    { id: 'tnn-dongning', name: '台南東寧館', subtitle: 'Hour Eureka', city: '台南', address: '臺南市東區東寧路429號2樓', mapUrl: map('臺南市東區東寧路429號'), calendarEnv: 'GCAL_DONGNING' },
    { id: 'tnn-zhongshan', name: '台南中山館', subtitle: 'Hour Jungle Café 甜點咖啡廳', city: '台南', address: '臺南市中西區中山路193號（近台南火車站）', mapUrl: map('臺南市中西區中山路193號'), calendarEnv: 'GCAL_ZHONGSHAN' },
    { id: 'tnn-chongxue', name: '台南崇學館', city: '台南', address: '臺南市東區崇學路165號7樓', mapUrl: map('臺南市東區崇學路165號'), calendarEnv: 'GCAL_CHONGXUE' },
  ],
  locations: [
    // 台北信義安和館
    seats({ id: 'xinyi-seat', branch: 'tpe-xinyi', rate: 100, dayRate: 350, monthRate: '$3,675 起', capacity: 30, image: '/img/hj/xinyi-seat.jpg' }),
    // 不開放假日；非營業時間 3 小時 $5,500
    room({ id: 'xinyi-room', branch: 'tpe-xinyi', name: '會議室', keyword: '會議室', people: '6-8', image: '/img/hj/xinyi-room.jpg',
      rate: 450, dayRate: null, afterBlock: { hours: 3, price: 5500, extraRate: 1800 } }),
    office({ id: 'xinyi-office', branch: 'tpe-xinyi', people: '3–6', priceNote: '日租 $1,750、月租 $21,000 起', image: '/img/hj/xinyi-office.jpg' }),

    // 台中大忠館
    seats({ id: 'dazhong-seat', branch: 'txg-dazhong', rate: 80, dayRate: 350, monthRate: '$3,000', capacity: 20 /* ★ 座位數 */, image: '/img/hj/dazhong-seat.jpg' }),
    room({ id: 'dazhong-room', branch: 'txg-dazhong', name: '會議室', keyword: '會議室', people: '10-12', image: '/img/hj/dazhong-room.jpg',
      rate: 380, dayRate: 2000, afterRate: 550,
      weekendBlock: { hours: 3, price: 1600, extraRate: 533 }, weekendAfterRate: 800 }),
    office({ id: 'dazhong-office', branch: 'txg-dazhong', people: '4–12', priceNote: '月租 $13,500 起', image: '/img/hj/dazhong-office.jpg' }),

    // 台南東寧館
    seats({ id: 'dongning-seat', branch: 'tnn-dongning', rate: 80, dayRate: 350, monthRate: '$3,490', dessert: 150, capacity: 20, image: '/img/hj/dongning-seat.jpg' }),
    room({ id: 'dongning-room', branch: 'tnn-dongning', name: '會議室', keyword: '會議室', people: '10-15', image: '/img/hj/dongning-room.jpg',
      rate: 400, dayRate: 2400, afterRate: 500,
      weekendBlock: { hours: 3, price: 1500, extraRate: 500 } }),
    room({ id: 'dongning-class', branch: 'tnn-dongning', name: '大教室', keyword: '教室', people: '20-30', image: '/img/hj/dongning-class.jpg',
      rate: 600, dayRate: 3500, afterRate: 800,
      weekendBlock: { hours: 2, price: 1600, extraRate: 800 }, weekendAfterRate: 800 }),

    // 台南中山館
    seats({ id: 'zhongshan-seat', branch: 'tnn-zhongshan', rate: 80, dayRate: 350, monthRate: '$3,490', dessert: 130, weekend: true, capacity: 26, image: '/img/hj/zhongshan-seat.jpg' }),
    room({ id: 'zhongshan-room', branch: 'tnn-zhongshan', name: '會議室', keyword: '會議室', people: '10-15', image: '/img/hj/zhongshan-room.jpg',
      rate: 400, dayRate: 2400, afterRate: 600,
      weekendBlock: { hours: 3, price: 1500, extraRate: 500 } }),
    office({ id: 'zhongshan-office', branch: 'tnn-zhongshan', people: '3–5', priceNote: '時租 $300、日租 $1,200 起、月租 $14,500 起', image: '/img/hj/zhongshan-office.jpg' }),

    // 台南崇學館
    seats({ id: 'chongxue-seat', branch: 'tnn-chongxue', rate: 60, dayRate: 250, monthRate: '$3,990', capacity: 30, image: '/img/hj/chongxue-seat.jpg' }),
    // 六日休息（官網的假日 3 小時 $1,200 暫不開放線上預約）
    room({ id: 'chongxue-room', branch: 'tnn-chongxue', name: '會議室', keyword: '會議室', people: '4-6', image: '/img/hj/chongxue-room.jpg',
      rate: 300, dayRate: 1500 }),
    office({ id: 'chongxue-office', branch: 'tnn-chongxue', people: '2–6', priceNote: '日租 $680 起、月租 $9,900 起', image: '/img/hj/chongxue-office.jpg' }),

    // 公司設立／工商登記諮詢（每館各一個，寫入該館日曆）
    consult({ id: 'xinyi-consult', branch: 'tpe-xinyi', image: '/img/hj/xinyi-office.jpg' }),
    consult({ id: 'dazhong-consult', branch: 'txg-dazhong', image: '/img/hj/dazhong-office.jpg' }),
    consult({ id: 'dongning-consult', branch: 'tnn-dongning', image: '/img/hj/dongning-seat.jpg' }),
    consult({ id: 'zhongshan-consult', branch: 'tnn-zhongshan', image: '/img/hj/zhongshan-office.jpg' }),
    consult({ id: 'chongxue-consult', branch: 'tnn-chongxue', image: '/img/hj/chongxue-office.jpg' }),
  ],
};
