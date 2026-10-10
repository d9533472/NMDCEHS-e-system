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

// 通知節奏：這一天（含）以前每筆回覆都寄一封，之後自動改成每週日寄一份摘要。
// 想一直維持「每筆一封」就把日期往後改；想立刻切成週報就改成過去的日期。
const NOTIFY_EACH_UNTIL = '2026-10-09';
const DIGEST_WEEKDAY_HOUR = 9;          // 週日幾點寄


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
  ok('每週日摘要排程', function () { return setupWeeklyDigest(); });

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

const CACHE_KEY = 'salary_stats_v1';
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
  return today <= NOTIFY_EACH_UNTIL ? 'each' : 'weekly';
}

function _notifyNewResponse(row, total, force) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('NOTIFY_ON') === 'off') return { sent: false, reason: '通知已關閉' };
    if (!force && _notifyMode() !== 'each') {
      return { sent: false, reason: '目前是每週摘要模式，不逐筆寄信' };
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
// 每週日摘要
// ══════════════════════════════════
function sendWeeklyDigest() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('NOTIFY_ON') === 'off') return '通知已關閉';
  const to = (props.getProperty('NOTIFY_EMAIL') || '').trim() ||
             String(NOTIFY_EMAIL_DEFAULT || '').trim();
  if (!to) return '還沒設定收件信箱';

  const rows = _readResponses();
  const clean = rows.filter(function (r) { return !r.outlier; });
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const week = rows.filter(function (r) {
    return (r.timestamp instanceof Date) && r.timestamp >= cutoff;
  });

  const card = function (k, v, sub) {
    return '<td style="padding:0 8px 0 0;vertical-align:top;width:33%">' +
      '<div style="border:1px solid #e2e9f0;border-radius:11px;padding:11px 13px;background:#fafcfd">' +
      '<div style="font-size:11.5px;color:#64798c">' + k + '</div>' +
      '<div style="font-size:25px;font-weight:800;color:#0b1b2b;line-height:1.2">' + v + '</div>' +
      (sub ? '<div style="font-size:11.5px;color:#93a6b6">' + sub + '</div>' : '') +
      '</div></td>';
  };
  const dist = function (title, list) {
    if (!list.length) return '';
    return '<p style="margin:16px 0 6px;font-size:13px;font-weight:700;color:#2a4259">' + title + '</p>' +
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

  const need = Math.max(0, MIN_PUBLIC_N - clean.length);
  let body =
    '<table style="width:100%;border-collapse:separate;border-spacing:0"><tr>' +
    card('本週新增', week.length + ' 筆', '過去 7 天') +
    card('累計回覆', rows.length + ' 筆', '有效 ' + clean.length + ' 筆') +
    card('距離開放', need ? ('還差 ' + need + ' 筆') : '已開放', '門檻 ' + MIN_PUBLIC_N + ' 份') +
    '</tr></table>';

  if (week.length) {
    body += dist('本週行業別', _countBy(week, 'job_category')) +
            dist('本週年資', _countBy(week, 'yrs_band'));
  } else {
    body += '<p style="margin:16px 0 0;font-size:13.5px;color:#64798c">' +
            '本週沒有新的回覆。要不要再到社團轉發一次？</p>';
  }

  // 累計中位數是公開報告上本來就看得到的數字，不涉及單筆，可以放
  if (clean.length >= MIN_PUBLIC_N) {
    const st = _salaryStat(clean);
    body += '<p style="margin:18px 0 6px;font-size:13px;font-weight:700;color:#2a4259">累計中位數</p>' +
      '<table style="width:100%;border-collapse:separate;border-spacing:0"><tr>' +
      card('月全薪', _fmt(st.monthly.median), 'n = ' + st.monthly.n) +
      card('年終', _fmt(st.bonus.median), '') +
      card('全年收入', _fmt(st.annual.median), '') +
      '</tr></table>';
  }

  const url = ScriptApp.getService().getUrl();
  const html =
    '<div style="font-family:system-ui,-apple-system,\'Noto Sans TC\',sans-serif;' +
    'max-width:560px;color:#0b1b2b;line-height:1.7">' +
    '<div style="background:#0e7a53;color:#fff;padding:15px 18px;border-radius:12px 12px 0 0">' +
    '<div style="font-size:11.5px;opacity:.8;letter-spacing:.1em">WEEKLY DIGEST</div>' +
    '<div style="font-size:17px;font-weight:700">' + SURVEY_TITLE + '　本週摘要</div></div>' +
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
      subject: '【' + SURVEY_TITLE + '】本週摘要：新增 ' + week.length +
               ' 筆，累計 ' + rows.length + ' 筆',
      htmlBody: html
    });
    _log('digest', '本週摘要已寄給 ' + to + '（新增 ' + week.length + ' 筆）');
    return '已寄出本週摘要給 ' + to + '（本週新增 ' + week.length + ' 筆）';
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    _log('digest_error', msg);
    return '寄送失敗：' + msg;
  }
}

