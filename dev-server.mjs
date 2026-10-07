// 本機測試用伺服器：模擬 Netlify（網頁＋/api），並內建「假綠界」可以測成功／失敗
// 用法：npm run dev → 打開 http://localhost:8888
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT || 8888);
const ORIGIN = `http://localhost:${PORT}`;
process.env.ECPAY_CHECKOUT_URL ||= `${ORIGIN}/__mock/ecpay`;
process.env.INVOICE_BASE_URL ||= `${ORIGIN}/__mock/invoice`;
process.env.ADMIN_PASSWORD ||= 'admin';
// 假 LINE：LIFF 與推播都在本機模擬
process.env.LIFF_ID ||= 'dev-mock';
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= 'dev-token';
process.env.LINE_API_BASE ||= `${ORIGIN}/__mock/line`;
// 假 Google 日曆：每館一本日曆，另外預先放一筆「同事手動排的預約」測試是否會擋住
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  const { privateKey } = (await import('node:crypto')).generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'booking@dev.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  process.env.GOOGLE_TOKEN_URL = `${ORIGIN}/__mock/google/token`;
  process.env.GOOGLE_API_BASE = `${ORIGIN}/__mock/google`;
  for (const k of ['XINYI', 'DAZHONG', 'DONGNING', 'ZHONGSHAN', 'CHONGXUE', 'CONSULT']) {
    process.env['GCAL_' + k] ||= `hj-${k.toLowerCase()}@group.calendar.google.com`;
  }
}

const { checkMacValue } = await import('./netlify/lib/ecpay.mjs');
const { encrypt, decrypt } = await import('./netlify/lib/invoice.mjs');
const { ecpayConfig, invoiceConfig } = await import('./netlify/lib/config.mjs');

