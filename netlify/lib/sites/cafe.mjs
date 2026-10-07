// 網站 A：無人咖啡廳（早／中／晚時段制＋入場密碼）
export default {
  id: 'cafe',
  brand: {
    name: 'Hour Jungle',
    tagline: '無人自助空間・線上預約',
    footer: '台灣維百股份有限公司中山分公司・Hour Jungle Co-Working',
    icon: 'leaf',
    theme: {
      brand: '#c96a43', brandDark: '#a9532f', brandSoft: '#f8e9e1',
      cream: '#f3eee6', bg: '#ede6dc', heroFrom: '#6e6157', heroTo: '#3d342e',
    },
  },
  features: { accessCode: true, extend: true },
  venue: {
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
  },
  // 三個時段：end 超過 24 代表跨到隔天（26 = 隔日 02:00）
  periods: [
    { id: 'morning', name: '早上', start: 7, end: 12, icon: 'bird' },
    { id: 'afternoon', name: '下午', start: 12, end: 18, icon: 'sun' },
    { id: 'evening', name: '晚上', start: 18, end: 26, icon: 'moon' },
  ],
  branches: [],
  locations: [
    {
      id: 'desk',
      mode: 'periods',
      name: '共享座位',
      desc: '開放式辦公座位，含 Wi‑Fi、插座、茶水，適合遠端工作、讀書。',
      address: '臺南市中西區中山路193號',
      mapUrl: 'https://www.google.com/maps/search/?api=1&query=%E8%87%BA%E5%8D%97%E5%B8%82%E4%B8%AD%E8%A5%BF%E5%8D%80%E4%B8%AD%E5%B1%B1%E8%B7%AF193%E8%99%9F',
      image: '/img/desk.svg',
      pricing: 'perPerson', // 每人計價；capacity 是每個時段最多幾個座位
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
      mode: 'periods',
      name: '會議室',
      desc: '6–8 人會議室，含大螢幕、白板、Wi‑Fi，適合會議、面試、小型講座。',
      address: '臺南市中西區中山路193號',
      mapUrl: 'https://www.google.com/maps/search/?api=1&query=%E8%87%BA%E5%8D%97%E5%B8%82%E4%B8%AD%E8%A5%BF%E5%8D%80%E4%B8%AD%E5%B1%B1%E8%B7%AF193%E8%99%9F',
      image: '/img/meeting.svg',
      pricing: 'perRoom', // 整間包場（價格為示意，請換成實際價格）
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
  ],
};
