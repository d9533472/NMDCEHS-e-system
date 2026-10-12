// ═══════════════════════════════════════════════════════════════════
// 職安人員薪資調查系統 (Backend: Google Apps Script)
// v1.0.0  線上問卷 + 即時薪資百分位回饋 + 自動分析報告儀表板
// ═══════════════════════════════════════════════════════════════════
//
// 【設計重點】
// 1. 問卷資料與抽獎 Email 分存兩張工作表，兩者之間「沒有任何欄位可以對回去」
//    → 填答資料表只存 resp_id（隨機亂碼）
//    → 抽獎名單表只存 draw_id（另一組隨機亂碼）+ Email，順序亂序寫入
//    → 因此後台也無法得知某個 Email 對應哪一筆薪資
// 2. 送出後即時計算三種百分位：全體 / 同行業 / 同年資 / 同區域
// 3. 報告頁重現「非正式職安薪資調查報告」的統計骨架，並多給 P25 / P75
//
// 【部署步驟】
// 1. clasp push（.clasp.json 需填入該專案的 scriptId）
// 2. 於編輯器手動執行一次 initSystem()  ← 授權 + 建立工作表與欄位
//    · 綁定式專案（試算表→擴充功能→Apps Script）：直接用該試算表
//    · 獨立式專案：會自動在雲端硬碟建一份「職安人員薪資調查 — 資料庫」，
//      並把 ID 存進 Script Properties；執行紀錄會印出試算表網址
//    · 想改用現有試算表：執行 setSpreadsheetId('<試算表ID>')
// 3. 部署 → 新增部署作業 → 網頁應用程式
//    執行身分 = 我、具有存取權的使用者 = 所有人
// 4. 之後更新：clasp push 後 → clasp deploy -i <部署ID>（URL 不變）
//
// 【工作表結構】
//   回覆資料   Responses   問卷主資料（不含 Email）
//   抽獎名單   DrawPool    Email（與回覆資料無法對應）
//   系統設定   Config      調查起訖日、公告、異常值門檻
//   操作日誌   Logs
// ═══════════════════════════════════════════════════════════════════

// ★★★ 把你的收件信箱填在這裡（通知信會寄到這個地址），之後也可以在系統後台改 ★★★
const NOTIFY_EMAIL_DEFAULT = '';

// 通知節奏：這一天（含）以前每筆回覆都寄一封，之後自動改成每天寄一份摘要。
// 想一直維持「每筆一封」就把日期往後改；想立刻切成每日摘要就改成過去的日期。
const NOTIFY_EACH_UNTIL = '2026-10-09';
const DIGEST_HOUR = 9;                  // 每天幾點寄摘要（GAS 會在這個整點後一小時內送出）


// ══════════════════════════════════════════════════════════════════
// ★ 一鍵授權（放在最上面，編輯器打開預設就選到它）
//
// 【怎麼用】
//   1. Apps Script 編輯器上方的函式下拉選 authorizeAll
//   2. 按「執行」→ 會跳出授權畫面 → 選你的 Google 帳號
//   3. 出現「Google 尚未驗證這個應用程式」就點「進階」→「前往（不安全）」
//      （這是你自己寫的程式，沒有上架驗證才會這樣提示）
//   4. 全部允許 → 執行紀錄會印出每一項權限的檢查結果，並寄一封測試信給你
//
// 之後到後台按「寄一封測試信」確認，再 clasp deploy 一次即可。
// ══════════════════════════════════════════════════════════════════
function authorizeAll() {
  const out = [];
  const ok = function (name, fn) {
    try { out.push('✅ ' + name + '：' + fn()); }
    catch (err) { out.push('❌ ' + name + '：' + ((err && err.message) || err)); }
  };

  // 逐一碰過每個需要授權的服務，讓同意畫面一次把權限要齊
  ok('試算表（本專案資料庫）', function () { return _ss().getName(); });
  ok('試算表（2023 來源檔）', function () {
    return SpreadsheetApp.openById(LEGACY_SHEET_ID).getName();
  });
  ok('寄信額度', function () { return MailApp.getRemainingDailyQuota() + ' 封'; });
  ok('指令碼屬性', function () {
    PropertiesService.getScriptProperties().setProperty('AUTH_CHECK', new Date().toISOString());
    return '可讀寫';
  });
  ok('網頁應用程式網址', function () { return ScriptApp.getService().getUrl() || '（尚未部署）'; });
  ok('每日摘要排程', function () { return setupDailyDigest(); });

  // 真的寄一封信出去，確認寄信權限真的拿到了
  let to = '';
  try { to = (PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL') || '').trim(); } catch (e) {}
  if (!to) to = String(NOTIFY_EMAIL_DEFAULT || '').trim();
  if (to) {
    try { PropertiesService.getScriptProperties().setProperty('NOTIFY_EMAIL', to); } catch (e) {}
    try {
      MailApp.sendEmail({
        to: to,
        subject: '【' + SURVEY_TITLE + '】授權成功，通知信已可正常寄出',
        htmlBody:
          '<div style="font-family:system-ui,-apple-system,\'Noto Sans TC\',sans-serif;' +
          'max-width:520px;color:#0b1b2b;line-height:1.7">' +
          '<div style="background:#0e7a53;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0;' +
          'font-size:16px;font-weight:700">授權完成</div>' +
          '<div style="border:1px solid #e2e9f0;border-top:0;border-radius:0 0 12px 12px;padding:16px 18px">' +
          '<p style="margin:0 0 10px">收到這封信就表示寄信權限已經拿到，' +
          '之後每有一筆新回覆都會寄通知到 <b>' + to + '</b>。</p>' +
          '<p style="margin:0;font-size:13px;color:#64798c">要改收件信箱或關掉通知，' +
          '到系統後台的「新回覆通知信」調整。</p></div></div>'
      });
      out.push('✅ 測試信：已寄到 ' + to);
    } catch (err) {
      out.push('❌ 測試信：' + ((err && err.message) || err));
    }
  } else {
    out.push('❌ 測試信：沒有收件信箱。請把信箱填進 程式碼.js 最上面的 NOTIFY_EMAIL_DEFAULT，或到系統後台的「新回覆通知信」填一個，再執行一次。');
  }

  const text = out.join('\n');
  Logger.log(text);
  return text;
}


// ── 工作表名稱 ──
const SHEET_RESP   = '回覆資料';
const SHEET_DRAW   = '抽獎名單';
const SHEET_CONFIG = '系統設定';
const SHEET_LOGS   = '操作日誌';

// ── 調查基本資訊 ──
const SURVEY_TITLE   = '2025 年環安衛薪資調查';
const SURVEY_TAGLINE = '調查結果會分享給各位，並作為後續薪資談判之參考';
const SURVEY_START   = '2026-10-09';   // 民國 115/10/09
const SURVEY_END     = '2026-11-08';   // 民國 115/11/08
const SURVEY_YEAR    = 2025;           // 年度薪資問項所屬年度
const DRAW_WINNERS   = 5;
const DRAW_PRIZE     = '500 元禮券';
// 樣本數未達此數之前，不對外顯示任何百分位與統計數字（避免小樣本誤導）
const MIN_PUBLIC_N   = 30;
const LEGACY_TAG   = '2023調查匯入';   // 匯入2023.js 標記來源用，後台統計要分開比較

// ── 回覆資料欄位（順序即欄位順序）──
const RESP_HEADERS = [
  'resp_id','timestamp',
  // 基本資料
  'age','age_band','gender','education','major_field',
  // 證照與專業
  'osh_licenses','osh_license_top','other_licenses','other_license_has',
  'skills','skill_has',
  'intl_licenses','intl_license_has',
  // 語言
  'lang_test','lang_level','lang_score_raw','lang_points','lang_has',
  // 年資
  'yrs_construction','yrs_plant','yrs_other','yrs_total','yrs_band',
  // 現職
  'job_category','industry_sub','job_title','is_dedicated','subordinates',
  'company_size','work_city','work_region','job_contents','shift_type',
  // 工時
  'ot_mode','ot_hours_input','ot_workdays','ot_monthly','ot_pay_type',
  // 薪資
  'monthly_salary','annual_bonus','annual_total','bonus_months','raise_last_year',
  'benefits','annual_leave_days',
  // 職涯
  'prev_job','salary_change','salary_change_pct','satisfaction','job_seeking',
  'suggestion',
  // 系統欄
  'outlier','outlier_reason','joined_draw','client_token','source'
];

// ── 分組對照 ──
const REGION_MAP = {
  '臺北市':'北部','台北市':'北部','新北市':'北部','基隆市':'北部','桃園市':'北部',
  '新竹市':'北部','新竹縣':'北部','宜蘭縣':'北部',
  '苗栗縣':'中部','臺中市':'中部','台中市':'中部','彰化縣':'中部','南投縣':'中部','雲林縣':'中部',
  '嘉義市':'南部','嘉義縣':'南部','臺南市':'南部','台南市':'南部','高雄市':'南部','屏東縣':'南部',
  '花蓮縣':'東部','臺東縣':'東部','台東縣':'東部',
  '澎湖縣':'離島','金門縣':'離島','連江縣':'離島',
  '海外':'海外'
};

const YRS_BANDS = ['1年以下','1~3年','3~5年','5~10年','10~15年','15~20年','20年以上'];
const AGE_BANDS = ['25歲以下','26~30歲','31~35歲','36~40歲','41~45歲','46~50歲','51歲以上'];

// 語言能力分數對照（0~5），前端同步使用
const LANG_LEVELS = [
  { points:0, label:'無／未測驗',  cefr:'—',  desc:'未取得任何語言檢定' },
  { points:1, label:'初級 (A2)',   cefr:'A2', desc:'全民英檢初級｜TOEIC 350–549｜IELTS 3.0–3.5｜JLPT N5–N4' },
  { points:2, label:'中級 (B1)',   cefr:'B1', desc:'全民英檢中級｜TOEIC 550–729｜TOEFL iBT 42–71｜IELTS 4.0–5.0｜JLPT N3' },
  { points:3, label:'中高級 (B2)', cefr:'B2', desc:'全民英檢中高級｜TOEIC 730–859｜TOEFL iBT 72–94｜IELTS 5.5–6.5｜JLPT N2' },
  { points:4, label:'高級 (C1)',   cefr:'C1', desc:'全民英檢高級｜TOEIC 860–944｜TOEFL iBT 95–109｜IELTS 7.0–7.5｜JLPT N1' },
  { points:5, label:'優級 (C2)',   cefr:'C2', desc:'全民英檢優級｜TOEIC 945–990｜TOEFL iBT 110+｜IELTS 8.0+' }
];

// 異常值門檻
const OUTLIER = {
  monthlyMin: 20000,  monthlyMax: 500000,
  annualMin: 200000,  annualMax: 10000000,
  otMax: 300,
  // 相對比例：絕對門檻抓不到「月薪 8.5 萬卻填年終 300 萬」這種少打／多打一個 0 的情況
  bonusMonthsMax: 24,   // 年終超過 24 個月月薪
  annualMonthsMax: 40   // 年收入超過 40 個月月薪（12 個月本薪 + 24 個月年終上限還要留加班的餘裕）
};

// 改過 apiStats 的回傳結構就要跳版號，否則舊快取會餵給新前端（欄位對不上、整頁空白）
const CACHE_KEY = 'salary_stats_v2';
const CACHE_SEC = 120;


// ══════════════════════════════════
// 網頁入口
// ══════════════════════════════════
function doGet(e) {
  const p = (e && e.parameter) || {};
  const page = (p.page || 'survey').toLowerCase();
  const file = (page === 'report') ? 'report' : (page === 'admin' ? 'admin' : 'index');
  const t = HtmlService.createTemplateFromFile(file);
  t.BOOT = JSON.stringify(_bootData(page));
  return t.evaluate()
    .setTitle(page === 'report' ? SURVEY_TITLE + ' — 分析報告'
            : (page === 'admin' ? SURVEY_TITLE + ' — 系統後台' : SURVEY_TITLE))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function _bootData(page) {
  const d = {
    title: SURVEY_TITLE,
    tagline: SURVEY_TAGLINE,
    year: SURVEY_YEAR,
    start: SURVEY_START,
    end: SURVEY_END,
    startRoc: _toRoc(SURVEY_START),
    endRoc: _toRoc(SURVEY_END),
    open: _isOpen(),
    drawWinners: DRAW_WINNERS,
    drawPrize: DRAW_PRIZE,
    langLevels: LANG_LEVELS,
    webAppUrl: ScriptApp.getService().getUrl(),
    minPublicN: MIN_PUBLIC_N,
    count: 0,
    unlocked: false
  };
  try { d.count = _countResponses(); } catch (err) { d.count = 0; }
  d.unlocked = d.count >= MIN_PUBLIC_N;
  if (page === 'report') {
    try { d.stats = apiStats(); } catch (err) { d.statsError = String(err); }
  }
  return d;
}

function _isOpen() {
  const now = new Date();
  const s = new Date(SURVEY_START + 'T00:00:00+08:00');
  const e = new Date(SURVEY_END + 'T23:59:59+08:00');
  return now >= s && now <= e;
}

function _toRoc(iso) {
  const p = iso.split('-');
  return (Number(p[0]) - 1911) + '/' + p[1] + '/' + p[2];
}


// ══════════════════════════════════
// 試算表取得
// 綁定式（試算表→擴充功能→Apps Script）與獨立式專案都支援：
//   綁定式 → 直接用該試算表
//   獨立式 → 用 Script Properties 的 SPREADSHEET_ID；沒有的話 initSystem() 會自動建一份
// ══════════════════════════════════
function _ss() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('尚未建立資料試算表，請先在編輯器執行一次 initSystem()');
  return SpreadsheetApp.openById(id);
}

// 把現有的試算表指定給獨立式專案（想自己指定檔案時用）
function setSpreadsheetId(id) {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  CacheService.getScriptCache().remove(CACHE_KEY);
  return '已綁定試算表：' + SpreadsheetApp.openById(id).getUrl();
}

// 回傳資料試算表網址，方便找檔案
function getSpreadsheetUrl() {
  const url = _ss().getUrl();
  Logger.log(url);
  return url;
}


// ══════════════════════════════════
// 初始化（手動執行一次）
// ══════════════════════════════════
function initSystem() {
  const ss = _ssForInit();
  _getOrCreateSheet(ss, SHEET_RESP, RESP_HEADERS);
  _getOrCreateSheet(ss, SHEET_DRAW, ['draw_id','email','phone','address','date']);
  _getOrCreateSheet(ss, SHEET_LOGS, ['log_id','action','detail','timestamp']);

  const cfg = _getOrCreateSheet(ss, SHEET_CONFIG, ['key','value','說明']);
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, 4, 3).setValues([
      ['survey_start', SURVEY_START, '調查開始日（僅供紀錄，實際以程式常數為準）'],
      ['survey_end',   SURVEY_END,   '調查結束日'],
      ['notice',       '',           '顯示於問卷首頁的公告，留空則不顯示'],
      ['exclude_outlier','TRUE',     '報告是否排除異常值']
    ]);
  }
  _log('initSystem', '工作表初始化完成');
  const msg = '初始化完成｜資料試算表：' + ss.getUrl();
  Logger.log(msg);
  return msg;
}

