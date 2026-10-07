// 三種預約方式的「時段」與「計價」規則
//   periods：每個整點都能選入場／出場，依「跨到哪幾個時段」套用早／中／晚方案價（無人咖啡廳）
//   hourly ：時租制，滿日租價封頂、營業時間外加價、假日起租套裝（HJ 會議室、座位）
//   consult：免費諮詢，選一個時段（公司設立、參觀）
import { PERIODS, HOLIDAYS } from './config.mjs';

export class UserError extends Error {}

export const hh = (h) => (h >= 24 ? '隔日' : '') + String(h % 24).padStart(2, '0') + ':00';
const money = (n) => `$${Number(n).toLocaleString('zh-TW')}`;

export function isWeekend(date) {
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  return d === 0 || d === 6 || HOLIDAYS.includes(date);
}

export function daySchedule(loc, date) {
  if (!loc.schedule) return null;
  return isWeekend(date) ? loc.schedule.weekend : loc.schedule.weekday;
}

// 這一天有哪些可選的格子
export function slotsFor(loc, date) {
  if (loc.mode === 'periods') {
    const out = [];
    for (const p of PERIODS) {
      for (let h = p.start; h < p.end; h++) out.push({ key: 'h' + h, start: h, end: h + 1, period: p.id });
    }
    return out;
  }
  const s = daySchedule(loc, date);
  if (!s) return [];
  const from = loc.mode === 'consult' ? s.open : s.bookFrom;
  const until = loc.mode === 'consult' ? s.close : s.bookUntil;
  const out = [];
  for (let h = from; h < until; h++) {
    out.push({ key: 'h' + h, start: h, end: h + 1, after: h < s.open || h >= s.close });
  }
  return out;
}

// 把選到的時段排好順序，並確認是連續的
export function normalizePeriods(ids) {
  const idx = [...new Set(ids)].map((id) => PERIODS.findIndex((p) => p.id === id)).sort((a, b) => a - b);
  if (!idx.length || idx.includes(-1)) return null;
  for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) return null;
  return idx.map((i) => PERIODS[i].id);
}

// 這段時間跨到哪幾個時段（例：10:00–14:00 → 早上、下午）
export function periodsTouched(start, end) {
  return PERIODS.filter((p) => p.start < end && p.end > start).map((p) => p.id);
}

// 從客人送來的資料，取出要預約的格子
export function selectionFrom(loc, date, body) {
  const slots = slotsFor(loc, date);
  if (!slots.length) throw new UserError('這一天不開放預約，請改選其他日期');
  const start = Number(body.start);
  const end = loc.mode === 'consult' ? start + 1 : Number(body.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) throw new UserError('請選擇時間');
  const keys = [];
  for (let h = start; h < end; h++) {
    if (!slots.some((x) => x.start === h)) throw new UserError('選擇的時間不在開放預約範圍內');
    keys.push('h' + h);
  }
  return keys;
}

export function rangeOf(loc, date, keys) {
  const slots = slotsFor(loc, date).filter((x) => keys.includes(x.key));
  return { start: Math.min(...slots.map((x) => x.start)), end: Math.max(...slots.map((x) => x.end)) };
}

export function periodNames(ids) {
  if (ids.length === PERIODS.length) return '全天';
  return ids.map((id) => PERIODS.find((p) => p.id === id).name).join('＋');
}

export function labelFor(loc, keys) {
  const hs0 = keys.map((k) => Number(k.slice(1)));
  if (loc.mode === 'periods') {
    const s = Math.min(...hs0), e = Math.max(...hs0) + 1;
    return `${hh(s)}–${hh(e)}（${periodNames(periodsTouched(s, e))}）`;
  }
  const hs = keys.map((k) => Number(k.slice(1)));
  const start = Math.min(...hs), end = Math.max(...hs) + 1;
  return loc.mode === 'consult' ? hh(start) : `${hh(start)}–${hh(end)}（${end - start} 小時）`;
}

