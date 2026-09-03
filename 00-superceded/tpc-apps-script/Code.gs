// =============================================================
//  TPC 海管工程 改善單管理系統 — Google Apps Script v4.0
//  架構：Drive JSON (_index.json + rec_xxx.json)
//  v4.0 新增：郵件通知模組（新增／關單／到期前2天12:00／每週一09:00彙總）
// =============================================================

// ★ 填入你新建的資料 Drive 資料夾 ID
const DATA_FOLDER_ID = '1ETeMbJqTPVXYU_Er05FQNcVc7KeR0Qqi';

const FOLDER_IDS = {
  NCR: '1rRiFjlX-ssqAww4K55HZ8-vPVkd-SF68',
  WM:  '1B4t4jFK37OxhPVec7HLd9oIAHF1bQNL8',
  PN:  '1MmZppFVVU-2dc_-8ZKOfmupdEbk31ced',
};

// 系統網址（信件底部「開啟系統」按鈕）
const SYSTEM_URL = 'https://d9533472.github.io/NMDCEHS-e-system/tpc-pipeline-improvement-system_30.html';
const PROJECT_NAME = '通霄電廠二期更新改建計畫海底輸氣管線統包工程';

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getFolder() {
  if (!DATA_FOLDER_ID || DATA_FOLDER_ID === '______YOUR_DATA_FOLDER_ID______')
    throw new Error('請先在 Code.gs 填入 DATA_FOLDER_ID！');
  return DriveApp.getFolderById(DATA_FOLDER_ID);
}

function findFile(folder, name) {
  var iter = folder.getFilesByName(name);
  return iter.hasNext() ? iter.next() : null;
}

function readJson(folder, name) {
  var f = findFile(folder, name);
  if (!f) return null;
  try { return JSON.parse(f.getBlob().getDataAsString()); } catch(e) { return null; }
}

function writeJson(folder, name, obj) {
  var json = JSON.stringify(obj);
  var f = findFile(folder, name);
  if (f) f.setContent(json);
  else folder.createFile(name, json, 'application/json');
}

// 讀索引（不存在回傳 null）
function readIndex(folder) {
  return readJson(folder, '_index.json');
}

// 寫索引（LockService 保護）
function writeIndex(folder, idx) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    idx.lastSync = new Date().toISOString();
    writeJson(folder, '_index.json', idx);
  } finally { lock.releaseLock(); }
}

// ── doGet ───────────────────────────────────────────────────
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'index';

  if (action === 'ping') {
    var ok = true;
    try { getFolder(); } catch(err) { ok = false; }
    return out({ ok: ok, v: '4.0', folderReady: ok });
  }

  if (action === 'index') {
    try {
      var folder = getFolder();
      var idx = readIndex(folder);
      if (!idx) return out({ records: [], config: {} });
      return out(idx);
    } catch(e) { return out({ ok: false, error: e.message, records: [], config: {} }); }
  }

  // 相容舊版讀 Sheet（遷移用）
  if (action === 'read') {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName('SyncData');
      if (!sh) return out({});
      return out(JSON.parse(sh.getRange('A1').getValue()) || {});
    } catch(e) { return out({}); }
  }

  return out({ ok: false, error: 'Unknown: ' + action });
}

