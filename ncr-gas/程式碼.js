/**
 * NMDC 環保改善單系統 (ENV NCR System) v2
 * 通霄電廠二期更新改建計畫輸氣海管統包工程
 * v2: 中翻英翻譯 / 罰款條款庫64項 / 完整編輯+重產Word / 地點其他 / K~N欄擴充
 */

// ================== 設定 CONFIG ==================
var CONFIG = {
  SHEET_ID: '11wmfKcuZeIGdzy4pode3-dmXGtV9Mj6LjtGQheX95f8',
  SHEET_NAME: 'ENV',
  PARENT_FOLDER_ID: '18ux8xEB3Ui3bRlVC2KEE0-WoO8V2OszR',   // ENV 子資料夾
  TEMPLATE_FILE_ID: '1XE7OJEVWpexycTtvuXk9RqCUjvayD3r7',

  TZ: 'Asia/Taipei',
  DUE_DAYS_DEFAULT: 7,
  DUE_SOON_DAYS: 3,
  BACKUP_FOLDER_ID: '1Omh87N8QNHfozKEgo1kdPmYlEcvZkW4E',   // 總表自動備份資料夾
  MAX_BACKUPS: 120,       // 最多保留幾份備份,超過自動清掉最舊的
  ADMIN_PIN: 'nmdc123',   // 🔑 管理密碼 (登入後才能開單/修改,請自行修改)

  VENDORS: [
    { name: '美錡 MGT',  code: 'MGT' },
    { name: '環海 EGS',  code: 'EGS' },
    { name: '海義 HiE',  code: 'HiE' },
    { name: '茂富 GW',   code: 'GW'  },
    { name: '圓泰 AT',   code: 'AT'  },
    { name: '高虎 GAC',  code: 'GAC' },
    { name: '邊行 BLA',  code: 'BLA' },
    { name: '斌揚 BY',   code: 'BY'  },
    { name: '科賜 KS',   code: 'KS'  },
    { name: '唐福 TF',   code: 'TF'  }
  ],   // ↑ 只是預設值;在網頁「⚙️ 設定」存過一次後,改以 Script Properties 為準

  TYPES: [
    '1. 裸露區域防制措施',
    '2. 工區出入口',
    '3. 車行路徑',
    '4. 整理整頓',
    '5. 廢油廢水處理',
    '6. 契約規範'
  ],

  LOCATIONS: [
    { name: '台中工區 Taichung',                 site: 'Taichung Site' },
    { name: '通霄工區 TungHsiao',               site: 'TungHsiao Site' },
    { name: '管線暫置區 Pipeline storage area', site: 'Pipeline Storage Area' }
  ],

  PREPARERS: ['Paul', 'Sean', 'Raymond', 'Sue', 'Jeffrey', 'Vic', 'Noah', 'Elson', 'Jin', 'YuJu', '謝承宏', '林志浩'],

  PENALTIES: [
    { no:1, cat:'規費繳交及資料送審', text:'未於開工前向當地環保主管機關申報繳納空氣污染防制費', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:2, cat:'規費繳交及資料送審', text:'「環境保護管理計畫」未經工程主辦單位核可,逕行施工', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:3, cat:'規費繳交及資料送審', text:'「逕流廢水削減計畫」未經當地環保主管機關核准,逕行施工', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:4, cat:'規費繳交及資料送審', text:'「事業廢棄物清理計畫書」未經環保主管機關審查核准,逕行施工', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:5, cat:'規費繳交及資料送審', text:'未取得固定污染源之操作許可,逕行設置臨時混凝土拌合設施', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:6, cat:'規費繳交及資料送審', text:'排放廢(污)水於海洋污染防治法規定區域每日達20立方公尺以上,未取得陸上污染源廢(污)水排放於特定海域許可,逕行排放', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:7, cat:'規費繳交及資料送審', text:'海域工程排放油、廢(污)水,未取得海域工程排放油廢(污)水許可,逕行排放', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:8, cat:'規費繳交及資料送審', text:'棄置海洋污染防治法公告之乙類或丙類物質於海洋,未取得海洋棄置許可,逕行棄置', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:9, cat:'環境保護管理人員', text:'未指派環境保護管理人員或員額不足,逕行施工', fine:'每逾一日5,000元/人', fineEn:'NT$5,000/person per day overdue' },
    { no:10, cat:'環境保護管理人員', text:'環境保護管理人員未報經主辦工程單位確認,逕行施工', fine:'每逾一日3,000元/人', fineEn:'NT$3,000/person per day overdue' },
    { no:11, cat:'環境保護管理人員', text:'環境保護管理人員異動,未報經主辦工程單位確認', fine:'每逾一日3,000元/人', fineEn:'NT$3,000/person per day overdue' },
    { no:12, cat:'環境保護管理人員', text:'環境保護管理人員兼任其他工作', fine:'5,000元/次', fineEn:'NT$5,000/occurrence' },
    { no:13, cat:'環境保護管理人員', text:'環境保護管理人員未依規定簽到或駐守施工場所', fine:'2,000元/人次', fineEn:'NT$2,000/person-time' },
    { no:14, cat:'教育訓練', text:'未舉辦施工前或施工中定期環境保護教育訓練,逕行施工', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:15, cat:'教育訓練', text:'未於各項分項工程作業前,向所僱用勞工說明工作環境、環境污染因素及應採取之環境保護措施', fine:'1,000元/次', fineEn:'NT$1,000/occurrence' },
    { no:16, cat:'空氣污染防制', text:'未設置工地標示牌逕行施工,或標示牌未載明空污費管制編號、工地負責人、電話及環保機關檢舉電話等資訊', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:17, cat:'空氣污染防制', text:'施工前未於工地周界設置定著地面之圍籬及防溢座,或圍籬型式不符合規定', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:18, cat:'空氣污染防制', text:'工地內之車行路徑未依規定採行有效抑制粉塵之防制設施', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:19, cat:'空氣污染防制', text:'未完成工地內主要車行路徑之防制設施,逕行施工', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:20, cat:'空氣污染防制', text:'車行路徑鋪設鋼板、混凝土或瀝青混凝土者,未定期清洗,保持路面乾淨', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:21, cat:'空氣污染防制', text:'車行路徑鋪設粗級配或粒料,未定期補充', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:22, cat:'空氣污染防制', text:'竣工後,未依工程主辦單位之指示,將現場防制設施予以拆除並恢復原狀', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:23, cat:'空氣污染防制', text:'工地未設置洗車台設備及沉澱池,逕行施工', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:24, cat:'空氣污染防制', text:'洗車台設備及沉澱池功能或規格不符合規定', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:25, cat:'空氣污染防制', text:'車輛離開營建工地時未有效清洗車體及輪胎', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:26, cat:'空氣污染防制', text:'洗車台四周未設置防溢座或其他防制設施,洗車廢水溢出工地', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:27, cat:'空氣污染防制', text:'區域開發工程、疏濬工程未依規定配合新增洗街車項目', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:28, cat:'空氣污染防制', text:'從事易致粉塵逸散之作業或操作前,未配合定期灑水,以保持濕潤', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:29, cat:'空氣污染防制', text:'從事破(粉)碎、研磨、切割、刨除或其他易致粉塵逸散之操作,未依規定採行粉塵抑制措施', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:30, cat:'空氣污染防制', text:'工地堆置具粉塵逸散性之工程材料、砂石、土方或廢棄物,未依規定採行有效抑制粉塵之防制設施', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:31, cat:'空氣污染防制', text:'工地內之地表裸露區域,未依規定採行有效抑制粉塵之防制設施', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:32, cat:'空氣污染防制', text:'工地結構體施工架外緣,未依規定設置有效抑制粉塵之防制設施或防塵布/防塵網已破損', fine:'3,000元/件', fineEn:'NT$3,000/case' },
    { no:33, cat:'空氣污染防制', text:'上層具粉塵逸散性之材料土方廢棄物未依規定方式輸送至地面,或輸送管道出口未設置抑塵圍籬或灑水設施', fine:'3,000元/件', fineEn:'NT$3,000/case' },
    { no:34, cat:'空氣污染防制', text:'載運開挖碴料或施工粒料車輛,未具備密閉車斗或防塵布緊密覆蓋,或貨箱無防止滴落污水污泥之功能設施', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:35, cat:'空氣污染防制', text:'使用柴油為燃料之施工機具、動力機械未取得自主管理標章(有效期限內)或未加裝濾煙器', fine:'3,000元/件', fineEn:'NT$3,000/case' },
    { no:36, cat:'空氣污染防制', text:'使用柴油為燃料之運輸車輛未取得自主管理標章(有效期限內)或排煙不符移動污染源排放標準', fine:'3,000元/件', fineEn:'NT$3,000/case' },
    { no:37, cat:'空氣污染防制', text:'拆除作業期間,未依規定於拆除之結構體外包覆防塵布,並以加壓灑水設施灑水抑制揚塵', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:38, cat:'空氣污染防制', text:'未依規定於排放粒狀污染物之排氣井或排風口設置旋風分離器、袋式集塵器或其他有效集塵設備', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:39, cat:'空氣污染防制', text:'未依當地環保機關核可之替代方法,設置或採行空氣污染防制設施', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:40, cat:'空氣污染防制', text:'油漆噴塗作業,未依規定於作業區域周圍妥善遮蔽,致霧狀油漆微粒飄散造成空氣污染', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:41, cat:'空氣污染防制', text:'禁止之空氣污染行為(燃燒垃圾/融化柏油瀝青、施工引起塵土飛揚、排放廢氣不符排放標準)', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:42, cat:'水污染防治', text:'未依核備之「逕流廢水削減計畫」設置擋雨、遮雨、導雨設施及沉砂池等設施', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:43, cat:'水污染防治', text:'工地內逕流廢水未經沉砂池處理達到放流水標準,逕行排放', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:44, cat:'水污染防治', text:'工區內產生之廢污水未處理至符合「放流水標準」,逕自排放', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:45, cat:'水污染防治', text:'擋雨遮雨導雨設施、沉砂池及排水溝管線之淤泥砂,未依契約規定頻率定期清理', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:46, cat:'水污染防治', text:'廢污水處理所產生之污泥,任意放置或棄置', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:47, cat:'水污染防治', text:'未妥善收集施工過程產生之含油廢水、施工機械廢油及廢溶劑至儲存設施', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:48, cat:'噪音及振動防制', text:'工地發生的聲音超出噪音管制標準', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:49, cat:'廢棄物清理', text:'工區廢棄物及施工廢料未依「事業廢棄物清理計畫書」或認可方式地點妥善處理,或隨意棄置', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:50, cat:'廢棄物清理', text:'未於施工前將「委託廢棄物清理合約書」提送工程主辦單位備查', fine:'每逾一日2,000元', fineEn:'NT$2,000 per day overdue' },
    { no:51, cat:'廢棄物清理', text:'未按時提報事業廢棄物妥善清理書面文件紀錄至工程主辦單位備查', fine:'每逾一日1,000元', fineEn:'NT$1,000 per day overdue' },
    { no:52, cat:'廢棄物清理', text:'工區內未設置符合環境衛生標準之臨時廁所', fine:'2,000元/處', fineEn:'NT$2,000/location' },
    { no:53, cat:'廢棄物清理', text:'工區內未設置密閉式垃圾筒,或廢棄物未按主要成分特性分類貯放或回收', fine:'2,000元/處', fineEn:'NT$2,000/location' },
    { no:54, cat:'廢棄物清理', text:'禁止之廢棄物污染行為(隨地吐痰便溺、拋棄垃圾、污染地面水溝牆壁、堆置有礙衛生整潔之物等)', fine:'2,000元/件', fineEn:'NT$2,000/case' },
    { no:55, cat:'海洋污染防治', text:'使用船舶進行海域工程時,船舶未設置防止污染設備,致污染海洋', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:56, cat:'海洋污染防治', text:'未經中央主管機關許可,逕自排放、溢出、洩漏、傾倒廢(污)水、油、廢棄物、有害物質於海洋', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:57, cat:'海洋污染防治', text:'從事海域工程致嚴重污染海域或有嚴重污染之虞時,未即採取措施防止排除減輕污染並通知相關單位', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:58, cat:'土壤及地下水污染防治', text:'發現施工區域之土壤及地下水有曾被污染之虞時,未立即停止作業並通知工程主辦單位', fine:'100,000元/件', fineEn:'NT$100,000/case' },
    { no:59, cat:'其他環境保護措施', text:'未於工地出入口、洗車設施及主要施工區域設置錄影監視系統,或系統規格功能不符規定', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:60, cat:'其他環境保護措施', text:'逾期提送每日環境保護自主檢查表', fine:'每逾一日1,000元', fineEn:'NT$1,000 per day overdue' },
    { no:61, cat:'其他環境保護措施', text:'車輛超速及超載等影響空氣品質及振動噪音規定', fine:'3,000元/件', fineEn:'NT$3,000/case' },
    { no:62, cat:'其他環境保護措施', text:'施工期間違反第01572章所載之各項規定', fine:'5,000元/件', fineEn:'NT$5,000/case' },
    { no:63, cat:'其他環境保護措施', text:'同一工程/契約一個月內違反同項規定(第3次加重罰款1倍、第4次2倍、第5次以上每次3倍)', fine:'依原罰款加重計算', fineEn:'multiplied base fine (3rd +100%, 4th +200%, 5th+ +300%)' },
    { no:64, cat:'其他環境保護措施', text:'違反承攬商施工環境維護,本表未列出項目者', fine:'3,000元/件', fineEn:'NT$3,000/case' }
  ],

  PHOTO_MEDIA: ['word/media/image2.jpg', 'word/media/image3.jpg']
};

