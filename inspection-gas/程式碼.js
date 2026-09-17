// ═══════════════════════════════════════════════════════════════════
// NMDC 通霄二期 — 查驗紀錄管理系統 (Backend: Google Apps Script)
// v4.0.0  三階段流程版
// ═══════════════════════════════════════════════════════════════════
//
// 【v4 變更重點】
// 1. 查驗階段改為 3 階段：1.NMDC自檢完成 / 2.POE查驗完成 / 3.已提交台電
//    → 階段 3（已提交台電）即計入「已查驗金額」（原本要到階段5台電已核准才算）
//    → 舊資料自動轉換：1,2→1 / 3→2 / 4,5→3（第一次寫入時自動執行，或手動執行 migrateStagesToV4）
// 2. 查驗紀錄新增「工區 work_area」欄位
// 3. Drive 子資料夾名稱 = 「查驗編號 工區 項目」
//    項目 = 預算項目名稱最後一個「，」之後的文字
//    例：NMDC-POE-BOQ-E-012 A區 水質監測
// 4. 可連結現有資料夾：
//    - 前端可貼上現有 Drive 資料夾連結／ID（link_folder_url）
//    - 留空時，會自動尋找母資料夾中同「查驗編號」的既有資料夾並連結（不重複建立）
//    - 若既有資料夾名稱是以查驗編號開頭，會自動改名為新格式
// 5. 附件不限總量；單檔上限由前端控制（40MB，Apps Script 單次請求上限約 50MB）
//
// 【部署步驟】
// 1. 貼上此檔案內容至 Code.gs 並儲存
// 2. 執行 upgradeToV4()   ← 一次性：補欄位 + 轉換階段 + 重新命名既有資料夾
// 3. 部署 → 管理部署作業 → 編輯 → 版本選「新版本」→ 部署（URL 不變）
//
// 【Google Sheets 結構】
//   工作表1: 預算項目表 (BudgetItems)
//   工作表2: 查驗紀錄表 (Inspections)
//   工作表3: 操作日誌表 (Logs)
//   工作表4: 系統設定 (Config)
// ═══════════════════════════════════════════════════════════════════

// ── 全域設定 ──
const SHEET_BUDGET   = '預算項目表';
const SHEET_INSPECT  = '查驗紀錄表';
const SHEET_LOGS     = '操作日誌表';
const SHEET_CONFIG   = '系統設定';
const DRIVE_FOLDER_NAME = 'NMDC_查驗附件_通霄二期';
const ROOT_FOLDER_ID = '15YFJiEfS4wiFxTEBazXRBMFDPQX7CDiS';
const ID_PREFIX = 'NMDC-POE-BOQ-E-';

// ── 查驗紀錄表欄位 ──
const COL_ID = 1, COL_DATE = 2, COL_BUDGET_ID = 3, COL_ITEM_NAME = 4,
      COL_QTY = 5, COL_PRICE = 6, COL_AMOUNT = 7, COL_NOTE = 8,
      COL_ATT_IDS = 9, COL_ATT_NAMES = 10, COL_CREATED_AT = 11, COL_CREATED_BY = 12,
      COL_UPDATED_AT = 13, COL_UPDATED_BY = 14, COL_DELETED = 15,
      COL_SUBMIT = 16, COL_APPROVE = 17, COL_STAGE = 18,
      COL_WORK_AREA = 19, COL_FOLDER_ID = 20, COL_FOLDER_NAME = 21;
const INSPECT_COLS = 21;

const INSPECT_HEADERS = [
  'inspection_id','inspection_date','budget_item_id','item_name_snapshot',
  'inspected_qty','unit_price_snapshot','inspected_amount','note',
  'attachment_ids','attachment_names','created_at','created_by',
  'updated_at','updated_by','deleted','submit_date','approve_date','stage',
  'work_area','folder_id','folder_name'
];

// 階段設定：3 = 已提交台電 = 計入已查驗金額
const STAGE_COUNT = 3;
const FINAL_STAGE = 3;
const STAGE_LABELS = ['NMDC自檢完成', 'POE查驗完成', '已提交台電'];

// ══════════════════════════════════
// 初始化系統 (手動執行一次)
// ══════════════════════════════════
function initSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  _getOrCreateSheet(ss, SHEET_BUDGET, [
    'budget_item_id','item_no','category','category_en','item_name_cn','item_name_en',
    'unit','budget_qty','unit_price','budget_total','remarks','code','active'
  ]);

  _getOrCreateSheet(ss, SHEET_INSPECT, INSPECT_HEADERS);

  _getOrCreateSheet(ss, SHEET_LOGS, [
    'log_id','action','target','target_id','detail','timestamp','action_by'
  ]);

  _getOrCreateSheet(ss, SHEET_CONFIG, ['key','value']);

  // ── Google Drive 附件資料夾 (根資料夾，每個查驗建子資料夾) ──
  let folderId = ROOT_FOLDER_ID;
  try {
    DriveApp.getFolderById(ROOT_FOLDER_ID).getName();
    Logger.log('根附件資料夾可用: ' + ROOT_FOLDER_ID);
  } catch (e) {
    Logger.log('無法存取根資料夾: ' + e.message + '，建立新資料夾');
    folderId = DriveApp.createFolder(DRIVE_FOLDER_NAME).getId();
  }
  _setConfigValue('drive_folder_id', folderId);

  const budgetSheet = ss.getSheetByName(SHEET_BUDGET);
  if (budgetSheet.getLastRow() <= 1) {
    _importInitialBudget(budgetSheet);
    Logger.log('已匯入預算資料');
  }

  _ensureInspectColumns();

  Logger.log('✅ 系統初始化完成');
  Logger.log('   Spreadsheet ID: ' + ss.getId());
  Logger.log('   Drive Folder ID: ' + folderId);
}

// ══════════════════════════════════
// v4 一次性升級 (手動執行一次)
// ══════════════════════════════════
function upgradeToV4() {
  _ensureInspectColumns();
  const m = _ensureV4Stages();
  const r = renameAllFolders();
  Logger.log('✅ v4 升級完成');
  Logger.log('   階段轉換: ' + m.message);
  Logger.log('   資料夾: ' + r.message);
  return { stages: m, folders: r };
}

/** 手動重跑階段轉換（已轉換過就不會重複跑） */
function migrateStagesToV4() {
  return _ensureV4Stages();
}

/**
 * 依新規則重新命名／連結所有查驗紀錄的 Drive 子資料夾。
 * 名稱 = 查驗編號 工區 項目
 * 沒有資料夾的紀錄會去母資料夾找同編號的舊資料夾；找不到才建立。
 */