function _ssForInit() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const created = SpreadsheetApp.create(SURVEY_TITLE + ' — 資料庫');
  props.setProperty('SPREADSHEET_ID', created.getId());
  return created;
}

function _getOrCreateSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  _ensureColumns(sh, headers);
  return sh;
}

// 欄位數超過預設 26 欄要先擴充；日後新增欄位時也會自動補上表頭（舊資料列留空）
function _ensureColumns(sh, headers) {
  const need = headers.length - sh.getMaxColumns();
  if (need > 0) sh.insertColumnsAfter(sh.getMaxColumns(), need);
  const cur = sh.getLastRow() === 0 ? [] : sh.getRange(1, 1, 1, headers.length).getValues()[0];
  let same = cur.length === headers.length;
  for (let i = 0; same && i < headers.length; i++) {
    if (String(cur[i]) !== headers[i]) same = false;
  }
  if (same) return sh;
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1f3a52').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

function _log(action, detail) {
  try {
    const sh = _ss().getSheetByName(SHEET_LOGS);
    if (sh) sh.appendRow([Utilities.getUuid().slice(0, 8), action, String(detail).slice(0, 500), new Date()]);
  } catch (err) { /* 日誌失敗不影響主流程 */ }
}


// ══════════════════════════════════
// 送出問卷
// ══════════════════════════════════
function apiSubmit(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return { ok: false, error: '系統忙碌中，請稍候再送出一次' };
  }
  try {
    if (!_isOpen()) {
      const beforeStart = new Date() < new Date(SURVEY_START + 'T00:00:00+08:00');
      return { ok: false, error: beforeStart
        ? '本調查將於 ' + _toRoc(SURVEY_START) + ' 開始，目前尚未開放填寫'
        : '本調查已於 ' + _toRoc(SURVEY_END) + ' 截止，感謝您的參與' };
    }
    const d = payload || {};
    const v = _validate(d);
    if (!v.ok) return v;

    const row = _buildRow(d);
    const ss = _ss();
    const sh = ss.getSheetByName(SHEET_RESP);
    if (!sh) return { ok: false, error: '尚未初始化，請管理者先執行 initSystem()' };
    _ensureColumns(sh, RESP_HEADERS);   // 新增欄位後自動補表頭，不用手動遷移

    sh.appendRow(RESP_HEADERS.map(function (h) { return row[h] === undefined ? '' : row[h]; }));

    // 聯絡資訊走完全獨立的路徑：另一張表、另一組 id、亂序插入
    const email = String(d.email || '').trim();
    if (email) _appendDrawEntry(ss, email, d.phone, d.address);

    CacheService.getScriptCache().remove(CACHE_KEY);
    _log('submit', row.resp_id + ' / ' + row.job_category);
    _notifyNewResponse(row, Math.max(0, sh.getLastRow() - 1));

    const result = _percentileReport(row);
    result.ok = true;
    result.respId = row.resp_id;
    result.joinedDraw = !!email;
    result.hasAddress = !!String(d.address || '').trim();
    result.otMonthly = row.ot_monthly;
    result.bonusMonths = row.bonus_months;
    return result;
  } catch (err) {
    _log('submit_error', err && err.stack ? err.stack : err);
    return { ok: false, error: '送出失敗：' + (err && err.message ? err.message : err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ══════════════════════════════════
// 新回覆通知信
// 【刻意不寄薪資數字】：信件有精確時間，抽獎名單只記到「日」又亂序插入，
// 兩者本來就對不起來。但如果通知信把薪資寫進去，管理者只要在收到信的當下
// 去比對抽獎名單多了哪一列，就能把 Email 和薪資配起來——那會推翻問卷頁
// 對填答者做的承諾。想看薪資請直接開試算表（看的是整批資料，不是即時單筆）。
// 真的要讓通知信帶薪資，到後台把「通知信包含薪資數字」打開，但那等於放棄上面那個保證。
// ══════════════════════════════════
// 今天該用哪種通知節奏
function _notifyMode() {
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  return today <= NOTIFY_EACH_UNTIL ? 'each' : 'digest';
}

function _notifyNewResponse(row, total, force) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('NOTIFY_ON') === 'off') return { sent: false, reason: '通知已關閉' };
    if (!force && _notifyMode() !== 'each') {
      return { sent: false, reason: '目前是每日摘要模式，不逐筆寄信' };
    }
    const to = (props.getProperty('NOTIFY_EMAIL') || '').trim() || String(NOTIFY_EMAIL_DEFAULT || '').trim();
    if (!to) return { sent: false, reason: '還沒設定收件信箱，請在上面填一個再儲存' };
    if (MailApp.getRemainingDailyQuota() < 5) {    // 留一點額度給抽獎通知
      _log('notify_skip', '今日寄信額度不足，略過通知');
      return { sent: false, reason: '今日寄信額度不足' };
    }
    const withPay = props.getProperty('NOTIFY_DETAIL') === 'on';
    const line = function (k, v) {
      return '<tr><td style="padding:4px 14px 4px 0;color:#64798c">' + k +
             '</td><td style="padding:4px 0;font-weight:700">' + v + '</td></tr>';
    };
    let rows =
      line('編號', row.resp_id) +
      line('累計筆數', '第 ' + total + ' 筆') +
      line('行業別', row.job_category || '—') +
      line('年資', row.yrs_band + '（' + row.yrs_total + ' 年）') +
      line('工作地', row.work_city + '　' + row.work_region) +
      line('學歷', row.education || '—') +
      line('職安證照', row.osh_license_top || '—') +
      line('參加抽獎', row.joined_draw ? '是' : '否');
    if (withPay) {
      rows += line('月全薪', _fmt(row.monthly_salary)) +
              line('年總獎金', _fmt(row.annual_bonus)) +
              line('全年收入', _fmt(row.annual_total));
    }
    const html =
      '<div style="font-family:system-ui,-apple-system,\'Noto Sans TC\',sans-serif;' +
      'max-width:520px;color:#0b1b2b;line-height:1.7">' +
      '<div style="background:#0e7a53;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0;' +
      'font-size:16px;font-weight:700">' + SURVEY_TITLE + '　有新回覆</div>' +
      '<div style="border:1px solid #e2e9f0;border-top:0;border-radius:0 0 12px 12px;padding:16px 18px">' +
      '<table style="font-size:14px;border-collapse:collapse">' + rows + '</table>' +
      (withPay ? '' :
        '<p style="font-size:12px;color:#64798c;margin:14px 0 0;line-height:1.6">' +
        '通知信刻意不附薪資數字——信件有精確時間，若同時附上薪資，就能跟抽獎名單的新增紀錄對起來，' +
        '違背問卷對填答者的承諾。要看數字請直接開試算表。</p>') +
      '<p style="margin:14px 0 0"><a href="' + ScriptApp.getService().getUrl() +
      '?page=admin" style="color:#0e7a53;font-weight:700">開啟系統後台 →</a></p>' +
      '</div></div>';
    MailApp.sendEmail({
      to: to,
      subject: '【' + SURVEY_TITLE + '】第 ' + total + ' 筆回覆（' +
               (row.job_category || '—') + '／' + row.yrs_band + '）',
      htmlBody: html
    });
    return { sent: true, to: to };
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    _log('notify_error', msg);
    return { sent: false, reason: msg };
  }
}

// ══════════════════════════════════
// 每日摘要（每天早上寄一份；舊的週報已經併進這裡）
// ══════════════════════════════════

// 郵件版箱型圖。後台那張是用 position:absolute 畫的，Gmail 會把 position
// 整條砍掉，所以這裡用「百分比寬度的表格」重畫一次同一張圖：
// 淺綠方塊＝P25～P75、深綠直線＝中位數、金色圓點＝平均數。
function _bxMail(s) {
  if (!s || !(Number(s.median) > 0)) return '';
  // 鬚線取 Tukey 1.5 倍四分位距：只要有一筆離譜的數字，min~max 刻度就會把整個盒子壓到最左邊
  const iqr = s.p75 - s.p25;
  let lo = s.min, hi = s.max;
  if (iqr > 0) {
    lo = Math.max(s.min, s.p25 - 1.5 * iqr);
    hi = Math.min(s.max, s.p75 + 1.5 * iqr);
  }
  if (!(hi > lo)) { lo = s.min; hi = s.max; }
  const span = (hi - lo) || 1;
  const at = function (v) { return Math.max(0, Math.min(100, (v - lo) / span * 100)); };
  // 記號夾在 0.6～99.4%：平均數被鬚線切掉時才不會貼在表格邊界上看不見
  const nip = function (v) { return Math.max(0.6, Math.min(99.4, v)); };
  const p25 = at(s.p25), p75 = at(s.p75);
  const med = nip(at(s.median)), mean = nip(at(s.mean));
  const same = function (a, b) { return Math.abs(a - b) < 0.01; };

  const blank = 'font-size:0;line-height:0';
  const cap = '<td width="2" valign="middle" style="padding:0;' + blank + '">' +
    '<div style="width:2px;height:14px;background:#93a6b6;' + blank + '">&nbsp;</div></td>';
  const medCell = '<td width="3" valign="middle" style="padding:0;' + blank + '">' +
    '<div style="width:3px;height:26px;background:#0a5c3e;' + blank + '">&nbsp;</div></td>';
  const meanCell = '<td width="10" valign="middle" style="padding:0;' + blank + '">' +
    '<div style="width:6px;height:6px;border:2px solid #fff;border-radius:50%;' +
    'background:#b8862b;' + blank + '">&nbsp;</div></td>';
  // 盒子被記號切成好幾段，左右邊框只畫在最外兩段，中間才不會多出一條框線
  const seg = function (w, inBox, edgeL, edgeR) {
    const style = inBox
      ? 'height:17px;background:#e8f5ef;border-top:1.5px solid #0e7a53;' +
        'border-bottom:1.5px solid #0e7a53;' +
        (edgeL ? 'border-left:1.5px solid #0e7a53;' : '') +
        (edgeR ? 'border-right:1.5px solid #0e7a53;' : '')
      : 'height:2px;background:#93a6b6;';
    return '<td width="' + w + '%" valign="middle" style="padding:0;' + blank + '">' +
      '<div style="' + style + blank + '">&nbsp;</div></td>';
  };

  // 0～100 依 P25／P75／中位數／平均切成數段，逐段決定要畫鬚線還是盒子
  const stops = [];
  [0, p25, med, mean, p75, 100].forEach(function (v) {
    if (v < 0 || v > 100) return;
    for (let i = 0; i < stops.length; i++) if (same(stops[i], v)) return;
    stops.push(v);
  });
  stops.sort(function (a, b) { return a - b; });

  let bar = cap;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    const inBox = p75 > p25 && a >= p25 - 0.01 && b <= p75 + 0.01;
    bar += seg(Math.round((b - a) * 100) / 100, inBox, inBox && same(a, p25), inBox && same(b, p75));
    if (same(b, med)) bar += medCell;
    if (same(b, mean)) bar += meanCell;
  }
  bar += cap;

  const tb = '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
             'style="border-collapse:collapse">';
  const lab = '中位 ' + _wan(s.median);
  const labSty = 'padding:0 0 2px;font-size:11.5px;font-weight:800;color:#0a5c3e;white-space:nowrap';
  const ax = 'font-size:10.5px;color:#93a6b6;white-space:nowrap;padding:3px 0 0';
  const outLo = s.min < lo, outHi = s.max > hi;

  return '<div style="margin:0 10px">' +
    // 中位數標籤：靠左半邊就從線往右寫，靠右半邊就往左寫，免得被切掉
    tb + '<tr>' + (med <= 50
      ? '<td width="' + med + '%" style="padding:0"></td>' +
        '<td align="left" style="' + labSty + '">' + lab + '</td>'
      : '<td align="right" width="' + med + '%" style="' + labSty + '">' + lab + '</td>' +
        '<td style="padding:0"></td>') +
    '</tr></table>' +
    tb + '<tr>' + bar + '</tr></table>' +
    // 刻度：四格的累積寬度剛好把 P25／P75 的字頭對在自己的位置上。
    // P25 太靠左（或 P75 太靠右）時兩個數字會疊在一起，這時改讓下面那行文字交代端點
    tb + '<tr>' +
      '<td width="' + Math.round(p25) + '%" align="left" style="' + ax + '">' +
        (p25 >= 12 ? _wan(lo) : '') + '</td>' +
      '<td width="' + Math.max(1, Math.round(p75 - p25)) + '%" align="left" style="' + ax + '">' +
        'P25 ' + _wan(s.p25) + '</td>' +
      '<td width="' + Math.max(1, Math.round(100 - p75) - 14) + '%" align="left" style="' + ax + '">' +
        'P75 ' + _wan(s.p75) + '</td>' +
      '<td align="right" style="' + ax + '">' + (100 - p75 >= 12 ? _wan(hi) : '') + '</td>' +
    '</tr></table>' +
    (outLo || outHi
      ? '<p style="margin:7px 0 0;font-size:11px;color:#93a6b6;line-height:1.5">' +
        '鬚線 ' + _wan(lo) + ' ～ ' + _wan(hi) + ' 只畫到 1.5 倍四分位距，' +
        '外面還有極端值沒畫進來；實際全距 ' + _wan(s.min) + ' ～ ' + _wan(s.max) + '。</p>'
      : (p25 < 12 || 100 - p75 < 12)
        ? '<p style="margin:7px 0 0;font-size:11px;color:#93a6b6;line-height:1.5">鬚線兩端 ' +
          _wan(lo) + ' ～ ' + _wan(hi) + '。</p>'
        : '') +
    '</div>';
}

