// 把後端給的綠界參數，組成表單送出 → 跳到綠界刷卡頁
function submitToECPay(form) {
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = form.action;
  for (const [k, v] of Object.entries(form.params)) {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    f.appendChild(i);
  }
  document.body.appendChild(f);
  f.submit();
}
const money = (n) => 'NT$ ' + Number(n).toLocaleString('zh-TW');
// 24 以上代表隔天，例如 26 → 隔日 02:00
const hh = (h) => (h >= 24 ? '隔日 ' : '') + String(h % 24).padStart(2, '0') + ':00';
const hhShort = (h) => String(h % 24).padStart(2, '0');
