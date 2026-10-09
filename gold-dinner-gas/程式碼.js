/**
 * 🎉 中央大學環工所黃金陣容聚餐 ── 日期／地點問卷調查系統
 *
 * 部署方式：網頁應用程式（執行身分＝我、存取權＝所有人，包括匿名使用者）
 * 資料存放：第一次有人填寫時自動建立一份 Google 試算表，
 *           試算表 ID 記在指令碼屬性 GOLD_DINNER_SHEET_ID，之後都寫進同一份。
 *           想知道試算表網址，在編輯器裡執行 顯示試算表網址() 看執行紀錄。
 * 主辦人密碼：記在指令碼屬性 GOLD_DINNER_ADMIN_PASS，
 *           預設值見下方 預設密碼，要改就執行 設定主辦人密碼('新密碼')。
 */

var 試算表名稱 = '黃金陣容聚餐_問卷資料';
var 工作表名稱 = '填答名單';
var 屬性鍵_試算表 = 'GOLD_DINNER_SHEET_ID';
var 屬性鍵_密碼 = 'GOLD_DINNER_ADMIN_PASS';
var 預設密碼 = 'gold1109';

var 標題列 = ['填寫時間', '姓名', '電話', '大人', '小孩', '兒童椅', '有空日期', '想去地點', '想說的話'];

var 日期選項 = [
  '11/1（日）', '11/7（六）', '11/8（日）',
  '11/14（六）', '11/15（日）', '11/21（六）',
  '11/22（日）', '11/28（六）', '11/29（日）'
];
var 地點選項 = ['台北', '桃園', '台中', '彰化'];
var 分隔 = '、';

// ---------- 網頁入口 ----------

