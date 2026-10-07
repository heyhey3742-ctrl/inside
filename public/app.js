const $ = (s) => document.querySelector(s);
const state = {
  cfg: null, step: 1, loc: null, people: 1, date: null,
  avail: [], sel: [], invType: 'personal', busy: false, line: null,
};
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '連線失敗，請再試一次');
  return data;
}

function showError(msg) {
  const e = $('#error');
  e.textContent = msg || '';
  e.classList.toggle('hidden', !msg);
  if (msg) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ---------- 步驟切換 ---------- */
function go(step) {
  state.step = step;
  for (let i = 1; i <= 4; i++) $('#step' + i).classList.toggle('hidden', i !== step);
  document.querySelectorAll('#steps span').forEach((s, i) => s.classList.toggle('on', i < step));
  $('#back').classList.toggle('hidden', step === 1);
  $('#next').textContent = step === 4 ? '前往付款' : '下一步';
  showError('');
  if (step === 4) renderSummary();
  refreshBar();
  window.scrollTo({ top: 0 });
}

function units() {
  return state.loc.pricing === 'perRoom' ? 1 : state.people;
}
const PIDS = () => state.cfg.periods.map((p) => p.id);
const periodOf = (id) => state.cfg.periods.find((p) => p.id === id);
// 選到的時段，依早→中→晚排好
function selected() {
  return PIDS().filter((id) => state.sel.includes(id));
}
function unitPrice(loc, ids) {
  if (!ids.length) return 0;
  return ids.length === 1 ? loc.prices.single[ids[0]] : loc.prices.combos[ids.join('+')];
}
function amount() {
  if (!state.loc) return 0;
  const p = unitPrice(state.loc, selected());
  if (!p) return 0;
  return state.loc.pricing === 'perRoom' ? p : p * state.people;
}
function periodLabel(ids) {
  if (ids.length === state.cfg.periods.length) return '全天';
  return ids.map((id) => periodOf(id).name).join('＋');
}
function minPrice(loc) {
  return Math.min(...Object.values(loc.prices.single));
}

function refreshBar() {
  const next = $('#next');
  let ok = false;
  if (state.step === 1) ok = !!state.loc;
  else if (state.step === 2) ok = amount() > 0;
  else ok = true;
  next.disabled = !ok || state.busy;
  $('#price').textContent = money(amount());
  const ids = selected();
  $('#priceLabel').textContent = !state.loc ? '選擇地點開始預約'
    : !ids.length ? '請選擇時段'
    : periodLabel(ids) + (state.loc.pricing === 'perPerson' ? ` × ${state.people} 人` : '・整間');
}

/* ---------- 場地介紹 ---------- */
function renderVenue() {
  const v = state.cfg.venue;
  const box = $('#venue');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  box.innerHTML = `
    <div class="photos">${v.photos.map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join('')}</div>
    <div class="vbody">
      <h3>場地介紹・${esc(v.title)}</h3>
      <p class="vintro">${esc(v.intro)}</p>
      <div class="feat">${v.features.map((f) => `<div>${icon(f.icon)}${esc(f.text)}</div>`).join('')}</div>
      <details><summary class="muted" style="cursor:pointer;margin-top:12px;font-size:14px">入場流程與使用規則</summary>
        <h4>入場流程</h4><ol>${v.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        <h4>使用規則</h4><ul>${v.rules.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </details>
    </div>`;
}

/* ---------- 1. 地點 ---------- */
function renderLocations() {
  const box = $('#locations');
  box.innerHTML = '';
  for (const loc of state.cfg.locations) {
    const b = document.createElement('div');
    b.className = 'card loc' + (state.loc?.id === loc.id ? ' sel' : '');
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    const unit = loc.pricing === 'perRoom' ? '/ 間' : '/ 人';
    b.innerHTML = `
      <img src="${loc.image}" alt="">
      <div class="body">
        <h3><span></span><b>單時段 ${money(minPrice(loc))} 起 <small>${unit}</small></b></h3>
        <p class="desc"></p>
        <p>📍 <span class="addr"></span>　<a target="_blank" rel="noopener">查看地圖</a></p>
      </div>`;
    b.querySelector('h3 span').textContent = loc.name;
    b.querySelector('.desc').textContent = loc.desc;
    b.querySelector('.addr').textContent = loc.address;
    const a = b.querySelector('a');
    a.href = loc.mapUrl;
    a.addEventListener('click', (e) => e.stopPropagation());
    const pick = () => {
      if (state.loc?.id !== loc.id) {
        state.loc = loc;
        state.people = Math.min(state.people, loc.maxPeople);
        clearTime();
      }
      renderLocations();
      go(2);
      renderPriceTable();
      loadSlots();
    };
    b.addEventListener('click', pick);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
    box.appendChild(b);
  }
}

/* ---------- 2. 人數、日期、時段 ---------- */
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
  // 人數變多時，原本選的時段可能不夠位子
  state.sel = state.sel.filter((id) => fits(id));
  renderPeriods();
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
    const short = ids.map((id) => periodOf(id).name[0] === '下' ? '午' : periodOf(id).name[0]).join('+');
    html += row(`${ids.length === ps.length ? '全天' : '雙時段'}（${short}）`, v);
  }
  html += `<p class="unit">${unit}</p>`;
  $('#ptable').innerHTML = html;
}

