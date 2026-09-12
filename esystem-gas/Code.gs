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
    // Google Sheet 單格上限 50,000 字：超過會讓整批 setValues 失敗，所有資料都存不進去
    if (serialized.length > 50000) {
      throw new Error('資料「' + key + '」共 ' + serialized.length + ' 字，超過 Google Sheet 單格 50,000 字上限（公告內若有 base64 圖片請改用圖片上傳按鈕）');
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

// 公告圖片資料夾：
//   1) 若有填 BULLETIN_IMG_FOLDER_ID → 直接用該資料夾
//   2) 否則在船舶附件根目錄 (VESSEL_ATTACH_ROOT_ID) 底下自動建立/使用「EHS-Bulletin-Images」子資料夾
//   3) 上述都失敗 → 在我的雲端硬碟根目錄建立「EHS-Bulletin-Images」
function getOrCreateBulFolder() {
  if (BULLETIN_IMG_FOLDER_ID) {
    try { return DriveApp.getFolderById(BULLETIN_IMG_FOLDER_ID); } catch(e){}
  }
  var parent = null;
  try { parent = DriveApp.getFolderById(VESSEL_ATTACH_ROOT_ID); } catch(e){ parent = null; }
  if (parent) {
    var subs = parent.getFoldersByName('EHS-Bulletin-Images');
    if (subs.hasNext()) return subs.next();
    return parent.createFolder('EHS-Bulletin-Images');
  }
  var folders = DriveApp.getFoldersByName('EHS-Bulletin-Images');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('EHS-Bulletin-Images');
}

// 公告圖片給 <img src> 用的網址（drive.google.com/uc?export=view 已常常無法直接顯示，改用 thumbnail 端點）
function bulImageUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1600';
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

  // action=findImage / findBulImage → 根據檔名查公告圖片 URL（前端 no-cors 上傳後用這個查回網址）
  if (action === 'findImage' || action === 'findBulImage') {
    try {
      var name = e.parameter.name;
      if (!name) throw new Error('No filename');
      var folder = getOrCreateBulFolder();
      var files = folder.getFilesByName(name);
      if (!files.hasNext()) throw new Error('圖片還在上傳中');
      var file = files.next();
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e2){}
      return jsonOut_({ok:true, url:bulImageUrl_(file.getId()), id:file.getId()});
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
      var url = bulImageUrl_(latest.getId());
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

  // ── 📧 環保部門週報 ENV WEEKLY REPORT ──
  if (action === 'mailConfig') {
    try { return jsonOut_({ok:true, config: getMailConfig_()}); }
    catch(err) { return jsonOut_({ok:false, error:err.message}); }
  }
  if (action === 'saveMailConfig') {   // 小設定也可用 GET（前端主要用 POST）
    try { return jsonOut_({ok:true, config: saveMailConfig_(JSON.parse(e.parameter.cfg || '{}'))}); }
    catch(err) { return jsonOut_({ok:false, error:err.message}); }
  }
  if (action === 'trackerMailPreview') {
    try {
      var pv = buildTrackerMail_({ noBlobs: true });
      var cfgNow = getMailConfig_();
      // 預覽用：cid 圖片換成 Drive 網址
      var htmlPv = pv.html.replace(/src="cid:logo"/g, 'src="' + nmdcLogoDataUrl_() + '"').replace(/src="cid:kpi"/g, 'src="' + ((cfgNow.kpi && cfgNow.kpi.url) || 'https://drive.google.com/thumbnail?id=') + '"');
      (pv.photoList || []).forEach(function(p, i) { htmlPv = htmlPv.replace('src="cid:photo' + (i - (i % 2)) + (i % 2) + '"', 'src="' + (p.url || '') + '"'); });
      return jsonOut_({ok:true, subject: pv.subject, html: htmlPv, total: pv.total, overdue: pv.overdue, ncr: pv.ncr, photos: pv.photos, kpi: pv.kpi, range: pv.range});
    } catch(err) { return jsonOut_({ok:false, error:err.message}); }
  }
  if (action === 'sendTrackerNow') {
    try { return jsonOut_(sendTrackerMail_(e.parameter.to || '')); }
    catch(err) { return jsonOut_({ok:false, error:err.message}); }
  }
  if (action === 'sendReminderNow') {
    try { return jsonOut_(sendReminderMail_(true)); }
    catch(err) { return jsonOut_({ok:false, error:err.message}); }
  }
  if (action === 'makeKpiSlide') {   // 設定頁預覽用：存到 B7，不影響附件用的 B6
    try { return jsonOut_(makeKpiSlideAndStore_('slides', true)); }
    catch(err) { return jsonOut_({ok:false, error:err.message}); }
  }
  if (action === 'removeKpiSummary') {
    try { return jsonOut_(removeKpiSummary_()); }
    catch(err) { return jsonOut_({ok:false, error:err.message}); }
  }
  if (action === 'photoData') {
    try {
      var pf = DriveApp.getFileById(e.parameter.id);
      var pb = pf.getBlob();
      return jsonOut_({ok:true, name: pf.getName(), dataUrl: 'data:' + pb.getContentType() + ';base64,' + Utilities.base64Encode(pb.getBytes())});
    } catch(err) { return jsonOut_({ok:false, error:err.message}); }
  }
  if (action === 'findWeeklyFile') {
    try { return jsonOut_(findWeeklyFile_(e.parameter.name || '')); }
    catch(err) { return jsonOut_({ok:false, error:err.message}); }
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
    if (payload.action === 'saveMailConfig')  return jsonOut_({ ok: true, config: saveMailConfig_(payload.cfg || {}) });
    if (payload.action === 'uploadWeeklyPhoto') return jsonOut_(uploadWeeklyPhoto_(payload));
    if (payload.action === 'uploadKpiSummary')  return jsonOut_(uploadKpiSummary_(payload));
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
    return jsonOut_({ ok: true, url: bulImageUrl_(fileId), fileId: fileId });
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


// ═══════════════════════════════════════════════════════════════════════
//  📧 環保部門週報 ENV WEEKLY REPORT
//     每週一 09:00 自動寄出（追蹤事項 + 改善單 + 現場照片 + KPI 總結圖附件）
//     每週五 15:00 寄提醒信，提醒更新照片與 KPI 總結圖
//
//  部署後請在 Apps Script 編輯器手動執行一次 setupTrackerMailTrigger()
//  （會要求 Gmail 寄信、Drive、外部連線、翻譯等授權）。
//
//  GET action：
//    ?action=mailConfig                  → 讀取週報設定（含照片清單、KPI 圖）
//    ?action=trackerMailPreview          → 回傳信件 HTML（預覽用，不寄出）
//    ?action=sendTrackerNow[&to=email]   → 立即寄出（帶 to = 只寄測試信給該信箱）
//    ?action=sendReminderNow             → 立即寄一封週五提醒信（測試用）
//    ?action=findWeeklyFile&name=…       → 依檔名查週報資料夾內的檔案（上傳後備援查詢）
//  POST action（body JSON）：
//    {action:'saveMailConfig', cfg:{…}}                     → 儲存設定
//    {action:'uploadWeeklyPhoto', fileName, dataUrl}        → 上傳現場照片到 Drive
//    {action:'uploadKpiSummary', fileName, dataUrl}         → 上傳 KPI 總結圖（改善單系統「匯出總結」會自動呼叫）
// ═══════════════════════════════════════════════════════════════════════
var SYSTEM_URL       = 'https://d9533472.github.io/NMDCEHS-e-system/';
var NCR_SYSTEM_URL   = 'https://d9533472.github.io/NMDCEHS-e-system/tpc-pipeline-improvement-system_30.html';
// 改善單系統的 GAS 網址（與前端 index.html 的 DEFAULT_NCR_URL 相同）。
// 改善單資料存在該 GAS 的 Drive JSON index，不是 NCR_SHEET_ID 的 SyncData 工作表（那是舊版遷移殘留）。
var NCR_GAS_URL      = 'https://script.google.com/macros/s/AKfycbyUtSGT-UfX8xYiw9C_0f3ciJN0inf3_Q8GX6FHi1qlN6YBPQ_LGcOLvH5ZjW9jZ0O7/exec';
var MAIL_CFG_CELL    = 'B5';   // JSON：收件者、開頭文字、提醒、照片清單
var KPI_CELL         = 'B6';   // JSON：{fileId, url, name, uploadedAt}（改善單系統自動同步／手動上傳的高畫質圖）
var KPI_PREVIEW_CELL = 'B7';   // JSON：設定頁「預覽備援版」產生的 Slides 圖，不會拿來當附件
// NMDC Energy 白色 logo（382×132 PNG，base64），信件頁首用
var NMDC_LOGO_B64 = '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';
function nmdcLogoBlob_() { return Utilities.newBlob(Utilities.base64Decode(NMDC_LOGO_B64), 'image/png', 'nmdc-logo.png'); }
function nmdcLogoDataUrl_() { return 'data:image/png;base64,' + NMDC_LOGO_B64; }
var MAIL_TZ          = 'Asia/Taipei';
var WEEKLY_FOLDER    = 'EHS-Weekly-Report';
var TRANSLATE_SHEET  = 'Translations';

var MAIL_DEFAULT_CFG = {
  enabled:         true,
  to:              'raymond.huang@nmdc-group.com, Sean.chu@nmdc-group.com, Jacqueline.peng@nmdc-group.com',
  cc:              'NMDCTaiwanEHSgroup@NMDCGroup.onmicrosoft.com',
  senderName:      'NMDC Environmental E-System',
  intro:           '<p>Dear Chris, Sam</p>' +
                   '<p>Please refer to the attached weekly report from the ENV Department for this week.<br>' +
                   'You are also welcome to discuss with us if you have any suggestions or comments.<br>' +
                   'Thank you all for your continued support.</p>' +
                   '<p>BR,<br>Paul Tong</p>',
  translate:       true,
  reminderEnabled: true,
  reminderTo:      'paul.tong@nmdc-group.com',
  photos:          []      // [{fileId, url, title, location, date, uploadedAt}]
};

// Outlook 桌面版用 Word 引擎排版：字型不會從外層繼承，且中文一律用「東亞字型」（預設新細明體）。
// 所以每個 <td>/<p> 都要自帶字型，正黑體放第一個，並加 mso-fareast-font-family。
var TRK_FONT = "font-family:'Microsoft JhengHei','微軟正黑體','PingFang TC','Noto Sans TC','Segoe UI',Helvetica,Arial,sans-serif;" +
               "mso-fareast-font-family:'Microsoft JhengHei';mso-ascii-font-family:'Microsoft JhengHei';" +
               "mso-hansi-font-family:'Microsoft JhengHei';mso-bidi-font-family:Arial;";

// ── 設定讀寫 ──
function normalizeMails_(s) {
  return String(s || '').split(/[,;\s]+/).map(function(x){ return x.trim(); })
    .filter(function(x){ return x && x.indexOf('@') > 0; }).join(',');
}
function readJsonCell_(cell) {
  try { var raw = getSheet().getRange(cell).getValue(); return raw ? (JSON.parse(raw) || null) : null; } catch(e) { return null; }
}
function getMailConfig_() {
  var cfg = readJsonCell_(MAIL_CFG_CELL) || {};
  var D = MAIL_DEFAULT_CFG;
  var pick = function(k) { return (cfg[k] != null) ? cfg[k] : D[k]; };
  return {
    enabled:         cfg.enabled !== false,
    to:              String(pick('to')),
    cc:              String(pick('cc')),
    senderName:      String(cfg.senderName || '').trim() || D.senderName,
    intro:           String(cfg.intro != null ? cfg.intro : D.intro),
    translate:       cfg.translate !== false,
    reminderEnabled: cfg.reminderEnabled !== false,
    reminderTo:      String(pick('reminderTo')),
    photos:          Array.isArray(cfg.photos) ? cfg.photos : [],
    lastSentAt:      cfg.lastSentAt || '',
    updatedAt:       cfg.updatedAt || '',
    saved:           !!Object.keys(cfg).length,
    kpi:             readJsonCell_(KPI_CELL)
  };
}
function saveMailConfig_(cfg) {
  cfg = cfg || {};
  var old = readJsonCell_(MAIL_CFG_CELL) || {};
  var truthy = function(v, dflt) { return v == null ? dflt : !(v === false || v === 'false' || v === 0); };
  var photos = Array.isArray(cfg.photos) ? cfg.photos.map(function(p) {
    return { fileId: String(p.fileId || ''), url: String(p.url || ''), title: String(p.title || ''),
             location: String(p.location || ''), date: String(p.date || ''), uploadedAt: String(p.uploadedAt || ''), framed: !!p.framed };
  }).filter(function(p){ return p.fileId; }) : (old.photos || []);
  var clean = {
    enabled:         truthy(cfg.enabled, true),
    to:              String(cfg.to || '').trim(),
    cc:              String(cfg.cc || '').trim(),
    senderName:      String(cfg.senderName || '').trim() || MAIL_DEFAULT_CFG.senderName,
    intro:           cfg.intro != null ? String(cfg.intro) : (old.intro != null ? old.intro : MAIL_DEFAULT_CFG.intro),
    translate:       truthy(cfg.translate, true),
    reminderEnabled: truthy(cfg.reminderEnabled, true),
    reminderTo:      String(cfg.reminderTo != null ? cfg.reminderTo : (old.reminderTo || MAIL_DEFAULT_CFG.reminderTo)).trim(),
    photos:          photos,
    lastSentAt:      old.lastSentAt || '',
    updatedAt:       new Date().toISOString()
  };
  // 被移除的照片：Drive 檔案丟到垃圾桶
  (old.photos || []).forEach(function(p) {
    if (p && p.fileId && !photos.some(function(q){ return q.fileId === p.fileId; })) {
      try { DriveApp.getFileById(p.fileId).setTrashed(true); } catch(e) {}
    }
  });
  getSheet().getRange(MAIL_CFG_CELL).setValue(JSON.stringify(clean));
  return getMailConfig_();
}
function markMailSent_(sentPhotos, range) {
  var cfg = readJsonCell_(MAIL_CFG_CELL) || {};
  cfg.lastSentAt = new Date().toISOString();
  var sentIds = (sentPhotos || []).map(function(p){ return p.fileId; });
  if (sentIds.length) {
    // 封存：EHS-Weekly-Report/已寄出/2026-09-07~2026-09-13
    var sub = null;
    try {
      var root = getWeeklyFolder_();
      var it = root.getFoldersByName('已寄出');
      var archive = it.hasNext() ? it.next() : root.createFolder('已寄出');
      var name = range ? (range.fromIso + '~' + range.toIso) : cfg.lastSentAt.slice(0, 10);
      var it2 = archive.getFoldersByName(name);
      sub = it2.hasNext() ? it2.next() : archive.createFolder(name);
    } catch(e) { Logger.log('建立封存資料夾失敗：' + e.message); }
    sentIds.forEach(function(id) {
      if (!sub) return;
      try { DriveApp.getFileById(id).moveTo(sub); } catch(e) { Logger.log('封存照片失敗 ' + id + '：' + e.message); }
    });
    cfg.photos = (cfg.photos || []).filter(function(p){ return sentIds.indexOf(p.fileId) < 0; });
    Logger.log('已封存 ' + sentIds.length + ' 張照片' + (sub ? '到 ' + sub.getName() : ''));
  }
  getSheet().getRange(MAIL_CFG_CELL).setValue(JSON.stringify(cfg));
}

// ── Drive：週報資料夾 / 上傳 ──
function getWeeklyFolder_() {
  var parent = null;
  try { parent = DriveApp.getFolderById(VESSEL_ATTACH_ROOT_ID); } catch(e) { parent = null; }
  var it = parent ? parent.getFoldersByName(WEEKLY_FOLDER) : DriveApp.getFoldersByName(WEEKLY_FOLDER);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(WEEKLY_FOLDER) : DriveApp.createFolder(WEEKLY_FOLDER);
}
function saveDataUrlToWeekly_(fileName, dataUrl) {
  var parts = String(dataUrl || '').split(',');
  if (parts.length < 2) throw new Error('dataUrl 格式不正確');
  var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
  var blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, fileName);
  var file = getWeeklyFolder_().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
  return { fileId: file.getId(), url: bulImageUrl_(file.getId()), name: fileName, size: blob.getBytes().length };
}
function uploadWeeklyPhoto_(payload) {
  var name = payload.fileName || ('weekly-photo-' + Date.now() + '.jpg');
  var r = saveDataUrlToWeekly_(name, payload.dataUrl);
  r.uploadedAt = new Date().toISOString();
  return { ok: true, photo: r };
}
function uploadKpiSummary_(payload) {
  var name = payload.fileName || ('KPI-summary-' + trkTodayStr_() + '.png');
  var r = saveDataUrlToWeekly_(name, payload.dataUrl);
  var old = readJsonCell_(KPI_CELL);
  if (old && old.fileId) { try { DriveApp.getFileById(old.fileId).setTrashed(true); } catch(e) {} }
  var kpi = { fileId: r.fileId, url: r.url, name: name, uploadedAt: new Date().toISOString(), source: payload.source || 'manual', size: r.size || 0 };
  getSheet().getRange(KPI_CELL).setValue(JSON.stringify(kpi));
  return { ok: true, kpi: kpi };
}
function removeKpiSummary_() {
  var old = readJsonCell_(KPI_CELL);
  if (old && old.fileId) { try { DriveApp.getFileById(old.fileId).setTrashed(true); } catch(e) {} }
  getSheet().getRange(KPI_CELL).setValue('');
  return { ok: true };
}
function findWeeklyFile_(name) {
  var files = getWeeklyFolder_().getFilesByName(name);
  if (!files.hasNext()) throw new Error('檔案還在上傳中');
  var f = files.next();
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
  return { ok: true, fileId: f.getId(), url: bulImageUrl_(f.getId()), name: name };
}

// ── 日期工具（全部以台北時間為準） ──
function trkTodayStr_() { return Utilities.formatDate(new Date(), MAIL_TZ, 'yyyy-MM-dd'); }
function trkParse_(ymd) {
  var m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(String(ymd || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function trkFmt_(d, sep) { // d: UTC-midnight Date
  var p = function(n){ return (n < 10 ? '0' : '') + n; };
  return d.getUTCFullYear() + sep + p(d.getUTCMonth() + 1) + sep + p(d.getUTCDate());
}
function trkWeekdayZh_(ymd) {
  var d = trkParse_(ymd); if (!d) return '';
  return '週' + ['日','一','二','三','四','五','六'][d.getUTCDay()];
}
function trkDaysLeft_(deadline, today) {
  var a = trkParse_(deadline), b = trkParse_(today);
  if (!a || !b) return null;
  return Math.round((a - b) / 86400000);
}
// 報告期間：以「昨天」所在的那一週（週一～週日）為準。
// 週一 09:00 寄出 → 上週一～上週日；週五提醒 → 本週一～本週日（即下週一要寄的那份）。
function reportRange_() {
  var base = trkParse_(trkTodayStr_());
  base = new Date(base.getTime() - 86400000);
  var dow = base.getUTCDay();                       // 0=日
  var mon = new Date(base.getTime() - ((dow + 6) % 7) * 86400000);
  var sun = new Date(mon.getTime() + 6 * 86400000);
  return { from: trkFmt_(mon, '/'), to: trkFmt_(sun, '/'), fromIso: trkFmt_(mon, '-'), toIso: trkFmt_(sun, '-'),
           label: trkFmt_(mon, '/') + '~' + trkFmt_(sun, '/') };
}
function trkEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// 備註是前端 RTE 的 HTML → 轉成純文字行
function trkNoteLines_(raw) {
  if (!raw) return [];
  var s = String(raw), n = 0;
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, function(_, inner) {
    n = 0;
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function(__, t) { n++; return n + '. ' + t.replace(/<[^>]+>/g, '') + '\n'; });
  });
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, function(_, inner) {
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function(__, t) { return '• ' + t.replace(/<[^>]+>/g, '') + '\n'; });
  });
  s = s.replace(/<br[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n')
       .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
       .replace(/<[^>]+>/g, '');
  return s.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
}

// ── 自動翻譯（中→英），結果快取在 Translations 工作表，避免每週重翻 ──
var _trCache = null, _trNew = null;
function trHasCjk_(s) { return /[㐀-鿿]/.test(String(s || '')); }
function trLoad_() {
  if (_trCache) return;
  _trCache = {}; _trNew = [];
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(TRANSLATE_SHEET);
    if (!sh) { sh = ss.insertSheet(TRANSLATE_SHEET); sh.getRange(1, 1, 1, 3).setValues([['zh', 'en', 'updatedAt']]); return; }
    var last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, 2).getValues().forEach(function(r){ if (r[0] && !trCacheBad_(String(r[0]), String(r[1] || ''))) _trCache[String(r[0])] = String(r[1] || ''); });
  } catch(e) { Logger.log('翻譯快取讀取失敗：' + e.message); }
}
function trFlush_() {
  if (!_trNew || !_trNew.length) return;
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TRANSLATE_SHEET);
    if (sh) sh.getRange(sh.getLastRow() + 1, 1, _trNew.length, 3).setValues(_trNew);
  } catch(e) { Logger.log('翻譯快取寫入失敗：' + e.message); }
  _trNew = [];
}
// 固定用語：先換成英文再送翻譯，避免「通霄」被翻成 All night long
var TR_TERMS = [['通霄工區', 'TungHsiao Site'], ['通霄', 'TungHsiao'], ['台中工區', 'Taichung Site'], ['台中', 'Taichung'],
                ['天力工區', 'Tienli Site'], ['天力', 'Tienli'], ['海管', 'subsea pipeline'], ['環安衛', 'EHS']];