function renameAllFolders() {
  const sheet = _ensureInspectColumns();
  if (sheet.getLastRow() <= 1) return { success: true, message: '無紀錄', renamed: 0, linked: 0, created: 0 };

  const n = sheet.getLastRow() - 1;
  const rows = sheet.getRange(2, 1, n, INSPECT_COLS).getValues();
  let renamed = 0, linked = 0, created = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[COL_DELETED - 1] === true || r[COL_DELETED - 1] === 'TRUE') continue;
    const id = String(r[COL_ID - 1] || '').trim();
    if (!id) continue;

    const name = _folderName(id, r[COL_WORK_AREA - 1], r[COL_ITEM_NAME - 1]);
    const curId = String(r[COL_FOLDER_ID - 1] || '').trim();

    try {
      if (curId) {
        const f = DriveApp.getFolderById(curId);
        if (f.getName() !== name && f.getName().indexOf(id) === 0) { f.setName(name); renamed++; }
        sheet.getRange(i + 2, COL_FOLDER_NAME).setValue(f.getName());
      } else {
        const res = _resolveInspectionFolder(id, name, '');
        sheet.getRange(i + 2, COL_FOLDER_ID).setValue(res.id);
        sheet.getRange(i + 2, COL_FOLDER_NAME).setValue(res.name);
        if (res.created) created++; else { linked++; if (res.renamed) renamed++; }
      }
    } catch (e) {
      Logger.log('資料夾處理失敗 ' + id + ': ' + e.message);
    }
  }

  const msg = '連結 ' + linked + ' 個、改名 ' + renamed + ' 個、新建 ' + created + ' 個';
  _addLog('UPDATE', 'folder', 'ALL', '重新整理 Drive 資料夾：' + msg, 'System');
  return { success: true, message: msg, renamed: renamed, linked: linked, created: created };
}

