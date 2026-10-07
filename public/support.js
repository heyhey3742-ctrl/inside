// 「聯絡客服」：有設定 LINE_OA_ID 才會出現，點了直接開 LINE 官方帳號聊天
fetch('/api/config').then((r) => r.json()).then((c) => {
  if (!c.supportUrl) return;
  const a = document.createElement('a');
  a.href = c.supportUrl;
  a.className = 'support';
  a.innerHTML = '💬 有問題？聯絡客服';
  const footer = document.querySelector('footer') || document.querySelector('.wrap');
  footer.parentNode.insertBefore(a, footer);
}).catch(() => {});