var BLANK_JPG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAB4AKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD06iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9k=';

// ================== Web App ==================
function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('改善單系統 (NMDC給下包商)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ================== 共用 ==================
function getSheet_() {
  var sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error('找不到工作表: ' + CONFIG.SHEET_NAME);
  return sh;
}

function fmtDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, CONFIG.TZ, 'yyyy/MM/dd');
  }
  return String(v).trim();
}

function pad3_(n) { return ('000' + n).slice(-3); }

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xmlText_(s) {
  return esc_(s).replace(/\r\n|\r|\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
}

function penaltyItems_(nos) {
  var out = [];
  (nos || []).forEach(function (n) {
    for (var i = 0; i < CONFIG.PENALTIES.length; i++) {
      if (CONFIG.PENALTIES[i].no === Number(n)) { out.push(CONFIG.PENALTIES[i]); break; }
    }
  });
  return out;
}

function ensureExtHeaders_(sh) {
  if (String(sh.getRange(1, 11).getValue() || '') === '') {
    sh.getRange(1, 11, 1, 4).setValues([['違規敘述EN', '缺失說明', '缺失說明EN', '罰款條款']]);
  }
}

// ================== 假登入 ==================
function verifyPin(pin) {
  return String(pin) === String(CONFIG.ADMIN_PIN);
}

// ================== 自動備份 / 回復 ==================
/** 每次資料異動前,把 ENV 總表快照存成 JSON 到備份資料夾 */
function backupSheet_(action) {
  try {
    var sh = getSheet_();
    var values = sh.getDataRange().getValues();
    var out = values.map(function (row) {
      return row.map(function (c) {
        return (Object.prototype.toString.call(c) === '[object Date]' && !isNaN(c))
          ? Utilities.formatDate(c, CONFIG.TZ, 'yyyy/MM/dd') : c;
      });
    });
    var stamp = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd_HH-mm-ss');
    var folder = DriveApp.getFolderById(CONFIG.BACKUP_FOLDER_ID);
    folder.createFile('ENV備份_' + stamp + '_' + action + '.json',
      JSON.stringify({ time: stamp, action: action, rows: out.length, values: out }),
      'application/json');
    cleanupBackups_(folder);
  } catch (e) { /* 備份失敗不影響主要操作 */ }
}

function cleanupBackups_(folder) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf('ENV備份_') === 0) files.push(f);
  }
  if (files.length <= CONFIG.MAX_BACKUPS) return;
  files.sort(function (a, b) { return a.getDateCreated() - b.getDateCreated(); });
  for (var i = 0; i < files.length - CONFIG.MAX_BACKUPS; i++) files[i].setTrashed(true);
}