// ══════════════════════════════════
// Web App 入口 (GET / POST)
// ══════════════════════════════════
function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    switch (action) {
      case 'getBudgetItems':
        result = _getBudgetItems();
        break;
      case 'getInspections':
        result = _getInspections();
        break;
      case 'getLogs':
        result = _getLogs(parseInt(e.parameter.limit) || 100);
        break;
      case 'getSummary':
        result = _getSummary();
        break;
      case 'getItemHistory':
        result = _getItemHistory(e.parameter.budget_item_id);
        break;
      case 'getNextNumber':
        result = _getNextInspectionNumber();
        break;
      case 'listFolders':
        result = _listSubfolders();
        break;
      case 'findFolder':
        result = _findFolderByNumber(e.parameter.inspection_no || e.parameter.inspection_id);
        break;
      case 'ping':
        result = { status: 'ok', timestamp: new Date().toISOString(), version: '4.0.0', stage_scheme: _isV4() ? 'v4' : 'legacy', code_updated: '2026-09-17' };
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return _jsonResponse(result);
}

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return _jsonResponse({ error: 'Invalid JSON payload' });
  }

  const action = payload.action;
  let result;

  try {
    switch (action) {
      case 'addInspection':
        _ensureV4Stages();
        result = _addInspection(payload.data);
        break;
      case 'updateInspection':
        _ensureV4Stages();
        result = _updateInspection(payload.data);
        break;
      case 'deleteInspection':
        result = _deleteInspection(payload.data.inspection_id, payload.data.deleted_by || 'Admin');
        break;
      case 'uploadAttachment':
        result = _uploadAttachment(payload.data);
        break;
      case 'deleteAttachment':
        result = _deleteAttachment(payload.data.file_id);
        break;
      case 'updateBudgetItem':
        result = _updateBudgetItem(payload.data);
        break;
      case 'uploadToFolder':
        result = _uploadToExistingFolder(payload.data);
        break;
      case 'importBudgetData':
        result = _importBudgetData(payload.data);
        break;
      case 'importBudget':
        result = _reimportBudget();
        break;
      case 'renameFolders':
        result = renameAllFolders();
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return _jsonResponse(result);
}

// ══════════════════════════════════
// 階段（3 階段）
// ══════════════════════════════════

var _V4_CACHE = null;

function _isV4() {
  if (_V4_CACHE === null) _V4_CACHE = (String(_getConfigValue('stage_scheme') || '') === 'v4');
  return _V4_CACHE;
}

/** 讀取時把舊 5 階段值換算成新 3 階段值 */
function _normStage(raw, submitDate, approveDate) {
  var s = parseInt(raw);
  if (!s || isNaN(s)) {
    var hasApprove = approveDate && String(approveDate).trim() !== '';
    var hasSubmit  = submitDate && String(submitDate).trim() !== '';
    return (hasApprove || hasSubmit) ? FINAL_STAGE : 1;
  }
  if (_isV4()) return Math.min(Math.max(s, 1), STAGE_COUNT);
  return s <= 2 ? 1 : (s === 3 ? 2 : 3);   // 1,2→1 / 3→2 / 4,5→3
}

/** 寫入前確保工作表已轉成 3 階段（只會跑一次） */
function _ensureV4Stages() {
  if (_isV4()) return { success: true, message: '已是 v4，未重複轉換', converted: 0 };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { throw new Error('系統忙碌中，請稍後再試'); }

  try {
    _V4_CACHE = null;
    if (_isV4()) return { success: true, message: '已是 v4，未重複轉換', converted: 0 };

    const sheet = _ensureInspectColumns();
    let converted = 0;
    if (sheet.getLastRow() > 1) {
      const n = sheet.getLastRow() - 1;
      const rng = sheet.getRange(2, COL_STAGE, n, 1);
      const vals = rng.getValues();
      const dates = sheet.getRange(2, COL_SUBMIT, n, 2).getValues(); // submit, approve
      const out = vals.map(function (v, i) {
        const old = parseInt(v[0]);
        let ns;
        if (!old || isNaN(old)) {
          const hasApprove = dates[i][1] && String(dates[i][1]).trim() !== '';
          const hasSubmit  = dates[i][0] && String(dates[i][0]).trim() !== '';
          ns = (hasApprove || hasSubmit) ? FINAL_STAGE : 1;
        } else {
          ns = old <= 2 ? 1 : (old === 3 ? 2 : 3);
        }
        if (ns !== old) converted++;
        return [ns];
      });
      rng.setValues(out);
    }

    _setConfigValue('stage_scheme', 'v4');
    _V4_CACHE = true;
    _addLog('UPDATE', 'inspection', 'ALL', '階段制度轉換 5→3 階段，異動 ' + converted + ' 筆', 'System');
    return { success: true, message: '已轉換 ' + converted + ' 筆', converted: converted };
  } finally {
    lock.releaseLock();
  }
}

// ══════════════════════════════════
// 資料夾命名 / 連結
// ══════════════════════════════════

/** 項目簡稱 = 名稱最後一個「，」之後的文字 */
function _shortItem(name) {
  var t = String(name == null ? '' : name).trim();
  if (!t) return '';
  var parts = t.split(/[，,]/);
  var last = String(parts[parts.length - 1] || '').trim();
  return last || t;
}

/** 資料夾名稱 = 查驗編號 工區 項目 */
function _folderName(inspectionId, workArea, itemName) {
  return [String(inspectionId || '').trim(), String(workArea || '').trim(), _shortItem(itemName)]
    .filter(function (x) { return x !== ''; })
    .join(' ');
}

/** 從連結或 ID 字串取出 Drive folder id */
function _extractFolderId(ref) {
  if (!ref) return '';
  var t = String(ref).trim();
  if (!t) return '';
  var m = t.match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

function _rootFolder() {
  return DriveApp.getFolderById(_getConfigValue('drive_folder_id') || ROOT_FOLDER_ID);
}

/**
 * 取得該查驗編號要用的資料夾：
 *   1) 有指定 linkRef → 直接用該資料夾（名稱以編號開頭才會改名）
 *   2) 母資料夾中有完全同名的 → 連結
 *   3) 母資料夾中有以「查驗編號」開頭的舊資料夾 → 連結並改名為新格式
 *   4) 都沒有 → 新建
 */
function _resolveInspectionFolder(inspectionId, name, linkRef) {
  var linkId = _extractFolderId(linkRef);
  if (linkId) {
    var lf;
    try { lf = DriveApp.getFolderById(linkId); }
    catch (e) { throw new Error('無法存取指定的 Drive 資料夾（請確認連結與權限）: ' + e.message); }
    var renamed = false;
    if (lf.getName() !== name && lf.getName().indexOf(inspectionId) === 0) { lf.setName(name); renamed = true; }
    return { id: lf.getId(), name: lf.getName(), created: false, renamed: renamed, linked: true };
  }

  var root = _rootFolder();

  var same = root.getFoldersByName(name);
  if (same.hasNext()) {
    var sf = same.next();
    return { id: sf.getId(), name: sf.getName(), created: false, renamed: false, linked: true };
  }

  var all = root.getFolders();
  while (all.hasNext()) {
    var c = all.next();
    var cn = c.getName();
    var isSameNo = (cn === inspectionId) ||
      (cn.indexOf(inspectionId) === 0 && !/^[0-9]/.test(cn.slice(inspectionId.length)));
    if (isSameNo) {
      var r = false;
      if (cn !== name) { try { c.setName(name); r = true; } catch (e) { Logger.log('改名失敗: ' + e.message); } }
      return { id: c.getId(), name: r ? name : cn, created: false, renamed: r, linked: true };
    }
  }

  var nf = root.createFolder(name);
  return { id: nf.getId(), name: name, created: true, renamed: false, linked: false };
}

/** 查詢某編號目前對應的資料夾（前端可用來確認要不要連結） */
function _findFolderByNumber(noOrId) {
  if (!noOrId) throw new Error('缺少查驗編號');
  var id = String(noOrId).indexOf(ID_PREFIX) === 0 ? String(noOrId).trim() : ID_PREFIX + String(noOrId).trim();
  var root = _rootFolder();
  var all = root.getFolders();
  while (all.hasNext()) {
    var c = all.next();
    var cn = c.getName();
    if (cn === id || (cn.indexOf(id) === 0 && !/^[0-9]/.test(cn.slice(id.length)))) {
      return { found: true, inspection_id: id, folder_id: c.getId(), folder_name: cn,
               folder_url: 'https://drive.google.com/drive/folders/' + c.getId() };
    }
  }
  return { found: false, inspection_id: id };
}

// ══════════════════════════════════
// CRUD: 查驗紀錄
// ══════════════════════════════════

function _addInspection(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = _ensureInspectColumns();
  const budgetSheet = ss.getSheetByName(SHEET_BUDGET);

  const budget = _findBudgetItem(budgetSheet, data.budget_item_id);
  if (!budget) throw new Error('找不到預算項目: ' + data.budget_item_id);

  const qty = parseFloat(data.inspected_qty);
  if (isNaN(qty) || qty <= 0) throw new Error('查驗數量必須大於 0');

  const existingQty = _getInspectedQty(sheet, data.budget_item_id);
  if (existingQty + qty > budget.budget_qty) {
    throw new Error('超過預算數量！預算: ' + budget.budget_qty + ', 已開立: ' + existingQty + ', 剩餘: ' + (budget.budget_qty - existingQty));
  }

  // 產生 ID — 自動遞增或使用者指定
  var inspectionId;
  if (data.inspection_no && String(data.inspection_no).trim() !== '') {
    inspectionId = ID_PREFIX + String(data.inspection_no).trim();
  } else {
    var nextNum = _getNextNum(sheet);
    inspectionId = ID_PREFIX + String(nextNum).padStart(3, '0');
  }

  if (_findInspectionRow(sheet, inspectionId) > 0) {
    throw new Error('查驗編號已存在: ' + inspectionId);
  }

  const workArea = String(data.work_area || '').trim();
  const stage = Math.min(Math.max(parseInt(data.stage) || 1, 1), STAGE_COUNT);

  // 階段 3（已提交台電）→ 沒填提送日期就帶今天
  var submitDate = data.submit_date || '';
  if (stage >= FINAL_STAGE && !String(submitDate).trim()) {
    submitDate = new Date().toISOString().slice(0, 10);
  }

  // 建立 / 連結子資料夾
  var folderInfo = { id: '', name: '' };
  const wantName = _folderName(inspectionId, workArea, budget.item_name_cn);
  try {
    folderInfo = _resolveInspectionFolder(inspectionId, wantName, data.link_folder_url || data.folder_id || '');
  } catch (e) {
    Logger.log('無法建立/連結子資料夾: ' + e.message);
  }

  // 處理附件（上傳到子資料夾，失敗不擋紀錄建立）
  var attachmentIds = '';
  var attachmentNames = '';
  var attachmentWarning = '';
  if (data.attachments && data.attachments.length > 0) {
    try {
      var results = [];
      for (var ai = 0; ai < data.attachments.length; ai++) {
        var att = data.attachments[ai];
        if (folderInfo.id) results.push(_uploadToFolder_internal(att, folderInfo.id));
        else results.push(_uploadAttachment(att));
      }
      attachmentIds = results.map(function (r) { return r.file_id; }).join(',');
      attachmentNames = results.map(function (r) { return r.file_name; }).join(',');
    } catch (e) {
      attachmentWarning = '附件上傳失敗: ' + e.message;
      Logger.log(attachmentWarning);
    }
  }

  var now = new Date().toISOString();
  var amount = qty * budget.unit_price;

  sheet.appendRow([
    inspectionId,
    data.inspection_date,
    data.budget_item_id,
    budget.item_name_cn,
    qty,
    budget.unit_price,
    amount,
    data.note || '',
    attachmentIds,
    attachmentNames,
    now,
    data.created_by || 'Admin',
    '',
    '',
    'FALSE',
    submitDate,
    data.approve_date || '',
    stage,
    workArea,
    folderInfo.id || '',
    folderInfo.name || ''
  ]);

  _addLog('CREATE', 'inspection', inspectionId,
    '新增查驗 ' + inspectionId + ' (' + budget.item_no + ' ' + budget.item_name_cn +
    ', 工區: ' + (workArea || '—') + ', 數量: ' + qty + ', 金額: ' + amount +
    ', 階段: ' + STAGE_LABELS[stage - 1] + ')',
    data.created_by || 'Admin');

  return {
    success: true,
    inspection_id: inspectionId,
    inspected_amount: amount,
    stage: stage,
    work_area: workArea,
    folder_id: folderInfo.id || '',
    folder_name: folderInfo.name || '',
    folder_linked: !!folderInfo.linked,
    message: '查驗紀錄已新增' +
      (folderInfo.linked ? '（已連結既有資料夾「' + folderInfo.name + '」）' : '') +
      (attachmentWarning ? '（' + attachmentWarning + '）' : '')
  };
}

function _updateInspection(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = _ensureInspectColumns();
  const budgetSheet = ss.getSheetByName(SHEET_BUDGET);

  const rowIdx = _findInspectionRow(sheet, data.inspection_id);
  if (rowIdx < 0) throw new Error('找不到查驗紀錄: ' + data.inspection_id);

  const row = sheet.getRange(rowIdx, 1, 1, INSPECT_COLS).getValues()[0];
  const budgetItemId = row[COL_BUDGET_ID - 1];
  const budget = _findBudgetItem(budgetSheet, budgetItemId);

  // ── 編號 ──
  var currentId = String(row[COL_ID - 1]);
  if (data.inspection_no && String(data.inspection_no).trim() !== '') {
    const newId = ID_PREFIX + String(data.inspection_no).trim();
    if (newId !== currentId) {
      const dupRow = _findInspectionRow(sheet, newId);
      if (dupRow > 0) throw new Error('查驗編號已存在: ' + newId);
      sheet.getRange(rowIdx, COL_ID).setValue(newId);
      currentId = newId;
    }
  }

  // ── 數量 ──
  if (data.inspected_qty !== undefined) {
    const newQty = parseFloat(data.inspected_qty);
    if (isNaN(newQty) || newQty <= 0) throw new Error('查驗數量必須大於 0');

    const existingQty = _getInspectedQty(sheet, budgetItemId, data.inspection_id);
    if (existingQty + newQty > budget.budget_qty) {
      throw new Error('超過預算數量！剩餘: ' + (budget.budget_qty - existingQty));
    }

    sheet.getRange(rowIdx, COL_QTY).setValue(newQty);
    sheet.getRange(rowIdx, COL_AMOUNT).setValue(newQty * budget.unit_price);
  }

  if (data.inspection_date !== undefined) sheet.getRange(rowIdx, COL_DATE).setValue(data.inspection_date);
  if (data.note !== undefined) sheet.getRange(rowIdx, COL_NOTE).setValue(data.note);
  if (data.submit_date !== undefined) sheet.getRange(rowIdx, COL_SUBMIT).setValue(data.submit_date);
  if (data.approve_date !== undefined) sheet.getRange(rowIdx, COL_APPROVE).setValue(data.approve_date);

  var workArea = String(row[COL_WORK_AREA - 1] || '');
  if (data.work_area !== undefined) {
    workArea = String(data.work_area || '').trim();
    sheet.getRange(rowIdx, COL_WORK_AREA).setValue(workArea);
  }

  // ── 階段 ──
  var stage = _normStage(row[COL_STAGE - 1], row[COL_SUBMIT - 1], row[COL_APPROVE - 1]);
  if (data.stage !== undefined) {
    stage = Math.min(Math.max(parseInt(data.stage) || 1, 1), STAGE_COUNT);
    sheet.getRange(rowIdx, COL_STAGE).setValue(stage);
    // 階段3 = 已提交台電 → 自動帶入提送日期（如果還沒填）
    if (stage >= FINAL_STAGE && !data.submit_date) {
      const curSubmit = row[COL_SUBMIT - 1] ? String(row[COL_SUBMIT - 1]).trim() : '';
      if (!curSubmit) sheet.getRange(rowIdx, COL_SUBMIT).setValue(new Date().toISOString().slice(0, 10));
    }
  }

  // ── 資料夾（改編號／工區／指定連結 → 重新解析或改名）──
  var folderId = String(row[COL_FOLDER_ID - 1] || '');
  var folderNm = String(row[COL_FOLDER_NAME - 1] || '');
  const wantName = _folderName(currentId, workArea, row[COL_ITEM_NAME - 1]);
  const linkRef = data.link_folder_url || '';
  try {
    if (linkRef || !folderId) {
      const res = _resolveInspectionFolder(currentId, wantName, linkRef);
      folderId = res.id; folderNm = res.name;
      sheet.getRange(rowIdx, COL_FOLDER_ID).setValue(folderId);
      sheet.getRange(rowIdx, COL_FOLDER_NAME).setValue(folderNm);
    } else if (folderNm !== wantName) {
      const f = DriveApp.getFolderById(folderId);
      if (f.getName().indexOf(currentId) === 0 || f.getName() === folderNm) {
        f.setName(wantName);
        folderNm = wantName;
      } else {
        folderNm = f.getName();
      }
      sheet.getRange(rowIdx, COL_FOLDER_NAME).setValue(folderNm);
    }
  } catch (e) {
    Logger.log('資料夾處理失敗: ' + e.message);
  }

  // ── 附件（相容舊前端：整包帶上來時直接傳到該紀錄的資料夾）──
  if (data.new_attachments && data.new_attachments.length > 0) {
    try {
      const results = data.new_attachments.map(function (att) {
        return folderId ? _uploadToFolder_internal(att, folderId) : _uploadAttachment(att);
      });
      const existingIds = row[COL_ATT_IDS - 1] ? row[COL_ATT_IDS - 1].toString() : '';
      const existingNames = row[COL_ATT_NAMES - 1] ? row[COL_ATT_NAMES - 1].toString() : '';
      const newIds = results.map(function (r) { return r.file_id; }).join(',');
      const newNames = results.map(function (r) { return r.file_name; }).join(',');
      sheet.getRange(rowIdx, COL_ATT_IDS).setValue(existingIds ? existingIds + ',' + newIds : newIds);
      sheet.getRange(rowIdx, COL_ATT_NAMES).setValue(existingNames ? existingNames + ',' + newNames : newNames);
    } catch (e) {
      Logger.log('附件上傳失敗（不影響查驗更新）: ' + e.message);
    }
  }

  const now = new Date().toISOString();
  sheet.getRange(rowIdx, COL_UPDATED_AT).setValue(now);
  sheet.getRange(rowIdx, COL_UPDATED_BY).setValue(data.updated_by || 'Admin');

  _addLog('UPDATE', 'inspection', currentId,
    '修改查驗 ' + currentId + '（階段: ' + STAGE_LABELS[stage - 1] + '，工區: ' + (workArea || '—') + '）',
    data.updated_by || 'Admin');

  return {
    success: true,
    inspection_id: currentId,
    stage: stage,
    work_area: workArea,
    folder_id: folderId,
    folder_name: folderNm,
    message: '查驗紀錄已更新'
  };
}

function _deleteInspection(inspectionId, deletedBy) {
  const sheet = _ensureInspectColumns();

  const rowIdx = _findInspectionRow(sheet, inspectionId);
  if (rowIdx < 0) throw new Error('找不到查驗紀錄: ' + inspectionId);

  sheet.getRange(rowIdx, COL_DELETED).setValue('TRUE');
  sheet.getRange(rowIdx, COL_UPDATED_AT).setValue(new Date().toISOString());
  sheet.getRange(rowIdx, COL_UPDATED_BY).setValue(deletedBy);

  _addLog('DELETE', 'inspection', inspectionId, '刪除查驗 ' + inspectionId, deletedBy);

  return { success: true, message: '查驗紀錄已刪除（軟刪除）' };
}

// ══════════════════════════════════
// 讀取資料
// ══════════════════════════════════

function _getBudgetItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_BUDGET);
  if (sheet.getLastRow() <= 1) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();
  return data.map(r => ({
    id: r[0], item_no: r[1], category: r[2], category_en: r[3],
    item_name_cn: r[4], item_name_en: r[5], unit: r[6],
    budget_qty: r[7], unit_price: r[8], budget_total: r[9],
    remarks: r[10], code: r[11], active: r[12] !== 'FALSE'
  })).filter(b => b.active !== false);
}

