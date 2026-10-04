/**********************************************************************
 * 環境船檢系統 Environmental Vessel Inspection System — GAS Backend
 * Document: ENY-HSE-PG-PLN-17-FRM-02 Rev.03 (NMDC ENERGY)
 *
 * ▍部署步驟 Deployment
 *   1. script.google.com → 新專案 → 貼上本檔全部內容
 *   2. 執行一次 oneClickSetup()(第一次會要求授權)
 *      → 自動建立 Drive 資料夾「環境船檢系統」+ 試算表資料庫
 *   3. 部署 → 新增部署作業 → 網頁應用程式
 *      執行身分:我 / 存取權:任何人
 *   4. 複製 Web App URL,貼到 index.html 最上方的 SCRIPT_URL
 *
 * ▍API(POST text/plain JSON,避免 CORS preflight)
 *   {action:'list'}                      → 總表清單
 *   {action:'get', id}                   → 單筆完整資料(含附件)
 *   {action:'save', item}                → 新增/更新
 *   {action:'delete', id}                → 刪除(含附件)
 *   {action:'upload', inspId, itemCode, name, mimeType, base64}
 *   {action:'deleteFile', fileId}
 **********************************************************************/

var APP_NAME = '環境船檢系統';
var TZ = 'Asia/Taipei';
/* ★ 匯出 PDF 統一存放的資料夾(所有船的報表集中一處,不放各船附件資料夾)
   留空 '' 則回復舊行為:存回該筆檢查的資料夾 */
var PDF_FOLDER_ID = '19VrkpdAth0x3Tm9tOrcZXc6-A7kqtlFt';

var INSP_SHEET = 'Inspections';
var ATT_SHEET  = 'Attachments';
var CHK_SHEET  = 'Checklist';
var CHK_HEADERS = ['secCode','secEn','secZh','itemEn','itemZh','evidenceEn','evidenceZh'];

var INSP_HEADERS = ['id','updatedAt','vesselZh','vesselEn','mmsi','imo','tonnage','vesselClass',
                    'projectNo','location','inspectDate','status','selfDate','nmdcDate','progress','dataJson',
                    'verdict','verdictDeadline','nmdcProgress','inspNo','folderUrl','closed','closedDate',
                    'scope'];   // ★ v31:工作範疇(尾端新增欄位,表頭自動更新,舊紀錄留空即可)
var ATT_HEADERS  = ['fileId','inspId','itemCode','name','url','uploadedAt','size'];

/* ================= 一鍵建置 ================= */
function oneClickSetup() {
  var props = PropertiesService.getScriptProperties();

  var folder = null;
  var folderId = props.getProperty('FOLDER_ID');
  if (folderId) { try { folder = DriveApp.getFolderById(folderId); } catch (e) {} }
  if (!folder) {
    folder = DriveApp.createFolder(APP_NAME);
    props.setProperty('FOLDER_ID', folder.getId());
  }

  var ss = null;
  var ssId = props.getProperty('SS_ID');
  if (ssId) { try { ss = SpreadsheetApp.openById(ssId); } catch (e) {} }
  if (!ss) {
    ss = SpreadsheetApp.create(APP_NAME + '資料庫');
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty('SS_ID', ss.getId());
  }

  ensureSheet_(ss, INSP_SHEET, INSP_HEADERS);
  ensureSheet_(ss, ATT_SHEET,  ATT_HEADERS);
  ensureSheet_(ss, CHK_SHEET,  CHK_HEADERS);

  var s1 = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 2) { try { ss.deleteSheet(s1); } catch (e) {} }

  Logger.log('✅ Setup OK\nDrive 資料夾: ' + folder.getUrl() + '\n試算表: ' + ss.getUrl());
  return 'ok';
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (String(first[0]) !== headers[0] ||
      String(first[headers.length - 1]) !== headers[headers.length - 1]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  if (!id) throw new Error('尚未執行 oneClickSetup()');
  return SpreadsheetApp.openById(id);
}
function rootFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (!id) throw new Error('尚未執行 oneClickSetup()');
  return DriveApp.getFolderById(id);
}

