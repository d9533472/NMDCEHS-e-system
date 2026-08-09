# Google Sheets 雲端同步設定指南

## 為什麼用 Google Sheets？

你熟悉的環境，直接打開試算表就能看到所有使用者的錯題本、作答進度。免費、直覺、好管理。

## 設定步驟（約 5 分鐘）

### 1. 建立新的 Google Sheet

1. 打開 https://sheets.google.com 新增一個空白試算表
2. 隨便取個名字，例如「乙級職安題庫資料庫」

### 2. 貼入 Apps Script 程式碼

1. 在試算表上方選單點「**擴充功能** > **Apps Script**」
2. 會打開一個新的編輯器頁面
3. 把左邊 `Code.gs` 裡的內容全部清掉
4. 打開這個專案裡的 `apps-script/Code.gs`，把全部內容貼進去
5. 點上方的「**儲存**」圖示（或按 Ctrl+S）

### 3. 部署為網頁應用程式

1. 點右上角「**部署** > **新增部署**」
2. 左邊齒輪選「**網頁應用程式**」
3. 填入描述（例如「題庫API」）
4. 「**以您的身分執行**」— 選你自己
5. 「**誰可以存取**」— 選「**任何人**」
6. 點「**部署**」
7. 第一次會要求授權，點「允許」
8. 複製出現的「**網頁應用程式網址**」（以 `script.google.com` 開頭的那個）

### 4. 填入設定值

打開 `js/sheets-config.js`，把 `???` 換成剛才複製的網址：

```javascript
const SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

### 5. 完成！

重新打開網站，登入視窗會顯示「☁️ 雲端同步已啟用（Google Sheets）」，即可註冊帳號使用。

## 你的 Google Sheet 會長這樣

| email | passwordHash | token | wrongBook | progress | lastUpdate |
|---|---|---|---|---|---|
| test@gmail.com | a1b2c3d4 | xxx-yyy | ["U01_Q03","U05_Q12"] | {"U01":{"answered":50,...}} | 2024-08-09T12:00:00Z |

- `wrongBook` 和 `progress` 是 JSON 格式，直接存成一個字串
- 你可以在 Sheet 裡直接看到每個使用者的錯題和進度
- 如果想手動修改資料也可以，直接改格子內容即可（但要注意 JSON 格式正確）

## 運作方式

- **註冊**：Email + 密碼寫入 Sheet，密碼會雜湊處理（不明文儲存）
- **登入**：驗證後發給 token，後續操作靠 token 識別
- **錯題本**：答錯時自動存到 Sheet，登入時自動載入
- **作答進度**：完成測驗後自動同步
- **離線模式**：如果沒設定，系統自動退回 localStorage 本機模式，功能不受影響

## 注意事項

- Google Apps Script 免費額度很夠用（每天 20,000 次請求）
- 密碼有做雜湊處理，不會明文儲存在 Sheet 裡
- 部署時要選「任何人」才能讓網站呼叫，但只有正確的 token 才能讀寫資料
- 如果修改了 Apps Script 程式碼，要重新部署（部署 > 管理部署 > 編輯 > 版本選「新版本」）
