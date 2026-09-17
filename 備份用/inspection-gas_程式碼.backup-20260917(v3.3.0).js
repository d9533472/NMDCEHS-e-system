// ═══════════════════════════════════════════════════════════════════
// NMDC 通霄二期 — 查驗紀錄管理系統 (Backend: Google Apps Script)
// ═══════════════════════════════════════════════════════════════════
// 
// 【部署步驟】
// 1. 建立一個新的 Google Spreadsheet
// 2. 開啟 Apps Script (Extensions → Apps Script)
// 3. 將此檔案內容貼入 Code.gs
// 4. 執行 initSystem() 初始化所有工作表 + Drive 資料夾
// 5. 部署 → 新增部署 → Web App → 設定「所有人」可存取
// 6. 複製部署 URL，貼入前端 HTML 的 CONFIG.API_URL
//
// 【Google Sheets 結構】
//   工作表1: 預算項目表 (BudgetItems)
//   工作表2: 查驗紀錄表 (Inspections)  
//   工作表3: 操作日誌表 (Logs)
//   工作表4: 系統設定 (Config)
//
// 【Google Drive】
//   自動建立「NMDC_查驗附件」資料夾存放上傳檔案
// ═══════════════════════════════════════════════════════════════════

// ── 全域設定 ──
const SHEET_BUDGET   = '預算項目表';
const SHEET_INSPECT  = '查驗紀錄表';
const SHEET_LOGS     = '操作日誌表';
const SHEET_CONFIG   = '系統設定';
const DRIVE_FOLDER_NAME = 'NMDC_查驗附件_通霄二期';
const ROOT_FOLDER_ID = '15YFJiEfS4wiFxTEBazXRBMFDPQX7CDiS';

// ══════════════════════════════════
// 初始化系統 (手動執行一次)
// ══════════════════════════════════
function initSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // ── 建立工作表 ──
  _getOrCreateSheet(ss, SHEET_BUDGET, [
    'budget_item_id','item_no','category','category_en','item_name_cn','item_name_en',
    'unit','budget_qty','unit_price','budget_total','remarks','code','active'
  ]);
  
  _getOrCreateSheet(ss, SHEET_INSPECT, [
    'inspection_id','inspection_date','budget_item_id','item_name_snapshot',
    'inspected_qty','unit_price_snapshot','inspected_amount','note',
    'attachment_ids','attachment_names','created_at','created_by',
    'updated_at','updated_by','deleted','submit_date','approve_date','stage'
  ]);
  
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
  
  // ── 匯入預算資料 (如果尚未匯入) ──
  const budgetSheet = ss.getSheetByName(SHEET_BUDGET);
  if (budgetSheet.getLastRow() <= 1) {
    _importInitialBudget(budgetSheet);
    Logger.log('已匯入預算資料');
  }
  
  Logger.log('✅ 系統初始化完成');
  Logger.log('   Spreadsheet ID: ' + ss.getId());
  Logger.log('   Drive Folder ID: ' + folderId);
  Logger.log('   請部署為 Web App 並複製 URL 至前端');
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
      case 'ping':
        result = { status: 'ok', timestamp: new Date().toISOString(), version: '3.3.0', code_updated: '2026-05-06' };
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
        result = _addInspection(payload.data);
        break;
      case 'updateInspection':
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
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  
  return _jsonResponse(result);
}

// ══════════════════════════════════
// CRUD: 查驗紀錄
// ══════════════════════════════════