function doGet() {
  return HtmlService.createTemplateFromFile('頁面')
    .evaluate()
    .setTitle('🎉 黃金陣容聚餐來啦！')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 給 頁面.html 的 scriptlet 用，把選項一起送進前端，表單才能秒開 */
function 設定JSON_() {
  return JSON.stringify({ 日期選項: 日期選項, 地點選項: 地點選項 });
}

// ---------- 給前端呼叫 ----------

/** 讀取目前的統計與公開名單（不含電話） */
function getStats() {
  return 組合統計_(讀取全部_());
}

/**
 * 送出或更新一筆填答。同一個姓名再送一次會直接覆蓋原本那一筆。
 * @param {{name:string, phone:string, adults:(number|string), kids:(number|string),
 *          chair:string, dates:string[], places:string[], note:string}} 資料
 */
function submitEntry(資料) {
  var 鎖 = LockService.getScriptLock();
  if (!鎖.tryLock(25000)) {
    throw new Error('現在有人同時在送出，請等三秒再按一次 🙏');
  }
  try {
    var 一筆 = 檢查並整理_(資料);
    var 表 = 取得工作表_();
    var 全部 = 讀取全部_();

    var 既有列 = 0;
    for (var i = 0; i < 全部.length; i++) {
      if (正規化_(全部[i].name) === 正規化_(一筆.name)) { 既有列 = 全部[i].row; break; }
    }

    var 那列 = [
      一筆.time, 一筆.name, 一筆.phone, 一筆.adults, 一筆.kids, 一筆.chair,
      一筆.dates.join(分隔), 一筆.places.join(分隔), 一筆.note
    ];

    var 動作;
    if (既有列) {
      表.getRange(既有列, 1, 1, 標題列.length).setValues([那列]);
      動作 = '更新';
    } else {
      表.appendRow(那列);
      動作 = '新增';
    }
    SpreadsheetApp.flush();

    var 結果 = 組合統計_(讀取全部_());
    結果.動作 = 動作;
    結果.我的姓名 = 一筆.name;
    return 結果;
  } finally {
    鎖.releaseLock();
  }
}

/**
 * 主辦人專用：輸入密碼後拿到完整名單（含電話）、試算表網址與可複製的試算表格式文字。
 * @param {string} 密碼
 */
function getAdminData(密碼) {
  if (String(密碼 || '') !== 取得密碼_()) {
    throw new Error('密碼不對喔，再確認一下 🔒');
  }
  var 全部 = 讀取全部_();
  var 行 = [標題列.join('\t')];
  for (var i = 0; i < 全部.length; i++) {
    var 人 = 全部[i];
    行.push([
      人.time, 人.name, 人.phone, 人.adults, 人.kids, 人.chair,
      人.dates.join(分隔), 人.places.join(分隔), String(人.note || '').replace(/[\t\r\n]+/g, ' ')
    ].join('\t'));
  }
  return {
    名單: 全部,
    試算表網址: 取得工作表_().getParent().getUrl(),
    表格文字: 行.join('\n')
  };
}

/** 主辦人專用：刪掉某個人的填答 */
function deleteEntry(密碼, 姓名) {
  if (String(密碼 || '') !== 取得密碼_()) {
    throw new Error('密碼不對喔，再確認一下 🔒');
  }
  var 鎖 = LockService.getScriptLock();
  if (!鎖.tryLock(25000)) throw new Error('系統忙碌中，請稍後再試。');
  try {
    var 表 = 取得工作表_();
    var 全部 = 讀取全部_();
    for (var i = 0; i < 全部.length; i++) {
      if (正規化_(全部[i].name) === 正規化_(姓名)) {
        表.deleteRow(全部[i].row);
        SpreadsheetApp.flush();
        return getAdminData(密碼);
      }
    }
    throw new Error('找不到「' + 姓名 + '」這筆資料。');
  } finally {
    鎖.releaseLock();
  }
}

// ---------- 檢查與整理 ----------

function 檢查並整理_(資料) {
  資料 = 資料 || {};

  var 姓名 = String(資料.name || '').trim();
  if (!姓名) throw new Error('請填一下你的大名 🙂');
  if (姓名.length > 20) throw new Error('姓名請填 20 個字以內。');

  var 電話原文 = String(資料.phone || '').trim();
  var 電話數字 = 電話原文.replace(/[^0-9]/g, '');
  if (!電話原文) throw new Error('請留一下聯絡電話，臨時有事才找得到你 📞');
  if (電話數字.length < 8 || 電話數字.length > 15) {
    throw new Error('電話看起來不太對，請填 8～15 位數字（例：0912345678）。');
  }
  if (電話原文.length > 30) throw new Error('電話太長了，請重新確認。');

  var 大人 = Math.round(Number(資料.adults));
  if (!(大人 >= 1 && 大人 <= 10)) throw new Error('大人人數請填 1～10 之間的數字（含你自己）。');

  var 小孩 = Math.round(Number(資料.kids));
  if (!(小孩 >= 0 && 小孩 <= 5)) throw new Error('小孩人數請填 0～5 之間的數字（沒有就填 0）。');

  var 兒童椅 = String(資料.chair || '').trim();
  if (兒童椅 !== '需要' && 兒童椅 !== '不需要') throw new Error('請選一下需不需要兒童椅。');

  var 日期 = 篩選合法選項_(資料.dates, 日期選項);
  if (!日期.length) throw new Error('請至少勾一個你有空的日子 📅');

  var 地點 = 篩選合法選項_(資料.places, 地點選項);
  if (!地點.length) throw new Error('請至少勾一個你可以接受的地點 📍');

  return {
    time: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm'),
    name: 姓名,
    phone: 電話原文,
    adults: 大人,
    kids: 小孩,
    chair: 兒童椅,
    dates: 日期,
    places: 地點,
    note: String(資料.note || '').trim().slice(0, 500)
  };
}

/** 只留下真的在選項清單裡的值，並照選項順序排好、去重 */
function 篩選合法選項_(傳入, 清單) {
  var 有 = {};
  var 陣列 = Array.isArray(傳入) ? 傳入 : [];
  for (var i = 0; i < 陣列.length; i++) 有[String(陣列[i]).trim()] = true;
  var 結果 = [];
  for (var j = 0; j < 清單.length; j++) {
    if (有[清單[j]]) 結果.push(清單[j]);
  }
  return 結果;
}

// ---------- 試算表存取 ----------

/**
 * 取得存資料的試算表。優先順序：
 * 1. 這支腳本若是掛在某份 Google 試算表底下（綁定腳本），就用那一份
 * 2. 指令碼屬性 GOLD_DINNER_SHEET_ID 記住的那一份
 * 3. 以上都沒有，就新建一份並把 ID 記進屬性
 */
function 取得試算表_() {
  try {
    var 現用 = SpreadsheetApp.getActiveSpreadsheet();
    if (現用) return 現用;
  } catch (e) { /* 獨立腳本會走到這裡，往下用屬性 */ }

  var 屬性 = PropertiesService.getScriptProperties();
  var id = 屬性.getProperty(屬性鍵_試算表);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e2) { /* ID 失效就重建 */ }
  }
  var 新的 = SpreadsheetApp.create(試算表名稱);
  屬性.setProperty(屬性鍵_試算表, 新的.getId());
  return 新的;
}