function sendDailyDigest() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('NOTIFY_ON') === 'off') return '通知已關閉';
  const to = (props.getProperty('NOTIFY_EMAIL') || '').trim() ||
             String(NOTIFY_EMAIL_DEFAULT || '').trim();
  if (!to) return '還沒設定收件信箱';

  const rows = _readResponses();
  const clean = rows.filter(function (r) { return !r.outlier; });
  const now = new Date();
  const dayKey = function (d) { return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd'); };
  const dayBack = function (n) { return dayKey(new Date(now.getTime() - n * 86400000)); };
  const md = function (key) { return key.slice(5).replace('-', '/'); };

  // 先把每一筆歸到自己的日期，後面查哪一天都只是查表（匯入的 2023 列不會落在這些日子）
  const byDay = {};
  rows.forEach(function (r) {
    if (!(r.timestamp instanceof Date)) return;
    const k = dayKey(r.timestamp);
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(r);
  });
  const onDay = function (key) { return byDay[key] || []; };

  const today = dayBack(0), yest = dayBack(1);
  const tRows = onDay(today), yRows = onDay(yest), eRows = onDay(dayBack(2));
  const cutoff = new Date(now.getTime() - 7 * 86400000);
  const week = rows.filter(function (r) {
    return (r.timestamp instanceof Date) && r.timestamp >= cutoff;
  });
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayBack(i);
    days.push({ label: md(k), count: onDay(k).length });
  }

  const card = function (k, v, sub) {
    return '<td style="padding:0 8px 0 0;vertical-align:top;width:33%">' +
      '<div style="border:1px solid #e2e9f0;border-radius:11px;padding:11px 13px;background:#fafcfd">' +
      '<div style="font-size:11.5px;color:#64798c">' + k + '</div>' +
      '<div style="font-size:25px;font-weight:800;color:#0b1b2b;line-height:1.2">' + v + '</div>' +
      (sub ? '<div style="font-size:11.5px;color:#93a6b6">' + sub + '</div>' : '') +
      '</div></td>';
  };
  const h3 = function (t) {
    return '<p style="margin:18px 0 6px;font-size:13px;font-weight:700;color:#2a4259">' + t + '</p>';
  };
  const note = function (t) {
    return '<p style="margin:7px 0 0;font-size:11.5px;color:#64798c;line-height:1.6">' + t + '</p>';
  };
  const dist = function (title, list) {
    if (!list.length) return '';
    return h3(title) +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      list.slice(0, 8).map(function (x) {
        const w = Math.round(x.count / list[0].count * 100);
        return '<tr><td style="padding:3px 10px 3px 0;color:#2a4259;white-space:nowrap">' + x.label + '</td>' +
          '<td style="padding:3px 0;width:100%"><div style="background:#eff4f8;border-radius:99px;height:9px">' +
          '<div style="width:' + w + '%;height:9px;border-radius:99px;background:#13946a"></div></div></td>' +
          '<td style="padding:3px 0 3px 10px;text-align:right;white-space:nowrap;color:#64798c">' +
          x.count + '</td></tr>';
      }).join('') + '</table>';
  };
  const chart = function (title, s) {
    if (!s || !(Number(s.median) > 0)) return '';
    return '<div style="border:1px solid #e2e9f0;border-radius:12px;padding:11px 3px 13px;' +
      'margin:10px 0 0;background:#fff">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td style="padding:0 10px 10px;font-size:12.5px;font-weight:700;color:#2a4259">' + title + '</td>' +
      '<td align="right" style="padding:0 10px 10px;font-size:11.5px;font-weight:700;' +
      'color:#0a5c3e;white-space:nowrap">n=' + s.n + '　平均 ' + _wan(s.mean) + '</td>' +
      '</tr></table>' + _bxMail(s) + '</div>';
  };

  const diff = yRows.length - eRows.length;
  const need = Math.max(0, MIN_PUBLIC_N - clean.length);
  const left = Math.max(0, Math.ceil(
    (new Date(SURVEY_END + 'T23:59:59+08:00').getTime() - now.getTime()) / 86400000));

  let body =
    '<table style="width:100%;border-collapse:separate;border-spacing:0"><tr>' +
    card('昨日新增', yRows.length + ' 筆',
         md(yest) + '　比前日 ' + (diff > 0 ? '+' + diff : diff < 0 ? diff : '持平')) +
    card('今日累積', tRows.length + ' 筆', '近 7 天 ' + week.length + ' 筆') +
    card('累計回覆', rows.length + ' 筆', '有效 ' + clean.length + ' 筆') +
    '</tr></table>' +
    '<p style="margin:12px 0 0;font-size:12.5px;color:#64798c">' +
    (need ? '距離公開門檻還差 <b style="color:#b0341f">' + need + ' 筆</b>（門檻 ' + MIN_PUBLIC_N + ' 份）'
          : '已達公開門檻 ' + MIN_PUBLIC_N + ' 份') +
    '　·　調查還有 <b style="color:#0a5c3e">' + left + ' 天</b>（截止 ' + _toRoc(SURVEY_END) + '）</p>';

  // 近 14 天回收趨勢
  let peak = 1;
  days.forEach(function (x) { if (x.count > peak) peak = x.count; });
  // 每根柱子都要給同樣的寬度，否則表格會照內容分配，柱子就會寬窄不一
  const colW = Math.round(1000 / days.length) / 10;
  body += h3('近 14 天回收') +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="table-layout:fixed;border-collapse:collapse"><tr>' +
    days.map(function (x) {
      const hgt = x.count ? Math.max(3, Math.round(x.count / peak * 42)) : 2;
      return '<td width="' + colW + '%" valign="bottom" style="padding:0 1px;font-size:0;line-height:0">' +
        '<div style="height:' + hgt + 'px;background:' + (x.count ? '#13946a' : '#dde6ee') +
        ';border-radius:2px;font-size:0;line-height:0">&nbsp;</div></td>';
    }).join('') +
    '</tr><tr>' +
    days.map(function (x, i) {
      return '<td width="' + colW + '%" align="center" ' +
        'style="padding:4px 0 0;font-size:9px;color:#93a6b6;white-space:nowrap">' +
        (i % 3 === 1 || i === days.length - 1 ? x.label : '') + '</td>';
    }).join('') +
    '</tr></table>';

  // 分布看昨天那一批；昨天沒人填就退一步看整週
  const dRows = yRows.length ? yRows : week;
  const dWhen = yRows.length ? '昨日' : '近 7 天';
  if (dRows.length) {
    body += dist(dWhen + '行業別', _countBy(dRows, 'job_category')) +
            dist(dWhen + '年資', _countBy(dRows, 'yrs_band'));
  } else {
    body += '<p style="margin:16px 0 0;font-size:13.5px;color:#64798c">' +
            '昨天跟這一週都沒有新的回覆。要不要再到社團轉發一次？</p>';
  }

  // 中位數／平均都是公開報告上本來就看得到的彙總數字，不涉及單筆，可以放
  if (clean.length >= MIN_PUBLIC_N) {
    const st = _salaryStat(clean);
    const th = function (t, al) {
      return '<th align="' + (al || 'right') + '" style="padding:0 0 6px;font-size:11px;' +
        'font-weight:700;color:#93a6b6;white-space:nowrap">' + t + '</th>';
    };
    const td = function (v, col, bold) {
      return '<td align="right" style="padding:7px 0;border-top:1px solid #eff4f8;font-size:13px;' +
        'white-space:nowrap;color:' + (col || '#2a4259') + (bold ? ';font-weight:800' : '') + '">' +
        _fmt(v) + '</td>';
    };
    const line = function (label, s) {
      return '<tr><td style="padding:7px 10px 7px 0;border-top:1px solid #eff4f8;font-size:13px;' +
        'font-weight:700;color:#2a4259;white-space:nowrap">' + label + '</td>' +
        td(s.median, '#0a5c3e', true) + td(s.mean, '#b8862b', true) +
        td(s.p25) + td(s.p75) + '</tr>';
    };
    body += h3('累計統計（有效 ' + clean.length + ' 筆）') +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border-collapse:collapse"><tr>' + th('　', 'left') + th('中位數') + th('平均') +
      th('P25') + th('P75') + '</tr>' +
      line('月全薪', st.monthly) + line('年終獎金', st.bonus) + line('全年收入', st.annual) +
      '</table>' +
      note('綠色是中位數、金色是平均數。平均明顯高過中位數，就是少數高薪把平均拉上去了。');

    body += h3('薪資分布') +
      note('淺綠方塊＝P25～P75（中間一半的人），深綠直線＝中位數，<b style="color:#b8862b">' +
           '金色圓點＝平均數</b>。金點落在深綠線右邊愈多，代表分布愈往高薪端拖。') +
      chart('月薪', st.monthly) +
      chart('全年本業總收入', st.annual);
  } else {
    body += note('有效樣本未達 ' + MIN_PUBLIC_N + ' 份，摘要暫不顯示中位數與平均。');
  }

  const url = ScriptApp.getService().getUrl();
  const html =
    '<div style="font-family:system-ui,-apple-system,\'Noto Sans TC\',sans-serif;' +
    'max-width:560px;color:#0b1b2b;line-height:1.7">' +
    '<div style="background:#0e7a53;color:#fff;padding:15px 18px;border-radius:12px 12px 0 0">' +
    '<div style="font-size:11.5px;opacity:.8;letter-spacing:.1em">DAILY DIGEST</div>' +
    '<div style="font-size:17px;font-weight:700">' + SURVEY_TITLE + '　每日摘要</div>' +
    '<div style="font-size:12px;opacity:.85">' + _toRoc(today) + '</div></div>' +
    '<div style="border:1px solid #e2e9f0;border-top:0;border-radius:0 0 12px 12px;padding:16px 18px">' +
    body +
    '<p style="margin:18px 0 0;font-size:13px">' +
    '<a href="' + url + '?page=report" style="color:#0e7a53;font-weight:700">看分析報告</a>　·　' +
    '<a href="' + url + '?page=admin" style="color:#0e7a53;font-weight:700">系統後台</a>　·　' +
    '調查截止日 ' + _toRoc(SURVEY_END) + '</p>' +
    '<p style="margin:12px 0 0;font-size:11.5px;color:#93a6b6;line-height:1.6">' +
    '摘要只給彙總數字，不列出任何單筆回覆——這樣才不會讓收信時間跟抽獎名單的新增對得起來。</p>' +
    '</div></div>';

  try {
    MailApp.sendEmail({
      to: to,
      subject: '【' + SURVEY_TITLE + '】每日摘要：昨日新增 ' + yRows.length +
               ' 筆，累計 ' + rows.length + ' 筆',
      htmlBody: html
    });
    _log('digest', '每日摘要已寄給 ' + to + '（昨日新增 ' + yRows.length + ' 筆）');
    return '已寄出每日摘要給 ' + to + '（昨日新增 ' + yRows.length + ' 筆）';
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    _log('digest_error', msg);
    return '寄送失敗：' + msg;
  }
}

// 安裝／移除每天的觸發器（順手清掉舊的週報觸發器，不會兩份一起寄）
function setupDailyDigest() {
  removeDailyDigest();
  ScriptApp.newTrigger('sendDailyDigest')
    .timeBased()
    .everyDays(1)
    .atHour(DIGEST_HOUR)
    .inTimezone('Asia/Taipei')
    .create();
  return '已排定每天 ' + DIGEST_HOUR + ' 點寄送摘要';
}

function removeDailyDigest() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === 'sendDailyDigest' || f === 'sendWeeklyDigest') { ScriptApp.deleteTrigger(t); n++; }
  });
  return '已移除 ' + n + ' 個摘要觸發器';
}

function _hasDigestTrigger() {
  try {
    return ScriptApp.getProjectTriggers().some(function (t) {
      const f = t.getHandlerFunction();
      return f === 'sendDailyDigest' || f === 'sendWeeklyDigest';
    });
  } catch (e) { return false; }
}

// 舊名字留著當轉接：之前裝的週報觸發器指向 sendWeeklyDigest，
// 在它被 setupDailyDigest 清掉之前還是要能跑。
function sendWeeklyDigest() { return sendDailyDigest(); }
function setupWeeklyDigest() { return setupDailyDigest(); }
function removeWeeklyDigest() { return removeDailyDigest(); }
function _hasWeeklyTrigger() { return _hasDigestTrigger(); }