function _addInspection(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_INSPECT);
  const budgetSheet = ss.getSheetByName(SHEET_BUDGET);
  
  const budget = _findBudgetItem(budgetSheet, data.budget_item_id);
  if (!budget) throw new Error('找不到預算項目: ' + data.budget_item_id);
  
  const qty = parseFloat(data.inspected_qty);
  if (isNaN(qty) || qty <= 0) throw new Error('查驗數量必須大於 0');
  
  const existingQty = _getInspectedQty(sheet, data.budget_item_id);
  if (existingQty + qty > budget.budget_qty) {
    throw new Error('超過預算數量！預算: ' + budget.budget_qty + ', 已查驗: ' + existingQty + ', 剩餘: ' + (budget.budget_qty - existingQty));
  }
  
  // 產生 ID — 自動遞增或使用者指定
  const ID_PREFIX = 'NMDC-POE-BOQ-E-';
  var inspectionId;
  if (data.inspection_no && String(data.inspection_no).trim() !== '') {
    inspectionId = ID_PREFIX + String(data.inspection_no).trim();
  } else {
    var nextNum = _getNextNum(sheet);
    inspectionId = ID_PREFIX + String(nextNum).padStart(3, '0');
  }
  
  // 檢查編號是否重複
  var existingRow = _findInspectionRow(sheet, inspectionId);
  if (existingRow > 0) {
    throw new Error('查驗編號已存在: ' + inspectionId);
  }
  
  // 建立子資料夾
  var subFolderId = '';
  try {
    var rootFolder = DriveApp.getFolderById(_getConfigValue('drive_folder_id') || ROOT_FOLDER_ID);
    var existing = rootFolder.getFoldersByName(inspectionId);
    if (existing.hasNext()) {
      subFolderId = existing.next().getId();
    } else {
      subFolderId = rootFolder.createFolder(inspectionId).getId();
    }
  } catch (e) {
    Logger.log('無法建立子資料夾: ' + e.message);
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
        if (subFolderId) {
          results.push(_uploadToFolder_internal(att, subFolderId));
        } else {
          results.push(_uploadAttachment(att));
        }
      }
      attachmentIds = results.map(function(r) { return r.file_id; }).join(',');
      attachmentNames = results.map(function(r) { return r.file_name; }).join(',');
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
    data.submit_date || '',
    data.approve_date || '',
    parseInt(data.stage) || 1
  ]);
  
  _addLog('CREATE', 'inspection', inspectionId, 
    '新增查驗 ' + inspectionId + ' (' + budget.item_no + ' ' + budget.item_name_cn + ', 數量: ' + qty + ', 金額: ' + amount + ')',
    data.created_by || 'Admin');
  
  return {
    success: true,
    inspection_id: inspectionId,
    inspected_amount: amount,
    folder_id: subFolderId,
    message: '查驗紀錄已新增' + (attachmentWarning ? '（' + attachmentWarning + '）' : '')
  };
}

function _updateInspection(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_INSPECT);
  const budgetSheet = ss.getSheetByName(SHEET_BUDGET);
  
  const rowIdx = _findInspectionRow(sheet, data.inspection_id);
  if (rowIdx < 0) throw new Error('找不到查驗紀錄: ' + data.inspection_id);
  
  const row = sheet.getRange(rowIdx, 1, 1, 18).getValues()[0];
  const budgetItemId = row[2];
  const budget = _findBudgetItem(budgetSheet, budgetItemId);
  
  if (data.inspection_no && String(data.inspection_no).trim() !== '') {
    const ID_PREFIX = 'NMDC-POE-BOQ-E-';
    const newId = ID_PREFIX + String(data.inspection_no).trim();
    if (newId !== data.inspection_id) {
      const dupRow = _findInspectionRow(sheet, newId);
      if (dupRow > 0) throw new Error('查驗編號已存在: ' + newId);
      sheet.getRange(rowIdx, 1).setValue(newId);
    }
  }
  
  if (data.inspected_qty !== undefined) {
    const newQty = parseFloat(data.inspected_qty);
    if (isNaN(newQty) || newQty <= 0) throw new Error('查驗數量必須大於 0');
    
    const existingQty = _getInspectedQty(sheet, budgetItemId, data.inspection_id);
    if (existingQty + newQty > budget.budget_qty) {
      throw new Error('超過預算數量！剩餘: ' + (budget.budget_qty - existingQty));
    }
    
    sheet.getRange(rowIdx, 5).setValue(newQty);
    sheet.getRange(rowIdx, 7).setValue(newQty * budget.unit_price);
  }
  
  if (data.inspection_date !== undefined) sheet.getRange(rowIdx, 2).setValue(data.inspection_date);
  if (data.note !== undefined) sheet.getRange(rowIdx, 8).setValue(data.note);
  if (data.submit_date !== undefined) sheet.getRange(rowIdx, 16).setValue(data.submit_date);
  if (data.approve_date !== undefined) sheet.getRange(rowIdx, 17).setValue(data.approve_date);
  
  // 階段更新
  if (data.stage !== undefined) {
    const stg = parseInt(data.stage);
    sheet.getRange(rowIdx, 18).setValue(stg);
    // 階段5=台電已核准 → 自動帶入核准日期（如果還沒填）
    if (stg === 5 && !data.approve_date) {
      const currentApprove = row[16] ? String(row[16]).trim() : '';
      if (!currentApprove) {
        sheet.getRange(rowIdx, 17).setValue(new Date().toISOString().slice(0, 10));
      }
    }
  }
  
  if (data.new_attachments && data.new_attachments.length > 0) {
    try {
      const results = data.new_attachments.map(att => _uploadAttachment(att));
      const existingIds = row[8] ? row[8].toString() : '';
      const existingNames = row[9] ? row[9].toString() : '';
      const newIds = results.map(r => r.file_id).join(',');
      const newNames = results.map(r => r.file_name).join(',');
      sheet.getRange(rowIdx, 9).setValue(existingIds ? existingIds + ',' + newIds : newIds);
      sheet.getRange(rowIdx, 10).setValue(existingNames ? existingNames + ',' + newNames : newNames);
    } catch (e) {
      Logger.log('附件上傳失敗（不影響查驗更新）: ' + e.message);
    }
  }
  
  const now = new Date().toISOString();
  sheet.getRange(rowIdx, 13).setValue(now);
  sheet.getRange(rowIdx, 14).setValue(data.updated_by || 'Admin');
  
  _addLog('UPDATE', 'inspection', data.inspection_id, 
    '修改查驗 ' + data.inspection_id, data.updated_by || 'Admin');
  
  return { success: true, message: '查驗紀錄已更新' };
}

