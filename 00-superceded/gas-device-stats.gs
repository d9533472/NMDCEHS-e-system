/**
 * ═══════════════════════════════════════════════════════════════
 *  設備統計補丁（給 index.html 的瀏覽人次 Apps Script 用）
 * ═══════════════════════════════════════════════════════════════
 *
 *  index.html 現在會在每次計人次時多帶三個參數：
 *      ?action=incVisits&os=Windows&browser=Chrome&form=電腦
 *  並在打開統計視窗時多呼叫：
 *      ?action=deviceStats
 *
 *  安裝步驟（三步）：
 *
 *  1. 打開現有的 Apps Script 專案（就是 index.html 裡 GAS_URL 那個），
 *     把這整個檔案的內容貼到 Code.gs 最下方。
 *
 *  2. 在 doGet(e) 裡面找到處理 action 的地方，加兩行：
 *
 *       // 原本處理 incVisits 的地方，計數完之後加這一行：
 *       recordDevice_(e.parameter);
 *
 *       // 和其他 action 並排，加這個新的 action：
 *       if (action === 'deviceStats') return deviceJson_(getDeviceStats_());
 *
 *  3. 重新部署：部署 ▸ 管理部署 ▸ 編輯（鉛筆）▸ 版本選「新版本」▸ 部署。
 *     （網址不會變，index.html 不用改。）
 *
 *  資料會存在試算表裡一個叫「DeviceStats」的新工作表，
 *  欄位：type / key / count / lastSeen。不記錄任何個人資料，
 *  只記作業系統、瀏覽器、裝置形態三種分類的次數。
 *
 *  如果你的 Apps Script 不是綁在試算表上（getActiveSpreadsheet 回傳 null），
 *  把下面 deviceSheet_() 裡的那一行改成：
 *       const ss = SpreadsheetApp.openById('你的試算表 ID');
 * ═══════════════════════════════════════════════════════════════
 */

const DEVICE_SHEET_NAME_ = 'DeviceStats';

function deviceSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(DEVICE_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(DEVICE_SHEET_NAME_);
    sh.appendRow(['type', 'key', 'count', 'lastSeen']);
    sh.appendRow(['meta', 'since', 0, new Date()]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 每次 incVisits 呼叫一次。p = e.parameter */
function recordDevice_(p) {
  p = p || {};
  const clean = v => String(v || '其他').replace(/[\r\n\t]/g, ' ').trim().slice(0, 30) || '其他';
  const os = clean(p.os), browser = clean(p.browser), form = clean(p.form);
  const pairs = [['form', form], ['os', os], ['browser', browser], ['combo', os + ' · ' + browser]];

  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { /* 拿不到鎖就直接寫，最多少算一次 */ }
  try {
    const sh = deviceSheet_();
    const data = sh.getDataRange().getValues();
    const now = new Date();
    pairs.forEach(([type, key]) => {
      let row = -1;
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === type && String(data[i][1]) === key) { row = i; break; }
      }
      if (row >= 0) {
        sh.getRange(row + 1, 3).setValue(Number(data[row][2] || 0) + 1);
        sh.getRange(row + 1, 4).setValue(now);
      } else {
        sh.appendRow([type, key, 1, now]);
        data.push([type, key, 1, now]);
      }
    });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 回傳 { ok, since, devices:{ form, os, browser, combo } } */
function getDeviceStats_() {
  const sh = deviceSheet_();
  const data = sh.getDataRange().getValues();
  const devices = { form: {}, os: {}, browser: {}, combo: {} };
  let since = null;
  for (let i = 1; i < data.length; i++) {
    const [type, key, count, last] = data[i];
    if (type === 'meta' && key === 'since') { since = last; continue; }
    if (!devices[type]) continue;
    devices[type][String(key)] = Number(count || 0);
  }
  const fmt = d => (d instanceof Date) ? Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd') : (d ? String(d) : null);
  return { ok: true, since: fmt(since), devices: devices };
}

function deviceJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 在編輯器裡直接執行這個函式可以測試（會寫入一筆 Windows · Chrome · 電腦） */
function testDeviceStats_() {
  recordDevice_({ os: 'Windows', browser: 'Chrome', form: '電腦' });
  Logger.log(JSON.stringify(getDeviceStats_()));
}