async function loadSlots() {
  renderPeople();
  if (!state.date) { state.date = state.cfg.today; renderDates(); }
  const box = $('#periods');
  box.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await api(`/api/availability?location=${state.loc.id}&date=${state.date}`);
    if (data.date !== state.date || data.location !== state.loc.id) return;
    state.avail = data.periods;
    state.sel = state.sel.filter((id) => fits(id));
    renderPeriods();
  } catch (e) {
    box.innerHTML = '';
    showError(e.message);
  }
}

function fits(id) {
  const a = state.avail.find((x) => x.id === id);
  return !!a && !a.past && a.remaining >= units();
}

function renderPeriods() {
  const box = $('#periods');
  box.innerHTML = '';
  const ids = selected();
  for (const p of state.cfg.periods) {
    const a = state.avail.find((x) => x.id === p.id) || {};
    const ok = fits(p.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'period' + (ids.includes(p.id) ? ' sel' : '');
    b.disabled = !ok;
    const status = a.past ? '已結束' : !ok ? '額滿' : state.loc.pricing === 'perRoom' ? '可預約' : `剩 ${a.remaining} 位`;
    b.innerHTML = `${icon(p.icon)}<span class="n">${p.name}</span>
      <span class="p">$${state.loc.prices.single[p.id]}<small>${status}</small></span>
      <span class="t">${hh(p.start)} – ${hh(p.end)}</span>`;
    b.setAttribute('aria-pressed', ids.includes(p.id));
    b.addEventListener('click', () => togglePeriod(p.id));
    box.appendChild(b);
  }
  if (state.cfg.periods.every((p) => !fits(p.id))) {
    box.insertAdjacentHTML('beforeend', '<p class="muted" style="margin:4px 0 0">這天已經沒有可預約的時段，請換一天 🙏</p>');
  }
  renderCombo();
}

function renderCombo() {
  const ids = selected();
  const note = $('#comboNote');
  if (ids.length > 1) {
    const sum = ids.reduce((s, id) => s + state.loc.prices.single[id], 0);
    const price = unitPrice(state.loc, ids);
    const per = state.loc.pricing === 'perPerson' ? '每人' : '';
    note.innerHTML = `已套用<b>${periodLabel(ids)}方案${per} $${price}</b>${sum > price ? `，比分開買${per}省 $${sum - price}` : ''}`;
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
  $('#tIn').textContent = ids.length ? hh(periodOf(ids[0]).start) : '—';
  $('#tOut').textContent = ids.length ? hh(periodOf(ids[ids.length - 1]).end) : '—';
}

function togglePeriod(id) {
  const all = PIDS();
  let sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id];
  let idx = all.filter((x) => sel.includes(x)).map((x) => all.indexOf(x));
  // 取消中間的時段會斷開 → 只保留剛剛點的那一側
  if (idx.length > 1 && idx[idx.length - 1] - idx[0] + 1 !== idx.length) {
    if (!sel.includes(id)) {
      const cut = all.indexOf(id);
      sel = sel.filter((x) => all.indexOf(x) < cut);
    } else {
      // 早＋晚不連續 → 自動補成全天（中間時段要有空位）
      const fill = all.slice(idx[0], idx[idx.length - 1] + 1);
      if (fill.every(fits)) {
        sel = fill;
        flash(`早＋晚不連續，已幫你改成${periodLabel(fill)}方案`);
      } else {
        sel = [id];
        flash('時段需要連續，中間的時段已額滿，已改為只選這個時段');
      }
    }
  }
  state.sel = sel;
  renderPeriods();
  refreshBar();
}

function flash(msg) {
  showError(msg);
  clearTimeout(flash.t);
  flash.t = setTimeout(() => showError(''), 3000);
}
function clearTime() { state.sel = []; }

/* ---------- 3. 聯絡、發票 ---------- */
function pickInv(v) {
  state.invType = v;
  document.querySelectorAll('#invType button').forEach((b) => b.classList.toggle('sel', b.dataset.v === v));
  document.querySelectorAll('[data-inv]').forEach((d) => d.classList.toggle('hidden', d.dataset.inv !== v));
}

function collect() {
  return {
    lineIdToken: state.line?.idToken,
    location: state.loc.id,
    date: state.date,
    periods: selected(),
    people: state.people,
    customer: {
      name: $('#name').value.trim(),
      phone: $('#phone').value.trim(),
      email: $('#email').value.trim(),
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
}

function checkStep3() {
  const b = collect();
  if (!b.customer.name) return '請填寫姓名';
  if (b.customer.phone.replace(/\D/g, '').length < 8) return '請填寫正確的手機號碼';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.customer.email)) return '請填寫正確的 Email';
  const i = b.invoice;
  if (i.type === 'mobile' && !/^\/[0-9A-Z.+-]{7}$/i.test(i.carrier)) return '手機條碼格式為 / 開頭共 8 碼';
  if (i.type === 'company' && !/^\d{8}$/.test(i.taxId)) return '統一編號需為 8 碼數字';
  if (i.type === 'company' && !i.title) return '請填寫公司抬頭';
  if (i.type === 'donate' && !/^\d{3,7}$/.test(i.loveCode)) return '捐贈碼為 3–7 碼數字';
  try { localStorage.setItem('hj-contact', JSON.stringify(b.customer)); } catch {}
  return '';
}

/* ---------- 4. 確認、付款 ---------- */
function renderSummary() {
  const b = collect();
  const d = new Date(b.date + 'T00:00:00Z');
  const invText = { personal: '會員載具', mobile: '手機條碼 ' + b.invoice.carrier.toUpperCase(), company: `統編 ${b.invoice.taxId}`, donate: '捐贈 ' + b.invoice.loveCode }[b.invoice.type];
  const rows = [
    ['地點', state.loc.name],
    ['日期', `${b.date}（週${WEEK[d.getUTCDay()]}）`],
    ['時段', periodLabel(b.periods)],
    ['入場', hh(periodOf(b.periods[0]).start)],
    ['出場', hh(periodOf(b.periods[b.periods.length - 1]).end)],
    ['人數', `${b.people} 人`],
    ['姓名', b.customer.name],
    ['Email', b.customer.email],
    ['發票', invText],
  ];
  const dl = $('#summary');
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  $('#total').textContent = money(amount());
}

async function pay() {
  state.busy = true;
  refreshBar();
  $('#next').textContent = '處理中…';
  try {
    const r = await api('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect()),
    });
    submitToECPay(r.form);
  } catch (e) {
    state.busy = false;
    $('#next').textContent = '前往付款';
    refreshBar();
    showError(e.message);
    if (/額滿|訂走|已經過/.test(e.message)) { go(2); loadSlots(); }
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
    $('#brand').innerHTML = icon('leaf') + 'Hour Jungle';
    state.cfg = await api('/api/config');
    $('#holdMin').textContent = state.cfg.holdMinutes;
    try {
      const c = JSON.parse(localStorage.getItem('hj-contact') || 'null');
      if (c) { $('#name').value = c.name || ''; $('#phone').value = c.phone || ''; $('#email').value = c.email || ''; }
    } catch {}
    renderVenue();
    renderLocations();
    initLine(state.cfg.liffId).then((line) => {
      state.line = line;
      if (line && !$('#name').value) $('#name').value = line.name;
    });
    // QR code 可帶 ?loc=meeting 直接進到指定地點
    const pre = new URLSearchParams(location.search).get('loc');
    const loc = state.cfg.locations.find((l) => l.id === pre);
    renderDates();
    if (loc) { state.loc = loc; renderLocations(); go(2); renderPriceTable(); loadSlots(); }
    else go(1);
  } catch (e) {
    $('#locations').innerHTML = '';
    showError(e.message);
  }
})();
