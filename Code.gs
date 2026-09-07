// ===== Environmental E-System — Code.gs v5 (split storage + device stats + visitor log) =====
// Google Sheet ID: 12GwWG_gqqb0A-a8GN5yfUEyRIfrZqDA7VGz1GoiBup0
// 資料表名稱: Data
// 每類資料存在不同儲存格，更穩定可擴展
//
// v4 變更：
//   - 新增 ?action=deviceStats（設備分布統計）
//   - ?action=incVisits 會同時記錄 os / browser / form 三個參數到「DeviceStats」工作表
//   - incVisits / incLinkClick 的 Lock 改成 try/finally，避免例外時鎖沒釋放
//
// v5 變更：
//   - ?action=incVisits 多接收 vid（瀏覽器訪客代號）與 ip（前端用 ipify 查到的公網 IP）
//     寫入「Visitors」工作表，每個訪客代號一列（id / ip / os / browser / form / count / firstSeen / lastSeen）
//   - 新增 ?action=visitorList（回傳訪客清單，前端只在編輯者登入後才會呼叫）

var SHEET_ID   = '12GwWG_gqqb0A-a8GN5yfUEyRIfrZqDA7VGz1GoiBup0';
var SHEET_NAME = 'Data';
var NCR_SHEET_ID = '1t_3RwuZS8--9JA_HUKEBTLV7hFih5WvxLb5B2WXhvDE';
var NCR_SYNC_SHEET = 'SyncData';

// 設備統計工作表名稱（與 Data 同一份試算表，第一次呼叫會自動建立）
var DEVICE_SHEET_NAME = 'DeviceStats';

// 訪客清單工作表名稱（與 Data 同一份試算表，第一次呼叫會自動建立）
var VISITOR_SHEET_NAME = 'Visitors';
// 訪客清單最多回傳幾筆（依最後造訪時間排序）
var VISITOR_LIST_LIMIT = 300;

// 排班工具通行碼（選填；留空 = 不驗證）
var ROSTER_TOKEN = '';

// 資料儲存格對應表（key = JS 變數名稱，必須與前端一致）
var STORAGE = {
  parts:             'A1',
  tasks:             'A2',
  bulletins:         'A3',
  archivedBulletins: 'A4',
  documents:         'A5',
  sections:          'A6',
  scheduleData:      'A7',
  events:            'A8',
  otRecords:         'A9',
  leaveRecords:      'A10',
  schedule:          'A11',
  schMonths:         'A12',
  hiddenTabs:        'A13',
  docNotes:          'A14',
  docLastUpdated:    'A15',
  rosterData:        'A16',
  eventTypes:        'A17',
  vessels:           'A18',
};
var LAST_SYNC_CELL = 'B1';
var VISITS_CELL = 'B2';
var DAILY_VISITS_CELL = 'B3'; // JSON: {"2026-08-05":12,"2026-08-06":18,...}
var LINK_CLICKS_CELL = 'B4';  // JSON: {"linkId_or_url": {name:"...", count:12, lastClick:"..."}}

// ── 人員 Email 對照表 ──
var EMAILS = {
  'Paul':       'paul.tong@nmdc-group.com',
  'Raymond':    'Raymond.huang@nmdc-group.com',
  'Sean':       'Sean.chu@nmdc-group.com',
  'Jacqueline': 'Jacqueline.Peng@nmdc-group.com'
};

// ─────────────────────────────────────────
// Sheet helper
// ─────────────────────────────────────────
function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────
// 讀取所有資料（從多個儲存格組合成一個物件）
// ─────────────────────────────────────────
function getAllData() {
  var sheet = getSheet();
  var range = sheet.getRange('A1:A18').getValues();
  var data = {};
  var keys = Object.keys(STORAGE);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var raw = range[i][0];
    if (!raw) {
      // 預設值
      data[key] = (key === 'docNotes' || key === 'docLastUpdated') ? ''
                  : (key === 'scheduleData' || key === 'otRecords' || key === 'leaveRecords' || key === 'rosterData') ? {}
                  : [];
      continue;
    }
    if (typeof raw === 'string') {
      try { data[key] = JSON.parse(raw); }
      catch(e) {
        data[key] = (key === 'docNotes' || key === 'docLastUpdated') ? String(raw) : null;
      }
    } else {
      data[key] = raw; // 數字或其他直接值
    }
  }
  return data;
}

