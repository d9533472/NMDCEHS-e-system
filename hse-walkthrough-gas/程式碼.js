/**
 * NMDC ENERGY — HSE INSPECTION walkthrough (MFY)
 * HSE 現場巡查紀錄系統 — Google Apps Script 後端
 *
 * 輸出格式對齊範本：HSE Walkthrough Inspection_中英.docx
 *   A4 橫式、7 欄主表（S/N｜OBSERVATIONS｜RECOMMENDATIONS｜ACTION BY｜STATUS｜TARGET DATE｜CLOSE-OUT DATE）
 *   表頭含 NMDC 標誌、Team Members／Project and Location／Date／Time
 *   每筆下方加一列跨欄的「改善前 BEFORE／改善後 AFTER」照片列
 *   文末 Distribution 分發對象表
 *
 * 注意：本檔只處理自己的試算表與 Drive 資料夾，與既有的環安衛管理系統完全獨立。
 */

var ACCESS_KEY = 'nmdc-hse-2026-key';
var TZ = 'Asia/Taipei';

var PK = {
  ssId: 'HSE_WT_SS_ID',
  rootId: 'HSE_WT_ROOT_ID',
  photoId: 'HSE_WT_PHOTO_ID',
  reportId: 'HSE_WT_REPORT_ID'
};

var SH = { rec: 'Records', pho: 'Photos', cfg: 'Settings', rep: 'Reports' };
var SCHEMA = 'v1';

var REC_COLS = ['id', 'date', 'time', 'reporter', 'members', 'project', 'area',
  'obsZh', 'obsEn', 'recZh', 'recEn', 'actionBy', 'risk', 'targetDate',
  'status', 'closeOutDate', 'createdAt', 'updatedAt', 'deleted'];
var PHO_COLS = ['id', 'recordId', 'kind', 'fileId', 'name', 'createdAt', 'deleted'];
var REP_COLS = ['date', 'docId', 'pdfId', 'docxId', 'generatedAt'];

var DEFAULTS = {
  members: ['Jin', 'Ben', 'Raymond', 'Elson'],
  actionBy: ['Construction 施工', 'Piping 配管', 'Structure 結構', 'Painting 塗裝',
    'E&I 電儀', 'Scaffolding 鷹架', 'Lifting 吊掛', 'Logistics 物流',
    'Subcontractor 協力廠商', 'HSE 環安衛'],
  areas: ['MFY Yard 場區', 'Workshop 廠房', 'Assembly Area 組裝區',
    'Blasting & Painting 噴砂塗裝區', 'Jetty 碼頭', 'Warehouse 倉庫', 'Office 辦公區'],
  project: 'MFY',
  riskDays: { P1: 3, P2: 7, P3: 14 },
  hseRep: '',
  sectionRep: ''
};

/* ============================ 入口 ============================ */

function doGet(e) {
  var k = (e && e.parameter && e.parameter.k) || '';
  if (k !== ACCESS_KEY) {
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="font-family:system-ui;padding:40px;text-align:center;color:#46566a">' +
      '<h2 style="color:#16324f">NMDC ENERGY</h2>' +
      '<p>HSE Walkthrough Inspection</p>' +
      '<p style="color:#c62828">網址不正確或缺少存取金鑰。<br>Invalid link or missing access key.</p></div>'
    ).setTitle('HSE Walkthrough Inspection');
  }
  var t = HtmlService.createTemplateFromFile('頁面');
  t.KEY = ACCESS_KEY;
  return t.evaluate()
    .setTitle('HSE 現場巡查紀錄')
    .addMetaTag('viewport', 'width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function auth_(key) {
  if (key !== ACCESS_KEY) throw new Error('未授權 Unauthorized');
}

/* ============================ 初始化 ============================ */

function setup() {
  var r = ensure_();
  var out = 'Spreadsheet: ' + SpreadsheetApp.openById(r.ssId).getUrl() +
    '\nDrive 資料夾: ' + DriveApp.getFolderById(r.rootId).getUrl();
  Logger.log(out);
  return out;
}

