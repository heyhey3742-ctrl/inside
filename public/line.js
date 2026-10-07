// LINE LIFF：在 LINE 裡開啟時，自動取得客人的 LINE 身分
// 沒設定 LIFF_ID，或用一般瀏覽器開啟時，什麼都不做（網頁版照常可用）
async function initLine(liffId) {
  if (!liffId) return null;
  try {
    if (liffId === 'dev-mock') {
      // 本機測試用的假 LINE
      window.liff = {
        init: async () => {}, isInClient: () => true, isLoggedIn: () => true,
        getIDToken: () => 'test-U1234567890', getProfile: async () => ({ displayName: 'LINE 測試用戶' }),
      };
    } else {
      await new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
        s.onload = ok; s.onerror = fail;
        document.head.appendChild(s);
      });
    }
    await liff.init({ liffId });
    if (!liff.isInClient() && !liff.isLoggedIn()) return null;
    const idToken = liff.getIDToken();
    if (!idToken) return null;
    const profile = await liff.getProfile().catch(() => ({}));
    return { idToken, name: profile.displayName || '' };
  } catch (e) {
    console.warn('LINE 初始化失敗，改用一般網頁模式', e);
    return null;
  }
}
