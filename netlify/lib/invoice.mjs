// 綠界 B2C 電子發票：付款成功後開立，並寄發票通知信給客人
import crypto from 'node:crypto';
import { invoiceConfig } from './config.mjs';

// PHP urlencode 規則（綠界發票 API 指定）
function phpUrlEncode(s) {
  return encodeURIComponent(s)
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

export function encrypt(obj, { hashKey, hashIV }) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(hashKey), Buffer.from(hashIV));
  const plain = phpUrlEncode(JSON.stringify(obj));
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

export function decrypt(b64, { hashKey, hashIV }) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(hashKey), Buffer.from(hashIV));
  const text = Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(decodeURIComponent(text.replace(/\+/g, ' ')));
}

async function call(path, data, cfg) {
  const body = {
    MerchantID: cfg.merchantId,
    RqHeader: { Timestamp: Math.floor(Date.now() / 1000) },
    Data: encrypt({ MerchantID: cfg.merchantId, ...data }, cfg),
  };
  const res = await fetch(cfg.baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.TransCode !== 1) throw new Error(`發票 API 錯誤：${json.TransMsg}`);
  return decrypt(json.Data, cfg);
}

// 依客人選的發票類型，組出綠界需要的欄位
export function invoicePayload(order) {
  const inv = order.invoice || {};
  const c = order.customer;
  const base = {
    RelateNumber: order.id,
    CustomerID: '',
    CustomerIdentifier: '',
    CustomerName: c.name,
    CustomerAddr: '',
    CustomerPhone: c.phone,
    CustomerEmail: c.email,
    ClearanceMark: '',
    Print: '0',
    Donation: '0',
    LoveCode: '',
    CarrierType: '1', // 綠界會員載具（以 Email 歸戶）
    CarrierNum: '',
    TaxType: '1',
    SalesAmount: order.amount,
    InvoiceRemark: `預約編號 ${order.id}`,
    InvType: '07',
    vat: '1',
    Items: [{
      ItemSeq: 1,
      ItemName: order.itemName.slice(0, 100),
      ItemCount: 1,
      ItemWord: '式',
      ItemPrice: order.amount,
      ItemTaxType: '1',
      ItemAmount: order.amount,
    }],
  };
  if (inv.type === 'company') {
    // 打統編：不能用載具，須列印（綠界代存，客人可在信中下載）
    Object.assign(base, {
      CustomerIdentifier: inv.taxId,
      CustomerName: inv.title || c.name,
      CustomerAddr: inv.address || '台北市',
      Print: '1',
      CarrierType: '',
    });
  } else if (inv.type === 'mobile') {
    Object.assign(base, { CarrierType: '3', CarrierNum: inv.carrier });
  } else if (inv.type === 'donate') {
    Object.assign(base, { Donation: '1', LoveCode: inv.loveCode, CarrierType: '' });
  }
  return base;
}

export async function issueInvoice(order) {
  const cfg = invoiceConfig();
  if (!cfg.enabled) return { skipped: true };
  const r = await call('/B2CInvoice/Issue', invoicePayload(order), cfg);
  if (r.RtnCode !== 1) throw new Error(`開立發票失敗：${r.RtnMsg}`);
  // 主動寄送發票開立通知 Email
  try {
    await call('/B2CInvoice/InvoiceNotify', {
      InvoiceNo: r.InvoiceNo,
      NotifyMail: order.customer.email,
      Notify: 'E',
      InvoiceTag: 'I',
      Notified: 'C',
    }, cfg);
  } catch (e) {
    console.error('發票通知信寄送失敗', e);
  }
  return { invoiceNo: r.InvoiceNo, invoiceDate: r.InvoiceDate, randomNumber: r.RandomNumber };
}