function ensure_() {
  var p = PropertiesService.getScriptProperties();
  var ssId = p.getProperty(PK.ssId);
  var ss;
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (err) { ssId = null; }
  }
  var rootId = p.getProperty(PK.rootId);
  var root;
  if (rootId) {
    try { root = DriveApp.getFolderById(rootId); } catch (err) { rootId = null; }
  }
  if (!root) {
    root = DriveApp.createFolder('NMDC HSE Walkthrough 現場巡查紀錄');
    rootId = root.getId();
    p.setProperty(PK.rootId, rootId);
    p.deleteProperty(PK.photoId);
    p.deleteProperty(PK.reportId);
  }
  var photoId = subFolder_(p, root, PK.photoId, '照片 Photos');
  var reportId = subFolder_(p, root, PK.reportId, '報告 Reports');

  if (!ss) {
    ss = SpreadsheetApp.create('HSE Walkthrough 巡查資料');
    ssId = ss.getId();
    p.setProperty(PK.ssId, ssId);
    try { DriveApp.getFileById(ssId).moveTo(root); } catch (err) { }
    var first = ss.getSheets()[0];
    first.setName(SH.rec);
    p.deleteProperty('HSE_WT_SCHEMA');
  }
  // 每次呼叫都重建表頭很浪費時間；結構確認過一次就記下來。
  if (p.getProperty('HSE_WT_SCHEMA') !== SCHEMA + '|' + ssId) {
    headers_(ss, SH.rec, REC_COLS);
    headers_(ss, SH.pho, PHO_COLS);
    headers_(ss, SH.rep, REP_COLS);
    headers_(ss, SH.cfg, ['key', 'value']);
    seedConfig_(ss);
    p.setProperty('HSE_WT_SCHEMA', SCHEMA + '|' + ssId);
  }
  return { ssId: ssId, rootId: rootId, photoId: photoId, reportId: reportId, ss: ss };
}

function subFolder_(p, root, propKey, name) {
  var id = p.getProperty(propKey);
  if (id) {
    try { DriveApp.getFolderById(id); return id; } catch (err) { }
  }
  var it = root.getFoldersByName(name);
  var f = it.hasNext() ? it.next() : root.createFolder(name);
  p.setProperty(propKey, f.getId());
  return f.getId();
}

function headers_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (cur.join('|') !== cols.join('|')) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#eef1f6');
  }
  return sh;
}

function seedConfig_(ss) {
  var sh = ss.getSheetByName(SH.cfg);
  var have = {};
  var n = sh.getLastRow();
  if (n > 1) {
    sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) { if (r[0]) have[r[0]] = 1; });
  }
  var add = [];
  Object.keys(DEFAULTS).forEach(function (k) {
    if (!have[k]) add.push([k, JSON.stringify(DEFAULTS[k])]);
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 2).setValues(add);
}

function cfg_(ss) {
  var sh = ss.getSheetByName(SH.cfg);
  var out = JSON.parse(JSON.stringify(DEFAULTS));
  var n = sh.getLastRow();
  if (n > 1) {
    sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
      if (!r[0]) return;
      try { out[r[0]] = JSON.parse(r[1]); } catch (err) { out[r[0]] = r[1]; }
    });
  }
  return out;
}

/* ============================ 資料存取 ============================ */

function rows_(sh, cols) {
  var n = sh.getLastRow();
  if (n < 2) return [];
  var vals = sh.getRange(2, 1, n - 1, cols.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var o = { _row: i + 2 };
    for (var j = 0; j < cols.length; j++) o[cols[j]] = vals[i][j];
    if (!o.id) continue;
    if (String(o.deleted) === '1' || o.deleted === true) continue;
    out.push(o);
  }
  return out;
}

function ymd_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  return String(v).trim();
}

function hm_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, 'HH:mm');
  }
  return String(v).trim();
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function newId_(p) {
  return p + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

function photoUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w800';
}

function packRec_(r, photos) {
  return {
    id: r.id,
    date: ymd_(r.date),
    time: hm_(r.time),
    reporter: r.reporter || '',
    members: r.members ? String(r.members).split(',').map(function (s) { return s.trim(); }).filter(String) : [],
    project: r.project || '',
    area: r.area || '',
    obsZh: r.obsZh || '', obsEn: r.obsEn || '',
    recZh: r.recZh || '', recEn: r.recEn || '',
    actionBy: r.actionBy || '',
    risk: r.risk || '',
    targetDate: ymd_(r.targetDate),
    status: r.status || 'Open',
    closeOutDate: ymd_(r.closeOutDate),
    photos: photos || []
  };
}

function photosByRecord_(ss) {
  var list = rows_(ss.getSheetByName(SH.pho), PHO_COLS);
  var map = {};
  list.forEach(function (p) {
    (map[p.recordId] = map[p.recordId] || []).push({
      id: p.id, kind: p.kind, fileId: p.fileId,
      url: photoUrl_(p.fileId),
      open: 'https://drive.google.com/file/d/' + p.fileId + '/view'
    });
  });
  return map;
}

