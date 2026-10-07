// 預約核心邏輯：查空位、建立訂單、付款成功／失敗處理
import crypto from 'node:crypto';
import {
  LOCATIONS, OPEN_HOUR, CLOSE_HOUR, MAX_DAYS_AHEAD, HOLD_MINUTES,
  getLocation, unitsFor, priceFor,
} from './config.mjs';
import { taipeiNow, daysBetween, isValidDate } from './time.mjs';
import { orders, days, readJSON, updateJSON } from './db.mjs';
import { issueInvoice } from './invoice.mjs';

export class UserError extends Error {}

const dayKey = (locId, date) => `${locId}/${date}`;

// 這筆預約目前是否還佔著時段（已付款，或付款中且未逾時）
function isActive(b, now = Date.now()) {
  return b.status === 'paid' || (b.status === 'pending' && b.holdUntil > now);
}

export function hourlyUsage(dayDoc, excludeId) {
  const used = {};
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) used[h] = 0;
  for (const b of dayDoc?.bookings || []) {
    if (b.id === excludeId || !isActive(b)) continue;
    for (let h = b.start; h < b.end; h++) used[h] += b.units;
  }
  return used;
}

export async function availability(locId, date) {
  const loc = getLocation(locId);
  if (!loc) throw new UserError('找不到這個地點');
  if (!isValidDate(date)) throw new UserError('日期格式錯誤');
  const dayDoc = await readJSON(days(), dayKey(locId, date));
  const used = hourlyUsage(dayDoc);
  const now = taipeiNow();
  const slots = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    const past = date < now.date || (date === now.date && h <= now.hour);
    slots.push({ hour: h, remaining: past ? 0 : loc.capacity - used[h], past });
  }
  return { location: locId, date, capacity: loc.capacity, slots };
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

  const start = Number(body.start);
  const end = Number(body.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < OPEN_HOUR || end > CLOSE_HOUR || end <= start) {
    throw new UserError('請選擇正確的入場與出場時間');
  }
  if (date === now.date && start <= now.hour) throw new UserError('這個時段已經過了');

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

  const hours = end - start;
  return {
    loc, date, start, end, hours, people, customer, invoice,
    units: unitsFor(loc, people),
    amount: priceFor(loc, hours, people),
  };
}

const pad = (h) => String(h).padStart(2, '0') + ':00';

export async function createOrder(body) {
  const v = validateInput(body);
  const id = 'HJ' + taipeiNow().date.replace(/-/g, '').slice(2) +
    crypto.randomBytes(4).toString('hex').toUpperCase();
  const holdUntil = Date.now() + HOLD_MINUTES * 60 * 1000;

  // 先佔位：檢查每個小時都還有空位才寫入
  await updateJSON(days(), dayKey(v.loc.id, v.date), (doc) => {
    const used = hourlyUsage(doc);
    for (let h = v.start; h < v.end; h++) {
      if (used[h] + v.units > v.loc.capacity) {
        throw new UserError(`${pad(h)} 這個時段已經額滿，請改選其他時間`);
      }
    }
    doc.bookings = doc.bookings.filter((b) => isActive(b) || b.status === 'paid');
    doc.bookings.push({ id, start: v.start, end: v.end, units: v.units, status: 'pending', holdUntil });
    return doc;
  }, { bookings: [] });

  const order = {
    id,
    location: v.loc.id,
    locationName: v.loc.name,
    date: v.date,
    start: v.start,
    end: v.end,
    hours: v.hours,
    people: v.people,
    amount: v.amount,
    itemName: `${v.loc.name} ${v.date} ${pad(v.start)}-${pad(v.end)} ${v.people}人`,
    customer: v.customer,
    invoice: v.invoice,
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
    const used = hourlyUsage(doc, id);
    for (let h = order.start; h < order.end; h++) {
      if (used[h] + unitsFor(loc, order.people) > loc.capacity) {
        throw new UserError('很抱歉，這個時段剛被訂走了，請重新預約');
      }
    }
    const b = doc.bookings.find((x) => x.id === id);
    if (b) Object.assign(b, { status: 'pending', holdUntil });
    else doc.bookings.push({ id, start: order.start, end: order.end, units: unitsFor(loc, order.people), status: 'pending', holdUntil });
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
    if (b) {
      if (b.status === status) return undefined;
      b.status = status;
    } else if (status === 'paid') {
      const loc = getLocation(order.location);
      doc.bookings.push({ id: order.id, start: order.start, end: order.end, units: unitsFor(loc, order.people), status });
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
  await setDayStatus(order, 'paid');
  if (!order.invoiceResult) await tryIssueInvoice(order);
  return order;
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
    id: o.id,
    locationName: o.locationName,
    date: o.date,
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
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    maxDaysAhead: MAX_DAYS_AHEAD,
    holdMinutes: HOLD_MINUTES,
    today: taipeiNow().date,
    locations: LOCATIONS,
  };
}