// ── doPost ──────────────────────────────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    // ── 儲存單筆 ─────────────────────────────────────────
    if (action === 'saveRecord') {
      var folder = getFolder();
      var rec = body.record;
      // 寫個別檔
      writeJson(folder, 'rec_' + rec.id + '.json', rec);
      // 更新索引
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        var idx = readIndex(folder) || { records: [], config: {} };
        var i = idx.records.findIndex(function(r){ return String(r.id)===String(rec.id); });
        if (i >= 0) idx.records[i] = rec; else idx.records.unshift(rec);
        idx.lastSync = new Date().toISOString();
        writeJson(folder, '_index.json', idx);
      } finally { lock.releaseLock(); }
      updateReadableSheet();
      return out({ ok: true, success: true });
    }

    // ── 刪除單筆 ─────────────────────────────────────────
    if (action === 'deleteRecord') {
      var folder = getFolder();
      var id = body.id;
      var rf = findFile(folder, 'rec_' + id + '.json');
      if (rf) rf.setTrashed(true);
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        var idx = readIndex(folder) || { records: [], config: {} };
        idx.records = idx.records.filter(function(r){ return String(r.id)!==String(id); });
        idx.lastSync = new Date().toISOString();
        writeJson(folder, '_index.json', idx);
      } finally { lock.releaseLock(); }
      updateReadableSheet();
      return out({ ok: true, success: true });
    }

    // ── 儲存設定 ─────────────────────────────────────────
    if (action === 'saveConfig') {
      var folder = getFolder();
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        var idx = readIndex(folder) || { records: [], config: {} };
        idx.config = body.config;
        idx.lastSync = new Date().toISOString();
        writeJson(folder, '_index.json', idx);
      } finally { lock.releaseLock(); }
      return out({ ok: true, success: true });
    }

    // ── 一次性遷移（舊 Sheet → Drive）────────────────────
    if (action === 'migrateAll') {
      var folder = getFolder();
      var records = body.records || [];
      var config  = body.config  || {};
      // 寫每筆個別檔
      records.forEach(function(rec) {
        writeJson(folder, 'rec_' + rec.id + '.json', rec);
      });
      // 寫索引
      var idx = { records: records, config: config, lastSync: new Date().toISOString() };
      writeJson(folder, '_index.json', idx);
      updateReadableSheet();
      return out({ ok: true, success: true, count: records.length });
    }

    // ── Drive 資料夾操作 ──────────────────────────────────
    if (action === 'getFolderUrl')           return handleGetFolderUrl(body);
    if (action === 'uploadFile')             return handleUploadFile(body);
    if (action === 'archiveAndDeleteFolder') return handleArchiveAndDeleteFolder(body);

    // ── 郵件通知 ─────────────────────────────────────────
    if (action === 'sendMail')       return handleSendMail(body);
    if (action === 'testMail')       return handleTestMail(body);
    if (action === 'runWeeklyNow')   return out(weeklyOpenReport());
    if (action === 'runDeadlineNow') return out(dailyDeadlineNotify());

    return out({ ok: false, error: 'Unknown action: ' + (action||'none') });

  } catch(err) {
    return out({ ok: false, success: false, error: err.message });
  }
}

// ── 可讀工作表同步 ───────────────────────────────────────────
function updateReadableSheet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;
    var folder = getFolder();
    var idx = readIndex(folder);
    if (!idx) return;
    var records = idx.records || [];
    var itemOpts = (idx.config && idx.config.itemOptions) || {};
    var sheetName = '改善單紀錄';
    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
    sheet.clear();
    var headers = ['類型','NMDC編號','缺失日期','單位','開單人','工區','環保項目','缺失說明',
                   '業主通知單編號','關單期限','提交日期','收件者','狀態','罰款金額(NT$)','申覆','Drive連結','備註','缺失條#'];
    var hR = sheet.getRange(1,1,1,headers.length);
    hR.setValues([headers]); hR.setFontWeight('bold');
    hR.setBackground('#0c4a6e'); hR.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    var rows = [];
    records.forEach(function(r) {
      var defs = (r.defects&&r.defects.length>0)?r.defects:[{item:r.item||1,description:r.description||''}];
      defs.forEach(function(d,di) {
        var k = String(d.item||1);
        rows.push([r.type||'',r.number||'',r.date||'',r.unit||'',r.issuer||'',r.area||'',
          k+'.'+(itemOpts[k]||''),d.description||'',r.refNumber||'',r.deadline||'',
          r.submitDate||'',r.recipient||'',r.status||'',r.amount||'',r.appeal||'',
          r.driveFolderUrl||'',r.remark||'',di+1]);
      });
    });
    if (rows.length>0) sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
    try { sheet.autoResizeColumns(1,headers.length); } catch(e){}
  } catch(e) {}
}

// ── Drive 資料夾操作 ─────────────────────────────────────────
function handleGetFolderUrl(body) {
  try {
    var parentId = FOLDER_IDS[body.type];
    if (!parentId) return out({ ok:false, error:'未知類型：'+body.type });
    var folderName = (body.date||'')+' '+(body.number||'');
    var parent = DriveApp.getFolderById(parentId);
    var search = parent.getFoldersByName(folderName);
    var folder = search.hasNext() ? search.next() : parent.createFolder(folderName);
    return out({ ok:true, url:folder.getUrl(), folderId:folder.getId(), name:folderName });
  } catch(e) { return out({ ok:false, error:e.message }); }
}