/** 備份清單 (新到舊) */
function listBackups() {
  var folder = DriveApp.getFolderById(CONFIG.BACKUP_FOLDER_ID);
  var it = folder.getFiles(), out = [];
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf('ENV備份_') !== 0) continue;
    out.push({ id: f.getId(), name: f.getName(),
      created: Utilities.formatDate(f.getDateCreated(), CONFIG.TZ, 'yyyy/MM/dd HH:mm') });
  }
  out.sort(function (a, b) { return a.name < b.name ? 1 : -1; });
  return out.slice(0, 60);
}

/** 還原到指定備份 (還原前會先自動備份目前資料) */
function restoreBackup(fileId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8'));
    if (!data || !data.values || !data.values.length) throw new Error('備份檔內容無效');
    backupSheet_('還原前');
    var sh = getSheet_();
    sh.clearContents();
    sh.getRange(1, 1, data.values.length, data.values[0].length).setValues(data.values);
    return { ok: true, restoredRows: data.values.length - 1, time: data.time };
  } finally {
    lock.releaseLock();
  }
}

// ================== 設定 (廠商 / 收件人,存在 Script Properties) ==================
var EMAIL_RE_ = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function splitEmails_(s) {
  return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x; });
}

function getSettings_() {
  var props = PropertiesService.getScriptProperties();
  var vendors = null, recipients = null;
  try { vendors = JSON.parse(props.getProperty('VENDORS') || 'null'); } catch (e) { vendors = null; }
  try { recipients = JSON.parse(props.getProperty('RECIPIENTS') || 'null'); } catch (e) { recipients = null; }
  if (!vendors || !vendors.length) {
    vendors = CONFIG.VENDORS.map(function (v) { return { name: v.name, code: v.code, email: '' }; });
  }
  return { vendors: vendors, recipients: recipients || [] };
}