// 載入所有 functions，依 config.path 建立路由
const routes = {};
const dir = path.resolve('netlify/functions');
for (const f of await fs.readdir(dir)) {
  if (!f.endsWith('.mjs')) continue;
  const mod = await import(pathToFileURL(path.join(dir, f)));
  if (mod.config.path) routes[mod.config.path] = mod.default;
  else if (mod.config.schedule) routes[`/__dev/${f.replace('.mjs', '')}`] = mod.default; // 排程：手動觸發
}

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(ORIGIN + req.url, {
    method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
}

async function send(res, r) {
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

// 假綠界付款頁：顯示金額，讓你按「付款成功」或「付款失敗」
async function mockEcpay(request) {
  const p = Object.fromEntries(new URLSearchParams(await request.text()));
  const cfg = ecpayConfig();
  const result = (ok) => {
    const r = {
      MerchantID: p.MerchantID, MerchantTradeNo: p.MerchantTradeNo, StoreID: '',
      RtnCode: ok ? '1' : '10100058', RtnMsg: ok ? '交易成功' : '付款失敗（測試）',
      TradeNo: '2410' + Date.now().toString().slice(-10), TradeAmt: p.TotalAmount,
      PaymentDate: '2026/10/07 12:00:00', PaymentType: 'Credit_CreditCard', PaymentTypeChargeFee: '0',
      TradeDate: p.MerchantTradeDate, SimulatePaid: '0', CustomField1: p.CustomField1,
      CustomField2: '', CustomField3: '', CustomField4: '',
    };
    r.CheckMacValue = checkMacValue(r, cfg);
    return r;
  };
  const sigOk = checkMacValue(p, cfg) === p.CheckMacValue;
  const form = (ok) => `<form method="post" action="${p.OrderResultURL}" data-notify='${JSON.stringify(result(ok))}'>
    ${Object.entries(result(ok)).map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('')}
    <button class="btn block ${ok ? '' : 'ghost'}">${ok ? '模擬：付款成功' : '模擬：付款失敗'}</button></form><p></p>`;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/app.css"><title>假綠界</title><div class="wrap">
    <h2>🧪 綠界付款頁（本機模擬）</h2><div class="card"><p>${p.ItemName}</p><h2>NT$ ${p.TotalAmount}</h2>
    <p class="muted">訂單 ${p.MerchantTradeNo}｜簽章驗證：${sigOk ? '✅ 正確' : '❌ 錯誤'}</p></div>
    ${form(true)}${form(false)}<a class="btn ghost block" href="${p.ClientBackURL}">取消付款</a></div>
    <script>
      // 真綠界會先「伺服器通知」再導回瀏覽器，這裡照順序模擬
      document.querySelectorAll('form').forEach(f => f.addEventListener('submit', async e => {
        e.preventDefault();
        await fetch('${p.ReturnURL}', { method: 'POST', body: new URLSearchParams(JSON.parse(f.dataset.notify)) });
        f.submit();
      }));
    </script>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

let invoiceSeq = 10000000;
async function mockInvoice(request, url) {
  const cfg = invoiceConfig();
  const body = await request.json();
  const data = decrypt(body.Data, cfg);
  console.log('[假綠界發票]', url.pathname, JSON.stringify(data));
  const out = url.pathname.endsWith('/Issue')
    ? { RtnCode: 1, RtnMsg: '開立發票成功', InvoiceNo: 'AB' + invoiceSeq++, InvoiceDate: '2026-10-07 12:00:00', RandomNumber: '1234' }
    : { RtnCode: 1, RtnMsg: '發送通知成功' };
  return Response.json({ MerchantID: cfg.merchantId, RpHeader: { Timestamp: 0 }, TransCode: 1, TransMsg: 'Success', Data: encrypt(out, cfg) });
}

const gEvents = [];
{
  // 明天 14:00–16:00 東寧會議室已被同事手動排入
  const t = new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10);
  gEvents.push({ calendar: 'hj-dongning@group.calendar.google.com', summary: '會議室｜同事手動排的會議',
    start: new Date(Date.parse(t + 'T14:00:00+08:00')).toISOString(), end: new Date(Date.parse(t + 'T16:00:00+08:00')).toISOString() });
}
async function mockGoogle(request, url) {
  if (url.pathname.endsWith('/token')) return Response.json({ access_token: 'dev-google-token', expires_in: 3600 });
  if (request.headers.get('authorization') !== 'Bearer dev-google-token') return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (url.pathname.endsWith('/freeBusy')) {
    const b = await request.json();
    const calendars = {};
    for (const { id } of b.items) {
      calendars[id] = { busy: gEvents.filter((e) => e.calendar === id && e.end > b.timeMin && e.start < b.timeMax).map(({ start, end }) => ({ start, end })) };
    }
    return Response.json({ calendars });
  }
  const m = url.pathname.match(/calendars\/([^/]+)\/events$/);
  if (m && request.method === 'GET') {
    const id = decodeURIComponent(m[1]);
    const tMin = url.searchParams.get('timeMin'), tMax = url.searchParams.get('timeMax');
    const items = gEvents.filter((e) => e.calendar === id && e.end > tMin && e.start < tMax)
      .map((e) => ({ id: e.id, summary: e.summary, start: { dateTime: e.start }, end: { dateTime: e.end } }));
    return Response.json({ items });
  }
  if (m) {
    const b = await request.json();
    const ev = { id: 'ev' + gEvents.length, calendar: decodeURIComponent(m[1]), summary: b.summary, start: new Date(b.start.dateTime).toISOString(), end: new Date(b.end.dateTime).toISOString() };
    gEvents.push(ev);
    console.log('[假 Google 日曆] 新增', ev.calendar, ev.summary, ev.start, '→', ev.end);
    return Response.json({ id: ev.id });
  }
  if (url.pathname.endsWith('/events-list')) return Response.json(gEvents);
  return new Response('not found', { status: 404 });
}

const linePushes = [];
async function mockLine(request, url) {
  if (url.pathname.endsWith('/oauth2/v2.1/verify')) {
    const p = new URLSearchParams(await request.text());
    const tok = p.get('id_token') || '';
    if (!tok.startsWith('test-')) return Response.json({ error: 'invalid_request' }, { status: 400 });
    return Response.json({ sub: tok.slice(5), name: 'LINE 測試用戶' });
  }
  if (url.pathname.endsWith('/v2/bot/message/push')) {
    const body = await request.json();
    linePushes.push(body);
    console.log('[假 LINE 推播]', body.to, body.messages.map((m) => m.altText).join(' / '));
    return Response.json({});
  }
  if (url.pathname.endsWith('/pushes')) return Response.json(linePushes);
  return new Response('not found', { status: 404 });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(ORIGIN + req.url);
    if (url.pathname.startsWith('/__mock/google')) return send(res, await mockGoogle(await toRequest(req), url));
    if (url.pathname.startsWith('/__mock/line')) return send(res, await mockLine(await toRequest(req), url));
    if (url.pathname === '/__mock/ecpay') return send(res, await mockEcpay(await toRequest(req)));
    if (url.pathname.startsWith('/__mock/invoice')) return send(res, await mockInvoice(await toRequest(req), url));
    const fn = routes[url.pathname];
    if (fn) return send(res, await fn(await toRequest(req), {}));
    let file = path.join('public', decodeURIComponent(url.pathname));
    if (!file.startsWith('public')) throw new Error('bad path');
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(e);
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, () => console.log(`本機預約系統［${process.env.SITE || 'cafe'}］：${ORIGIN}（後台密碼：${process.env.ADMIN_PASSWORD}）`));
