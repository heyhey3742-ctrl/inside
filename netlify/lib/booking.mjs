// 預約核心邏輯：查空位、建立訂單、付款成功／失敗處理
import crypto from 'node:crypto';
import {
  LOCATIONS, PERIODS, VENUE, MAX_DAYS_AHEAD, HOLD_MINUTES,
  getLocation, unitsFor, priceFor, normalizePeriods,
} from './config.mjs';
import { taipeiNow, daysBetween, isValidDate } from './time.mjs';
import { orders, days, users, readJSON, updateJSON } from './db.mjs';
import { issueInvoice } from './invoice.mjs';
import { lineConfig } from './config.mjs';
import { push, accessMessage, reminderMessage } from './line.mjs';

export class UserError extends Error {}

const dayKey = (locId, date) => `${locId}/${date}`;

// 這筆預約目前是否還佔著時段（已付款，或付款中且未逾時）
function isActive(b, now = Date.now()) {
  return b.status === 'paid' || (b.status === 'pending' && b.holdUntil > now);
}

export function periodUsage(dayDoc, excludeId) {
  const used = Object.fromEntries(PERIODS.map((p) => [p.id, 0]));
  for (const b of dayDoc?.bookings || []) {
    if (b.id === excludeId || !isActive(b)) continue;
    for (const pid of b.periods) used[pid] += b.units;
  }
  return used;
}

// 時段結束前都還能訂（現場掃 QR code 也能馬上預約）
function isPast(date, period, now = taipeiNow()) {
  if (date < now.date) return true;
  return date === now.date && period.end <= 24 && now.hour >= period.end;
}

export async function availability(locId, date) {
  const loc = getLocation(locId);
  if (!loc) throw new UserError('找不到這個地點');
  if (!isValidDate(date)) throw new UserError('日期格式錯誤');
  const dayDoc = await readJSON(days(), dayKey(locId, date));
  const used = periodUsage(dayDoc);
  const now = taipeiNow();
  const periods = PERIODS.map((p) => {
    const past = isPast(date, p, now);
    return { id: p.id, remaining: past ? 0 : loc.capacity - used[p.id], past };
  });
  return { location: locId, date, capacity: loc.capacity, periods };
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

  const periods = normalizePeriods(Array.isArray(body.periods) ? body.periods.map(String) : []);
  if (!periods) throw new UserError('請選擇連續的時段（早＋晚請改選全天）');
  for (const pid of periods) {
    if (isPast(date, PERIODS.find((p) => p.id === pid), now)) throw new UserError('這個時段已經結束了');
  }

  const people = Number(body.people);
  if (!Number.isInteger(people) || people < 1 || people > loc.maxPeople) {
    throw new UserError(`人數需介於 1–${loc.maxPeople} 人`);
  }

  const c = body.customer || {};
  const customer = {
    name: String(c.name || '').trim().slice(0, 30),
    phone: String(c.phone || '').replace(/[^\d+]/g, '').slice(0, 15),
    email: String(c.email || '').trim().slice(0, 80),
    note: String(c.note || '').trim().slice(0, 200),
  };
  if (!customer.name) throw new UserError('請填寫姓名');
  if (customer.phone.length < 8) throw new UserError('請填寫正確的手機號碼');
  if (!EMAIL_RE.test(customer.email)) throw new UserError('請填寫正確的 Email（發票會寄到這裡）');

  const i = body.invoice || {};
  let invoice = { type: 'personal' };
  if (i.type === 'company') {
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

  const amount = priceFor(loc, periods, people);
  if (!amount) throw new UserError('這個時段組合沒有提供，請改選其他時段');
  const first = PERIODS.find((p) => p.id === periods[0]);
  const last = PERIODS.find((p) => p.id === periods[periods.length - 1]);
  return {
    loc, date, periods, people, customer, invoice, amount,
    start: first.start,
    end: last.end,
    units: unitsFor(loc, people),
  };
}

const pad = (h) => (h >= 24 ? '隔日' : '') + String(h % 24).padStart(2, '0') + ':00';

export function periodLabel(periods) {
  if (periods.length === PERIODS.length) return '全天';
  return periods.map((id) => PERIODS.find((p) => p.id === id).name).join('＋');
}

export async function createOrder(body, { extendOf, line, origin } = {}) {
  const v = validateInput(body);
  const id = 'HJ' + taipeiNow().date.replace(/-/g, '').slice(2) +
    crypto.randomBytes(4).toString('hex').toUpperCase();
  const holdUntil = Date.now() + HOLD_MINUTES * 60 * 1000;

  // 先佔位：檢查每個小時都還有空位才寫入
  await updateJSON(days(), dayKey(v.loc.id, v.date), (doc) => {
    const used = periodUsage(doc);
    for (const pid of v.periods) {
      if (used[pid] + v.units > v.loc.capacity) {
        throw new UserError(`${periodLabel([pid])}時段已經額滿，請改選其他時段`);
      }
    }
    doc.bookings = doc.bookings.filter((b) => isActive(b));
    doc.bookings.push({ id, periods: v.periods, units: v.units, status: 'pending', holdUntil });
    return doc;
  }, { bookings: [] });

  const order = {
    id,
    location: v.loc.id,
    locationName: v.loc.name,
    date: v.date,
    periods: v.periods,
    start: v.start,
    end: v.end,
    people: v.people,
    amount: v.amount,
    itemName: `${v.loc.name} ${v.date} ${periodLabel(v.periods)} ${pad(v.start)}-${pad(v.end)} ${v.people}人`,
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
  return order;
}

// 付款失敗後重新付款：重新保留時段，產生新的付款編號
export async function retryOrder(id) {
  const order = await readJSON(orders(), id);
  if (!order) throw new UserError('找不到這筆預約');
  if (order.status === 'paid') throw new UserError('這筆預約已經付款完成');
  const loc = getLocation(order.location);
  const holdUntil = Date.now() + HOLD_MINUTES * 60 * 1000;
  await updateJSON(days(), dayKey(order.location, order.date), (doc) => {
    const used = periodUsage(doc, id);
    const units = unitsFor(loc, order.people);
    for (const pid of order.periods) {
      if (used[pid] + units > loc.capacity) {
        throw new UserError('很抱歉，這個時段剛被訂走了，請重新預約');
      }
    }
    const b = doc.bookings.find((x) => x.id === id);
    if (b) Object.assign(b, { status: 'pending', holdUntil });
    else doc.bookings.push({ id, periods: order.periods, units, status: 'pending', holdUntil });
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
      doc.bookings.push({ id: order.id, periods: order.periods, units: unitsFor(loc, order.people), status, group });
    } else {
      return undefined;
    }
    return doc;
  }, { bookings: [] });
}

// 綠界通知付款成功（可能重複通知，所以要能重複執行不出錯）
export async function markPaid(id, info) {
  const order = await updateJSON(orders(), id, (o) => {
    if (!o) throw new Error(`order ${id} not found`);
    if (o.status === 'paid') return undefined;
    o.status = 'paid';
    o.paidAt = new Date().toISOString();
    o.payment = info;
    return o;
  });
  const withAccess = await assignAccess(order);
  await setDayStatus(withAccess, 'paid');
  await notifyLine(withAccess);
  if (!order.invoiceResult) await tryIssueInvoice(order);
  return withAccess;
}

/* ---------- LINE ---------- */

// 付款成功後推播入場密碼到 LINE（只推一次）
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
  if (mine) {
    const group = await groupInfo(order);
    await push(userId, [accessMessage({
      order: { ...order, periodLabel: periodLabel(order.periods) },
      group,
      origin: order.origin,
    })]);
  }
}