// ─────────────────────────────────────────
// 儲存所有資料（拆開存到不同儲存格）
// ─────────────────────────────────────────
function saveAllData(payload) {
  var sheet = getSheet();
  var keys = Object.keys(STORAGE);
  var updates = [];

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = payload[key];
    var serialized;
    if (val === undefined || val === null) {
      serialized = '';
    } else if (typeof val === 'string') {
      serialized = val;
    } else {
      serialized = JSON.stringify(val);
    }
    updates.push([serialized]);
  }

  // 批次寫入 A1:A18
  sheet.getRange('A1:A18').setValues(updates);
  sheet.getRange(LAST_SYNC_CELL).setValue(new Date().toLocaleString('zh-TW'));
  return { ok: true, savedKeys: keys.length };
}

// ─────────────────────────────────────────
// GET — 回傳整個 data 物件
// ─────────────────────────────────────────
// Bulletin 圖片資料夾 (第一次執行會自動建立)
var BULLETIN_IMG_FOLDER_ID = '';
var VESSEL_ATTACH_ROOT_ID = '1oFllo_zNxw3cMQU2C78kLcsZncHhLcLu';

// 一次性授權：執行這個函式來授權 Drive 存取權限
function authorizeDrive() {
  var root = DriveApp.getFolderById(VESSEL_ATTACH_ROOT_ID);
  Logger.log('✅ Drive 授權成功！資料夾: ' + root.getName());
}