function _getInspections() {
  const sheet = _ensureInspectColumns();
  if (sheet.getLastRow() <= 1) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, INSPECT_COLS).getValues();
  return data.filter(r => r[COL_DELETED - 1] !== true && r[COL_DELETED - 1] !== 'TRUE').map(r => {
    const stage = _normStage(r[COL_STAGE - 1], r[COL_SUBMIT - 1], r[COL_APPROVE - 1]);
    const workArea = r[COL_WORK_AREA - 1] || '';
    return {
      id: r[COL_ID - 1], inspection_date: r[COL_DATE - 1], budget_item_id: r[COL_BUDGET_ID - 1],
      item_name_snapshot: r[COL_ITEM_NAME - 1], inspected_qty: r[COL_QTY - 1],
      unit_price_snapshot: r[COL_PRICE - 1], inspected_amount: r[COL_AMOUNT - 1], note: r[COL_NOTE - 1],
      attachment_ids: r[COL_ATT_IDS - 1] ? r[COL_ATT_IDS - 1].toString().split(',').filter(Boolean) : [],
      attachment_names: r[COL_ATT_NAMES - 1] ? r[COL_ATT_NAMES - 1].toString().split(',').filter(Boolean) : [],
      created_at: r[COL_CREATED_AT - 1], created_by: r[COL_CREATED_BY - 1],
      updated_at: r[COL_UPDATED_AT - 1], updated_by: r[COL_UPDATED_BY - 1], deleted: r[COL_DELETED - 1],
      submit_date: r[COL_SUBMIT - 1] || '', approve_date: r[COL_APPROVE - 1] || '',
      stage: stage,
      work_area: workArea,
      folder_id: r[COL_FOLDER_ID - 1] || '',
      folder_name: r[COL_FOLDER_NAME - 1] || _folderName(r[COL_ID - 1], workArea, r[COL_ITEM_NAME - 1])
    };
  });
}