/* ================= HTTP 入口 ================= */
function doGet(e) {
  return json_({ ok: true, app: APP_NAME, time: stamp_() });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'Invalid JSON' }); }

  // 讀取類 action 不搶鎖,速度較快
  try {
    switch (req.action) {
      case 'bootstrap':    return json_({ ok: true, items: listInspections_(), checklist: getChecklist_() });
      case 'list':         return json_({ ok: true, items: listInspections_() });
      case 'get':          return json_({ ok: true, item: getInspection_(req.id) });
      case 'getChecklist': return json_({ ok: true, checklist: getChecklist_() });
      case 'filesData':    return json_(filesData_(req.ids));
      case 'fileData':     return json_(fileData_(req.id));
      case 'fileRaw':      return json_(fileRaw_(req));
      case 'visit':        return json_(visit_(req.first));
      case 'getScopes':    return json_(getScopes_());
    }
  } catch (errR) {
    return json_({ ok: false, error: String(errR) });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    switch (req.action) {
      case 'save': {
        var isNew_ = !(req.item && req.item.id);
        var saved_ = saveInspection_(req.item);
        logAudit_(isNew_ ? 'create' : 'save', saved_, req.who,
          String(saved_.status || '') + (String(saved_.closed) === '1' ? '/closed' : ''),
          { item: saved_, attachments: listAttachments_(saved_.id) });
        return json_({ ok: true, item: saved_ });
      }
      case 'delete': {
        var full_ = null; try { full_ = getInspection_(req.id); } catch (eD) {}
        var delRes_ = deleteInspection_(req.id);
        if (delRes_ && delRes_.ok !== false)
          logAudit_('delete', full_ || { id: req.id }, req.who, '', full_ ? { item: full_ } : null);
        return json_(delRes_);
      }
      case 'upload': {
        var upRes_ = uploadFile_(req);
        if (upRes_ && upRes_.ok) logAudit_('upload', { id: req.inspId }, req.who, (req.label || req.itemCode || '') + ' & ' + (req.name || ''));
        return json_(upRes_);
      }
      case 'deleteFile': {
        var dfRes_ = deleteFile_(req.fileId);
        logAudit_('deleteFile', {}, req.who, String(req.fileId || ''));
        return json_(dfRes_);
      }
      case 'restore':    return json_(restoreFromLog_(req.rowId, req.who));
      case 'auditList':  return json_(auditList_());
      case 'exportPdf':  return json_(exportPdf_(req));
      case 'storePdf': {
        var spRes_ = storePdf_(req);
        if (spRes_ && spRes_.ok) logAudit_('storePdf', { id: req.id }, req.who, spRes_.name || '');
        return json_(spRes_);
      }
      case 'saveScopes': {
        var ssRes_ = saveScopes_(req.scopes);
        logAudit_('saveScopes', {}, req.who, (req.scopes || []).length + ' items');
        return json_(ssRes_);
      }
      case 'saveChecklist': {
        var scRes_ = saveChecklist_(req.checklist);
        logAudit_('saveChecklist', {}, req.who, '');
        return json_(scRes_);
      }
      default:           return json_({ ok: false, error: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ===== CacheService:清單/範本快取(所有使用者共用,首次開啟也受惠) ===== */
var CACHE_TTL = 21600; // 6 小時
function cacheGet_(k) { try { var v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function cachePut_(k, obj) { try { CacheService.getScriptCache().put(k, JSON.stringify(obj), CACHE_TTL); } catch (e) {} }
function cacheDel_(k) { try { CacheService.getScriptCache().remove(k); } catch (e) {} }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function stamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

/* ================= Inspections ================= */
function listInspections_() {
  var cached = cacheGet_('list1');
  if (cached) return cached;
  var sh = ensureSheet_(ss_(), INSP_SHEET, INSP_HEADERS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, INSP_HEADERS.length).getValues();
  var items = [];
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    var o = rowToObj_(vals[i]);
    delete o.dataJson; // 清單不用回傳完整內容
    items.push(o);
  }
  items.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  cachePut_('list1', items);
  return items;
}

function getInspection_(id) {
  var found = findRow_(id);
  if (!found) throw new Error('找不到紀錄: ' + id);
  var o = rowToObj_(found.values);
  try { o.data = o.dataJson ? JSON.parse(o.dataJson) : {}; } catch (e) { o.data = {}; }
  delete o.dataJson;
  o.attachments = listAttachments_(id);
  return o;
}

function saveInspection_(item) {
  if (!item) throw new Error('缺少 item');
  var sh = ensureSheet_(ss_(), INSP_SHEET, INSP_HEADERS);

  if (!item.id) item.id = 'INS-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') +
                          '-' + Math.floor(Math.random() * 900 + 100);
  item.updatedAt = stamp_();

  // ★ 船檢編號:全域流水號 EVI-001、EVI-002…(一經指定即不變)
  if (!item.inspNo) item.inspNo = nextInspNo_();

  // ★ 補件結案:標記結案時由伺服器蓋章日期
  if (String(item.closed) === '1' && !item.closedDate) item.closedDate = today_();
  if (String(item.closed) !== '1') item.closedDate = '';

  // ★ 第一次儲存即建立 Drive 資料夾並記下連結(資料夾之後改名,連結依然有效)
  if (!item.folderUrl) {
    try { item.folderUrl = inspFolderFor_(item).getUrl(); } catch (e) { item.folderUrl = ''; }
  }

  // 狀態日期:轉為完成時若未帶日期,由伺服器補上
  if (item.status === 'self_done' && !item.selfDate) item.selfDate = today_();
  if (item.status === 'nmdc_done') {
    if (!item.selfDate) item.selfDate = today_();
    if (!item.nmdcDate) item.nmdcDate = today_();
  }
  if (item.status === 'draft') { item.selfDate = ''; item.nmdcDate = ''; }
  if (item.status === 'self_done') item.nmdcDate = '';

  var row = INSP_HEADERS.map(function (h) {
    if (h === 'dataJson') return JSON.stringify(item.data || {});
    return item[h] != null ? item[h] : '';
  });

  var found = findRow_(item.id);
  if (found) sh.getRange(found.rowIndex, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);

  cacheDel_('list1');   // 資料異動,清快取
  return getInspection_(item.id);
}

function deleteInspection_(id) {
  var found = findRow_(id);
  if (!found) return { ok: false, error: '找不到紀錄: ' + id };
  var nf = folderNameFor_(id);   // 刪列前先取得資料夾名稱
  ensureSheet_(ss_(), INSP_SHEET, INSP_HEADERS).deleteRow(found.rowIndex);
  cacheDel_('list1');

  // 刪附件
  var atts = listAttachments_(id);
  for (var i = 0; i < atts.length; i++) {
    try { DriveApp.getFileById(atts[i].fileId).setTrashed(true); } catch (e) {}
  }
  var sh = ensureSheet_(ss_(), ATT_SHEET, ATT_HEADERS);
  var last = sh.getLastRow();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, ATT_HEADERS.length).getValues();
    for (var r = vals.length - 1; r >= 0; r--) {
      if (String(vals[r][1]) === String(id)) sh.deleteRow(r + 2);
    }
  }
  // 刪資料夾(新舊命名皆比對)
  try {
    var it = rootFolder_().getFolders();
    while (it.hasNext()) {
      var fo = it.next();
      var nm = fo.getName();
      if (nm === id || nm === nf.desired || (nf.no && nm.indexOf(nf.no + '_') === 0) || nm === nf.no) {
        fo.setTrashed(true);
      }
    }
  } catch (e) {}
  return { ok: true };
}

function nextInspNo_() {
  var sh = ensureSheet_(ss_(), INSP_SHEET, INSP_HEADERS);
  var last = sh.getLastRow(), max = 0;
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, INSP_HEADERS.length).getValues();
    var noIdx = INSP_HEADERS.indexOf('inspNo');
    for (var i = 0; i < vals.length; i++) {
      var m = String(vals[i][noIdx] || '').match(/^EVI-(\d+)$/);
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    }
  }
  var s = String(max + 1);
  while (s.length < 3) s = '0' + s;
  return 'EVI-' + s;
}