function getSettings() { return getSettings_(); }

function saveSettings(s) {
  var vendors = [], recipients = [], seen = {};
  (s.vendors || []).forEach(function (v, i) {
    var name = String(v.name || '').trim(), code = String(v.code || '').trim();
    if (!name && !code) return;
    if (!name) throw new Error('第 ' + (i + 1) + ' 家公司沒有填名稱');
    if (!/^[A-Za-z]{1,10}$/.test(code)) throw new Error(name + ' 的代號只能是英文字母 (例:TF)');
    if (seen[code.toUpperCase()]) throw new Error('公司代號重複:' + code);
    seen[code.toUpperCase()] = true;
    var emails = splitEmails_(v.email);
    emails.forEach(function (e) { if (!EMAIL_RE_.test(e)) throw new Error(name + ' 的 email 格式不對:' + e); });
    vendors.push({ name: name, code: code, email: emails.join(', ') });
  });
  if (!vendors.length) throw new Error('至少要有一家公司');
  (s.recipients || []).forEach(function (r) {
    var name = String(r.name || '').trim(), email = String(r.email || '').trim();
    if (!name && !email) return;
    if (!EMAIL_RE_.test(email)) throw new Error((name || '收件人') + ' 的 email 格式不對:' + email);
    recipients.push({ name: name, email: email, on: r.on !== false });
  });
  PropertiesService.getScriptProperties().setProperties({
    VENDORS: JSON.stringify(vendors),
    RECIPIENTS: JSON.stringify(recipients)
  });
  return getSettings_();
}

/** 這張單要寄給誰:設定裡勾選的收件人 + 該廠商的聯絡 email */
function mailRecipients_(vendorCode) {
  var s = getSettings_(), out = [], seen = {};
  function add(e) { var k = e.toLowerCase(); if (e && !seen[k]) { seen[k] = true; out.push(e); } }
  s.recipients.forEach(function (r) { if (r.on !== false) add(r.email); });
  s.vendors.forEach(function (v) {
    if (String(v.code).toUpperCase() === String(vendorCode).toUpperCase()) splitEmails_(v.email).forEach(add);
  });
  return out;
}