function 取得工作表_() {
  var 試算表 = 取得試算表_();
  var 表 = 試算表.getSheetByName(工作表名稱);
  if (!表) {
    var 全部工作表 = 試算表.getSheets();
    var 第一張 = 全部工作表[0];
    // 整份是空的（剛建的新試算表）才借用第一張來改名，否則另開一張，不去動原有資料
    if (全部工作表.length === 1 && 第一張.getLastRow() === 0 && 第一張.getLastColumn() === 0) {
      表 = 第一張;
      表.setName(工作表名稱);
    } else {
      表 = 試算表.insertSheet(工作表名稱);
    }
  }
  if (表.getLastRow() === 0) {
    表.getRange(1, 1, 1, 標題列.length).setValues([標題列]);
    表.getRange(1, 1, 1, 標題列.length).setFontWeight('bold').setBackground('#FFF2CC');
    表.setFrozenRows(1);
    表.setColumnWidth(1, 130);
    表.setColumnWidth(3, 120);
    表.setColumnWidth(7, 300);
    表.setColumnWidth(8, 150);
    表.setColumnWidth(9, 260);
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
    var 大人 = Number(值[i][3]) || 0;
    var 小孩 = Number(值[i][4]) || 0;
    結果.push({
      row: i + 2,
      time: 格式化時間_(值[i][0]),
      name: 姓名,
      phone: String(值[i][2] || '').trim(),
      adults: 大人,
      kids: 小孩,
      total: 大人 + 小孩,
      chair: String(值[i][5] || '').indexOf('不') === 0 ? '不需要' : (String(值[i][5] || '').trim() ? '需要' : '不需要'),
      dates: 切開_(值[i][6]),
      places: 切開_(值[i][7]),
      note: String(值[i][8] || '').trim()
    });
  }
  return 結果;
}

function 切開_(值) {
  var 字 = String(值 || '').trim();
  if (!字) return [];
  var 片段 = 字.split(/[、,，/]/);
  var 結果 = [];
  for (var i = 0; i < 片段.length; i++) {
    var 一個 = 片段[i].trim();
    if (一個) 結果.push(一個);
  }
  return 結果;
}

// ---------- 統計 ----------

function 組合統計_(全部) {
  var 日期統計 = 空統計_(日期選項);
  var 地點統計 = 空統計_(地點選項);

  var 總大人 = 0, 總小孩 = 0, 需椅家數 = 0, 需椅小孩數 = 0;
  var 公開名單 = [];

  for (var i = 0; i < 全部.length; i++) {
    var 人 = 全部[i];
    總大人 += 人.adults;
    總小孩 += 人.kids;
    if (人.chair === '需要') { 需椅家數++; 需椅小孩數 += 人.kids; }

    累加_(日期統計, 人.dates, 人);
    累加_(地點統計, 人.places, 人);

    公開名單.push({
      name: 人.name,
      adults: 人.adults,
      kids: 人.kids,
      total: 人.total,
      chair: 人.chair,
      dates: 人.dates,
      places: 人.places,
      note: 人.note,
      time: 人.time
    });
  }

  排序統計_(日期統計);
  排序統計_(地點統計);

  return {
    填答人數: 全部.length,
    總大人: 總大人,
    總小孩: 總小孩,
    總人數: 總大人 + 總小孩,
    需要兒童椅家數: 需椅家數,
    需要兒童椅小孩數: 需椅小孩數,
    日期排行: 日期統計.清單,
    地點排行: 地點統計.清單,
    最佳日期: 日期統計.清單.length ? 日期統計.清單[0] : null,
    最佳地點: 地點統計.清單.length ? 地點統計.清單[0] : null,
    公開名單: 公開名單
  };
}