/* ============================ API ============================ */

function hseBoot(key, date) {
  auth_(key);
  var r = ensure_();
  var ss = r.ss;
  var cfg = cfg_(ss);
  var recs = rows_(ss.getSheetByName(SH.rec), REC_COLS);
  var pmap = photosByRecord_(ss);
  var td = today_();

  var counts = { total: 0, open: 0, pending: 0, closed: 0, overdue: 0 };
  var dates = {};
  recs.forEach(function (x) {
    counts.total++;
    var st = x.status || 'Open';
    if (st === 'Open') counts.open++;
    else if (st === 'Pending') counts.pending++;
    else if (st === 'Closed') counts.closed++;
    if (st !== 'Closed' && ymd_(x.targetDate) && ymd_(x.targetDate) < td) counts.overdue++;
    var d = ymd_(x.date);
    if (d) dates[d] = (dates[d] || 0) + 1;
  });

  var want = date || td;
  var day = recs.filter(function (x) { return ymd_(x.date) === want; });
  day.sort(function (a, b) {
    var t = hm_(a.time).localeCompare(hm_(b.time));
    return t !== 0 ? t : String(a.createdAt).localeCompare(String(b.createdAt));
  });

  return {
    ok: true,
    today: td,
    date: want,
    config: cfg,
    counts: counts,
    dates: Object.keys(dates).sort().reverse().slice(0, 120).map(function (d) {
      return { date: d, n: dates[d] };
    }),
    records: day.map(function (x, i) {
      var o = packRec_(x, pmap[x.id] || []);
      o.sn = i + 1;
      return o;
    })
  };
}

function hseSearch(key, q, status) {
  auth_(key);
  var r = ensure_();
  var recs = rows_(r.ss.getSheetByName(SH.rec), REC_COLS);
  var pmap = photosByRecord_(r.ss);
  var s = String(q || '').toLowerCase();
  var out = recs.filter(function (x) {
    if (status && (x.status || 'Open') !== status) return false;
    if (!s) return true;
    return [x.obsZh, x.obsEn, x.recZh, x.recEn, x.actionBy, x.area, x.reporter]
      .join(' ').toLowerCase().indexOf(s) >= 0;
  });
  out.sort(function (a, b) { return ymd_(b.date).localeCompare(ymd_(a.date)); });
  return {
    ok: true,
    records: out.slice(0, 200).map(function (x) { return packRec_(x, pmap[x.id] || []); })
  };
}