// 後台：讀取／設定通知
function adminGetNotify(pw) {
  _auth(pw);
  const props = PropertiesService.getScriptProperties();
  const fallback = String(NOTIFY_EMAIL_DEFAULT || '').trim();
  let quota = -1;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  return {
    ok: true,
    on: props.getProperty('NOTIFY_ON') !== 'off',
    email: (props.getProperty('NOTIFY_EMAIL') || '').trim(),
    fallback: fallback,
    detail: props.getProperty('NOTIFY_DETAIL') === 'on',
    quota: quota,
    mode: _notifyMode(),
    eachUntil: NOTIFY_EACH_UNTIL,
    digestHour: DIGEST_HOUR,
    hasTrigger: _hasDigestTrigger()
  };
}

function adminSetNotify(pw, cfg) {
  _auth(pw);
  const c = cfg || {};
  const email = String(c.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Email 格式有誤' };
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('NOTIFY_ON', c.on ? 'on' : 'off');
  props.setProperty('NOTIFY_EMAIL', email);
  props.setProperty('NOTIFY_DETAIL', c.detail ? 'on' : 'off');
  _log('admin_notify', (c.on ? '開啟' : '關閉') + '通知' + (c.detail ? '（含薪資）' : ''));
  const s = adminGetNotify(pw);
  s.message = c.on ? '已開啟新回覆通知信' : '已關閉新回覆通知信';
  return s;
}

// 後台：寄一封測試信
function adminTestNotify(pw) {
  _auth(pw);
  const r = _notifyNewResponse({
    resp_id: 'R-TEST-0000', job_category: '（測試）廠工安', yrs_band: '5~10年',
    yrs_total: 8, work_city: '臺北市', work_region: '北部', education: '大學',
    osh_license_top: '甲級管理師', joined_draw: '',
    monthly_salary: 62000, annual_bonus: 180000, annual_total: 924000
  }, 0, true);
  if (!r || !r.sent) {
    return { ok: false, error: '測試信沒有寄出：' + ((r && r.reason) || '未知原因') };
  }
  const s = adminGetNotify(pw);
  s.message = '已寄出測試信到 <b>' + r.to + '</b>，請到信箱確認';
  return s;
}


// 抽獎名單：亂序插入，只存聯絡資訊，不存任何可連回問卷的欄位
function _appendDrawEntry(ss, email, phone, address) {
  const sh = ss.getSheetByName(SHEET_DRAW);
  if (!sh) return;
  const last = sh.getLastRow();
  const existing = last > 1 ? sh.getRange(2, 2, last - 1, 1).getValues() : [];
  const lower = email.toLowerCase();
  for (let i = 0; i < existing.length; i++) {
    if (String(existing[i][0]).trim().toLowerCase() === lower) return; // 同一信箱只留一筆
  }
  const drawId = 'D' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  // 只記錄到「日」，避免用時間戳對回問卷送出時間
  const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const insertAt = last <= 1 ? 2 : (2 + Math.floor(Math.random() * (last - 1)));
  sh.insertRowBefore(insertAt);
  sh.getRange(insertAt, 1, 1, 5).setValues([[
    drawId, email,
    String(phone || '').trim().slice(0, 30),
    String(address || '').trim().slice(0, 200),
    stamp
  ]]);
}

function _validate(d) {
  const req = ['age', 'education', 'yrs_total', 'job_category', 'work_city', 'monthly_salary', 'annual_total'];
  const names = {
    age: '年齡', education: '最高學歷', yrs_total: '職安總年資',
    job_category: '現職工作分類', work_city: '工作地',
    monthly_salary: '月全薪', annual_total: SURVEY_YEAR + ' 年度全年本業總收入'
  };
  for (let i = 0; i < req.length; i++) {
    const k = req[i];
    if (d[k] === undefined || d[k] === null || String(d[k]).trim() === '') {
      return { ok: false, error: '請填寫必填欄位：' + names[k] };
    }
  }
  const m = _num(d.monthly_salary);
  const a = _num(d.annual_total);
  if (!(m > 0)) return { ok: false, error: '月全薪請填寫數字' };
  if (!(a > 0)) return { ok: false, error: '全年本業總收入請填寫數字' };
  const email = String(d.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Email 格式有誤，請確認或留空' };
  }
  if (!email && (String(d.phone || '').trim() || String(d.address || '').trim())) {
    return { ok: false, error: '若要參加抽獎請填 Email；只填電話或地址無法通知您' };
  }
  return { ok: true };
}

function _buildRow(d) {
  const r = {};
  r.resp_id = 'R' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
  r.timestamp = new Date();

  const age = _num(d.age);
  r.age = age || '';
  r.age_band = _ageBand(age);
  r.gender = d.gender || '';
  r.education = d.education || '';
  r.major_field = d.major_field || '';

  const oshList = _arr(d.osh_licenses);
  r.osh_licenses = oshList.join('｜');
  r.osh_license_top = _topOshLicense(oshList, _arr(d.intl_licenses));

  const otherList = _arr(d.other_licenses);
  r.other_licenses = otherList.join('｜');
  r.other_license_has = otherList.length ? '有' : '無';

  const skillList = _arr(d.skills);
  r.skills = skillList.join('｜');
  r.skill_has = skillList.length ? '有' : '無';

  const intlList = _arr(d.intl_licenses).filter(function (x) { return x !== '以上皆無'; });
  r.intl_licenses = intlList.join('｜');
  r.intl_license_has = intlList.length ? '有國際證照' : '無國際證照';

  r.lang_test = d.lang_test || '';
  const lp = _num(d.lang_points);
  r.lang_points = isNaN(lp) ? 0 : lp;
  r.lang_level = (LANG_LEVELS[r.lang_points] || LANG_LEVELS[0]).label;
  r.lang_score_raw = d.lang_score_raw || '';
  r.lang_has = r.lang_points > 0 ? '有外語能力' : '無外語能力';

  r.yrs_construction = d.yrs_construction || '';
  r.yrs_plant = d.yrs_plant || '';
  r.yrs_other = d.yrs_other || '';
  const yt = _num(d.yrs_total);
  r.yrs_total = isNaN(yt) ? '' : yt;
  r.yrs_band = _yrsBand(yt);

  r.job_category = d.job_category_other ? ('其他：' + d.job_category_other) : (d.job_category || '');
  r.industry_sub = d.industry_sub || '';
  r.job_title = d.job_title || '';
  r.is_dedicated = d.is_dedicated || '';
  r.subordinates = d.subordinates || '';
  r.company_size = d.company_size || '';
  r.work_city = d.work_city || '';
  r.work_region = REGION_MAP[r.work_city] || '其他';
  r.job_contents = _arr(d.job_contents).join('｜');
  r.shift_type = d.shift_type || '';

  // 加班時數換算
  r.ot_mode = d.ot_mode || '每月';
  const otIn = _num(d.ot_hours_input);
  const wd = _num(d.ot_workdays);
  r.ot_hours_input = isNaN(otIn) ? '' : otIn;
  r.ot_workdays = (r.ot_mode === '每日') ? (isNaN(wd) ? 22 : wd) : '';
  if (isNaN(otIn)) {
    r.ot_monthly = '';
  } else if (r.ot_mode === '每日') {
    r.ot_monthly = Math.round(otIn * (isNaN(wd) ? 22 : wd) * 10) / 10;
  } else {
    r.ot_monthly = Math.round(otIn * 10) / 10;
  }
  r.ot_pay_type = d.ot_pay_type || '';

  const monthly = _num(d.monthly_salary);
  const bonus = _num(d.annual_bonus);
  const annual = _num(d.annual_total);
  r.monthly_salary = monthly;
  r.annual_bonus = isNaN(bonus) ? 0 : bonus;
  r.annual_total = annual;
  r.bonus_months = (monthly > 0 && r.annual_bonus > 0) ? Math.round(r.annual_bonus / monthly * 10) / 10 : 0;
  r.raise_last_year = d.raise_last_year || '';
  r.benefits = _arr(d.benefits).join('｜');
  const leave = _num(d.annual_leave_days);
  r.annual_leave_days = isNaN(leave) ? '' : leave;

  r.prev_job = d.prev_job || '';
  r.salary_change = d.salary_change || '';
  r.salary_change_pct = d.salary_change_pct || '';
  r.satisfaction = d.satisfaction || '';
  r.job_seeking = d.job_seeking || '';
  r.suggestion = String(d.suggestion || '').slice(0, 2000);

  const o = _checkOutlier(monthly, r.annual_bonus, annual, r.ot_monthly);
  r.outlier = o.isOutlier ? 'Y' : '';
  r.outlier_reason = o.reason;

  r.joined_draw = d.email ? 'Y' : '';   // 只記是否參加，不記信箱
  r.client_token = String(d.client_token || '').slice(0, 40);
  r.source = String(d.source || 'web').slice(0, 40);
  return r;
}

// 薪資異常 → 整筆排除於薪資統計之外
// 加班異常 → 只排除於加班統計，薪資資料仍然有效（兩者不該互相牽連）
function _checkOutlier(monthly, bonus, annual, otMonthly) {
  const reasons = [];
  if (monthly < OUTLIER.monthlyMin || monthly > OUTLIER.monthlyMax) reasons.push('月薪超出合理區間');
  if (annual < OUTLIER.annualMin || annual > OUTLIER.annualMax) reasons.push('年收入超出合理區間');
  if (annual > 0 && monthly > 0 && annual < monthly * 6) reasons.push('年收入與月薪明顯矛盾');
  if (bonus > annual) reasons.push('年終大於年收入');
  if (monthly > 0 && bonus > monthly * OUTLIER.bonusMonthsMax) {
    reasons.push('年終相當於 ' + (Math.round(bonus / monthly * 10) / 10) +
      ' 個月月薪，疑似多打一個 0');
  }
  if (monthly > 0 && annual > monthly * OUTLIER.annualMonthsMax) {
    reasons.push('年收入相當於 ' + (Math.round(annual / monthly * 10) / 10) +
      ' 個月月薪，與月薪不相稱');
  }
  const isOutlier = reasons.length > 0;
  if (otMonthly !== '' && Number(otMonthly) > OUTLIER.otMax) reasons.push('加班時數異常（僅排除於加班統計）');
  return { isOutlier: isOutlier, reason: reasons.join('；') };
}


// ══════════════════════════════════
// 百分位回饋
// ══════════════════════════════════
function _percentileReport(row) {
  const rows = _readResponses();
  const clean = rows.filter(function (r) { return !r.outlier; });

  // 樣本不足時完全不回傳任何統計數字，連百分位都不算
  if (clean.length < MIN_PUBLIC_N) {
    return { locked: true, totalN: clean.length, minPublicN: MIN_PUBLIC_N };
  }

  function block(label, subset) {
    const annual = subset.map(function (r) { return r.annual_total; }).filter(_pos);
    const monthly = subset.map(function (r) { return r.monthly_salary; }).filter(_pos);
    return {
      label: label,
      n: subset.length,
      annualPct: _pctRank(annual, row.annual_total),
      annualMedian: _median(annual),
      monthlyPct: _pctRank(monthly, row.monthly_salary),
      monthlyMedian: _median(monthly)
    };
  }

  const all = block('全體填答者', clean);
  function same(label, key) {
    // 自填的「其他：…」也要併在一起，不然這個人的同組永遠只有自己一個
    const mine = _mergeOther(row[key]);
    return block('同' + label + '（' + mine + '）',
      clean.filter(function (r) { return _mergeOther(r[key]) === mine; }));
  }
  const groups = [
    same('行業', 'job_category'),
    same('年資', 'yrs_band'),
    same('區域', 'work_region'),
    same('學歷', 'education'),
    same('證照', 'osh_license_top'),
    same('外語能力', 'lang_level')
  ];

  const annualAll = clean.map(function (r) { return r.annual_total; }).filter(_pos);
  return {
    totalN: clean.length,
    yourAnnual: row.annual_total,
    yourMonthly: row.monthly_salary,
    yourBonus: row.annual_bonus,
    overall: all,
    groups: groups,
    distribution: _histogram(annualAll, row.annual_total),
    quartiles: {
      p25: _percentile(annualAll, 25),
      p50: _percentile(annualAll, 50),
      p75: _percentile(annualAll, 75),
      p90: _percentile(annualAll, 90)
    },
    minSampleHint: 10
  };
}

// 百分位名次：(低於我的 + 0.5 × 與我相同) / 總數
function _pctRank(arr, value) {
  if (!arr.length) return null;
  let below = 0, equal = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < value) below++;
    else if (arr[i] === value) equal++;
  }
  return Math.round((below + 0.5 * equal) / arr.length * 1000) / 10;
}

function _histogram(arr, mark) {
  if (!arr.length) return { bins: [], markIndex: -1 };
  const edges = [0, 500000, 600000, 700000, 800000, 900000, 1000000, 1200000, 1500000, 2000000, Infinity];
  const labels = ['<50萬', '50–60萬', '60–70萬', '70–80萬', '80–90萬', '90–100萬', '100–120萬', '120–150萬', '150–200萬', '200萬+'];
  const bins = labels.map(function (l) { return { label: l, count: 0 }; });
  let markIndex = -1;
  arr.forEach(function (v) {
    for (let i = 0; i < labels.length; i++) {
      if (v >= edges[i] && v < edges[i + 1]) { bins[i].count++; break; }
    }
  });
  for (let i = 0; i < labels.length; i++) {
    if (mark >= edges[i] && mark < edges[i + 1]) { markIndex = i; break; }
  }
  return { bins: bins, markIndex: markIndex };
}


// ══════════════════════════════════
// 分析報告統計
// ══════════════════════════════════
// 報告的統計值分成兩路：
//  ① 固定區塊（樣本結構、整體箱型圖、分析結論）在這裡算好送出去；
//  ② 熱力圖點格子、自訂條件篩選這種「任意子集合」，前端自己算 —— 所以會附一份
//     編碼後的逐列資料 micro：每個類別欄位轉成字典索引，整份壓成一個字串（約 20KB）。
//     裡面只有分組用的級距欄位與薪資數字，沒有 Email／電話／自填文字，也沒有時間戳，
//     單獨一列無法對應到任何人。
const CACHE_KEY_MICRO = 'salary_micro_v2';
const MIN_CELL_N = 5;          // 子集合要列出逐列資料的最低樣本數