/** 通知信 HTML:全用 table + bgcolor + mso 字型,Outlook 不跑版 (仿 TPC 改善單系統通知信結構,配色用本系統森林綠) */
function mailHtml_(ncrNo, info, docFile, folder, isTest) {
  var F = "font-family:'Microsoft JhengHei','Segoe UI','PingFang TC',Arial,sans-serif;" +
    "mso-fareast-font-family:'Microsoft JhengHei';mso-ascii-font-family:'Microsoft JhengHei';mso-hansi-font-family:'Microsoft JhengHei';";
  var MONO = "font-family:Consolas,'Courier New',monospace;mso-ascii-font-family:Consolas;mso-hansi-font-family:Consolas;";
  var G = '#0b6b35', G2 = '#12a153', GL = '#e8f5ec', LINE = '#e3e8e4', INK = '#1f2937', MUTED = '#6b7280';
  function h(s) { return esc_(s).replace(/\r\n|\r|\n/g, '<br>'); }
  function d(s) { return String(s || '').replace(/-/g, '/'); }

  // 期限徽章
  var badge = '';
  var m = d(info.dueDate).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) {
    var t = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy/MM/dd').split('/');
    var left = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+t[0], +t[1] - 1, +t[2])) / 86400000);
    var bc = left < 0 ? ['#fef2f2', '#dc2626', '🔴 已逾期 ' + (-left) + ' 天']
      : left === 0 ? ['#fff7e6', '#b45309', '🟡 今日到期']
      : left <= CONFIG.DUE_SOON_DAYS ? ['#fff7e6', '#b45309', '🟡 剩 ' + left + ' 天']
      : [GL, G, '🟢 剩 ' + left + ' 天'];
    badge = ' &nbsp;<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;border-collapse:collapse;"><tr>' +
      '<td bgcolor="' + bc[0] + '" style="background-color:' + bc[0] + ';padding:3px 10px;border-radius:20px;color:' + bc[1] +
      ';font-size:12px;font-weight:700;white-space:nowrap;' + F + '">' + bc[2] + '</td></tr></table>';
  }

  var rows = [
    ['改善單編號', '<span style="' + MONO + 'font-size:15px;color:' + G + ';font-weight:700;">' + h(ncrNo) + '</span>'],
    ['違規廠商', h(info.vendorName)],
    ['違規地點', h(info.location)],
    ['缺失類型', h(info.type)],
    ['開單日期', '<span style="' + MONO + '">' + h(d(info.issueDate)) + '</span>'],
    ['改善期限', '<span style="' + MONO + '">' + h(d(info.dueDate)) + '</span>' + badge],
    ['準備者', h(info.preparer)]
  ].map(function (r, i) {
    var bg = i % 2 ? '#ffffff' : '#f8faf9';
    var last = i === 6 ? '' : 'border-bottom:1px solid ' + LINE + ';';
    return '<tr><td bgcolor="' + bg + '" width="104" style="background-color:' + bg + ';padding:11px 14px;' + last +
      'color:' + MUTED + ';font-size:12px;font-weight:600;white-space:nowrap;width:104px;' + F + '">' + r[0] + '</td>' +
      '<td bgcolor="' + bg + '" style="background-color:' + bg + ';padding:11px 14px;' + last +
      'color:' + INK + ';font-size:13px;font-weight:600;' + F + '">' + r[1] + '</td></tr>';
  }).join('');

  function section(title) {
    return '<div style="' + F + 'padding:22px 0 8px 0;font-size:13px;font-weight:700;color:' + G + ';">' + title + '</div>';
  }
  function box(inner, bg, bar) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tr>' +
      '<td width="4" bgcolor="' + bar + '" style="background-color:' + bar + ';width:4px;font-size:1px;">&#8203;</td>' +
      '<td bgcolor="' + bg + '" style="background-color:' + bg + ';padding:12px 16px;' + F + 'font-size:13px;color:' + INK + ';line-height:1.7;">' +
      inner + '</td></tr></table>';
  }

  var desc = h(info.descZh) +
    (info.descEn ? '<div style="' + F + 'padding-top:8px;margin-top:8px;border-top:1px dashed #cfd8d2;color:' + MUTED + ';font-size:12.5px;">' + h(info.descEn) + '</div>' : '');

  var items = penaltyItems_(info.penalties);
  var pen = items.map(function (i) {
    return '<div style="' + F + 'padding:4px 0;font-size:12.5px;color:' + INK + ';">' +
      '<b style="color:#b42318;">第 ' + i.no + ' 項</b>&nbsp; ' + esc_(i.text) +
      ' &nbsp;<span style="color:#b42318;font-weight:700;white-space:nowrap;">' + esc_(i.fine) + '</span></div>';
  }).join('');

  // 按鈕:同一列 table,中間用空白 td 隔開 (Outlook 不吃 inline-table / margin,會疊在一起)
  function btn(url, label, bg) {
    return '<td bgcolor="' + bg + '" align="center" style="background-color:' + bg + ';border-radius:8px;padding:12px 18px;white-space:nowrap;' + F + '">' +
      '<a href="' + url + '" target="_blank" style="' + F + 'color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">' + label + '</a></td>';
  }
  var appUrl = '';
  try { appUrl = ScriptApp.getService().getUrl(); } catch (e) { appUrl = ''; }
  var cells = [];
  if (folder) cells.push(btn(folder.getUrl(), '📂 開啟雲端資料夾', G));
  if (docFile) cells.push(btn(docFile.getUrl(), '📄 開啟 Word 改善單', G2));
  if (appUrl) cells.push(btn(appUrl, '🖥️ 開啟系統', '#374151'));
  var btns = cells.length
    ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse:separate;margin:0 auto;"><tr>' +
      cells.join('<td width="14" style="width:14px;font-size:1px;line-height:1px;">&nbsp;</td>') + '</tr></table>'
    : '';

  var sent = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm');

  return '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>' +
    '<!--[if mso]><style type="text/css">body,table,td,div,p,span,a{font-family:\'Microsoft JhengHei\',\'Segoe UI\',Arial,sans-serif !important;}table{mso-table-lspace:0pt;mso-table-rspace:0pt;}</style><![endif]-->' +
    '</head><body style="margin:0;padding:0;background-color:#f2f7f3;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f2f7f3" style="background-color:#f2f7f3;border-collapse:collapse;">' +
    '<tr><td align="center" style="padding:24px 12px;' + F + '">' +
    '<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" align="center"><tr><td><![endif]-->' +
    '<div style="max-width:640px;margin:0 auto;text-align:left;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:14px;border:1px solid ' + LINE + ';border-collapse:collapse;">' +

    // 抬頭
    '<tr><td bgcolor="' + G + '" style="background-color:' + G + ';background-image:linear-gradient(135deg,' + G + ' 0%,' + G2 + ' 100%);padding:24px 28px;border-radius:14px 14px 0 0;' + F + '">' +
    '<div style="' + F + 'color:#b9f2cc;font-size:11px;letter-spacing:1.5px;font-weight:600;">NMDC ENVIRONMENTAL &nbsp;|&nbsp; 環保改善單 ENV NCR</div>' +
    '<div style="' + F + 'color:#ffffff;font-size:21px;font-weight:700;padding-top:8px;line-height:1.35;">' +
    (isTest ? '🧪 【測試】' : '🌱 ') + '新開立環保改善單通知</div>' +
    '<div style="' + F + 'color:#d6f5e0;font-size:12px;padding-top:6px;">通霄電廠二期更新改建計畫海底輸氣管線統包工程</div></td></tr>' +
    '<tr><td bgcolor="' + G2 + '" height="4" style="background-color:' + G2 + ';height:4px;font-size:1px;line-height:4px;mso-line-height-rule:exactly;">&#8203;</td></tr>' +

    // 內容
    '<tr><td style="padding:26px 28px 8px 28px;color:' + INK + ';font-size:14px;line-height:1.7;' + F + '">' +
    (isTest ? '<div style="' + F + 'margin-bottom:14px;padding:8px 12px;background-color:#fff7e6;border-radius:8px;color:#b45309;font-size:12.5px;">這是測試信,內容取自總表最新一張改善單,僅寄給測試收件人。</div>' : '') +
    '<div style="' + F + 'padding-bottom:18px;font-size:14px;color:' + INK + ';">系統已開立下列環保改善單,請相關人員於<b style="color:' + G + ';">改善期限前</b>完成改善並回報。' +
    '<br><span style="color:' + MUTED + ';font-size:12.5px;">Please complete the corrective action before the due date.</span></div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid ' + LINE + ';border-radius:10px;">' + rows + '</table>' +
    section('📌 違規敘述 Description') + box(desc, '#f8faf9', G2) +
    (pen ? section('⚠️ 罰款條款 (台電《01572章 環境保護》)') + box(pen, '#fff5f4', '#d92d20') +
      '<div style="' + F + 'padding-top:6px;font-size:11.5px;color:' + MUTED + ';">逾期未改善者,將依上述條款辦理罰款。</div>' : '') +
    (btns ? '<div style="padding:26px 0 6px 0;text-align:center;">' + btns + '</div>' : '') +
    (docFile ? '<div style="' + F + 'padding:6px 0 18px 0;text-align:center;font-size:11.5px;color:' + MUTED + ';">📎 改善單 Word 檔已附在本信件</div>' : '<div style="height:12px"></div>') +
    '</td></tr>' +

    // 頁尾
    '<tr><td style="padding:18px 28px 24px 28px;border-top:1px solid ' + LINE + ';color:' + MUTED + ';font-size:11px;line-height:1.8;' + F + '">' +
    '<div style="' + F + 'font-size:11px;font-weight:600;color:#374151;">NMDC 改善單系統 · 通霄電廠二期更新改建計畫海底輸氣管線統包工程</div>' +
    '<div style="' + F + 'font-size:11px;color:' + MUTED + ';">本信件由系統自動發送,請勿直接回覆。收件人可於系統「⚙️ 設定 → 📧 Email 收件人」調整。</div>' +
    '<div style="' + F + 'font-size:11px;color:' + MUTED + ';padding-top:4px;">發送時間:' + sent + '</div>' +
    '</td></tr></table></div>' +
    '<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>';
}

