import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMacValue, verify } from '../netlify/lib/ecpay.mjs';
import { encrypt, decrypt } from '../netlify/lib/invoice.mjs';

test('CheckMacValue 與綠界官方文件範例一致', () => {
  const params = {
    TradeDesc: '促銷方案',
    PaymentType: 'aio',
    MerchantTradeDate: '2023/03/12 15:30:23',
    MerchantTradeNo: 'ecpay20230312153023',
    MerchantID: '3002607',
    ReturnURL: 'https://www.ecpay.com.tw/receive.php',
    ItemName: 'Apple iphone 15',
    TotalAmount: '30000',
    ChoosePayment: 'ALL',
    EncryptType: '1',
  };
  const mac = checkMacValue(params, { hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' });
  assert.equal(mac, '6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840');
});

test('verify 會擋掉被竄改的資料', () => {
  const cfg = { hashKey: '5294y06JbISpM5x9', hashIV: 'v77hoKGq4kWxNNIS' };
  const p = { MerchantID: '2000132', RtnCode: '1', TradeAmt: '500', CustomField1: 'HJ123' };
  p.CheckMacValue = checkMacValue(p, cfg);
  assert.ok(verify(p, cfg));
  assert.ok(!verify({ ...p, TradeAmt: '1' }, cfg));
});

test('發票 AES 加解密可以還原', () => {
  const cfg = { hashKey: 'ejCk326UnaZWKisg', hashIV: 'q9jcZX8Ib9LM8wYk' };
  const data = { RelateNumber: 'HJ1', CustomerName: '鄭 小明 (測試)!', Items: [{ ItemName: '會議室 & 座位' }] };
  assert.deepEqual(decrypt(encrypt(data, cfg), cfg), data);
});
