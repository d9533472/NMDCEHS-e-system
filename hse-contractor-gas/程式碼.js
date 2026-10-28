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
var CONTRACTOR_PAGE = 'https://script.google.com/macros/s/AKfycbxudeT6PVO69kzOb0sEbeADyTpcMeExayzfZpKxRzRbxRh8k3EMLghjawUagGhzWJYnZA/exec';
// 業主自己不是承包商，不出現在承包商的選項裡
var HIDE_CONTRACTORS = ['NMDC'];
var MAX_PHOTOS = 6;
var MAX_LEN = 2000;

function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.act === 'overdue') {
    var od;
    try {
      if (q.key !== OVERDUE_KEY) throw new Error('unauthorized');
      od = overdueRun_(q.force === '1');
    } catch (err) { od = { ok: false, error: String(err && err.message || err) }; }
    return ContentService.createTextOutput(JSON.stringify(od)).setMimeType(ContentService.MimeType.JSON);
  }
  if (q.act === 'overduepreview') {
    var pv;
    try {
      if (q.key !== TEST_KEY) throw new Error('unauthorized');
      if (NOTIFY.indexOf(String(q.to || '')) < 0) throw new Error('收件人不在通知名單內');
      pv = overdueRun_(false, String(q.to));
    } catch (err) { pv = { ok: false, error: String(err && err.message || err) }; }
    return ContentService.createTextOutput(JSON.stringify(pv)).setMimeType(ContentService.MimeType.JSON);
  }
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
  var out = { contractors: [], hazards: [], project: 'MFY', contractorDays: 3 };
  try {
    var sh = SpreadsheetApp.openById(SS_ID).getSheetByName('Settings');
    var n = sh.getLastRow();
    if (n > 1) {
      sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
        if (['contractors', 'hazards', 'project', 'contractorDays'].indexOf(r[0]) < 0) return;
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

function days_(cfg) { var n = parseInt(cfg.contractorDays, 10); return n > 0 && n <= 60 ? n : 3; }
function addDays_(ymd, n) {
  var p = ymd.split('-');
  return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2] + n, 12), TZ, 'yyyy-MM-dd');
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
      actionBy: '', risk: '', targetDate: addDays_(date, days_(cfg)), status: 'Open', closeOutDate: '',
      createdAt: stamp_(now), updatedAt: stamp_(now), deleted: '', source: 'contractor'
    };
    rec.days = days_(cfg);   // 只給通知信用；表頭沒有這欄，不會寫進試算表

    // 改善後照片是選填；有附就直接結案（跟主系統貼改善後照片一樣），結案日＝今天
    var blobs = [], after = [];
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var ss = SpreadsheetApp.openById(SS_ID);
      var folder = DriveApp.getFolderById(PHOTO_ID);
      var psh = ss.getSheetByName('Photos');
      var save = function (list, kind, out) {
        (list || []).slice(0, MAX_PHOTOS).forEach(function (ph, i) {
          var d = ph && ph.data;
          if (!d || d.length > 4000000) return;
          try {
            var name = date + '_' + rec.id + '_' + kind + '_' + (i + 1) + '.jpg';
            var blob = Utilities.newBlob(Utilities.base64Decode(d), 'image/jpeg', name);
            var f = folder.createFile(blob);
            try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
            appendByHeader_(psh, {
              id: newId_('P'), recordId: rec.id, kind: kind, fileId: f.getId(),
              name: name, createdAt: stamp_(new Date()), deleted: ''
            });
            out.push(blob);
          } catch (e) { }
        });
      };
      save(p.photos, 'before', blobs);
      save(p.photosAfter, 'after', after);
      // 照片先存完再寫紀錄，才知道改善後照片有沒有真的存進去
      if (after.length) { rec.status = 'Closed'; rec.closeOutDate = Utilities.formatDate(now, TZ, 'yyyy-MM-dd'); }
      appendByHeader_(ss.getSheetByName('Records'), rec);
    } finally {
      lock.releaseLock();
    }

    var mailed = notify_(rec, blobs, after);
    return { ok: true, id: rec.id, photoCount: blobs.length, afterCount: after.length, mailed: mailed,
      targetDate: rec.targetDate, closed: rec.status === 'Closed' };
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
function notify_(rec, blobs, after) {
  try {
    var m = buildMail_(rec, blobs, after);
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
function buildMail_(rec, blobs, after, opt) {
  opt = opt || {};
  blobs = blobs || []; after = after || [];
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

  // 照片區：一張就滿版，兩張以上一列兩張。pre＝內嵌圖片代號前綴（p 改善前／q 改善後）
  var gallery = function (list, pre, zhLabel, enLabel, color) {
    if (!list.length) return '';
    var one = list.length === 1, cells = [];
    list.forEach(function (b, i) {
      inline[pre + i] = b;
      cells.push('<td width="' + (one ? '100%' : '50%') + '" valign="top" style="padding:' + (one ? '0 0 12px 0' : (i % 2 ? '0 0 12px 6px' : '0 6px 12px 0')) + '">' +
        '<img src="cid:' + pre + i + '" width="' + (one ? 544 : 266) + '" alt="' + zhLabel + ' ' + (i + 1) + '" ' +
        'style="display:block;width:100%;max-width:' + (one ? 544 : 266) + 'px;height:auto;border-radius:12px;border:1px solid #e3e9f0"></td>');
    });
    var rows = '';
    for (var r = 0; r < cells.length; r += 2) rows += '<tr>' + cells[r] + (cells[r + 1] || (one ? '' : '<td width="50%"></td>')) + '</tr>';
    return '<tr><td style="padding:24px 28px 0">' +
      '<div style="' + F + 'font-size:11px;letter-spacing:1.5px;font-weight:800;color:' + color + '">' + zhLabel +
      '　<span style="color:#9aa6b2">' + enLabel + ' · ' + list.length + '</span></div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">' + rows + '</table></td></tr>';
  };
  var pics = gallery(blobs, 'p', '改善前照片', 'BEFORE', '#546e7a') +
    gallery(after, 'q', '改善後照片', 'AFTER', '#1b8a4a');
  var closed = rec.status === 'Closed';
  var todo = closed
    ? '<b style="color:#1b6e3c">承包商已附改善後照片，系統已自動結案</b>' + (rec.closeOutDate ? '（結案日 ' + esc_(rec.closeOutDate) + '）' : '') +
      '<br>如照片不符可按「編輯這一筆」重新開啟；權責單位 · 風險等級可視需要補填。'
    : '<b style="color:#b26a00">改善期限 ' + esc_(rec.targetDate || '—') + '</b>（預設巡查日起 ' + (rec.days || 3) + ' 天內）' +
      '<br>待 NMDC 補填：權責單位 · 風險等級；期限可在系統內調整。';

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
    (closed
      ? '<span style="' + F + 'display:inline-block;background:#e2f2e6;color:#1b6e3c;font-size:12px;font-weight:900;border-radius:999px;padding:6px 12px;white-space:nowrap">✓ 已結案 CLOSED</span>'
      : '<span style="' + F + 'display:inline-block;background:#fff3df;color:#b26a00;font-size:12px;font-weight:900;border-radius:999px;padding:6px 12px;white-space:nowrap">● 開放中 OPEN</span>') +
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
    todo + '</td></tr></table></td></tr>' +
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
  var all = read('Photos');
  var recs = read('Records');
  var kinds = function (id, k) { return all.filter(function (p) { return p.recordId === id && p.kind === k; }); };
  // 優先挑最近一筆「改善前、改善後都有照片」的紀錄，才看得到兩區照片；沒有就退回只有改善前的
  var rec = null;
  [true, false].forEach(function (needAfter) {
    for (var i = all.length - 1; i >= 0 && !rec; i--) {
      var hit = recs.filter(function (x) { return x.id === all[i].recordId; })[0];
      if (hit && kinds(hit.id, 'before').length && (!needAfter || kinds(hit.id, 'after').length)) rec = hit;
    }
  });
  if (!rec) throw new Error('找不到有照片的紀錄');
  var ph = kinds(rec.id, 'before'), pa = kinds(rec.id, 'after');
  var fmtD = function (v, f) { return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, TZ, f) : String(v || ''); };
  var r = {
    id: rec.id, date: fmtD(rec.date, 'yyyy-MM-dd'), time: fmtD(rec.time, 'HH:mm'),
    reporter: rec.reporter || '陳志明', contractor: rec.contractor || '琿宏HH', hazard: rec.hazard || '其他 Other',
    obsZh: rec.obsZh, obsEn: rec.obsEn, recZh: rec.recZh, recEn: rec.recEn
  };
  var blob = function (p) { return DriveApp.getFileById(p.fileId).getBlob(); };
  var blobs = ph.slice(0, MAX_PHOTOS).map(blob), after = pa.slice(0, MAX_PHOTOS).map(blob);
  var cfg = publicCfg_();
  r.days = days_(cfg);
  r.targetDate = addDays_(r.date, r.days);
  if (after.length) { r.status = 'Closed'; r.closeOutDate = fmtD(rec.closeOutDate, 'yyyy-MM-dd') || r.date; }
  var m = buildMail_(r, blobs, after, { test: true });
  MailApp.sendEmail({ to: to, subject: m.subject, htmlBody: m.html, body: m.text, inlineImages: m.inline, name: 'NMDC HSE 承包商回報' });
  return { ok: true, to: to, record: r.id, date: r.date, photos: blobs.length, after: after.length };
}

/* ============================ 逾期通知承包商 ============================ */

/**
 * 主系統每天 08:00 用 ?act=overdue&key=… 叫這裡一次（主系統沒有寄信權限）。
 * 讀主系統 Settings：overdueMail 沒開就什麼都不做；開了就把「未結案且預定完成日已過」的改善單
 * 依承包商分組，每個有填負責人信箱的承包商寄一封彙整信。
 * 同一天只寄一次（記在指令碼屬性），避免重複觸發時連寄。
 * previewTo：只把信寄給這個 NMDC 信箱預覽（不寄承包商、不記錄），測試用。
 */
var OVERDUE_KEY = 'nmdc-hse-overdue-2026';

function readSheet_(ss, name) {
  var sh = ss.getSheetByName(name), v = sh.getDataRange().getValues(), h = v.shift();
  return v.map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; })
    .filter(function (o) { return o.id && String(o.deleted) !== '1'; });
}
function ymdOf_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '').trim();
}
function fullCfg_(ss) {
  var out = {};
  var sh = ss.getSheetByName('Settings'), n = sh.getLastRow();
  if (n > 1) sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
    if (!r[0]) return;
    try { out[r[0]] = JSON.parse(r[1]); } catch (e) { out[r[0]] = r[1]; }
  });
  return out;
}
function mails_(s) {
  return String(s || '').split(/[,;，]/).map(function (x) { return x.trim(); })
    .filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
}