function getOrCreateBulFolder() {
  if (BULLETIN_IMG_FOLDER_ID) {
    try { return DriveApp.getFolderById(BULLETIN_IMG_FOLDER_ID); } catch(e){}
  }
  var folders = DriveApp.getFoldersByName('EHS-Bulletin-Images');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('EHS-Bulletin-Images');
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || null;

  // action=findVesselFile → 根據子資料夾+檔名查 URL
  if (action === 'findVesselFile') {
    try {
      var folderName = e.parameter.folder;
      var fileName = e.parameter.name;
      if (!folderName || !fileName) throw new Error('Missing folder or name');
      var root = DriveApp.getFolderById(VESSEL_ATTACH_ROOT_ID);
      var subs = root.getFoldersByName(folderName);
      if (!subs.hasNext()) throw new Error('子資料夾不存在');
      var sub = subs.next();
      var files = sub.getFilesByName(fileName);
      if (!files.hasNext()) throw new Error('檔案還在上傳中');
      var file = files.next();
      var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
      return jsonOut_({ok:true, url:url, id:file.getId()});
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=findImage → 根據檔名查 URL
  if (action === 'findImage') {
    try {
      var name = e.parameter.name;
      if (!name) throw new Error('No filename');
      var folder = getOrCreateBulFolder();
      var files = folder.getFilesByName(name);
      if (!files.hasNext()) throw new Error('圖片還在上傳中');
      var file = files.next();
      var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
      return jsonOut_({ok:true, url:url});
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=lastImage → 回傳資料夾最新一張圖片的 URL
  if (action === 'lastImage') {
    try {
      var folder = getOrCreateBulFolder();
      var files = folder.getFiles();
      var latest = null;
      while (files.hasNext()) {
        var f = files.next();
        if (!latest || f.getDateCreated() > latest.getDateCreated()) latest = f;
      }
      if (!latest) throw new Error('No image found');
      var url = 'https://drive.google.com/uc?export=view&id=' + latest.getId();
      return jsonOut_({ok:true, url:url, id:latest.getId()});
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=expiring → 從改善單 Sheet 讀取即將到期資料
  if (action === 'expiring') {
    try {
      var days = parseInt(e.parameter.days || '7', 10);
      var result = getNcrExpiring(days);
      return jsonOut_(result);
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=visits → 讀取瀏覽人次
  if (action === 'visits') {
    try {
      var sheet = getSheet();
      var v = sheet.getRange(VISITS_CELL).getValue() || 0;
      return jsonOut_({ok:true, visits: Number(v)});
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=incVisits → 增加一次瀏覽人次並回傳新值 + 每日統計 + 設備統計
  // 前端會帶 &os=Windows&browser=Chrome&form=電腦 三個參數
  if (action === 'incVisits') {
    try {
      var sheet = getSheet();
      var next = 0;
      var lock = LockService.getScriptLock();
      lock.tryLock(3000);
      try {
        // 總次數 +1
        var cur = Number(sheet.getRange(VISITS_CELL).getValue() || 0);
        next = cur + 1;
        sheet.getRange(VISITS_CELL).setValue(next);
        // 每日統計
        var dailyRaw = sheet.getRange(DAILY_VISITS_CELL).getValue();
        var daily = {};
        if (dailyRaw) { try { daily = JSON.parse(dailyRaw); } catch(e2) {} }
        var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
        daily[today] = (daily[today] || 0) + 1;
        // 只保留最近 90 天
        var keys = Object.keys(daily).sort();
        if (keys.length > 90) {
          for (var i = 0; i < keys.length - 90; i++) delete daily[keys[i]];
        }
        sheet.getRange(DAILY_VISITS_CELL).setValue(JSON.stringify(daily));
      } finally {
        try { lock.releaseLock(); } catch(e3) {}
      }
      // 設備統計（獨立上鎖；失敗不影響人次計數的回傳）
      try { recordDevice_(e.parameter); } catch(e4) { Logger.log('recordDevice_ error: ' + e4.message); }
      // 訪客清單（獨立上鎖；失敗不影響人次計數的回傳）
      try { recordVisitor_(e.parameter); } catch(e5) { Logger.log('recordVisitor_ error: ' + e5.message); }
      return jsonOut_({ok:true, visits: next});
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=dailyVisits → 回傳每日統計 JSON
  if (action === 'dailyVisits') {
    try {
      var sheet = getSheet();
      var raw = sheet.getRange(DAILY_VISITS_CELL).getValue();
      var daily = {};
      if (raw) { try { daily = JSON.parse(raw); } catch(e) {} }
      return jsonOut_({ok:true, daily: daily});
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=deviceStats → 回傳設備分布 { ok, since, devices:{form, os, browser, combo} }
  if (action === 'deviceStats') {
    try {
      return jsonOut_(getDeviceStats_());
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=visitorList → 回傳訪客清單 { ok, total, visitors:[{id, ip, os, browser, form, count, firstSeen, lastSeen}] }
  if (action === 'visitorList') {
    try {
      return jsonOut_(getVisitorList_());
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=incLinkClick → 記錄外部連結點擊 (params: id, name, url)
  if (action === 'incLinkClick') {
    try {
      var sheet = getSheet();
      var count = 0;
      var lock = LockService.getScriptLock();
      lock.tryLock(3000);
      try {
        var raw = sheet.getRange(LINK_CLICKS_CELL).getValue();
        var clicks = {};
        if (raw) { try { clicks = JSON.parse(raw); } catch(e) {} }
        var linkId = e.parameter.id || e.parameter.url || 'unknown';
        var linkName = e.parameter.name || linkId;
        var linkUrl = e.parameter.url || '';
        if (!clicks[linkId]) clicks[linkId] = { name: linkName, url: linkUrl, count: 0, firstClick: '' };
        clicks[linkId].count = (clicks[linkId].count || 0) + 1;
        clicks[linkId].name = linkName;
        clicks[linkId].url = linkUrl;
        clicks[linkId].lastClick = new Date().toISOString();
        if (!clicks[linkId].firstClick) clicks[linkId].firstClick = clicks[linkId].lastClick;
        sheet.getRange(LINK_CLICKS_CELL).setValue(JSON.stringify(clicks));
        count = clicks[linkId].count;
      } finally {
        try { lock.releaseLock(); } catch(e3) {}
      }
      return jsonOut_({ok:true, count: count});
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // action=linkClicks → 回傳所有外部連結點擊統計
  if (action === 'linkClicks') {
    try {
      var sheet = getSheet();
      var raw = sheet.getRange(LINK_CLICKS_CELL).getValue();
      var clicks = {};
      if (raw) { try { clicks = JSON.parse(raw); } catch(e) {} }
      return jsonOut_({ok:true, clicks: clicks});
    } catch(err) {
      return jsonOut_({ok:false, error:err.message});
    }
  }

  // 預設：回傳全部資料
  try {
    var data = getAllData();
    return jsonOut_(data);
  } catch(err) {
    return jsonOut_({error:err.message});
  }
}

// ─────────────────────────────────────────
// POST — 儲存資料
// ─────────────────────────────────────────
function doPost(e) {
  try {
    var contents = (e.postData && e.postData.contents) ? e.postData.contents : null;
    if (!contents) throw new Error('e.postData.contents is null');
    var payload = JSON.parse(contents);
    if (payload.action === 'uploadImage')     return uploadBulletinImage(payload);
    if (payload.action === 'uploadVesselFile') return uploadVesselFile_(payload);
    if (payload.action === 'findVesselFile')   return findVesselFile_(payload);
    if (payload.action === 'publishRoster')   return handlePublishRoster_(payload);
    if (payload.action === 'saveRosterState') return saveRosterState_(payload);
    if (payload.action === 'loadRosterState') return loadRosterState_(payload);
    var result = saveAllData(payload);
    return jsonOut_(result);
  } catch(err) {
    Logger.log('doPost error: ' + err.message);
    return jsonOut_({ok:false, error:err.message});
  }
}

function uploadBulletinImage(payload) {
  try {
    var folder = getOrCreateBulFolder();
    var fileName = payload.fileName || ('bulletin-'+Date.now()+'.jpg');
    var dataUrl = payload.dataUrl;
    var parts = dataUrl.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var bytes = Utilities.base64Decode(parts[1]);
    var blob = Utilities.newBlob(bytes, mime, fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileId = file.getId();
    var url = 'https://drive.google.com/uc?export=view&id=' + fileId;
    return jsonOut_({ ok: true, url: url, fileId: fileId });
  } catch(err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

// ─────────────────────────────────────────
// 設備統計（DeviceStats 工作表）
// 欄位：type / key / count / lastSeen
// 只記作業系統、瀏覽器、裝置形態三種分類的次數，不記錄任何個人資料
// ─────────────────────────────────────────
function deviceSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(DEVICE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(DEVICE_SHEET_NAME);
    sh.appendRow(['type', 'key', 'count', 'lastSeen']);
    sh.appendRow(['meta', 'since', 0, new Date()]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function cleanDeviceValue_(v) {
  var s = String(v || '其他').replace(/[\r\n\t]/g, ' ').trim().slice(0, 30);
  return s || '其他';
}

/** 每次 incVisits 呼叫一次。p = e.parameter（含 os / browser / form） */
function recordDevice_(p) {
  p = p || {};
  var os = cleanDeviceValue_(p.os);
  var browser = cleanDeviceValue_(p.browser);
  var form = cleanDeviceValue_(p.form);
  var pairs = [
    ['form', form],
    ['os', os],
    ['browser', browser],
    ['combo', os + ' · ' + browser]
  ];

  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch(e) { /* 拿不到鎖就直接寫，最多少算一次 */ }
  try {
    var sh = deviceSheet_();
    var data = sh.getDataRange().getValues();
    var now = new Date();
    for (var k = 0; k < pairs.length; k++) {
      var type = pairs[k][0];
      var key = pairs[k][1];
      var row = -1;
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === type && String(data[i][1]) === key) { row = i; break; }
      }
      if (row >= 0) {
        var newCount = Number(data[row][2] || 0) + 1;
        sh.getRange(row + 1, 3).setValue(newCount);
        sh.getRange(row + 1, 4).setValue(now);
        data[row][2] = newCount;
      } else {
        sh.appendRow([type, key, 1, now]);
        data.push([type, key, 1, now]);
      }
    }
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

/** 回傳 { ok, since, devices:{ form, os, browser, combo } } */
function getDeviceStats_() {
  var sh = deviceSheet_();
  var data = sh.getDataRange().getValues();
  var devices = { form: {}, os: {}, browser: {}, combo: {} };
  var since = null;
  for (var i = 1; i < data.length; i++) {
    var type = data[i][0], key = data[i][1], count = data[i][2], last = data[i][3];
    if (type === 'meta' && key === 'since') { since = last; continue; }
    if (!devices[type]) continue;
    devices[type][String(key)] = Number(count || 0);
  }
  var sinceStr = null;
  if (since instanceof Date) sinceStr = Utilities.formatDate(since, 'Asia/Taipei', 'yyyy-MM-dd');
  else if (since) sinceStr = String(since);
  return { ok: true, since: sinceStr, devices: devices };
}

/** 在編輯器裡直接執行這個函式可以測試（會寫入一筆 Windows · Chrome · 電腦） */
function testDeviceStats() {
  recordDevice_({ os: 'Windows', browser: 'Chrome', form: '電腦' });
  Logger.log(JSON.stringify(getDeviceStats_()));
}

// ─────────────────────────────────────────
// 訪客清單（Visitors 工作表）
// 欄位：id / ip / os / browser / form / count / firstSeen / lastSeen
// id  = 前端存在 localStorage 的隨機代號（同一個瀏覽器固定不變；換瀏覽器或清除資料會變新的一個）
// ip  = 前端用 ipify 查到的公網 IP（同一辦公室網路的人 IP 會相同；查不到時為空）
// ─────────────────────────────────────────
function visitorSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(VISITOR_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(VISITOR_SHEET_NAME);
    sh.appendRow(['id', 'ip', 'os', 'browser', 'form', 'count', 'firstSeen', 'lastSeen']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function cleanVisitorId_(v) {
  return String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

function cleanIp_(v) {
  return String(v || '').replace(/[^0-9a-fA-F.:]/g, '').slice(0, 45);
}

/** 每次 incVisits 呼叫一次。p = e.parameter（含 vid / ip / os / browser / form） */
function recordVisitor_(p) {
  p = p || {};
  var id = cleanVisitorId_(p.vid);
  if (!id) return; // 舊版前端沒帶 vid 就略過
  var ip = cleanIp_(p.ip);
  var os = cleanDeviceValue_(p.os);
  var browser = cleanDeviceValue_(p.browser);
  var form = cleanDeviceValue_(p.form);

  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch(e) { /* 拿不到鎖就直接寫，最多少算一次 */ }
  try {
    var sh = visitorSheet_();
    var now = new Date();
    var lastRow = sh.getLastRow();
    var row = -1;
    if (lastRow >= 2) {
      var ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === id) { row = i + 2; break; }
      }
    }
    if (row > 0) {
      var cur = sh.getRange(row, 1, 1, 8).getValues()[0];
      var newCount = Number(cur[5] || 0) + 1;
      var firstSeen = cur[6] || now;
      // IP 查不到時保留上一次的 IP
      var keepIp = ip || String(cur[1] || '');
      sh.getRange(row, 1, 1, 8).setValues([[id, keepIp, os, browser, form, newCount, firstSeen, now]]);
    } else {
      sh.appendRow([id, ip, os, browser, form, 1, now, now]);
    }
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

/** 回傳 { ok, total, visitors:[...] }，依最後造訪時間由新到舊，最多 VISITOR_LIST_LIMIT 筆 */
function getVisitorList_() {
  var sh = visitorSheet_();
  var lastRow = sh.getLastRow();
  var list = [];
  if (lastRow >= 2) {
    var data = sh.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r[0]) continue;
      list.push({
        id: String(r[0]),
        ip: String(r[1] || ''),
        os: String(r[2] || ''),
        browser: String(r[3] || ''),
        form: String(r[4] || ''),
        count: Number(r[5] || 0),
        firstSeen: fmtVisitorDate_(r[6]),
        lastSeen: fmtVisitorDate_(r[7])
      });
    }
  }
  list.sort(function(a, b) { return a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0; });
  var total = list.length;
  if (list.length > VISITOR_LIST_LIMIT) list = list.slice(0, VISITOR_LIST_LIMIT);
  return { ok: true, total: total, visitors: list };
}

function fmtVisitorDate_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  return d ? String(d) : '';
}

/** 在編輯器裡直接執行這個函式可以測試（會寫入一筆測試訪客） */
function testVisitorList() {
  recordVisitor_({ vid: 'test-visitor-001', ip: '1.2.3.4', os: 'Windows', browser: 'Chrome', form: '電腦' });
  Logger.log(JSON.stringify(getVisitorList_()));
}

// ─────────────────────────────────────────
// 從改善單 Sheet 直接讀取即將到期資料
// ─────────────────────────────────────────
function getNcrExpiring(days) {
  var ss = SpreadsheetApp.openById(NCR_SHEET_ID);
  var sheet = ss.getSheetByName(NCR_SYNC_SHEET);
  if (!sheet) return { ok: false, error: 'NCR Sheet not found' };

  var raw = sheet.getRange('A1').getValue();
  var data = {};
  try { data = JSON.parse(raw); } catch(e) { return { ok: false, error: 'Parse error' }; }

  var records = data.records || [];
  var now = new Date(); now.setHours(0,0,0,0);
  var cutoff = new Date(now); cutoff.setDate(cutoff.getDate() + days);

  var result = records.filter(function(r) {
    if (r.status === 'Closed') return false;
    if (!r.deadline || r.deadline === '-') return false;
    var dl = new Date(r.deadline); dl.setHours(0,0,0,0);
    return dl <= cutoff;
  }).map(function(r) {
    var dl = new Date(r.deadline); dl.setHours(0,0,0,0);
    var diff = Math.round((dl - now) / 86400000);
    var defs = (r.defects && r.defects.length > 0)
      ? r.defects : [{description: r.description || ''}];
    var descriptions = defs.map(function(d){ return (d.description||'').trim(); }).filter(Boolean).join('；');
    return {
      type:           r.type     || '',
      number:         r.number   || '',
      date:           r.date     || '',
      deadline:       r.deadline || '',
      status:         r.status   || '',
      unit:           r.unit     || '',
      issuer:         r.issuer   || '',
      daysLeft:       diff,
      driveFolderUrl: r.driveFolderUrl || '',
      description:    descriptions,
    };
  });

  result.sort(function(a, b) { return a.daysLeft - b.daysLeft; });
  return { ok: true, records: result, fetchedAt: new Date().toISOString() };
}

// ─────────────────────────────────────────
// 一次性遷移：把舊版本 (整包 JSON 在 A1) 轉成新版本 (分開儲存)
// 在 Apps Script 編輯器執行 migrateOldData() 即可
// ─────────────────────────────────────────
function migrateOldData() {
  var sheet = getSheet();
  var raw = sheet.getRange('A1').getValue();
  if (!raw || typeof raw !== 'string') {
    Logger.log('A1 沒有舊版 JSON 資料');
    return;
  }
  try {
    var oldData = JSON.parse(raw);
    if (!oldData || typeof oldData !== 'object') throw new Error('not an object');

    // 檢查是否已是新格式（A2 也有資料）
    var a2 = sheet.getRange('A2').getValue();
    if (a2) {
      Logger.log('已是新格式，不需遷移');
      return;
    }

    Logger.log('開始遷移舊資料...');
    var result = saveAllData(oldData);
    Logger.log('✅ 遷移完成！儲存了 ' + result.savedKeys + ' 個欄位');
  } catch(err) {
    Logger.log('遷移失敗: ' + err.message);
  }
}

// ─────────────────────────────────────────
// 一次性備份：把目前資料以舊格式 (整包) 印出來給你保險用
// ─────────────────────────────────────────
function backupCurrentData() {
  var data = getAllData();
  Logger.log(JSON.stringify(data));
}

// ─────────────────────────────────────────
// 一次性還原：把備份 JSON 直接寫入 Google Sheet
// ⚠️ 注意：舊版 Code.gs 內建的備份字串是 2026-05-18 的快照，
//    現在執行會把目前資料整包覆蓋成四個月前的舊資料！
//    因此改成從「_備份」工作表 A1 讀取 JSON（先用 backupCurrentData()
//    印出來、貼到 _備份!A1，再執行此函式）。
//    若你仍需要舊快照，請從舊版 Code.gs 複製 backupJsonString 貼到 _備份!A1。
// ─────────────────────────────────────────
function restoreFromBackup() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName('_備份');
  if (!sh) {
    Logger.log('找不到「_備份」工作表。請先建立該工作表並把備份 JSON 貼到 A1。');
    return;
  }
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues()
    .map(function(r){ return r[0]; }).join('');
  if (!vals) {
    Logger.log('「_備份」工作表 A1 是空的。');
    return;
  }
  var data;
  try { data = JSON.parse(vals); }
  catch(err) { Logger.log('備份 JSON 解析失敗: ' + err.message); return; }

  var result = saveAllData(data);
  Logger.log('✅ 已還原 ' + result.savedKeys + ' 個欄位');
  Logger.log('資料總覽：');
  Logger.log('- tasks: ' + (data.tasks || []).length);
  Logger.log('- bulletins: ' + (data.bulletins || []).length);
  Logger.log('- archivedBulletins: ' + (data.archivedBulletins || []).length);
  Logger.log('- events: ' + (data.events || []).length);
  Logger.log('- documents: ' + (data.documents || []).length);
  Logger.log('- sections: ' + (data.sections || []).length);
  Logger.log('- scheduleData months: ' + Object.keys(data.scheduleData || {}).length);
}


// ─────────────────────────────────────────
// 船舶檢查附件上傳到 Drive (自動建立子資料夾)
// 子資料夾命名: 英文船名_MMSI
// ─────────────────────────────────────────
function uploadVesselFile_(payload) {
  try {
    var root = DriveApp.getFolderById(VESSEL_ATTACH_ROOT_ID);
    var folderName = payload.folderName || 'unnamed_vessel';
    // 找/建子資料夾
    var subFolder = null;
    var subs = root.getFoldersByName(folderName);
    if (subs.hasNext()) subFolder = subs.next();
    else subFolder = root.createFolder(folderName);

    var fileName = payload.fileName || ('attach-'+Date.now());
    var dataUrl = payload.dataUrl;
    var parts = dataUrl.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var bytes = Utilities.base64Decode(parts[1]);
    var blob = Utilities.newBlob(bytes, mime, fileName);
    var file = subFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileId = file.getId();
    var url = 'https://drive.google.com/file/d/' + fileId + '/view';
    return jsonOut_({ ok: true, url: url, fileId: fileId, folder: folderName });
  } catch(err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function findVesselFile_(payload) {
  try {
    var root = DriveApp.getFolderById(VESSEL_ATTACH_ROOT_ID);
    var subs = root.getFoldersByName(payload.folderName);
    if (!subs.hasNext()) throw new Error('子資料夾不存在');
    var sub = subs.next();
    var files = sub.getFilesByName(payload.fileName);
    if (!files.hasNext()) throw new Error('檔案還在上傳中');
    var file = files.next();
    return jsonOut_({
      ok: true, url: 'https://drive.google.com/file/d/' + file.getId() + '/view', id: file.getId()
    });
  } catch(err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

// ═════════════════════════════════════════
// 排班相關功能
// ═════════════════════════════════════════
function rosterSS_() { return SpreadsheetApp.openById(SHEET_ID); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function pad2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

// 排班表發布 → 寫到獨立分頁「排班表_YYYYMM」
function handlePublishRoster_(data) {
  if (ROSTER_TOKEN && String(data.token || '') !== ROSTER_TOKEN) return json_({ ok:false, msg:'通行碼錯誤' });
  var ss = rosterSS_();
  var tabName = '排班表_' + data.year + pad2_(data.month);
  var sh = ss.getSheetByName(tabName); if (!sh) sh = ss.insertSheet(tabName);
  sh.clear();
  var wk = ['日','一','二','三','四','五','六'];
  var people = data.people || [];
  var header = ['日期','星期','類型','假日'].concat(people.map(function(p){ return p.name; }));
  var rows = [header];
  (data.rows || []).forEach(function(r){
    var typeLabel = r.type === 'DUTY2' ? '雙值班' : r.type === 'DUTY1' ? '單值班' : '上班';
    var line = [r.date, wk[r.dow], typeLabel, r.holiday || ''];
    people.forEach(function(p){ var v = r.cells[p.id]; line.push(v === 'OFF' ? '' : (v || '')); });
    rows.push(line);
  });
  sh.getRange(1,1,rows.length,header.length).setValues(rows);
  sh.getRange(1,1,1,header.length).setFontWeight('bold').setBackground('#1c3a5c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  var ot = data.overtime || [];
  if (ot.length) {
    var startRow = rows.length + 3;
    var otHead = ['加班統計','休息日(六)','例假日(日)','國定假日','加班時數('+(data.shiftHours||0)+'h/班)'];
    var otRows = [otHead];
    ot.forEach(function(o){ otRows.push([o.name, o.sat||0, o.sun||0, o.holi||0, o.total||0]); });
    sh.getRange(startRow,1,otRows.length,otHead.length).setValues(otRows);
    sh.getRange(startRow,1,1,otHead.length).setFontWeight('bold').setBackground('#fde68a');
  }
  for (var c = 1; c <= header.length; c++) sh.autoResizeColumn(c);
  sh.getRange(sh.getLastRow()+2,1).setValue('最後發布：'+(data.publishedAt||new Date().toISOString()));
  return json_({ ok:true, tab:tabName, count:(data.rows||[]).length });
}

// 排班工具：跨裝置儲存設定（寫到隱藏分頁 _排班設定）
function saveRosterState_(data) {
  if (ROSTER_TOKEN && String(data.token || '') !== ROSTER_TOKEN) return json_({ ok:false, msg:'通行碼錯誤' });
  var ss = rosterSS_();
  var sh = ss.getSheetByName('_排班設定'); if (!sh) sh = ss.insertSheet('_排班設定');
  var json = JSON.stringify(data.state || {});
  sh.clearContents();
  var CH = 40000, rows = [];
  for (var i = 0; i < json.length; i += CH) rows.push([json.substring(i, i + CH)]);
  if (!rows.length) rows = [['']];
  sh.getRange(1,1,rows.length,1).setValues(rows);
  return json_({ ok:true, saved:json.length });
}

// 排班工具：跨裝置載入設定
function loadRosterState_(data) {
  if (ROSTER_TOKEN && String(data.token || '') !== ROSTER_TOKEN) return json_({ ok:false, msg:'通行碼錯誤' });
  var ss = rosterSS_();
  var sh = ss.getSheetByName('_排班設定');
  if (!sh || sh.getLastRow() < 1) return json_({ ok:true, state:null });
  var vals = sh.getRange(1,1,sh.getLastRow(),1).getValues().map(function(r){ return r[0]; }).join('');
  if (!vals) return json_({ ok:true, state:null });
  var state = null;
  try { state = JSON.parse(vals); } catch(e) { return json_({ ok:false, msg:'state parse error' }); }
  return json_({ ok:true, state:state });
}