function _deleteInspection(inspectionId, deletedBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_INSPECT);
  
  const rowIdx = _findInspectionRow(sheet, inspectionId);
  if (rowIdx < 0) throw new Error('找不到查驗紀錄: ' + inspectionId);
  
  sheet.getRange(rowIdx, 15).setValue('TRUE');
  sheet.getRange(rowIdx, 13).setValue(new Date().toISOString());
  sheet.getRange(rowIdx, 14).setValue(deletedBy);
  
  _addLog('DELETE', 'inspection', inspectionId, 
    '刪除查驗 ' + inspectionId, deletedBy);
  
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_INSPECT);
  if (sheet.getLastRow() <= 1) return [];
  
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 18).getValues();
  return data.filter(r => r[14] !== true && r[14] !== 'TRUE').map(r => {
    // 向下相容：舊紀錄沒有 stage 欄位，從日期推斷
    var stage = parseInt(r[17]);
    if (!stage || isNaN(stage)) {
      if (r[16] && String(r[16]).trim() !== '') stage = 5;       // 有核准日期 → 台電已核准
      else if (r[15] && String(r[15]).trim() !== '') stage = 4;  // 有提送日期 → 已提交台電
      else stage = 1;                                             // 預設階段1
    }
    return {
      id: r[0], inspection_date: r[1], budget_item_id: r[2],
      item_name_snapshot: r[3], inspected_qty: r[4], unit_price_snapshot: r[5],
      inspected_amount: r[6], note: r[7],
      attachment_ids: r[8] ? r[8].toString().split(',').filter(Boolean) : [],
      attachment_names: r[9] ? r[9].toString().split(',').filter(Boolean) : [],
      created_at: r[10], created_by: r[11],
      updated_at: r[12], updated_by: r[13], deleted: r[14],
      submit_date: r[15] || '', approve_date: r[16] || '',
      stage: stage
    };
  });
}