function hseTranslate(key, text, from, to) {
  auth_(key);
  try {
    var s = String(text || '').trim();
    if (!s) return { ok: true, text: '' };
    return { ok: true, text: LanguageApp.translate(s, from || 'zh-TW', to || 'en') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function hseSave(key, payload) {
  auth_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = ensure_();
    var ss = r.ss;
    var sh = ss.getSheetByName(SH.rec);
    var now = new Date();
    var nowS = Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss');

    var obsZh = String(payload.obsZh || '').trim();
    var recZh = String(payload.recZh || '').trim();
    if (!payload.date) throw new Error('請選擇巡查日期');
    if (!payload.reporter) throw new Error('請填寫填報人');
    if (!obsZh) throw new Error('請填寫巡查發現');
    if (!recZh) throw new Error('請填寫改善建議');

    var rec = {
      id: payload.id || newId_('R'),
      date: ymd_(payload.date),
      time: hm_(payload.time) || Utilities.formatDate(now, TZ, 'HH:mm'),
      reporter: String(payload.reporter || '').trim(),
      members: (payload.members || []).join(', '),
      project: String(payload.project || DEFAULTS.project).trim(),
      area: String(payload.area || '').trim(),
      obsZh: obsZh,
      obsEn: String(payload.obsEn || '').trim(),
      recZh: recZh,
      recEn: String(payload.recEn || '').trim(),
      actionBy: String(payload.actionBy || '').trim(),
      risk: String(payload.risk || '').trim(),
      targetDate: ymd_(payload.targetDate),
      status: payload.status || 'Open',
      closeOutDate: ymd_(payload.closeOutDate),
      createdAt: nowS,
      updatedAt: nowS,
      deleted: ''
    };

    var existing = null;
    if (payload.id) {
      var all = rows_(sh, REC_COLS);
      for (var i = 0; i < all.length; i++) if (all[i].id === payload.id) { existing = all[i]; break; }
    }
    if (existing) {
      rec.createdAt = existing.createdAt;
      sh.getRange(existing._row, 1, 1, REC_COLS.length)
        .setValues([REC_COLS.map(function (c) { return rec[c]; })]);
    } else {
      sh.appendRow(REC_COLS.map(function (c) { return rec[c]; }));
    }

    var n = addPhotos_(ss, r.photoId, rec, payload.photos || [], 'before');
    return { ok: true, id: rec.id, photoCount: n };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function addPhotos_(ss, photoFolderId, rec, photos, kind) {
  if (!photos || !photos.length) return 0;
  var folder = DriveApp.getFolderById(photoFolderId);
  var sh = ss.getSheetByName(SH.pho);
  var nowS = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  var out = [];
  for (var i = 0; i < photos.length; i++) {
    var d = photos[i] && photos[i].data;
    if (!d) continue;
    try {
      var bytes = Utilities.base64Decode(d);
      var name = rec.date + '_' + rec.id + '_' + kind + '_' + (i + 1) + '.jpg';
      var blob = Utilities.newBlob(bytes, 'image/jpeg', name);
      var f = folder.createFile(blob);
      try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
      out.push([newId_('P'), rec.id, kind, f.getId(), name, nowS, '']);
    } catch (e) { }
  }
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, PHO_COLS.length).setValues(out);
  return out.length;
}

function hseAddPhotos(key, id, photos, kind) {
  auth_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = ensure_();
    var ss = r.ss;
    var sh = ss.getSheetByName(SH.rec);
    var all = rows_(sh, REC_COLS);
    var rec = null;
    for (var i = 0; i < all.length; i++) if (all[i].id === id) { rec = all[i]; break; }
    if (!rec) throw new Error('找不到這筆紀錄');
    rec.date = ymd_(rec.date);
    var k = kind === 'before' ? 'before' : 'after';
    var n = addPhotos_(ss, r.photoId, rec, photos || [], k);
    if (k === 'after' && n > 0 && (rec.status || 'Open') === 'Open') {
      setCell_(sh, rec._row, 'status', 'Pending');
      setCell_(sh, rec._row, 'updatedAt', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'));
    }
    return { ok: true, photoCount: n };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function setCell_(sh, row, col, val) {
  sh.getRange(row, REC_COLS.indexOf(col) + 1).setValue(val);
}

function hseSetStatus(key, id, status, closeOutDate) {
  auth_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = ensure_();
    var sh = r.ss.getSheetByName(SH.rec);
    var all = rows_(sh, REC_COLS);
    var rec = null;
    for (var i = 0; i < all.length; i++) if (all[i].id === id) { rec = all[i]; break; }
    if (!rec) throw new Error('找不到這筆紀錄');
    if (['Open', 'Pending', 'Closed'].indexOf(status) < 0) throw new Error('狀態不正確');
    setCell_(sh, rec._row, 'status', status);
    setCell_(sh, rec._row, 'closeOutDate', status === 'Closed' ? (ymd_(closeOutDate) || today_()) : '');
    setCell_(sh, rec._row, 'updatedAt', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function hseDelete(key, id) {
  auth_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = ensure_();
    var sh = r.ss.getSheetByName(SH.rec);
    var all = rows_(sh, REC_COLS);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { setCell_(sh, all[i]._row, 'deleted', '1'); return { ok: true }; }
    }
    throw new Error('找不到這筆紀錄');
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function hseDeletePhoto(key, photoId) {
  auth_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = ensure_();
    var sh = r.ss.getSheetByName(SH.pho);
    var all = rows_(sh, PHO_COLS);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === photoId) {
        sh.getRange(all[i]._row, PHO_COLS.indexOf('deleted') + 1).setValue('1');
        try { DriveApp.getFileById(all[i].fileId).setTrashed(true); } catch (e) { }
        return { ok: true };
      }
    }
    throw new Error('找不到這張照片');
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function hseSaveConfig(key, obj) {
  auth_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = ensure_();
    var sh = r.ss.getSheetByName(SH.cfg);
    var n = sh.getLastRow();
    var map = {};
    if (n > 1) {
      sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (row, i) {
        if (row[0]) map[row[0]] = i + 2;
      });
    }
    Object.keys(obj || {}).forEach(function (k) {
      if (!DEFAULTS.hasOwnProperty(k)) return;
      var v = JSON.stringify(obj[k]);
      if (map[k]) sh.getRange(map[k], 2).setValue(v);
      else sh.appendRow([k, v]);
    });
    return { ok: true, config: cfg_(r.ss) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================ 報告產生 ============================ */

var COL_W = [28.4, 242.5, 241.9, 61, 56.7, 63.8, 70.5];   // pt，對齊範本 twips/20
var HDR_BG = '#f2f2f2';
var NAVY = '#002038';
var FONT = 'Arial';

function hseBuildReport(key, date) {
  auth_(key);
  var lock = LockService.getScriptLock();
  lock.waitLock(120000);
  try {
    var r = ensure_();
    var ss = r.ss;
    var d = ymd_(date) || today_();
    var cfg = cfg_(ss);

    var all = rows_(ss.getSheetByName(SH.rec), REC_COLS);
    var recs = all.filter(function (x) { return ymd_(x.date) === d; });
    if (!recs.length) throw new Error(d + ' 當天沒有巡查紀錄，無法產生報告');
    recs.sort(function (a, b) {
      var t = hm_(a.time).localeCompare(hm_(b.time));
      return t !== 0 ? t : String(a.createdAt).localeCompare(String(b.createdAt));
    });
    var pmap = photosByRecord_(ss);

    trashOld_(ss, d);

    var built = buildDoc_(d, recs, pmap, cfg, r.reportId);
    var files = exportDoc_(built.docId, built.name, r.reportId);

    var sh = ss.getSheetByName(SH.rep);
    sh.appendRow([d, built.docId, files.pdfId, files.docxId,
      Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')]);

    return {
      ok: true,
      date: d,
      count: recs.length,
      name: built.name,
      docUrl: 'https://docs.google.com/document/d/' + built.docId + '/edit',
      pdfUrl: 'https://drive.google.com/file/d/' + files.pdfId + '/view',
      pdfDownload: 'https://drive.google.com/uc?export=download&id=' + files.pdfId,
      docxDownload: 'https://drive.google.com/uc?export=download&id=' + files.docxId,
      merged: built.merged
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function trashOld_(ss, date) {
  var sh = ss.getSheetByName(SH.rep);
  var n = sh.getLastRow();
  if (n < 2) return;
  var vals = sh.getRange(2, 1, n - 1, REP_COLS.length).getValues();
  var keep = [];
  vals.forEach(function (row) {
    if (ymd_(row[0]) === date) {
      [row[1], row[2], row[3]].forEach(function (id) {
        if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { } }
      });
    } else if (row[0]) keep.push(row);
  });
  sh.getRange(2, 1, n - 1, REP_COLS.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, REP_COLS.length).setValues(keep);
}

function buildDoc_(date, recs, pmap, cfg, reportFolderId) {
  var name = 'HSE Walkthrough Inspection_' + date;
  var doc = DocumentApp.create(name);
  var docId = doc.getId();
  try { DriveApp.getFileById(docId).moveTo(DriveApp.getFolderById(reportFolderId)); } catch (e) { }

  var body = doc.getBody();
  body.setPageWidth(842).setPageHeight(595)
    .setMarginTop(31).setMarginBottom(36).setMarginLeft(22).setMarginRight(27);

  /* ---- 表頭 ---- */
  var times = recs.map(function (x) { return hm_(x.time); }).filter(String).sort();
  var timeTxt = times.length ? (times[0] === times[times.length - 1]
    ? times[0] : times[0] + ' – ' + times[times.length - 1]) : '';
  var memberSet = {};
  recs.forEach(function (x) {
    String(x.members || '').split(',').forEach(function (s) { s = s.trim(); if (s) memberSet[s] = 1; });
    if (x.reporter) memberSet[String(x.reporter).trim()] = 1;
  });
  var members = Object.keys(memberSet).join('、');
  var project = recs[0].project || cfg.project || DEFAULTS.project;

  var hdr = doc.getHeader() || doc.addHeader();
  var ht = hdr.appendTable([['', '', '']]);
  ht.setBorderWidth(0);
  ht.setColumnWidth(0, 150).setColumnWidth(1, 400).setColumnWidth(2, 240);

  var logoCell = ht.getCell(0, 0);
  logoCell.setPaddingTop(2).setPaddingBottom(2).setPaddingLeft(2).setPaddingRight(2);
  try {
    var logo = Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'nmdc.png');
    var ip = logoCell.getChild(0).asParagraph();
    var im = ip.appendInlineImage(logo);
    im.setWidth(134).setHeight(45);
  } catch (e) {
    logoCell.getChild(0).asParagraph().setText('NMDC ENERGY');
  }
  logoCell.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);

  var tc = ht.getCell(0, 1);
  para_(tc, 0, 'NMDC ENERGY', { FONT_SIZE: 11, BOLD: true, FOREGROUND_COLOR: NAVY });
  para_(tc, null, 'HSE INSPECTION walkthrough – ' + project, { FONT_SIZE: 14, BOLD: true, FOREGROUND_COLOR: NAVY });
  para_(tc, null, 'HSE 現場巡查紀錄', { FONT_SIZE: 12, BOLD: true, FOREGROUND_COLOR: NAVY });
  tc.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
  for (var pi = 0; pi < tc.getNumChildren(); pi++) {
    tc.getChild(pi).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  }

  var ic = ht.getCell(0, 2);
  para_(ic, 0, 'Project and Location 專案及地點：' + project, { FONT_SIZE: 9 });
  para_(ic, null, 'Date 日期：' + date, { FONT_SIZE: 9 });
  para_(ic, null, 'Time 時間：' + (timeTxt || '—'), { FONT_SIZE: 9 });
  ic.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);

  var tm = hdr.appendParagraph('');
  setText_(tm, 'Team Members 巡查成員：' + (members || '—'), { FONT_SIZE: 9, BOLD: true, FOREGROUND_COLOR: NAVY });
  tm.setSpacingBefore(2).setSpacingAfter(2);

  /* ---- 主表 ---- */
  var head = ['S/N\n項次', 'OBSERVATIONS\n巡查發現', 'RECOMMENDATIONS\n改善建議',
    'ACTION BY\n權責單位', 'STATUS\n改善狀態', 'TARGET DATE\n預定完成日期', 'CLOSE- OUT DATE\n結案日期'];

  var grid = [head];
  var photoRows = [];   // 主表中屬於「照片列」的 row index
  var rowMeta = [];     // 每一列對應的紀錄
  recs.forEach(function (x, i) {
    grid.push([String(i + 1), '', '', '', '', '', '']);
    rowMeta.push({ type: 'data', rec: x, sn: i + 1 });
    var ph = pmap[x.id] || [];
    grid.push(['', '', '', '', '', '', '']);
    photoRows.push(grid.length - 1);
    rowMeta.push({ type: 'photo', rec: x, photos: ph });
  });

  var tbl = body.appendTable(grid);
  tbl.setBorderWidth(0.75).setBorderColor('#000000');
  for (var c = 0; c < COL_W.length; c++) tbl.setColumnWidth(c, COL_W[c]);

  // 表頭列
  for (var c2 = 0; c2 < 7; c2++) {
    var hc = tbl.getCell(0, c2);
    hc.setBackgroundColor(HDR_BG);
    hc.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
    hc.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(3).setPaddingRight(3);
    var parts = head[c2].split('\n');
    hc.clear();
    para_(hc, 0, parts[0], { FONT_SIZE: 9, BOLD: true });
    para_(hc, null, parts[1], { FONT_SIZE: 9, BOLD: true });
    for (var q = 0; q < hc.getNumChildren(); q++) {
      hc.getChild(q).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER)
        .setSpacingBefore(0).setSpacingAfter(0);
    }
  }

  // 資料列 + 照片列
  var rowIdx = 1;
  rowMeta.forEach(function (m) {
    var row = tbl.getRow(rowIdx);
    if (m.type === 'data') {
      fillDataRow_(row, m.rec, m.sn);
    } else {
      fillPhotoRow_(row, m.rec, m.photos);
    }
    rowIdx++;
  });

  /* ---- 分發對象 ---- */
  body.appendParagraph('').setSpacingBefore(6).setSpacingAfter(0);
  var dg = [
    ['Distribution', '分發對象', '', 'Attendees   / HSE file', '與會人員', ''],
    ['HSE Representatives', 'HSE 代表', String(cfg.hseRep || ''), 'Section Representative', '部門代表', String(cfg.sectionRep || '')]
  ];
  var dt = body.appendTable(dg);
  dt.setBorderWidth(0.75).setBorderColor('#000000');
  var dw = [120, 92, 177, 128, 92, 169];
  for (var dc = 0; dc < dw.length; dc++) dt.setColumnWidth(dc, dw[dc]);
  for (var dr = 0; dr < 2; dr++) {
    for (var dcc = 0; dcc < 6; dcc++) {
      var cell = dt.getCell(dr, dcc);
      cell.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(4).setPaddingRight(4);
      cell.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
      styleCell_(cell, { FONT_SIZE: 9, BOLD: dcc === 0 || dcc === 3 });
    }
  }

  // 移除 body 最前面的空白段落（DocumentApp.create 會自帶一個）
  try {
    var first = body.getChild(0);
    if (first.getType() === DocumentApp.ElementType.PARAGRAPH &&
      first.asParagraph().getText() === '' && body.getNumChildren() > 1) {
      body.removeChild(first);
    }
  } catch (e) { }

  doc.saveAndClose();

  var merged = mergePhotoRows_(docId, photoRows);
  return { docId: docId, name: name, merged: merged };
}

function fillDataRow_(row, x, sn) {
  var status = x.status || 'Open';
  var statusTxt = { Open: 'Open\n開放中', Pending: 'Pending\n待複查', Closed: 'Closed\n已結案' }[status] || status;

  setCellPlain_(row.getCell(0), String(sn), { FONT_SIZE: 9 }, DocumentApp.HorizontalAlignment.CENTER);
  setCellBilingual_(row.getCell(1), x.obsZh, x.obsEn);
  setCellBilingual_(row.getCell(2), x.recZh, x.recEn);
  setCellPlain_(row.getCell(3), String(x.actionBy || ''), { FONT_SIZE: 9 }, DocumentApp.HorizontalAlignment.CENTER);
  setCellMulti_(row.getCell(4), statusTxt.split('\n'), { FONT_SIZE: 9 }, DocumentApp.HorizontalAlignment.CENTER);
  setCellPlain_(row.getCell(5), ymd_(x.targetDate), { FONT_SIZE: 9 }, DocumentApp.HorizontalAlignment.CENTER);
  setCellPlain_(row.getCell(6), ymd_(x.closeOutDate), { FONT_SIZE: 9 }, DocumentApp.HorizontalAlignment.CENTER);

  for (var i = 0; i < 7; i++) {
    var c = row.getCell(i);
    c.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(4).setPaddingRight(4);
    c.setVerticalAlignment(i === 1 || i === 2
      ? DocumentApp.VerticalAlignment.TOP : DocumentApp.VerticalAlignment.CENTER);
  }
}

function fillPhotoRow_(row, x, photos) {
  var cell = row.getCell(0);
  cell.clear();
  cell.setPaddingTop(4).setPaddingBottom(5).setPaddingLeft(6).setPaddingRight(6);
  cell.setVerticalAlignment(DocumentApp.VerticalAlignment.TOP);

  var before = photos.filter(function (p) { return p.kind === 'before'; });
  var after = photos.filter(function (p) { return p.kind === 'after'; });

  var p0 = cell.getChild(0).asParagraph();
  setText_(p0, 'BEFORE 改善前', { FONT_SIZE: 8, BOLD: true, FOREGROUND_COLOR: '#546e7a' });
  p0.setSpacingBefore(0).setSpacingAfter(1);
  appendImages_(cell, before, 'BEFORE');

  var p1 = cell.appendParagraph('');
  setText_(p1, 'AFTER 改善後', { FONT_SIZE: 8, BOLD: true, FOREGROUND_COLOR: '#1b6e3c' });
  p1.setSpacingBefore(4).setSpacingAfter(1);
  appendImages_(cell, after, 'AFTER');

  // 其餘欄位清空（合併後會併入第一格）
  for (var i = 1; i < 7; i++) {
    var c = row.getCell(i);
    c.clear();
    c.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0);
  }
}

function appendImages_(cell, list, label) {
  var p = cell.appendParagraph('');
  p.setSpacingBefore(0).setSpacingAfter(0);
  if (!list.length) {
    setText_(p, '（尚無照片 no photo）', { FONT_SIZE: 8, ITALIC: true, FOREGROUND_COLOR: '#888888' });
    return;
  }
  var n = 0;
  list.forEach(function (ph) {
    if (n >= 4) return;
    try {
      var blob = DriveApp.getFileById(ph.fileId).getBlob();
      var im = p.appendInlineImage(blob);
      var w = im.getWidth(), h = im.getHeight();
      var H = 112;
      if (h > 0) { im.setHeight(H); im.setWidth(Math.round(w * H / h)); }
      p.appendText('  ');
      n++;
    } catch (e) { }
  });
  if (!n) setText_(p, '（照片讀取失敗 photo unavailable）', { FONT_SIZE: 8, ITALIC: true, FOREGROUND_COLOR: '#c62828' });
}

/* ---- 文字小工具 ---- */

function attrs_(o) {
  var a = {};
  a[DocumentApp.Attribute.FONT_FAMILY] = FONT;
  if (o.FONT_SIZE) a[DocumentApp.Attribute.FONT_SIZE] = o.FONT_SIZE;
  if (o.BOLD !== undefined) a[DocumentApp.Attribute.BOLD] = o.BOLD;
  if (o.ITALIC !== undefined) a[DocumentApp.Attribute.ITALIC] = o.ITALIC;
  if (o.FOREGROUND_COLOR) a[DocumentApp.Attribute.FOREGROUND_COLOR] = o.FOREGROUND_COLOR;
  return a;
}

function setText_(p, txt, o) {
  p.setText(txt);
  p.setAttributes(attrs_(o || {}));
  p.setSpacingBefore(0).setSpacingAfter(0).setLineSpacing(1.15);
  return p;
}

function para_(cell, childIndex, txt, o) {
  var p = (childIndex === 0) ? cell.getChild(0).asParagraph() : cell.appendParagraph('');
  return setText_(p, txt, o);
}

function setCellPlain_(cell, txt, o, align) {
  cell.clear();
  var p = setText_(cell.getChild(0).asParagraph(), txt || '', o);
  if (align) p.setAlignment(align);
}

function setCellMulti_(cell, lines, o, align) {
  cell.clear();
  lines.forEach(function (s, i) {
    var p = (i === 0) ? cell.getChild(0).asParagraph() : cell.appendParagraph('');
    setText_(p, s, o);
    if (align) p.setAlignment(align);
  });
}

function setCellBilingual_(cell, zh, en) {
  cell.clear();
  var p = setText_(cell.getChild(0).asParagraph(), zh || '', { FONT_SIZE: 9 });
  p.setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  if (en) {
    var p2 = setText_(cell.appendParagraph(''), en, { FONT_SIZE: 8, FOREGROUND_COLOR: '#3d4b59' });
    p2.setAlignment(DocumentApp.HorizontalAlignment.LEFT).setSpacingBefore(1);
  }
}

function styleCell_(cell, o) {
  for (var i = 0; i < cell.getNumChildren(); i++) {
    var ch = cell.getChild(i);
    if (ch.getType() === DocumentApp.ElementType.PARAGRAPH) {
      ch.asParagraph().setAttributes(attrs_(o));
      ch.asParagraph().setSpacingBefore(0).setSpacingAfter(0);
    }
  }
}

/**
 * 把照片列的 7 格合併成一格（Word 範本沒有照片欄，合併後才不會被欄寬切斷）。
 * DocumentApp 無法合併儲存格，改用 Docs 進階服務；失敗時照片仍留在第一格。
 */
function mergePhotoRows_(docId, photoRows) {
  if (!photoRows.length) return true;
  try {
    var d = Docs.Documents.get(docId);
    var content = d.body.content || [];
    var tableStart = null;
    for (var i = 0; i < content.length; i++) {
      if (content[i].table) { tableStart = content[i].startIndex; break; }
    }
    if (tableStart === null) return false;
    var reqs = photoRows.slice().sort(function (a, b) { return b - a; }).map(function (r) {
      return {
        mergeTableCells: {
          tableRange: {
            tableCellLocation: {
              tableStartLocation: { index: tableStart },
              rowIndex: r,
              columnIndex: 0
            },
            rowSpan: 1,
            columnSpan: 7
          }
        }
      };
    });
    Docs.Documents.batchUpdate({ requests: reqs }, docId);
    return true;
  } catch (e) {
    console.warn('mergePhotoRows_ 失敗，照片列維持未合併：' + e);
    return false;
  }
}

function exportDoc_(docId, name, reportFolderId) {
  var folder = DriveApp.getFolderById(reportFolderId);
  var pdf = DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(name + '.pdf');
  var pdfFile = folder.createFile(pdf);
  try { pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }

  var url = 'https://www.googleapis.com/drive/v3/files/' + docId +
    '/export?mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document';
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var docxId = '';
  if (res.getResponseCode() === 200) {
    var blob = res.getBlob().setName(name + '.docx');
    var f = folder.createFile(blob);
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
    docxId = f.getId();
  }
  try { DriveApp.getFileById(docId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
  return { pdfId: pdfFile.getId(), docxId: docxId };
}
