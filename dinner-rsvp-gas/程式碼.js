/**
 * 蟹蟹你們 ── 大安港・五甲海產餐廳 慰勞聚餐報名
 *
 * 部署方式：網頁應用程式（執行身分＝我、存取權＝所有人，包括匿名使用者）
 * 資料存放：第一次有人報名時自動建立一份 Google 試算表，
 *           試算表 ID 記在指令碼屬性 RSVP_SHEET_ID，之後都寫進同一份。
 *           想知道試算表網址，在編輯器裡執行 顯示試算表網址() 看執行紀錄。
 */

var 試算表名稱 = '大安港聚餐報名_資料';
var 工作表名稱 = '報名名單';
var 屬性鍵 = 'RSVP_SHEET_ID';
var 標題列 = ['報名時間', '姓名', '單位', '人數', '是否參加', '備註'];

// ---------- 網頁入口 ----------

function doGet() {
  return HtmlService.createTemplateFromFile('頁面')
    .evaluate()
    .setTitle('蟹蟹你們・大安港聚餐報名')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 讓 頁面.html 把 圖片.html（內嵌的相片資料）拉進來 */
function include(檔名) {
  return HtmlService.createHtmlOutputFromFile(檔名).getContent();
}

// ---------- 給前端呼叫 ----------

/** 讀取目前所有報名資料與統計 */
function getRsvpData() {
  return 組合狀態_(讀取全部_());
}

/**
 * 送出或更新一筆報名。
 * 同一個姓名再送一次，會直接覆蓋原本那一筆（不會重複）。
 * @param {{name:string, unit:string, attending:string, count:number, note:string}} 資料
 */
function submitRsvp(資料) {
  var 鎖 = LockService.getScriptLock();
  if (!鎖.tryLock(20000)) {
    throw new Error('現在有人同時在送出，請等三秒再按一次。');
  }
  try {
    var 姓名 = String((資料 && 資料.name) || '').trim();
    if (!姓名) throw new Error('請先填姓名。');
    if (姓名.length > 20) throw new Error('姓名太長了，請填 20 個字以內。');

    var 參加與否 = (資料 && 資料.attending) === '參加' ? '參加' : '不克參加';
    var 人數 = 0;
    if (參加與否 === '參加') {
      人數 = Math.round(Number((資料 && 資料.count) || 1));
      if (!(人數 >= 1)) 人數 = 1;
      if (人數 > 20) 人數 = 20;
    }
    var 單位 = String((資料 && 資料.unit) || '').trim().slice(0, 20);
    var 備註 = String((資料 && 資料.note) || '').trim().slice(0, 200);
    var 時間 = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');

    var 表 = 取得工作表_();
    var 全部 = 讀取全部_();
    var 既有 = -1;
    for (var i = 0; i < 全部.length; i++) {
      if (正規化_(全部[i].name) === 正規化_(姓名)) { 既有 = i; break; }
    }

    var 那列 = [時間, 姓名, 單位, 人數, 參加與否, 備註];
    var 動作;
    if (既有 >= 0) {
      表.getRange(全部[既有].row, 1, 1, 標題列.length).setValues([那列]);
      動作 = '更新';
    } else {
      表.appendRow(那列);
      動作 = '新增';
    }
    SpreadsheetApp.flush();

    var 狀態 = 組合狀態_(讀取全部_());
    狀態.動作 = 動作;
    狀態.我的姓名 = 姓名;
    return 狀態;
  } finally {
    鎖.releaseLock();
  }
}

// ---------- 內部工具 ----------

function 取得工作表_() {
  var 屬性 = PropertiesService.getScriptProperties();
  var id = 屬性.getProperty(屬性鍵);
  var 試算表 = null;
  if (id) {
    try { 試算表 = SpreadsheetApp.openById(id); } catch (e) { 試算表 = null; }
  }
  if (!試算表) {
    試算表 = SpreadsheetApp.create(試算表名稱);
    屬性.setProperty(屬性鍵, 試算表.getId());
  }
  var 表 = 試算表.getSheetByName(工作表名稱);
  if (!表) {
    表 = 試算表.getSheets()[0];
    表.setName(工作表名稱);
  }
  if (表.getLastRow() === 0) {
    表.getRange(1, 1, 1, 標題列.length).setValues([標題列]);
    表.getRange(1, 1, 1, 標題列.length).setFontWeight('bold');
    表.setFrozenRows(1);
    表.setColumnWidth(1, 140);
    表.setColumnWidth(6, 260);
  }
  return 表;
}

function 讀取全部_() {
  var 表 = 取得工作表_();
  var 最後列 = 表.getLastRow();
  if (最後列 < 2) return [];
  var 值 = 表.getRange(2, 1, 最後列 - 1, 標題列.length).getValues();
  var 結果 = [];
  for (var i = 0; i < 值.length; i++) {
    var 姓名 = String(值[i][1] || '').trim();
    if (!姓名) continue;
    結果.push({
      row: i + 2,
      time: 格式化時間_(值[i][0]),
      name: 姓名,
      unit: String(值[i][2] || '').trim(),
      count: Number(值[i][3]) || 0,
      attending: String(值[i][4] || '').indexOf('不') === 0 ? '不克參加' : '參加',
      note: String(值[i][5] || '').trim()
    });
  }
  return 結果;
}

function 組合狀態_(全部) {
  var 參加 = [], 不參加 = [], 總人數 = 0;
  for (var i = 0; i < 全部.length; i++) {
    var 人 = 全部[i];
    if (人.attending === '參加') {
      總人數 += 人.count;
      參加.push(人);
    } else {
      不參加.push(人);
    }
  }
  參加.sort(function (a, b) { return a.row - b.row; });
  return {
    總人數: 總人數,
    參加筆數: 參加.length,
    不參加筆數: 不參加.length,
    桌數: Math.ceil(總人數 / 10),
    參加名單: 參加,
    不參加名單: 不參加
  };
}

function 正規化_(字) {
  return String(字 || '').replace(/[\s　]/g, '').toLowerCase();
}

function 格式化時間_(值) {
  if (值 instanceof Date) return Utilities.formatDate(值, 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  return String(值 || '');
}

// ---------- 給主辦人手動執行的小工具 ----------

/** 在編輯器執行這個，執行紀錄會印出報名資料的試算表網址 */
function 顯示試算表網址() {
  var 表 = 取得工作表_();
  var 網址 = 表.getParent().getUrl();
  Logger.log(網址);
  return 網址;
}

/** 清空所有報名資料（只留標題列）── 確定要重來才執行 */
function 清空報名資料() {
  var 表 = 取得工作表_();
  if (表.getLastRow() > 1) {
    表.deleteRows(2, 表.getLastRow() - 1);
  }
  Logger.log('已清空');
}