function handleUploadFile(body) {
  try {
    var parts = body.dataUrl.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, body.fileName||'file');
    var file = DriveApp.getFolderById(body.folderId).createFile(blob);
    return out({ ok:true, url:file.getUrl(), fileId:file.getId(), name:file.getName() });
  } catch(e) { return out({ ok:false, error:e.message }); }
}

function handleArchiveAndDeleteFolder(body) {
  try {
    var orig = DriveApp.getFolderById(body.folderId);
    var parentIter = orig.getParents();
    var parent = parentIter.hasNext() ? parentIter.next() : DriveApp.getFolderById(FOLDER_IDS[body.type]);
    var arch = parent.createFolder(body.archiveName);
    var files = orig.getFiles();
    while (files.hasNext()) files.next().makeCopy(arch);
    var subs = orig.getFolders();
    while (subs.hasNext()) {
      var sub = subs.next();
      var sc = arch.createFolder(sub.getName());
      var sf = sub.getFiles();
      while (sf.hasNext()) sf.next().makeCopy(sc);
    }
    orig.setTrashed(true);
    return out({ ok:true, archiveName:body.archiveName });
  } catch(e) { return out({ ok:false, error:e.message }); }
}


// =============================================================
//  ██  郵件通知模組  ██
// =============================================================
//  寄信規則
//   ・新增／關單通知：依工區 → mailConfig.areaRecipients[工區]
//                     未設定者 → mailConfig.defaultRecipients
//   ・到期前 2 天 12:00：同上規則（dailyDeadlineNotify，每日觸發器）
//   ・每週一 09:00：未關單彙總 → mailConfig.weeklyRecipients
//  收件人一律於系統「設定」頁維護，存在 _index.json 的 config.mailConfig
// =============================================================

var MAIL_THEME = {
  navy:   '#0c4a6e',
  cyan:   '#0e7490',
  sky:    '#7dd3fc',
  text:   '#1f2937',
  muted:  '#6b7280',
  line:   '#e5e7eb',
  bg:     '#f4f6f8',
  red:    '#dc2626',
  redBg:  '#fef2f2',
  orange: '#d97706',
  orgBg:  '#fffbeb',
  green:  '#059669',
  grnBg:  '#ecfdf5',
};

// ── 設定與工具 ───────────────────────────────────────────────
function getIndexSafe_() {
  try { return readIndex(getFolder()) || { records: [], config: {} }; }
  catch(e) { return { records: [], config: {} }; }
}

function getMailConfig_(override) {
  var cfg = (getIndexSafe_().config || {}).mailConfig || {};
  if (override) {
    // 前端傳入的設定優先（設定頁尚未儲存時仍可測試）
    return {
      enabled:          override.enabled !== false,
      areaRecipients:   override.areaRecipients   || cfg.areaRecipients   || {},
      defaultRecipients:override.defaultRecipients|| cfg.defaultRecipients|| '',
      cc:               override.cc               || cfg.cc               || '',
      weeklyRecipients: override.weeklyRecipients || cfg.weeklyRecipients || '',
      senderName:       override.senderName       || cfg.senderName       || 'NMDC 環保改善追蹤系統',
    };
  }
  return {
    enabled:          cfg.enabled !== false,
    areaRecipients:   cfg.areaRecipients    || {},
    defaultRecipients:cfg.defaultRecipients || '',
    cc:               cfg.cc                || '',
    weeklyRecipients: cfg.weeklyRecipients  || '',
    senderName:       cfg.senderName        || 'NMDC 環保改善追蹤系統',
  };
}

function getItemOptions_(override) {
  if (override && Object.keys(override).length) return override;
  return (getIndexSafe_().config || {}).itemOptions || {};
}

// 工區 → 收件人
function resolveRecipients_(mc, area) {
  var map = mc.areaRecipients || {};
  var to = String(map[area] || '').trim();
  if (!to) to = String(mc.defaultRecipients || '').trim();
  return normalizeMails_(to);
}

function normalizeMails_(s) {
  return String(s || '').split(/[,;\s]+/).map(function(x){ return x.trim(); })
    .filter(function(x){ return x && x.indexOf('@') > 0; }).join(',');
}