// 以 LINE 身分列出近期的預約
export async function ordersForLineUser(userId) {
  const u = await readJSON(users(), userId);
  const yesterday = new Date(Date.parse(taipeiNow().date) - 86400000).toISOString().slice(0, 10);
  const list = await Promise.all((u?.orders || []).map((id) => readJSON(orders(), id)));
  return list.filter((o) => o && o.status === 'paid' && o.date >= yesterday);
}

// 每 10 分鐘檢查：時段結束前 30 分鐘提醒加訂
export async function sendReminders(now = Date.now()) {
  if (!lineConfig().pushEnabled) return 0;
  const today = taipeiNow(new Date(now)).date;
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  let sent = 0;
  for (const loc of LOCATIONS) {
    for (const date of [yesterday, today]) {
      const doc = await readJSON(days(), dayKey(loc.id, date));
      const groups = new Map();
      for (const b of doc?.bookings || []) {
        if (b.status === 'paid' && b.group) groups.set(b.group, [...(groups.get(b.group) || []), b]);
      }
      for (const [gid, members] of groups) {
        if (members.some((m) => m.reminded)) continue;
        const ids = PERIODS.map((p) => p.id).filter((id) => members.some((m) => m.periods.includes(id)));
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

/* ---------- 入場密碼 ---------- */

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
    if (o?.access && same &&
        (o.end === order.start || order.end === o.start)) return o;
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
  const doc = await readJSON(days(), dayKey(order.location, order.date));
  const members = (doc?.bookings || []).filter((b) => b.status === 'paid' && b.group === order.access.groupId);
  const ids = PERIODS.map((p) => p.id).filter((id) => members.some((m) => m.periods.includes(id)) || order.periods.includes(id));
  const first = PERIODS.find((p) => p.id === ids[0]);
  const last = PERIODS.find((p) => p.id === ids[ids.length - 1]);
  return { periods: ids, start: first.start, end: last.end, count: Math.max(members.length, 1) };
}

/* ---------- 加訂下一個時段（分開計價，不套用多時段優惠） ---------- */

export async function nextPeriodFor(order, group) {
  const lastIdx = PERIODS.findIndex((p) => p.id === group.periods[group.periods.length - 1]);
  const next = PERIODS[lastIdx + 1];
  if (!next) return null;
  const loc = getLocation(order.location);
  const av = await availability(order.location, order.date);
  const slot = av.periods.find((p) => p.id === next.id);
  return {
    id: next.id,
    name: next.name,
    start: next.start,
    end: next.end,
    amount: priceFor(loc, [next.id], order.people),
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

export function publicOrder(o) {
  if (!o) return null;
  return {
    extendOf: o.extendOf,
    id: o.id,
    locationName: o.locationName,
    date: o.date,
    periodLabel: periodLabel(o.periods),
    start: o.start,
    end: o.end,
    people: o.people,
    amount: o.amount,
    status: o.status === 'pending' && o.holdUntil < Date.now() ? 'expired' : o.status,
    failReason: o.failReason,
    invoiceNo: o.invoiceResult?.invoiceNo,
    email: o.customer.email.replace(/^(.).*(@.*)$/, '$1***$2'),
  };
}

export function publicConfig() {
  return {
    periods: PERIODS,
    maxDaysAhead: MAX_DAYS_AHEAD,
    holdMinutes: HOLD_MINUTES,
    today: taipeiNow().date,
    locations: LOCATIONS,
    venue: VENUE,
    liffId: lineConfig().liffId || null,
    supportUrl: lineConfig().oaId ? `https://line.me/R/ti/p/${encodeURIComponent(lineConfig().oaId)}` : null,
  };
}