// OSH_LADDER / LANG_LEVELS 宣告在本檔更後面，常數初始化會踩到 TDZ，所以用函式延後取值
function _microDims() {
  const EDU   = ['高中職', '專科（二專／五專）', '四技二專', '大學', '碩士', '博士'];
  const SIZE  = ['50 人以下', '51-200 人', '201-500 人', '501-1000 人', '1001-5000 人', '5000 人以上'];
  const TITLE = ['專員／工程師', '資深專員／資深工程師', '組長／副課長', '課長／經理',
                 '副理／協理以上', '顧問／技師', '其他'];
  return [
    { key: 'cat',    field: 'job_category',     label: '行業別',   order: null,   ord: false },
    { key: 'yrs',    field: 'yrs_band',         label: '年資',     order: YRS_BANDS, ord: true },
    { key: 'edu',    field: 'education',        label: '學歷',     order: EDU,    ord: true },
    { key: 'lic',    field: 'osh_license_top',  label: '職安證照', order: OSH_LADDER.slice().reverse(), ord: true },
    { key: 'intl',   field: 'intl_license_has', label: '國際證照', order: ['無國際證照', '有國際證照'], ord: false },
    { key: 'lang',   field: 'lang_level',       label: '外語能力', order: LANG_LEVELS.map(function (l) { return l.label; }), ord: true },
    { key: 'region', field: 'work_region',      label: '工作區域', order: ['北部', '中部', '南部', '東部', '離島', '海外'], ord: false },
    { key: 'size',   field: 'company_size',     label: '公司規模', order: SIZE,   ord: true },
    { key: 'title',  field: 'job_title',        label: '職稱職級', order: TITLE,  ord: true },
    { key: 'age',    field: 'age_band',         label: '年齡',     order: AGE_BANDS, ord: true },
    { key: 'ded',    field: 'is_dedicated',     label: '職安專責', order: ['是', '否'], ord: false }
  ];
}

function _buildMicro(clean) {
  const dims = _microDims();
  const vals = dims.map(function (d) { return d.order ? d.order.slice() : []; });
  const cnt = dims.map(function () { return {}; });

  clean.forEach(function (r) {
    dims.forEach(function (d, i) {
      const v = _mergeOther(r[d.field]);
      if (vals[i].indexOf(v) < 0) vals[i].push(v);
      cnt[i][v] = (cnt[i][v] || 0) + 1;
    });
  });
  // 沒有既定順序的維度（行業別等）依人數多寡排，「其他」「未填」固定壓到最後，
  // 這樣顏色槽位不會因為一筆新回覆就整排換色
  dims.forEach(function (d, i) {
    if (d.order) return;
    vals[i].sort(function (a, b) {
      const ra = (a === '未填' ? 2 : a === '其他' ? 1 : 0);
      const rb = (b === '未填' ? 2 : b === '其他' ? 1 : 0);
      if (ra !== rb) return ra - rb;
      return (cnt[i][b] || 0) - (cnt[i][a] || 0);
    });
  });

  const rows = clean.map(function (r) {
    const c = dims.map(function (d, i) { return vals[i].indexOf(_mergeOther(r[d.field])); });
    c.push(_pos(r.monthly_salary) ? Math.round(r.monthly_salary) : '');
    c.push((typeof r.annual_bonus === 'number' && !isNaN(r.annual_bonus) && r.annual_bonus >= 0)
            ? Math.round(r.annual_bonus) : '');
    c.push(_pos(r.annual_total) ? Math.round(r.annual_total) : '');
    c.push((_pos(r.ot_monthly) && r.ot_monthly <= OUTLIER.otMax) ? Math.round(r.ot_monthly) : '');
    return c.join(',');
  });

  return {
    dims: dims.map(function (d, i) {
      return { key: d.key, label: d.label, ord: d.ord, values: vals[i],
               counts: vals[i].map(function (v) { return cnt[i][v] || 0; }) };
    }),
    cols: ['m', 'b', 'a', 'ot'],
    minCellN: MIN_CELL_N,
    rows: rows.join(';')
  };
}

function apiStats(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    try {
      const hit = cache.get(CACHE_KEY);
      if (hit) {
        const o = JSON.parse(hit);
        if (o && o.micro) {
          o.micro.rows = cache.get(CACHE_KEY_MICRO) || '';
          if (!o.micro.rows) throw new Error('micro cache miss');
        }
        return o;
      }
    } catch (e) {}
  }
  const rows = _readResponses();
  const clean = rows.filter(function (r) { return !r.outlier; });

  // 樣本未達門檻，報告整份不開放
  if (clean.length < MIN_PUBLIC_N) {
    const gated = {
      locked: true, total: clean.length, minPublicN: MIN_PUBLIC_N,
      deadline: _toRoc(SURVEY_END),
      generatedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm')
    };
    try { cache.put(CACHE_KEY, JSON.stringify(gated), CACHE_SEC); } catch (e) {}
    return gated;
  }

  const stats = {
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm'),
    surveyTitle: SURVEY_TITLE,
    deadline: _toRoc(SURVEY_END),
    year: SURVEY_YEAR,
    totalRaw: rows.length,
    total: clean.length,
    excluded: rows.length - clean.length,
    minPublicN: MIN_PUBLIC_N,
    profile: [],
    salary: {}
  };

  // ── 回收儀表（近 21 天；匯入的舊資料時間戳是 2023，不會落在區間內）──
  const keyDay = function (d) { return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd'); };
  const byDay = {};
  rows.forEach(function (r) {
    if (!(r.timestamp instanceof Date)) return;
    const k = keyDay(r.timestamp);
    byDay[k] = (byDay[k] || 0) + 1;
  });
  const days = [];
  for (let i = 20; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    days.push({ label: Utilities.formatDate(d, 'Asia/Taipei', 'MM/dd'), count: byDay[keyDay(d)] || 0 });
  }
  stats.intake = {
    total: rows.length,
    valid: clean.length,
    excluded: rows.length - clean.length,
    minPublicN: MIN_PUBLIC_N,
    weekCount: days.slice(-7).reduce(function (a, b) { return a + b.count; }, 0),
    legacyN: clean.filter(function (r) { return String(r.source) === LEGACY_TAG; }).length,
    legacyTag: LEGACY_TAG,
    days: days,
    startRoc: _toRoc(SURVEY_START),
    open: _isOpen()
  };

  // ── 樣本結構（每個維度一條百分比堆疊長條）──
  const EDU_ORDER = ['高中職', '專科（二專／五專）', '四技二專', '大學', '碩士', '博士'];
  const profileDims = [
    ['yrs_band',         '年資',             YRS_BANDS],
    ['age_band',         '年齡',             AGE_BANDS],
    ['education',        '最高學歷',         EDU_ORDER],
    ['osh_license_top',  '職安證照（最高等級）', OSH_LADDER.slice().reverse()],
    ['job_category',     '行業別',           null],
    ['work_region',      '工作區域',         ['北部', '中部', '南部', '東部', '離島', '海外']],
    ['company_size',     '公司規模',         ['50 人以下', '51-200 人', '201-500 人', '501-1000 人', '1001-5000 人', '5000 人以上']],
    ['job_title',        '職稱／職級',       ['專員／工程師', '資深專員／資深工程師', '組長／副課長', '課長／經理', '副理／協理以上', '顧問／技師', '其他']],
    ['subordinates',     '直接管理的部屬',   ['無', '1-3 人', '4-10 人', '10 人以上']],
    ['is_dedicated',     '是否職安專責',     ['是', '否']],
    ['shift_type',       '工作型態',         ['常日班', '輪班（兩班制）', '輪班（三班制）', '國內長期駐點', '長期駐外（國外）']],
    ['lang_level',       '外語能力',         LANG_LEVELS.map(function (l) { return l.label; })],
    ['intl_license_has', '國際職安證照',     ['有國際證照', '無國際證照']],
    ['other_license_has', '其他證照',        ['有', '無']],
    ['skill_has',        '其他專業能力',     ['有', '無']],
    ['ot_pay_type',      '加班費給付方式',   ['核實全額給付', '部分給付（有上限）', '折換補休', '定額加班費（包月）', '責任制／不給付']],
    ['raise_last_year',  '近一年調薪幅度',   ['減薪', '未調薪', '1-3%', '3-5%', '5-10%', '10% 以上']],
    ['satisfaction',     '工作滿意度（1～5）', ['1', '2', '3', '4', '5']],
    ['job_seeking',      '未來一年轉職打算', ['沒有', '觀望中', '積極尋找中', '已有 offer']]
  ];
  stats.profile = profileDims.map(function (d) {
    return { key: d[0], title: d[1], ord: !!d[2], rows: _countBy(clean, d[0], d[2]) };
  });

  // ── 複選題 ──
  stats.multi = [
    { key: 'job_contents',   title: '現職工作內容', rows: _countByMulti(clean, 'job_contents') },
    { key: 'benefits',       title: '公司提供的福利', rows: _countByMulti(clean, 'benefits') },
    { key: 'skills',         title: '其他專業能力', rows: _countByMulti(clean, 'skills') },
    { key: 'other_licenses', title: '其他證照',     rows: _countByMulti(clean, 'other_licenses') },
    { key: 'intl_licenses',  title: '國際職安證照', rows: _countByMulti(clean, 'intl_licenses') }
  ];

  // ── 薪資與工時 ──
  stats.salary.overall = _salaryStat(clean);
  stats.overtime = _numericStat(
    clean.map(function (r) { return r.ot_monthly; })
         .filter(function (v) { return _pos(v) && v <= OUTLIER.otMax; }));
  stats.leave = _numericStat(
    clean.map(function (r) { return _num(r.annual_leave_days); })
         .filter(function (v) { return !isNaN(v) && v >= 0 && v <= 60; }));

  // ── 逐列匿名資料（前端自己算子集合用）──
  stats.micro = _buildMicro(clean);

  // ── 分析結論 ──
  stats.analysis = _buildAnalysis(clean);

  try {
    const rowsStr = stats.micro.rows;
    stats.micro.rows = '';
    cache.put(CACHE_KEY, JSON.stringify(stats), CACHE_SEC);
    cache.put(CACHE_KEY_MICRO, rowsStr, CACHE_SEC);
    stats.micro.rows = rowsStr;
  } catch (e) {}
  return stats;
}

function _salaryStat(subset) {
  return {
    n: subset.length,
    monthly: _numericStat(subset.map(function (r) { return r.monthly_salary; }).filter(_pos)),
    bonus:   _numericStat(subset.map(function (r) { return r.annual_bonus; }).filter(function (v) { return v >= 0 && v !== '' && !isNaN(v); })),
    annual:  _numericStat(subset.map(function (r) { return r.annual_total; }).filter(_pos))
  };
}

