// ============================================
// Google Sheets 同步設定
// ============================================
// 
// 使用前請先完成以下步驟（詳見 SHEETS_SETUP.md）：
//
// 1. 建立一個 Google Sheet
// 2. 點「擴充功能 > Apps Script」
// 3. 把 apps-script/Code.gs 的內容貼進去，存檔
// 4. 點「部署 > 新增部署 > 網頁應用程式」
// 5. 存取權選「任何人」
// 6. 複製部署後的網址，貼到下方
//
// ============================================

const SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwMh9G11p7kLWj3YXlo_m-hLzdLP6EZQpP973V-vkS7H_fUtkLElU-hLfpn4YIE45LX/exec";  // 貼上你的 Apps Script 網頁應用程式網址

window.sheetsConfig = { url: SHEETS_WEB_APP_URL };