/** 寄出改善單通知 (附 Word 檔) */
function mailNcr_(ncrNo, info, docFile, folder, testTo) {
  var to = testTo ? [testTo] : mailRecipients_(info.vendorCode);
  if (!to.length) return { ok: false, to: [], error: '設定裡沒有勾選任何收件人' };
  var html = mailHtml_(ncrNo, info, docFile, folder, !!testTo);
  var opt = { to: to.join(','), htmlBody: html, name: 'NMDC 改善單系統',
    subject: (testTo ? '【測試】' : '') + '【新開立環保改善單】' + ncrNo + '｜' + info.vendorName + '｜期限 ' + String(info.dueDate).replace(/-/g, '/') };
  if (docFile) opt.attachments = [docFile.getBlob()];
  try {
    MailApp.sendEmail(opt);
    return { ok: true, to: to };
  } catch (e) {
    return { ok: false, to: to, error: e.message };
  }
}

/** 第一次加入寄信功能後,在編輯器手動執行一次這個函式完成授權 */
function 授權寄信() {
  Logger.log('今日剩餘可寄信數:' + MailApp.getRemainingDailyQuota());
}

// ================== 翻譯 ==================
function translateText(text) {
  if (!text) return '';
  return LanguageApp.translate(text, 'zh-TW', 'en');
}

// ================== 讀取資料 ==================
function getInit() {
  var s = getSettings_();
  return {
    vendors: s.vendors,
    recipients: s.recipients,
    types: CONFIG.TYPES,
    locations: CONFIG.LOCATIONS,
    preparers: CONFIG.PREPARERS,
    penalties: CONFIG.PENALTIES,
    dueDays: CONFIG.DUE_DAYS_DEFAULT,
    dueSoonDays: CONFIG.DUE_SOON_DAYS,
    today: Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'),
    records: getRecords()
  };
}

function getRecords() {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var ncrNo = String(r[1] || '').trim();
    var vendor = String(r[0] || '').trim();
    if (!ncrNo && !vendor) continue;
    var pens = [];
    try { pens = JSON.parse(String(r[13] || '[]')); } catch (e) { pens = []; }
    out.push({
      row: i + 1,
      vendor: vendor,
      ncrNo: ncrNo,
      location: String(r[2] || '').trim(),
      desc: String(r[3] || '').trim(),
      type: String(r[4] || '').trim(),
      issueDate: fmtDate_(r[5]),
      dueDate: fmtDate_(r[6]),
      preparer: String(r[7] || '').trim(),
      closeDate: fmtDate_(r[8]),
      closeReceiver: String(r[9] || '').trim(),
      descEn: String(r[10] || '').trim(),
      findingZh: String(r[11] || '').trim(),
      findingEn: String(r[12] || '').trim(),
      penalties: pens
    });
  }
  return out;
}

function nextNcrNo_(code) {
  var sh = getSheet_();
  var col = sh.getRange(2, 2, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  var re = new RegExp('^NMDC-' + code + '-E(\\d+)$', 'i');
  var max = 0;
  for (var i = 0; i < col.length; i++) {
    var m = String(col[i][0] || '').trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'NMDC-' + code + '-E' + pad3_(max + 1);
}

function previewNcrNo(code) {
  return nextNcrNo_(code);
}

// ================== 開單 ==================
function createNcr(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = getSheet_();
    ensureExtHeaders_(sh);
    var ncrNo = nextNcrNo_(payload.vendorCode);
    backupSheet_('開單_' + ncrNo);
    var issue = payload.issueDate.replace(/-/g, '/');
    var due = payload.dueDate.replace(/-/g, '/');

    sh.appendRow([
      payload.vendorName, ncrNo, payload.location, payload.descZh, payload.type,
      issue, due, payload.preparer, '', '',
      payload.descEn || '', payload.findingZh || '', payload.findingEn || '',
      JSON.stringify(payload.penalties || [])
    ]);

    var parent = DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID);
    var folder = parent.createFolder(ncrNo);

    var photoBlobs = [];
    (payload.photos || []).forEach(function (p, i) {
      var blob = Utilities.newBlob(Utilities.base64Decode(p.b64), 'image/jpeg',
        ncrNo + '_缺失照片_' + (i + 1) + '.jpg');
      folder.createFile(blob);
      photoBlobs.push(blob);
    });

    var docUrl = '', docFile = null;
    try {
      docFile = generateDoc_(ncrNo, payload, photoBlobs, folder);
      docUrl = docFile.getUrl();
    } catch (e) {
      docUrl = 'ERROR: ' + e.message;
    }

    var mail = null;
    if (payload.sendMail) mail = mailNcr_(ncrNo, payload, docFile, folder);

    return { ok: true, ncrNo: ncrNo, folderUrl: folder.getUrl(), docUrl: docUrl, mail: mail };
  } finally {
    lock.releaseLock();
  }
}

