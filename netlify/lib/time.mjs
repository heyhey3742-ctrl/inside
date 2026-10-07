// 一律以台北時間（UTC+8，無日光節約）計算
const OFFSET = 8 * 3600 * 1000;

export function taipeiNow(date = new Date()) {
  const t = new Date(date.getTime() + OFFSET);
  return {
    date: t.toISOString().slice(0, 10),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

// 綠界要的格式：yyyy/MM/dd HH:mm:ss
export function ecpayDate(date = new Date()) {
  const t = new Date(date.getTime() + OFFSET).toISOString();
  return `${t.slice(0, 10).replace(/-/g, '/')} ${t.slice(11, 19)}`;
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
}
