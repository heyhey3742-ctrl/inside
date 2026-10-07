// 預約核心邏輯：查空位、建立訂單、付款成功／失敗處理
import crypto from 'node:crypto';
import {
  BRAND, FEATURES, VENUE, PERIODS, BRANCHES, LOCATIONS, MAX_DAYS_AHEAD, HOLD_MINUTES,
  getLocation, getBranch, unitsFor, lineConfig, SITE,
} from './config.mjs';
import {
  UserError, hh, slotsFor, selectionFrom, rangeOf, labelFor, quote, priceTable, isWeekend,
} from './modes.mjs';
import { taipeiNow, daysBetween, isValidDate } from './time.mjs';
import { orders, days, users, readJSON, updateJSON } from './db.mjs';
import { issueInvoice } from './invoice.mjs';
import { push, accessMessage, confirmMessage, reminderMessage } from './line.mjs';
import { busyHours, insertEvent } from './gcal.mjs';

export { UserError };

const dayKey = (locId, date) => `${locId}/${date}`;

// 這筆預約目前是否還佔著時段（已付款，或付款中且未逾時）
function isActive(b, now = Date.now()) {
  return b.status === 'paid' || (b.status === 'pending' && b.holdUntil > now);
}

function usage(dayDoc, excludeId) {
  const used = {};
  for (const b of dayDoc?.bookings || []) {
    if (b.id === excludeId || !isActive(b)) continue;
    for (const k of b.slots) used[k] = (used[k] || 0) + b.units;
  }
  return used;
}

// 格子結束前都還能訂（現場掃 QR code 也能馬上預約）
function isPast(date, slot, now = taipeiNow()) {
  if (date < now.date) return true;
  return date === now.date && slot.end <= 24 && now.hour >= slot.end;
}

// Google 日曆上已被佔用的格子
async function calendarBlocked(loc, date) {
  const hours = await busyHours(loc, date);
  return new Set(slotsFor(loc, date).filter((s) => hours.some((h) => h >= s.start && h < s.end)).map((s) => s.key));
}