function findRow_(id) {
  var sh = ensureSheet_(ss_(), INSP_SHEET, INSP_HEADERS);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      return {
        rowIndex: i + 2,
        values: sh.getRange(i + 2, 1, 1, INSP_HEADERS.length).getValues()[0]
      };
    }
  }
  return null;
}

function rowToObj_(rowVals) {
  var o = {};
  for (var i = 0; i < INSP_HEADERS.length; i++) {
    var v = rowVals[i];
    o[INSP_HEADERS[i]] = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : v;
  }
  return o;
}

/* ================= Attachments ================= */
/* 附件資料夾:以「檢查編號_船名」命名(舊的 ID 命名資料夾會自動改名) */
function folderNameFor_(inspId) {
  var o = null;
  try { var f = findRow_(inspId); if (f) o = rowToObj_(f.values); } catch (e) {}
  var no = o && o.inspNo ? String(o.inspNo) : '';
  var vessel = o ? String(o.vesselEn || o.vesselZh || '') : '';
  var name = (no || inspId) + (vessel ? '_' + vessel : '');
  return { desired: name.replace(/[\\\/:*?"<>|]/g, '_').substring(0, 80), no: no };
}

function inspFolderFor_(o) {
  var root = rootFolder_();
  var no = o && o.inspNo ? String(o.inspNo) : '';
  var vessel = o ? String(o.vesselEn || o.vesselZh || '') : '';
  var inspId = o && o.id ? String(o.id) : '';
  var desired = ((no || inspId) + (vessel ? '_' + vessel : ''))
    .replace(/[\\\/:*?"<>|]/g, '_').substring(0, 80);
  var it = root.getFolders();
  var match = null;
  while (it.hasNext()) {
    var fo = it.next();
    var nm = fo.getName();
    if (nm === desired) return fo;
    if (nm === inspId || nm === no || (no && nm.indexOf(no + '_') === 0)) match = fo;
  }
  if (match) { try { match.setName(desired); } catch (e) {} return match; }
  return root.createFolder(desired);
}

function inspFolder_(inspId) {
  var o = null;
  try { var f = findRow_(inspId); if (f) o = rowToObj_(f.values); } catch (e) {}
  if (!o) o = { id: inspId };
  return inspFolderFor_(o);
}

function uploadFile_(req) {
  if (!req.inspId || !req.itemCode || !req.name || !req.base64) {
    return { ok: false, error: '缺少上傳參數' };
  }
  var bytes = Utilities.base64Decode(req.base64);
  var blob = Utilities.newBlob(bytes, req.mimeType || 'application/octet-stream',
                               (req.label || req.itemCode) + ' & ' + req.name);   // ★ 檔名加項目前綴
  var folder = inspFolder_(req.inspId);
  if (req.sub) {   // ★ 改善相關附件 → 該筆檢查資料夾下的子資料夾(如「改善佐證 Improvement Evidence」)
    var subIt = folder.getFoldersByName(req.sub);
    folder = subIt.hasNext() ? subIt.next() : folder.createFolder(req.sub);
  }
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  var att = {
    fileId: file.getId(),
    inspId: req.inspId,
    itemCode: req.itemCode,
    name: file.getName(),
    url: file.getUrl(),
    uploadedAt: stamp_(),
    size: bytes.length
  };
  ensureSheet_(ss_(), ATT_SHEET, ATT_HEADERS)
    .appendRow(ATT_HEADERS.map(function (h) { return att[h]; }));
  return { ok: true, attachment: att };
}

function deleteFile_(fileId) {
  if (!fileId) return { ok: false, error: '缺少 fileId' };
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  var sh = ensureSheet_(ss_(), ATT_SHEET, ATT_HEADERS);
  var last = sh.getLastRow();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0]) === String(fileId)) { sh.deleteRow(i + 2); break; }
    }
  }
  return { ok: true };
}