function _groupSalary(rows, key, order) {
  const map = {};
  rows.forEach(function (r) {
    const k = _mergeOther(r[key]);
    if (!map[k]) map[k] = [];
    map[k].push(r);
  });
  let keys = Object.keys(map);
  if (order) {
    keys.sort(function (a, b) {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  } else {
    keys.sort(function (a, b) { return map[b].length - map[a].length; });
  }
  return keys.map(function (k) {
    const s = _salaryStat(map[k]);
    s.label = k;
    return s;
  });
}

// 空集合一律回 null（後台的 bxBar、排行榜都靠 median !== null 判空，不能改成 0）。
// 注意前端經 google.script.run 取回時 null 會變 undefined，判空要用 Number(v) > 0。
function _numericStat(arr) {
  if (!arr.length) {
    return { n: 0, min: null, max: null, mean: null, median: null,
             p25: null, p75: null, p10: null, p90: null, sd: null };
  }
  const s = arr.slice().sort(function (a, b) { return a - b; });
  const sum = s.reduce(function (a, b) { return a + b; }, 0);
  const mean = sum / s.length;
  let v = 0;
  s.forEach(function (x) { v += (x - mean) * (x - mean); });
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    mean: Math.round(mean),
    median: Math.round(_median(s)),
    p25: Math.round(_percentile(s, 25)),
    p75: Math.round(_percentile(s, 75)),
    p10: Math.round(_percentile(s, 10)),
    p90: Math.round(_percentile(s, 90)),
    sd: Math.round(Math.sqrt(s.length > 1 ? v / (s.length - 1) : 0))
  };
}

// 自填的「其他：顧問業」「其他：環保公司」… 在統計上要全部併成一條「其他」，
// 否則每個人自己寫的字都會變成一個只有 1 筆的分類。原始文字仍完整保留在試算表裡。
function _mergeOther(v) {
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return '未填';
  return /^其他[：:]/.test(t) ? '其他' : t;
}

function _countBy(rows, key, order) {
  const map = {};
  rows.forEach(function (r) {
    const k = _mergeOther(r[key]);
    map[k] = (map[k] || 0) + 1;
  });
  const total = rows.length || 1;
  const out = Object.keys(map).map(function (k) {
    return { label: k, count: map[k], pct: Math.round(map[k] / total * 1000) / 10 };
  });
  if (order) {
    out.sort(function (a, b) {
      const ra = (a.label === '未填' ? 2 : a.label === '其他' ? 1 : 0);
      const rb = (b.label === '未填' ? 2 : b.label === '其他' ? 1 : 0);
      if (ra !== rb) return ra - rb;
      const ia = order.indexOf(a.label), ib = order.indexOf(b.label);
      return (ia < 0 ? 998 : ia) - (ib < 0 ? 998 : ib);
    });
  } else {
    out.sort(function (a, b) {
      const ra = (a.label === '未填' ? 2 : a.label === '其他' ? 1 : 0);
      const rb = (b.label === '未填' ? 2 : b.label === '其他' ? 1 : 0);
      if (ra !== rb) return ra - rb;
      return b.count - a.count;
    });
  }
  return out;
}

function _countByMulti(rows, key) {
  const map = {};
  rows.forEach(function (r) {
    String(r[key] || '').split('｜').forEach(function (v) {
      v = _mergeOther(v.trim());
      if (!v || v === '未填') return;
      map[v] = (map[v] || 0) + 1;
    });
  });
  const total = rows.length || 1;
  return Object.keys(map)
    .map(function (k) { return { label: k, count: map[k], pct: Math.round(map[k] / total * 1000) / 10 }; })
    .sort(function (a, b) { return b.count - a.count; });
}


// ══════════════════════════════════
// 分析結論（規則式，但算的是真的統計量）
// ══════════════════════════════════
// 設計原則：
//  1. 不重複報表上已經有的數字，只講「看表看不出來的事」。
//  2. 比較一律附樣本數；組間差距先算「解釋力」再排名，而不是挑最大的差距來講。
//  3. 凡是會被年資混淆的比較（學歷、證照、外語…），都再給一次「同年資帶內」的差距。
function _buildAnalysis(clean) {
  const A = clean.filter(function (r) { return _pos(r.annual_total); });
  const med = function (set) { return set.length ? _median(set) : null; };
  const medOf = function (set, f) {
    return med(set.map(function (r) { return r[f]; }).filter(_pos));
  };
  const pctOf = function (a, b) { return (b > 0) ? Math.round((a - b) / b * 1000) / 10 : null; };

  const monthly = _numericStat(clean.map(function (r) { return r.monthly_salary; }).filter(_pos));
  const annual  = _numericStat(clean.map(function (r) { return r.annual_total; }).filter(_pos));
  const bonusArr = clean.map(function (r) { return r.annual_bonus; })
                        .filter(function (v) { return typeof v === 'number' && !isNaN(v) && v >= 0; });
  const bonus = _numericStat(bonusArr);

  // ── 收入組成：年收入 ÷ 月薪 等於幾個月 ──
  const paired = clean.filter(function (r) { return _pos(r.monthly_salary) && _pos(r.annual_total); });
  const effMonths = med(paired.map(function (r) { return r.annual_total / r.monthly_salary; }));
  const bonusShare = med(clean.filter(function (r) { return _pos(r.annual_total) && _pos(r.annual_bonus); })
                              .map(function (r) { return r.annual_bonus / r.annual_total * 100; }));
  const noBonus = bonusArr.length ? bonusArr.filter(function (v) { return v === 0; }).length / bonusArr.length * 100 : 0;

  // ── 解釋力：對數年收入的組間變異占比，並校正組數（ε²）──
  // 「未填」和「其他」都不是真的分類（後者是各種自填答案的混合），
  // 放進組間變異只會製造一個內部極度分散的假組別，解釋力會被低估
  const realCat = function (v) { return v !== '未填' && v !== '其他'; };

  function explain(field) {
    const g = {};
    A.forEach(function (r) {
      const k = _mergeOther(r[field]);
      if (!realCat(k)) return;
      (g[k] = g[k] || []).push(Math.log(r.annual_total));
    });
    const keys = Object.keys(g).filter(function (k) { return g[k].length >= MIN_CELL_N; });
    if (keys.length < 2) return null;
    let all = [];
    keys.forEach(function (k) { all = all.concat(g[k]); });
    const N = all.length;
    if (N < 30) return null;
    const gm = all.reduce(function (a, b) { return a + b; }, 0) / N;
    let ssT = 0;
    all.forEach(function (v) { ssT += (v - gm) * (v - gm); });
    if (!(ssT > 0)) return null;
    let ssB = 0;
    keys.forEach(function (k) {
      const m = g[k].reduce(function (a, b) { return a + b; }, 0) / g[k].length;
      ssB += g[k].length * (m - gm) * (m - gm);
    });
    const k = keys.length;
    const msW = (N - k) > 0 ? (ssT - ssB) / (N - k) : 0;
    const eps = (ssB - (k - 1) * msW) / ssT * 100;   // ε²：扣掉「組數多本來就會比較高」的部分
    return { eta: Math.round(ssB / ssT * 1000) / 10,
             eps: Math.round(Math.max(0, eps) * 10) / 10,
             k: k, n: N, groups: keys };
  }

  // ── 控制年資後的差距：在每個年資帶內各比一次，再以兩組較小的 n 加權平均 ──
  function ctrlGap(field, hiVals, loVals) {
    const pick = function (vals) {
      return A.filter(function (r) { return vals.indexOf(_mergeOther(r[field])) >= 0; });
    };
    const hi = pick(hiVals), lo = pick(loVals);
    if (hi.length < MIN_CELL_N || lo.length < MIN_CELL_N) return null;
    const mh = medOf(hi, 'annual_total'), ml = medOf(lo, 'annual_total');
    const bands = [];
    let acc = 0, w = 0;
    YRS_BANDS.forEach(function (b) {
      const h = hi.filter(function (r) { return r.yrs_band === b; });
      const l = lo.filter(function (r) { return r.yrs_band === b; });
      if (h.length < 3 || l.length < 3) return;
      const a = medOf(h, 'annual_total'), c = medOf(l, 'annual_total');
      if (!(a > 0) || !(c > 0)) return;
      const p = (a - c) / c * 100, ww = Math.min(h.length, l.length);
      bands.push({ band: b, nHi: h.length, nLo: l.length, pct: Math.round(p * 10) / 10 });
      acc += p * ww; w += ww;
    });
    return {
      nHi: hi.length, nLo: lo.length,
      medHi: Math.round(mh), medLo: Math.round(ml),
      rawPct: pctOf(mh, ml),
      adjPct: w ? Math.round(acc / w * 10) / 10 : null,
      bands: bands,
      coverage: w
    };
  }

  // ① 薪資驅動因子排名
  const driverDims = [
    ['yrs_band', '年資'], ['job_title', '職稱職級'], ['age_band', '年齡'],
    ['job_category', '行業別'], ['osh_license_top', '職安證照'], ['education', '學歷'],
    ['company_size', '公司規模'], ['work_region', '工作區域'], ['lang_level', '外語能力'],
    ['intl_license_has', '國際職安證照'], ['is_dedicated', '職安專責'], ['shift_type', '工作型態']
  ];
  const drivers = driverDims.map(function (d) {
    const e = explain(d[0]);
    if (!e) return null;
    const items = e.groups.map(function (k) {
      const sub = A.filter(function (r) { return _mergeOther(r[d[0]]) === k; });
      return { label: k, n: sub.length, median: Math.round(medOf(sub, 'annual_total')) };
    }).sort(function (a, b) { return b.median - a.median; });
    const hi = items[0], lo = items[items.length - 1];
    return {
      key: d[0], label: d[1], eta: e.eta, eps: e.eps, k: e.k, n: e.n,
      hi: hi, lo: lo, gap: hi.median - lo.median, gapPct: pctOf(hi.median, lo.median)
    };
  }).filter(Boolean).sort(function (a, b) { return b.eps - a.eps; });

  // ② 年資報酬曲線
  const curve = [];
  YRS_BANDS.forEach(function (b) {
    const sub = clean.filter(function (r) { return r.yrs_band === b; });
    if (sub.length < MIN_CELL_N) return;
    const a = medOf(sub, 'annual_total'), m = medOf(sub, 'monthly_salary');
    if (!(a > 0)) return;
    curve.push({ band: b, n: sub.length, annual: Math.round(a), monthly: m ? Math.round(m) : null });
  });
  const steps = [];
  for (let i = 1; i < curve.length; i++) {
    steps.push({
      from: curve[i - 1].band, to: curve[i].band,
      delta: curve[i].annual - curve[i - 1].annual,
      pct: pctOf(curve[i].annual, curve[i - 1].annual)
    });
  }
  const fastest = steps.slice().sort(function (a, b) { return b.pct - a.pct; })[0] || null;
  const slowest = steps.slice().sort(function (a, b) { return a.pct - b.pct; })[0] || null;

  // ③ 控制年資後仍站得住的溢酬
  const premiumDefs = [
    ['國際職安證照', 'intl_license_has', ['有國際證照'], ['無國際證照'],
     'NEBOSH／IOSH／CSP 等國際證照持有者，與沒有國際證照者比較'],
    ['甲級管理師 vs 乙級管理員', 'osh_license_top', ['甲級管理師'], ['乙級管理員'],
     '同樣是本國證照，升一級值多少'],
    ['碩士 vs 大學', 'education', ['碩士', '博士'], ['大學'],
     '研究所學歷相對於大學畢業'],
    ['有外語檢定 vs 無', 'lang_has', ['有外語能力'], ['無外語能力'],
     '有任何一張語言檢定成績，相對於完全沒有'],
    ['北部 vs 中南部', 'work_region', ['北部'], ['中部', '南部'],
     '工作地在北部，相對於中部或南部'],
    ['外商 vs 本土製造／營造', 'job_category', ['外商'], ['廠工安', '營造業', '傳產'],
     '外商相對於本土的廠工安、營造、傳產'],
    ['職安專責 vs 兼辦', 'is_dedicated', ['是'], ['否'],
     '專責職安人員，相對於兼辦其他職務者']
  ];
  const premiums = premiumDefs.map(function (p) {
    const g = ctrlGap(p[1], p[2], p[3]);
    if (!g) return null;
    g.label = p[0]; g.lead = p[4];
    // 控制年資後還剩多少：原始差距有多大比例是年資造成的
    g.shrink = (g.rawPct && g.adjPct !== null)
      ? Math.round((1 - g.adjPct / g.rawPct) * 1000) / 10 : null;
    g.verdict = (g.adjPct === null) ? 'thin'
      : (g.adjPct >= 10 && g.rawPct >= 10) ? 'solid'
      : (g.adjPct >= 3) ? 'mild'
      : (g.adjPct <= -3) ? 'reverse' : 'flat';
    return g;
  }).filter(Boolean).sort(function (a, b) { return (b.adjPct || 0) - (a.adjPct || 0); });

  // ④ 同一群人裡面的離散度（IQR 占中位數比例）：挑樣本夠的行業與年資帶
  function spreadOf(field, minN) {
    const g = {};
    A.forEach(function (r) {
      const k = _mergeOther(r[field]);
      if (!realCat(k)) return;
      (g[k] = g[k] || []).push(r.annual_total);
    });
    return Object.keys(g).filter(function (k) { return g[k].length >= minN; })
      .map(function (k) {
        const s = _numericStat(g[k]);
        return { label: k, n: s.n, median: s.median, iqr: s.p75 - s.p25,
                 iqrPct: s.median ? Math.round((s.p75 - s.p25) / s.median * 1000) / 10 : 0,
                 p25: s.p25, p75: s.p75, p90: s.p90 };
      }).sort(function (a, b) { return b.iqrPct - a.iqrPct; });
  }
  const spreadCat = spreadOf('job_category', 20);

  // ⑤ 談判參考階梯
  const ladder = [];
  YRS_BANDS.forEach(function (b) {
    const sub = clean.filter(function (r) { return r.yrs_band === b; });
    if (sub.length < MIN_CELL_N) return;
    const m = _numericStat(sub.map(function (r) { return r.monthly_salary; }).filter(_pos));
    const a = _numericStat(sub.map(function (r) { return r.annual_total; }).filter(_pos));
    ladder.push({ band: b, n: sub.length, monthly: m, annual: a });
  });

  // ⑥ 執行摘要：只講上面算出來、而且看表看不出來的事
  const summary = [];
  summary.push('本次有效樣本 ' + clean.length + ' 份，' + SURVEY_YEAR + ' 年度本業總收入中位數 ' +
    _wan(annual.median) + '，中間一半的人落在 ' + _wan(annual.p25) + '～' + _wan(annual.p75) +
    '；月薪中位數 ' + _wan(monthly.median) + '。最低的一成在 ' + _wan(annual.p10) +
    ' 以下，最高的一成在 ' + _wan(annual.p90) + ' 以上 —— 同一個職類裡，前一成與後一成之間差了 ' +
    (annual.p10 ? Math.round(annual.p90 / annual.p10 * 10) / 10 : '—') + ' 倍。');

  if (effMonths) {
    summary.push('年收入中位數相當於月薪的 ' + (Math.round(effMonths * 10) / 10) +
      ' 個月，也就是說本業收入裡約 ' + Math.round((1 - 12 / effMonths) * 100) +
      '% 不是靠月薪，而是年終與加班。年終中位數 ' + _wan(bonus.median) +
      '，占年收入約 ' + Math.round(bonusShare) + '%；其中 ' + Math.round(noBonus) +
      '% 的人填 0 元年終 —— 談薪水只看月薪會失真，要連年終一起談。');
  }

  if (drivers.length >= 3) {
    const top = drivers[0], second = drivers[1];
    const eduD = drivers.filter(function (d) { return d.key === 'education'; })[0];
    summary.push('把所有可觀察條件拿來比「對年收入的解釋力」，最強的是' + top.label +
      '（解釋 ' + top.eps + '% 的收入差異），其次是' + second.label + '（' + second.eps + '%）' +
      (eduD ? '；學歷只解釋 ' + eduD.eps + '%' : '') +
      '。反過來說，就算條件完全對上，最強的單一條件也只能解釋 ' + top.eps + '%，' +
      '剩下 ' + Math.round(100 - top.eps) + '% 的收入差異來自這份問卷量不到的東西 —— ' +
      '公司給薪政策、談判結果、個別運氣，所以任何一條「某某條件月薪就該多少」的說法都該打折看。');
  }

  const solid = premiums.filter(function (p) { return p.verdict === 'solid'; });
  if (solid.length) {
    summary.push('把年資固定在同一個級距後再比，仍然站得住的加給是：' +
      solid.slice(0, 3).map(function (p) { return p.label + ' +' + p.adjPct + '%'; }).join('、') +
      '。這類條件是少數「不必等年資」就能拉開差距的籌碼。');
  }
  const washed = premiums.filter(function (p) { return p.shrink !== null && p.shrink >= 50 && p.rawPct >= 8; });
  if (washed.length) {
    summary.push('相反地，' + washed.slice(0, 2).map(function (p) {
      return p.label + '（原始差距 +' + p.rawPct + '%，同年資帶內只剩 ' +
        (p.adjPct >= 0 ? '+' : '') + p.adjPct + '%）';
    }).join('、') + ' 的差距大半是年資造成的 —— 表面上的領先其實是「資深的人剛好集中在那一組」。');
  }
  if (spreadCat.length >= 2) {
    summary.push('收入最不可預測的是' + spreadCat[0].label + '：中間一半的人就橫跨 ' +
      _wan(spreadCat[0].iqr) + '（占中位數 ' + spreadCat[0].iqrPct + '%），' +
      '最穩定的是' + spreadCat[spreadCat.length - 1].label + '（' + spreadCat[spreadCat.length - 1].iqrPct +
      '%）。進前者要把「談到多少」當成主要變數，進後者則是「行情大致就那樣」。');
  }

  // ⑦ 資料限制：誠實寫，不要寫成免責聲明
  const caveats = [];
  caveats.push('這是自願填答的網路樣本，不是隨機抽樣。願意花十分鐘填薪資問卷的人，' +
    '通常比平均更在意薪資行情、也更可能是中高年資者，推論到全體職安人員時請保留餘裕。');
  if (annual.n < clean.length) {
    caveats.push('有效樣本 ' + clean.length + ' 份中，' + annual.n + ' 份填了可用的年收入、' +
      monthly.n + ' 份填了可用的月薪，各統計值的 n 不一定相同，每張圖下方都標了自己的 n。');
  }
  const legacy = clean.filter(function (r) { return String(r.source) === LEGACY_TAG; }).length;
  if (legacy) {
    caveats.push('其中 ' + legacy + ' 份來自 2023 年舊調查匯入，問的是 2022 年度收入，' +
      '會把中位數往下拉。若要看純 ' + SURVEY_YEAR + ' 年度的數字，請以本次新回覆為準。');
  }
  caveats.push('交叉分析的格子一旦樣本少於 ' + MIN_CELL_N +
    ' 筆就不顯示數字；n 在 10 以下的組別，任何一筆極端值都會明顯移動中位數，報告中一律標了 n，請連著看。');
  caveats.push('這是同一時間點的橫斷面資料，所有「差距」都只是相關，不是因果。' +
    '「考到甲級證照會加薪 X%」這種結論，本調查無法證明 —— 它只能說「持有甲級的人目前中位數高 X%」。');

  return {
    n: clean.length, year: SURVEY_YEAR,
    monthly: monthly, annual: annual, bonus: bonus,
    effMonths: effMonths ? Math.round(effMonths * 10) / 10 : null,
    bonusShare: bonusShare ? Math.round(bonusShare * 10) / 10 : null,
    noBonusPct: Math.round(noBonus * 10) / 10,
    summary: summary,
    drivers: drivers,
    curve: { rows: curve, steps: steps, fastest: fastest, slowest: slowest },
    premiums: premiums,
    spread: spreadCat,
    ladder: ladder,
    caveats: caveats,
    minCellN: MIN_CELL_N
  };
}


// ══════════════════════════════════
// 讀取與工具
// ══════════════════════════════════
function _readResponses() {
  const sh = _ss().getSheetByName(SHEET_RESP);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = Math.min(RESP_HEADERS.length, sh.getMaxColumns());
  const values = sh.getRange(2, 1, last - 1, cols).getValues();
  return values.map(function (v) {
    const o = {};
    RESP_HEADERS.forEach(function (h, i) { o[h] = (i < cols) ? v[i] : ''; });
    o.monthly_salary = _num(o.monthly_salary);
    o.annual_bonus = _num(o.annual_bonus);
    o.annual_total = _num(o.annual_total);
    o.ot_monthly = _num(o.ot_monthly);
    o.outlier = String(o.outlier || '').toUpperCase() === 'Y';
    return o;
  }).filter(function (o) { return o.resp_id; });
}

function _countResponses() {
  const sh = _ss().getSheetByName(SHEET_RESP);
  if (!sh) return 0;
  return Math.max(0, sh.getLastRow() - 1);
}

function _num(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  const n = Number(String(v).replace(/[,\s$元]/g, ''));
  return isNaN(n) ? NaN : n;
}
function _pos(v) { return typeof v === 'number' && !isNaN(v) && v > 0; }

function _arr(v) {
  if (!v) return [];
  if (Object.prototype.toString.call(v) === '[object Array]') {
    return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
  }
  return String(v).split(/[｜|,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function _median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort(function (a, b) { return a - b; });
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 線性內插百分位（與 Excel PERCENTILE 一致）
function _percentile(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort(function (a, b) { return a - b; });
  if (s.length === 1) return s[0];
  const idx = (s.length - 1) * (p / 100);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function _ageBand(age) {
  if (!age || isNaN(age)) return '未填';
  if (age <= 25) return AGE_BANDS[0];
  if (age <= 30) return AGE_BANDS[1];
  if (age <= 35) return AGE_BANDS[2];
  if (age <= 40) return AGE_BANDS[3];
  if (age <= 45) return AGE_BANDS[4];
  if (age <= 50) return AGE_BANDS[5];
  return AGE_BANDS[6];
}

function _yrsBand(y) {
  if (y === '' || y === null || isNaN(y)) return '未填';
  if (y < 1) return YRS_BANDS[0];
  if (y < 3) return YRS_BANDS[1];
  if (y < 5) return YRS_BANDS[2];
  if (y < 10) return YRS_BANDS[3];
  if (y < 15) return YRS_BANDS[4];
  if (y < 20) return YRS_BANDS[5];
  return YRS_BANDS[6];
}

// 證照只取最高一級，國際證照排在最上面（不分種類，持有任一張就算一種）：
// 國際證照 › 甲級 › 乙級 › 甲種 › 乙種 › 丙種 › 丁種 › 無
const OSH_LADDER = ['國際證照', '甲級管理師', '乙級管理員', '甲種業務主管',
                    '乙種業務主管', '丙種業務主管', '丁種業務主管', '無'];

function _topOshLicense(list, intlList) {
  const intl = (intlList || []).filter(function (x) { return x && x !== '以上皆無'; });
  if (intl.length) return '國際證照';
  const s = (list || []).join('｜');
  if (/甲級/.test(s)) return '甲級管理師';
  if (/乙級/.test(s)) return '乙級管理員';
  if (/甲種/.test(s)) return '甲種業務主管';
  if (/乙種/.test(s)) return '乙種業務主管';
  if (/丙種/.test(s)) return '丙種業務主管';
  if (/丁種/.test(s)) return '丁種業務主管';
  return '無';
}

function _fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 「萬」為單位，跟後台的 wan() 同一套寫法：100 萬以上不留小數
function _wan(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
  const v = Number(n) / 10000;
  return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + '萬';
}


// ══════════════════════════════════
// 系統後台 API（?page=admin）
// 密碼存在 Script Properties 的 ADMIN_PW，預設 1234
// 密碼永遠在伺服器端比對，不會寫進網頁原始碼
// ══════════════════════════════════
const ADMIN_PW_DEFAULT = 'b7710182';

function _adminPw() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PW') || ADMIN_PW_DEFAULT;
}

// 修改後台密碼（在編輯器執行一次即可）
function setAdminPassword(pw) {
  PropertiesService.getScriptProperties().setProperty('ADMIN_PW', String(pw));
  return '後台密碼已更新';
}

function _auth(pw) {
  if (String(pw || '') !== _adminPw()) {
    Utilities.sleep(700);  // 稍微拖慢暴力嘗試
    throw new Error('密碼錯誤');
  }
}

function adminLogin(pw) {
  _auth(pw);
  _log('admin_login', '後台登入');
  return adminSummary(pw);
}

function adminSummary(pw) {
  _auth(pw);
  const ss = _ss();
  const resp = ss.getSheetByName(SHEET_RESP);
  const draw = ss.getSheetByName(SHEET_DRAW);
  const logs = ss.getSheetByName(SHEET_LOGS);
  const rows = _readResponses();
  const outliers = rows.filter(function (r) { return r.outlier; }).length;
  return {
    ok: true,
    sheetUrl: ss.getUrl(),
    responses: resp ? Math.max(0, resp.getLastRow() - 1) : 0,
    valid: rows.length - outliers,
    outliers: outliers,
    draws: draw ? Math.max(0, draw.getLastRow() - 1) : 0,
    logs: logs ? Math.max(0, logs.getLastRow() - 1) : 0,
    minPublicN: MIN_PUBLIC_N,
    unlocked: (rows.length - outliers) >= MIN_PUBLIC_N,
    surveyOpen: _isOpen(),
    deadline: _toRoc(SURVEY_END),
    drawWinners: DRAW_WINNERS,
    drawPrize: DRAW_PRIZE
  };
}

// 清空指定工作表的資料列（保留表頭）
function adminClear(pw, target) {
  _auth(pw);
  const ss = _ss();
  const map = { responses: SHEET_RESP, draws: SHEET_DRAW, logs: SHEET_LOGS };
  const names = (target === 'all') ? ['responses', 'draws', 'logs'] : [target];
  const done = [];
  names.forEach(function (k) {
    const name = map[k];
    if (!name) return;
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const n = sh.getLastRow() - 1;
    if (n > 0) sh.deleteRows(2, n);
    done.push(name + ' ' + Math.max(0, n) + ' 筆');
  });
  CacheService.getScriptCache().remove(CACHE_KEY);
  _log('admin_clear', '清除 ' + done.join('、'));
  const s = adminSummary(pw);
  s.message = '已清除：' + (done.length ? done.join('、') : '沒有可清除的資料');
  return s;
}

// 刪除單一回覆（用 resp_id）
function adminDeleteResponse(pw, respId) {
  _auth(pw);
  const sh = _ss().getSheetByName(SHEET_RESP);
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: '沒有資料' };
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(respId).trim()) {
      sh.deleteRow(i + 2);
      CacheService.getScriptCache().remove(CACHE_KEY);
      _log('admin_delete', '刪除回覆 ' + respId);
      const s = adminSummary(pw);
      s.message = '已刪除 ' + respId;
      return s;
    }
  }
  return { ok: false, error: '找不到 ' + respId };
}

// 列出回覆摘要（供後台挑選要刪的測試資料）
function adminListResponses(pw, limit) {
  _auth(pw);
  const rows = _readResponses();
  const n = limit || 50;
  return {
    ok: true,
    total: rows.length,
    rows: rows.slice(-n).reverse().map(function (r) {
      return {
        id: r.resp_id,
        time: r.timestamp instanceof Date
          ? Utilities.formatDate(r.timestamp, 'Asia/Taipei', 'MM-dd HH:mm') : String(r.timestamp),
        age: r.age, edu: r.education, yrs: r.yrs_total, cat: r.job_category,
        city: r.work_city, monthly: r.monthly_salary, annual: r.annual_total,
        outlier: r.outlier
      };
    })
  };
}

// 隨機抽獎
function adminDraw(pw, count) {
  _auth(pw);
  const sh = _ss().getSheetByName(SHEET_DRAW);
  if (!sh || sh.getLastRow() < 2) return { ok: false, error: '抽獎名單是空的' };
  const pool = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const n = Math.min(Math.max(1, Number(count) || DRAW_WINNERS), pool.length);
  const picked = pool.slice(0, n).map(function (p) {
    return { id: p[0], email: p[1], phone: p[2] || '', address: p[3] || '' };
  });
  _log('admin_draw', '抽出 ' + n + ' 位');
  return { ok: true, poolSize: pool.length, winners: picked };
}

// 列出所有被規則判為異常、或已被人工標記的資料，供後台逐筆決定要不要計入統計
function adminListOutliers(pw) {
  _auth(pw);
  const sh = _ss().getSheetByName(SHEET_RESP);
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, rows: [] };
  const values = sh.getRange(2, 1, last - 1, RESP_HEADERS.length).getValues();
  const idx = {};
  RESP_HEADERS.forEach(function (h, i) { idx[h] = i; });

  const out = [];
  values.forEach(function (v) {
    const flag = String(v[idx.outlier] || '').toUpperCase();
    const monthly = _num(v[idx.monthly_salary]);
    const bonus = _num(v[idx.annual_bonus]);
    const annual = _num(v[idx.annual_total]);
    const ot = _num(v[idx.ot_monthly]);
    const chk = _checkOutlier(monthly, bonus, annual, ot);
    if (!chk.isOutlier && flag !== 'N' && flag !== 'Y') return;   // 正常資料不列出
    out.push({
      id: v[idx.resp_id],
      included: flag === 'N',                 // 人工確認計入
      ruleFlag: chk.isOutlier,                // 規則判定異常
      reason: chk.reason || v[idx.outlier_reason] || '',
      monthly: monthly, bonus: bonus, annual: annual,
      ot: (ot === '' || isNaN(ot)) ? '' : ot,
      cat: v[idx.job_category], city: v[idx.work_city],
      yrs: v[idx.yrs_total], source: v[idx.source]
    });
  });
  return { ok: true, rows: out };
}