// 安裝／移除每週日的觸發器
function setupWeeklyDigest() {
  removeWeeklyDigest();
  ScriptApp.newTrigger('sendWeeklyDigest')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(DIGEST_WEEKDAY_HOUR)
    .inTimezone('Asia/Taipei')
    .create();
  return '已排定每週日 ' + DIGEST_WEEKDAY_HOUR + ' 點寄送摘要';
}

function removeWeeklyDigest() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyDigest') { ScriptApp.deleteTrigger(t); n++; }
  });
  return '已移除 ' + n + ' 個週報觸發器';
}

function _hasWeeklyTrigger() {
  try {
    return ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'sendWeeklyDigest';
    });
  } catch (e) { return false; }
}


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
    digestHour: DIGEST_WEEKDAY_HOUR,
    hasTrigger: _hasWeeklyTrigger()
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
function apiStats(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const hit = cache.get(CACHE_KEY);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
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
    profile: {},
    salary: {},
    narrative: []
  };

  // ── 整體資料分析（人數／比例）──
  const profileDims = [
    ['education',       '學歷'],
    ['osh_license_top', '職安證照（最高等級）'],
    ['intl_license_has', '國際職安證照'],
    ['other_license_has', '其他證照'],
    ['skill_has',       '其他專業'],
    ['lang_level',      '外語能力'],
    ['is_dedicated',    '職安專責'],
    ['yrs_band',        '工作經驗'],
    ['job_category',    '職業分類'],
    ['work_region',     '工作區域'],
    ['age_band',        '年齡'],
    ['company_size',    '公司規模'],
    ['job_title',       '職稱／職級'],
    ['shift_type',      '工作型態'],
    ['ot_pay_type',     '加班費給付'],
    ['raise_last_year', '近一年調薪'],
    ['job_seeking',     '轉職意願']
  ];
  profileDims.forEach(function (d) {
    stats.profile[d[0]] = { title: d[1], rows: _countBy(clean, d[0]) };
  });

  // ── 薪資分析（分組）──
  stats.salary.overall = _salaryStat(clean);
  const salaryDims = [
    ['education',       '依學歷分類',            null],
    ['yrs_band',        '依工作經驗分類',        YRS_BANDS],
    ['osh_license_top', '依職安證照分類（取最高等級）', OSH_LADDER],
    ['intl_license_has', '依國際職安證照分類', ['有國際證照', '無國際證照']],
    ['lang_has',        '依外語能力分類',        ['有外語能力', '無外語能力']],
    ['other_license_has', '依其他證照分類',      ['有', '無']],
    ['work_region',     '依工作區域分類',        ['北部', '中部', '南部', '東部', '離島', '海外']],
    ['job_category',    '依現職工作分類',        null],
    ['company_size',    '依公司規模分類',        null],
    ['job_title',       '依職稱／職級分類',      null],
    ['age_band',        '依年齡分類',            AGE_BANDS]
  ];
  stats.salary.groups = salaryDims.map(function (d) {
    return { key: d[0], title: d[1], items: _groupSalary(clean, d[0], d[2]) };
  });

  // ── 加班與福利 ──
  stats.overtime = _numericStat(
    rows.map(function (r) { return r.ot_monthly; })
        .filter(function (v) { return _pos(v) && v <= OUTLIER.otMax; }));
  stats.benefits = _countByMulti(clean, 'benefits');
  stats.jobContents = _countByMulti(clean, 'job_contents');
  stats.skillsDetail = _countByMulti(clean, 'skills');
  stats.otherLicenseDetail = _countByMulti(clean, 'other_licenses');
  stats.intlLicenseDetail = _countByMulti(clean, 'intl_licenses');

  // ── 文字結論 ──
  stats.narrative = _buildNarrative(stats);

  try { cache.put(CACHE_KEY, JSON.stringify(stats), CACHE_SEC); } catch (e) {}
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

