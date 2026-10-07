// Google 日曆：查哪些時間已被佔用、付款後寫入預約
// 需要環境變數 GOOGLE_SERVICE_ACCOUNT_JSON（Google Cloud 服務帳號金鑰，JSON 原文或 base64）
// 每間會議室的日曆 ID 放在各自的環境變數（例如 GCAL_DONGNING_ROOM），並把日曆分享給服務帳號
import crypto from 'node:crypto';
import { getBranch } from './config.mjs';

const env = (k) => process.env[k] || '';
const apiBase = () => env('GOOGLE_API_BASE') || 'https://www.googleapis.com';

function serviceAccount() {
  const raw = env('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) return null;
  try {
    return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON 格式錯誤');
    return null;
  }
}

// 空間自己有設定就用自己的，否則用所屬分館的日曆；座位等沒有 calendarKeyword 的空間不寫日曆
export function calendarIdFor(loc) {
  if (!loc?.calendarKeyword) return '';
  const name = loc.calendarEnv || getBranch(loc.branch)?.calendarEnv;
  return name ? env(name) : '';
}

export function enabledFor(loc) {
  return !!(calendarIdFor(loc) && serviceAccount());
}

let cached = { token: '', exp: 0 };
async function accessToken() {
  if (cached.token && cached.exp > Date.now() + 60000) return cached.token;
  const sa = serviceAccount();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const tokenUrl = env('GOOGLE_TOKEN_URL') || sa.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar',
    aud: tokenUrl, iat: now, exp: now + 3600,
  })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('Google 授權失敗：' + JSON.stringify(d));
  cached = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return cached.token;
}

async function call(path, body, method) {
  const res = await fetch(apiBase() + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (method === 'DELETE' && (res.status === 404 || res.status === 410)) return {};
  if (!res.ok) throw new Error(`Google 日曆錯誤 ${res.status}：${JSON.stringify(d.error || d)}`);
  return d;
}

const iso = (date, hour) => new Date(Date.parse(`${date}T00:00:00+08:00`) + hour * 3600000).toISOString();

// 回傳這一天被佔用的小時（例如 [10, 11, 14]）
// 分館日曆裡可能有好幾個空間的活動，只算標題含 calendarKeyword（例如「會議室」）的活動
export async function busyHours(loc, date) {
  if (!enabledFor(loc)) return [];
  const id = calendarIdFor(loc);
  try {
    const q = new URLSearchParams({
      timeMin: iso(date, 0), timeMax: iso(date, 30), singleEvents: 'true', maxResults: '250', timeZone: 'Asia/Taipei',
    });
    const d = await call(`/calendar/v3/calendars/${encodeURIComponent(id)}/events?${q}`);
    const base = Date.parse(`${date}T00:00:00+08:00`);
    const hours = new Set();
    for (const ev of d.items || []) {
      if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
      if (!String(ev.summary || '').includes(loc.calendarKeyword)) continue;
      // 整天的活動（只有日期）視為整天佔用
      const startAt = ev.start?.dateTime ? Date.parse(ev.start.dateTime) : Date.parse(`${ev.start?.date}T00:00:00+08:00`);
      const endAt = ev.end?.dateTime ? Date.parse(ev.end.dateTime) : Date.parse(`${ev.end?.date}T00:00:00+08:00`);
      const s = (startAt - base) / 3600000, e = (endAt - base) / 3600000;
      for (let h = Math.max(0, Math.floor(s)); h < Math.min(30, Math.ceil(e)); h++) hours.add(h);
    }
    return [...hours];
  } catch (e) {
    // 查不到日曆時先放行，避免整個預約系統停擺（會記錄在 Netlify log）
    console.error('讀取 Google 日曆失敗', loc.id, e.message);
    return [];
  }
}

export async function insertEvent(loc, { date, start, end, summary, description }) {
  if (!enabledFor(loc)) return null;
  const d = await call(`/calendar/v3/calendars/${encodeURIComponent(calendarIdFor(loc))}/events`, {
    summary, description,
    start: { dateTime: iso(date, start), timeZone: 'Asia/Taipei' },
    end: { dateTime: iso(date, end), timeZone: 'Asia/Taipei' },
  });
  return d.id || null;
}

export async function deleteEvent(loc, eventId) {
  if (!eventId || !enabledFor(loc)) return;
  await call(`/calendar/v3/calendars/${encodeURIComponent(calendarIdFor(loc))}/events/${encodeURIComponent(eventId)}`, null, 'DELETE');
}