// 手動決定某一筆是否計入統計
//   include = true  → outlier 欄寫 'N'（人工確認計入）
//   include = false → 依規則重新判定（異常就是 'Y'）
// 後台：直接修正某一筆的金額（最常見的是年終多打一個 0）
function adminEditSalary(pw, respId, patch) {
  _auth(pw);
  const sh = _ss().getSheetByName(SHEET_RESP);
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: '沒有資料' };
  const idx = {};
  RESP_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() !== String(respId).trim()) continue;
    const r = i + 2;
    const row = sh.getRange(r, 1, 1, RESP_HEADERS.length).getValues()[0];
    const before = {
      monthly: _num(row[idx.monthly_salary]), bonus: _num(row[idx.annual_bonus]),
      annual: _num(row[idx.annual_total]), ot: _num(row[idx.ot_monthly])
    };

    // 只收這四個數字欄位，沒給或給空的就保留原值
    const pick = function (key, old) {
      if (!patch || patch[key] === undefined || patch[key] === null ||
          String(patch[key]).trim() === '') return old;
      const raw = String(patch[key]).replace(/[^0-9.\-]/g, '');
      if (raw === '' || raw === '-' || raw === '.') return old;   // 純文字不能變成 0
      const v = Number(raw);
      return (isNaN(v) || v < 0) ? old : Math.round(v);
    };
    const now = {
      monthly: pick('monthly', before.monthly), bonus: pick('bonus', before.bonus),
      annual: pick('annual', before.annual), ot: pick('ot', before.ot)
    };

    const changed = [];
    const LBL = { monthly: '月薪', bonus: '年終', annual: '年收入', ot: '加班時數' };
    ['monthly', 'bonus', 'annual', 'ot'].forEach(function (k) {
      if (String(now[k]) !== String(before[k])) {
        changed.push(LBL[k] + ' ' + (before[k] === '' ? '（空白）' : before[k]) +
          ' → ' + now[k]);
      }
    });
    if (!changed.length) return { ok: false, error: '沒有任何欄位被修改' };

    const chk = _checkOutlier(now.monthly, now.bonus, now.annual, now.ot);
    const keepIncluded = String(row[idx.outlier] || '').toUpperCase() === 'N';
    // 改完之後規則若判定正常，就讓它回到一般資料；仍異常則重新標記
    const flag = chk.isOutlier ? (keepIncluded ? 'N' : 'Y') : '';
    const reason = chk.isOutlier
      ? (keepIncluded ? '【人工確認計入】' : '') + chk.reason
      : '';

    sh.getRange(r, idx.monthly_salary + 1).setValue(now.monthly);
    sh.getRange(r, idx.annual_bonus + 1).setValue(now.bonus);
    sh.getRange(r, idx.annual_total + 1).setValue(now.annual);
    if (now.ot !== '') sh.getRange(r, idx.ot_monthly + 1).setValue(now.ot);
    sh.getRange(r, idx.outlier + 1).setValue(flag);
    sh.getRange(r, idx.outlier_reason + 1).setValue(reason);

    // 年終月數是衍生欄位，一起更新才不會跟新數字打架
    if (idx.bonus_months !== undefined && now.monthly > 0) {
      sh.getRange(r, idx.bonus_months + 1)
        .setValue(Math.round(now.bonus / now.monthly * 10) / 10);
    }

    CacheService.getScriptCache().remove(CACHE_KEY);
    _log('admin_edit', respId + ' 修正：' + changed.join('、'));
    const out = adminSummary(pw);
    out.message = respId + ' 已修正（' + changed.join('、') + '）' +
      (chk.isOutlier ? '；規則仍判定異常：' + chk.reason : '；已不再是異常值');
    return out;
  }
  return { ok: false, error: '找不到 ' + respId };
}

