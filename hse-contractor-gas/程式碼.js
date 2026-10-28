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

function doGet() {
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

/** 寄通知信；失敗不影響送出（資料已經寫進去了）。 */
function notify_(rec, blobs) {
  try {
    var hz = String(rec.hazard);
    var hi = hz.search(/[A-Za-z]/);
    var hzZh = hi > 0 ? hz.slice(0, hi).trim() : hz;
    var subject = '[HSE 承包商回報] ' + rec.contractor + ' · ' + hzZh + ' · ' + rec.date + ' ' + rec.time;

    var row = function (k, zh, en) {
      return '<tr><td style="padding:9px 14px;border-top:1px solid #eef1f4;color:#7d8ea0;font-weight:700;' +
        'white-space:nowrap;vertical-align:top;width:96px">' + k + '</td>' +
        '<td style="padding:9px 14px;border-top:1px solid #eef1f4;line-height:1.55;color:#1c2732">' + esc_(zh) +
        (en ? '<div style="color:#5a6b7c;font-size:12.5px;margin-top:2px">' + esc_(en) + '</div>' : '') + '</td></tr>';
    };
    var inline = {}, pics = '';
    blobs.forEach(function (b, i) {
      inline['p' + i] = b;
      pics += '<img src="cid:p' + i + '" style="width:31%;max-width:180px;border-radius:8px;margin:0 1% 8px 0;' +
        'border:1px solid #dfe4ea;vertical-align:top">';
    });
    var link = MAIN_URL + '&d=' + rec.date;
    var html =
      '<div style="background:#eef2f6;padding:22px 10px;font-family:\'Microsoft JhengHei\',\'PingFang TC\',Arial,sans-serif">' +
      '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e3e9f0">' +
      '<div style="background:#002038;background:linear-gradient(90deg,#002038,#0b3c60);color:#fff;padding:14px 18px">' +
      '<div style="font-size:11px;letter-spacing:2px;opacity:.8">CONTRACTOR HSE REPORT · ' + esc_(SITE) + '</div>' +
      '<div style="font-size:18px;font-weight:800;margin-top:3px">承包商安全回報　' + esc_(rec.contractor) + '</div></div>' +
      '<div style="height:4px;background:#00B050"></div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
      row('日期時間', rec.date + ' ' + rec.time) +
      row('填報人', rec.reporter + '（' + rec.contractor + '）') +
      row('危害種類', rec.hazard) +
      row('巡查發現', rec.obsZh, rec.obsEn) +
      row('改善建議', rec.recZh, rec.recEn) +
      '</table>' +
      (pics ? '<div style="padding:12px 14px 4px;border-top:1px solid #eef1f4">' +
        '<div style="font-size:12px;color:#7d8ea0;font-weight:700;margin-bottom:8px">改善前照片 BEFORE（' + blobs.length + '）</div>' + pics + '</div>' : '') +
      '<div style="padding:8px 14px 18px">' +
      '<a href="' + link + '" style="display:block;text-align:center;background:#00B050;color:#fff;text-decoration:none;' +
      'font-weight:800;border-radius:10px;padding:12px">開啟巡查系統，查看 ' + rec.date + ' →</a>' +
      '<div style="font-size:11.5px;color:#8a97a5;margin-top:10px;line-height:1.6">這筆已自動匯入巡查系統，狀態為「開放中」。' +
      '權責單位、風險等級、預定完成日期請在系統內按「編輯」補上。</div></div>' +
      '</div></div>';
    MailApp.sendEmail({
      to: NOTIFY.join(','),
      subject: subject,
      htmlBody: html,
      inlineImages: inline,
      name: 'NMDC HSE 承包商回報'
    });
    return true;
  } catch (e) {
    console.error('notify failed: ' + (e && e.message || e));
    return false;
  }
}