function trFixTerms_(s) { TR_TERMS.forEach(function(t){ s = s.split(t[0]).join(t[1]); }); return s; }
function trCacheBad_(zh, en) { // 快取裡舊的錯譯（地名沒照固定用語）就不採用
  for (var i = 0; i < TR_TERMS.length; i++) if (zh.indexOf(TR_TERMS[i][0]) >= 0 && en.indexOf(TR_TERMS[i][1]) < 0) return true;
  return false;
}
function tr_(zh) {
  zh = String(zh == null ? '' : zh).trim();
  if (!zh || !trHasCjk_(zh)) return '';
  trLoad_();
  if (_trCache[zh] != null) return _trCache[zh];
  var en = '';
  var pre = trFixTerms_(zh);
  if (!trHasCjk_(pre)) en = pre;   // 整句都是固定用語（例如「通霄工區」）
  else { try { en = String(LanguageApp.translate(pre, 'zh-TW', 'en') || '').trim(); } catch(e) { Logger.log('翻譯失敗：' + e.message); } }
  _trCache[zh] = en;
  if (en) _trNew.push([zh, en, new Date().toISOString()]);
  return en;
}

// ── 信件組件 ──
function trkP_(text, css) { return '<p style="margin:0;' + TRK_FONT + (css || '') + '">' + text + '</p>'; }
// 中文 + 下方英文小字
function trkZhEn_(zh, css, enCss, doTr) {
  var h = trkP_(trkEsc_(zh), css || '');
  var en = doTr ? tr_(zh) : '';
  if (en) h += trkP_(trkEsc_(en), 'font-size:11px;color:#8a97a8;margin-top:2px;line-height:1.45;' + (enCss || ''));
  return h;
}
function trkSpacer_(px) {
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="' + px + '" bgcolor="#ffffff" style="background-color:#ffffff;height:' + px + 'px;font-size:1px;line-height:' + px + 'px;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>';
}
function trkSectionTitle_(icon, zh, en, sub, color) {
  return trkSpacer_(68) + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td bgcolor="#ffffff" style="background-color:#ffffff;border-left:5px solid ' + color + ';padding:2px 0 2px 14px;">' +
      trkP_(icon + ' ' + zh + ' <span style="color:' + color + ';' + TRK_FONT + '">' + en + '</span>', 'font-size:16px;font-weight:bold;color:#0f172a;letter-spacing:.3px;') +
      (sub ? trkP_(sub, 'font-size:11px;color:#64748b;margin-top:3px;') : '') +
    '</td></tr></table>';
}
function trkKpiCard_(num, zh, en, color, subZh, subEn, unit, pos, icon, tint) {
  var pad = pos === 'first' ? '0 6px 0 0' : pos === 'last' ? '0 0 0 6px' : '0 6px';
  var ok = /^✓/.test(subZh);
  tint = tint || '#ffffff';
  return '<td class="stat" width="25%" valign="top" style="padding:' + pad + ';">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td bgcolor="' + tint + '" style="background-color:' + tint + ';border:1px solid #e2e8f0;border-top:3px solid ' + color + ';padding:14px 14px 12px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td valign="top">' +
          trkP_(zh, 'font-size:12px;font-weight:bold;color:#0f172a;letter-spacing:.4px;') +
          trkP_(en, 'font-size:8.5px;color:#94a3b8;margin-top:2px;letter-spacing:1px;text-transform:uppercase;line-height:1.4;') +
        '</td>' +
        '<td width="38" valign="top" align="right" style="padding-left:6px;">' +
          '<table cellpadding="0" cellspacing="0" border="0" align="right"><tr><td bgcolor="' + color + '" width="34" height="34" align="center" valign="middle" style="background-color:' + color + ';width:34px;height:34px;font-size:17px;line-height:34px;text-align:center;">' + icon + '</td></tr></table>' +
        '</td>' +
      '</tr></table>' +
      trkP_('<span style="font-size:40px;font-weight:bold;line-height:1;color:' + color + ';' + TRK_FONT + '">' + num + '</span>' +
            '<span style="font-size:12px;color:#94a3b8;padding-left:5px;' + TRK_FONT + '">' + unit + '</span>', 'margin-top:14px;line-height:1;white-space:nowrap;') +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr><td style="border-top:1px solid ' + color + '33;padding-top:9px;">' +
        trkP_(subZh, 'font-size:11px;font-weight:bold;color:' + (ok ? '#15803d' : color) + ';white-space:nowrap;') +
        trkP_(subEn, 'font-size:9.5px;color:#94a3b8;margin-top:2px;white-space:nowrap;') +
      '</td></tr></table>' +
    '</td></tr></table></td>';
}
function trkKpiStrip_(range, cards) {
  var eyebrow = function(zh, en, color) {
    return '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-bottom:2px solid ' + color + ';padding:0 2px 6px;">' +
      trkP_(zh + ' <span style="font-weight:normal;color:#94a3b8;font-size:9px;letter-spacing:1.2px;' + TRK_FONT + '">' + en + '</span>', 'font-size:11px;font-weight:bold;color:' + color + ';letter-spacing:.5px;white-space:nowrap;') +
      '</td></tr></table>';
  };
  var h = trkSpacer_(60) + '<table width="100%" cellpadding="0" cellspacing="0" border="0">';
  h += '<tr><td style="padding:0 0 12px;border-bottom:1px solid #e2e8f0;">' +
       '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
       '<td valign="bottom">' + trkP_('本週摘要', 'font-size:15px;font-weight:bold;color:#0b1f33;letter-spacing:1px;') +
                                trkP_('WEEKLY SUMMARY', 'font-size:9px;color:#94a3b8;letter-spacing:2.5px;margin-top:2px;') + '</td>' +
       '<td valign="bottom" align="right">' + trkP_('報告期間 Period', 'font-size:9px;color:#94a3b8;letter-spacing:1px;') +
                                              trkP_(range.from + ' ~ ' + range.to, 'font-size:12px;font-weight:bold;color:#0b1f33;margin-top:2px;white-space:nowrap;') + '</td>' +
       '</tr></table></td></tr>';
  h += '<tr><td style="padding:16px 0 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
       '<td class="stat" width="25%" style="padding:0 6px 0 0;">' + eyebrow('改善單', 'NCR / WM', '#ea580c') + '</td>' +
       '<td class="stat" width="75%" colspan="3" style="padding:0 0 0 6px;">' + eyebrow('待辦事項', 'TRACKER ITEMS', '#0e7490') + '</td>' +
       '</tr></table></td></tr>';
  h += '<tr><td style="padding:10px 0 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + cards.join('') + '</tr></table></td></tr>';
  return h + '</table>';
}
function trkDaysLabel_(d) {
  if (d == null) return '—';
  if (d < 0)  return '逾期 ' + Math.abs(d) + ' 天';
  if (d === 0) return '今天';
  if (d === 1) return '明天';
  return d + ' 天';
}
function trkDaysLabelEn_(d) {
  if (d == null) return '';
  if (d < 0)  return Math.abs(d) + 'd overdue';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return d + ' days';
}
function trkSubHead_(text, color) {
  return trkP_(text, 'font-size:13px;font-weight:bold;color:' + color + ';margin-top:14px;');
}
function trkEmptyNote_(zh, en) {
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr>' +
    '<td bgcolor="#f8fafc" style="background-color:#f8fafc;border:1px dashed #cbd5e1;padding:12px 14px;">' +
    trkP_(zh, 'font-size:12px;color:#64748b;') + (en ? trkP_(en, 'font-size:11px;color:#94a3b8;margin-top:2px;') : '') + '</td></tr></table>';
}
// 使用者在設定頁編輯的開頭文字（RTE HTML）→ 幫每個區塊標籤補上字型
function trkIntroHtml_(html) {
  var s = String(html || '').trim();
  if (!s) return '';
  var base = 'margin:0 0 10px;' + TRK_FONT + 'font-size:14px;color:#1e293b;line-height:1.75;';
  s = s.replace(/<(p|div)(\s[^>]*)?>/gi, function(_, tag, attrs) {
    attrs = attrs || '';
    if (/style=/i.test(attrs)) return '<' + tag + attrs.replace(/style="/i, 'style="' + base) + '>';
    return '<' + tag + attrs + ' style="' + base + '">';
  });
  s = s.replace(/<(li)(\s[^>]*)?>/gi, function(_, tag, attrs) { return '<li' + (attrs || '') + ' style="' + TRK_FONT + 'font-size:14px;color:#1e293b;line-height:1.7;">'; });
  s = s.replace(/<(ul|ol)(\s[^>]*)?>/gi, function(_, tag, attrs) { return '<' + tag + (attrs || '') + ' style="margin:0 0 10px;padding-left:22px;">'; });
  // 純文字（沒有任何區塊標籤）→ 包成 p，換行保留
  if (!/<(p|div|li|table)\b/i.test(s)) s = '<p style="' + base + '">' + s.replace(/\n/g, '<br>') + '</p>';
  return s;
}

// ── 追蹤事項表格（rows 已排序） ──
function trkTaskTable_(rows, today, doTr) {
  if (!rows.length) return '';
  var TH = 'padding:9px 10px;background-color:#0b1f33;color:#ffffff;font-size:11px;font-weight:bold;letter-spacing:1px;' + TRK_FONT;
  var priLabel = { high: '高', mid: '中', low: '低' };
  var priEn    = { high: 'High', mid: 'Mid', low: 'Low' };
  var priColor = { high: '#dc2626', mid: '#d97706', low: '#16a34a' };
  var h = '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;table-layout:fixed;border:1px solid #d8dee6;margin-top:10px;">';
  h += '<tr bgcolor="#0b1f33">' +
       '<td bgcolor="#0b1f33" width="11%" style="' + TH + '">優先</td>' +
       '<td bgcolor="#0b1f33" width="53%" style="' + TH + '">事項 Item</td>' +
       '<td bgcolor="#0b1f33" width="14%" style="' + TH + '">負責人</td>' +
       '<td bgcolor="#0b1f33" width="22%" style="' + TH + '">期限 Due</td></tr>';
  rows.forEach(function(t, i) {
    var bg = i % 2 === 0 ? '#ffffff' : '#f6f8fa';
    var pri = t.priority || 'mid';
    var d = trkDaysLeft_(t.deadline, today);
    var dlColor = d == null ? '#334155' : d < 0 ? '#b91c1c' : d <= 1 ? '#b45309' : d <= 6 ? '#0369a1' : '#334155';
    var dlBg    = d == null ? bg       : d < 0 ? '#fef2f2' : d <= 1 ? '#fffbeb' : bg;
    var persons = String(t.person || '').split(',').map(function(p){ return p.trim(); }).filter(Boolean).join('、');
    var notes = trkNoteLines_(t.note);
    var TD = 'padding:9px 10px;border-top:1px solid #e5e9ef;font-size:13px;color:#1e293b;vertical-align:top;word-wrap:break-word;' + TRK_FONT;
    var noteHtml = '';
    notes.forEach(function(l) {
      noteHtml += trkP_(trkEsc_(l), 'font-size:11px;color:#64748b;margin-top:3px;line-height:1.5;');
      var en = doTr ? tr_(l) : '';
      if (en) noteHtml += trkP_(trkEsc_(en), 'font-size:10px;color:#a3aec0;line-height:1.4;');
    });
    h += '<tr bgcolor="' + bg + '">';
    h += '<td bgcolor="' + bg + '" style="' + TD + 'background-color:' + bg + ';">' +
           trkP_('<span style="color:' + priColor[pri] + ';' + TRK_FONT + '">●</span> ' + priLabel[pri], 'font-size:12px;font-weight:bold;color:' + priColor[pri] + ';') +
           trkP_(priEn[pri] + ' · #' + (i + 1), 'font-size:10px;color:#94a3b8;margin-top:2px;') + '</td>';
    h += '<td bgcolor="' + bg + '" style="' + TD + 'background-color:' + bg + ';">' +
           trkZhEn_(t.name, 'font-size:13px;font-weight:bold;color:#0f172a;', '', doTr) + noteHtml + '</td>';
    h += '<td bgcolor="' + bg + '" style="' + TD + 'background-color:' + bg + ';font-size:12px;">' + trkEsc_(persons || '—') + '</td>';
    h += '<td bgcolor="' + dlBg + '" style="' + TD + 'background-color:' + dlBg + ';">' +
           trkP_(trkEsc_(t.deadline || '—'), 'font-size:12px;font-weight:bold;color:' + dlColor + ';') +
           trkP_(trkDaysLabel_(d) + '<br><span style="font-weight:normal;color:#94a3b8;' + TRK_FONT + '">' + trkDaysLabelEn_(d) + '</span>', 'font-size:11px;font-weight:bold;color:' + dlColor + ';margin-top:2px;line-height:1.4;') + '</td>';
    h += '</tr>';
  });
  return h + '</table>';
}

// ── 改善單：從改善單系統 GAS 抓「全部紀錄」，同前端公告欄的算法（未結案 + 期限在 days 天內或已逾期） ──
function getNcrOpenFromGas_(days) {
  var resp = UrlFetchApp.fetch(NCR_GAS_URL + '?action=index&_=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) throw new Error('改善單 GAS 回應 HTTP ' + resp.getResponseCode());
  var data = JSON.parse(resp.getContentText());
  if (!data || !Array.isArray(data.records)) throw new Error(data && data.error ? data.error : '改善單資料格式不符');
  var today = trkTodayStr_();
  var list = data.records.filter(function(r) {
    return r && r.status !== 'Closed' && r.deadline && r.deadline !== '-';
  }).map(function(r) {
    var defs = (r.defects && r.defects.length) ? r.defects : [{ description: r.description || '' }];
    var desc = defs.map(function(d){ return String(d.description || '').trim(); }).filter(Boolean).join('；');
    return {
      type: r.type || '', number: r.number || '', date: r.date || '', deadline: r.deadline || '',
      status: r.status || '', unit: r.unit || '', issuer: r.issuer || '', area: r.area || '',
      daysLeft: trkDaysLeft_(r.deadline, today), driveFolderUrl: r.driveFolderUrl || '', description: desc
    };
  }).filter(function(r){ return r.daysLeft != null && r.daysLeft <= days; });
  list.sort(function(a, b){ return a.daysLeft - b.daysLeft; });
  var open = data.records.filter(function(r){ return r && r.status !== 'Closed'; }).length;
  return { ok: true, records: list, total: data.records.length, open: open, closed: data.records.length - open };
}
function trkNcrTable_(rows, doTr) {
  if (!rows.length) return '';
  var TH = 'padding:9px 10px;background-color:#7c2d12;color:#ffffff;font-size:11px;font-weight:bold;letter-spacing:1px;' + TRK_FONT;
  var h = '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;table-layout:fixed;border:1px solid #d8dee6;margin-top:10px;">';
  h += '<tr bgcolor="#7c2d12">' +
       '<td bgcolor="#7c2d12" width="16%" style="' + TH + '">編號 No.</td>' +
       '<td bgcolor="#7c2d12" width="49%" style="' + TH + '">缺失改善內容 Description</td>' +
       '<td bgcolor="#7c2d12" width="18%" style="' + TH + '">關單期限 Due</td>' +
       '<td bgcolor="#7c2d12" width="17%" style="' + TH + '">單位／開單人</td></tr>';
  rows.forEach(function(r, i) {
    var bg = i % 2 === 0 ? '#ffffff' : '#f6f8fa';
    var d = r.daysLeft;
    var dlColor = d < 0 ? '#b91c1c' : d <= 1 ? '#b45309' : '#334155';
    var dlBg    = d < 0 ? '#fef2f2' : d <= 1 ? '#fffbeb' : bg;
    var typeColor = r.type === 'NCR' ? '#b45309' : r.type === 'WM' ? '#1d4ed8' : '#b91c1c';
    var TD = 'padding:9px 10px;border-top:1px solid #e5e9ef;font-size:13px;color:#1e293b;vertical-align:top;word-wrap:break-word;' + TRK_FONT;
    h += '<tr bgcolor="' + bg + '">';
    h += '<td bgcolor="' + bg + '" style="' + TD + 'background-color:' + bg + ';">' +
           trkP_(trkEsc_(r.type || '—'), 'font-size:10px;font-weight:bold;color:' + typeColor + ';letter-spacing:1px;') +
           trkP_(trkEsc_(r.number || '—'), 'font-size:12px;font-weight:bold;color:#0f172a;margin-top:2px;') + '</td>';
    h += '<td bgcolor="' + bg + '" style="' + TD + 'background-color:' + bg + ';">' + trkZhEn_(r.description || '—', 'font-size:13px;color:#1e293b;', '', doTr) + '</td>';
    h += '<td bgcolor="' + dlBg + '" style="' + TD + 'background-color:' + dlBg + ';">' +
           trkP_(trkEsc_(r.deadline || '—'), 'font-size:12px;font-weight:bold;color:' + dlColor + ';') +
           trkP_(trkDaysLabel_(d) + '<br><span style="font-weight:normal;color:#94a3b8;' + TRK_FONT + '">' + trkDaysLabelEn_(d) + '</span>', 'font-size:11px;font-weight:bold;color:' + dlColor + ';margin-top:2px;line-height:1.4;') + '</td>';
    h += '<td bgcolor="' + bg + '" style="' + TD + 'background-color:' + bg + ';font-size:12px;">' +
           trkZhEn_(r.unit || '—', 'font-size:12px;color:#1e293b;', '', doTr) +
           trkP_(trkEsc_(r.issuer || '—'), 'font-size:11px;color:#64748b;margin-top:2px;') +
           (r.driveFolderUrl ? trkP_('<a href="' + trkEsc_(r.driveFolderUrl) + '" style="color:#166534;font-weight:bold;text-decoration:none;' + TRK_FONT + '">📁 資料夾</a>', 'font-size:11px;margin-top:4px;') : '') + '</td>';
    h += '</tr>';
  });
  return h + '</table>';
}

// ── 本週活動 Coming Activities：寄出日起 7 天（週一寄 = 週一～週日）的重點活動 ──
var EVT_DEFAULT_TYPES = [
  { key: 'audit', label: '查核', color: '#dc2626', bg: '#fef2f2' },
  { key: 'campaign', label: 'Campaign', color: '#7c3aed', bg: '#ede9fe' },
  { key: 'meeting', label: '會議', color: '#0369a1', bg: '#e0f2fe' },
  { key: 'other', label: '其他', color: '#475569', bg: '#f1f5f9' }
];
function trkWeekEvents_(data, today) {
  var from = trkParse_(today), list = [];
  (data.events || []).forEach(function(ev) {
    if (!ev || !ev.date) return;
    var d = trkDaysLeft_(ev.date, today);
    if (d == null || d < 0 || d > 6) return;
    list.push(ev);
  });
  list.sort(function(a, b) { return String(a.date).localeCompare(String(b.date)) || (b.starred ? 1 : 0) - (a.starred ? 1 : 0); });
  var to = new Date(from.getTime() + 6 * 86400000);
  return { list: list, from: trkFmt_(from, '/'), to: trkFmt_(to, '/') };
}
function trkEventsHtml_(data, today, doTr) {
  var w = trkWeekEvents_(data, today);
  var types = (data.eventTypes && data.eventTypes.length) ? data.eventTypes : EVT_DEFAULT_TYPES;
  var typeOf = function(key) {
    for (var i = 0; i < types.length; i++) if (types[i].key === key) return types[i];
    return { label: '其他', color: '#475569', bg: '#f1f5f9' };
  };
  var h = trkSectionTitle_('📅', '本週活動', 'Coming Activities', w.from + ' ~ ' + w.to + ' 的重點活動 · Key activities scheduled this week', '#7c3aed');
  if (!w.list.length) return h + trkEmptyNote_('本週沒有排定的活動。', 'No activities scheduled this week.');
  h += '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #d8dee6;margin-top:10px;">';
  w.list.forEach(function(ev, i) {
    var bg = i % 2 === 0 ? '#ffffff' : '#f6f8fa';
    var t = typeOf(ev.typeKey);
    var wd = trkWeekdayZh_(ev.date);
    var md = String(ev.date).slice(5).replace('-', '/');
    var meta = [ev.area, ev.person].filter(Boolean).join(' · ');
    var notes = trkNoteLines_(ev.note);
    var TD = 'padding:10px 12px;border-top:1px solid #e5e9ef;vertical-align:top;word-wrap:break-word;' + TRK_FONT;
    h += '<tr bgcolor="' + bg + '">';
    h += '<td bgcolor="' + bg + '" width="18%" style="' + TD + 'background-color:' + bg + ';">' +
           trkP_(md, 'font-size:15px;font-weight:bold;color:#0f172a;line-height:1.1;') +
           trkP_(wd, 'font-size:11px;color:#64748b;margin-top:2px;') + '</td>';
    h += '<td bgcolor="' + bg + '" width="17%" style="' + TD + 'background-color:' + bg + ';">' +
           '<table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="' + (t.bg || '#f1f5f9') + '" style="background-color:' + (t.bg || '#f1f5f9') + ';padding:3px 8px;">' +
             trkP_(trkEsc_(t.label || '其他'), 'font-size:10px;font-weight:bold;color:' + (t.color || '#475569') + ';white-space:nowrap;') + '</td></tr></table></td>';
    var body = trkP_((ev.starred ? '⭐ ' : '') + trkEsc_(ev.title || '（未命名）'), 'font-size:13px;font-weight:bold;color:#0f172a;');
    var titleEn = doTr ? tr_(ev.title || '') : '';
    if (titleEn) body += trkP_(trkEsc_(titleEn), 'font-size:11px;color:#8a97a8;margin-top:2px;line-height:1.45;');
    if (meta) body += trkZhEn_(meta, 'font-size:11px;color:#475569;margin-top:3px;', '', doTr);
    notes.forEach(function(l) {
      body += trkP_(trkEsc_(l), 'font-size:11px;color:#64748b;margin-top:3px;line-height:1.5;');
      var en = doTr ? tr_(l) : '';
      if (en) body += trkP_(trkEsc_(en), 'font-size:10px;color:#a3aec0;line-height:1.4;');
    });
    h += '<td bgcolor="' + bg + '" style="' + TD + 'background-color:' + bg + ';">' + body + '</td>';
    h += '</tr>';
  });
  return h + '</table>';
}

// ── 現場照片（兩欄，不裁切、原比例） ──
function trkPhotosHtml_(photos, doTr) {
  if (!photos.length) return '';
  var h = '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">';
  for (var i = 0; i < photos.length; i += 2) {
    h += '<tr>';
    [photos[i], photos[i + 1]].forEach(function(p, j) {
      h += '<td class="stat" width="50%" valign="top" style="padding:0 ' + (j ? '0 12px 6px' : '0 12px 0') + ';">';
      if (p) {
        h += '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;background-color:#ffffff;">' +
          '<tr><td bgcolor="#eef2f6" align="center" style="background-color:#eef2f6;border-top:4px solid #16a34a;padding:0;">' +
            '<img src="cid:photo' + i + j + '" width="300" height="169" alt="' + trkEsc_(p.title || '') + '" style="width:100%;max-width:300px;height:auto;display:block;border:0;">' +
          '</td></tr>' +
          '<tr><td style="padding:10px 12px 12px;">' +
            trkZhEn_(p.title || '（未命名）', 'font-size:13px;font-weight:bold;color:#0f172a;', '', doTr) +
            (p.location ? trkP_('📍 ' + trkEsc_(p.location), 'font-size:11px;color:#475569;margin-top:4px;') + (doTr && tr_(p.location) ? trkP_(trkEsc_(tr_(p.location)), 'font-size:10px;color:#8a97a8;line-height:1.4;') : '') : '') +
            (p.date ? trkP_('🗓 ' + trkEsc_(p.date), 'font-size:11px;color:#94a3b8;margin-top:2px;') : '') +
          '</td></tr></table>';
      } else {
        h += '&nbsp;';
      }
      h += '</td>';
    });
    h += '</tr>';
  }
  return h + '</table>';
}

// ── 組信（預覽與寄送共用）。回傳 {subject, html, inline:{cid:blob}, attachments:[blob], …} ──
function buildTrackerMail_(opts) {
  opts = opts || {};
  var mc = getMailConfig_();
  var doTr = mc.translate !== false;
  var today = trkTodayStr_();
  var range = reportRange_();
  var data  = getAllData();
  var tasks = (data.tasks || []).filter(function(t){ return t && !t.done; });

  var priOrd = { high: 0, mid: 1, low: 2 };
  tasks.sort(function(a, b) {
    var pa = priOrd[a.priority || 'mid'], pb = priOrd[b.priority || 'mid'];
    if (pa !== pb) return pa - pb;
    return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'));
  });
  var overdue = [], thisWeek = [], later = [];
  tasks.forEach(function(t) {
    var d = trkDaysLeft_(t.deadline, today);
    if (d != null && d < 0) overdue.push(t);
    else if (d != null && d <= 6) thisWeek.push(t);
    else later.push(t);
  });
  var byDeadline = function(a, b){ return String(a.deadline || '').localeCompare(String(b.deadline || '')); };
  overdue.sort(byDeadline); thisWeek.sort(byDeadline);

  // 改善單（已逾期 + 7 天內到期）— 來源是改善單系統 GAS；讀不到也不能讓週報失敗
  var ncr = [], ncrErr = '', ncrStat = null;
  try { ncrStat = getNcrOpenFromGas_(7); ncr = ncrStat.records || []; }
  catch(e) { ncrErr = e.message; }
  var ncrOverdue = ncr.filter(function(r){ return r.daysLeft < 0; });
  var ncrSoon    = ncr.filter(function(r){ return r.daysLeft >= 0; });

  // 附件與內嵌圖片
  var inline = {}, attachments = [];
  var kpi = mc.kpi, kpiOk = false, kpiSource = '';
  // 本週（報告期間的週一之後）同步或上傳過的圖才算新；否則由系統自己畫一張
  var kpiFresh = !!(kpi && kpi.fileId && kpi.uploadedAt && kpi.uploadedAt >= range.fromIso + 'T00:00:00');
  if (opts.noBlobs) {
    kpiOk = true; kpiSource = kpiFresh ? (kpi.source || 'upload') : 'slides-preview';
  } else {
    if (kpiFresh) {
      try {
        var kb = DriveApp.getFileById(kpi.fileId).getBlob();
        var ext = (kb.getContentType() || '').indexOf('png') >= 0 ? 'png' : 'jpg';
        kb.setName('ENV_KPI_Summary_' + range.fromIso + '_' + range.toIso + '.' + ext);
        attachments.push(kb); kpiOk = true; kpiSource = kpi.source || 'upload';
      } catch(e) { Logger.log('KPI 圖讀取失敗：' + e.message); }
    }
    if (!kpiOk) {
      try {
        var ks = makeKpiSlideAndStore_('slides');
        var kb2 = DriveApp.getFileById(ks.kpi.fileId).getBlob();
        kb2.setName('ENV_KPI_Summary_' + range.fromIso + '_' + range.toIso + '.png');
        attachments.push(kb2); kpiOk = true; kpiSource = 'slides';
      } catch(e) { Logger.log('KPI 圖自動產生失敗：' + e.message); }
    }
  }
  // 只放上次寄出之後上傳的照片（沒有 uploadedAt 的舊資料也放）；寄出後會封存，不會再出現
  var photos = [];
  (mc.photos || []).forEach(function(p, idx) {
    if (!p || !p.fileId) return;
    if (mc.lastSentAt && p.uploadedAt && p.uploadedAt <= mc.lastSentAt) return;
    if (opts.noBlobs) { photos.push(p); return; }
    try { var b = DriveApp.getFileById(p.fileId).getBlob(); b.setName('photo' + (idx + 1) + '.jpg'); photos.push(p); inline['photo' + (photos.length - 1 - ((photos.length - 1) % 2)) + ((photos.length - 1) % 2)] = b; }
    catch(e) { Logger.log('照片讀取失敗：' + (p.title || p.fileId) + ' ' + e.message); }
  });

  var total = tasks.length;
  var dateLine = today + '（' + trkWeekdayZh_(today) + '）';
  var body = '';

  // 開頭文字
  var intro = trkIntroHtml_(mc.intro);
  if (intro) body += '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>' +
    '<td bgcolor="#f6faf7" style="background-color:#f6faf7;border:1px solid #d9e7dd;border-left:5px solid #16a34a;padding:18px 22px 10px;">' + intro + '</td></tr></table>';

  // KPI 卡片
  body += trkKpiStrip_(range, [
    trkKpiCard_(String(ncr.length), '改善單待處理', 'NCR / WM to handle', '#ea580c',
      ncrOverdue.length ? '⚠ 逾期 ' + ncrOverdue.length + ' · 7 天內 ' + ncrSoon.length : (ncr.length ? '7 天內到期 ' + ncrSoon.length + ' 筆' : '✓ 無待處理'),
      ncrOverdue.length ? ncrOverdue.length + ' overdue · ' + ncrSoon.length + ' due in 7d' : (ncr.length ? ncrSoon.length + ' due within 7 days' : 'Nothing pending'), '筆', 'first', '🛠️', '#fff7ed'),
    trkKpiCard_(String(overdue.length), '追蹤事項逾期', 'Tracker overdue', '#dc2626',
      overdue.length ? '⚠ 請優先處理' : '✓ 無逾期', overdue.length ? 'Action needed' : 'All on track', '項', 'mid', '⏰', '#fef2f2'),
    trkKpiCard_(String(thisWeek.length), '本週到期', 'Due this week', '#d97706',
      thisWeek.length ? '本週內完成' : '✓ 本週無到期', thisWeek.length ? 'Due within 7 days' : 'Nothing due this week', '項', 'mid', '📅', '#fffbeb'),
    trkKpiCard_(String(later.length), '排程中', 'Scheduled', '#0369a1', '7 天後到期', 'Due after 7 days', '項', 'last', '📌', '#eff6ff')
  ]);

  // 改善單
  body += trkSectionTitle_('🛠️', '改善單狀態', 'Improvement Notice Status',
    (kpiOk ? '<b>📎 統計表如附件</b>（改善單 KPI 總結圖）· Statistics: see the attached KPI summary image' + (kpiSource === 'slides' ? '，系統依最新資料自動產生' : '') + '<br>' : '') +
    '以下列出已逾期與 7 天內到期的 NCR / WM · Overdue and due within 7 days', '#ea580c');
  if (ncrStat) body += trkP_('目前總計 ' + ncrStat.total + ' 件，未結案 ' + ncrStat.open + ' 件、已結案 ' + ncrStat.closed + ' 件　·　Total ' + ncrStat.total + ', open ' + ncrStat.open + ', closed ' + ncrStat.closed, 'font-size:11px;color:#64748b;margin-top:8px;');
  if (ncrErr) body += trkEmptyNote_('改善單資料暫時無法讀取：' + trkEsc_(ncrErr), 'Improvement notice data is temporarily unavailable.');
  else if (!ncr.length) body += trkEmptyNote_('沒有逾期或 7 天內到期的改善單。', 'No overdue notices and none due within 7 days.');
  if (ncrOverdue.length) { body += trkSubHead_('🔴 已逾期（' + ncrOverdue.length + ' 筆）Overdue', '#b91c1c'); body += trkNcrTable_(ncrOverdue, doTr); }
  if (ncrSoon.length)    { body += trkSubHead_('🟠 7 天內到期（' + ncrSoon.length + ' 筆）Due within 7 days', '#b45309'); body += trkNcrTable_(ncrSoon, doTr); }

  // 追蹤事項
  body += trkSectionTitle_('📋', '追蹤事項', 'Tracker Items', '依優先度與期限排序 · Sorted by priority and deadline', '#16a34a');
  if (!total) body += trkEmptyNote_('目前沒有未完成的追蹤事項。', 'No open tracker items.');
  if (overdue.length)  { body += trkSubHead_('🔴 已逾期（' + overdue.length + ' 項）Overdue', '#b91c1c'); body += trkTaskTable_(overdue, today, doTr); }
  if (thisWeek.length) { body += trkSubHead_('🟠 本週到期（' + thisWeek.length + ' 項）Due this week', '#b45309'); body += trkTaskTable_(thisWeek, today, doTr); }
  if (later.length)    { body += trkSubHead_('🔵 排程中（' + later.length + ' 項）Scheduled', '#0369a1'); body += trkTaskTable_(later, today, doTr); }

  // 本週活動（照片上方）
  var evHtml = '';
  try { evHtml = trkEventsHtml_(data, today, doTr); } catch(e) { Logger.log('活動區塊產生失敗：' + e.message); }
  body += evHtml;

  // 現場照片
  if (photos.length) {
    body += trkSectionTitle_('📸', '現場照片', 'Site Photos', '本週環保活動與現場紀錄 · Environmental activities and site records this week', '#0ea5e9');
    body += trkPhotosHtml_(photos, doTr);
  }
  trFlush_();

  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>ENV Weekly Report</title>' +
    '<!--[if mso]><style>table,td,p,a,span,div,li{font-family:\'Microsoft JhengHei\',\'Segoe UI\',Arial,sans-serif !important;' +
      'mso-fareast-font-family:\'Microsoft JhengHei\' !important;mso-ascii-font-family:\'Microsoft JhengHei\' !important;mso-hansi-font-family:\'Microsoft JhengHei\' !important;}</style><![endif]-->' +
    '<style>@media only screen and (max-width:620px){.wrap{width:100% !important;}.stat{display:block !important;width:100% !important;padding:0 0 10px !important;}.pad{padding-left:16px !important;padding-right:16px !important;}.hdr-r{display:block !important;text-align:left !important;padding-top:0 !important;}}</style>' +
    '</head><body style="margin:0;padding:0;background-color:#edf1f5;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#edf1f5" style="background-color:#edf1f5;"><tr><td align="center" style="padding:24px 12px;">' +
    '<!--[if mso]><table width="680" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
    '<table class="wrap" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;background-color:#ffffff;border:1px solid #d3dbe4;">' +
    // 頁首
    '<tr><td bgcolor="#0b1f33" style="background-color:#0b1f33;padding:0;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td class="pad" valign="top" style="padding:26px 28px 22px;">' +
          '<img src="cid:logo" width="132" height="46" alt="NMDC Energy" style="display:block;border:0;width:132px;height:46px;">' +
          trkP_('EHS DEPARTMENT &nbsp;·&nbsp; ENVIRONMENTAL', 'font-size:10px;letter-spacing:2.5px;color:#7fa6cf;margin-top:10px;') +
          trkP_('環保部門週報', 'font-size:26px;font-weight:bold;color:#ffffff;margin-top:8px;letter-spacing:1px;') +
          trkP_('ENV Weekly Report', 'font-size:17px;font-weight:bold;color:#86efac;margin-top:2px;') +
          trkP_('追蹤事項及改善單狀態 · Tracker &amp; Improvement Notice Status', 'font-size:12px;color:#b9c8d8;margin-top:8px;') +
        '</td>' +
        '<td class="pad hdr-r" valign="top" align="right" width="210" style="padding:26px 28px 22px 0;">' +
          '<table cellpadding="0" cellspacing="0" border="0" align="right" style="border:1px solid #2f5f8f;"><tr><td bgcolor="#123456" style="background-color:#123456;padding:10px 14px;">' +
            trkP_('REPORT PERIOD 報告期間', 'font-size:9px;letter-spacing:1.5px;color:#7fa6cf;') +
            trkP_(range.from + ' ~ ' + range.to, 'font-size:14px;font-weight:bold;color:#ffffff;margin-top:4px;white-space:nowrap;') +
          '</td></tr></table>' +
          trkP_('Issued ' + dateLine, 'font-size:10px;color:#7fa6cf;margin-top:10px;') +
        '</td>' +
      '</tr></table>' +
    '</td></tr>' +
    '<tr><td bgcolor="#16a34a" style="background-color:#16a34a;font-size:0;line-height:0;height:5px;">&nbsp;</td></tr>' +
    // 內容
    '<tr><td class="pad" style="padding:18px 28px 8px;">' + body + '</td></tr>' +
    // 按鈕
    '<tr><td align="center" style="padding:28px 28px 6px;">' +
      '<table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#16a34a" align="center" style="background-color:#16a34a;padding:13px 34px;">' +
        '<a href="' + SYSTEM_URL + '" style="color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;display:inline-block;' + TRK_FONT + '">🌿 開啟 E-System &nbsp;Open System</a>' +
      '</td></tr></table>' +
      trkP_('若按鈕無法點擊，請複製此連結 If the button does not work, copy this link:<br><a href="' + SYSTEM_URL + '" style="color:#166534;' + TRK_FONT + '">' + SYSTEM_URL + '</a>', 'font-size:10px;color:#94a3b8;margin-top:12px;line-height:1.6;') +
    '</td></tr>' +
    // 頁尾
    '<tr><td bgcolor="#f8fafc" class="pad" style="background-color:#f8fafc;border-top:1px solid #e5e9ef;padding:14px 28px;">' +
      trkP_('此信件由 Environmental E-System 於每週一 09:00 自動寄出；收件者、開頭文字與現場照片可在系統「追蹤事項 → 📧 週報設定」調整。' +
            (doTr ? '英文小字由系統自動翻譯，僅供參考。' : '') +
            '<br>Automated weekly report · NMDC Energy EHS Department' + (doTr ? ' · English lines are machine-translated for reference.' : ''), 'font-size:11px;color:#94a3b8;line-height:1.6;') +
    '</td></tr>' +
    '</table>' +
    '<!--[if mso]></td></tr></table><![endif]-->' +
    '</td></tr></table></body></html>';

  var subject = 'ENV WEEKLY REPORT (' + range.from + '~' + range.to + ')';
  return { subject: subject, html: html, inline: inline, attachments: attachments, range: range,
           total: total, overdue: overdue.length, thisWeek: thisWeek.length, ncr: ncr.length,
           photos: photos.length, photoList: photos, kpi: kpiOk, kpiSource: kpiSource };
}

// ── 寄送週報 ──
function sendTrackerMail_(testTo) {
  var mc = getMailConfig_();
  var to = normalizeMails_(testTo);
  var cc = '';
  if (!to) {
    if (!mc.enabled) return { ok: false, error: '週報寄送已停用（請到設定頁啟用）' };
    to = normalizeMails_(mc.to);
    cc = normalizeMails_(mc.cc);
    if (!to) return { ok: false, error: '尚未設定收件者' };
  }
  var m = buildTrackerMail_();
  var opt = { to: to, subject: (testTo ? '【測試】' : '') + m.subject, htmlBody: m.html, name: mc.senderName };
  if (cc) opt.cc = cc;
  m.inline.logo = nmdcLogoBlob_();
  if (Object.keys(m.inline).length) opt.inlineImages = m.inline;
  if (m.attachments.length) opt.attachments = m.attachments;
  MailApp.sendEmail(opt);
  if (!testTo) markMailSent_(m.photoList, m.range);
  var quota = -1; try { quota = MailApp.getRemainingDailyQuota(); } catch(e) {}
  Logger.log('週報已寄出 → ' + to + (cc ? ' (cc ' + cc + ')' : '') + '；' + m.subject + '；待辦 ' + m.total + '，逾期 ' + m.overdue + '，照片 ' + m.photos + '，KPI 圖 ' + (m.kpi ? '有' : '無'));
  return { ok: true, to: to, cc: cc, subject: opt.subject, total: m.total, overdue: m.overdue, thisWeek: m.thisWeek, ncr: m.ncr, photos: m.photos, kpi: m.kpi, quota: quota };
}

// ── 週五 15:00 提醒信 ──
function buildReminderMail_() {
  var mc = getMailConfig_();
  var range = reportRange_();
  var photos = mc.photos || [];
  var kpi = mc.kpi;
  var fmt = function(iso) { try { return Utilities.formatDate(new Date(iso), MAIL_TZ, 'yyyy-MM-dd HH:mm'); } catch(e) { return iso || ''; } };
  var fresh = photos.filter(function(p){ return !(mc.lastSentAt && p.uploadedAt && p.uploadedAt <= mc.lastSentAt); });
  var lastPhoto = fresh.length ? fresh.map(function(p){ return p.uploadedAt || ''; }).sort().pop() : '';
  var stale = !fresh.length; // 本週還沒有新照片
  var kpiStale = kpi && mc.lastSentAt && kpi.uploadedAt && kpi.uploadedAt < mc.lastSentAt;
  var row = function(icon, zh, en, ok, note) {
    return '<tr><td width="34" valign="top" style="padding:10px 0;border-top:1px solid #e5e9ef;font-size:18px;">' + icon + '</td>' +
      '<td valign="top" style="padding:10px 0;border-top:1px solid #e5e9ef;">' + trkP_(zh, 'font-size:14px;font-weight:bold;color:#0f172a;') + trkP_(en, 'font-size:11px;color:#94a3b8;margin-top:2px;') + '</td>' +
      '<td valign="top" align="right" style="padding:10px 0;border-top:1px solid #e5e9ef;white-space:nowrap;">' +
        trkP_(ok ? '✅ ' + note : '⚠️ ' + note, 'font-size:12px;font-weight:bold;color:' + (ok ? '#15803d' : '#b45309') + ';') + '</td></tr>';
  };
  var btn = function(url, text, color) {
    return '<table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 6px 8px;"><tr><td bgcolor="' + color + '" align="center" style="background-color:' + color + ';padding:12px 26px;">' +
      '<a href="' + url + '" style="color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;display:inline-block;' + TRK_FONT + '">' + text + '</a></td></tr></table>';
  };
  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>週報更新提醒</title>' +
    '<!--[if mso]><style>table,td,p,a,span,div{font-family:\'Microsoft JhengHei\',\'Segoe UI\',Arial,sans-serif !important;mso-fareast-font-family:\'Microsoft JhengHei\' !important;}</style><![endif]-->' +
    '</head><body style="margin:0;padding:0;background-color:#edf1f5;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#edf1f5"><tr><td align="center" style="padding:24px 12px;">' +
    '<!--[if mso]><table width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #d3dbe4;">' +
    '<tr><td bgcolor="#0b1f33" style="background-color:#0b1f33;padding:22px 28px;">' +
      '<img src="cid:logo" width="110" height="38" alt="NMDC Energy" style="display:block;border:0;width:110px;height:38px;">' +
      trkP_('ENVIRONMENTAL E-SYSTEM', 'font-size:10px;letter-spacing:2.5px;color:#7fa6cf;margin-top:8px;') +
      trkP_('📸 週報更新提醒', 'font-size:22px;font-weight:bold;color:#ffffff;margin-top:6px;') +
      trkP_('Weekly report update reminder', 'font-size:13px;color:#86efac;margin-top:2px;') +
    '</td></tr>' +
    '<tr><td bgcolor="#f59e0b" style="background-color:#f59e0b;font-size:0;line-height:0;height:5px;">&nbsp;</td></tr>' +
    '<tr><td bgcolor="#fffbeb" style="background-color:#fffbeb;border-left:6px solid #f59e0b;padding:14px 28px;">' +
      trkP_('下週一 09:00 將自動寄出 <b>ENV WEEKLY REPORT (' + range.from + '~' + range.to + ')</b>', 'font-size:14px;color:#78350f;') +
      trkP_('請在週一之前更新本週的現場照片。改善單 KPI 總結圖會自動處理，不用手動匯出。', 'font-size:13px;color:#92400e;margin-top:4px;') +
      trkP_('The report will be sent automatically next Monday 09:00. Please update this week\'s site photos before then; the KPI summary image is generated automatically.', 'font-size:11px;color:#a16207;margin-top:4px;') +
    '</td></tr>' +
    '<tr><td style="padding:14px 28px 6px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0">' +
      row('📷', '現場照片 Site photos', fresh.length ? '本週已上傳 ' + fresh.length + ' 張，最後更新 ' + fmt(lastPhoto) : '本週尚未上傳照片（上週的已封存，不會重複寄出）', !stale, fresh.length ? fresh.length + ' 張' : '尚無照片') +
      row('📊', 'KPI 總結圖 KPI summary image', kpi && !kpiStale ? '已同步 ' + fmt(kpi.uploadedAt) + (kpi.source === 'auto' ? '（改善單系統自動匯出）' : kpi.source === 'slides' ? '（系統產生）' : '（手動上傳）') : '本週尚未同步，寄出時會由系統依最新資料自動產生', true, kpi && !kpiStale ? '已同步' : '自動') +
      row('📋', '追蹤事項與改善單 Tracker & notices', '寄出時會自動抓取最新資料，不用手動整理', true, '自動') +
      '</table></td></tr>' +
    '<tr><td align="center" style="padding:16px 28px 8px;">' +
      '<table cellpadding="0" cellspacing="0" border="0" align="center"><tr>' +
        '<td>' + btn(SYSTEM_URL + '?weekly=1', '📧 開啟週報設定（更新照片）', '#16a34a') + '</td>' +
        '<td>' + btn(NCR_SYSTEM_URL, '📊 改善單系統 → 匯出總結', '#ea580c') + '</td>' +
      '</tr></table>' +
      trkP_('改善單系統只要開啟儀表板就會自動把 KPI 總結圖同步到週報；本週沒開過也沒關係，寄出時系統會自己畫一張。', 'font-size:11px;color:#94a3b8;margin-top:6px;') +
    '</td></tr>' +
    '<tr><td bgcolor="#f8fafc" style="background-color:#f8fafc;border-top:1px solid #e5e9ef;padding:12px 28px;">' +
      trkP_('此提醒由 Environmental E-System 於每週五 15:00 自動寄出。可在「週報設定」關閉。', 'font-size:11px;color:#94a3b8;') +
    '</td></tr>' +
    '</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>';
  return { subject: '【提醒】請更新週報照片與 KPI 總結圖 — ENV WEEKLY REPORT (' + range.from + '~' + range.to + ')', html: html, to: normalizeMails_(mc.reminderTo), enabled: mc.reminderEnabled };
}
function sendReminderMail_(force) {
  var r = buildReminderMail_();
  var mc = getMailConfig_();
  if (!force && !r.enabled) return { ok: false, error: '提醒信已停用' };
  if (!r.to) return { ok: false, error: '尚未設定提醒收件者' };
  MailApp.sendEmail({ to: r.to, subject: r.subject, htmlBody: r.html, name: mc.senderName, inlineImages: { logo: nmdcLogoBlob_() } });
  Logger.log('週報提醒已寄出 → ' + r.to);
  return { ok: true, to: r.to, subject: r.subject };
}

// ── 觸發器呼叫的函式 ──
function weeklyTrackerMail() {           // 每週一 09:00
  var r = sendTrackerMail_('');
  if (!r.ok) Logger.log('weeklyTrackerMail 未寄出：' + r.error);
  return r;
}
function fridayReportReminder() {        // 每週五 15:00
  var r = sendReminderMail_(false);
  if (!r.ok) Logger.log('fridayReportReminder 未寄出：' + r.error);
  return r;
}

// 在編輯器手動執行一次即可（會先清掉舊的同名觸發器，可重複執行）
function setupTrackerMailTrigger() {
  var names = ['weeklyTrackerMail', 'fridayReportReminder'];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyTrackerMail').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(0).inTimezone(MAIL_TZ).create();
  ScriptApp.newTrigger('fridayReportReminder').timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(15).nearMinute(0).inTimezone(MAIL_TZ).create();
  var msg = '✅ 已安裝觸發器：每週一 09:00 寄出 ENV WEEKLY REPORT、每週五 15:00 寄更新提醒（台北時間）';
  Logger.log(msg);
  return msg;
}
function listTrackerMailTriggers() {
  var s = ScriptApp.getProjectTriggers().map(function(t){ return t.getHandlerFunction() + ' / ' + t.getEventType(); }).join('\n');
  Logger.log(s || '（目前沒有任何觸發器）');
  return s;
}

// 在編輯器執行：檢查改善單資料抓得對不對（看執行紀錄）
function testNcrSource() {
  var r = getNcrOpenFromGas_(7);
  Logger.log('改善單總數 ' + r.total + '，未結案 ' + r.open + '，逾期或 7 天內到期 ' + r.records.length);
  r.records.forEach(function(x){ Logger.log(x.type + ' ' + x.number + ' | ' + x.deadline + ' | ' + trkDaysLabel_(x.daysLeft) + ' | ' + x.status + ' | ' + x.description); });
  return r;
}
// 在編輯器執行：寄一封週報測試信給自己（Apps Script 擁有者）
function testTrackerMailToMe() {
  return sendTrackerMail_(Session.getEffectiveUser().getEmail());
}
// 在編輯器執行：寄一封提醒信（給設定的提醒收件者）
function testReminderMail() {
  return sendReminderMail_(true);
}


// ═══════════════════════════════════════════════════════════════════════
//  📊 KPI 總結圖備援：排程寄信時若本週沒有從改善單系統同步過來的圖，
//     就由 Apps Script 用 Google Slides 依最新資料畫一張，匯出 PNG 當附件。
//     （改善單系統開啟儀表板時會自動在背景匯出並上傳，那張版型較精緻，優先使用）
// ═══════════════════════════════════════════════════════════════════════
var KPI_PROJECT_NAME = '通霄電廠二期更新改建計畫海底輸氣管線統包工程';
var KPI_PROJECT_EN   = 'Tongxiao Power Plant Phase II Subsea Gas Pipeline EPC Project';
var KPI_ITEM_EN = { '1': 'Exposed Area Control', '2': 'Site Entrance', '3': 'Vehicle Route', '4': 'Housekeeping', '5': 'Wastewater / Oil', '6': 'Contract Specs', '7': 'Good Practice' };
var KPI_DEFAULT_ITEMS = { '1': '裸露區域防制措施', '2': '工區出入口', '3': '車行路徑', '4': '整理整頓', '5': '廢水廢油處理', '6': '契約規範', '7': '優點' };
var KPI_PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];
var KPI_FONT = 'Noto Sans TC';

function getNcrIndex_() {
  var resp = UrlFetchApp.fetch(NCR_GAS_URL + '?action=index&_=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) throw new Error('改善單 GAS 回應 HTTP ' + resp.getResponseCode());
  var data = JSON.parse(resp.getContentText());
  if (!data || !Array.isArray(data.records)) throw new Error(data && data.error ? data.error : '改善單資料格式不符');
  return data;
}

// 與改善單系統儀表板「全部期間」相同的統計方式
function kpiStats_(data) {
  var recs = data.records || [];
  var iopts = (data.config && data.config.itemOptions) || data.itemOptions || KPI_DEFAULT_ITEMS;
  var defsOf = function(r) { return (r.defects && r.defects.length) ? r.defects : [{ item: r.item || 1, description: r.description || '' }]; };
  var open = 0, closed = 0, totalDefects = 0, closedDefs = 0, map = {};
  recs.forEach(function(r) {
    if (!r) return;
    var ds = defsOf(r);
    if (r.status === 'Open') open++; else if (r.status === 'Closed') closed++;
    totalDefects += ds.length;
    if (r.status === 'Closed') closedDefs += ds.length;
    ds.forEach(function(d) {
      var k = String(d.item || 1);
      if (!map[k]) map[k] = { total: 0, open: 0, closed: 0 };
      map[k].total++;
      if (r.status === 'Open') map[k].open++; else map[k].closed++;
    });
  });
  var items = Object.keys(map).map(function(k) {
    return { k: k, name: iopts[k] || ('項目 ' + k), en: KPI_ITEM_EN[k] || ('Item ' + k), total: map[k].total, open: map[k].open, closed: map[k].closed };
  }).sort(function(a, b) { return b.total - a.total; });
  items.forEach(function(it, i) {
    it.color = KPI_PALETTE[i % KPI_PALETTE.length];
    it.pct = totalDefects ? Math.round(it.total / totalDefects * 100) : 0;
    it.closedPct = it.total ? Math.round(it.closed / it.total * 100) : 0;
  });
  return { recCount: recs.length, open: open, closed: closed, totalDefects: totalDefects, closedDefs: closedDefs,
           closeRate: totalDefects ? Math.round(closedDefs / totalDefects * 100) : 0, items: items };
}

// ── Slides 繪圖小工具（單位 pt，頁面 720 × 405） ──
function kpiRect_(slide, x, y, w, h, fill, rounded, border) {
  var s = slide.insertShape(rounded ? SlidesApp.ShapeType.ROUND_RECTANGLE : SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
  if (fill) s.getFill().setSolidFill(fill); else s.getFill().setTransparent();
  if (border) s.getBorder().setWeight(0.75).getLineFill().setSolidFill(border); else s.getBorder().setTransparent();
  return s;
}
function kpiText_(slide, x, y, w, h, text, size, color, bold, align, valign) {
  // 文字方塊四邊預設有 7.2pt 內距，這裡把座標往外推，讓 x/y 就是文字實際位置
  var s = slide.insertTextBox(String(text), x - 7.2, y - 7.2, w + 14.4, h + 14.4);
  var tr = s.getText();
  var st = tr.getTextStyle();
  st.setFontFamily(KPI_FONT).setFontSize(size).setForegroundColor(color).setBold(!!bold);
  tr.getParagraphStyle().setParagraphAlignment(align || SlidesApp.ParagraphAlignment.START).setSpaceAbove(0).setSpaceBelow(0).setLineSpacing(100);
  s.setContentAlignment(valign || SlidesApp.ContentAlignment.TOP);
  try { s.getAutofit().setAutofitType(SlidesApp.AutofitType.NONE); } catch(e) {}
  return s;
}
function kpiDonutBlob_(items) {
  var dt = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, '項目').addColumn(Charts.ColumnType.NUMBER, '件數');
  items.forEach(function(it) { dt.addRow([it.k, it.total]); });
  var chart = Charts.newPieChart().setDataTable(dt.build())
    .setOption('pieHole', 0.58).setOption('legend', { position: 'none' })
    .setOption('pieSliceText', 'percentage').setOption('pieSliceTextStyle', { color: '#ffffff', fontSize: 22, bold: true })
    .setOption('pieSliceBorderColor', '#ffffff').setOption('backgroundColor', 'transparent')
    .setOption('chartArea', { left: 8, top: 8, width: '90%', height: '90%' })
    .setColors(items.map(function(it) { return it.color; }))
    .setDimensions(520, 520).build();
  return chart.getBlob();
}

// 產生 KPI 圖 → 回傳 {blob, stats}
function buildKpiSlideImage_() {
  var data = getNcrIndex_();
  var st = kpiStats_(data);
  var today = trkTodayStr_();
  var pres = SlidesApp.create('ENV-KPI-temp-' + Date.now());
  var slide = pres.getSlides()[0];
  slide.getShapes().forEach(function(s) { try { s.remove(); } catch(e) {} });
  var W = 720, H = 405;
  var NAVY = '#0b1f33', TEXT = '#1e3a5f', MUTED = '#6b8299', LINE = '#dbe4ee', SOFT = '#f4f7fb';
  kpiRect_(slide, 0, 0, W, H, '#f6f8fb');

  // 頁首
  kpiRect_(slide, 0, 0, W, 58, NAVY);
  kpiRect_(slide, 0, 58, W, 3, '#16a34a');
  kpiRect_(slide, 14, 12, 34, 34, '#16a34a', true);
  kpiText_(slide, 14, 17, 34, 24, '≋', 18, '#ffffff', true, SlidesApp.ParagraphAlignment.CENTER);
  kpiText_(slide, 56, 8, 450, 20, KPI_PROJECT_NAME, 14, '#ffffff', true);
  kpiText_(slide, 56, 27, 450, 12, KPI_PROJECT_EN, 6.5, '#9fb8d3', false);
  kpiText_(slide, 56, 39, 450, 12, '環保改善缺失追蹤 KPI 總結  ·  ENVIRONMENTAL IMPROVEMENT DEFECT TRACKING · KPI SUMMARY', 6.5, '#8fb3d9', true);
  kpiRect_(slide, 596, 10, 110, 38, '#123456', true, '#2f5f8f');
  kpiText_(slide, 602, 13, 100, 10, '統計期間 · PERIOD', 5.5, '#8fb3d9', true, SlidesApp.ParagraphAlignment.CENTER);
  kpiText_(slide, 602, 23, 100, 14, '全部期間', 10, '#ffffff', true, SlidesApp.ParagraphAlignment.CENTER);
  kpiText_(slide, 602, 36, 100, 10, 'All Time', 6, '#c8d8ea', false, SlidesApp.ParagraphAlignment.CENTER);
  kpiText_(slide, 400, 44, 190, 10, '共 ' + st.recCount + ' 筆紀錄  |  產出日期 ' + today.replace(/-/g, '/') + '  |  NMDC Energy', 5.5, '#9fb8d3', false, SlidesApp.ParagraphAlignment.END);

  // 四個統計卡
  var cards = [
    { zh: '總缺失件數', en: 'TOTAL DEFECTS',    v: st.totalDefects, unit: '條 items',   sub: '累計缺失條數 · Cumulative defect items',           color: '#2563eb' },
    { zh: 'Open 未結',  en: 'NON-CONFORMANCES', v: st.open,         unit: '張 reports', sub: '待改善件數 · Pending non-conformance reports',   color: '#ef4444' },
    { zh: 'Closed 已結', en: 'CLOSED',          v: st.closed,       unit: '張 reports', sub: '已結缺失 ' + st.closedDefs + ' 條 · ' + st.closedDefs + ' defect items closed', color: '#16a34a' },
    { zh: '關單率',     en: 'CLOSURE RATE',     v: st.closeRate,    unit: '%',          sub: '以缺失件數計算 · Calculated by defect count',    color: '#16a34a' }
  ];
  var cw = (W - 28 - 30) / 4, ch = 74, cy = 72;
  cards.forEach(function(c, i) {
    var cx = 14 + i * (cw + 10);
    kpiRect_(slide, cx, cy, cw, ch, '#ffffff', false, LINE);
    kpiRect_(slide, cx, cy, cw, 3, c.color);
    kpiText_(slide, cx + 10, cy + 8, cw - 20, 12, c.zh, 8.5, TEXT, true);
    kpiText_(slide, cx + 10, cy + 19, cw - 20, 9, c.en, 5.5, MUTED, true);
    kpiText_(slide, cx + 10, cy + 27, 90, 30, String(c.v), 24, c.color, true);
    kpiText_(slide, cx + 10 + (String(c.v).length * 13.5) + 4, cy + 41, 60, 12, c.unit, 6.5, MUTED, false);
    kpiText_(slide, cx + 10, cy + 60, cw - 20, 9, c.sub, 5.2, MUTED, false);
  });

  // 左：分類統計
  var lx = 14, ly = 158, lw = 434, lh = 230;
  kpiRect_(slide, lx, ly, lw, lh, '#ffffff', false, LINE);
  kpiText_(slide, lx + 12, ly + 8, 300, 12, '環境缺失分類統計', 9, TEXT, true);
  kpiText_(slide, lx + 12, ly + 20, 300, 9, 'ENVIRONMENTAL DEFECT CATEGORY STATISTICS', 5.2, MUTED, true);
  kpiRect_(slide, lx + 12, ly + 31, lw - 24, 0.75, LINE);
  var items = st.items.slice(0, 8);
  var rowH = items.length ? Math.min(28, (lh - 40) / items.length) : 28;
  var maxTotal = Math.max.apply(null, items.map(function(it) { return it.total; }).concat([1]));
  items.forEach(function(it, i) {
    var ry = ly + 38 + i * rowH;
    kpiRect_(slide, lx + 12, ry + 2, 18, 18, it.color, true);
    kpiText_(slide, lx + 12, ry + 5, 18, 12, it.k, 8, '#ffffff', true, SlidesApp.ParagraphAlignment.CENTER);
    kpiText_(slide, lx + 38, ry, 200, 11, it.name, 7.5, TEXT, true);
    kpiText_(slide, lx + 38, ry + 10, 200, 8, it.en, 5, MUTED, false);
    kpiText_(slide, lx + 230, ry, 120, 9, '已結 ' + it.closed + ' 條  ' + it.closedPct + '%', 5.5, it.closedPct >= 90 ? '#16a34a' : '#b45309', true, SlidesApp.ParagraphAlignment.END);
    kpiText_(slide, lx + 230, ry + 8, 120, 8, it.closed + ' closed · ' + it.closedPct + '%', 4.8, MUTED, false, SlidesApp.ParagraphAlignment.END);
    kpiRect_(slide, lx + 38, ry + rowH - 7, 312, 3, '#e6ecf3', true);
    kpiRect_(slide, lx + 38, ry + rowH - 7, Math.max(6, 312 * it.total / maxTotal), 3, it.color, true);
    kpiText_(slide, lx + 356, ry - 1, 66, 16, String(it.total), 13, it.color, true, SlidesApp.ParagraphAlignment.END);
    kpiText_(slide, lx + 356, ry + 13, 66, 8, it.total + ' items', 4.8, MUTED, false, SlidesApp.ParagraphAlignment.END);
  });
  if (!items.length) kpiText_(slide, lx + 12, ly + 60, lw - 24, 20, '尚無資料 No data', 9, MUTED, false, SlidesApp.ParagraphAlignment.CENTER);

  // 右：圓餅分佈
  var rx = 458, ry0 = 158, rw = 248, rh = 230;
  kpiRect_(slide, rx, ry0, rw, rh, '#ffffff', false, LINE);
  kpiText_(slide, rx + 12, ry0 + 8, 200, 12, '缺失項目分佈', 9, TEXT, true);
  kpiText_(slide, rx + 12, ry0 + 20, 200, 9, 'DEFECT DISTRIBUTION BY CATEGORY', 5.2, MUTED, true);
  kpiRect_(slide, rx + 12, ry0 + 31, rw - 24, 0.75, LINE);
  if (items.length) {
    try {
      var img = slide.insertImage(kpiDonutBlob_(items));
      var ps = 112;
      img.setWidth(ps).setHeight(ps).setLeft(rx + (rw - ps) / 2).setTop(ry0 + 36);
      kpiRect_(slide, rx + rw / 2 - 26, ry0 + 36 + ps / 2 - 26, 52, 52, '#ffffff', false);
      kpiText_(slide, rx + rw / 2 - 30, ry0 + 36 + ps / 2 - 18, 60, 20, String(st.totalDefects), 16, TEXT, true, SlidesApp.ParagraphAlignment.CENTER);
      kpiText_(slide, rx + rw / 2 - 30, ry0 + 36 + ps / 2 + 3, 60, 8, '缺失件數', 5.5, MUTED, true, SlidesApp.ParagraphAlignment.CENTER);
    } catch(e) { Logger.log('圓餅圖產生失敗：' + e.message); }
    var gy = ry0 + 156, gcol = (rw - 24) / 2;
    items.forEach(function(it, i) {
      var gx = rx + 12 + (i % 2) * gcol, yy = gy + Math.floor(i / 2) * 17;
      if (yy > ry0 + rh - 14) return;
      kpiRect_(slide, gx, yy + 3, 7, 7, it.color, true);
      kpiText_(slide, gx + 10, yy, gcol - 40, 9, it.k + '. ' + it.name, 5.8, TEXT, true);
      kpiText_(slide, gx + 10, yy + 8, gcol - 40, 7, it.en, 4.5, MUTED, false);
      kpiText_(slide, gx + gcol - 36, yy, 30, 9, it.pct + '%', 6.5, it.color, true, SlidesApp.ParagraphAlignment.END);
      kpiText_(slide, gx + gcol - 36, yy + 8, 30, 7, it.total + ' 條', 4.5, MUTED, false, SlidesApp.ParagraphAlignment.END);
    });
  }

  // 頁尾
  kpiText_(slide, 14, 393, 300, 9, '環保改善缺失追蹤系統 · Environmental Improvement Defect Tracking System', 5, MUTED, false);
  kpiText_(slide, 406, 393, 300, 9, 'NMDC Energy  ·  產出日期 ' + today.replace(/-/g, '/') + '  ·  由 Environmental E-System 自動產生', 5, MUTED, false, SlidesApp.ParagraphAlignment.END);

  pres.saveAndClose();
  var presId = pres.getId();
  var pageId = slide.getObjectId();
  var blob = null, err = '';
  try {
    var url = 'https://docs.google.com/presentation/d/' + presId + '/export/png?id=' + presId + '&pageid=' + pageId;
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() === 200 && (resp.getBlob().getContentType() || '').indexOf('image') >= 0) blob = resp.getBlob();
    else err = 'export HTTP ' + resp.getResponseCode();
  } catch(e) { err = e.message; }
  try { DriveApp.getFileById(presId).setTrashed(true); } catch(e) {}
  if (!blob) throw new Error('KPI 圖匯出失敗：' + err);
  blob.setName('KPI-summary-' + today + '.png');
  return { blob: blob, stats: st };
}

// 產生後存進週報設定（KPI_CELL），給設定頁「由系統產生」按鈕與排程備援共用
function makeKpiSlideAndStore_(source, previewOnly) {
  var r = buildKpiSlideImage_();
  var file = getWeeklyFolder_().createFile(r.blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
  var cell = previewOnly ? KPI_PREVIEW_CELL : KPI_CELL;
  var old = readJsonCell_(cell);
  if (old && old.fileId) { try { DriveApp.getFileById(old.fileId).setTrashed(true); } catch(e) {} }
  var kpi = { fileId: file.getId(), url: bulImageUrl_(file.getId()), name: r.blob.getName(), uploadedAt: new Date().toISOString(), source: source || 'slides', size: r.blob.getBytes().length };
  getSheet().getRange(cell).setValue(JSON.stringify(kpi));
  return { ok: true, kpi: kpi, stats: r.stats };
}

// 在編輯器執行：產生一張 KPI 圖存到 Drive 週報資料夾，執行紀錄會印出網址，可直接開來看版型
function testKpiSlide() {
  var r = makeKpiSlideAndStore_('slides');
  Logger.log('KPI 圖已產生：' + r.kpi.url + '（總缺失 ' + r.stats.totalDefects + '，未結 ' + r.stats.open + '，已結 ' + r.stats.closed + '，關單率 ' + r.stats.closeRate + '%）');
  return r;
}