function tz_()      { return Session.getScriptTimeZone() || 'Asia/Taipei'; }
function todayStr_(){ return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function addDaysStr_(days) {
  var d = new Date(); d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}
function daysBetween_(fromStr, toStr) {
  var a = new Date(fromStr + 'T00:00:00'), b = new Date(toStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function dash_(s) { s = String(s == null ? '' : s).trim(); return s || '—'; }

// 取得該筆改善單的 Drive 資料夾連結（沒有就找同名資料夾，再沒有則回類型母資料夾）
function folderUrlFor_(rec) {
  if (rec.driveFolderUrl) return rec.driveFolderUrl;
  try {
    var parentId = FOLDER_IDS[rec.type];
    if (!parentId) return '';
    var parent = DriveApp.getFolderById(parentId);
    var name = (rec.date || '') + ' ' + (rec.number || '');
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next().getUrl() : parent.getUrl();
  } catch(e) { return ''; }
}

// ── HTML 版型元件 ────────────────────────────────────────────
function mailShell_(headTitle, headSub, accent, bodyHtml) {
  var T = MAIL_THEME;
  return '' +
  '<div style="margin:0;padding:24px 12px;background:' + T.bg + ';font-family:\'Segoe UI\',\'Microsoft JhengHei\',\'PingFang TC\',Arial,sans-serif;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:660px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ' + T.line + ';">' +
      // Header
      '<tr><td style="background:' + T.navy + ';background-image:linear-gradient(135deg,' + T.navy + ' 0%,' + T.cyan + ' 100%);padding:24px 28px;">' +
        '<div style="color:' + T.sky + ';font-size:11px;letter-spacing:1.5px;font-weight:600;">NMDC ENVIRONMENTAL &nbsp;|&nbsp; 環保改善追蹤系統</div>' +
        '<div style="color:#ffffff;font-size:21px;font-weight:700;margin-top:8px;line-height:1.35;">' + headTitle + '</div>' +
        (headSub ? '<div style="color:#cbe9fb;font-size:12px;margin-top:6px;">' + headSub + '</div>' : '') +
      '</td></tr>' +
      // Accent bar
      '<tr><td style="height:4px;background:' + accent + ';font-size:0;line-height:0;">&nbsp;</td></tr>' +
      // Body
      '<tr><td style="padding:26px 28px 8px 28px;color:' + T.text + ';font-size:14px;line-height:1.7;">' + bodyHtml + '</td></tr>' +
      // Footer
      '<tr><td style="padding:18px 28px 24px 28px;border-top:1px solid ' + T.line + ';color:' + T.muted + ';font-size:11px;line-height:1.8;">' +
        '<div style="font-weight:600;color:#374151;">' + esc_(PROJECT_NAME) + '</div>' +
        '<div>本信件由系統自動發送，請勿直接回覆。收件人設定可於系統「⚙️ 設定 → 📧 郵件通知設定」調整。</div>' +
        '<div style="margin-top:4px;">發送時間：' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm') + '</div>' +
      '</td></tr>' +
    '</table>' +
  '</div>';
}

function infoTable_(rows) {
  var T = MAIL_THEME;
  var html = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid ' + T.line + ';border-radius:10px;overflow:hidden;">';
  rows.forEach(function(r, i) {
    var bg = i % 2 === 0 ? '#fafbfc' : '#ffffff';
    html += '<tr>' +
      '<td style="background:' + bg + ';padding:11px 14px;border-bottom:1px solid ' + T.line + ';color:' + T.muted + ';font-size:12px;font-weight:600;white-space:nowrap;width:118px;">' + r[0] + '</td>' +
      '<td style="background:' + bg + ';padding:11px 14px;border-bottom:1px solid ' + T.line + ';color:' + T.text + ';font-size:13px;font-weight:600;">' + r[1] + '</td>' +
    '</tr>';
  });
  return html + '</table>';
}

function badge_(text, color, bg) {
  return '<span style="display:inline-block;padding:3px 10px;border-radius:20px;background:' + bg + ';color:' + color + ';font-size:12px;font-weight:700;">' + text + '</span>';
}

function button_(url, text, color) {
  if (!url) return '';
  return '<a href="' + esc_(url) + '" target="_blank" style="display:inline-block;padding:12px 24px;background:' + color + ';color:#ffffff !important;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">' + text + '</a>';
}

// 缺失項目清單
function defectsHtml_(rec, itemOpts) {
  var T = MAIL_THEME;
  var defs = (rec.defects && rec.defects.length > 0)
    ? rec.defects : [{ item: rec.item || 1, description: rec.description || '' }];
  var html = '';
  defs.forEach(function(d) {
    var k = String(d.item || 1);
    var name = itemOpts[k] || '';
    html += '<tr><td style="padding:10px 14px;border-bottom:1px solid ' + T.line + ';vertical-align:top;">' +
      '<div style="font-size:12px;color:' + T.cyan + ';font-weight:700;margin-bottom:3px;">' + esc_(k + '. ' + name) + '</div>' +
      '<div style="font-size:13px;color:' + T.text + ';line-height:1.6;">' + esc_(dash_(d.description)) + '</div>' +
    '</td></tr>';
  });
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid ' + T.line + ';border-radius:10px;overflow:hidden;background:#fafbfc;">' + html + '</table>';
}

// 期限徽章（依剩餘天數變色）
function deadlineBadge_(deadline, status) {
  var T = MAIL_THEME;
  if (status === 'Closed') return badge_('✅ 已關單', T.green, T.grnBg);
  if (!deadline || deadline === '-') return badge_('未設定期限', T.muted, '#f3f4f6');
  var left = daysBetween_(todayStr_(), deadline);
  if (left < 0)  return badge_('🔴 已逾期 ' + Math.abs(left) + ' 天', T.red, T.redBg);
  if (left === 0) return badge_('🔴 今日到期', T.red, T.redBg);
  if (left <= 3) return badge_('🟠 剩餘 ' + left + ' 天', T.orange, T.orgBg);
  return badge_('剩餘 ' + left + ' 天', T.cyan, '#ecfeff');
}

// ── 單筆改善單信件 ───────────────────────────────────────────
// kind：'new' 新增 ｜ 'closed' 關單 ｜ 'due' 到期提醒
function buildRecordMail_(rec, itemOpts, kind) {
  var T = MAIL_THEME;
  var url = folderUrlFor_(rec);
  var cfgTitle, accent, lead, subject;
  var left = (rec.deadline && rec.deadline !== '-') ? daysBetween_(todayStr_(), rec.deadline) : null;

  if (kind === 'closed') {
    cfgTitle = '✅ 改善單結案通知';
    accent = T.green;
    lead = '下列改善單已完成改善並關單，敬請知悉。';
    subject = '【改善單已關單】' + (rec.number || '') + '｜' + (rec.area || '') + '｜' + PROJECT_NAME;
  } else if (kind === 'due') {
    cfgTitle = '⏰ 改善單到期提醒';
    accent = T.orange;
    lead = '下列改善單將於 <b style="color:' + T.red + ';">' + esc_(rec.deadline) + '</b> 到期（尚餘 ' + left + ' 天），請儘速完成改善並辦理關單。';
    subject = '【到期提醒｜剩 ' + left + ' 天】' + (rec.number || '') + '｜' + (rec.area || '') + '｜期限 ' + (rec.deadline || '');
  } else {
    cfgTitle = '📋 新增改善單通知';
    accent = T.cyan;
    lead = '系統已新增下列改善單，請相關人員於期限前完成改善並上傳佐證資料。';
    subject = '【新增改善單】' + (rec.number || '') + '｜' + (rec.area || '') + '｜期限 ' + (rec.deadline || '');
  }

  var rows = [
    ['改善單編號', '<span style="font-family:Consolas,monospace;font-size:14px;color:' + T.navy + ';">' + esc_(dash_(rec.number)) + '</span>' +
                   (rec.type ? ' <span style="font-size:11px;color:' + T.muted + ';">(' + esc_(rec.type) + ')</span>' : '')],
    ['缺失日期',   esc_(dash_(rec.date))],
    ['單位',       esc_(dash_(rec.unit))],
    ['開單人',     esc_(dash_(rec.issuer))],
    ['工區',       esc_(dash_(rec.area))],
    ['關單期限',   '<span style="font-family:Consolas,monospace;">' + esc_(dash_(rec.deadline)) + '</span> &nbsp; ' + deadlineBadge_(rec.deadline, rec.status)],
  ];
  if (rec.refNumber) rows.splice(1, 0, ['業主通知單號', esc_(rec.refNumber)]);
  if (kind === 'closed') {
    if (rec.submitDate) rows.push(['提交日期', esc_(rec.submitDate)]);
    if (rec.recipient)  rows.push(['關單人',   esc_(rec.recipient)]);
  }

  var body =
    '<div style="margin:0 0 18px 0;font-size:14px;color:' + T.text + ';">' + lead + '</div>' +
    infoTable_(rows) +
    '<div style="margin:22px 0 8px 0;font-size:13px;font-weight:700;color:' + T.navy + ';">📌 缺失項目</div>' +
    defectsHtml_(rec, itemOpts) +
    (rec.remark ? '<div style="margin-top:16px;padding:12px 14px;background:#fafbfc;border-left:3px solid ' + T.line + ';font-size:12px;color:' + T.muted + ';">備註：' + esc_(rec.remark) + '</div>' : '') +
    '<div style="margin:26px 0 6px 0;text-align:center;">' +
      button_(url, '📂 開啟雲端資料夾', T.navy) +
      (SYSTEM_URL ? '&nbsp;&nbsp;' + button_(SYSTEM_URL, '🖥️ 開啟系統', T.cyan) : '') +
    '</div>' +
    (url ? '<div style="margin:10px 0 18px 0;text-align:center;font-size:11px;color:' + T.muted + ';word-break:break-all;">' +
      '若按鈕無法點擊，請複製此連結：<br/><a href="' + esc_(url) + '" style="color:' + T.cyan + ';">' + esc_(url) + '</a></div>' : '');

  return {
    subject: subject,
    html: mailShell_(cfgTitle, esc_(PROJECT_NAME), accent, body),
  };
}

// ── 前端呼叫：新增／關單通知 ─────────────────────────────────
function handleSendMail(body) {
  try {
    var mc = getMailConfig_(body.mailConfig);
    if (!mc.enabled) return out({ ok: false, error: '郵件通知未啟用' });

    var rec = body.record;
    if (!rec) return out({ ok: false, error: '缺少 record' });

    var to = resolveRecipients_(mc, rec.area);
    if (!to) return out({ ok: false, error: '工區「' + (rec.area||'') + '」與預設收件人皆未設定信箱' });

    var mail = buildRecordMail_(rec, getItemOptions_(body.itemOptions), body.kind || 'new');
    var opt = { to: to, subject: mail.subject, htmlBody: mail.html, name: mc.senderName };
    var cc = normalizeMails_(mc.cc);
    if (cc) opt.cc = cc;
    MailApp.sendEmail(opt);

    return out({ ok: true, to: to, cc: cc || '', subject: mail.subject });
  } catch(e) { return out({ ok: false, error: e.message }); }
}

// ── 前端呼叫：測試信 ─────────────────────────────────────────
function handleTestMail(body) {
  try {
    var mc = getMailConfig_(body.mailConfig);
    var to = normalizeMails_(body.to || mc.defaultRecipients);
    if (!to) return out({ ok: false, error: '未提供有效的測試收件信箱' });

    var demo = {
      type: 'NCR', number: 'NCR-TEST', date: todayStr_(), unit: 'TPC',
      issuer: '系統測試', area: '通霄工區', deadline: addDaysStr_(2), status: 'Open',
      refNumber: 'TEST-0001', remark: '這是一封測試信，用於確認郵件設定是否正確。',
      defects: [{ item: 1, description: '此為測試用缺失內容，實際寄信時會顯示真實缺失說明。' }],
      driveFolderUrl: '',
    };
    var mail = buildRecordMail_(demo, getItemOptions_(), 'new');
    MailApp.sendEmail({ to: to, subject: '【測試信】' + mail.subject, htmlBody: mail.html, name: mc.senderName });

    var quota = MailApp.getRemainingDailyQuota();
    return out({ ok: true, to: to, quota: quota });
  } catch(e) { return out({ ok: false, error: e.message }); }
}

// =============================================================
//  ⏰ 定時觸發：到期前 2 天 12:00 提醒
// =============================================================
function dailyDeadlineNotify() {
  var mc = getMailConfig_();
  if (!mc.enabled) return { ok: false, error: '郵件通知未啟用' };

  var idx = getIndexSafe_();
  var itemOpts = (idx.config || {}).itemOptions || {};
  var target = addDaysStr_(2);               // 兩天後到期者
  var sent = 0, skipped = [];

  (idx.records || []).forEach(function(rec) {
    if (rec.status === 'Closed') return;
    if (!rec.deadline || rec.deadline === '-') return;
    if (String(rec.deadline).slice(0,10) !== target) return;

    var to = resolveRecipients_(mc, rec.area);
    if (!to) { skipped.push(rec.number + '(無收件人)'); return; }

    var mail = buildRecordMail_(rec, itemOpts, 'due');
    var opt = { to: to, subject: mail.subject, htmlBody: mail.html, name: mc.senderName };
    var cc = normalizeMails_(mc.cc);
    if (cc) opt.cc = cc;
    MailApp.sendEmail(opt);
    sent++;
  });

  Logger.log('dailyDeadlineNotify：目標期限 ' + target + '，已寄 ' + sent + ' 封，略過 ' + skipped.join('、'));
  return { ok: true, target: target, sent: sent, skipped: skipped };
}

// =============================================================
//  🗓️ 定時觸發：每週一 09:00 未關單彙總
// =============================================================
function weeklyOpenReport() {
  var T = MAIL_THEME;
  var mc = getMailConfig_();
  if (!mc.enabled) return { ok: false, error: '郵件通知未啟用' };

  var to = normalizeMails_(mc.weeklyRecipients || mc.defaultRecipients);
  if (!to) return { ok: false, error: '未設定週報收件人' };

  var idx = getIndexSafe_();
  var itemOpts = (idx.config || {}).itemOptions || {};
  var today = todayStr_();

  var open = (idx.records || []).filter(function(r){ return r.status !== 'Closed'; });
  open.sort(function(a, b) {
    var da = (a.deadline && a.deadline !== '-') ? a.deadline : '9999-12-31';
    var db = (b.deadline && b.deadline !== '-') ? b.deadline : '9999-12-31';
    return da < db ? -1 : da > db ? 1 : 0;
  });

  var overdue = 0, near = 0;
  open.forEach(function(r) {
    if (!r.deadline || r.deadline === '-') return;
    var d = daysBetween_(today, r.deadline);
    if (d < 0) overdue++; else if (d <= 7) near++;
  });

  // 統計卡
  var stat = function(label, value, color) {
    return '<td width="33%" style="padding:14px 10px;text-align:center;background:#fafbfc;border:1px solid ' + T.line + ';border-radius:10px;">' +
      '<div style="font-size:26px;font-weight:700;color:' + color + ';font-family:Consolas,monospace;">' + value + '</div>' +
      '<div style="font-size:11px;color:' + T.muted + ';margin-top:4px;">' + label + '</div></td>';
  };
  var statsHtml = '<table role="presentation" cellpadding="0" cellspacing="6" border="0" width="100%"><tr>' +
    stat('未關單總數', open.length, T.navy) +
    stat('已逾期', overdue, T.red) +
    stat('7 天內到期', near, T.orange) +
  '</tr></table>';

  // 明細表
  var th = function(t, w) {
    return '<th style="padding:10px 8px;background:' + T.navy + ';color:#fff;font-size:11px;font-weight:700;text-align:left;' + (w ? 'width:' + w + ';' : '') + '">' + t + '</th>';
  };
  var rowsHtml = '';
  open.forEach(function(r, i) {
    var url  = folderUrlFor_(r);
    var left = (r.deadline && r.deadline !== '-') ? daysBetween_(today, r.deadline) : null;
    var bg   = (left !== null && left < 0) ? T.redBg : (left !== null && left <= 3 ? T.orgBg : (i % 2 === 0 ? '#ffffff' : '#fafbfc'));
    var defs = (r.defects && r.defects.length > 0) ? r.defects : [{ item: r.item || 1, description: r.description || '' }];
    var defText = defs.map(function(d) {
      var k = String(d.item || 1);
      return (itemOpts[k] ? k + '.' + itemOpts[k] + '｜' : '') + (d.description || '');
    }).join('<br/>');
    var td = 'padding:9px 8px;border-bottom:1px solid ' + T.line + ';font-size:12px;color:' + T.text + ';vertical-align:top;background:' + bg + ';';

    // 第一列：基本欄位；第二列：缺失項目（跨欄，避免文字被擠壓）
    var tdTop = td + 'border-bottom:none;padding-bottom:4px;';
    rowsHtml += '<tr>' +
      '<td style="' + tdTop + 'font-family:Consolas,monospace;font-weight:700;white-space:nowrap;">' + esc_(dash_(r.number)) + '</td>' +
      '<td style="' + tdTop + 'white-space:nowrap;">' + esc_(dash_(r.date)) + '</td>' +
      '<td style="' + tdTop + '">' + esc_(dash_(r.unit)) + '</td>' +
      '<td style="' + tdTop + 'white-space:nowrap;">' + esc_(dash_(r.issuer)) + '</td>' +
      '<td style="' + tdTop + 'white-space:nowrap;">' + esc_(dash_(r.area)) + '</td>' +
      '<td style="' + tdTop + 'white-space:nowrap;">' + esc_(dash_(r.deadline)) + '<br/>' + deadlineBadge_(r.deadline, r.status) + '</td>' +
      '<td style="' + tdTop + 'white-space:nowrap;">' + (url ? '<a href="' + esc_(url) + '" style="color:' + T.cyan + ';font-weight:700;text-decoration:none;">📂 開啟</a>' : '—') + '</td>' +
    '</tr>' +
    '<tr><td colspan="7" style="' + td + 'padding-top:0;line-height:1.65;color:' + T.muted + ';font-size:12px;">' +
      '<span style="color:' + T.navy + ';font-weight:700;">缺失項目：</span>' + defText +
    '</td></tr>';
  });

  var tableHtml = open.length
    ? '<div style="overflow-x:auto;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid ' + T.line + ';border-radius:10px;overflow:hidden;">' +
        '<tr>' + th('改善單編號','96px') + th('缺失日期','86px') + th('單位','52px') + th('開單人','70px') + th('工區','76px') + th('關單期限','104px') + th('雲端','60px') + '</tr>' +
        rowsHtml +
      '</table></div>'
    : '<div style="padding:26px;text-align:center;background:' + T.grnBg + ';border-radius:10px;color:' + T.green + ';font-size:15px;font-weight:700;">🎉 目前沒有未關單的改善單，全部結案！</div>';

  var body =
    '<div style="margin:0 0 18px 0;">本週未關單改善單彙總如下（統計基準日：' + today + '）。<br/>逾期與 3 天內到期項目已以底色標示，請優先處理。</div>' +
    statsHtml +
    '<div style="margin:22px 0 8px 0;font-size:13px;font-weight:700;color:' + T.navy + ';">📋 未關單明細（依關單期限排序）</div>' +
    tableHtml +
    (SYSTEM_URL ? '<div style="margin:26px 0 8px 0;text-align:center;">' + button_(SYSTEM_URL, '🖥️ 開啟改善單管理系統', T.navy) + '</div>' : '');

  var subject = '【每週未關單彙總】' + today + '｜未關單 ' + open.length + ' 件（逾期 ' + overdue + ' 件）';
  var opt = { to: to, subject: subject, htmlBody: mailShell_('🗓️ 每週未關單彙總報表', esc_(PROJECT_NAME), T.navy, body), name: mc.senderName };
  MailApp.sendEmail(opt);

  Logger.log('weeklyOpenReport：寄給 ' + to + '，未關單 ' + open.length + ' 件');
  return { ok: true, to: to, open: open.length, overdue: overdue };
}

// =============================================================
//  🔧 觸發器安裝 —— 部署後在編輯器手動執行一次 setupMailTriggers()
// =============================================================
function setupMailTriggers() {
  var names = ['dailyDeadlineNotify', 'weeklyOpenReport'];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('dailyDeadlineNotify')
    .timeBased().everyDays(1).atHour(12).nearMinute(0).create();

  ScriptApp.newTrigger('weeklyOpenReport')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(0).create();

  Logger.log('✅ 觸發器已安裝：每日 12:00 到期提醒、每週一 09:00 未關單彙總');
  return '✅ 觸發器已安裝完成';
}

function listMailTriggers() {
  var s = ScriptApp.getProjectTriggers().map(function(t) {
    return t.getHandlerFunction() + ' / ' + t.getEventType();
  }).join('\n');
  Logger.log(s || '（目前沒有任何觸發器）');
  return s;
}
