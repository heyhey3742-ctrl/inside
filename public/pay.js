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
const hh = (h) => String(h).padStart(2, '0') + ':00';