function 空統計_(清單) {
  var 表 = { 對應: {}, 清單: [] };
  for (var i = 0; i < 清單.length; i++) {
    var 一筆 = { 名稱: 清單[i], 人數: 0, 筆數: 0, 大人: 0, 小孩: 0, 名字們: [], 順位: i };
    表.對應[清單[i]] = 一筆;
    表.清單.push(一筆);
  }
  return 表;
}

function 累加_(統計, 選中, 人) {
  for (var i = 0; i < 選中.length; i++) {
    var 一筆 = 統計.對應[選中[i]];
    if (!一筆) continue;
    一筆.人數 += 人.total;
    一筆.大人 += 人.adults;
    一筆.小孩 += 人.kids;
    一筆.筆數 += 1;
    if (一筆.名字們.length < 60) 一筆.名字們.push(人.name);
  }
}

/** 人數多的排前面；同分時筆數多的前面，再同分就照原本選項順序 */
function 排序統計_(統計) {
  統計.清單.sort(function (a, b) {
    if (b.人數 !== a.人數) return b.人數 - a.人數;
    if (b.筆數 !== a.筆數) return b.筆數 - a.筆數;
    return a.順位 - b.順位;
  });
}

// ---------- 小工具 ----------

function 正規化_(字) {
  return String(字 || '').replace(/[\s　]/g, '').toLowerCase();
}

function 格式化時間_(值) {
  if (值 instanceof Date) return Utilities.formatDate(值, 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  return String(值 || '');
}

function 取得密碼_() {
  var 屬性 = PropertiesService.getScriptProperties();
  var 密碼 = 屬性.getProperty(屬性鍵_密碼);
  if (!密碼) {
    密碼 = 預設密碼;
    屬性.setProperty(屬性鍵_密碼, 密碼);
  }
  return 密碼;
}

// ---------- 給主辦人手動執行的小工具 ----------

/** 在編輯器執行這個，執行紀錄會印出問卷資料的試算表網址 */
function 顯示試算表網址() {
  var 網址 = 取得工作表_().getParent().getUrl();
  Logger.log(網址);
  return 網址;
}

/** 改主辦人密碼：設定主辦人密碼('你想要的密碼') */
function 設定主辦人密碼(新密碼) {
  var 字 = String(新密碼 || '').trim();
  if (字.length < 4) throw new Error('密碼請至少 4 個字。');
  PropertiesService.getScriptProperties().setProperty(屬性鍵_密碼, 字);
  Logger.log('已改成：' + 字);
}

/** 在編輯器執行，印出目前的主辦人密碼 */
function 顯示主辦人密碼() {
  Logger.log(取得密碼_());
  return 取得密碼_();
}

/** 在執行紀錄印出目前統計（不用開網頁也能看） */
function 列印統計() {
  var 統計 = getStats();
  Logger.log('填答 %s 人／總人數 %s（大人 %s・小孩 %s）',
    統計.填答人數, 統計.總人數, 統計.總大人, 統計.總小孩);
  for (var i = 0; i < 統計.日期排行.length; i++) {
    var d = 統計.日期排行[i];
    Logger.log('%s　%s 人（%s 組）', d.名稱, d.人數, d.筆數);
  }
  for (var j = 0; j < 統計.地點排行.length; j++) {
    var p = 統計.地點排行[j];
    Logger.log('%s　%s 人（%s 組）', p.名稱, p.人數, p.筆數);
  }
}

/** 清空所有填答資料（只留標題列）── 確定要重來才執行 */
function 清空問卷資料() {
  var 表 = 取得工作表_();
  if (表.getLastRow() > 1) {
    表.deleteRows(2, 表.getLastRow() - 1);
  }
  Logger.log('已清空');
}