/* ================= 檢查項目範本(可編輯) =================
 * Checklist 工作表為空 → 回傳 null,前端使用內建預設範本;
 * 前端編輯器儲存後即以工作表內容為準(也可直接在試算表改) */
function getChecklist_() {
  var cached = cacheGet_('cl1');
  if (cached) return cached.cl;
  var sh = ensureSheet_(ss_(), CHK_SHEET, CHK_HEADERS);
  var last = sh.getLastRow();
  if (last < 2) { cachePut_('cl1', { cl: null }); return null; }
  var vals = sh.getRange(2, 1, last - 1, CHK_HEADERS.length).getValues();
  var out = [], map = {};
  for (var i = 0; i < vals.length; i++) {
    var sc = String(vals[i][0]).trim();
    if (!sc) continue;
    if (!map[sc]) { map[sc] = { code: sc, en: String(vals[i][1] || ''), zh: String(vals[i][2] || ''), items: [] }; out.push(map[sc]); }
    if (String(vals[i][3]) || String(vals[i][4])) {
      map[sc].items.push({ en: String(vals[i][3] || ''), zh: String(vals[i][4] || ''),
                           evEn: String(vals[i][5] || ''), evZh: String(vals[i][6] || '') });
    }
  }
  var result = out.length ? out : null;
  cachePut_('cl1', { cl: result });
  return result;
}