function _getSummary() {
  const budgets = _getBudgetItems();
  const inspections = _getInspections();
  const folderId = _getConfigValue('drive_folder_id');

  const summaries = budgets.map(b => {
    const recs = inspections.filter(i => i.budget_item_id === b.id);

    const total_qty = recs.reduce((s, r) => s + (parseFloat(r.inspected_qty) || 0), 0);

    const stage_counts = [0, 0, 0];
    const stage_qtys = [0, 0, 0];
    recs.forEach(r => {
      const stg = Math.min(Math.max(parseInt(r.stage) || 1, 1), STAGE_COUNT);
      stage_counts[stg - 1]++;
      stage_qtys[stg - 1] += (parseFloat(r.inspected_qty) || 0);
    });

    // 已查驗 = 階段3（已提交台電）
    const inspected_qty = stage_qtys[FINAL_STAGE - 1];
    const inspected_amt = inspected_qty * b.unit_price;
    // 進行中 = 階段1+2（NMDC自檢 / POE查驗）
    const wip_qty = stage_qtys[0] + stage_qtys[1];
    const wip_amt = wip_qty * b.unit_price;
    // 未查驗 = 預算 − 所有已開立紀錄
    const remaining_qty = b.budget_qty - total_qty;
    const remaining_amt = b.budget_total - (total_qty * b.unit_price);
    const ratio = b.budget_qty > 0 ? inspected_qty / b.budget_qty : 0;

    const okRecs = recs.filter(r => (parseInt(r.stage) || 1) >= FINAL_STAGE);
    const lastDate = okRecs.length > 0
      ? okRecs.sort((a, c) => String(c.submit_date || c.inspection_date).localeCompare(String(a.submit_date || a.inspection_date)))[0].submit_date
      : null;

    return {
      ...b, inspected_qty, inspected_amt, remaining_qty, remaining_amt, ratio, lastDate,
      total_qty,
      // 相容舊欄位名：pending_* 現在代表「進行中（階段1-2）」
      pending_qty: wip_qty, pending_amt: wip_amt,
      wip_qty, wip_amt,
      stage_counts, stage_qtys,
      record_count: recs.length,
      approved_count: stage_counts[FINAL_STAGE - 1],
      pending_count: stage_counts[0] + stage_counts[1],
      wip_count: stage_counts[0] + stage_counts[1],
      status: ratio === 0 ? 'not_started' : ratio < 1 ? 'in_progress' : 'completed'
    };
  });

  const totalBudget = summaries.reduce((s, b) => s + b.budget_total, 0);
  const totalInspected = summaries.reduce((s, b) => s + b.inspected_amt, 0);
  const totalWip = summaries.reduce((s, b) => s + (b.wip_amt || 0), 0);
  const totalRecorded = summaries.reduce((s, b) => s + ((b.total_qty || 0) * b.unit_price), 0);

  const globalStageCounts = [0, 0, 0];
  inspections.forEach(i => {
    const stg = Math.min(Math.max(parseInt(i.stage) || 1, 1), STAGE_COUNT);
    globalStageCounts[stg - 1]++;
  });

  return {
    budgetItems: summaries,
    inspections: inspections,
    totals: {
      totalBudget,
      totalInspected,          // 已查驗（已提交台電）
      totalPending: totalWip,  // 相容舊名：進行中
      totalWip,
      totalRemaining: totalBudget - totalRecorded,
      overallRatio: totalBudget > 0 ? totalInspected / totalBudget : 0,
      totalRecords: inspections.length,
      approvedRecords: globalStageCounts[FINAL_STAGE - 1],
      pendingRecords: globalStageCounts[0] + globalStageCounts[1],
      wipRecords: globalStageCounts[0] + globalStageCounts[1],
      stageCounts: globalStageCounts,
      stageLabels: STAGE_LABELS,
      finalStage: FINAL_STAGE
    },
    drive_folder_id: folderId,
    stage_scheme: _isV4() ? 'v4' : 'legacy',
    timestamp: new Date().toISOString()
  };
}

