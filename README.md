# Hour Jungle 線上預約系統

客人用手機掃 QR code → 看場地介紹 → 選地點 → 選人數、日期、早／中／晚時段 → 綠界刷卡 → 付款成功立即取得**入場密碼**，並自動開電子發票寄 Email。付款失敗會跳到失敗頁，可以一鍵重新付款。

## 時段計費

| 方案 | 每人 |
|---|---|
| 早上 07–12 | $130 |
| 下午 12–18 | $180 |
| 晚上 18–隔日 02 | $160 |
| 雙時段（早＋午）| $250 |
| 雙時段（午＋晚）| $250 |
| 全天（早＋午＋晚）| $300 |

- 早＋晚不連續，系統會自動改成全天方案
- 時段結束前都能預約（現場掃碼可直接訂當下時段）

## 入場密碼與加訂

- 付款成功後立即產生 6 位數入場密碼，顯示在成功頁，後台也看得到
- 成功頁有「加訂下一個時段」按鈕：**沿用同一組密碼，但單獨計費，不套用多時段優惠**（例：早上 $130 ＋ 加訂下午 $180 ＝ $310）
- 同一支手機、同一天、同場地、時間相連的預約，也會自動沿用同一組密碼
- 客人可在 `/my.html` 用「預約編號＋手機末三碼」找回密碼
- ⚠️ 目前密碼尚未連動電子鎖，需串接門禁廠商 API 後才會自動生效

## 頁面

| 網址 | 用途 |
|---|---|
| `/` | 預約首頁（客人用） |
| `/?loc=meeting` | 直接進到「會議室」預約 |
| `/success.html` | 付款成功頁 |
| `/fail.html` | 付款失敗頁（可重新付款） |
| `/my.html` | 客人查詢預約與入場密碼 |
| `/admin.html` | 後台：看訂單、入場密碼、營收、補開發票 |
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

全部在 `netlify/lib/config.mjs`：

- `VENUE`：首頁「場地介紹」的文字、照片、設備、入場流程、規則
- `PERIODS`：三個時段的名稱與時間
- `LOCATIONS`：地點、介紹、各時段與組合價格、容量
  - `pricing: 'perPerson'`：每人計價，`capacity` 是每個時段最多幾個座位
  - `pricing: 'perRoom'`：整間包場，同時段只能一組（會議室目前為示意價格）

首頁頂部背景照片：放一張 `public/img/hero.jpg` 就會自動顯示。

## 本機測試（工程師用）

```bash
npm install
npm test        # 綠界簽章、發票加密測試
npm run dev     # http://localhost:8888，內建「假綠界」可模擬付款成功／失敗，後台密碼 admin
```