function _getSummary() {
  const budgets = _getBudgetItems();
  const inspections = _getInspections();
  const folderId = _getConfigValue('drive_folder_id');
  
  const summaries = budgets.map(b => {
    const recs = inspections.filter(i => i.budget_item_id === b.id);
    
    const total_qty = recs.reduce((s, r) => s + parseFloat(r.inspected_qty || 0), 0);
    
    // 各階段統計
    const stage_counts = [0,0,0,0,0];
    const stage_qtys = [0,0,0,0,0];
    recs.forEach(r => {
      const stg = Math.min(Math.max(parseInt(r.stage) || 1, 1), 5);
      stage_counts[stg - 1]++;
      stage_qtys[stg - 1] += parseFloat(r.inspected_qty || 0);
    });
    
    const approved_qty = stage_qtys[4]; // 階段5
    const approved_amt = approved_qty * b.unit_price;
    const pending_qty = stage_qtys[3]; // 階段4
    const pending_amt = pending_qty * b.unit_price;
    const wip_qty = stage_qtys[0] + stage_qtys[1] + stage_qtys[2]; // 階段1-3
    const wip_amt = wip_qty * b.unit_price;
    
    const inspected_qty = approved_qty;
    const inspected_amt = approved_amt;
    const remaining_qty = b.budget_qty - inspected_qty;
    const remaining_amt = b.budget_total - inspected_amt;
    const ratio = b.budget_qty > 0 ? inspected_qty / b.budget_qty : 0;
    
    const approved_recs = recs.filter(r => (parseInt(r.stage) || 1) === 5);
    const lastDate = approved_recs.length > 0 ? approved_recs.sort((a, c) => String(c.approve_date).localeCompare(String(a.approve_date)))[0].approve_date : null;
    
    return {
      ...b, inspected_qty, inspected_amt, remaining_qty, remaining_amt, ratio, lastDate,
      total_qty, pending_qty, pending_amt, wip_qty, wip_amt,
      stage_counts, stage_qtys,
      record_count: recs.length, approved_count: stage_counts[4], pending_count: stage_counts[3],
      wip_count: stage_counts[0] + stage_counts[1] + stage_counts[2],
      status: ratio === 0 ? 'not_started' : ratio < 1 ? 'in_progress' : 'completed'
    };
  });
  
  const totalBudget = summaries.reduce((s, b) => s + b.budget_total, 0);
  const totalInspected = summaries.reduce((s, b) => s + b.inspected_amt, 0);
  const totalPending = summaries.reduce((s, b) => s + b.pending_amt, 0);
  const totalWip = summaries.reduce((s, b) => s + (b.wip_amt || 0), 0);
  
  // 全域各階段統計
  const globalStageCounts = [0,0,0,0,0];
  inspections.forEach(i => { const stg = Math.min(Math.max(parseInt(i.stage) || 1, 1), 5); globalStageCounts[stg-1]++; });
  
  return {
    budgetItems: summaries,
    inspections: inspections,
    totals: {
      totalBudget,
      totalInspected,
      totalPending,
      totalWip,
      totalRemaining: totalBudget - totalInspected,
      overallRatio: totalBudget > 0 ? totalInspected / totalBudget : 0,
      totalRecords: inspections.length,
      approvedRecords: globalStageCounts[4],
      pendingRecords: globalStageCounts[3],
      wipRecords: globalStageCounts[0] + globalStageCounts[1] + globalStageCounts[2],
      stageCounts: globalStageCounts,
    },
    drive_folder_id: folderId,
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

function _getAttachmentUrl(fileId) {
  if (!fileId) return null;
  return {
    view: 'https://drive.google.com/file/d/' + fileId + '/view',
    download: 'https://drive.google.com/uc?export=download&id=' + fileId,
    thumbnail: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w200'
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
// 自動編號 & 資料夾管理
// ══════════════════════════════════

function _getNextNum(sheet) {
  if (sheet.getLastRow() <= 1) return 1;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(r => r[0]);
  const prefix = 'NMDC-POE-BOQ-E-';
  let maxNum = 0;
  ids.forEach(id => {
    const str = String(id).replace(prefix, '');
    // Handle both "001" and "001-1" (batch suffix)
    const base = str.split('-')[0];
    const n = parseInt(base);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });
  return maxNum + 1;
}

function _getNextInspectionNumber() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_INSPECT);
  const next = _getNextNum(sheet);
  return { next_number: next, formatted: 'NMDC-POE-BOQ-E-' + String(next).padStart(3, '0') };
}

function _listSubfolders() {
  const folderId = _getConfigValue('drive_folder_id') || ROOT_FOLDER_ID;
  const root = DriveApp.getFolderById(folderId);
  const folders = root.getFolders();
  const list = [];
  while (folders.hasNext()) {
    const f = folders.next();
    list.push({ id: f.getId(), name: f.getName(), updated: f.getLastUpdated().toISOString() });
  }
  list.sort((a, b) => b.name.localeCompare(a.name));
  return { folders: list, root_folder_id: folderId };
}

function _uploadToExistingFolder(data) {
  const folderId = data.folder_id;
  if (!folderId) throw new Error('缺少 folder_id');
  const result = _uploadToFolder_internal(data, folderId);
  
  // 如果有 inspection_id，更新紀錄的附件欄位
  if (data.inspection_id) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_INSPECT);
    const rowIdx = _findInspectionRow(sheet, data.inspection_id);
    if (rowIdx > 0) {
      const row = sheet.getRange(rowIdx, 1, 1, 18).getValues()[0];
      const existingIds = row[8] ? row[8].toString() : '';
      const existingNames = row[9] ? row[9].toString() : '';
      sheet.getRange(rowIdx, 9).setValue(existingIds ? existingIds + ',' + result.file_id : result.file_id);
      sheet.getRange(rowIdx, 10).setValue(existingNames ? existingNames + ',' + result.file_name : result.file_name);
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
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === inspectionId) return i + 2;
  }
  return -1;
}

function _getInspectedQty(sheet, budgetItemId, excludeId) {
  if (sheet.getLastRow() <= 1) return 0;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 18).getValues();
  let total = 0;
  for (const r of data) {
    if (r[2] === budgetItemId && r[14] !== true && r[14] !== 'TRUE') {
      if (excludeId && r[0] === excludeId) continue;
      total += parseFloat(r[4] || 0);
    }
  }
  return total;
}

function _getNextSeq(ss) {
  const configSheet = ss.getSheetByName(SHEET_CONFIG);
  const data = configSheet.getRange(2, 1, Math.max(configSheet.getLastRow() - 1, 1), 2).getValues();
  
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === 'next_seq') {
      const seq = parseInt(data[i][1]) || 1;
      configSheet.getRange(i + 2, 2).setValue(seq + 1);
      return seq;
    }
  }
  configSheet.appendRow(['next_seq', 2]);
  return 1;
}

function _padNum(n, len) {
  return String(n).padStart(len, '0');
}

function _getConfigValue(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  if (sheet.getLastRow() <= 1) return null;
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
// 匯入初始預算資料 (50筆)
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