function _getItemHistory(budgetItemId) {
  const inspections = _getInspections();
  return inspections.filter(i => i.budget_item_id === budgetItemId)
    .sort((a, b) => String(b.inspection_date).localeCompare(String(a.inspection_date)));
}

function _getLogs(limit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_LOGS);
  if (sheet.getLastRow() <= 1) return [];

  const lastRow = sheet.getLastRow();
  const startRow = Math.max(2, lastRow - limit + 1);
  const data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 7).getValues();

  return data.map(r => ({
    id: r[0], action: r[1], target: r[2], target_id: r[3],
    detail: r[4], timestamp: r[5], action_by: r[6]
  })).reverse();
}

// ══════════════════════════════════
// 附件管理 (Google Drive)
// ══════════════════════════════════

function _uploadAttachment(data) {
  const folderId = _getConfigValue('drive_folder_id');
  if (!folderId) throw new Error('附件資料夾未設定，請先執行 initSystem()');

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('無法存取附件資料夾 (ID: ' + folderId + ')，請確認資料夾權限或重新執行 initSystem()');
  }

  const decoded = Utilities.base64Decode(data.content);
  const blob = Utilities.newBlob(decoded, data.mimeType || 'application/octet-stream', data.filename);

  const file = folder.createFile(blob);

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('無法設定分享權限 (不影響上傳): ' + e.message);
  }

  return {
    success: true,
    file_id: file.getId(),
    file_name: file.getName(),
    file_url: file.getUrl(),
    file_size: file.getSize(),
    download_url: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
    view_url: 'https://drive.google.com/file/d/' + file.getId() + '/view'
  };
}

function _deleteAttachment(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    return { success: true, message: '附件已刪除' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function _uploadToExistingFolder(data) {
  const folderId = data.folder_id;
  if (!folderId) throw new Error('缺少 folder_id');
  const result = _uploadToFolder_internal(data, folderId);

  if (data.inspection_id) {
    const sheet = _ensureInspectColumns();
    const rowIdx = _findInspectionRow(sheet, data.inspection_id);
    if (rowIdx > 0) {
      const row = sheet.getRange(rowIdx, 1, 1, INSPECT_COLS).getValues()[0];
      const existingIds = row[COL_ATT_IDS - 1] ? row[COL_ATT_IDS - 1].toString() : '';
      const existingNames = row[COL_ATT_NAMES - 1] ? row[COL_ATT_NAMES - 1].toString() : '';
      sheet.getRange(rowIdx, COL_ATT_IDS).setValue(existingIds ? existingIds + ',' + result.file_id : result.file_id);
      sheet.getRange(rowIdx, COL_ATT_NAMES).setValue(existingNames ? existingNames + ',' + result.file_name : result.file_name);
    }
  }

  return result;
}

function _uploadToFolder_internal(data, folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const decoded = Utilities.base64Decode(data.content);
  const blob = Utilities.newBlob(decoded, data.mimeType || 'application/octet-stream', data.filename);
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return {
    success: true, file_id: file.getId(), file_name: file.getName(),
    file_url: file.getUrl(), file_size: file.getSize(),
    view_url: 'https://drive.google.com/file/d/' + file.getId() + '/view'
  };
}

// ══════════════════════════════════
// 預算項目管理
// ══════════════════════════════════

function _updateBudgetItem(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_BUDGET);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();
  const targetId = data.budget_item_id || data.id;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === targetId) {
      const rowIdx = i + 2;
      if (data.item_name_cn !== undefined) sheet.getRange(rowIdx, 5).setValue(data.item_name_cn);
      if (data.item_name_en !== undefined) sheet.getRange(rowIdx, 6).setValue(data.item_name_en);
      if (data.unit !== undefined) sheet.getRange(rowIdx, 7).setValue(data.unit);
      if (data.budget_qty !== undefined) sheet.getRange(rowIdx, 8).setValue(data.budget_qty);
      if (data.unit_price !== undefined) sheet.getRange(rowIdx, 9).setValue(data.unit_price);
      if (data.budget_total !== undefined) sheet.getRange(rowIdx, 10).setValue(data.budget_total);
      if (data.remarks !== undefined) sheet.getRange(rowIdx, 11).setValue(data.remarks);

      _addLog('UPDATE', 'budget', targetId, '修改預算項目 ' + targetId + ' ' + (data.item_name_cn || rows[i][4]), data.updated_by || 'Admin');
      return { success: true, message: '預算項目已更新' };
    }
  }
  throw new Error('找不到預算項目: ' + targetId);
}

// ══════════════════════════════════
// 自動編號 & 資料夾清單
// ══════════════════════════════════

function _getNextNum(sheet) {
  if (sheet.getLastRow() <= 1) return 1;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(r => r[0]);
  let maxNum = 0;
  ids.forEach(id => {
    const str = String(id).replace(ID_PREFIX, '');
    const base = str.split('-')[0];
    const n = parseInt(base);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });
  return maxNum + 1;
}

function _getNextInspectionNumber() {
  const sheet = _ensureInspectColumns();
  const next = _getNextNum(sheet);
  return { next_number: next, formatted: ID_PREFIX + String(next).padStart(3, '0') };
}

function _listSubfolders() {
  const root = _rootFolder();
  const folders = root.getFolders();
  const list = [];
  while (folders.hasNext()) {
    const f = folders.next();
    list.push({ id: f.getId(), name: f.getName(), updated: f.getLastUpdated().toISOString() });
  }
  list.sort((a, b) => b.name.localeCompare(a.name));
  return { folders: list, root_folder_id: root.getId() };
}

