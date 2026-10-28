/**
 * NMDC ENERGY — HSE 承包商安全回報（Contractor HSE Report）
 *
 * 給承包商用的獨立填報頁：打開就能填，看不到巡查系統。
 * 送出後直接寫進「HSE 現場巡查紀錄系統」（hse-walkthrough-gas）同一份試算表與照片資料夾，
 * source 欄標成 contractor，主系統下次載入就看得到；同時寄信通知 NOTIFY 名單。
 *
 * 寫入一律照目標工作表第一列的表頭對欄位，主系統以後往後加欄也不會錯位。
 * 這支腳本只會「新增」，沒有任何讀取紀錄的介面。
 */

var TZ = 'Asia/Taipei';
// 主系統的試算表與照片資料夾（主系統網址加 &act=ids 可以查）
var SS_ID = '1IX1HEYawggWckrna-KXreql1PaGCT2B_F88HUC081wk';
var PHOTO_ID = '16r0BfZD8S1u7ijhf4-qurHZ7tSIxUDbM';
var MAIN_URL = 'https://script.google.com/macros/s/AKfycbxxfb4fozcpxhpmVBwatua8n_kY7FfKWCJ_0CyXmno0FQB73VneOVLkPRIVqqq7mxRtZA/exec?k=nmdc-hse-2026-key';
var NOTIFY = [
  'jin.wang@nmdc-group.com',
  'raymond.huang@nmdc-group.com',
  'ben.cheng@nmdc-group.com',
  'elson.liu@nmdc-group.com',
  'paul.tong@nmdc-group.com'
];
var SITE = 'NMDC 通霄工區';
// 業主自己不是承包商，不出現在承包商的選項裡
var HIDE_CONTRACTORS = ['NMDC'];
var MAX_PHOTOS = 6;
var MAX_LEN = 2000;

function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.act === 'testmail') {
    var out;
    try {
      if (q.key !== TEST_KEY) throw new Error('unauthorized');
      out = testMail_(String(q.to || ''));
    } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }
  var t = HtmlService.createTemplateFromFile('頁面');
  t.LOGO = LOGO_B64;
  // 放進 <script> 裡，先把 "</" 拆開免得提早結束標籤
  t.CFG = JSON.stringify(publicCfg_()).replace(/<\//g, '<\\/');
  return t.evaluate()
    .setTitle('NMDC 承包商安全回報 Contractor HSE Report')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 第一次部署後在編輯器執行一次，完成授權（不然匿名訪客會拿到 403）。 */
function setup() {
  var ss = SpreadsheetApp.openById(SS_ID);
  DriveApp.getFolderById(PHOTO_ID).getName();
  Logger.log('OK：' + ss.getName() + '／寄信額度剩 ' + MailApp.getRemainingDailyQuota());
}

/** 承包商頁只需要承包商清單、危害種類與專案名稱，其餘設定不外流。 */
function publicCfg_() {
  var out = { contractors: [], hazards: [], project: 'MFY' };
  try {
    var sh = SpreadsheetApp.openById(SS_ID).getSheetByName('Settings');
    var n = sh.getLastRow();
    if (n > 1) {
      sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
        if (['contractors', 'hazards', 'project'].indexOf(r[0]) < 0) return;
        try { out[r[0]] = JSON.parse(r[1]); } catch (e) { out[r[0]] = r[1]; }
      });
    }
  } catch (e) { }
  out.contractors = (out.contractors || []).filter(function (c) { return HIDE_CONTRACTORS.indexOf(c) < 0; });
  return out;
}

function cTranslate(text) {
  try {
    var s = clip_(text);
    if (!s) return { ok: true, text: '' };
    return { ok: true, text: LanguageApp.translate(s, 'zh-TW', 'en') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function clip_(v) { return String(v == null ? '' : v).trim().slice(0, MAX_LEN); }
function newId_(p) { return p + Date.now().toString(36) + Math.random().toString(36).substring(2, 7); }
function stamp_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss'); }

/** 照表頭對欄位寫一列；表頭沒有的鍵就略過，物件沒有的欄位留白。 */
function appendByHeader_(sh, obj) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(head.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; }));
}