// ================== Word 產生 ==================
function generateDoc_(ncrNo, p, photoBlobs, folder) {
  if (!CONFIG.TEMPLATE_FILE_ID || CONFIG.TEMPLATE_FILE_ID.indexOf('PASTE') === 0) {
    throw new Error('尚未設定 TEMPLATE_FILE_ID');
  }
  var suffix = ncrNo.replace(/^NMDC-/, '');
  var issue = p.issueDate.replace(/-/g, '/');
  var due = p.dueDate.replace(/-/g, '/');
  var hdrDate = p.issueDate.replace(/\//g, '-');

  var items = penaltyItems_(p.penalties);

  var zh = p.descZh || '';
  zh += '\n請儘速派員改善,避免相關缺失情形再次發生。';
  if (items.length) {
    zh += '\n逾期未改善者,將依台電《01572章 環境保護》承攬商違反契約環境保護規定罰款標準辦理:';
    items.forEach(function (i) { zh += '\n• 第' + i.no + '項:' + i.text + ' — ' + i.fine; });
  }
  var en = p.descEn || '';
  if (en) en += '\n';
  en += 'Please promptly assign personnel to rectify the situation and prevent recurrence.';
  if (items.length) {
    en += '\nFailure to complete the required corrective actions within the specified deadline will result in fines pursuant to the penalty standard of Taiwan Power Company Section 01572, "Environmental Protection":';
    items.forEach(function (i) {
      var t = '';
      try { t = LanguageApp.translate(i.text, 'zh-TW', 'en'); } catch (e) { t = ''; }
      en += '\n• Item ' + i.no + ': ' + (t ? t + ' ' : '') + '— ' + i.fineEn;
    });
  }

  var map = {
    '{{NCR_SUFFIX}}': xmlText_(suffix),
    '{{HDR_DATE}}': xmlText_(hdrDate),
    '{{SITE}}': xmlText_(p.site || ''),
    '{{ISSUE_DATE}}': xmlText_(issue),
    '{{DUE_DATE}}': xmlText_(due),
    '{{RECEIVER}}': xmlText_(p.vendorCode + ' team'),
    '{{DESC_ZH_FULL}}': xmlText_(zh),
    '{{DESC_EN_FULL}}': xmlText_(en),
    '{{FINDING_ZH}}': xmlText_(p.findingZh || p.descZh || ''),
    '{{FINDING_EN}}': xmlText_(p.findingEn || p.descEn || '')
  };

  var tpl = DriveApp.getFileById(CONFIG.TEMPLATE_FILE_ID).getBlob().setContentType('application/zip');
  var parts = Utilities.unzip(tpl);
  var blank = Utilities.newBlob(Utilities.base64Decode(BLANK_JPG_B64), 'image/jpeg');

  var newParts = parts.map(function (part) {
    var name = part.getName();
    if (/^word\/(document\.xml|header\d+\.xml)$/.test(name)) {
      var xml = part.getDataAsString('UTF-8');
      Object.keys(map).forEach(function (k) { xml = xml.split(k).join(map[k]); });
      return Utilities.newBlob(xml, 'text/xml', name);
    }
    var slot = CONFIG.PHOTO_MEDIA.indexOf(name);
    if (slot !== -1) {
      var src = photoBlobs[slot] ? photoBlobs[slot] : blank;
      return Utilities.newBlob(src.getBytes(), 'image/jpeg', name);
    }
    return part;
  });

  var docxBlob = Utilities.zip(newParts, ncrNo + '_環保改善單.docx')
    .setContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return folder.createFile(docxBlob);
}

// ================== 結案 / 編輯 / 刪除 ==================
function findRowByNcr_(ncrNo) {
  var sh = getSheet_();
  var col = sh.getRange(2, 2, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0] || '').trim().toLowerCase() === ncrNo.toLowerCase()) return i + 2;
  }
  throw new Error('找不到編號 ' + ncrNo);
}

function closeNcr(ncrNo, closeDate, closeReceiver) {
  backupSheet_('結案_' + ncrNo);
  var sh = getSheet_();
  var row = findRowByNcr_(ncrNo);
  sh.getRange(row, 9, 1, 2).setValues([[closeDate.replace(/-/g, '/'), closeReceiver]]);
  return { ok: true };
}

function reopenNcr(ncrNo) {
  backupSheet_('重開_' + ncrNo);
  var sh = getSheet_();
  var row = findRowByNcr_(ncrNo);
  sh.getRange(row, 9, 1, 2).setValues([['', '']]);
  return { ok: true };
}

function updateNcr(ncrNo, f) {
  backupSheet_('編輯_' + ncrNo);
  var sh = getSheet_();
  ensureExtHeaders_(sh);
  var row = findRowByNcr_(ncrNo);
  function set(col, val) { sh.getRange(row, col).setValue(val); }
  if (f.location !== undefined) set(3, f.location);
  if (f.desc !== undefined) set(4, f.desc);
  if (f.type !== undefined) set(5, f.type);
  if (f.issueDate !== undefined) set(6, f.issueDate ? f.issueDate.replace(/-/g, '/') : '');
  if (f.dueDate !== undefined) set(7, f.dueDate ? f.dueDate.replace(/-/g, '/') : '');
  if (f.preparer !== undefined) set(8, f.preparer);
  if (f.closeDate !== undefined) set(9, f.closeDate ? f.closeDate.replace(/-/g, '/') : '');
  if (f.closeReceiver !== undefined) set(10, f.closeReceiver);
  if (f.descEn !== undefined) set(11, f.descEn);
  if (f.findingZh !== undefined) set(12, f.findingZh);
  if (f.findingEn !== undefined) set(13, f.findingEn);
  if (f.penalties !== undefined) set(14, JSON.stringify(f.penalties || []));
  return { ok: true };
}

