# Hour Jungle 線上預約系統

客人用手機掃 QR code → 選地點 → 選人數、日期、入場／出場時段 → 綠界刷卡 → 付款成功自動開電子發票並寄 Email。付款失敗會跳到失敗頁，可以一鍵重新付款。

## 頁面

| 網址 | 用途 |
|---|---|
| `/` | 預約首頁（客人用） |
| `/?loc=meeting` | 直接進到「會議室」預約 |
| `/success.html` | 付款成功頁 |
| `/fail.html` | 付款失敗頁（可重新付款） |
| `/admin.html` | 後台：看訂單、營收、補開發票 |
| `/qr.html` | 產生並列印 QR code |

## 部署到 Netlify（只要做一次）

1. 登入 [Netlify](https://app.netlify.com)，點 **Add new site → Import an existing project → GitHub**
2. 選 `inside` 這個 repo，分支選這次的開發分支（之後合併到 main 就選 main）
3. 設定會自動帶入（來自 `netlify.toml`），直接按 **Deploy**
4. 到 **Site configuration → Environment variables** 新增：

| 名稱 | 說明 | 測試階段 |
|---|---|---|
| `ADMIN_PASSWORD` | 後台密碼 | **必填**，自己設一組 |
| `ECPAY_ENV` | `stage`＝測試，`prod`＝正式 | 先不用填 |
| `ECPAY_MERCHANT_ID` | 綠界商店代號 | 先不用填 |
| `ECPAY_HASH_KEY` | 綠界金流 HashKey | 先不用填 |
| `ECPAY_HASH_IV` | 綠界金流 HashIV | 先不用填 |
| `INVOICE_MERCHANT_ID` | 綠界發票商店代號（通常同上） | 先不用填 |
| `INVOICE_HASH_KEY` | 綠界發票 HashKey（跟金流的不一樣） | 先不用填 |
| `INVOICE_HASH_IV` | 綠界發票 HashIV | 先不用填 |
| `INVOICE_ENABLED` | 填 `false` 可暫停自動開發票 | 先不用填 |

沒填綠界的值時，會自動使用**綠界官方測試帳號**，不會真的扣款。

5. 加完環境變數後，到 **Deploys → Trigger deploy** 重新部署一次

### 測試刷卡

綠界測試環境可用測試卡號 `4311-9522-2222-2222`，有效期限填未來的月／年，安全碼 `222`，簡訊驗證碼依綠界頁面提示填寫。

### 正式上線

1. 到綠界廠商後台取得**正式**的金流與發票 MerchantID／HashKey／HashIV
2. 在 Netlify 填入上面的環境變數，並把 `ECPAY_ENV` 設為 `prod`
3. 重新部署，到 `/qr.html` 印出 QR code

## 修改場地、價格、時段

全部在 `netlify/lib/config.mjs`：營業時間、可預約天數、保留時間、地點名稱、介紹、價格、容量。

- `pricing: 'perRoom'`：整間包場，每小時固定價，同時段只能一組
- `pricing: 'perPerson'`：按人頭計價，`capacity` 是同時段最多幾位

## 本機測試（工程師用）

```bash
npm install
npm test        # 綠界簽章、發票加密測試
npm run dev     # http://localhost:8888，內建「假綠界」可模擬付款成功／失敗，後台密碼 admin
```