function cSubmit(p) {
  p = p || {};
  try {
    if (p.hp) return { ok: true, id: '' };   // 隱藏欄位被填 → 機器人，假裝成功
    var date = clip_(p.date), time = clip_(p.time);
    var reporter = clip_(p.reporter).slice(0, 60);
    var contractor = clip_(p.contractor).slice(0, 60);
    var hazard = clip_(p.hazard).slice(0, 120);
    var obsZh = clip_(p.obsZh), recZh = clip_(p.recZh);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('請選擇日期 Please pick a date');
    if (!/^\d{2}:\d{2}$/.test(time)) time = Utilities.formatDate(new Date(), TZ, 'HH:mm');
    if (!reporter) throw new Error('請填寫填報人 Please enter the reporter');
    if (!contractor) throw new Error('請選擇承包商 Please choose a contractor');
    if (!hazard) throw new Error('請選擇危害種類 Please choose a hazard type');
    if (!obsZh) throw new Error('請填寫巡查發現 Please enter the observation');
    if (!recZh) throw new Error('請填寫改善建議 Please enter the recommendation');

    // 英文欄留白（例如翻譯還沒回來就按送出）就在這裡補翻
    var obsEn = clip_(p.obsEn) || cTranslate(obsZh).text || '';
    var recEn = clip_(p.recEn) || cTranslate(recZh).text || '';

    var cfg = publicCfg_();
    var now = new Date();
    var rec = {
      id: newId_('R'), date: date, time: time, reporter: reporter, members: '',
      project: cfg.project || 'MFY', contractor: contractor, hazard: hazard,
      obsZh: obsZh, obsEn: obsEn, recZh: recZh, recEn: recEn,
      actionBy: '', risk: '', targetDate: '', status: 'Open', closeOutDate: '',
      createdAt: stamp_(now), updatedAt: stamp_(now), deleted: '', source: 'contractor'
    };

    var photos = (p.photos || []).slice(0, MAX_PHOTOS);
    var blobs = [];
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var ss = SpreadsheetApp.openById(SS_ID);
      appendByHeader_(ss.getSheetByName('Records'), rec);
      var folder = DriveApp.getFolderById(PHOTO_ID);
      var psh = ss.getSheetByName('Photos');
      photos.forEach(function (ph, i) {
        var d = ph && ph.data;
        if (!d || d.length > 4000000) return;
        try {
          var name = date + '_' + rec.id + '_before_' + (i + 1) + '.jpg';
          var blob = Utilities.newBlob(Utilities.base64Decode(d), 'image/jpeg', name);
          var f = folder.createFile(blob);
          try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
          appendByHeader_(psh, {
            id: newId_('P'), recordId: rec.id, kind: 'before', fileId: f.getId(),
            name: name, createdAt: stamp_(new Date()), deleted: ''
          });
          blobs.push(blob);
        } catch (e) { }
      });
    } finally {
      lock.releaseLock();
    }

    var mailed = notify_(rec, blobs);
    return { ok: true, id: rec.id, photoCount: blobs.length, mailed: mailed };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ============================ 通知信 ============================ */

/** 寄通知信；失敗不影響送出（資料已經寫進去了）。 */
function notify_(rec, blobs) {
  try {
    var m = buildMail_(rec, blobs);
    MailApp.sendEmail({
      to: NOTIFY.join(','), subject: m.subject, htmlBody: m.html, body: m.text,
      inlineImages: m.inline, name: 'NMDC HSE 承包商回報'
    });
    return true;
  } catch (e) {
    console.error('notify failed: ' + (e && e.message || e));
    return false;
  }
}

function splitHz_(s) {
  var t = String(s || '').trim();
  var i = t.search(/[A-Za-z]/);
  return i > 0 ? { zh: t.slice(0, i).trim(), en: t.slice(i).trim() } : { zh: t, en: '' };
}

/**
 * 信件版面全部用 table＋行內樣式＋bgcolor：公司信箱多半是 Outlook，
 * 它不吃 div 寬度、漸層和 flex，只有表格排版兩邊都穩。
 */
function buildMail_(rec, blobs, opt) {
  opt = opt || {};
  var F = "font-family:'Microsoft JhengHei','PingFang TC','Noto Sans TC',Arial,sans-serif;";
  var hz = splitHz_(rec.hazard);
  var subject = (opt.test ? '[測試] ' : '') + '[HSE 承包商回報] ' + rec.contractor + '｜' + hz.zh + '｜' + rec.date + ' ' + rec.time;
  var editUrl = MAIN_URL + '&d=' + rec.date + '&e=' + encodeURIComponent(rec.id);
  var dayUrl = MAIN_URL + '&d=' + rec.date;
  var inline = { logo: Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'nmdc.png') };

  var meta = function (label, val, last) {
    return '<td width="25%" valign="top" style="padding:14px 16px;' + (last ? '' : 'border-right:1px solid #e6ebf1;') + '">' +
      '<div style="' + F + 'font-size:10px;letter-spacing:1.2px;color:#8a97a5;font-weight:700">' + label + '</div>' +
      '<div style="' + F + 'font-size:15px;color:#002038;font-weight:800;margin-top:4px;line-height:1.3">' + esc_(val) + '</div></td>';
  };
  var block = function (zhLabel, enLabel, color, zh, en) {
    return '<tr><td style="padding:22px 28px 0">' +
      '<div style="' + F + 'font-size:11px;letter-spacing:1.5px;font-weight:800;color:' + color + '">' +
      zhLabel + '　<span style="color:#9aa6b2">' + enLabel + '</span></div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>' +
      '<td width="4" bgcolor="' + color + '" style="background:' + color + ';border-radius:2px">&nbsp;</td>' +
      '<td style="padding:2px 0 2px 14px">' +
      '<div style="' + F + 'font-size:16px;line-height:1.65;color:#1c2732;font-weight:600">' + esc_(zh) + '</div>' +
      (en ? '<div style="' + F + 'font-size:13px;line-height:1.55;color:#6b7784;margin-top:4px">' + esc_(en) + '</div>' : '') +
      '</td></tr></table></td></tr>';
  };

  var pics = '';
  if (blobs.length) {
    var one = blobs.length === 1, cells = [];
    blobs.forEach(function (b, i) {
      inline['p' + i] = b;
      cells.push('<td width="' + (one ? '100%' : '50%') + '" valign="top" style="padding:' + (one ? '0 0 12px 0' : (i % 2 ? '0 0 12px 6px' : '0 6px 12px 0')) + '">' +
        '<img src="cid:p' + i + '" width="' + (one ? 544 : 266) + '" alt="改善前照片 ' + (i + 1) + '" ' +
        'style="display:block;width:100%;max-width:' + (one ? 544 : 266) + 'px;height:auto;border-radius:12px;border:1px solid #e3e9f0"></td>');
    });
    var rows = '';
    for (var r = 0; r < cells.length; r += 2) rows += '<tr>' + cells[r] + (cells[r + 1] || (one ? '' : '<td width="50%"></td>')) + '</tr>';
    pics = '<tr><td style="padding:24px 28px 0">' +
      '<div style="' + F + 'font-size:11px;letter-spacing:1.5px;font-weight:800;color:#546e7a">改善前照片　<span style="color:#9aa6b2">BEFORE · ' + blobs.length + '</span></div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">' + rows + '</table></td></tr>';
  }

  var btn = function (href, label, primary) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>' +
      '<td align="center" bgcolor="' + (primary ? '#00a24a' : '#ffffff') + '" style="border-radius:12px;' +
      (primary ? 'background:#00a24a;' : 'border:1.5px solid #c9d3de;') + '">' +
      '<a href="' + href + '" style="' + F + 'display:block;padding:' + (primary ? '15px' : '12px') + ' 18px;font-size:' + (primary ? '16px' : '14px') +
      ';font-weight:800;letter-spacing:.5px;text-decoration:none;color:' + (primary ? '#ffffff' : '#16324f') + '">' + label + '</a></td></tr></table>';
  };

  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
    '<body style="margin:0;padding:0;background:#eef2f6">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef2f6" style="background:#eef2f6"><tr>' +
    '<td align="center" style="padding:28px 12px">' +
    (opt.test ? '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px"><tr>' +
      '<td bgcolor="#fff3df" style="' + F + 'background:#fff3df;border:1px solid #f1d9a8;border-radius:10px;padding:10px 16px;font-size:13px;color:#7a4b00">' +
      '⚠ 測試信：內容取自系統內一筆既有紀錄，用來預覽承包商回報的通知信。下方「編輯這一筆」會打開那筆既有紀錄。</td></tr>' +
      '<tr><td height="12" style="font-size:0;line-height:0">&nbsp;</td></tr></table>' : '') +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">' +
    // 標誌列
    '<tr><td style="padding:0 4px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td><img src="cid:logo" width="96" height="32" alt="NMDC ENERGY" style="display:block;border:0"></td>' +
    '<td align="right" style="' + F + 'font-size:11px;letter-spacing:2px;color:#7d8ea0;font-weight:700">HSE · ' + esc_(SITE) + '</td>' +
    '</tr></table></td></tr>' +
    // 主卡片
    '<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e1e7ee;border-radius:18px;overflow:hidden">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    // 墨藍頁首
    '<tr><td bgcolor="#002038" style="background:#002038;padding:24px 28px 22px;border-radius:18px 18px 0 0">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top">' +
    '<div style="' + F + 'font-size:11px;letter-spacing:2px;color:#4fd18b;font-weight:800">承包商安全回報 · CONTRACTOR REPORT</div>' +
    '<div style="' + F + 'font-size:24px;line-height:1.3;color:#ffffff;font-weight:900;margin-top:8px">' + esc_(hz.zh) + '</div>' +
    (hz.en ? '<div style="' + F + 'font-size:13px;color:#9fb6cb;margin-top:3px">' + esc_(hz.en) + '</div>' : '') +
    '</td><td valign="top" align="right" width="110">' +
    '<span style="' + F + 'display:inline-block;background:#fff3df;color:#b26a00;font-size:12px;font-weight:900;border-radius:999px;padding:6px 12px;white-space:nowrap">● 開放中 OPEN</span>' +
    '</td></tr></table></td></tr>' +
    '<tr><td height="4" bgcolor="#00B050" style="background:#00B050;font-size:0;line-height:0">&nbsp;</td></tr>' +
    // 基本資料四格
    '<tr><td bgcolor="#f7f9fb" style="background:#f7f9fb;border-bottom:1px solid #e6ebf1">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    meta('承包商', rec.contractor) + meta('填報人', rec.reporter) +
    meta('日期', rec.date) + meta('時間', rec.time, true) +
    '</tr></table></td></tr>' +
    block('巡查發現', 'OBSERVATION', '#c07a18', rec.obsZh, rec.obsEn) +
    block('改善建議', 'RECOMMENDATION', '#1b8a4a', rec.recZh, rec.recEn) +
    pics +
    // 待補欄位
    '<tr><td style="padding:22px 28px 0">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td bgcolor="#fffaf0" style="' + F + 'background:#fffaf0;border:1px dashed #efd29a;border-radius:12px;padding:12px 16px;font-size:13px;line-height:1.6;color:#7a5a1e">' +
    '<b style="color:#b26a00">待 NMDC 補填</b>　權責單位 · 風險等級 · 預定完成日期</td></tr></table></td></tr>' +
    // 按鈕
    '<tr><td style="padding:22px 28px 6px">' + btn(editUrl, '✎　編輯這一筆', true) + '</td></tr>' +
    '<tr><td style="padding:4px 28px 26px">' + btn(dayUrl, '查看 ' + rec.date + ' 全部巡查紀錄 →', false) + '</td></tr>' +
    '</table></td></tr>' +
    // 頁尾
    '<tr><td align="center" style="' + F + 'padding:16px 10px 0;font-size:11px;line-height:1.7;color:#98a2ad">' +
    '此信由 NMDC HSE 承包商安全回報系統自動寄出，請勿直接回覆。<br>NMDC ENERGY · HSE Walkthrough</td></tr>' +
    '</table></td></tr></table></body></html>';

  var text = subject + '\n\n承包商：' + rec.contractor + '\n填報人：' + rec.reporter +
    '\n日期時間：' + rec.date + ' ' + rec.time + '\n危害種類：' + rec.hazard +
    '\n\n巡查發現：' + rec.obsZh + (rec.obsEn ? '\n' + rec.obsEn : '') +
    '\n\n改善建議：' + rec.recZh + (rec.recEn ? '\n' + rec.recEn : '') +
    '\n\n編輯這一筆：' + editUrl;
  return { subject: subject, html: html, text: text, inline: inline };
}