function _numericStat(arr) {
  if (!arr.length) return { n: 0, min: null, max: null, mean: null, median: null, p25: null, p75: null };
  const s = arr.slice().sort(function (a, b) { return a - b; });
  const sum = s.reduce(function (a, b) { return a + b; }, 0);
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    mean: Math.round(sum / s.length),
    median: Math.round(_median(s)),
    p25: Math.round(_percentile(s, 25)),
    p75: Math.round(_percentile(s, 75))
  };
}

// 自填的「其他：顧問業」「其他：環保公司」… 在統計上要全部併成一條「其他」，
// 否則每個人自己寫的字都會變成一個只有 1 筆的分類。原始文字仍完整保留在試算表裡。
function _mergeOther(v) {
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return '未填';
  return /^其他[：:]/.test(t) ? '其他' : t;
}

function _countBy(rows, key) {
  const map = {};
  rows.forEach(function (r) {
    const k = _mergeOther(r[key]);
    map[k] = (map[k] || 0) + 1;
  });
  const total = rows.length || 1;
  return Object.keys(map)
    .map(function (k) { return { label: k, count: map[k], pct: Math.round(map[k] / total * 1000) / 10 }; })
    .sort(function (a, b) { return b.count - a.count; });
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
// 自動文字結論
// ══════════════════════════════════
function _buildNarrative(stats) {
  const out = [];
  const MIN_N = 5;

  function dim(key, no, name, lead) {
    const title = no + '、' + name + '對薪資的影響';
    const g = stats.salary.groups.filter(function (x) { return x.key === key; })[0];
    if (!g) return;
    const items = g.items.filter(function (i) { return i.n >= MIN_N && i.annual.median; });
    if (items.length < 2) return;
    const sorted = items.slice().sort(function (a, b) { return b.annual.median - a.annual.median; });
    const hi = sorted[0], lo = sorted[sorted.length - 1];
    const gap = hi.annual.median - lo.annual.median;
    const pct = lo.annual.median ? Math.round(gap / lo.annual.median * 100) : 0;
    // 列出所有組別（超過 8 組時取前 7 名 + 最低的一組，確保結論提到的兩端都看得到）
    let listed = sorted;
    let truncated = false;
    if (sorted.length > 8) { listed = sorted.slice(0, 7).concat([lo]); truncated = true; }
    const bullets = listed.map(function (i) {
      return i.label + '（n=' + i.n + '）月薪中位數 ' + _fmt(i.monthly.median) +
             '，年收入中位數 ' + _fmt(i.annual.median);
    });
    if (truncated) bullets.push('（組別較多，上方僅列出最高 7 組與最低 1 組，完整數字請見上面的分組表）');
    bullets.push('最高（' + hi.label + '）與最低（' + lo.label + '）年收入中位數相差 ' +
                 _fmt(gap) + '，差距約 ' + pct + '%');
    let conclusion;
    if (pct >= 30) {
      conclusion = name + '對薪資影響明顯，' + hi.label + '明顯領先，與' + lo.label + '差距約 ' + pct + '%。';
    } else if (pct >= 12) {
      conclusion = name + '對薪資有一定影響（組間差距約 ' + pct + '%），但並非決定性因素。';
    } else {
      conclusion = '各' + name + '之間薪資差距不大（約 ' + pct + '%），影響有限。';
    }
    out.push({ title: title, lead: lead, bullets: bullets, conclusion: conclusion });
  }

  dim('education',       '一', '學歷',     '比較各學歷層級的月薪與年收入中位數');
  dim('yrs_band',        '二', '工作經驗', '觀察年資級距與薪資成長的關聯');
  dim('work_region',     '三', '工作區域', '依工作地所屬區域比較');
  dim('osh_license_top', '四', '職安證照', '取最高一級：國際證照 › 甲級 › 乙級 › 甲種 › 乙種 › 丙種 › 丁種');
  dim('intl_license_has', '四之一', '國際職安證照', '比較有／無 NEBOSH、IOSH、CSP 等國際證照者');
  dim('lang_has',        '五', '外語能力', '比較有／無外語檢定成績者');
  dim('job_category',    '六', '行業別',   '依現職工作分類比較');
  dim('company_size',    '七', '公司規模', '依公司員工人數級距比較');
  dim('job_title',       '八', '職級',     '依現職職稱／職級比較');
  return out;
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


// 後台：立刻寄一份週報、重設排程
function adminSendDigest(pw) {
  _auth(pw);
  const msg = sendWeeklyDigest();
  const s = adminGetNotify(pw);
  s.message = msg;
  return s;
}

function adminSetupDigest(pw, on) {
  _auth(pw);
  const msg = on ? setupWeeklyDigest() : removeWeeklyDigest();
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