function _importBudgetData(data) {
  if (!data.items || !Array.isArray(data.items)) throw new Error('缺少 items 陣列');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_BUDGET);
  const existing = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues() : [];
  const existingMap = {};
  existing.forEach((r, i) => { existingMap[r[0]] = i; });

  let updated = 0, added = 0;
  data.items.forEach(item => {
    const row = [
      item.budget_item_id || item.id, item.item_no, item.category, item.category_en,
      item.item_name_cn, item.item_name_en, item.unit,
      parseFloat(item.budget_qty) || 0, parseFloat(item.unit_price) || 0,
      parseFloat(item.budget_total) || 0, item.remarks || '', item.code || '', 'TRUE'
    ];
    const id = row[0];
    if (id in existingMap) {
      const rowIdx = existingMap[id] + 2;
      sheet.getRange(rowIdx, 1, 1, 13).setValues([row]);
      updated++;
    } else {
      sheet.appendRow(row);
      added++;
    }
  });

  _addLog('IMPORT', 'budget', 'BATCH', '匯入預算: 更新 ' + updated + ' 筆, 新增 ' + added + ' 筆', 'Admin');
  return { success: true, message: '更新 ' + updated + ' 筆, 新增 ' + added + ' 筆', updated, added };
}

// ══════════════════════════════════
// 內部輔助函式
// ══════════════════════════════════

function _getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold')
        .setBackground('#0f766e').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/** 確認查驗紀錄表有 work_area / folder_id / folder_name 欄位 */
function _ensureInspectColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_INSPECT);
  if (!sheet) throw new Error('找不到工作表: ' + SHEET_INSPECT);

  if (sheet.getMaxColumns() < INSPECT_COLS) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), INSPECT_COLS - sheet.getMaxColumns());
  }
  const hdr = sheet.getRange(1, 1, 1, INSPECT_COLS).getValues()[0];
  for (let c = COL_STAGE; c <= INSPECT_COLS; c++) {
    if (String(hdr[c - 1] || '').trim() === '') {
      sheet.getRange(1, c).setValue(INSPECT_HEADERS[c - 1])
        .setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
    }
  }
  return sheet;
}

function _findBudgetItem(sheet, budgetItemId) {
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();
  for (const r of data) {
    if (r[0] === budgetItemId) {
      return {
        id: r[0], item_no: r[1], category: r[2], category_en: r[3],
        item_name_cn: r[4], item_name_en: r[5], unit: r[6],
        budget_qty: r[7], unit_price: r[8], budget_total: r[9],
        remarks: r[10], code: r[11]
      };
    }
  }
  return null;
}

function _findInspectionRow(sheet, inspectionId) {
  if (sheet.getLastRow() <= 1) return -1;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === inspectionId) return i + 2;
  }
  return -1;
}

function _getInspectedQty(sheet, budgetItemId, excludeId) {
  if (sheet.getLastRow() <= 1) return 0;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, INSPECT_COLS).getValues();
  let total = 0;
  for (const r of data) {
    if (r[COL_BUDGET_ID - 1] === budgetItemId && r[COL_DELETED - 1] !== true && r[COL_DELETED - 1] !== 'TRUE') {
      if (excludeId && r[COL_ID - 1] === excludeId) continue;
      total += parseFloat(r[COL_QTY - 1] || 0);
    }
  }
  return total;
}

function _getConfigValue(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  if (!sheet || sheet.getLastRow() <= 1) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (const r of data) {
    if (r[0] === key) return r[1];
  }
  return null;
}

function _setConfigValue(key, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === key) {
      sheet.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function _addLog(action, target, targetId, detail, actionBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_LOGS);
  const logId = 'LOG-' + Date.now();
  sheet.appendRow([logId, action, target, targetId, detail, new Date().toISOString(), actionBy || 'System']);
}

function _jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════
// 匯入初始預算資料
// ══════════════════════════════════