// 計價：回傳總金額與明細（明細會顯示在確認頁）
//   paidPeriods：加訂時，已經付過的時段（不重複收費、也不套用多時段優惠）
export function quote(loc, date, keys, people, { paidPeriods } = {}) {
  const per = loc.pricing === 'perPerson';
  const times = (n) => (per ? n * people : n);
  const perNote = per && people > 1 ? ` × ${people} 人` : '';

  if (loc.mode === 'consult') return { amount: 0, lines: [{ label: '免費諮詢', amount: 0 }] };

  if (loc.mode === 'periods') {
    const hs = keys.map((k) => Number(k.slice(1)));
    let ids = periodsTouched(Math.min(...hs), Math.max(...hs) + 1);
    if (paidPeriods) {
      // 加訂：只收還沒付過的時段，各自用單時段價
      ids = ids.filter((id) => !paidPeriods.includes(id));
      if (!ids.length) throw new UserError('這段時間已經包含在你的預約裡');
      const unit = ids.reduce((sum, id) => sum + loc.prices.single[id], 0);
      return { amount: times(unit), periods: ids, lines: [{ label: `加訂${periodNames(ids)}（單獨計費）${perNote}`, amount: times(unit) }] };
    }
    const unit = ids.length === 1 ? loc.prices.single[ids[0]] : loc.prices.combos[ids.join('+')];
    if (unit == null) throw new UserError('這個時段組合沒有提供，請改選其他時段');
    const label = ids.length === 1 ? `${periodNames(ids)}時段` : `${periodNames(ids)}方案`;
    return { amount: times(unit), periods: ids, lines: [{ label: `${label} ${money(unit)}${perNote}`, amount: times(unit) }] };
  }

  // hourly
  const s = daySchedule(loc, date);
  if (!s) throw new UserError('這一天不開放預約');
  const hs = keys.map((k) => Number(k.slice(1)));
  const inside = hs.filter((h) => h >= s.open && h < s.close).length;
  const outside = hs.length - inside;
  if (outside && !s.afterRate && !s.afterBlock) throw new UserError('營業時間外的預約請聯絡客服');

  const lines = [];
  let unit = 0;
  if (inside) {
    let cost, label;
    if (s.block) {
      if (hs.length < s.block.hours) throw new UserError(`假日 ${s.block.hours} 小時起租`);
      const extra = Math.max(0, inside - s.block.hours);
      cost = s.block.price + extra * s.block.extraRate;
      label = `假日 ${s.block.hours} 小時 ${money(s.block.price)}` + (extra ? ` ＋ 加時 ${extra} 小時 × ${money(s.block.extraRate)}` : '');
    } else {
      cost = inside * s.rate;
      label = `時租 ${money(s.rate)} × ${inside} 小時`;
      if (s.dayRate && cost > s.dayRate) { cost = s.dayRate; label = `日租 ${money(s.dayRate)}（滿 ${Math.ceil(s.dayRate / s.rate)} 小時以日租計）`; }
      for (const p of s.packages || []) {
        if (!outside && inside <= p.hours && p.price < cost) { cost = p.price; label = `${p.name} ${p.hours} 小時 ${money(p.price)}`; }
      }
    }
    unit += cost;
    lines.push({ label: label + perNote, amount: times(cost) });
  }
  if (outside && s.afterBlock) {
    // 營業時間外套裝（例：3 小時 $5,500），超過再按小時加
    const b = s.afterBlock;
    const extra = Math.max(0, outside - b.hours);
    const cost = b.price + extra * b.extraRate;
    unit += cost;
    lines.push({ label: `營業時間外 ${b.hours} 小時 ${money(b.price)}` + (extra ? ` ＋ 加時 ${extra} 小時 × ${money(b.extraRate)}` : '') + perNote, amount: times(cost) });
  } else if (outside) {
    const cost = outside * s.afterRate;
    unit += cost;
    lines.push({ label: `營業時間外 ${money(s.afterRate)} × ${outside} 小時${perNote}`, amount: times(cost) });
  }
  return { amount: times(unit), lines };
}

// 給前台顯示的價目表
export function priceTable(loc) {
  if (loc.mode === 'periods' || loc.mode === 'consult' || !loc.schedule) return null;
  const w = loc.schedule.weekday, e = loc.schedule.weekend;
  const rows = [];
  if (w) {
    rows.push(['時租', money(w.rate)]);
    if (w.dayRate) rows.push(['日租', money(w.dayRate)]);
    if (w.afterRate) rows.push(['平日營業時間外', `${money(w.afterRate)}/H`]);
    if (w.afterBlock) rows.push([`營業時間外（${w.afterBlock.hours} 小時）`, money(w.afterBlock.price)]);
    rows.push(['平日營業時間', `${hh(w.open)}–${hh(w.close)}`]);
    for (const p of w.packages || []) rows.push([`${p.name} ${p.hours}H`, money(p.price)]);
  }
  if (e?.block) rows.push([`假日 ${e.block.hours} 小時（${hh(e.open)}–${hh(e.close)}）`, money(e.block.price)]);
  if (e?.block?.extraRate) rows.push(['假日超時', `${money(e.block.extraRate)}/H`]);
  if (!e) rows.push(['假日', '不開放']);
  if (e?.afterRate) rows.push(['假日營業時間外', `${money(e.afterRate)}/H`]);
  return rows;
}
