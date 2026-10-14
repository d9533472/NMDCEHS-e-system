// ===== PTW Register API =====

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const action = e.parameter.action;
    const sheet = e.parameter.sheet || 'PTW';
    
    if (action === 'read') {
      return readData(sheet);
    } else if (action === 'write') {
      const data = JSON.parse(e.postData.contents);
      return writeData(sheet, data);
    } else if (action === 'visit' || action === 'visitCount') {
      const ss = SpreadsheetApp.openById(SHEET_ID);
      let cSheet = ss.getSheetByName('Counter');
      if (!cSheet) {
        cSheet = ss.insertSheet('Counter');
        cSheet.getRange('A1').setValue(0);
      }
      let count = cSheet.getRange('A1').getValue() || 0;
      if (action === 'visit') {
        count++;
        cSheet.getRange('A1').setValue(count);
      }
      return jsonResponse({ count: count });
    } else {
      return jsonResponse({ error: 'Invalid action' });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function readData(sheetName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  
  // 工作表不存在 → 回傳空資料（不報錯）
  if (!sheet) return jsonResponse({ success: true, data: [] });
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return jsonResponse({ success: true, data: [] });
  
  const headers = data[0];
  const rows = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      let val = data[i][j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      row[headers[j]] = val !== undefined && val !== null ? String(val) : '';
    }
    rows.push(row);
  }
  
  return jsonResponse({ success: true, data: rows });
}

function writeData(sheetName, records) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  
  // 工作表不存在 → 自動建立
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  if (!Array.isArray(records) || records.length === 0) {
    return jsonResponse({ error: 'No data to write' });
  }
  
  const headers = Object.keys(records[0]);
  
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  const rows = records.map(r => headers.map(h => r[h] !== undefined ? r[h] : ''));
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  
  return jsonResponse({ 
    success: true, 
    message: sheetName + ': ' + records.length + ' records saved',
    count: records.length
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}