function saveChecklist_(cl) {
  if (!cl || !cl.length) return { ok: false, error: 'empty checklist' };
  var sh = ensureSheet_(ss_(), CHK_SHEET, CHK_HEADERS);
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, CHK_HEADERS.length).clearContent();
  var rows = [];
  for (var s = 0; s < cl.length; s++) {
    var sec = cl[s];
    var items = sec.items || [];
    for (var i = 0; i < items.length; i++) {
      rows.push([sec.code, sec.en || '', sec.zh || '', items[i].en || '', items[i].zh || '',
                 items[i].evEn || '', items[i].evZh || '']);
    }
  }
  if (rows.length) sh.getRange(2, 1, rows.length, CHK_HEADERS.length).setValues(rows);
  cacheDel_('cl1');
  return { ok: true };
}

/* ===== 新版 PDF 流程:前端產生 PDF 後上傳存回 Drive ===== */
function filesData_(ids) {
  ids = ids || [];
  var out = {}, total = 0;
  var PER_FILE = 4 * 1024 * 1024;    // ★ 單檔上限 4MB:舊未壓縮大圖跳過(PDF 以「存於 Drive」佔位),避免回應過大失敗
  var PER_CALL = 12 * 1024 * 1024;   // ★ 單次回應總量上限
  for (var i = 0; i < ids.length; i++) {
    try {
      var f = DriveApp.getFileById(ids[i]);
      var b = f.getBlob();
      var mime = String(b.getContentType() || '');
      if (mime.indexOf('image/') !== 0) continue;          // 只回傳圖片
      var bytes = b.getBytes();
      if (bytes.length > PER_FILE) {
        /* ★ 大圖不傳原始檔:改抓 Drive 自動產生的 1280px 縮圖(幾百 KB),PDF 照樣有圖、原始檔保留於 Drive
           (首次使用需重新授權:GAS 編輯器隨便執行一次函式,同意新的「外部連線」權限) */
        var tb = driveThumb_(ids[i]);
        if (tb && total + tb.length < PER_CALL) { total += tb.length; out[ids[i]] = tb; }
        continue;
      }
      if (total + bytes.length > PER_CALL) continue;
      total += bytes.length;
      out[ids[i]] = 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes);
    } catch (e) {}
  }
  return { ok: true, images: out };
}

/* 🛠 工作範疇清單(統一下拉選項,避免同工作不同名稱) */
function getScopes_() {
  try {
    var s = PropertiesService.getScriptProperties().getProperty('SCOPE_LIST');
    return { ok: true, scopes: s ? JSON.parse(s) : [] };
  } catch (e) { return { ok: true, scopes: [] }; }
}
function saveScopes_(list) {
  list = (list || []).map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
  PropertiesService.getScriptProperties().setProperty('SCOPE_LIST', JSON.stringify(list));
  return { ok: true, scopes: list };
}

/* 👀 瀏覽人數:每個瀏覽器工作階段 +1(重新整理不重複計) */
function visit_(first) {
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('VISIT_COUNT') || '0', 10);
  if (first) { n++; props.setProperty('VISIT_COUNT', String(n)); }
  return { ok: true, count: n };
}

/* ================= 🕘 歷程紀錄與版本還原 =================
 * 每次新增/儲存/刪除都寫入 AuditLog 工作表;儲存與刪除連同完整快照(snapJson)一起存,
 * 之後可整筆還原(連被刪除的紀錄與附件都能救回 — 附件從 Drive 垃圾桶取回)。
 * 註:GAS 無法取得使用者 IP,以「角色+裝置代碼+瀏覽器」代替識別。 */
var AUDIT_SHEET = 'AuditLog';
var AUDIT_HEADERS = ['ts','action','inspId','inspNo','vessel','role','device','ua','note','snapJson'];

function logAudit_(action, o, who, note, snap) {
  try {
    who = who || {};
    var sh = ensureSheet_(ss_(), AUDIT_SHEET, AUDIT_HEADERS);
    var sj = '';
    if (snap) {
      sj = JSON.stringify(snap);
      if (sj.length > 45000) {   // Sheets 單格上限 5 萬字:過大時去掉檢查表快照再試
        try { var c = JSON.parse(sj); if (c.item && c.item.data) delete c.item.data.checklist; sj = JSON.stringify(c); } catch (e2) {}
        if (sj.length > 45000) sj = '';
      }
    }
    sh.appendRow([stamp_(), action, (o && o.id) || '', (o && o.inspNo) || '',
      (o && (o.vesselEn || o.vesselZh)) || '', String(who.role || ''), String(who.device || ''),
      String(who.ua || '').slice(0, 120), String(note || ''), sj]);
  } catch (e) {}
}

