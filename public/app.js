const $ = (s) => document.querySelector(s);
const state = {
  cfg: null, step: 1, loc: null, branch: '', people: 1, date: null,
  avail: [],
  start: null, endSlot: null,  // 選到的入場小時、最後一個小時
  topic: '', quote: null, invType: 'personal', busy: false, line: null,
};
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '連線失敗，請再試一次');
  return data;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function showError(msg) {
  const e = $('#error');
  e.textContent = msg || '';
  e.classList.toggle('hidden', !msg);
  if (msg) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function flash(msg) {
  showError(msg);
  clearTimeout(flash.t);
  flash.t = setTimeout(() => showError(''), 3000);
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const mode = () => state.loc?.mode;
const isFree = () => state.loc?.pricing === 'free';
const branchOf = (loc) => state.cfg.branches.find((b) => b.id === loc.branch);

/* ---------- 品牌（兩個網站共用同一套畫面） ---------- */
function applyBrand() {
  const b = state.cfg.brand, t = b.theme, r = document.documentElement.style;
  const vars = { brand: t.brand, 'brand-dark': t.brandDark, 'brand-soft': t.brandSoft, cream: t.cream, bg: t.bg, 'hero-from': t.heroFrom, 'hero-to': t.heroTo };
  if (!matchMedia('(prefers-color-scheme: dark)').matches) for (const [k, v] of Object.entries(vars)) r.setProperty('--' + k, v);
  else r.setProperty('--brand', t.brand);
  document.querySelector('meta[name=theme-color]').content = t.brand;
  $('#brand').innerHTML = icon(b.icon) + esc(b.name);
  $('#tagline').textContent = b.tagline;
  $('#footer').textContent = b.footer;
  document.title = b.name + ' 預約';
}

/* ---------- 步驟切換 ---------- */
function go(step) {
  state.step = step;
  for (let i = 1; i <= 4; i++) $('#step' + i).classList.toggle('hidden', i !== step);
  document.querySelectorAll('#steps span').forEach((s, i) => s.classList.toggle('on', i < step));
  $('#back').classList.toggle('hidden', step === 1);
  $('#next').textContent = step === 4 ? (isFree() ? '確認預約' : '前往付款') : '下一步';
  if (step === 3) {
    $('#invoiceBox').classList.toggle('hidden', isFree());
    $('#companyBox').classList.toggle('hidden', mode() !== 'consult');
  }
  showError('');
  if (step === 4) renderSummary();
  refreshBar();
  window.scrollTo({ top: 0 });
}

function units() {
  return state.loc.pricing === 'perPerson' ? state.people : 1;
}

/* ---------- 計價 ---------- */
const periodOf = (id) => state.cfg.periods.find((p) => p.id === id);
function hasSelection() {
  if (!state.loc) return false;
  if (mode() === 'consult') return state.start != null && !!state.topic;
  return state.start != null && state.endSlot != null && !!state.quote;
}
function amount() {
  if (!state.loc) return 0;
  return state.quote?.amount || 0;
}
function selectionLabel() {
  if (state.start == null || state.endSlot == null) return '';
  if (mode() === 'consult') return hh(state.start);
  return `${hh(state.start)}–${hh(state.endSlot + 1)}（${state.endSlot + 1 - state.start} 小時）`;
}
function minPrice(loc) {
  if (loc.mode === 'periods') return Math.min(...Object.values(loc.prices.single));
  return loc.schedule?.weekday?.rate || 0;
}

function refreshBar() {
  const next = $('#next');
  let ok = false;
  if (state.step === 1) ok = !!state.loc;
  else if (state.step === 2) ok = hasSelection();
  else ok = true;
  next.disabled = !ok || state.busy;
  $('#price').textContent = isFree() ? '免費' : money(amount());
  const label = selectionLabel();
  $('#priceLabel').textContent = !state.loc ? '選擇地點開始預約'
    : !label ? (mode() === 'consult' ? '請選擇時間' : state.start == null ? '請選擇入場時間' : '請選擇離場時間')
    : label + (state.loc.pricing === 'perPerson' ? ` × ${state.people} 人` : '');
}

/* ---------- 場地介紹 ---------- */
function renderVenue() {
  const v = state.cfg.venue;
  $('#venue').innerHTML = `
    <div class="photos">${v.photos.map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join('')}</div>
    <div class="vbody">
      <h3>場地介紹・${esc(v.title)}</h3>
      <p class="vintro">${esc(v.intro)}</p>
      <div class="feat">${v.features.map((f) => `<div>${icon(f.icon)}${esc(f.text)}</div>`).join('')}</div>
      <details><summary class="muted" style="cursor:pointer;margin-top:12px;font-size:14px">預約流程與使用規則</summary>
        <h4>流程</h4><ol>${v.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        <h4>使用規則</h4><ul>${v.rules.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </details>
    </div>`;
}

/* ---------- 1. 地點 ---------- */
function renderBranchTabs() {
  const box = $('#branchTabs');
  const branches = state.cfg.branches;
  box.classList.toggle('hidden', !branches.length);
  if (!branches.length) return;
  const tabs = [{ id: '', name: '全部' }, ...branches, { id: 'consult', name: '諮詢預約' }];
  box.innerHTML = '';
  for (const t of tabs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.name;
    b.className = state.branch === t.id ? 'sel' : '';
    b.onclick = () => { state.branch = t.id; renderBranchTabs(); renderLocations(); };
    box.appendChild(b);
  }
}

function renderLocations() {
  const box = $('#locations');
  box.innerHTML = '';
  const list = state.cfg.locations.filter((l) => {
    if (!state.branch) return true;
    if (state.branch === 'consult') return l.mode === 'consult';
    return l.branch === state.branch;
  });
  for (const loc of list) {
    const br = branchOf(loc);
    const b = document.createElement('div');
    b.className = 'card loc' + (state.loc?.id === loc.id ? ' sel' : '');
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    let price;
    if (loc.pricing === 'free') price = '免費';
    else if (loc.mode === 'periods') price = `單時段 ${money(minPrice(loc))} 起`;
    else price = `${money(minPrice(loc))} / ${loc.pricing === 'perPerson' ? '人・' : ''}小時`;
    const table = loc.priceTable ? `<table class="mini">${loc.priceTable.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : '';
    b.innerHTML = `
      <img src="${esc(loc.image)}" alt="">
      <div class="body">
        ${br ? `<div class="branch">${esc(br.name)}${br.subtitle ? '・' + esc(br.subtitle) : ''}</div>` : ''}
        <h3><span>${esc(loc.name)}</span><b>${esc(price)}</b></h3>
        <p>${esc(loc.desc)}</p>
        ${table}
        ${br || loc.address ? `<p>📍 ${esc(br?.address || loc.address)}　<a target="_blank" rel="noopener" href="${esc(br?.mapUrl || loc.mapUrl)}">查看地圖</a></p>` : ''}
      </div>`;
    b.querySelector('a')?.addEventListener('click', (e) => e.stopPropagation());
    const pick = () => selectLocation(loc);
    b.addEventListener('click', pick);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
    box.appendChild(b);
  }
}

function selectLocation(loc) {
  if (state.loc?.id !== loc.id) {
    state.loc = loc;
    state.people = Math.min(state.people, loc.maxPeople);
    state.topic = '';
    clearTime();
  }
  renderLocations();
  setupStep2();
  go(2);
  loadSlots();
}

/* ---------- 2. 人數、日期、時段 ---------- */
function setupStep2() {
  const m = mode();
  const br = branchOf(state.loc);
  $('#placeTitle').innerHTML = (br ? `<small>${esc(br.name)}</small>` : '') + `<b>${esc(state.loc.name)}</b>`;
  $('#periodIntro').classList.toggle('hidden', m !== 'periods');
  $('#hourIntro').classList.toggle('hidden', m !== 'hourly');
  $('#peopleBox').classList.toggle('hidden', m === 'consult');
  $('#topicBox').classList.toggle('hidden', m !== 'consult');
  $('#periods').classList.add('hidden');
  $('#slots').classList.remove('hidden');
  $('#legend').classList.remove('hidden');
  $('#afterLegend').classList.toggle('hidden', m !== 'hourly');
  $('#timeSummary').classList.toggle('hidden', m === 'consult');
  $('#timeTitle').textContent = m === 'consult' ? '日期與時間' : '日期與時段';
  $('#slotHint').textContent = m === 'consult' ? '時間（每次約 1 小時）' : '① 入場時間';
  if (m === 'periods') renderPriceTable();
  if (m === 'hourly') {
    $('#htable').innerHTML = '<h4 style="margin-top:0">價目表</h4>' +
      state.loc.priceTable.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('') +
      `<p class="unit">${state.loc.pricing === 'perPerson' ? '以上為每人價格，' : ''}系統會自動幫你算最划算的價格</p>`;
  }
  if (m === 'consult') {
    const box = $('#topics');
    box.innerHTML = '';
    for (const t of state.loc.topics) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.className = state.topic === t ? 'sel' : '';
      b.onclick = () => { state.topic = t; setupStep2(); refreshBar(); };
      box.appendChild(b);
    }
  }
  renderPeople();
}

function renderPriceTable() {
  const loc = state.loc;
  const unit = loc.pricing === 'perRoom' ? '整間包場價格，不論人數' : '以上為每人價格';
  const row = (label, price, ic = '') => `<div class="row"><span>${ic}${label}</span><b>$${price}</b></div>`;
  const ps = state.cfg.periods;
  let html = '<h4>單時段方案</h4>';
  for (const p of ps) html += row(`${p.name} ${hhShort(p.start)}-${hhShort(p.end)}`, loc.prices.single[p.id], icon(p.icon));
  html += '<h4 style="margin-top:22px">多時段方案</h4>';
  for (const [k, v] of Object.entries(loc.prices.combos)) {
    const ids = k.split('+');
    const short = ids.map((id) => ({ 早上: '早', 下午: '午', 晚上: '晚' }[periodOf(id).name] || periodOf(id).name)).join('+');
    html += row(`${ids.length === ps.length ? '全天' : '雙時段'}（${short}）`, v);
  }
  html += `<p class="unit">${unit}</p>`;
  $('#ptable').innerHTML = html;
}

function renderPeople() {
  $('#people').textContent = state.people;
  $('#peopleMinus').disabled = state.people <= 1;
  $('#peoplePlus').disabled = state.people >= state.loc.maxPeople;
  $('#peopleHint').textContent = state.loc.pricing === 'perRoom'
    ? `整間包場，最多 ${state.loc.maxPeople} 人，價格不因人數改變`
    : `按人數計費，一次最多 ${state.loc.maxPeople} 人`;
}
function changePeople(d) {
  state.people = Math.max(1, Math.min(state.loc.maxPeople, state.people + d));
  renderPeople();
  if (state.start != null && !rangeFits(state.start, state.endSlot)) clearTime();
  renderSlots();
  updateQuote();
  refreshBar();
}

function renderDates() {
  const box = $('#dates');
  box.innerHTML = '';
  for (let i = 0; i < 14; i++) {
    const iso = addDays(state.cfg.today, i);
    const d = new Date(iso + 'T00:00:00Z');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'date' + (iso === state.date ? ' sel' : '');
    b.innerHTML = `<small>${i === 0 ? '今天' : '週' + WEEK[d.getUTCDay()]}</small><b>${d.getUTCDate()}</b><small>${d.getUTCMonth() + 1}月</small>`;
    b.addEventListener('click', () => pickDate(iso));
    box.appendChild(b);
  }
  const p = $('#datePicker');
  p.min = state.cfg.today;
  p.max = addDays(state.cfg.today, state.cfg.maxDaysAhead);
  p.value = state.date || '';
}
function pickDate(iso) {
  if (!iso) return;
  state.date = iso;
  clearTime();
  renderDates();
  loadSlots();
}

async function loadSlots() {
  if (!state.date) { state.date = state.cfg.today; renderDates(); }
  const box = $('#slots');
  box.innerHTML = '<div class="spinner" style="grid-column:1/-1"></div>';
  try {
    const data = await api(`/api/availability?location=${state.loc.id}&date=${state.date}`);
    if (data.date !== state.date || data.location !== state.loc.id) return;
    state.avail = data.slots;
    renderSlots();
    refreshBar();
  } catch (e) {
    box.innerHTML = '';
    showError(e.message);
  }
}

function fits(key) {
  const a = state.avail.find((x) => x.key === key);
  return !!a && !a.past && a.remaining >= units();
}

/* 時租制、諮詢：小時格子 */
const slotAt = (h) => state.avail.find((s) => s.start === h);
function rangeFits(a, b) {
  for (let h = a; h <= b; h++) { const s = slotAt(h); if (!s || !fits(s.key)) return false; }
  return true;
}

function slotSub(s, ok) {
  const pname = s.period ? periodOf(s.period).name + '・' : '';
  if (s.past) return '已過';
  if (!ok) return state.loc.pricing === 'perPerson' ? '額滿' : '已預約';
  return pname + (state.loc.pricing === 'perPerson' ? `剩 ${s.remaining} 位` : s.after ? '營業時間外' : '可預約');
}

// 從入場時間往後，最晚可以待到幾點（中間不能有額滿的時段）
function maxEndFrom(start) {
  let h = start;
  while (slotAt(h) && fits(slotAt(h).key)) h++;
  return h;
}

function renderSlots() {
  const box = $('#slots');
  box.innerHTML = '';
  const consult = mode() === 'consult';
  if (!state.avail.length) {
    box.innerHTML = `<p class="muted" style="grid-column:1/-1;margin:0">這天不開放線上預約${state.cfg.supportUrl ? '，假日或特殊需求請聯絡客服' : ''} 🙏</p>`;
  } else if (!state.avail.some((s) => fits(s.key))) {
    box.innerHTML = '<p class="muted" style="grid-column:1/-1;margin:0">這天已經沒有可預約的時間，請換一天 🙏</p>';
  } else {
    // ① 入場時間
    for (const s of state.avail) {
      const b = document.createElement('button');
      b.type = 'button';
      const ok = fits(s.key);
      b.className = 'slot' + (s.after ? ' after' : '') + (s.start === state.start ? ' edge' : '');
      b.disabled = !ok;
      b.innerHTML = `${hh(s.start)}<small>${slotSub(s, ok)}</small>`;
      if (s.period) b.dataset.period = s.period;
      b.addEventListener('click', () => pickStart(s.start));
      box.appendChild(b);
    }
  }
  // ② 離場時間：入場後才出現，只列出連續有空位的時間
  const endBox = $('#endBox');
  endBox.classList.toggle('hidden', consult || state.start == null);
  if (!consult && state.start != null) {
    const ends = $('#endSlots');
    ends.innerHTML = '';
    const max = maxEndFrom(state.start);
    for (let h = state.start + 1; h <= max; h++) {
      const last = slotAt(h - 1);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot' + (last.after ? ' after' : '') + (state.endSlot === h - 1 ? ' edge' : '');
      b.innerHTML = `${hh(h)}<small>共 ${h - state.start} 小時</small>`;
      if (last.period) b.dataset.period = last.period;
      b.addEventListener('click', () => pickEnd(h));
      ends.appendChild(b);
    }
    if (max < (state.avail[state.avail.length - 1]?.end ?? 0)) {
      ends.insertAdjacentHTML('beforeend', `<p class="muted" style="grid-column:1/-1;margin:2px 0 0;font-size:13px">${hh(max)} 之後已被預約，最晚只能待到 ${hh(max)}</p>`);
    }
  }
  $('#tIn').textContent = state.start != null ? hh(state.start) : '—';
  $('#tOut').textContent = state.endSlot != null && !consult ? hh(state.endSlot + 1) : '—';
  renderQuote();
}

function pickStart(h) {
  state.start = h;
  if (mode() === 'consult') state.endSlot = h;
  else if (state.endSlot == null || state.endSlot < h || !rangeFits(h, state.endSlot)) state.endSlot = null;
  renderSlots();
  updateQuote();
  if (mode() !== 'consult' && state.endSlot == null) {
    $('#endBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function pickEnd(h) {
  state.endSlot = h - 1;
  renderSlots();
  updateQuote();
}

async function updateQuote() {
  state.quote = null;
  refreshBar();
  if (mode() === 'consult' || state.start == null || state.endSlot == null) { renderQuote(); return; }
  const req = { location: state.loc.id, date: state.date, start: state.start, end: state.endSlot + 1, people: state.people };
  const key = JSON.stringify(req);
  updateQuote.key = key;
  try {
    const q = await post('/api/quote', req);
    if (updateQuote.key !== key) return;
    state.quote = q;
    state.quoteError = '';
  } catch (e) {
    if (updateQuote.key !== key) return;
    state.quoteError = e.message;
  }
  renderQuote();
  refreshBar();
}

function renderQuote() {
  const note = $('#comboNote');
  if (mode() === 'consult' || state.start == null) { note.classList.add('hidden'); return; }
  if (state.endSlot == null) { note.classList.remove('hidden'); note.textContent = '請選擇離場時間'; return; }
  note.classList.remove('hidden');
  if (state.quoteError && !state.quote) { note.innerHTML = `⚠️ ${esc(state.quoteError)}`; return; }
  if (!state.quote) { note.textContent = '計算中…'; return; }
  note.innerHTML = state.quote.lines.map((l) => `<div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(l.label)}</span><b>${money(l.amount)}</b></div>`).join('');
}

function clearTime() { state.start = null; state.endSlot = null; state.quote = null; state.quoteError = ''; }

/* ---------- 3. 聯絡、發票 ---------- */
function pickInv(v) {
  state.invType = v;
  document.querySelectorAll('#invType button').forEach((b) => b.classList.toggle('sel', b.dataset.v === v));
  document.querySelectorAll('[data-inv]').forEach((d) => d.classList.toggle('hidden', d.dataset.inv !== v));
}

function collect() {
  const body = {
    lineIdToken: state.line?.idToken,
    location: state.loc.id,
    date: state.date,
    people: state.people,
    customer: {
      name: $('#name').value.trim(),
      phone: $('#phone').value.trim(),
      email: $('#email').value.trim(),
      company: $('#company').value.trim(),
      note: $('#note').value.trim(),
    },
    invoice: {
      type: state.invType,
      carrier: $('#carrier').value.trim(),
      taxId: $('#taxId').value.trim(),
      title: $('#title').value.trim(),
      address: $('#addr').value.trim(),
      loveCode: $('#loveCode').value.trim(),
    },
  };
  body.start = state.start;
  body.end = state.endSlot + 1;
  if (mode() === 'consult') body.topic = state.topic;
  return body;
}

function checkStep3() {
  const b = collect();
  if (!b.customer.name) return '請填寫姓名';
  if (b.customer.phone.replace(/\D/g, '').length < 8) return '請填寫正確的手機號碼';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.customer.email)) return '請填寫正確的 Email';
  const i = b.invoice;
  if (!isFree()) {
    if (i.type === 'mobile' && !/^\/[0-9A-Z.+-]{7}$/i.test(i.carrier)) return '手機條碼格式為 / 開頭共 8 碼';
    if (i.type === 'company' && !/^\d{8}$/.test(i.taxId)) return '統一編號需為 8 碼數字';
    if (i.type === 'company' && !i.title) return '請填寫公司抬頭';
    if (i.type === 'donate' && !/^\d{3,7}$/.test(i.loveCode)) return '捐贈碼為 3–7 碼數字';
  }
  try { localStorage.setItem('hj-contact', JSON.stringify(b.customer)); } catch {}
  return '';
}

/* ---------- 4. 確認、付款 ---------- */
function renderSummary() {
  const b = collect();
  const d = new Date(b.date + 'T00:00:00Z');
  const br = branchOf(state.loc);
  const rows = [
    ['地點', (br ? br.name + ' ' : '') + state.loc.name],
    ['日期', `${b.date}（週${WEEK[d.getUTCDay()]}）`],
  ];
  if (mode() === 'consult') {
    rows.push(['時間', hh(state.start)], ['項目', state.topic]);
  } else {
    rows.push(['入場', hh(state.start)], ['出場', hh(state.endSlot + 1)]);
  }
  if (mode() !== 'consult') rows.push(['人數', `${b.people} 人`]);
  rows.push(['姓名', b.customer.name], ['Email', b.customer.email]);
  if (!isFree()) {
    rows.push(['發票', { personal: '會員載具', mobile: '手機條碼 ' + b.invoice.carrier.toUpperCase(), company: `統編 ${b.invoice.taxId}`, donate: '捐贈 ' + b.invoice.loveCode }[b.invoice.type]]);
  }
  const dl = $('#summary');
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  const lines = mode() !== 'consult' && state.quote ? state.quote.lines : [];
  $('#lines').innerHTML = lines.map((l) => `<div><span>${esc(l.label)}</span><span>${money(l.amount)}</span></div>`).join('');
  $('#lines').classList.toggle('hidden', !lines.length);
  $('#total').textContent = isFree() ? '免費' : money(amount());
  $('#payHint').classList.toggle('hidden', isFree());
}

async function pay() {
  state.busy = true;
  refreshBar();
  $('#next').textContent = '處理中…';
  try {
    const r = await post('/api/create-order', collect());
    if (r.free) { location.href = '/success.html?id=' + r.orderId; return; }
    submitToECPay(r.form);
  } catch (e) {
    state.busy = false;
    $('#next').textContent = isFree() ? '確認預約' : '前往付款';
    refreshBar();
    showError(e.message);
    if (/額滿|訂走|已經結束/.test(e.message)) { go(2); loadSlots(); }
  }
}

/* ---------- 綁定事件 ---------- */
$('#peopleMinus').addEventListener('click', () => changePeople(-1));
$('#peoplePlus').addEventListener('click', () => changePeople(1));
$('#datePicker').addEventListener('change', (e) => pickDate(e.target.value));
document.querySelectorAll('#invType button').forEach((b) => b.addEventListener('click', () => pickInv(b.dataset.v)));
$('#back').addEventListener('click', () => go(state.step - 1));
$('#next').addEventListener('click', () => {
  if (state.step === 3) {
    const err = checkStep3();
    if (err) return showError(err);
  }
  if (state.step === 4) return pay();
  go(state.step + 1);
});
// 從綠界頁按「上一頁」回來時，解除「處理中」
window.addEventListener('pageshow', (e) => {
  if (e.persisted && state.busy) { state.busy = false; go(state.step); }
});

(async function init() {
  try {
    state.cfg = await api('/api/config');
    applyBrand();
    $('#holdMin').textContent = state.cfg.holdMinutes;
    try {
      const c = JSON.parse(localStorage.getItem('hj-contact') || 'null');
      if (c) { $('#name').value = c.name || ''; $('#phone').value = c.phone || ''; $('#email').value = c.email || ''; }
    } catch {}
    renderVenue();
    // QR code 可帶 ?branch=xxx 只顯示某館，或 ?loc=xxx 直接進到指定空間
    const q = new URLSearchParams(location.search);
    if (state.cfg.branches.some((b) => b.id === q.get('branch'))) state.branch = q.get('branch');
    renderBranchTabs();
    renderLocations();
    renderDates();
    initLine(state.cfg.liffId).then((line) => {
      state.line = line;
      if (line && !$('#name').value) $('#name').value = line.name;
    });
    const loc = state.cfg.locations.find((l) => l.id === q.get('loc'));
    if (loc) selectLocation(loc);
    else go(1);
  } catch (e) {
    $('#locations').innerHTML = '';
    showError(e.message);
  }
})();