export async function availability(locId, date) {
  const loc = getLocation(locId);
  if (!loc) throw new UserError('找不到這個地點');
  if (!isValidDate(date)) throw new UserError('日期格式錯誤');
  const [dayDoc, blocked] = await Promise.all([readJSON(days(), dayKey(locId, date)), calendarBlocked(loc, date)]);
  const used = usage(dayDoc);
  const now = taipeiNow();
  const slots = slotsFor(loc, date).map((s) => {
    const past = isPast(date, s, now);
    const remaining = past || blocked.has(s.key) ? 0 : loc.capacity - (used[s.key] || 0);
    return { ...s, remaining, past };
  });
  return { location: locId, date, weekend: isWeekend(date), capacity: loc.capacity, slots };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateInput(body) {
  const loc = getLocation(body.location);
  if (!loc) throw new UserError('請選擇地點');
  const { date } = body;
  if (!isValidDate(date)) throw new UserError('請選擇日期');
  const now = taipeiNow();
  const ahead = daysBetween(now.date, date);
  if (ahead < 0) throw new UserError('不能預約過去的日期');
  if (ahead > MAX_DAYS_AHEAD) throw new UserError(`最多只能預約 ${MAX_DAYS_AHEAD} 天內`);

  const slots = selectionFrom(loc, date, body);
  for (const s of slotsFor(loc, date).filter((x) => slots.includes(x.key))) {
    if (isPast(date, s, now)) throw new UserError('這個時段已經結束了');
  }

  const people = loc.mode === 'consult' ? Math.max(1, Number(body.people) || 1) : Number(body.people);
  if (!Number.isInteger(people) || people < 1 || people > loc.maxPeople) {
    throw new UserError(`人數需介於 1–${loc.maxPeople} 人`);
  }

  const c = body.customer || {};
  const customer = {
    name: String(c.name || '').trim().slice(0, 30),
    phone: String(c.phone || '').replace(/[^\d+]/g, '').slice(0, 15),
    email: String(c.email || '').trim().slice(0, 80),
    company: String(c.company || '').trim().slice(0, 60),
    note: String(c.note || '').trim().slice(0, 300),
  };
  if (!customer.name) throw new UserError('請填寫姓名');
  if (customer.phone.length < 8) throw new UserError('請填寫正確的手機號碼');
  if (!EMAIL_RE.test(customer.email)) throw new UserError('請填寫正確的 Email');

  const topic = loc.topics ? String(body.topic || '') : '';
  if (loc.topics && !loc.topics.includes(topic)) throw new UserError('請選擇諮詢項目');

  const q = quote(loc, date, slots, people);

  const i = body.invoice || {};
  let invoice = { type: 'personal' };
  if (q.amount === 0) {
    invoice = null;
  } else if (i.type === 'company') {
    const taxId = String(i.taxId || '').trim();
    if (!/^\d{8}$/.test(taxId)) throw new UserError('統一編號需為 8 碼數字');
    invoice = {
      type: 'company', taxId,
      title: String(i.title || '').trim().slice(0, 60),
      address: String(i.address || '').trim().slice(0, 100),
    };
    if (!invoice.title) throw new UserError('請填寫公司抬頭');
  } else if (i.type === 'mobile') {
    const carrier = String(i.carrier || '').trim().toUpperCase();
    if (!/^\/[0-9A-Z.+-]{7}$/.test(carrier)) throw new UserError('手機條碼格式為 / 開頭共 8 碼');
    invoice = { type: 'mobile', carrier };
  } else if (i.type === 'donate') {
    const loveCode = String(i.loveCode || '').trim();
    if (!/^\d{3,7}$/.test(loveCode)) throw new UserError('捐贈碼為 3–7 碼數字');
    invoice = { type: 'donate', loveCode };
  }

  const { start, end } = rangeOf(loc, date, slots);
  return {
    loc, date, slots, people, customer, invoice, topic, start, end,
    amount: q.amount, lines: q.lines,
    units: unitsFor(loc, people),
  };
}

// 試算價格（前台選時間時即時顯示）
export function quoteFor(body) {
  const loc = getLocation(body.location);
  if (!loc) throw new UserError('請選擇地點');
  if (!isValidDate(body.date)) throw new UserError('請選擇日期');
  const slots = selectionFrom(loc, body.date, body);
  const people = Math.max(1, Number(body.people) || 1);
  return { ...quote(loc, body.date, slots, people), label: labelFor(loc, slots), ...rangeOf(loc, body.date, slots) };
}

function placeName(loc) {
  const b = getBranch(loc.branch);
  return b ? `${b.name} ${loc.name}` : loc.name;
}

export async function createOrder(body, { extendOf, line, origin } = {}) {
  const v = validateInput(body);
  const id = 'HJ' + taipeiNow().date.replace(/-/g, '').slice(2) +
    crypto.randomBytes(4).toString('hex').toUpperCase();
  const holdUntil = Date.now() + HOLD_MINUTES * 60 * 1000;
  const blocked = await calendarBlocked(v.loc, v.date);

  // 先佔位：每個格子都還有空位才寫入
  await updateJSON(days(), dayKey(v.loc.id, v.date), (doc) => {
    const used = usage(doc);
    for (const k of v.slots) {
      if (blocked.has(k) || (used[k] || 0) + v.units > v.loc.capacity) {
        throw new UserError('選擇的時段已經額滿，請改選其他時間');
      }
    }
    doc.bookings = doc.bookings.filter((b) => isActive(b));
    doc.bookings.push({ id, slots: v.slots, units: v.units, status: 'pending', holdUntil });
    return doc;
  }, { bookings: [] });

  const label = labelFor(v.loc, v.slots);
  const order = {
    id,
    site: SITE.id,
    location: v.loc.id,
    locationName: placeName(v.loc),
    mode: v.loc.mode,
    date: v.date,
    slots: v.slots,
    slotLabel: label,
    start: v.start,
    end: v.end,
    people: v.people,
    topic: v.topic || undefined,
    amount: v.amount,
    lines: v.lines,
    itemName: `${placeName(v.loc)} ${v.date} ${label}${v.loc.mode === 'consult' ? '' : ` ${v.people}人`}`,
    customer: v.customer,
    invoice: v.invoice,
    extendOf: extendOf || undefined,
    line: line || undefined,
    origin,
    status: 'pending',
    attempts: 1,
    holdUntil,
    createdAt: new Date().toISOString(),
  };
  await orders().setJSON(id, order);
  // 免費（諮詢）不用付款，直接成立
  if (order.amount === 0) return markPaid(id, { free: true });
  return order;
}

// 付款失敗後重新付款：重新保留時段，產生新的付款編號
export async function retryOrder(id) {
  const order = await readJSON(orders(), id);
  if (!order) throw new UserError('找不到這筆預約');
  if (order.status === 'paid') throw new UserError('這筆預約已經付款完成');
  const loc = getLocation(order.location);
  const holdUntil = Date.now() + HOLD_MINUTES * 60 * 1000;
  const blocked = await calendarBlocked(loc, order.date);
  await updateJSON(days(), dayKey(order.location, order.date), (doc) => {
    const used = usage(doc, id);
    const units = unitsFor(loc, order.people);
    for (const k of order.slots) {
      if (blocked.has(k) || (used[k] || 0) + units > loc.capacity) {
        throw new UserError('很抱歉，這個時段剛被訂走了，請重新預約');
      }
    }
    const b = doc.bookings.find((x) => x.id === id);
    if (b) Object.assign(b, { status: 'pending', holdUntil });
    else doc.bookings.push({ id, slots: order.slots, units, status: 'pending', holdUntil });
    return doc;
  }, { bookings: [] });
  return updateJSON(orders(), id, (o) => {
    o.status = 'pending';
    o.attempts = (o.attempts || 1) + 1;
    o.holdUntil = holdUntil;
    return o;
  });
}

async function setDayStatus(order, status) {
  await updateJSON(days(), dayKey(order.location, order.date), (doc) => {
    const b = doc.bookings.find((x) => x.id === order.id);
    const group = order.access?.groupId;
    if (b) {
      if (b.status === status && b.group === group) return undefined;
      b.status = status;
      if (group) b.group = group;
    } else if (status === 'paid') {
      const loc = getLocation(order.location);
      doc.bookings.push({ id: order.id, slots: order.slots, units: unitsFor(loc, order.people), status, group });
    } else {
      return undefined;
    }
    return doc;
  }, { bookings: [] });
}

// 綠界通知付款成功（可能重複通知，所以要能重複執行不出錯）
export async function markPaid(id, info) {
  let order = await updateJSON(orders(), id, (o) => {
    if (!o) throw new Error(`order ${id} not found`);
    if (o.status === 'paid') return undefined;
    o.status = 'paid';
    o.paidAt = new Date().toISOString();
    o.payment = info;
    return o;
  });
  if (FEATURES.accessCode) order = await assignAccess(order);
  await setDayStatus(order, 'paid');
  await addToCalendar(order);
  await notifyLine(order);
  if (order.amount > 0 && !order.invoiceResult) await tryIssueInvoice(order);
  return readJSON(orders(), id);
}

/* ---------- Google 日曆 ---------- */

async function addToCalendar(order) {
  const loc = getLocation(order.location);
  if (!loc?.calendarKeyword) return;
  let mine = false;
  await updateJSON(orders(), order.id, (o) => {
    if (o.calendar) return undefined;
    o.calendar = { status: 'adding' };
    mine = true;
    return o;
  });
  if (!mine) return;
  const c = order.customer;
  try {
    const eventId = await insertEvent(loc, {
      date: order.date, start: order.start, end: order.end,
      // 標題一定要含 calendarKeyword，系統才認得這筆是佔用哪個空間
      summary: `【線上預約・${loc.calendarKeyword}】${loc.name}${order.topic ? `・${order.topic}` : ''}｜${c.name}`,
      description: [
        `預約編號：${order.id}`,
        `姓名：${c.name}`, `電話：${c.phone}`, `Email：${c.email}`,
        c.company ? `公司：${c.company}` : '',
        loc.mode === 'consult' ? '' : `人數：${order.people} 人`,
        order.amount ? `金額：NT$ ${order.amount}（已線上付款）` : '',
        c.note ? `備註：${c.note}` : '',
      ].filter(Boolean).join('\n'),
    });
    await updateJSON(orders(), order.id, (o) => { o.calendar = eventId ? { eventId } : { skipped: true }; return o; });
  } catch (e) {
    console.error('寫入 Google 日曆失敗', order.id, e.message);
    await updateJSON(orders(), order.id, (o) => { o.calendar = { error: e.message }; return o; });
  }
}

/* ---------- LINE ---------- */

// 付款成功後推播到 LINE（只推一次）：咖啡廳推入場密碼，HJ 推預約確認
async function notifyLine(order) {
  const userId = order.line?.userId;
  if (!userId || !lineConfig().pushEnabled) return;
  await updateJSON(users(), userId, (u) => {
    if (u.orders.includes(order.id)) return undefined;
    u.orders = [order.id, ...u.orders].slice(0, 50);
    return u;
  }, { orders: [] });
  let mine = false;
  await updateJSON(orders(), order.id, (o) => {
    if (o.lineNotified) return undefined;
    o.lineNotified = new Date().toISOString();
    mine = true;
    return o;
  });
  if (!mine) return;
  if (order.access) {
    const group = await groupInfo(order);
    await push(userId, [accessMessage({ order, group, origin: order.origin })]);
  } else {
    await push(userId, [confirmMessage({ order, origin: order.origin })]);
  }
}

// 以 LINE 身分列出近期的預約
export async function ordersForLineUser(userId) {
  const u = await readJSON(users(), userId);
  const yesterday = new Date(Date.parse(taipeiNow().date) - 86400000).toISOString().slice(0, 10);
  const list = await Promise.all((u?.orders || []).map((id) => readJSON(orders(), id)));
  return list.filter((o) => o && o.status === 'paid' && o.date >= yesterday);
}

// 每 10 分鐘檢查：時段結束前 30 分鐘提醒加訂（只有開啟加訂功能的網站）
export async function sendReminders(now = Date.now()) {
  if (!FEATURES.extend || !lineConfig().pushEnabled) return 0;
  const today = taipeiNow(new Date(now)).date;
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  let sent = 0;
  for (const loc of LOCATIONS.filter((l) => l.mode === 'periods')) {
    for (const date of [yesterday, today]) {
      const doc = await readJSON(days(), dayKey(loc.id, date));
      const groups = new Map();
      for (const b of doc?.bookings || []) {
        if (b.status === 'paid' && b.group) groups.set(b.group, [...(groups.get(b.group) || []), b]);
      }
      for (const [gid, members] of groups) {
        if (members.some((m) => m.reminded)) continue;
        const ids = PERIODS.map((p) => p.id).filter((id) => members.some((m) => m.slots.includes(id)));
        const end = PERIODS.find((p) => p.id === ids[ids.length - 1]).end;
        const endAt = Date.parse(`${date}T00:00:00+08:00`) + end * 3600000;
        const left = endAt - now;
        if (left <= 0 || left > 30 * 60000) continue;
        // 先標記，避免重複提醒
        let marked = false;
        await updateJSON(days(), dayKey(loc.id, date), (d) => {
          const ms = d.bookings.filter((b) => b.group === gid);
          if (ms.some((m) => m.reminded)) return undefined;
          ms.forEach((m) => { m.reminded = true; });
          marked = true;
          return d;
        }, { bookings: [] });
        if (!marked) continue;
        const all = await Promise.all(members.map((m) => readJSON(orders(), m.id)));
        const latest = all.filter(Boolean).sort((a, b) => b.end - a.end)[0];
        const userId = all.find((o) => o?.line?.userId)?.line.userId;
        if (!latest || !userId) continue;
        const group = await groupInfo(latest);
        const next = await nextPeriodFor(latest, group);
        if (await push(userId, [reminderMessage({ order: latest, group, next, origin: latest.origin })])) sent++;
      }
    }
  }
  return sent;
}

/* ---------- 入場密碼（咖啡廳） ---------- */

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// 找同一位客人、同一天、同場地、時間相連的已付款預約 → 沿用它的密碼
async function findLinked(order) {
  if (order.extendOf) {
    const parent = await readJSON(orders(), order.extendOf);
    if (parent?.access) return parent;
  }
  const doc = await readJSON(days(), dayKey(order.location, order.date));
  for (const b of doc?.bookings || []) {
    if (b.id === order.id || b.status !== 'paid' || !b.group) continue;
    const o = await readJSON(orders(), b.id);
    const same = o && (o.customer.phone === order.customer.phone ||
      (order.line?.userId && o.line?.userId === order.line.userId));
    if (o?.access && same && (o.end === order.start || order.end === o.start)) return o;
  }
  return null;
}

export async function assignAccess(order) {
  if (order.access) return order;
  const linked = await findLinked(order);
  const access = linked
    ? { code: linked.access.code, groupId: linked.access.groupId }
    : { code: newCode(), groupId: order.id };
  return updateJSON(orders(), order.id, (o) => {
    if (o.access) return undefined;
    o.access = access;
    return o;
  });
}

// 同一組密碼底下的所有預約（含加訂），算出整段可入場時間
export async function groupInfo(order) {
  if (!order.access) return null;
  const loc = getLocation(order.location);
  const doc = await readJSON(days(), dayKey(order.location, order.date));
  const members = (doc?.bookings || []).filter((b) => b.status === 'paid' && b.group === order.access.groupId);
  const keys = slotsFor(loc, order.date).map((s) => s.key)
    .filter((k) => members.some((m) => m.slots.includes(k)) || order.slots.includes(k));
  const { start, end } = rangeOf(loc, order.date, keys);
  return { slots: keys, label: labelFor(loc, keys), start, end, count: Math.max(members.length, 1) };
}

/* ---------- 加訂下一個時段（分開計價，不套用多時段優惠） ---------- */

export async function nextPeriodFor(order, group) {
  if (!FEATURES.extend || order.mode !== 'periods') return null;
  const lastIdx = PERIODS.findIndex((p) => p.id === group.slots[group.slots.length - 1]);
  const next = PERIODS[lastIdx + 1];
  if (!next) return null;
  const loc = getLocation(order.location);
  const av = await availability(order.location, order.date);
  const slot = av.slots.find((s) => s.key === next.id);
  return {
    id: next.id,
    name: next.name,
    start: next.start,
    end: next.end,
    amount: quote(loc, order.date, [next.id], order.people).amount,
    available: !slot.past && slot.remaining >= unitsFor(loc, order.people),
  };
}

export async function createExtension(parentId, origin) {
  const parent = await readJSON(orders(), parentId);
  if (!parent || parent.status !== 'paid' || !parent.access) throw new UserError('只有付款完成的預約可以加訂');
  const group = await groupInfo(parent);
  const next = await nextPeriodFor(parent, group);
  if (!next) throw new UserError('今天已經沒有下一個時段可以加訂了');
  if (!next.available) throw new UserError(`${next.name}時段已經額滿，無法加訂`);
  return createOrder({
    location: parent.location,
    date: parent.date,
    periods: [next.id],
    people: parent.people,
    customer: parent.customer,
    invoice: parent.invoice,
  }, { extendOf: parent.access.groupId, line: parent.line, origin });
}

/* ---------- 發票、失敗 ---------- */

export async function tryIssueInvoice(order) {
  try {
    const result = await issueInvoice(order);
    await updateJSON(orders(), order.id, (o) => {
      if (o.invoiceResult?.invoiceNo) return undefined;
      o.invoiceResult = result;
      delete o.invoiceError;
      return o;
    });
  } catch (e) {
    console.error('invoice failed', order.id, e);
    await updateJSON(orders(), order.id, (o) => {
      if (o.invoiceResult?.invoiceNo) return undefined;
      o.invoiceError = String(e.message || e);
      return o;
    });
  }
}

export async function markFailed(id, reason) {
  const order = await updateJSON(orders(), id, (o) => {
    if (!o || o.status === 'paid') return undefined;
    o.status = 'failed';
    o.failReason = reason;
    return o;
  });
  if (order && order.status === 'failed') await setDayStatus(order, 'failed');
  return order;
}

/* ---------- 給前台的資料 ---------- */

export function publicOrder(o) {
  if (!o) return null;
  return {
    id: o.id,
    extendOf: o.extendOf,
    mode: o.mode,
    locationName: o.locationName,
    date: o.date,
    slotLabel: o.slotLabel,
    topic: o.topic,
    start: o.start,
    end: o.end,
    people: o.people,
    amount: o.amount,
    lines: o.lines,
    status: o.status === 'pending' && o.holdUntil < Date.now() ? 'expired' : o.status,
    failReason: o.failReason,
    invoiceNo: o.invoiceResult?.invoiceNo,
    email: o.customer.email.replace(/^(.).*(@.*)$/, '$1***$2'),
  };
}

export function publicConfig() {
  const lc = lineConfig();
  return {
    site: SITE.id,
    brand: BRAND,
    features: FEATURES,
    venue: VENUE,
    periods: PERIODS,
    branches: BRANCHES,
    maxDaysAhead: MAX_DAYS_AHEAD,
    holdMinutes: HOLD_MINUTES,
    today: taipeiNow().date,
    locations: LOCATIONS.map((l) => ({ ...l, calendarEnv: undefined, priceTable: priceTable(l) })),
    liffId: lc.liffId || null,
    supportUrl: lc.oaId ? `https://line.me/R/ti/p/${encodeURIComponent(lc.oaId)}` : null,
  };
}

export { hh };