function auditList_() {
  var sh = ensureSheet_(ss_(), AUDIT_SHEET, AUDIT_HEADERS);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [] };
  var n = Math.min(300, last - 1);                       // 最新 300 筆
  var vals = sh.getRange(last - n + 1, 1, n, AUDIT_HEADERS.length).getValues();
  var rows = [];
  for (var i = vals.length - 1; i >= 0; i--) {
    rows.push({ rowId: last - n + 1 + i, ts: String(vals[i][0]), action: String(vals[i][1]),
      inspId: String(vals[i][2]), inspNo: String(vals[i][3]), vessel: String(vals[i][4]),
      role: String(vals[i][5]), device: String(vals[i][6]), ua: String(vals[i][7]),
      note: String(vals[i][8]), hasSnap: !!vals[i][9] });
  }
  return { ok: true, rows: rows };
}

function restoreFromLog_(rowId, who) {
  var sh = ensureSheet_(ss_(), AUDIT_SHEET, AUDIT_HEADERS);
  var r = parseInt(rowId, 10);
  if (!r || r < 2 || r > sh.getLastRow()) return { ok: false, error: '找不到歷程紀錄' };
  var vals = sh.getRange(r, 1, 1, AUDIT_HEADERS.length).getValues()[0];
  var sj = vals[9];
  if (!sj) return { ok: false, error: '此筆歷程沒有快照,無法還原' };
  var snap; try { snap = JSON.parse(sj); } catch (e) { return { ok: false, error: '快照資料損毀' }; }
  var item = snap.item;
  if (!item || !item.id) return { ok: false, error: '快照缺少內容' };
  var atts = item.attachments || snap.attachments || [];
  delete item.attachments;
  var saved = saveInspection_(item);
  /* 附件:從 Drive 垃圾桶救回 + 補回附件清單 */
  var have = {};
  listAttachments_(item.id).forEach(function (a) { have[a.fileId] = 1; });
  var shA = ensureSheet_(ss_(), ATT_SHEET, ATT_HEADERS);
  for (var i = 0; i < atts.length; i++) {
    var a = atts[i];
    try { DriveApp.getFileById(a.fileId).setTrashed(false); } catch (e) {}
    if (!have[a.fileId]) shA.appendRow(ATT_HEADERS.map(function (h) { return a[h] || ''; }));
  }
  cacheDel_('list1');
  logAudit_('restore', saved, who, '還原自 ' + String(vals[0]), { item: saved, attachments: atts });
  return { ok: true, item: saved };
}

/* 單檔原圖(不限大小,上限 25MB 防止回應爆掉):給前端在縮圖失敗時取回自行壓縮,確保圖片檔一定顯示 */
function fileData_(id) {
  try {
    var f = DriveApp.getFileById(id);
    var b = f.getBlob();
    var mime = String(b.getContentType() || '');
    if (mime.indexOf('image/') !== 0) return { ok: true, image: null };
    var bytes = b.getBytes();
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) return { ok: true, image: null };
    return { ok: true, image: 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes) };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/* 📎 附件原始位元組(分段)— 前端要把 PDF 附件原件併進匯出的報表時用
   fileData_ / filesData_ 只處理圖片(PDF 一律回 null),這支不看 mime,直接給位元組。
   分段的理由:單次回應太大會失敗(filesData_ 的 PER_CALL 上限是 12MB),
   8MB 的 PDF 做成 base64 是 11MB,整包回不來 → 前端每次抓 1.2MB(base64 後約 1.6MB)。
   回傳:{ ok, size, start, len, b64, eof, mime, name } */
