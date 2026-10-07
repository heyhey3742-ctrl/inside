const $ = (s) => document.querySelector(s);
const state = {
  cfg: null, step: 1, loc: null, people: 1, date: null,
  slots: [], start: null, endSlot: null, invType: 'personal', busy: false,
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
function hours() {
  return state.start == null || state.endSlot == null ? 0 : state.endSlot + 1 - state.start;
}
function amount() {
  if (!state.loc) return 0;
  const h = hours() || 1;
  return state.loc.pricing === 'perRoom' ? state.loc.price * h : state.loc.price * h * state.people;
}

function refreshBar() {
  const next = $('#next');
  let ok = false;
  if (state.step === 1) ok = !!state.loc;
  else if (state.step === 2) ok = hours() > 0;
  else ok = true;
  next.disabled = !ok || state.busy;
  $('#price').textContent = money(amount());
  $('#priceLabel').textContent = state.loc
    ? (hours() ? `${hours()} 小時` : '每小時') + (state.loc.pricing === 'perPerson' ? ` × ${state.people} 人` : '')
    : '小計';
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
    const unit = loc.pricing === 'perRoom' ? '/ 小時' : '/ 人・小時';
    b.innerHTML = `
      <img src="${loc.image}" alt="">
      <div class="body">
        <h3><span></span><b>${money(loc.price)} <small>${unit}</small></b></h3>
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
    : `每人 ${money(state.loc.price)} / 小時，最多 ${state.loc.maxPeople} 人`;
}
function changePeople(d) {
  state.people = Math.max(1, Math.min(state.loc.maxPeople, state.people + d));
  renderPeople();
  // 人數變多時，原本選的時段可能不夠位子
  if (state.start != null && !rangeFits(state.start, state.endSlot)) clearTime();
  renderSlots();
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
  renderPeople();
  if (!state.date) { state.date = state.cfg.today; renderDates(); }
  const box = $('#slots');
  box.innerHTML = '<div class="spinner" style="grid-column:1/-1"></div>';
  try {
    const data = await api(`/api/availability?location=${state.loc.id}&date=${state.date}`);
    if (data.date !== state.date || data.location !== state.loc.id) return;
    state.slots = data.slots;
    renderSlots();
  } catch (e) {
    box.innerHTML = '';
    showError(e.message);
  }
}

const slotFits = (s) => !s.past && s.remaining >= units();
function slotAt(h) { return state.slots.find((s) => s.hour === h); }
function rangeFits(a, b) {
  for (let h = a; h <= b; h++) { const s = slotAt(h); if (!s || !slotFits(s)) return false; }
  return true;
}

function renderSlots() {
  const box = $('#slots');
  box.innerHTML = '';
  if (state.slots.every((s) => !slotFits(s))) {
    box.innerHTML = '<p class="muted" style="grid-column:1/-1;margin:0">這天已經沒有可預約的時段，請換一天 🙏</p>';
  }
  for (const s of state.slots.some(slotFits) ? state.slots : []) {
    const b = document.createElement('button');
    b.type = 'button';
    const ok = slotFits(s);
    let cls = 'slot';
    if (!ok) cls += ' full';
    if (state.start != null) {
      const end = state.endSlot ?? state.start;
      if (s.hour === state.start || s.hour === end) cls += ' edge';
      else if (s.hour > state.start && s.hour < end) cls += ' in';
    }
    b.className = cls;
    b.disabled = !ok;
    let sub = s.past ? '已過' : !ok ? '額滿' : state.loc.pricing === 'perRoom' ? '可預約' : `剩 ${s.remaining} 位`;
    b.innerHTML = `${hh(s.hour)}<small>${sub}</small>`;
    b.addEventListener('click', () => tapSlot(s.hour));
    box.appendChild(b);
  }
  $('#tIn').textContent = state.start != null ? hh(state.start) : '—';
  $('#tOut').textContent = state.endSlot != null ? hh(state.endSlot + 1) : '—';
}

function tapSlot(h) {
  // 第一下＝入場；第二下（較晚的時段）＝最後一個小時；再點就重新選
  if (state.start == null || state.endSlot !== state.start || h < state.start) {
    state.start = h; state.endSlot = h;
  } else if (h === state.start) {
    // 同一格再點一次：維持 1 小時
  } else if (rangeFits(state.start, h)) {
    state.endSlot = h;
  } else {
    state.start = h; state.endSlot = h;
    showError('中間有額滿的時段，已幫你從這個時間重新開始選');
    setTimeout(() => showError(''), 2500);
  }
  renderSlots();
  refreshBar();
}
function clearTime() { state.start = null; state.endSlot = null; }

/* ---------- 3. 聯絡、發票 ---------- */
function pickInv(v) {
  state.invType = v;
  document.querySelectorAll('#invType button').forEach((b) => b.classList.toggle('sel', b.dataset.v === v));
  document.querySelectorAll('[data-inv]').forEach((d) => d.classList.toggle('hidden', d.dataset.inv !== v));
}

function collect() {
  return {
    location: state.loc.id,
    date: state.date,
    start: state.start,
    end: state.endSlot + 1,
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
    ['入場', hh(b.start)],
    ['出場', hh(b.end)],
    ['時數', `${hours()} 小時`],
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
    state.cfg = await api('/api/config');
    $('#holdMin').textContent = state.cfg.holdMinutes;
    try {
      const c = JSON.parse(localStorage.getItem('hj-contact') || 'null');
      if (c) { $('#name').value = c.name || ''; $('#phone').value = c.phone || ''; $('#email').value = c.email || ''; }
    } catch {}
    renderLocations();
    // QR code 可帶 ?loc=meeting 直接進到指定地點
    const pre = new URLSearchParams(location.search).get('loc');
    const loc = state.cfg.locations.find((l) => l.id === pre);
    renderDates();
    if (loc) { state.loc = loc; renderLocations(); go(2); loadSlots(); }
    else go(1);
  } catch (e) {
    $('#locations').innerHTML = '';
    showError(e.message);
  }
})();