function _importInitialBudget(sheet) {
  const items = [
    ["B001","6.1.1","人員","Personal","環境保護，管理人員","Environmental Manager and Engineer","month",73,300000,21900000,"(1) ENV specialist 2025/7/1~2027/8/31 (25m)\n(2) ENV officer 2025/7/1~2027/8/31 (25m)\n(3) ENV officer 2025/9/1~2027/8/31 (23m)","L015721000003","TRUE"],
    ["B002","6.1.2","教育訓練","Induction","環境保護，環保宣導，環境保護教育訓練","Environmental induction","time",100,5000,500000,"施工人員進場前環保教育訓練","015726000H","TRUE"],
    ["B003","6.1.3","空氣","Air","工程告示牌及工地標誌，工程告示牌","Site construction Board","No",2,450000,900000,"","015831000A","TRUE"],
    ["B004","6.1.4","空氣","Air","環境保護，沖洗設備，高壓沖洗機","High pressure washing machine","unit",4,100000,400000,"","01572D0008","TRUE"],
    ["B005","6.1.5","空氣","Air","施工圍籬，全阻隔式固定(第一級營建工程)","Site Boundary Fence","M",400,5000,2000000,"","01564W0001","TRUE"],
    ["B006","6.1.6","空氣","Air","環境保護，機具不分類，洗車台設備","Car wheel washing bay","set",1,2500000,2500000,"","E0157210Q0008","TRUE"],
    ["B007","6.1.7","空氣","Air","環境保護，水污染防治，洗車設備污泥清除費","Routine Maintenance for Car Wheel Washing Bay","time",12,150000,1800000,"","015723400H","TRUE"],
    ["B008","6.1.8","空氣","Air","環境保護，施工便道灑水(含運輸道路)","Water Truck","month",34,450000,15300000,"","015729000A","TRUE"],
    ["B009","6.1.9","空氣","Air","環境保護，空氣污染防制，防塵網","Anti-dust net","M²",35000,900,31500000,"","0157213002","TRUE"],
    ["B010","6.1.10","空氣","Air","環境保護，覆蓋物，粗級配或混凝土鋪設","Gravel Base Course or Concrete","M²",7000,1000,7000000,"","157205004","TRUE"],
    ["B011","6.1.11","空氣","Air","環境保護，覆蓋鋼板","Steel Plate","M²",4000,1500,6000000,"","157206004","TRUE"],
    ["B012","6.1.12","空氣","Air","環境保護，空氣污染防制，噴灑化學藥劑","Dust suppression using chemical agents","M²",4000,1500,6000000,"","015721C004","TRUE"],
    ["B013","6.1.13","空氣","Air","環境保護，環境監測，環境資訊監測站","Environmental monitoring station","station",2,3000000,6000000,"台中1處、通霄1處","01572J000D","TRUE"],
    ["B014","6.1.14","空氣","Air","環境保護，空氣污染防制，自動噴灑水系統","Auto Sprinkling water system","station",2,250000,500000,"","01572J000D","TRUE"],
    ["B015","6.1.15","水","Water","環境保護，沖洗設備，沉砂池","Sedimentation pond","No.",2,3000000,6000000,"","01572D200C","TRUE"],
    ["B016","6.1.16","水","Water","環境保護，水污染防治，水質監測","Water quality test","time",30,25000,750000,"","015723100H","TRUE"],
    ["B017","6.1.17","廢棄物","Waste","工地臨時建築設施，臨時廁所","Mobile Toilet","month",160,10000,1600000,"2工地*4座*20個月","01522B000E","TRUE"],
    ["B018","6.1.18","監測","Monitoring","環境保護，環境監測，海域水質","Marine water quality testing","time-set",270,40000,10800000,"","01572JMWQH","TRUE"],
    ["B019","6.1.19","監測","Monitoring","環境保護，環境監測，海域生態","Marine ecological monitoring","time-set",45,300000,13500000,"","01572JMEMH","TRUE"],
    ["B020","6.1.20","監測","Monitoring","環境保護，環境監測，水下噪音","Underwater noise monitoring","time-set",6,2500000,15000000,"","01572JUWNH","TRUE"],
    ["B021","6.1.21","監測","Monitoring","環境保護，環境監測，鯨豚生態(重棲區)","Whale and dolphin ecological monitoring (important habitats)","time-set",12,750000,9000000,"","01572JWD1H","TRUE"],
    ["B022","6.1.22","監測","Monitoring","環境保護，環境監測，鯨豚生態(輸氣海管沿線)","Whale and Dolphin Ecological Monitoring (Coastal Pipeline)","time-set",26,1000000,26000000,"","01572JWD2H","TRUE"],
    ["B023","6.1.23","監測","Monitoring","環境保護，環境監測，陸域生態","Terrestrial Ecological Monitoring","time",9,200000,1800000,"","01572J0TEH","TRUE"],
    ["B024","6.1.24","其他","Others","環境保護，其他環境保護措施，環境消毒","Environmental Disinfection","time",4,300000,1200000,"","01572C000H","TRUE"],
    ["B025","6.1.25","噪音","Noise","環境保護，振動噪音防制，攜帶式噪音污染監控設備","Portable Noise Meter","set",1,50000,50000,"","0157226007","TRUE"],
    ["B026","6.1.26","其他","Others","環境保護，環保宣導，環保緊急應變演練","Environmental Emergency Response drill","time",1,1200000,1200000,"","015726002H","TRUE"],
    ["B027","6.1.27","水","Water","環境保護，水污染防治，污濁防止膜","Silt curtain","m",320,90000,28800000,"","0157230004","TRUE"],
    ["B028","6.2.1","書件","Documents","資料送審，各式計畫書，相關證照及許可申請執行費","Execution Fees for Permits and License Applications","LS",1,1500000,1500000,"","01330B0004","TRUE"],
    ["B029","6.2.2","空氣","Air","環境保護，車輛運輸覆蓋，運輸車輛逸散污染預防","Vehicle Air Pollution Control","LS",1,700000,700000,"","157207104","TRUE"],
    ["B030","6.2.3","空氣","Air","環境保護，空氣污染防制，施工機具排煙汙染預防費","Construction Equipment Air Pollution Control","LS",1,500000,500000,"","0157210004","TRUE"],
    ["B031","6.2.4","水","Water","環境保護，水污染防治，沉澱池污泥清除費","Desilting of Sedimentation Pool","LS",1,200000,200000,"","0157235004","TRUE"],
    ["B032","6.2.5","水","Water","環境保護，臨時性攔砂及導排水設施","Drainage Ditch","LS",1,200000,200000,"","01572B0004","TRUE"],
    ["B033","6.2.6","監測","Monitoring","環境保護，環境監測，鯨豚觀察作業","Cetacean observer operation","LS",1,25000000,25000000,"離岸端","01572J0004","TRUE"],
    ["B034","6.2.7","廢棄物","Waste","環境保護，生活廢棄物(含水肥)處理費","Septage Disposal Fee","LS",1,1000000,1000000,"","0157232004","TRUE"],
    ["B035","6.2.8","廢棄物","Waste","環境保護，廢棄物清理，船上油(廢)水處理","Oily water and sewage treatment","LS",1,3000000,3000000,"","015725O004","TRUE"],
    ["B036","6.2.9","廢棄物","Waste","環境保護，廢棄物清理，事業廢棄物清除處理費","Industrial Waste Disposal Fee","LS",1,4000000,4000000,"","0157250004","TRUE"],
    ["B037","6.2.10","廢棄物","Waste","環境保護，廢棄物容器租用費用","Waste container rental fee","LS",1,500000,500000,"","01572OS004","TRUE"],
    ["B038","6.2.11","人員","Personal","環境保護，環境清潔維護費，環境維護人力","Housekeeping Workers","LS",1,2000000,2000000,"","01572G0004","TRUE"],
    ["B039","6.2.12","其他","Others","社群軟體自動發送警報系統","Automated Alert Notification System (via app)","LS",1,150000,150000,"","01572C0104","TRUE"],
    ["B040","6.2.13","其他","Others","閉路電視設備，監視錄影系統(CCTV)","CCTV System","LS",1,2000000,2000000,"","1370400004","TRUE"],
    ["B041","6.2.14","書件","Documents","海洋污染緊急應變計畫書","Marine Pollution Emergency Response Plan","LS",1,250000,250000,"","0157230104","TRUE"],
    ["B042","6.2.15","書件","Documents","海洋污染防治計劃書","Permit for Discharge of Oily Wastewater","LS",1,250000,250000,"","0157200104","TRUE"],
    ["B043","6.2.16","書件","Documents","逕流廢水污染削減計畫","Runoff Wastewater Pollution Reduction Plan","LS",1,250000,250000,"","01572H0104","TRUE"],
    ["B044","6.2.17","書件","Documents","剩餘土石方處理計畫","Soil Disposal Plan","LS",1,250000,250000,"","02323D0004","TRUE"],
    ["B045","6.2.18","書件","Documents","廢棄物清理計劃書","Waste Disposal Plan","LS",1,250000,250000,"","0157240104","TRUE"],
    ["B046","6.2.19","書件","Documents","環境保護管理執行計畫","Environmental Protection Management Plan","LS",1,250000,250000,"","01572C0004","TRUE"],
    ["B047","6.2.20","書件","Documents","環境監測計畫書","Environmental Monitoring Plan","LS",1,250000,250000,"","01572J0104","TRUE"],
    ["B048","6.2.21","書件","Documents","鯨豚觀察措施計畫","Cetacean Observation Measures Plan","LS",1,250000,250000,"","01572J0WD4","TRUE"],
    ["B049","6.2.22","其他","Others","環境保護，其他環保相關設施、人員、材料","Other Environmental related Materials and its maintenance","LS",1,64109879,64109879,"此項目根據合約為總額之15~20%","157200004","TRUE"],
  ];

  if (items.length > 0) {
    sheet.getRange(2, 1, items.length, items[0].length).setValues(items);
  }

  _addLog('IMPORT', 'budget', 'ALL', '匯入 ' + items.length + ' 筆預算資料 (Item 6 環境保護費)', 'System');
}

function _reimportBudget() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_BUDGET);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).clearContent();
  }
  _importInitialBudget(sheet);
  return { success: true, message: '預算資料已重新匯入' };
}