function fileRaw_(req) {
  var id = String((req && req.id) || '');
  if (!id) return { ok: false, error: 'NO_ID' };
  var start = Math.max(0, Number(req.start) || 0);
  var len = Number(req.len) || 1200000;
  if (len < 1) len = 1200000;
  if (len > 2000000) len = 2000000;          // 上限,避免回應過大
  try {
    var f = DriveApp.getFileById(id);
    var b = f.getBlob();
    var mime = String(b.getContentType() || '');
    var name = f.getName();
    var bytes = b.getBytes();
    var size = bytes.length;
    if (start >= size) return { ok: true, size: size, start: start, len: 0, b64: '', eof: true, mime: mime, name: name };
    var end = Math.min(size, start + len);
    var slice = bytes.slice(start, end);
    return { ok: true, size: size, start: start, len: slice.length,
             b64: Utilities.base64Encode(slice), eof: end >= size, mime: mime, name: name };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/* 取 Drive 圖片縮圖(寬 1280px):失敗回 null(前端以佔位顯示) */
function driveThumb_(fileId) {
  try {
    var resp = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1280', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      followRedirects: true, muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return null;
    var blob = resp.getBlob();
    var mime = String(blob.getContentType() || 'image/jpeg');
    if (mime.indexOf('image/') !== 0) return null;
    var bytes = blob.getBytes();
    if (!bytes.length || bytes.length > 3 * 1024 * 1024) return null;
    return 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes);
  } catch (e) { return null; }
}

function storePdf_(req) {
  if (!req.id || !req.base64) return { ok: false, error: '缺少參數' };
  var o = getInspection_(req.id);
  var name = req.name || ('船檢表_' + (o.inspNo || o.id) + '.pdf');
  var blob = Utilities.newBlob(Utilities.base64Decode(req.base64), 'application/pdf', name);
  var folder = null;
  if (PDF_FOLDER_ID) { try { folder = DriveApp.getFolderById(PDF_FOLDER_ID); } catch (e) {} }
  if (!folder) folder = inspFolder_(req.id);   // 指定資料夾無效 → 回退存該筆檢查資料夾
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return {
    ok: true, name: name, url: file.getUrl(),
    download: 'https://drive.google.com/uc?export=download&id=' + file.getId()
  };
}

/* ================= PDF 匯出留底(舊版轉檔,保留備用) =================
 * 前端送來報表 HTML(附件圖片以 {{IMG:fileId}} 佔位),
 * 伺服器將圖片內嵌為 base64 後轉 PDF,存回該筆檢查的 Drive 資料夾 */
var PDF_IMG_LIMIT = 26 * 1024 * 1024; // 內嵌圖片總量上限 ~26MB

function exportPdf_(req) {
  if (!req.id || !req.html) return { ok: false, error: '缺少參數' };
  var o = getInspection_(req.id);

  var total = 0;
  var html = String(req.html).replace(/\{\{IMG:([-\w]+)\}\}/g, function (m, fid) {
    try {
      var f = DriveApp.getFileById(fid);
      var b = f.getBlob();
      var mime = String(b.getContentType() || '');
      var driveNote = '<div style="color:#555; font-size:9px; margin-top:4px">📁 原始檔存放於 Google Drive 對應檢查資料夾內<br>File stored in the corresponding Google Drive inspection folder</div>';
      if (mime.indexOf('image/') !== 0) return driveNote;    // 非圖片:列檔名 + Drive 註記
      var bytes = b.getBytes();
      if (total + bytes.length > PDF_IMG_LIMIT)
        return '<div style="color:#888">(圖片過大,未嵌入 image not embedded)</div>' + driveNote;
      total += bytes.length;
      return '<img src="data:' + mime + ';base64,' + Utilities.base64Encode(bytes) + '">'; // 尺寸由報表 CSS 控制
    } catch (e) { return '<div style="color:#888">(附件無法讀取)</div>'; }
  });

  var pdf = Utilities.newBlob(html, 'text/html', 'report.html').getAs(MimeType.PDF);
  var name = '船檢表_' + (o.inspNo ? o.inspNo + '_' : '') +
             (o.vesselEn || o.vesselZh || o.id) + '_' + (o.nmdcDate || today_()) + '.pdf';
  pdf.setName(name);
  var file = inspFolder_(req.id).createFile(pdf);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  return {
    ok: true, name: name, url: file.getUrl(),
    download: 'https://drive.google.com/uc?export=download&id=' + file.getId()
  };
}

function listAttachments_(inspId) {
  var sh = ensureSheet_(ss_(), ATT_SHEET, ATT_HEADERS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, ATT_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][1]) !== String(inspId)) continue;
    var a = {};
    for (var c = 0; c < ATT_HEADERS.length; c++) {
      var v = vals[i][c];
      a[ATT_HEADERS[c]] = (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss') : v;
    }
    out.push(a);
  }
  return out;
}