function overdueRun_(force, previewTo) {
  var ss = SpreadsheetApp.openById(SS_ID);
  var cfg = fullCfg_(ss);
  if (!previewTo && !cfg.overdueMail) return { ok: true, skipped: 'overdueMail off' };
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  if (!previewTo && !force && props.getProperty('OVERDUE_SENT') === today) return { ok: true, skipped: 'already sent today' };

  var emails = cfg.contractorEmails || {};
  var photos = readSheet_(ss, 'Photos');
  var groups = {};
  readSheet_(ss, 'Records').forEach(function (x) {
    var st = String(x.status || 'Open');
    if (st === 'Closed' || st === 'Pending') return;
    var td = ymdOf_(x.targetDate);
    if (!td || td >= today || !x.contractor) return;
    (groups[x.contractor] = groups[x.contractor] || []).push(x);
  });

  // 預覽時如果目前沒有逾期項目，就拿最近兩筆有照片的紀錄假裝逾期 2 天，好看得到版面
  if (previewTo && !Object.keys(groups).length) {
    var recs = readSheet_(ss, 'Records'), ids = {}, demo = [];
    for (var i = photos.length - 1; i >= 0 && demo.length < 2; i--) {
      var hit = recs.filter(function (x) { return x.id === photos[i].recordId; })[0];
      if (hit && !ids[hit.id]) { ids[hit.id] = 1; demo.push(hit); }
    }
    var p0 = today.split('-');
    var past = Utilities.formatDate(new Date(+p0[0], p0[1] - 1, +p0[2] - 2, 12), TZ, 'yyyy-MM-dd');
    demo.forEach(function (x) { x.targetDate = past; });
    if (demo.length) groups[demo[0].contractor || '琿宏HH'] = demo;
  }

  var sent = [], noMail = [];
  Object.keys(groups).forEach(function (con) {
    var to = mails_(emails[con]);
    if (!previewTo && !to.length) { noMail.push(con); return; }
    var list = groups[con].sort(function (a, b) { return ymdOf_(a.targetDate).localeCompare(ymdOf_(b.targetDate)); });
    var m = buildOverdueMail_(con, list, photos, today, !!previewTo);
    var opt = { subject: m.subject, htmlBody: m.html, body: m.text, inlineImages: m.inline, name: 'NMDC HSE' };
    if (previewTo) opt.to = previewTo;
    else {
      opt.to = to.join(',');
      var cc = mails_(cfg.overdueCc);
      if (cc.length) opt.cc = cc.join(',');
      opt.replyTo = cc.length ? cc[0] : NOTIFY[0];
    }
    MailApp.sendEmail(opt);
    sent.push({ contractor: con, items: list.length, to: opt.to });
  });
  if (!previewTo) props.setProperty('OVERDUE_SENT', today);
  return { ok: true, today: today, sent: sent, noEmail: noMail };
}

