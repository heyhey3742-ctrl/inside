// LINE：驗證 LIFF 登入身分、推播訊息
import { lineConfig, BRAND as SITE_BRAND } from './config.mjs';

// 用 LIFF 給的 ID token 向 LINE 確認是誰（避免有人假冒別人的 LINE ID）
export async function verifyIdToken(idToken) {
  const cfg = lineConfig();
  if (!cfg.loginEnabled || !idToken) return null;
  const res = await fetch(`${cfg.apiBase}/oauth2/v2.1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: String(idToken), client_id: cfg.loginChannelId }),
  });
  if (!res.ok) {
    console.error('LINE id token 驗證失敗', res.status, await res.text().catch(() => ''));
    return null;
  }
  const d = await res.json();
  return d.sub ? { userId: d.sub, name: d.name || '' } : null;
}

export async function push(to, messages) {
  const cfg = lineConfig();
  if (!cfg.pushEnabled || !to) return false;
  try {
    const res = await fetch(`${cfg.apiBase}/v2/bot/message/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify({ to, messages }),
    });
    if (!res.ok) console.error('LINE 推播失敗', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('LINE 推播失敗', e);
    return false;
  }
}

const BRAND = SITE_BRAND.theme.brand.toUpperCase();
const hh = (h) => (h >= 24 ? '隔日 ' : '') + String(h % 24).padStart(2, '0') + ':00';
const row = (k, v) => ({
  type: 'box', layout: 'horizontal', contents: [
    { type: 'text', text: k, size: 'sm', color: '#8A7F78', flex: 2 },
    { type: 'text', text: v, size: 'sm', color: '#2B2522', flex: 5, wrap: true, align: 'end' },
  ],
});
const button = (label, uri, primary = true) => ({
  type: 'button', style: primary ? 'primary' : 'link', color: primary ? BRAND : undefined, height: 'sm',
  action: { type: 'uri', label, uri },
});

// 付款成功：入場密碼卡片
export function accessMessage({ order, group, origin }) {
  return {
    type: 'flex',
    altText: `入場密碼 ${order.access.code}（${order.date} ${hh(group.start)}–${hh(group.end)}）`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: BRAND, paddingAll: '20px', contents: [
          { type: 'text', text: '入場密碼', color: '#FFFFFFCC', size: 'sm', align: 'center' },
          { type: 'text', text: order.access.code.split('').join(' '), color: '#FFFFFF', size: '3xl', weight: 'bold', align: 'center' },
          { type: 'text', text: `${order.date}　${hh(group.start)} – ${hh(group.end)}`, color: '#FFFFFF', size: 'sm', align: 'center', margin: 'md' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: order.extendOf ? '加訂成功，密碼不變 ✅' : '預約成功 ✅', weight: 'bold', size: 'md' },
          row('地點', order.locationName),
          row('時段', `${order.slotLabel}（${hh(order.start)}–${hh(order.end)}）`),
          row('人數', `${order.people} 人`),
          row('金額', `NT$ ${order.amount.toLocaleString('zh-TW')}`),
          row('編號', order.id),
          { type: 'text', text: '到現場在門口輸入密碼即可入場', size: 'xs', color: '#8A7F78', margin: 'md', wrap: true },
        ],
      },
      footer: { type: 'box', layout: 'vertical', contents: [button('查看預約', `${origin}/success.html?id=${order.id}`)] },
    },
  };
}

// 預約確認（沒有入場密碼的網站，例如 HJ 會議室、諮詢）
export function confirmMessage({ order, origin }) {
  const consult = order.mode === 'consult';
  return {
    type: 'flex',
    altText: `預約成功：${order.locationName} ${order.date} ${hh(order.start)}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: BRAND, paddingAll: '18px', contents: [
          { type: 'text', text: '預約成功 ✅', color: '#FFFFFF', size: 'lg', weight: 'bold' },
          { type: 'text', text: order.locationName, color: '#FFFFFFDD', size: 'sm', wrap: true },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          row('日期', order.date),
          row('時間', order.slotLabel),
          ...(consult ? [row('項目', order.topic || '')] : [row('人數', `${order.people} 人`), row('金額', `NT$ ${order.amount.toLocaleString('zh-TW')}`)]),
          row('編號', order.id),
          { type: 'text', text: consult ? '專人會在預約前與你聯繫確認' : '當天請直接到館，報上姓名即可', size: 'xs', color: '#8A7F78', margin: 'md', wrap: true },
        ],
      },
      footer: { type: 'box', layout: 'vertical', contents: [button('查看預約', `${origin}/success.html?id=${order.id}`)] },
    },
  };
}

// 時段快結束：提醒加訂
export function reminderMessage({ order, group, next, origin }) {
  const text = next?.available
    ? `你的時段 ${hh(group.end)} 結束，要加訂${next.name}（${hh(next.start)}–${hh(next.end)}）嗎？密碼不變，NT$ ${next.amount.toLocaleString('zh-TW')}（單獨計費）。`
    : `你的時段 ${hh(group.end)} 結束，離場前記得帶走個人物品，謝謝光臨！`;
  return {
    type: 'flex',
    altText: '時段快結束囉',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: '⏰ 時段快結束囉', weight: 'bold', size: 'lg', color: BRAND },
          { type: 'text', text, wrap: true, size: 'sm', color: '#2B2522' },
        ],
      },
      footer: next?.available
        ? { type: 'box', layout: 'vertical', contents: [button(`加訂${next.name}`, `${origin}/success.html?id=${order.id}`)] }
        : undefined,
    },
  };
}