/**
 * 寄一封測試信預覽版面：拿系統裡最近一筆「有改善前照片」的紀錄當內容。
 * 只能寄給 NOTIFY 名單內的人，且要帶 TEST_KEY。用法：/exec?act=testmail&key=…&to=…
 */
var TEST_KEY = 'nmdc-hse-mailtest';
function testMail_(to) {
  if (NOTIFY.indexOf(to) < 0) throw new Error('收件人不在通知名單內');
  var ss = SpreadsheetApp.openById(SS_ID);
  var read = function (name) {
    var sh = ss.getSheetByName(name), v = sh.getDataRange().getValues(), h = v.shift();
    return v.map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; })
      .filter(function (o) { return o.id && String(o.deleted) !== '1'; });
  };
  var photos = read('Photos').filter(function (p) { return p.kind === 'before'; });
  var recs = read('Records');
  var rec = null, ph = [];
  for (var i = photos.length - 1; i >= 0 && !rec; i--) {
    var hit = recs.filter(function (x) { return x.id === photos[i].recordId; })[0];
    if (hit) { rec = hit; ph = photos.filter(function (p) { return p.recordId === hit.id; }); }
  }
  if (!rec) throw new Error('找不到有照片的紀錄');
  var fmtD = function (v, f) { return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, TZ, f) : String(v || ''); };
  var r = {
    id: rec.id, date: fmtD(rec.date, 'yyyy-MM-dd'), time: fmtD(rec.time, 'HH:mm'),
    reporter: rec.reporter || '陳志明', contractor: rec.contractor || '琿宏HH', hazard: rec.hazard || '其他 Other',
    obsZh: rec.obsZh, obsEn: rec.obsEn, recZh: rec.recZh, recEn: rec.recEn
  };
  var blobs = ph.slice(0, MAX_PHOTOS).map(function (p) { return DriveApp.getFileById(p.fileId).getBlob(); });
  var m = buildMail_(r, blobs, { test: true });
  MailApp.sendEmail({ to: to, subject: m.subject, htmlBody: m.html, body: m.text, inlineImages: m.inline, name: 'NMDC HSE 承包商回報' });
  return { ok: true, to: to, record: r.id, date: r.date, photos: blobs.length };
}

