/**
 * 乙級職安題庫系統 — Google Sheets 後端 API
 * 
 * 將此程式碼貼到你的 Google Sheet 的 Apps Script 編輯器中
 * （擴充功能 > Apps Script），然後部署為網頁應用程式。
 */

// ====== 資料表結構 ======
// 自動建立的 Sheet 名稱：users
// 欄位：A=email, B=passwordHash, C=token, D=wrongBook(JSON), E=progress(JSON), F=lastUpdate

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    switch(action) {
      case 'register':
        return json(handleRegister(data));
      case 'login':
        return json(handleLogin(data));
      case 'getData':
        return json(handleGetData(data));
      case 'saveWrongBook':
        return json(handleSaveWrongBook(data));
      case 'saveProgress':
        return json(handleSaveProgress(data));
      default:
        return json({ success: false, error: '未知的操作: ' + action });
    }
  } catch(err) {
    return json({ success: false, error: '伺服器錯誤: ' + err.toString() });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====== 初始化 Sheet ======
function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('users');
  if (!sheet) {
    sheet = ss.insertSheet('users');
    sheet.appendRow(['email', 'passwordHash', 'token', 'wrongBook', 'progress', 'lastUpdate']);
  }
  return sheet;
}

// ====== 簡易雜湊（非加密等級，但避免明文密碼）======
function hashPassword(password) {
  var hash = 0;
  var str = password + 'osh_salt_2024';
  for (var i = 0; i < str.length; i++) {
    var char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// ====== 產生 Token ======
function generateToken(email) {
  return Utilities.getUuid() + '_' + new Date().getTime();
}

// ====== 處理註冊 ======
function handleRegister(data) {
  var email = (data.email || '').toLowerCase().trim();
  var password = data.password || '';

  if (!email || !password) return { success: false, error: '請填寫信箱和密碼' };
  if (password.length < 6) return { success: false, error: '密碼至少需要6碼' };

  var sheet = getSheet();
  var existing = findRowByEmail(email);

  if (existing) return { success: false, error: '此信箱已註冊' };

  var token = generateToken(email);
  sheet.appendRow([
    email,
    hashPassword(password),
    token,
    '[]',      // wrongBook
    '{}',      // progress
    new Date().toISOString()
  ]);

  return { success: true, token: token };
}

// ====== 處理登入 ======
function handleLogin(data) {
  var email = (data.email || '').toLowerCase().trim();
  var password = data.password || '';

  if (!email || !password) return { success: false, error: '請填寫信箱和密碼' };

  var row = findRowByEmail(email);
  if (!row) return { success: false, error: '找不到此帳號' };

  var sheet = getSheet();
  var storedHash = sheet.getRange(row, 2).getValue();
  if (hashPassword(password) !== storedHash) {
    return { success: false, error: '密碼錯誤' };
  }

  var token = generateToken(email);
  sheet.getRange(row, 3).setValue(token);  // 更新 token
  sheet.getRange(row, 6).setValue(new Date().toISOString());

  return { success: true, token: token };
}

// ====== 取得使用者資料 ======
function handleGetData(data) {
  var row = findRowByToken(data.token);
  if (!row) return { success: false, error: '登入已過期，請重新登入' };

  var sheet = getSheet();
  return {
    success: true,
    data: {
      email: sheet.getRange(row, 1).getValue(),
      wrongBook: sheet.getRange(row, 4).getValue(),
      progress: sheet.getRange(row, 5).getValue()
    }
  };
}

// ====== 儲存錯題本 ======
function handleSaveWrongBook(data) {
  var row = findRowByToken(data.token);
  if (!row) return { success: false, error: '登入已過期' };

  var sheet = getSheet();
  sheet.getRange(row, 4).setValue(data.wrongBook || '[]');
  sheet.getRange(row, 6).setValue(new Date().toISOString());

  return { success: true };
}

// ====== 儲存進度 ======
function handleSaveProgress(data) {
  var row = findRowByToken(data.token);
  if (!row) return { success: false, error: '登入已過期' };

  var sheet = getSheet();
  sheet.getRange(row, 5).setValue(data.progress || '{}');
  sheet.getRange(row, 6).setValue(new Date().toISOString());

  return { success: true };
}

// ====== 工具函式 ======
function findRowByEmail(email) {
  var sheet = getSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === email) return i + 1;
  }
  return 0;
}

function findRowByToken(token) {
  if (!token) return 0;
  var sheet = getSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] === token) return i + 1;
  }
  return 0;
}