function findFolderByNcr_(ncrNo) {
  var parent = DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID);
  var want = String(ncrNo).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var name = f.getName().replace(/\(.*?\)/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (name === want) return f;
  }
  return null;
}

function regenNcr(ncrNo) {
  var sh = getSheet_();
  var row = findRowByNcr_(ncrNo);
  var r = sh.getRange(row, 1, 1, 14).getValues()[0];

  var code = '';
  var m = String(r[1] || '').match(/^NMDC-([A-Za-z]+)-E/i);
  if (m) code = m[1];

  var locName = String(r[2] || '').trim();
  var site = locName;
  for (var i = 0; i < CONFIG.LOCATIONS.length; i++) {
    if (CONFIG.LOCATIONS[i].name === locName) { site = CONFIG.LOCATIONS[i].site; break; }
  }

  var pens = [];
  try { pens = JSON.parse(String(r[13] || '[]')); } catch (e) { pens = []; }

  function toIso(v) {
    var s = fmtDate_(v);
    var mm = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!mm) return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
    return mm[1] + '-' + ('0' + mm[2]).slice(-2) + '-' + ('0' + mm[3]).slice(-2);
  }

  var folder = findFolderByNcr_(ncrNo);
  if (!folder) throw new Error('找不到 ' + ncrNo + ' 的資料夾,無法重新產生 Word');

  var photoBlobs = [null, null];
  var files = folder.getFiles();
  var images = [];
  while (files.hasNext()) {
    var fl = files.next();
    var nm = fl.getName();
    if (nm.indexOf('缺失照片_1') !== -1) photoBlobs[0] = fl.getBlob();
    else if (nm.indexOf('缺失照片_2') !== -1) photoBlobs[1] = fl.getBlob();
    else if (/\.(jpg|jpeg|png)$/i.test(nm)) images.push(fl.getBlob());
    if (/\.docx$/i.test(nm) && nm.indexOf(ncrNo) !== -1 && nm.indexOf('_old') === -1) {
      fl.setName(nm.replace(/\.docx$/i, '') + '_old_' +
        Utilities.formatDate(new Date(), CONFIG.TZ, 'MMdd_HHmm') + '.docx');
    }
  }
  if (!photoBlobs[0] && images.length) photoBlobs[0] = images[0];
  if (!photoBlobs[1] && images.length > 1) photoBlobs[1] = images[1];

  var p = {
    vendorCode: code,
    site: site,
    issueDate: toIso(r[5]),
    dueDate: toIso(r[6]),
    descZh: String(r[3] || ''),
    descEn: String(r[10] || ''),
    findingZh: String(r[11] || ''),
    findingEn: String(r[12] || ''),
    penalties: pens
  };

  var cleanBlobs = [];
  if (photoBlobs[0]) cleanBlobs[0] = photoBlobs[0];
  if (photoBlobs[1]) cleanBlobs[1] = photoBlobs[1];

  var docFile = generateDoc_(ncrNo, p, cleanBlobs, folder);
  return { ok: true, docUrl: docFile.getUrl() };
}

function deleteNcr(ncrNo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = getSheet_();
    var row = findRowByNcr_(ncrNo);
    backupSheet_('刪除_' + ncrNo);
    sh.deleteRow(row);
    var parent = DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID);
    var it = parent.getFoldersByName(ncrNo);
    var trashed = 0;
    while (it.hasNext()) { it.next().setTrashed(true); trashed++; }
    return { ok: true, trashedFolders: trashed };
  } finally {
    lock.releaseLock();
  }
}

/** 測試信:拿最新一張改善單,只寄給指定 email */
function sendTestMail(to) {
  to = String(to || '').trim();
  if (!EMAIL_RE_.test(to)) throw new Error('email 格式不對:' + to);
  var recs = getRecords();
  if (!recs.length) throw new Error('總表還沒有任何改善單可以當測試範例');
  recs.sort(function (a, b) { return b.row - a.row; });
  return resendNcrMail(recs[0].ncrNo, to);
}

/** 重新寄送某張改善單 (附資料夾中最新的 Word) */
function resendNcrMail(ncrNo, testTo) {
  var sh = getSheet_();
  var row = findRowByNcr_(ncrNo);
  var r = sh.getRange(row, 1, 1, 14).getValues()[0];
  var m = String(r[1] || '').match(/^NMDC-([A-Za-z]+)-E/i);
  var pens = [];
  try { pens = JSON.parse(String(r[13] || '[]')); } catch (e) { pens = []; }
  var folder = findFolderByNcr_(ncrNo), docFile = null;
  if (folder) {
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next(), nm = f.getName();
      if (!/\.docx$/i.test(nm) || nm.indexOf('_old') !== -1) continue;
      if (!docFile || f.getDateCreated() > docFile.getDateCreated()) docFile = f;
    }
  }
  return mailNcr_(ncrNo, {
    vendorCode: m ? m[1] : '', vendorName: String(r[0] || ''),
    location: String(r[2] || ''), type: String(r[4] || ''),
    issueDate: fmtDate_(r[5]), dueDate: fmtDate_(r[6]), preparer: String(r[7] || ''),
    descZh: String(r[3] || ''), descEn: String(r[10] || ''), penalties: pens
  }, docFile, folder, testTo);
}

function getFolderUrl(ncrNo) {
  var f = findFolderByNcr_(ncrNo);
  return f ? f.getUrl() : '';
}