function buildOverdueMail_(con, list, photos, today, preview) {
  var F = "font-family:'Microsoft JhengHei','PingFang TC','Noto Sans TC',Arial,sans-serif;";
  var inline = { logo: Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'nmdc.png') };
  var dd = function (a, b) {
    var p = a.split('-'), q = b.split('-');
    return Math.round((Date.UTC(+q[0], q[1] - 1, +q[2]) - Date.UTC(+p[0], p[1] - 1, +p[2])) / 86400000);
  };
  var maxOver = 0;
  var items = list.map(function (x, i) {
    var td = ymdOf_(x.targetDate), over = dd(td, today);
    if (over > maxOver) maxOver = over;
    var hz = splitHz_(x.hazard);
    var ph = photos.filter(function (p) { return p.recordId === x.id && p.kind === 'before'; })[0];
    var img = '';
    if (ph && i < 10) {
      try {
        inline['o' + i] = DriveApp.getFileById(ph.fileId).getBlob();
        img = '<td width="120" valign="top" style="padding-left:14px"><img src="cid:o' + i + '" width="120" alt="" ' +
          'style="display:block;width:120px;height:auto;border-radius:10px;border:1px solid #e3e9f0"></td>';
      } catch (e) { }
    }
    return '<tr><td style="padding:0 28px 14px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1d4d4;border-radius:14px">' +
      '<tr><td style="padding:14px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top">' +
      '<div style="' + F + 'font-size:11px;font-weight:800;letter-spacing:.5px;color:#8a97a5">' + esc_(ymdOf_(x.date)) +
      (hz.zh ? '　·　' + esc_(hz.zh) : '') + '</div>' +
      '<div style="' + F + 'font-size:15px;line-height:1.6;color:#1c2732;font-weight:700;margin-top:4px">' + esc_(x.obsZh) + '</div>' +
      (x.obsEn ? '<div style="' + F + 'font-size:12.5px;line-height:1.5;color:#6b7784;margin-top:2px">' + esc_(x.obsEn) + '</div>' : '') +
      '<div style="' + F + 'font-size:13px;line-height:1.55;color:#1b6e3c;margin-top:8px"><b>改善建議</b>　' + esc_(x.recZh) + '</div>' +
      '<div style="margin-top:10px"><span style="' + F + 'display:inline-block;background:#fde3e3;color:#c62828;font-size:12px;font-weight:900;' +
      'border-radius:999px;padding:4px 10px">已逾期 ' + over + ' 天</span>' +
      '<span style="' + F + 'font-size:12px;color:#8a97a5;margin-left:8px">改善期限 ' + esc_(td) + '</span></div>' +
      '</td>' + img + '</tr></table></td></tr></table></td></tr>';
  }).join('');

  var subject = (preview ? '[測試] ' : '') + '[NMDC HSE] 逾期未改善通知｜' + con + '｜' + list.length + ' 項';
  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
    '<body style="margin:0;padding:0;background:#eef2f6">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef2f6" style="background:#eef2f6"><tr>' +
    '<td align="center" style="padding:28px 12px">' +
    (preview ? '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px"><tr>' +
      '<td bgcolor="#fff3df" style="' + F + 'background:#fff3df;border:1px solid #f1d9a8;border-radius:10px;padding:10px 16px;font-size:13px;color:#7a4b00">' +
      '⚠ 預覽：這是寄給承包商「' + esc_(con) + '」的逾期通知樣式，這封只寄給你，沒有寄給承包商。</td></tr>' +
      '<tr><td height="12" style="font-size:0;line-height:0">&nbsp;</td></tr></table>' : '') +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">' +
    '<tr><td style="padding:0 4px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td><img src="cid:logo" width="96" height="32" alt="NMDC ENERGY" style="display:block;border:0"></td>' +
    '<td align="right" style="' + F + 'font-size:11px;letter-spacing:2px;color:#7d8ea0;font-weight:700">HSE · ' + esc_(SITE) + '</td>' +
    '</tr></table></td></tr>' +
    '<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e1e7ee;border-radius:18px;overflow:hidden">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td bgcolor="#7f1d1d" style="background:#7f1d1d;padding:24px 28px 22px;border-radius:18px 18px 0 0">' +
    '<div style="' + F + 'font-size:11px;letter-spacing:2px;color:#fca5a5;font-weight:800">逾期未改善通知 · OVERDUE NOTICE</div>' +
    '<div style="' + F + 'font-size:23px;line-height:1.35;color:#ffffff;font-weight:900;margin-top:8px">' + esc_(con) + '　共 ' + list.length + ' 項逾期</div>' +
    '<div style="' + F + 'font-size:13px;color:#fecaca;margin-top:4px">最久已逾期 ' + maxOver + ' 天，請儘速完成改善並回報。</div>' +
    '</td></tr>' +
    '<tr><td height="4" bgcolor="#c62828" style="background:#c62828;font-size:0;line-height:0">&nbsp;</td></tr>' +
    '<tr><td style="' + F + 'padding:20px 28px 16px;font-size:14px;line-height:1.7;color:#38475a">' +
    '您好，以下為貴公司於 NMDC 通霄工區的 HSE 改善項目，已超過改善期限仍未結案。' +
    '請儘速完成改善，並透過「承包商安全回報」頁面上傳改善後照片，或直接回覆此信告知改善情形。</td></tr>' +
    items +
    '<tr><td style="padding:6px 28px 26px">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>' +
    '<td align="center" bgcolor="#00a24a" style="border-radius:12px;background:#00a24a">' +
    '<a href="' + CONTRACTOR_PAGE + '" style="' + F + 'display:block;padding:15px 18px;font-size:16px;font-weight:800;letter-spacing:.5px;text-decoration:none;color:#ffffff">' +
    '開啟承包商安全回報頁 →</a></td></tr></table></td></tr>' +
    '</table></td></tr>' +
    '<tr><td align="center" style="' + F + 'padding:16px 10px 0;font-size:11px;line-height:1.7;color:#98a2ad">' +
    '此信由 NMDC HSE 系統於每天 08:00 自動寄出，項目結案後就不會再收到。<br>NMDC ENERGY · HSE Walkthrough</td></tr>' +
    '</table></td></tr></table></body></html>';

  var text = subject + '\n\n' + list.map(function (x) {
    return '- ' + ymdOf_(x.date) + ' ' + x.obsZh + '（改善期限 ' + ymdOf_(x.targetDate) + '）';
  }).join('\n') + '\n\n承包商安全回報頁：' + CONTRACTOR_PAGE;
  return { subject: subject, html: html, text: text, inline: inline };
}