function adminSetOutlier(pw, respId, include) {
  _auth(pw);
  const sh = _ss().getSheetByName(SHEET_RESP);
  const last = sh.getLastRow();
  const idx = {};
  RESP_HEADERS.forEach(function (h, i) { idx[h] = i; });
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() !== String(respId).trim()) continue;
    const r = i + 2;
    const row = sh.getRange(r, 1, 1, RESP_HEADERS.length).getValues()[0];
    const chk = _checkOutlier(_num(row[idx.monthly_salary]), _num(row[idx.annual_bonus]),
                              _num(row[idx.annual_total]), _num(row[idx.ot_monthly]));
    const flag = include ? 'N' : (chk.isOutlier ? 'Y' : '');
    const reason = include
      ? '【人工確認計入】' + (chk.reason || '')
      : chk.reason;
    sh.getRange(r, idx.outlier + 1).setValue(flag);
    sh.getRange(r, idx.outlier_reason + 1).setValue(reason);
    CacheService.getScriptCache().remove(CACHE_KEY);
    _log('admin_outlier', respId + ' → ' + (include ? '計入統計' : '排除'));
    const s = adminSummary(pw);
    s.message = respId + ' 已設為' + (include ? '<b>計入統計</b>' : '<b>排除於統計</b>');
    return s;
  }
  return { ok: false, error: '找不到 ' + respId };
}

// ══════════════════════════════════
// 後台統計（監控導向，跟對外報告分工不同）
// ══════════════════════════════════
const ADMIN_DIMS = [
  ['job_category',     '行業別'],
  ['yrs_band',         '年資'],
  ['education',        '學歷'],
  ['work_region',      '區域'],
  ['osh_license_top',  '證照'],
  ['lang_level',       '外語能力'],
  ['company_size',     '公司規模'],
  ['job_title',        '職稱職級'],
  ['age_band',         '年齡'],
  ['industry_sub',     '產業細分']
];

// 報告會用到、值得盯「未填率」的欄位
const QUALITY_FIELDS = [
  ['gender', '性別'], ['major_field', '科系領域'], ['industry_sub', '產業細分'],
  ['job_title', '職稱職級'], ['is_dedicated', '職安專責'], ['subordinates', '部屬'],
  ['company_size', '公司規模'], ['shift_type', '工作型態'], ['ot_pay_type', '加班費給付'],
  ['raise_last_year', '調薪幅度'], ['benefits', '福利'], ['prev_job', '前一份工作'],
  ['salary_change', '薪水變化'], ['satisfaction', '滿意度'], ['job_seeking', '轉職打算'],
  ['annual_leave_days', '特休天數']
];

function adminStats(pw) {
  _auth(pw);
  const rows = _readResponses();
  const clean = rows.filter(function (r) { return !r.outlier; });
  const imported = clean.filter(function (r) { return String(r.source) === LEGACY_TAG; });
  const fresh = clean.filter(function (r) { return String(r.source) !== LEGACY_TAG; });

  // ── 每日回收趨勢（近 21 天，只看真實回覆；匯入的時間戳是 2023 不會落在區間）──
  const days = [];
  const fmtDay = function (d) { return Utilities.formatDate(d, 'Asia/Taipei', 'MM/dd'); };
  const keyDay = function (d) { return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd'); };
  const byDay = {};
  rows.forEach(function (r) {
    if (!(r.timestamp instanceof Date)) return;
    const k = keyDay(r.timestamp);
    byDay[k] = (byDay[k] || 0) + 1;
  });
  for (let i = 20; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    days.push({ label: fmtDay(d), count: byDay[keyDay(d)] || 0 });
  }
  const weekCount = days.slice(-7).reduce(function (a, b) { return a + b.count; }, 0);

  // ── 分組排行榜 ──
  const groups = ADMIN_DIMS.map(function (d) {
    const map = {};
    clean.forEach(function (r) {
      const k = _mergeOther(r[d[0]]);
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    const items = Object.keys(map).map(function (k) {
      const sub = map[k];
      const m = _numericStat(sub.map(function (r) { return r.monthly_salary; }).filter(_pos));
      const a = _numericStat(sub.map(function (r) { return r.annual_total; }).filter(_pos));
      return { label: k, n: sub.length, monthly: m, annual: a };
    }).filter(function (x) { return x.annual.median !== null; })
      .sort(function (x, y) { return y.annual.median - x.annual.median; });
    return { key: d[0], title: d[1], items: items };
  });

  // ── 行業 × 年資 中位數矩陣 ──
  const catOrder = _countBy(clean, 'job_category').slice(0, 6).map(function (x) { return x.label; });
  const cross = {
    rows: catOrder,
    cols: YRS_BANDS,
    cells: catOrder.map(function (cat) {
      return YRS_BANDS.map(function (band) {
        const sub = clean.filter(function (r) {
          return _mergeOther(r.job_category) === cat && r.yrs_band === band;
        });
        const a = _numericStat(sub.map(function (r) { return r.annual_total; }).filter(_pos));
        return { n: sub.length, median: a.median };
      });
    })
  };

  // ── 未填率 ──
  const quality = QUALITY_FIELDS.map(function (f) {
    const blank = clean.filter(function (r) {
      const v = String(r[f[0]] === undefined || r[f[0]] === null ? '' : r[f[0]]).trim();
      return v === '' || v === '未填';
    }).length;
    return { label: f[1], blank: blank, pct: clean.length ? Math.round(blank / clean.length * 1000) / 10 : 0 };
  }).sort(function (a, b) { return b.blank - a.blank; });

  return {
    ok: true,
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm'),
    total: rows.length,
    valid: clean.length,
    outliers: rows.length - clean.length,
    minPublicN: MIN_PUBLIC_N,
    weekCount: weekCount,
    days: days,
    overall: { monthly: _numericStat(clean.map(function (r) { return r.monthly_salary; }).filter(_pos)),
               annual:  _numericStat(clean.map(function (r) { return r.annual_total; }).filter(_pos)) },
    bySource: {
      imported: { n: imported.length,
        monthly: _numericStat(imported.map(function (r) { return r.monthly_salary; }).filter(_pos)),
        annual:  _numericStat(imported.map(function (r) { return r.annual_total; }).filter(_pos)) },
      fresh: { n: fresh.length,
        monthly: _numericStat(fresh.map(function (r) { return r.monthly_salary; }).filter(_pos)),
        annual:  _numericStat(fresh.map(function (r) { return r.annual_total; }).filter(_pos)) }
    },
    groups: groups,
    cross: cross,
    quality: quality,
    legacyTag: LEGACY_TAG
  };
}


// 後台：立刻寄一份摘要、重設排程
function adminSendDigest(pw) {
  _auth(pw);
  const msg = sendDailyDigest();
  const s = adminGetNotify(pw);
  s.message = msg;
  return s;
}

function adminSetupDigest(pw, on) {
  _auth(pw);
  const msg = on ? setupDailyDigest() : removeDailyDigest();
  const s = adminGetNotify(pw);
  s.message = msg;
  return s;
}

function adminRecalc(pw) {
  _auth(pw);
  const msg = recalcDerivedColumns();
  const s = adminSummary(pw);
  s.message = msg;
  return s;
}


// ══════════════════════════════════
// 管理工具（於編輯器手動執行）
// ══════════════════════════════════

// 抽出中獎名單（僅回傳 Email，與問卷資料無關）
function drawWinners() {
  const sh = _ss().getSheetByName(SHEET_DRAW);
  if (!sh || sh.getLastRow() < 2) return '抽獎名單是空的';
  const pool = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const picked = pool.slice(0, DRAW_WINNERS);
  const text = picked.map(function (p, i) {
    const extra = [];
    if (p[2]) extra.push('電話 ' + p[2]);
    extra.push(p[3] ? ('地址 ' + p[3]) : '未填地址 → 寄電子禮券到 Email');
    return (i + 1) + '. ' + p[0] + '  ' + p[1] + '\n     ' + extra.join('｜');
  }).join('\n');
  _log('draw', '抽出 ' + picked.length + ' 位');
  Logger.log(text);
  return text;
}

// intl_licenses / intl_license_has 是後來插在中間的兩欄，
// 之前寫入的列會從該位置起整列左移兩格。這裡把它們補回正確位置。
function _migrateIntlColumns(values) {
  const n = RESP_HEADERS.length;
  const i0 = RESP_HEADERS.indexOf('intl_licenses');
  let moved = 0;
  values.forEach(function (v) {
    const flag = String(v[i0 + 1] || '');
    if (flag === '有國際證照' || flag === '無國際證照') return;   // 已是新格式
    if (!String(v[0] || '').trim()) return;                      // 空列跳過
    for (let k = n - 1; k >= i0 + 2; k--) v[k] = v[k - 2];
    v[i0] = '';
    v[i0 + 1] = '無國際證照';
    moved++;
  });
  return moved;
}

// 重新計算衍生欄位（改過分組規則後使用，順便把欄位錯位的舊資料搬回正確位置）
function recalcDerivedColumns() {
  const sh = _ss().getSheetByName(SHEET_RESP);
  _ensureColumns(sh, RESP_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) return '沒有資料';
  const values = sh.getRange(2, 1, last - 1, RESP_HEADERS.length).getValues();
  const migrated = _migrateIntlColumns(values);
  const idx = {};
  RESP_HEADERS.forEach(function (h, i) { idx[h] = i; });
  values.forEach(function (v) {
    v[idx.age_band] = _ageBand(_num(v[idx.age]));
    v[idx.yrs_band] = _yrsBand(_num(v[idx.yrs_total]));
    v[idx.work_region] = REGION_MAP[v[idx.work_city]] || '其他';
    v[idx.osh_license_top] = _topOshLicense(_arr(v[idx.osh_licenses]), _arr(v[idx.intl_licenses]));
    const o = _checkOutlier(_num(v[idx.monthly_salary]), _num(v[idx.annual_bonus]),
                            _num(v[idx.annual_total]), _num(v[idx.ot_monthly]));
    // 'N' = 後台人工確認要計入，重算時不可覆蓋掉
    if (String(v[idx.outlier] || '').toUpperCase() === 'N') {
      v[idx.outlier_reason] = '【人工確認計入】' + (o.reason || '');
    } else {
      v[idx.outlier] = o.isOutlier ? 'Y' : '';
      v[idx.outlier_reason] = o.reason;
    }
  });
  sh.getRange(2, 1, values.length, RESP_HEADERS.length).setValues(values);
  CacheService.getScriptCache().remove(CACHE_KEY);
  return '已重算 ' + values.length + ' 筆' +
    (migrated ? '，其中 ' + migrated + ' 筆的欄位已搬回正確位置（補上國際證照兩欄）' : '');
}

function clearStatsCache() {
  CacheService.getScriptCache().remove(CACHE_KEY);
  return '快取已清除';
}
