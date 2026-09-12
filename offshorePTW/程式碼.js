/**
 * ============================================================
 *  Offshore PTW System — All-in-One（完整版 M4.2：全功能）
 *  ★ 2026-09-09 效能修補版：純 JS 日期格式化、分片快取、Session 快取驗證、home.public 合併路由
 *  台電通霄二期海管統包工程 P2913 · NMDC
 * ============================================================
 *  使用方式（只需 3 步）：
 *   1. 到 https://script.new 建立新專案，把預設內容全部刪除，
 *      貼上本檔案全部內容，Ctrl+S 儲存。
 *   2. 上方函式選單選「oneClickSetup」→ 按「執行」→ 依提示授權
 *      → 查看「執行紀錄」會顯示管理員帳號與初始密碼。
 *   3. 右上「部署」→「新增部署」→ 類型「網頁應用程式」
 *      （執行身分：我／存取權：所有人）→ 複製網址開啟即可使用。
 *
 *  ▼ 若想用自己已建立的 Google Sheet / Drive 資料夾，把 ID 貼在下面；
 *    留空 = 自動建立（推薦）。
 * ============================================================
 */
var ONE_CLICK_CONFIG = {
  SPREADSHEET_ID: '',        // ← 留空自動建立（會自動移入下方資料夾）
  DRIVE_ROOT_FOLDER_ID: '1NkJzo5sN8kdPTrxwXoOmW7KEgYZcEGNv'   // ← 已填入您的 Drive 資料夾
};



/* ============================== Config.gs ============================== */
/**
 * Config.gs — 系統常數、資料表結構定義、Script Properties 讀取
 * 位置：Google Apps Script 專案
 * 所有可設定項目集中於此與 Script Properties / SystemSettings 表。
 */

var CFG = {
  TIMEZONE: 'Asia/Taipei',

  // Session
  SESSION_HOURS: 8,
  CACHE_TTL_SEC: 21600, // CacheService 上限 6 小時

  // 密碼與鎖定
  // GAS 每次 computeDigest 呼叫有 1-2ms 橋接開銷，高迭代數在此平台代價極高。
  // 安全性由 PEPPER（Script Properties 伺服器密鑰）承擔：竊得試算表也無法離線破解。
  HASH_ITERATIONS: 1,             // 單次加鹽+Pepper 雜湊：~1ms，登入即時
  HASH_ITERATIONS_FALLBACKS: [1, 3000, 10000], // 歷史版本迭代數，登入時自動辨識並升級
  MAX_FAILED_LOGIN: 5,
  LOCK_MINUTES: 30,
  RESET_TOKEN_MINUTES: 15,
  MIN_PASSWORD_LEN: 8,

  // 預設系統參數（可被 SystemSettings 表覆蓋）
  DEFAULTS: {
    passScore: 60,
    trainingValidityMonths: 36,
    minWatchPercent: 90,
    expiryReminderHours: 24,
    resubmitStartTier: 2,           // 2 = 從 Tier 2 重審；'returnTier' = 從退回者關卡
    ptwNumberFormat: 'OPTW-{0000}',
    tmpNumberFormat: 'Draft-OPTW-{0000}',
    maxUploadMb: 25,
    showAnswersAfterExam: 'false',
    systemNameEn: 'Offshore PTW System',
    systemNameZh: '離岸工作許可系統',
    contactInfo: '有任何系統問題或建議，歡迎隨時與系統管理員聯繫！\n服務時間：週一至週五 08:00–17:00（UTC+8）\n非服務時間請先留下訊息，我們會在第一時間回覆您。\n\nLine: paulbstong\n電話 (WhatsApp): +886 981181202\n電子郵件: paul.tong@nmdc-group.com',
    contactInfoEn: 'Questions or suggestions about the system? Feel free to contact the administrator anytime!\nService hours: Mon–Fri 08:00–17:00 (UTC+8)\nOutside service hours, please leave a message and we will get back to you as soon as possible.\n\nLine: paulbstong\nPhone (WhatsApp): +886 981181202\nEmail: paul.tong@nmdc-group.com'
  },

  // PTW 狀態
  STATUS: {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    PENDING_T2: 'PendingTier2Review',
    PENDING_T3: 'PendingTier3Review',
    PENDING_T4: 'PendingTier4Review',
    PENDING_T5: 'PendingTier5Review',
    RETURNED: 'ReturnedForRevision',
    RETURNED_CORRECTION: 'ReturnedForCorrection',
    APPROVED: 'Approved',
    ACTIVE: 'Active',
    SUSPENDED: 'Suspended',
    EXTENDED: 'Extended',
    EXPIRED: 'Expired',
    WORK_COMPLETED: 'WorkCompleted',
    PENDING_CLOSEOUT: 'PendingCloseout',
    CLOSED: 'Closed',
    CANCELLED: 'Cancelled'
  },

  // 證書類型（Q4 決議編碼）
  CERT_TYPES: {
    HW: { prefix: 'HW', sheet: 'Cert_HotWork',       nameEn: 'Hot Work Permit',                nameZh: '動火作業許可證', workTypeFlag: 'wtHotWork' },
    GW: { prefix: 'GW', sheet: 'Cert_ColdWork',      nameEn: 'Cold Work Permit',               nameZh: '一般作業許可證', workTypeFlag: 'wtColdWork', noCert: true }, // 總部決議：Cold Work 免附證書（型別保留以相容舊資料）
    DO: { prefix: 'DO', sheet: 'Cert_Diving',        nameEn: 'Diving Operations Certificate',  nameZh: '潛水作業證書',   workTypeFlag: 'wtDiving' },
    RG: { prefix: 'RG', sheet: 'Cert_Radiography',   nameEn: 'Radiography Certificate',        nameZh: '輻射作業證明書', workTypeFlag: 'wtRadiography' },
    CS: { prefix: 'CS', sheet: 'Cert_ConfinedSpace', nameEn: 'Confined Space Entry Certificate', nameZh: '侷限空間作業證書', workTypeFlag: 'wtConfinedSpace' },
    EC: { prefix: 'EC', sheet: 'Cert_Excavation',    nameEn: 'Excavation Certificate',         nameZh: '開挖作業許可證', workTypeFlag: 'wtExcavation' },
    EI: { prefix: 'EI', sheet: 'Cert_ElectricalIso', nameEn: 'Electrical Isolation Certificate', nameZh: '電氣隔離證書', workTypeFlag: 'wtElectricalIso' },
    PI: { prefix: 'PI', sheet: 'Cert_ProcessIso',    nameEn: 'Process Isolation Certificate',  nameZh: '製程隔離證書', workTypeFlag: 'wtProcessIso' }
  }
};

/** 所有工作表結構（首列欄名）。initSystem() 依此建表。 */
var SHEETS = {
  Users: ['id','email','nameZh','nameEn','companyId','title','phone','vessel','tier','isAdmin','badgeNo',
          'passwordHash','passwordSalt','hashIter','signatureFileId','status','failedLoginCount','lockedUntil','mustChangePassword',
          'applyReason','appliedTier','trainingPassedAt','trainingValidUntil','langPref','isTestUser','isHse',
          'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Companies: ['id','nameZh','nameEn','type','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Roles: ['id','code','nameZh','nameEn','pickerFilter','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  UserRoles: ['id','userId','roleId','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Master: ['id','ptwNumber','tempNumber','version','status','companyId','applicantUserId','vessel',
               'executionDate','continuationOfPermitNo','areaLocation','workDescription','toolsEquipment',
               'wtHotWork','wtColdWork','wtDiving','wtRadiography','wtConfinedSpace','wtExcavation','wtElectricalIso','wtProcessIso',
               'validFrom','validTo','validHours','scaffoldingRequired',
               'gasTestRequired','gasTestInterval','gasTestIntervalOther','cssIsoRequired',
               'psOthers','hzOthers','cssOthers','pcOthers',
               'holderUserId','coHolderUserId','paUserId','paDeclarationAccepted',
               'currentTier','currentReviewerId','submittedAt','approvedAt','activatedAt','closedAt',
               'wcDeclarationAccepted','driveFolderId',
               'coT2UserId','coT2At','coT3UserId','coT3At','coT4UserId','coT4At','coT5UserId','coT5At','coCurrentTier',
               'checksJson','gasTestsJson','docChecksJson',
               'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Hazards: ['id','ptwId','groupCode','itemCode','isChecked','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_GasTests: ['id','ptwId','o2','lel','h2s','co','h2','testerUserId','signatureId','testDate','testTime',
                 'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Certificates: ['id','ptwId','certType','certNo','status','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Cert_HotWork: ['id','certificateId','ptwId','certNo','dataJson','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Cert_ColdWork: ['id','certificateId','ptwId','certNo','dataJson','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Cert_ElectricalIso: ['id','certificateId','ptwId','certNo','dataJson','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Cert_ProcessIso: ['id','certificateId','ptwId','certNo','dataJson','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Cert_ConfinedSpace: ['id','certificateId','ptwId','certNo','dataJson','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Cert_Excavation: ['id','certificateId','ptwId','certNo','dataJson','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Cert_Radiography: ['id','certificateId','ptwId','certNo','dataJson','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Cert_Diving: ['id','certificateId','ptwId','certNo','dataJson','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Attachments: ['id','ptwId','certificateId','fileName','driveFileId','fileUrl','fileType','fileSizeBytes',
                    'category','uploadedBy','uploadedAt','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Approvals: ['id','ptwId','version','tier','action','reviewerUserId','comment','returnReason','signatureId',
                  'sessionId','userAgent','clientInfo','decidedAt','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Comments: ['id','ptwId','userId','tier','comment','timestamp','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_StatusHistory: ['id','ptwId','fromStatus','toStatus','byUserId','reason','timestamp',
                      'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Versions: ['id','ptwId','version','snapshotJson','diffJson','submittedAt','submittedBy',
                 'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Signatures: ['id','ptwId','certificateId','roleCode','userId','signatureFileId','signatureHash','signedAt',
                   'isVoided','voidedReason','voidedAt','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PTW_Revalidations: ['id','ptwId','paUserId','date','fromTime','toTime','disciplineSupSignatureId','hseSignatureId',
                      'newValidTo','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  TrainingCourses: ['id','title','youtubeVideoId','videosJson','langCode','durationSec','courseVersion','validityMonths','minWatchPercent',
                    'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  TrainingProgress: ['id','userId','courseId','watchStartAt','watchCompletedAt','watchedSec','watchPercent','completed','videoProgressJson',
                     'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  QuestionBank: ['id','type','questionZh','questionEn','optionsJson','answerJson','points','category','difficulty',
                 'mustInclude','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  ExamAttempts: ['id','userId','courseId','attemptNo','questionSetJson','startAt','submitAt','score','passed',
                 'lockedUntilDate','sessionId','isPractice','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  ExamAnswers: ['id','attemptId','questionId','answerJson','isCorrect','pointsAwarded',
                'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Notifications: ['id','userId','type','ptwId','titleEn','titleZh','messageEn','messageZh','isRead','emailSent',
                  'emailSentAt','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  SystemSettings: ['key','value','description','updatedAt','updatedBy'],
  AuditLog: ['id','userId','userName','companyId','tier','actionType','entityType','entityId','ptwNumber',
             'oldValue','newValue','comment','sessionId','clientInfo','userAgent','success','timestamp'],
  LoginAttempts: ['id','email','success','reason','clientInfo','userAgent','timestamp'],
  Delegations: ['id','delegatorUserId','delegateUserId','tier','validFrom','validTo',
                'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Sequences: ['key','currentValue','format','updatedAt'],
  Sessions: ['id','userId','createdAt','expiresAt','lastSeenAt','userAgent','isRevoked'],
  ProfileChangeRequests: ['id','userId','changesJson','status','reviewedBy','reviewedAt','rejectReason',
                          'createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Downloads: ['id','title','titleZh','titleEn','description','category','fileName','driveFileId','fileUrl',
              'uploadedBy','uploadedAt','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  Announcements: ['id','textZh','textEn','level','createdAt','createdBy','updatedAt','updatedBy','isActive'],
  PasswordResets: ['id','userId','tokenHash','expiresAt','usedAt','createdAt']
};

/** Script Properties 讀取（敏感設定不進程式碼） */
function getProp_(key, optional) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v && !optional) throw new Error('Missing Script Property: ' + key);
  return v;
}
function getSpreadsheet_() {
  return SpreadsheetApp.openById(getProp_('SPREADSHEET_ID'));
}
/** SystemSettings 讀取（含預設值 fallback） */
function getSetting_(key) {
  var row = Repo.findOne('SystemSettings', function (r) { return r.key === key; });
  if (row && row.value !== '' && row.value != null) return row.value;
  return CFG.DEFAULTS[key];
}

/** 寫入 SystemSettings（以 key upsert，含快取失效） */
function setSetting_(key, value, byUser) {
  Repo.upsertByKey('SystemSettings', 'key', key, { value: String(value), updatedBy: byUser || '' });
}

/* ============================== Utils.gs ============================== */
/**
 * Utils.gs — 共用工具：UUID、日期時間（Asia/Taipei）、回應包裝、錯誤、輸入清理
 */

function uuid_() { return Utilities.getUuid(); }

function now_() { return new Date(); }

/** 以 Asia/Taipei 格式化 */
/** 以 Asia/Taipei（UTC+8，無日光節約）純 JS 格式化 — 取代 Utilities.formatDate（快約 100 倍） */
function tpParts_(d) {
  if (d === undefined || d === null || d === '') d = new Date();
  else if (!(d instanceof Date)) d = new Date(d);
  var ms = d.getTime();
  if (isNaN(ms)) return null;
  var t = new Date(ms + 8 * 3600 * 1000);            // Asia/Taipei = UTC+8，無 DST
  return { y: t.getUTCFullYear(), M: t.getUTCMonth() + 1, d: t.getUTCDate(),
           h: t.getUTCHours(), m: t.getUTCMinutes(), s: t.getUTCSeconds() };
}
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function fmtDateTime_(d) {
  var p = tpParts_(d); if (!p) return '';
  return p.y + '-' + pad2_(p.M) + '-' + pad2_(p.d) + ' ' + pad2_(p.h) + ':' + pad2_(p.m) + ':' + pad2_(p.s);
}
function fmtDate_(d) {
  var p = tpParts_(d); if (!p) return '';
  return p.y + '-' + pad2_(p.M) + '-' + pad2_(p.d);
}
function fmtTime_(d) {
  var p = tpParts_(d); if (!p) return '';
  return pad2_(p.h) + ':' + pad2_(p.m);
}

/** 解析 'yyyy-MM-dd HH:mm:ss'（視為台北時間） */
function parseDateTime_(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
  if (!m) return null;
  // 台北固定 UTC+8（無日光節約）
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] || 0) - 8, +m[5] || 0, +m[6] || 0));
}

/** 台北時區「明天 00:00」— 考試鎖定用 */
function nextTaipeiMidnight_() {
  var todayStr = fmtDate_(new Date());
  var todayMidnight = parseDateTime_(todayStr + ' 00:00:00');
  return new Date(todayMidnight.getTime() + 24 * 3600 * 1000);
}

/** 統一 API 回應 */
function ok_(data) { return { ok: true, data: (data === undefined ? null : data) }; }
function err_(code, msgEn, msgZh) { return { ok: false, errorCode: code, msgEn: msgEn || code, msgZh: msgZh || msgEn || code }; }

/** 帶錯誤碼的例外（router 統一轉回應） */
function ApiError_(code, msgEn, msgZh) {
  var e = new Error(msgEn || code);
  e.apiCode = code; e.msgEn = msgEn || code; e.msgZh = msgZh || msgEn || code;
  return e;
}

/** 防 Google Sheets 公式注入 */
function sanitizeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  var s = String(v);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

/** email 正規化與檢核 */
function normEmail_(email) { return String(email || '').trim().toLowerCase(); }
function isValidEmail_(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

/** 隨機 salt / token */
function randomToken_(bytes) {
  var arr = [];
  for (var i = 0; i < (bytes || 32); i++) arr.push(Math.floor(Math.random() * 256));
  return Utilities.base64EncodeWebSafe(arr).replace(/=+$/, '');
}

/** SHA-256 雜湊（回傳 Base64） */
function sha256_(input) {
  var bytes = (typeof input === 'string')
    ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8)
    : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return Utilities.base64Encode(bytes);
}

/** 迭代雜湊密碼：SHA-256(salt‖pepper‖password) ×iterations（預設 CFG.HASH_ITERATIONS） */
function hashPassword_(password, saltB64, iterations) {
  var pepper = getProp_('PEPPER');
  var n = Number(iterations) || CFG.HASH_ITERATIONS;
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, saltB64 + pepper + password, Utilities.Charset.UTF_8);
  for (var i = 1; i < n; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return Utilities.base64Encode(bytes);
}

/** 密碼強度：至少 8 碼、含英文與數字 */
function isStrongPassword_(pw) {
  return typeof pw === 'string' && pw.length >= CFG.MIN_PASSWORD_LEN && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

/** 必填欄位檢查 */
function requireFields_(obj, fields) {
  var missing = fields.filter(function (f) {
    return obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '';
  });
  if (missing.length) {
    throw ApiError_('MISSING_FIELDS',
      'Missing required fields: ' + missing.join(', '),
      '缺少必填欄位：' + missing.join(', '));
  }
}

/** 布林正規化（Sheets 讀回可能為字串） */
function asBool_(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }

/**
 * PTW 時間狀態（只看已核發的 Active/Extended）：
 *   'notStarted' = 已核發但 validFrom 未到（待生效）
 *   'active'     = 現在落在 validFrom ~ validTo 之間（真正執行中）
 *   'overdue'    = validTo 已過
 *   null         = 非 Active/Extended 狀態
 * validFrom 為空（舊資料）視為已開始。日期字串皆為 'yyyy-MM-dd HH:mm:ss'，可直接字串比較。
 */
function ptwTimeState_(p, nowStr) {
  var S = CFG.STATUS;
  if (p.status !== S.ACTIVE && p.status !== S.EXTENDED) return null;
  nowStr = nowStr || fmtDateTime_();
  if (p.validTo && String(p.validTo) < nowStr) return 'overdue';
  if (p.validFrom && String(p.validFrom) > nowStr) return 'notStarted';
  return 'active';
}

/**
 * 雙語名稱顯示：「英文 / 中文」。
 * 兩者相同（或其一為空）時只回傳一次，避免出現「Test Contractor Alpha / Test Contractor Alpha」。
 */
function bilingualName_(en, zh) {
  en = String(en == null ? '' : en).trim();
  zh = String(zh == null ? '' : zh).trim();
  if (!en) return zh;
  if (!zh || zh === en) return en;
  return en + ' / ' + zh;
}
/** 公司物件 → 顯示名稱 */
function companyLabel_(c) { return c ? bilingualName_(c.nameEn, c.nameZh) : ''; }

/* ============================== SheetRepository.gs ============================== */
/**
 * SheetRepository.gs — Google Sheets 泛用資料存取層
 * 職責：CRUD、欄名對映、sanitize（防公式注入）、LockService 包裝寫入。
 * 所有 Service 一律經由 Repo 存取 Sheets，不得直接操作 SpreadsheetApp。
 */

var Repo = (function () {

  var ssCache = null;
  var headerCache = {};

  /**
   * 效能快取：
   * - execMemo：同一次執行內同表只讀一次（每次 API 呼叫為獨立執行，自然重置）
   * - CacheService：小型熱門表跨執行快取（秒），寫入即失效
   */
  var execMemo = {};
  // ---- 取代原本的 HOT_TABLES ----
  var HOT_TABLES = {
    Users: 120, Companies: 300, SystemSettings: 300, Sessions: 300,
    Roles: 600, TrainingCourses: 300, Delegations: 120,
    PTW_Master: 30, PTW_Certificates: 60, PTW_Attachments: 60, PTW_Approvals: 60,
    PTW_StatusHistory: 60, Notifications: 60, Downloads: 300, Announcements: 300,
    QuestionBank: 300, TrainingProgress: 60, ExamAttempts: 60, ProfileChangeRequests: 60
  };
  var CACHE_CHUNK_CHARS = 30000;   // 每片字元數（UTF-8 最壞 3 bytes/字 → 90 KB < 100 KB 上限）
  var CACHE_MAX_CHUNKS = 12;       // 超過約 1 MB 的表就不快取

  // ---- 取代原本的 cacheKey_ ----
  function cacheKey_(name) { return 'tbl2_' + name; }   // 改前綴，避免讀到舊格式的快取

  // ---- 取代原本的 invalidate_ ----
  function invalidate_(name) {
    delete execMemo[name];
    if (HOT_TABLES[name]) {
      try { CacheService.getScriptCache().remove(cacheKey_(name)); } catch (e) {}
    }
  }

  // ---- 新增：分片讀取 ----
  function cacheGet_(name) {
    try {
      var c = CacheService.getScriptCache();
      var metaRaw = c.get(cacheKey_(name));
      if (!metaRaw) return null;
      var meta = JSON.parse(metaRaw);            // {n: 片數, v: 版本}
      var keys = [];
      for (var i = 0; i < meta.n; i++) keys.push(cacheKey_(name) + '_' + meta.v + '_' + i);
      var parts = c.getAll(keys);
      var json = '';
      for (var j = 0; j < meta.n; j++) {
        var p = parts[keys[j]];
        if (p === null || p === undefined) return null;   // 任一片遺失 → 視為未命中
        json += p;
      }
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  // ---- 新增：分片寫入 ----
  function cachePut_(name, rows, ttlSec) {
    try {
      var json = JSON.stringify(rows);
      var n = Math.max(1, Math.ceil(json.length / CACHE_CHUNK_CHARS));
      if (n > CACHE_MAX_CHUNKS) return;                       // 太大就略過
      var v = Date.now().toString(36);
      var obj = {};
      for (var i = 0; i < n; i++) {
        obj[cacheKey_(name) + '_' + v + '_' + i] = json.substr(i * CACHE_CHUNK_CHARS, CACHE_CHUNK_CHARS);
      }
      var c = CacheService.getScriptCache();
      c.putAll(obj, ttlSec);
      c.put(cacheKey_(name), JSON.stringify({ n: n, v: v }), ttlSec);
    } catch (e) { /* 快取失敗不影響功能 */ }
  }

  function copyRows_(rows) {
    return rows.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
  }

  function ss_() {
    if (!ssCache) ssCache = getSpreadsheet_();
    return ssCache;
  }

  function sheet_(name) {
    var sh = ss_().getSheetByName(name);
    if (!sh) {
      // 自動建表（版本更新新增的資料表免手動 initSystem）
      if (typeof SHEETS !== 'undefined' && SHEETS[name]) {
        sh = ss_().insertSheet(name);
        sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
        sh.setFrozenRows(1);
        headerCache[name] = SHEETS[name].slice();
        return sh;
      }
      throw new Error('Sheet not found: ' + name + ' — run initSystem() first.');
    }
    return sh;
  }

  function headers_(name) {
    if (!headerCache[name]) {
      var sh = sheet_(name);
      var existing = sh.getLastColumn() > 0
        ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
      // 自動補欄位（版本更新新增的欄位免手動 initSystem）
      if (typeof SHEETS !== 'undefined' && SHEETS[name]) {
        var missing = SHEETS[name].filter(function (h) { return existing.indexOf(h) < 0; });
        if (missing.length) {
          sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
          existing = existing.concat(missing);
        }
      }
      headerCache[name] = existing;
    }
    return headerCache[name];
  }

  function rowToObj_(headers, row) {
    var o = {};
    for (var i = 0; i < headers.length; i++) {
      var v = row[i];
      if (v instanceof Date) v = fmtDateTime_(v);
      if (typeof v === 'string' && v.charAt(0) === "'") v = v.substring(1);
      o[headers[i]] = v;
    }
    return o;
  }

  function objToRow_(headers, obj) {
    return headers.map(function (h) {
      return sanitizeCell_(obj[h] === undefined ? '' : obj[h]);
    });
  }

  /** 讀全表為物件陣列（含 _rowIndex 供更新）；經 execMemo + 分片 CacheService 快取 */
  function readAll(name) {
    if (execMemo[name]) return copyRows_(execMemo[name]);
    if (HOT_TABLES[name]) {
      var cached = cacheGet_(name);
      if (cached) {
        execMemo[name] = cached;
        return copyRows_(cached);
      }
    }
    var rows = readAllFresh_(name);
    execMemo[name] = rows;
    if (HOT_TABLES[name]) cachePut_(name, rows, HOT_TABLES[name]);
    return copyRows_(rows);
  }

  /** 直接讀試算表（繞過快取） */
  function readAllFresh_(name) {
    var sh = sheet_(name);
    var last = sh.getLastRow();
    if (last < 2) return [];
    var headers = headers_(name);
    var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
    return values.map(function (row, i) {
      var o = rowToObj_(headers, row);
      o._rowIndex = i + 2;
      return o;
    });
  }

  function find(name, predicate) {
    return readAll(name).filter(predicate);
  }

  function findOne(name, predicate) {
    var all = readAll(name);
    for (var i = 0; i < all.length; i++) if (predicate(all[i])) return all[i];
    return null;
  }

  function getById(name, id) {
    return findOne(name, function (r) { return r.id === id; });
  }

  /** 新增一筆（自動補共通欄位）。回傳完整物件。 */
  function insert(name, obj, actorId) {
    var headers = headers_(name);
    var record = {};
    headers.forEach(function (h) { record[h] = obj[h] !== undefined ? obj[h] : ''; });
    if (headers.indexOf('id') >= 0 && !record.id) record.id = uuid_();
    var ts = fmtDateTime_();
    if (headers.indexOf('createdAt') >= 0 && !record.createdAt) record.createdAt = ts;
    if (headers.indexOf('createdBy') >= 0 && !record.createdBy) record.createdBy = actorId || 'system';
    if (headers.indexOf('updatedAt') >= 0) record.updatedAt = ts;
    if (headers.indexOf('updatedBy') >= 0) record.updatedBy = actorId || 'system';
    if (headers.indexOf('isActive') >= 0 && record.isActive === '') record.isActive = true;
    // appendRow 本身為原子操作，純新增不需全域鎖（避免所有 API 互相排隊）
    sheet_(name).appendRow(objToRow_(headers, record));
    invalidate_(name);
    return record;
  }

  /** 依 id 更新部分欄位。回傳更新後物件。 */
  function update(name, id, patch, actorId) {
    var headers = headers_(name);
    return withLock_(function () {
      var row = getById(name, id);
      if (!row) {
        // 快取可能過舊（缺新列）→ 強制重讀一次
        invalidate_(name);
        execMemo[name] = readAllFresh_(name);
        row = getById(name, id);
      }
      if (!row) throw new Error('Record not found in ' + name + ': ' + id);
      var merged = {};
      headers.forEach(function (h) { merged[h] = (patch[h] !== undefined) ? patch[h] : row[h]; });
      if (headers.indexOf('updatedAt') >= 0) merged.updatedAt = fmtDateTime_();
      if (headers.indexOf('updatedBy') >= 0) merged.updatedBy = actorId || 'system';
      sheet_(name).getRange(row._rowIndex, 1, 1, headers.length)
        .setValues([objToRow_(headers, merged)]);
      merged._rowIndex = row._rowIndex;
      invalidate_(name);
      return merged;
    });
  }

  /** key-value 表 upsert（SystemSettings / Sequences） */
  function upsertByKey(name, keyField, keyValue, obj) {
    return withLock_(function () {
      var headers = headers_(name);
      var existing = findOne(name, function (r) { return r[keyField] === keyValue; });
      var record = {};
      headers.forEach(function (h) {
        record[h] = obj[h] !== undefined ? obj[h] : (existing ? existing[h] : '');
      });
      record[keyField] = keyValue;
      if (headers.indexOf('updatedAt') >= 0) record.updatedAt = fmtDateTime_();
      if (existing) {
        sheet_(name).getRange(existing._rowIndex, 1, 1, headers.length).setValues([objToRow_(headers, record)]);
      } else {
        sheet_(name).appendRow(objToRow_(headers, record));
      }
      invalidate_(name);
      return record;
    });
  }

  /** 硬刪除：自試算表實際刪除符合條件的列（deleteRow）。傳回刪除筆數。 */
  function removeWhere(name, predicate) {
    return withLock_(function () {
      invalidate_(name);
      var rows = readAllFresh_(name).filter(predicate);
      if (!rows.length) return 0;
      rows.sort(function (a, b) { return b._rowIndex - a._rowIndex; });   // 由下往上刪，避免列號位移
      var sh = sheet_(name);
      rows.forEach(function (r) { sh.deleteRow(r._rowIndex); });
      invalidate_(name);
      return rows.length;
    });
  }

  /** 硬刪除單筆（依 id） */
  function remove(name, id) {
    return removeWhere(name, function (r) { return r.id === id; });
  }

  /** 以 script lock 執行寫入，30 秒逾時 */
  function withLock_(fn) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { return fn(); }
    finally { lock.releaseLock(); }
  }

  return {
    readAll: readAll, find: find, findOne: findOne, getById: getById,
    insert: insert, update: update, upsertByKey: upsertByKey, withLock: withLock_,
    remove: remove, removeWhere: removeWhere
  };
})();

/* ============================== AuditService.gs ============================== */
/**
 * AuditService.gs — Audit Trail 寫入
 * 只提供寫入與（Admin/T5）查詢；無更新/刪除 API。
 */

var AuditService = (function () {

  /**
   * @param {Object} p {user, actionType, entityType, entityId, ptwNumber, oldValue, newValue, comment, sessionId, clientInfo, userAgent, success}
   */
  function log(p) {
    try {
      Repo.insert('AuditLog', {
        userId: p.user ? p.user.id : '',
        userName: p.user ? (p.user.nameEn || p.user.nameZh || p.user.email) : (p.userName || 'anonymous'),
        companyId: p.user ? p.user.companyId : '',
        tier: p.user ? p.user.tier : '',
        actionType: p.actionType || '',
        entityType: p.entityType || '',
        entityId: p.entityId || '',
        ptwNumber: p.ptwNumber || '',
        oldValue: truncate_(p.oldValue),
        newValue: truncate_(p.newValue),
        comment: p.comment || '',
        sessionId: p.sessionId || '',
        clientInfo: p.clientInfo || '',
        userAgent: p.userAgent || '',
        success: p.success !== false,
        timestamp: fmtDateTime_()
      }, p.user ? p.user.id : 'system');
    } catch (e) {
      // Audit 失敗不可中斷業務，但記到 console 供 Stackdriver 追蹤
      console.error('AuditService.log failed: ' + e.message);
    }
  }

  function truncate_(v) {
    if (v === undefined || v === null) return '';
    var s = (typeof v === 'string') ? v : JSON.stringify(v);
    return s.length > 4000 ? s.substring(0, 4000) + '…[truncated]' : s;
  }

  /** Admin / Tier 5 查詢 */
  function list(user, payload) {
    SecurityService.requireAdminOrTier5(user);
    var rows = Repo.readAll('AuditLog');
    var f = payload || {};
    if (f.userId) rows = rows.filter(function (r) { return r.userId === f.userId; });
    if (f.actionType) rows = rows.filter(function (r) { return r.actionType === f.actionType; });
    if (f.ptwNumber) rows = rows.filter(function (r) { return r.ptwNumber === f.ptwNumber; });
    if (f.dateFrom) rows = rows.filter(function (r) { return r.timestamp >= f.dateFrom; });
    if (f.dateTo) rows = rows.filter(function (r) { return r.timestamp <= f.dateTo + ' 23:59:59'; });
    rows.sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : -1; });
    var page = Math.max(1, f.page || 1), size = Math.min(200, f.pageSize || 100);
    return ok_({
      total: rows.length,
      page: page,
      rows: rows.slice((page - 1) * size, page * size).map(function (r) { delete r._rowIndex; return r; })
    });
  }

  return { log: log, list: list };
})();

/* ============================== SecurityService.gs ============================== */
/**
 * SecurityService.gs — RBAC 與資料範圍（後端唯一真相）
 * 前端隱藏按鈕僅為 UX；所有授權判斷在此重做。
 */

var SecurityService = (function () {

  /** 系統管理員或 Tier 5（PTW Coordinator）— Tier 5 擁有全部權限 */
  function requireAdmin(user) {
    if (!user || (!asBool_(user.isAdmin) && Number(user.tier) !== 5)) {
      throw ApiError_('FORBIDDEN', 'Administrator or Tier 5 only', '僅限系統管理員或 Tier 5');
    }
  }

  function requireAdminOrTier5(user) {
    if (!user || (!asBool_(user.isAdmin) && Number(user.tier) !== 5)) {
      throw ApiError_('FORBIDDEN', 'Administrator or Tier 5 only', '僅限系統管理員或 Tier 5');
    }
  }

  function requireTier(user, tiers) {
    if (!user || tiers.indexOf(Number(user.tier)) < 0) {
      throw ApiError_('FORBIDDEN', 'Insufficient tier', '權限不足（Tier）');
    }
  }

  /**
   * PTW 資料範圍過濾：
   * T1/T2 → 本公司全部（同事需能代為申報完工／提前關單）；T3/T4/T5/Admin → 全部
   */
  /** 是否為此 PTW 的主/副持有人（Tier 1 可兼申請人與持有人）— 供「我的 PTW」等區分用 */
  function isHolderOf_(user, ptw) {
    var hit = function (raw) {
      var s = String(raw || '');
      if (!s) return false;
      if (s === user.id) return true;                      // 舊資料：單一 id
      if (s.charAt(0) === '[') {                           // 新資料：JSON 陣列（主/副持有人皆可多位）
        try { return JSON.parse(s).indexOf(user.id) >= 0; } catch (e) {}
      }
      return false;
    };
    return hit(ptw.holderUserId) || hit(ptw.coHolderUserId);
  }

  /** 測試資料隔離：測試人員建立的 PTW（含 Example-001）僅測試身分可見 */
  function stripTestPtws(user, rows) {
    if (user && (asBool_(user.isTestUser) || asBool_(user.isAdmin) || Number(user.tier) === 5)) return rows; // 管理員/協調員看得到全部
    var testIds = {};
    Repo.find('Users', function (u) { return asBool_(u.isTestUser); })
      .forEach(function (u) { testIds[u.id] = true; });
    return rows.filter(function (r) { return !testIds[r.applicantUserId]; });
  }

  function scopePtwList(user, rows) {
    rows = stripTestPtws(user, rows);
    var tier = Number(user.tier);
    if (asBool_(user.isAdmin) || tier >= 3) return rows;
    // Tier 1–2 承商：可見本公司全部 PTW（同事需能代為申報完工／提前關單）；
    // 跨公司隔離不變 —— 承商 A 永遠看不到承商 B 的 PTW。
    return rows.filter(function (r) { return r.companyId === user.companyId; });
  }

  /** 單筆 PTW 讀取授權（竄改 id/URL 亦無效） */
  function canViewPtw(user, ptw) {
    var tier = Number(user.tier);
    if (asBool_(user.isAdmin) || tier >= 3) return true;
    // Tier 1–2 承商：本公司 PTW 皆可讀（與 scopePtwList 一致）
    return ptw.companyId === user.companyId;
  }

  function assertCanViewPtw(user, ptw) {
    if (!canViewPtw(user, ptw)) {
      throw ApiError_('FORBIDDEN_SCOPE', 'You are not allowed to view this PTW', '您無權查看此 PTW');
    }
  }

  /**
   * 簽核授權：需為當前關卡 Tier（或有效代理人），且不得為申請人本人。
   */
  function assertCanReview(user, ptw) {
    var tier = Number(user.tier);
    var current = Number(ptw.currentTier);
    if (ptw.applicantUserId === user.id) {
      throw ApiError_('SELF_APPROVAL', 'You cannot review your own PTW', '不得審核自己申請的 PTW');
    }
    if (tier === current) {
      if (tier === 2 && ptw.companyId !== user.companyId) {
        throw ApiError_('FORBIDDEN_SCOPE', 'Tier 2 must belong to the applicant company', 'Tier 2 須為申請公司之工安');
      }
      return true;
    }
    // 代理簽核
    var today = fmtDateTime_();
    var delegation = Repo.findOne('Delegations', function (d) {
      return asBool_(d.isActive) && d.delegateUserId === user.id && Number(d.tier) === current &&
        d.validFrom <= today && today <= d.validTo;
    });
    if (delegation) return true;
    throw ApiError_('NOT_YOUR_TURN', 'This PTW is not pending your tier', '此 PTW 目前非您的簽核關卡');
  }

  /** 簡易 rate limit（CacheService 計數器） */
  function rateLimit(key, maxPerHour) {
    var cache = CacheService.getScriptCache();
    var k = 'rl_' + key;
    var n = Number(cache.get(k) || 0) + 1;
    cache.put(k, String(n), 3600);
    if (n > maxPerHour) throw ApiError_('RATE_LIMITED', 'Too many requests, try later', '嘗試次數過多，請稍後再試');
  }

  return { stripTestPtws: stripTestPtws,
    requireAdmin: requireAdmin,
    requireAdminOrTier5: requireAdminOrTier5,
    requireTier: requireTier,
    scopePtwList: scopePtwList,
    canViewPtw: canViewPtw,
    assertCanViewPtw: assertCanViewPtw,
    assertCanReview: assertCanReview,
    rateLimit: rateLimit
  };
})();

/* ============================== SequenceService.gs ============================== */
/**
 * SequenceService.gs — 編號產生（LockService 臨界區，防多人同時申請衝突）
 * key：PTW / TMP / HW / GW / DO / RG / CS / EC / EI
 */

var SequenceService = (function () {

  var FORMATS = {
    PTW: 'OPTW-{0000}',
    TMP: 'Draft-OPTW-{0000}',
    HW: 'HW-{0000}', GW: 'GW-{0000}', DO: 'DO-{0000}', RG: 'RG-{0000}',
    CS: 'CS-{0000}', EC: 'EC-{0000}', EI: 'EI-{0000}', PI: 'PI-{0000}'
  };

  /** 已使用號碼集合：直接掃描實際資料（已發出的號碼永不更動，只找空號補上） */
  function usedNumbers_(key) {
    var used = {};
    var take = function (v) {
      var mm = String(v || '').match(/(\d+)\s*$/);
      if (mm) used[Number(mm[1])] = true;
    };
    if (key === 'PTW') {
      Repo.readAll('PTW_Master').forEach(function (p) { if (p.ptwNumber) take(p.ptwNumber); });
    } else if (key === 'TMP') {
      Repo.readAll('PTW_Master').forEach(function (p) { if (p.tempNumber) take(p.tempNumber); });
    } else {
      Repo.readAll('PTW_Certificates').forEach(function (c) {
        if (c.certType === key && c.certNo) take(c.certNo);
      });
    }
    return used;
  }

  /** 原子取下一號：優先補中間空號；已存在的號碼一律保留不動。 */
  function next(key) {
    if (!FORMATS[key]) throw new Error('Unknown sequence key: ' + key);
    return Repo.withLock(function () {
      var row = Repo.findOne('Sequences', function (r) { return r.key === key; });
      // 舊版預設格式自動升級為新格式（僅覆蓋歷史預設值，不影響自訂格式）
      var LEGACY = ['NMDC-Offshore-{0000}', 'TMP-Offshore-{0000}', 'PTW-Offshore-{0000}'];
      var format = (row && row.format && LEGACY.indexOf(row.format) < 0) ? row.format : FORMATS[key];

      var used = usedNumbers_(key);
      // 已發出但尚未寫入資料列的號碼：短期預約（避免同時申請拿到同號）
      var cache = CacheService.getScriptCache();
      var maxUsed = 0;
      Object.keys(used).forEach(function (n) {
        if (Number(n) > maxUsed) maxUsed = Number(n);
        try { cache.remove('seqres_' + key + '_' + n); } catch (e) {}  // 已寫入資料列 → 解除預約
      });
      var value = 0;
      for (var i = 1; i <= maxUsed + 50; i++) {
        if (used[i]) continue;
        if (cache.get('seqres_' + key + '_' + i)) continue;   // 已預約（尚未寫入資料列）
        value = i; break;
      }
      if (!value) value = maxUsed + 1;
      try { cache.put('seqres_' + key + '_' + value, '1', 300); } catch (e) {}

      var counter = Math.max(Number((row && row.currentValue) || 0), maxUsed, value);
      Repo.upsertByKey('Sequences', 'key', key, { currentValue: counter, format: format });
      return render_(format, value);
    });
  }

  function render_(format, value) {
    return format.replace(/\{0+\}/, function (m) {
      var width = m.length - 2;
      var s = String(value);
      while (s.length < width) s = '0' + s;
      return s;
    });
  }

  return { next: next };
})();

/* ============================== NotificationService.gs ============================== */
/**
 * NotificationService.gs — 系統內通知 + Email
 * M3.1 範圍：帳號相關通知（申請/核准/拒絕/密碼重設）。PTW 通知於 M3.4 擴充。
 * Email 不含密碼或敏感資料。
 */

var NotificationService = (function () {

  var SENDER_NAME = 'NMDC Offshore PTW System Notification';

  function systemName_() {
    return getSetting_('systemNameEn') + ' 離岸工作許可系統';
  }

  function frontendUrl_() {
    var u = getProp_('FRONTEND_URL', true);
    if (u) return u;
    try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
  }

  /** PTW 直達連結：?ptw=<id>（登入後自動開啟該張 PTW） */
  function ptwLink_(ptwId) {
    var base = frontendUrl_();
    if (!base) return '';
    if (ptwId && typeof ptwId === 'object') ptwId = ptwId.id || '';   // 示範物件
    if (!ptwId) return base;
    return base + (base.indexOf('?') < 0 ? '?' : '&') + 'ptw=' + encodeURIComponent(ptwId);
  }

  /** 寫入站內通知 */
  function push_(userId, type, ptwId, titleEn, titleZh, msgEn, msgZh, emailTo) {
    var n = Repo.insert('Notifications', {
      userId: userId, type: type,
      ptwId: (ptwId && typeof ptwId === 'object') ? (ptwId.id || '') : (ptwId || ''),   // 可傳快照物件
      titleEn: titleEn, titleZh: titleZh, messageEn: msgEn, messageZh: msgZh,
      isRead: false, emailSent: false, emailSentAt: ''
    }, 'system');
    if (emailTo) {
      try {
        MailApp.sendEmail({
          to: emailTo,
          name: SENDER_NAME,
          subject: '[' + systemName_() + '] ' + titleEn + ' / ' + titleZh,
          htmlBody: emailBody_(titleEn, titleZh, msgEn, msgZh, ptwId, type)
        });
        Repo.update('Notifications', n.id, { emailSent: true, emailSentAt: fmtDateTime_() }, 'system');
      } catch (e) {
        console.error('Email send failed: ' + e.message);
      }
    }
    return n;
  }

  /* ===== 郵件版面（Outlook 相容：全表格式排版、逐格指定字型與底色） ===== */
  // ⚠️ Outlook（Word 引擎）不會為中文往後找字型堆疊，一律用「東亞字型」（預設新細明體）。
  //    正黑體放第一個 + mso-fareast-font-family，中文才會是正黑體。每個 <td>/<span> 都要帶。
  // \u7cbe\u7c21\u7248\uff1aascii/hansi/bidi \u7531\u4e0b\u65b9 MSO_HEAD \u7684\u689d\u4ef6\u5f0f\u6a23\u5f0f\u4ee5 !important \u7d71\u4e00\u6307\u5b9a\uff0c
  // \u5167\u5d4c\u53ea\u4fdd\u7559\u5b57\u578b\u5806\u758a\u8207 mso-fareast\uff08Word \u5f15\u64ce\u7684\u6771\u4e9e\u5b57\u578b\u95dc\u9375\uff0c\u5c11\u4e86\u5b83\u4e2d\u6587\u6703\u8b8a\u65b0\u7d30\u660e\u9ad4\uff09\u3002
  // \u6bcf\u5c01\u4fe1\u53ef\u7701\u4e0b\u7d04\u4e09\u5206\u4e4b\u4e00\u9ad4\u7a4d\uff0c\u907f\u514d Gmail \u8d85\u904e 102KB \u88ab\u622a\u65b7\u3002
  var MAIL_FONT = "font-family:'Microsoft JhengHei','\u5fae\u8edf\u6b63\u9ed1\u9ad4','Segoe UI','PingFang TC',Arial,sans-serif;" +
    "mso-fareast-font-family:'Microsoft JhengHei';";
  var MSO_HEAD = '<!--[if mso]><style type="text/css">' +
    "body,table,td,th,div,p,span,a{font-family:'Microsoft JhengHei','Segoe UI',Arial,sans-serif !important;" +
    "mso-fareast-font-family:'Microsoft JhengHei' !important;mso-ascii-font-family:'Microsoft JhengHei' !important;" +
    "mso-hansi-font-family:'Microsoft JhengHei' !important;}" +
    'table{mso-table-lspace:0pt;mso-table-rspace:0pt;}</style><![endif]-->';

  /** 事件 → 樣式（大字橫幅顏色/圖示） */
  function eventStyle_(type) {
    var t = String(type || '');
    if (/PENDING_REVIEW|CLOSEOUT_REVIEW|PENDING_CLOSEOUT|EXTENSION_REQUEST/.test(t))
      return { color: '#8a5a00', bg: '#fdf3e0', icon: '\ud83d\udcdd' };            // 待審核（橘）
    if (/DELET/.test(t))
      return { color: '#b02121', bg: '#fdeaea', icon: '🗑️' };       // 刪除（紅・垃圾桶）
    if (/RETURN|REJECT|EXPIR|OVERDUE|SUSPEND|CANCEL/.test(t))
      return { color: '#b02121', bg: '#fdeaea', icon: '\u26a0\ufe0f' };            // 退回/逾期/暫停（紅）
    if (/APPROV|ISSUED|ACTIVAT|CLOSED|RESUM|PASS/.test(t))
      return { color: '#1e6e34', bg: '#e9f6ee', icon: '\u2705' };                   // 核准/核發/關單（綠）
    return { color: '#0b3a5c', bg: '#eaf2f9', icon: '\ud83d\udce9' };              // 一般（藍）
  }

  /**
   * 信件外殼（Outlook/Gmail 皆相容）：
   * 深藍抬頭 → （可選）大字狀態橫幅 → 白色內文 → 按鈕 → 頁尾。全部用 table + bgcolor。
   */
  function mailShell_(icon, titleLine, contentHtml, buttonsHtml, bannerHtml) {
    var td = 'style="' + MAIL_FONT + '';
    return '' +
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' + MSO_HEAD + '</head>' +
      '<body style="margin:0;padding:0;background-color:#eef2f6;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f6">' +
      '<tr><td align="center" style="padding:20px 8px">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">' +
      // \u2500\u2500 \u62ac\u982d
      '<tr><td bgcolor="#0b3a5c" ' + td + 'background-color:#0b3a5c;padding:16px 22px 14px">' +
        '<span style="' + MAIL_FONT + 'font-size:12px;letter-spacing:1px;color:#9ec9e8;font-weight:bold">' +
        'NMDC PTW&nbsp;|&nbsp;\u96e2\u5cb8\u5de5\u4f5c\u8a31\u53ef\u7cfb\u7d71 OFFSHORE PTW SYSTEM</span><br>' +
        '<span style="' + MAIL_FONT + 'font-size:19px;font-weight:bold;color:#ffffff;line-height:1.5">' + icon + '&nbsp;' + titleLine + '</span><br>' +
        '<span style="' + MAIL_FONT + 'font-size:12px;color:#bcd6ea">\u901a\u9704\u96fb\u5ee0\u4e8c\u671f\u66f4\u65b0\u6539\u5efa\u8a08\u756b\u6d77\u5e95\u8f38\u6c23\u7ba1\u7dda\u7d71\u5305\u5de5\u7a0b\uff08P2913\uff09</span>' +
      '</td></tr>' +
      (bannerHtml || '') +
      // \u2500\u2500 \u5167\u6587
      '<tr><td bgcolor="#ffffff" ' + td + 'background-color:#ffffff;padding:20px 22px;color:#223344;font-size:14px;line-height:1.7">' +
        contentHtml + '</td></tr>' +
      (buttonsHtml
        ? '<tr><td bgcolor="#ffffff" align="center" ' + td + 'background-color:#ffffff;padding:0 22px 22px">' + buttonsHtml + '</td></tr>'
        : '') +
      // \u2500\u2500 \u9801\u5c3e
      '<tr><td bgcolor="#f4f7fa" ' + td + 'background-color:#f4f7fa;border-top:1px solid #e1e8ef;padding:14px 22px;color:#7a8ba0;font-size:12px;line-height:1.8">' +
        '<b style="color:#4a5f75">\u901a\u9704\u96fb\u5ee0\u4e8c\u671f\u66f4\u65b0\u6539\u5efa\u8a08\u756b\u6d77\u5e95\u8f38\u6c23\u7ba1\u7dda\u7d71\u5305\u5de5\u7a0b</b><br>' +
        '\u672c\u4fe1\u4ef6\u7531\u7cfb\u7d71\u81ea\u52d5\u767c\u9001\uff0c\u8acb\u52ff\u76f4\u63a5\u56de\u8986\u3002This is an automated message \u2014 please do not reply.<br>' +
        '\u767c\u9001\u6642\u9593 Sent\uff1a' + fmtDateTime_() +
      '</td></tr>' +
      '</table></td></tr></table></body></html>';
  }

  /** 大字狀態橫幅（左色條 + 大標 + 英文副標） */
  function statusBanner_(type, bigZh, smallEn) {
    var st = eventStyle_(type);
    return '<tr><td bgcolor="' + st.bg + '" style="background-color:' + st.bg + '">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td width="6" bgcolor="' + st.color + '" style="background-color:' + st.color + ';width:6px;font-size:1px">&nbsp;</td>' +
      '<td style="' + MAIL_FONT + 'padding:14px 18px">' +
        '<span style="' + MAIL_FONT + 'font-size:21px;font-weight:bold;color:' + st.color + ';line-height:1.4">' + st.icon + ' ' + bigZh + '</span><br>' +
        '<span style="' + MAIL_FONT + 'font-size:13px;color:#5a6d82">' + smallEn + '</span>' +
      '</td></tr></table></td></tr>';
  }

  /** PTW \u8cc7\u8a0a\u8868\uff08label / value \u5169\u6b04\uff1bOutlook \u76f8\u5bb9\uff09 */
  /** 實際狀態：Active/Extended 但已過 validTo → 逾期未關 Overdue（與看板同一判斷邏輯） */
  function effStatus_(m) {
    var S = CFG.STATUS, st = String(m.status || '');
    if (m._statusText) return { text: String(m._statusText), color: m._statusColor || '#b02121', overdue: false, raw: '' };
    var openSet = [S.ACTIVE, S.EXTENDED, S.WORK_COMPLETED, S.SUSPENDED, S.PENDING_CLOSEOUT, S.EXPIRED];
    if (m.validTo && String(m.validTo) < fmtDateTime_() && openSet.indexOf(st) >= 0) {
      return { text: '逾期未關 Overdue (Not Closed)', color: '#c62828', overdue: true, raw: st };
    }
    if (st === S.ACTIVE || st === S.EXTENDED) return { text: st, color: '#1e7e34', overdue: false, raw: st };
    return { text: st || '—', color: '#223344', overdue: false, raw: st };
  }
  function effStatusHtml_(m) {
    var e = effStatus_(m);
    return '<b style="color:' + e.color + '">' + (e.overdue ? '🔴 ' : '') + e.text + '</b>' +
      (e.overdue && e.raw ? ' <span style="color:#8b98a8;font-size:12px">(' + e.raw + ')</span>' : '');
  }

  function ptwInfoTable_(ptwId) {
    if (!ptwId) return '';
    var m = (typeof ptwId === 'object') ? ptwId : Repo.getById('PTW_Master', ptwId);   // 可直接傳示範物件
    if (!m) return '';
    var co = m.companyId ? Repo.getById('Companies', m.companyId) : null;
    var coName = m._companyName || (co ? (co.nameZh || co.nameEn) : '\u2014');
    var nameList = function (raw) {
      var s2 = String(raw || ''); var ids = [];
      if (s2.charAt(0) === '[') { try { ids = JSON.parse(s2); } catch (e) {} } else if (s2) { ids = [s2]; }
      return ids.map(function (id) { var u = Repo.getById('Users', id); return u ? (u.nameZh || u.nameEn) : ''; })
        .filter(Boolean).join('\u3001');
    };
    var holderName = m._holderName || nameList(m.holderUserId);
    var coHolderName = m._coHolderName || nameList(m.coHolderUserId);
    var rows = [
      ['PTW \u7de8\u865f', '<b style="color:#0b6bcb;font-size:15px">' + (m.ptwNumber || m.tempNumber) + '</b>'],
      ['\u627f\u5546 Company', coName],
      ['\u6709\u6548\u671f\u9593 Duration', String(m.validFrom || '').substring(0, 10) + ' \u2192 ' + String(m.validTo || '').substring(0, 10)],
      ['\u8239\u8236 Vessel', String(m.vessel || '\u2014')],
      ['\u5de5\u4f5c\u5340\u57df Area', String(m.areaLocation || '\u2014')],
      ['\u5de5\u4f5c\u5167\u5bb9 Work', String(m.workDescription || '\u2014').substring(0, 120)],
      ['\u4e3b\u6301\u6709\u4eba Holder', holderName || '\u2014'],
      ['\u526f\u6301\u6709\u4eba Co-Holder', coHolderName || '\u2014'],
      ['\u72c0\u614b Status', effStatusHtml_(m)]
    ];
    var h = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border:1px solid #dfe7ee;margin:10px 0 4px">';
    rows.forEach(function (r, i) {
      var bb = (i < rows.length - 1) ? 'border-bottom:1px solid #e9eef4;' : '';
      h += '<tr>' +
        '<td width="34%" bgcolor="#f4f7fa" style="' + MAIL_FONT + 'background-color:#f4f7fa;color:#5a6d82;font-weight:bold;padding:9px 12px;font-size:13px;' + bb + '">' + r[0] + '</td>' +
        '<td bgcolor="#ffffff" style="' + MAIL_FONT + 'background-color:#ffffff;color:#223344;padding:9px 12px;font-size:13.5px;' + bb + '">' + r[1] + '</td></tr>';
    });
    return h + '</table>';
  }

  /** \u6309\u9215\uff08table \u5305\u88dd\uff0cOutlook \u4fdd\u7559 padding\uff09 */
  function mailButton_(href, label, color) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>' +
      '<td bgcolor="' + color + '" style="background-color:' + color + ';padding:12px 32px">' +
      '<a href="' + href + '" style="' + MAIL_FONT + 'color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block">' +
      label + '</a></td></tr></table>';
  }

  /** 條件式區塊（核發信的「配合事項」用）：標題列 + 條列 */
  function condBlock_(icon, titleZh, titleEn, color, bg, items) {
    if (!items.length) return '';
    var h = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0">' +
      '<tr><td bgcolor="' + color + '" style="background-color:' + color + ';padding:8px 12px">' +
      '<span style="' + MAIL_FONT + 'color:#ffffff;font-weight:bold;font-size:13.5px">' + icon + ' ' + titleZh +
      ' <span style="font-weight:normal;font-size:11.5px;color:#e6eef6">' + titleEn + '</span></span></td></tr>' +
      '<tr><td bgcolor="' + bg + '" style="background-color:' + bg + ';padding:4px 12px 10px;border:1px solid ' + color + ';border-top:0">';
    items.forEach(function (it) {
      h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td width="18" valign="top" style="' + MAIL_FONT + 'padding:6px 0 0;font-size:13px;color:' + color + '">▪</td>' +
        '<td style="' + MAIL_FONT + 'padding:6px 0 0;font-size:13px;line-height:1.65;color:#22323f">' +
        '<b>' + it[0] + '</b><br><span style="font-size:11.5px;color:#6b7c8d">' + it[1] + '</span></td></tr></table>';
    });
    return h + '</td></tr></table>';
  }

  /**
   * PTW 核發生效信的「配合事項 / Conditions of Issue」。
   * 依該 PTW 勾選的作業類型與氣測需求動態組合，只列與這張許可證相關的要求。
   */
  function issueConditions_(m) {
    if (!m) return '';
    var yes = function (v) { return asBool_(v); };
    var hot = yes(m.wtHotWork), cs = yes(m.wtConfinedSpace), dive = yes(m.wtDiving),
        rad = yes(m.wtRadiography), exc = yes(m.wtExcavation), eiso = yes(m.wtElectricalIso),
        piso = yes(m.wtProcessIso), scaf = (String(m.scaffoldingRequired) === 'Y'),
        gas = (String(m.gasTestRequired) === 'Y') || hot || cs;

    // 1) 開工前必辦
    var before = [
      ['列印「現場聯 Site Copy」並張貼於作業地點', 'Print the A4 Site Copy and post it at the worksite; it must stay on site for the whole duration.'],
      ['每班次開工前召開 TBM 及 HIP 並全員簽名', 'Hold the Toolbox Meeting and Hazard Identification Process before every shift; all personnel must sign.'],
      ['確認持有人在場，且人員資格與證照均在有效期內', 'The permit holder must be present; verify every worker’s competency and certificate validity.'],
      ['確認個人防護具（PPE）齊全並正確穿戴', 'Confirm correct PPE is available and worn by all personnel.']
    ];
    if (gas) before.push(['作業前完成氣體測試並記錄於氣體監測記錄表（O₂ 18–23.5%、LEL <5%、CO ≤35ppm、H₂S ≤1ppm）',
      'Complete gas testing before entry/start and log the readings (O₂ 18–23.5%, LEL <5%, CO ≤35 ppm, H₂S ≤1 ppm).']);
    if (cs) before.push(['局限空間：設置進出管制表、指派合格監視人、持續通風、備妥救援設備與撤離計畫',
      'Confined space: entry control log in place, trained attendant posted, continuous ventilation, rescue equipment and evacuation plan ready.']);
    if (hot) before.push(['動火作業：清除 11 公尺內可燃物、備妥滅火器與防火毯、指派火警監視人',
      'Hot work: clear combustibles within 11 m, fire extinguisher and fire blanket on hand, dedicated fire watch assigned.']);
    if (eiso || piso) before.push(['能源／製程隔離：完成 LOTO 上鎖掛牌，並以零能量驗證後方可施工',
      'Energy / process isolation: LOTO applied and verified at zero-energy state before work begins.']);
    if (scaf) before.push(['施工架經合格人員搭設並掛牌；每日使用前檢點，高處作業維持 100% tie-off',
      'Scaffolding erected and tagged by a competent person; inspect before use daily; maintain 100% tie-off at height.']);
    if (dive) before.push(['潛水作業：確認潛水計畫、潛水員證照、水面支援與 DP/船舶警戒已就位',
      'Diving: dive plan, diver certificates, surface support and DP/vessel standby confirmed.']);
    if (rad) before.push(['輻射作業：設立管制區與警示標誌，非作業人員撤離，射源帳管確實',
      'Radiography: controlled area barricaded and signed, non-essential personnel withdrawn, source accounted for.']);
    if (exc) before.push(['開挖作業：完成地下管線調查、邊坡支撐與開口防護',
      'Excavation: underground services survey completed; shoring and edge protection in place.']);

    // 2) 執行期間
    var during = [
      ['僅可於本許可證載明之<b>區域、工作內容與有效期間</b>內施工', 'Work only within the area, scope and validity stated on this permit.'],
      ['現場聯每日由持有人簽名驗證；交接班須重新確認', 'The holder signs the Site Copy daily; re-validate at every shift handover.'],
      ['作業條件改變、中斷或發生異常時<b>立即停工</b>，重新評估並確認後始得復工',
        'Stop work immediately if conditions change, work is interrupted or an abnormality occurs; reassess before resuming.']
    ];
    if (gas) during.push(['依核定頻率持續進行氣體測試；數值超標立即撤離並通報',
      'Continue gas testing at the approved frequency; evacuate and report immediately if readings exceed limits.']);
    during.push(['發生事故、虛驚或洩漏，立即通報 NMDC EHS 與船舶／現場負責人',
      'Report any incident, near-miss or release immediately to NMDC EHS and the vessel/site supervisor.']);
    during.push(['許可證逾期或被暫停／撤銷時，<b>一律不得繼續作業</b>',
      'No work may continue once the permit has expired, been suspended or revoked.']);

    // 3) 關單前
    var closeout = [
      ['作業完成後復原現場、移除設備與臨時設施，確認區域回復安全狀態',
        'On completion, restore the area, remove equipment and temporary works, and confirm the site is left safe.'],
    ];
    // 關單文件一律引用 CloseoutRules —— 與系統實際擋件規則同一份來源，信與系統不會不一致
    try {
      CloseoutRules.forPtw(m).forEach(function (d) {
        var req = (d.level === 'required');
        var tailZh = req ? '（必要，未上傳無法申報完工）' : (d.level === 'recommended' ? '（依作業類型強烈建議）' : '（選配）');
        var tailEn = req ? ' (mandatory — completion cannot be declared without it).'
                         : (d.level === 'recommended' ? ' (strongly recommended for this work type).' : ' (optional).');
        closeout.push(['上傳<b>' + d.zh + '</b>' + tailZh, 'Upload the ' + d.en + tailEn]);
      });
    } catch (eR) {}
    closeout.push(['於系統申報完工，依序經承商職安衛 → NMDC 施工 → EHS → 協調員確認後正式關單',
      'Declare completion in the system; close-out is confirmed in sequence by Contractor HSE → NMDC Construction → EHS → Coordinator.']);

    return condBlock_('✅', '開工前必辦', 'Before work starts', '#1e6e34', '#f2faf5', before) +
      condBlock_('🚧', '執行期間', 'While work is in progress', '#8a5a00', '#fffaf0', during) +
      condBlock_('🏁', '關單前需完成', 'Before close-out', '#0b5a94', '#f3f8fd', closeout);
  }

  function emailBody_(titleEn, titleZh, msgEn, msgZh, ptwId, type) {
    var link = ptwLink_(ptwId) || frontendUrl_();
    var isReview = /PENDING_REVIEW|CLOSEOUT_REVIEW/.test(String(type || ''));
    // 快照物件（如已刪除的 PTW）其 id 為空 → 按鈕退回「開啟系統」
    var linkId = (ptwId && typeof ptwId === 'object') ? (ptwId.id || '') : (ptwId || '');
    var btnText = linkId
      ? (isReview ? '\ud83d\udcdd \u7acb\u5373\u524d\u5f80\u5be9\u6838 Review Now' : '\ud83d\udcc4 \u958b\u555f\u6b64 PTW Open PTW')
      : '\ud83d\udda5 \u958b\u555f\u7cfb\u7d71 Open System';
    var banner = statusBanner_(type, titleZh, titleEn);
    var content = '' +
      '<span style="' + MAIL_FONT + 'font-size:14.5px;color:#223344;line-height:1.8">' + msgZh + '</span><br>' +
      '<span style="' + MAIL_FONT + 'font-size:12.5px;color:#68798d;line-height:1.7">' + msgEn + '</span>' +
      ptwInfoTable_(ptwId) +
      // 核發生效：附上依作業類型動態組出的「配合事項 Conditions of Issue」
      (/ISSUED|CC_PTWISSUED/.test(String(type || ''))
        ? (function () {
            var mm = (ptwId && typeof ptwId === 'object') ? ptwId : (ptwId ? Repo.getById('PTW_Master', ptwId) : null);
            var blocks = issueConditions_(mm);
            if (!blocks) return '';
            return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0">' +
              '<tr><td style="' + MAIL_FONT + 'font-size:15px;font-weight:bold;color:#0b3a5c;' +
              'border-left:5px solid #0b6bcb;padding:2px 0 2px 10px">⚠️ 配合事項 ' +
              '<span style="font-size:12px;font-weight:normal;color:#68798d">Conditions of Issue — ' +
              '本許可證之核發以下列條件為前提</span></td></tr></table>' + blocks;
          })()
        : '');
    var buttons = (link
      ? mailButton_(link, btnText, isReview ? '#1e7e34' : '#0b3a5c') +
        '<span style="' + MAIL_FONT + 'color:#98a7b8;font-size:11px;line-height:1.6"><br>' +
        '\u82e5\u6309\u9215\u7121\u6cd5\u9ede\u64ca\uff0c\u8acb\u8907\u88fd\u6b64\u9023\u7d50 If the button does not work, copy this link:<br>' +
        '<a href="' + link + '" style="color:#0b6bcb;word-break:break-all">' + link + '</a></span>'
      : '');
    return mailShell_('\ud83d\udce9', '\u7cfb\u7d71\u901a\u77e5 System Notification', content, buttons, banner);
  }

  // ---------- 帳號情境 ----------

  function notifyAdminsAccountApplied(applicant) {
    var admins = Repo.find('Users', function (u) {
      return asBool_(u.isAdmin) && u.status === 'Active' && asBool_(u.isActive);
    });
    admins.forEach(function (admin) {
      push_(admin.id, 'ACCOUNT_APPLIED', '',
        'New account application', '新帳號申請待審核',
        'Applicant: ' + applicant.nameEn + ' (' + applicant.email + '), applied tier: ' + applicant.appliedTier + '.',
        '申請人：' + applicant.nameZh + '（' + applicant.email + '），預計 Tier：' + applicant.appliedTier + '。',
        admin.email);
    });
    // 額外通知 SystemSettings 內設定的收件人
    var extra = getSetting_('emailRecipients');
    if (extra) {
      try {
        MailApp.sendEmail({
          to: String(extra),
          name: SENDER_NAME,
          subject: '[' + systemName_() + '] New account application 新帳號申請',
          htmlBody: emailBody_('New account application', '新帳號申請待審核',
            'Applicant: ' + applicant.nameEn + ' (' + applicant.email + ')',
            '申請人：' + applicant.nameZh + '（' + applicant.email + '）')
        });
      } catch (e) { console.error(e.message); }
    }
  }

  function sendAccountApproved(user) {
    push_(user.id, 'ACCOUNT_APPROVED', '',
      'Your account has been approved', '您的帳號已核准',
      'You can now log in to the Offshore PTW System with your registered email.',
      '您現在可以使用註冊 Email 登入離岸工作許可系統。',
      user.email);
  }

  function sendAccountRejected(user, reason) {
    push_(user.id, 'ACCOUNT_REJECTED', '',
      'Your account application was rejected', '您的帳號申請未通過',
      'Reason: ' + reason, '原因：' + reason,
      user.email);
  }

  function sendPasswordResetEmail(user, token) {
    var link = frontendUrl_();
    var url = link ? (link + (link.indexOf('?') < 0 ? '?' : '&') + 'resetToken=' + encodeURIComponent(token) +
      '&email=' + encodeURIComponent(user.email)) : '';
    try {
      MailApp.sendEmail({
        to: user.email,
        name: SENDER_NAME,
        subject: '[' + systemName_() + '] Password reset 密碼重設',
        htmlBody: '<div style="font-family:Arial,\'Microsoft JhengHei\',sans-serif">' +
          '<p>A password reset was requested for your account. This link is valid for ' + CFG.RESET_TOKEN_MINUTES + ' minutes.</p>' +
          '<p>您的帳號申請了密碼重設，連結有效期 ' + CFG.RESET_TOKEN_MINUTES + ' 分鐘。</p>' +
          (url ? '<p><a href="' + url + '">Reset password 重設密碼</a></p>'
               : '<p>Reset code 重設碼：<b>' + token + '</b></p>') +
          '<p style="color:#888;font-size:12px">If you did not request this, please ignore this email. 若非您本人申請，請忽略本信。</p>' +
          '</div>'
      });
    } catch (e) { console.error('Reset email failed: ' + e.message); }
  }

  // ---------- 站內通知 API ----------

  function listMine(user, payload) {
    var rows = Repo.find('Notifications', function (n) { return n.userId === user.id && asBool_(n.isActive); });
    rows.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    var unread = rows.filter(function (n) { return !asBool_(n.isRead); }).length;
    var page = Math.max(1, (payload && payload.page) || 1), size = 20;
    return ok_({
      unread: unread, total: rows.length,
      rows: rows.slice((page - 1) * size, page * size).map(function (r) { delete r._rowIndex; return r; })
    });
  }

  function markRead(user, payload) {
    requireFields_(payload, ['notificationId']);
    var n = Repo.getById('Notifications', payload.notificationId);
    if (!n || n.userId !== user.id) throw ApiError_('NOT_FOUND', 'Notification not found', '找不到通知');
    Repo.update('Notifications', n.id, { isRead: true }, user.id);
    return ok_({ read: true });
  }

  /** 直接寄信到外部信箱（非系統使用者；核發通知清單用） */
  function emailRaw(email, titleEn, titleZh, msgEn, msgZh, ptwId, type) {
    try {
      MailApp.sendEmail({
        to: email,
        name: SENDER_NAME,
        subject: '[' + systemName_() + '] ' + titleEn + ' / ' + titleZh,
        htmlBody: emailBody_(titleEn, titleZh, msgEn, msgZh, ptwId, type)
      });
    } catch (e) { console.error('emailRaw failed (' + email + '): ' + e.message); }
  }

  /** 核發通知清單（系統管理） */
  function issueListGet(user) {
    SecurityService.requireAdmin(user);
    return ok_({ list: String(getSetting_('issueNotifyList') || '') });
  }
  function issueListSet(user, payload) {
    SecurityService.requireAdmin(user);
    var raw = String(payload.list || '');
    var emails = raw.split(/[\n,;]+/).map(function (e) { return e.trim(); }).filter(Boolean);
    var bad = emails.filter(function (e) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); });
    if (bad.length) {
      throw ApiError_('BAD_EMAIL', 'Invalid email(s): ' + bad.join(', '), 'Email 格式錯誤：' + bad.join('、'));
    }
    setSetting_('issueNotifyList', emails.join('\n'), user.id);
    AuditService.log({ user: user, actionType: 'ISSUE_NOTIFY_LIST_SET', entityType: 'Settings',
      entityId: 'issueNotifyList', newValue: { count: emails.length }, success: true });
    return ok_({ saved: true, count: emails.length });
  }

  /* ===== 管理員副本信（狀態變動 CC）與每週摘要 ===== */

  /** 所有會寄副本信的事件（key、中文名、英文名）— 管理台勾選與測試信下拉共用 */
  var CC_EVENTS = [
    ['ptwSubmitted',    'PTW 提交送審',            'PTW submitted for review'],
    ['ptwIssued',       'PTW 核發生效',            'PTW issued & active'],
    ['ptwReturned',     'PTW 退回修改',            'PTW returned for revision'],
    ['ptwWorkCompleted','完工申報（進入結案審查）', 'Work completion declared'],
    ['ptwClosed',       'PTW 關單完成',            'PTW closed'],
    ['ptwOverdue',      'PTW 逾期未關提醒',        'PTW overdue (not closed)'],
    ['ptwSuspended',    'PTW 暫停',                'PTW suspended'],
    ['ptwResumed',      'PTW 復工',                'PTW resumed'],
    ['ptwDeleted',      'PTW 刪除',                'PTW deleted by administrator'],
    ['adminOverride',   '管理員調整關卡',          'Admin stage override'],
    ['trainingPassed',  '訓練考試通過',            'Training exam passed'],
    ['accountApplied',  '新帳號申請',              'New account application'],
    ['accountApproved', '帳號核准',                'Account approved']
  ];

  function ccEventDefs() { return CC_EVENTS.slice(); }

  function parseEmails_(raw) {
    return String(raw || '').split(/[\n,;]+/).map(function (e) { return e.trim(); })
      .filter(function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); });
  }

  function ccConfig_() {
    var emails = parseEmails_(getSetting_('ccMailList'));
    var events = {};
    try { events = JSON.parse(getSetting_('ccMailEvents') || '{}') || {}; } catch (e) { events = {}; }
    return { emails: emails, events: events };
  }

  /** 副本通知：eventKey 在管理台未關閉且清單有信箱時，寄給清單所有人 */
  function adminCc(eventKey, titleEn, titleZh, msgEn, msgZh, ptwId) {
    try {
      var cfg = ccConfig_();
      if (!cfg.emails.length) return;
      if (cfg.events[eventKey] === false) return;   // 預設全開；明確設 false 才關閉
      var mailType = 'CC_' + String(eventKey).toUpperCase();   // 供 eventStyle_ 判斷橫幅顏色
      cfg.emails.forEach(function (e) {
        emailRaw(e, titleEn, titleZh, msgEn, msgZh, ptwId || '', mailType);
      });
    } catch (e) { console.error('adminCc(' + eventKey + '): ' + e.message); }
  }

  /** PTW 摘要一行文字（副本信內文用） */
  function ptwBrief(m) {
    var co = Repo.getById('Companies', m.companyId);
    var num = m.ptwNumber || m.tempNumber;
    return num + ' · ' + (co ? (co.nameZh || co.nameEn) : '') +
      ' · ' + String(m.validFrom || '').substring(0, 10) + '→' + String(m.validTo || '').substring(0, 10) +
      ' · ' + String(m.vessel || '') + ' · ' + String(m.workDescription || '').substring(0, 60);
  }

  /** 每週 PTW 摘要（active/overdue 明細表；週日 20:00 排程與測試信共用） */
  function buildWeeklySummary() {
    var S = CFG.STATUS, nowStr = fmtDateTime_();
    var companies = {}; Repo.readAll('Companies').forEach(function (c) { companies[c.id] = c.nameZh || c.nameEn; });
    var users = {}; Repo.readAll('Users').forEach(function (u) { users[u.id] = u.nameZh || u.nameEn; });
    var pendingSet = [S.SUBMITTED, S.PENDING_T2, S.PENDING_T3, S.PENDING_T4, S.PENDING_T5];
    var closedSet = [S.CLOSED, S.CANCELLED, S.DRAFT];
    var all = Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); });
    // 執行中：與首頁看板／KPI 同一定義（現在落在 validFrom ~ validTo 之間；已核發但未開工者不計）
    var active = all.filter(function (p) { return ptwTimeState_(p, nowStr) === 'active'; });
    var overdue = all.filter(function (p) {
      return p.validTo && p.validTo < nowStr && closedSet.indexOf(p.status) < 0 && pendingSet.indexOf(p.status) < 0;
    });
    var pending = all.filter(function (p) { return pendingSet.indexOf(p.status) >= 0; });
    var holderName = function (p) {
      var raw = String(p.holderUserId || ''); var ids = [];
      if (raw.charAt(0) === '[') { try { ids = JSON.parse(raw); } catch (e) {} } else if (raw) { ids = [raw]; }
      return ids.map(function (id) { return users[id] || ''; }).filter(Boolean).join('、');
    };
    var table = function (rows, headColor) {
      if (!rows.length) return '<p style="color:#98a7b8;font-size:13px;margin:4px 0 8px">（無 None）</p>';
      var h = '<table cellpadding="7" cellspacing="0" style="border-collapse:collapse;border:1px solid #e1e8ef;' +
        'font-size:12.5px;width:100%;' + MAIL_FONT + '">' +
        '<tr style="background:' + headColor + ';color:#fff"><th align="left">PTW No.</th><th align="left">承商 Company</th>' +
        '<th align="left">執行區間 Duration</th><th align="left">工作內容 Work</th><th align="left">船舶 Vessel</th>' +
        '<th align="left">持有人 Holder</th><th align="left">狀態 Status</th></tr>';
      rows.forEach(function (p, i) {
        var bg = (i % 2 === 0) ? '#fff' : '#f7fafc';
        h += '<tr style="background:' + bg + '"><td><b style="color:#0b6bcb">' + (p.ptwNumber || p.tempNumber) + '</b></td>' +
          '<td>' + (companies[p.companyId] || '') + '</td>' +
          '<td style="white-space:nowrap">' + String(p.validFrom || '').substring(0, 10) + ' →<br>' + String(p.validTo || '').substring(0, 10) + '</td>' +
          '<td>' + String(p.workDescription || '').substring(0, 80) + '</td>' +
          '<td>' + String(p.vessel || '') + '</td>' +
          '<td>' + holderName(p) + '</td>' +
          '<td>' + effStatusHtml_(p) + '</td></tr>';
      });
      return h + '</table>';
    };
    var today = fmtDate_();
    // 統計方塊（三格）
    var stat = function (n, label, color, bg) {
      return '<td width="33%" style="padding:4px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td bgcolor="' + bg + '" align="center" style="background-color:' + bg + ';padding:12px 6px;' + MAIL_FONT + '">' +
        '<span style="' + MAIL_FONT + 'font-size:26px;font-weight:bold;color:' + color + '">' + n + '</span><br>' +
        '<span style="' + MAIL_FONT + 'font-size:12px;color:#5a6d82;font-weight:bold">' + label + '</span>' +
        '</td></tr></table></td>';
    };
    var content =
      '<p style="margin:0 0 10px;font-size:14px;line-height:1.7">以下為本週 PTW 執行概況，請相關人員檢視。<br>' +
      '<span style="color:#68798d;font-size:12.5px">Weekly PTW status overview — please review.</span></p>' +
      '<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:14px"><tr>' +
      stat(active.length, '執行中 Active', '#1e7e34', '#e9f6ee') +
      stat(overdue.length, '逾期未關 Overdue', '#c62828', '#fdecec') +
      stat(pending.length, '審核中 Pending', '#b45309', '#fdf3e4') +
      '</tr></table>' +
      '<div style="font-weight:800;color:#1e7e34;margin:8px 0 6px;font-size:15px">🟢 執行中 Active PTW（' + active.length + '）</div>' +
      table(active, '#1e7e34') +
      '<div style="font-weight:800;color:#c62828;margin:16px 0 6px;font-size:15px">🔴 逾期未關 Overdue — Not Closed（' + overdue.length + '）</div>' +
      table(overdue, '#c62828');
    var buttons = mailButton_(frontendUrl_() || '#', '🖥 開啟系統 Open System', '#0b3a5c');
    var html = mailShell_('📊',
      'PTW 每週摘要 Weekly Summary <span style="font-size:13px;font-weight:normal;color:#bcd6ea">' + today + '</span>',
      content, buttons);
    return { subject: '[' + systemName_() + '] PTW 每週摘要 Weekly Summary — ' + today, html: html,
      counts: { active: active.length, overdue: overdue.length, pending: pending.length } };
  }

  function sendWeeklySummary(toEmails) {
    var sum = buildWeeklySummary();
    var sent = 0;
    (toEmails || []).forEach(function (e) {
      try { MailApp.sendEmail({ to: e, name: SENDER_NAME, subject: sum.subject, htmlBody: sum.html }); sent++; }
      catch (err) { console.error('weekly mail failed (' + e + '): ' + err.message); }
    });
    return { sent: sent, counts: sum.counts };
  }

  /** 週日 20:00（台北）後由每小時排程呼叫：本週未寄過才寄 */
  function weeklySummaryTick() {
    try {
      var now = new Date(Date.now() + 8 * 3600 * 1000);  // 台北時間
      if (now.getUTCDay() !== 0 || now.getUTCHours() < 20) return;   // 週日 20:00 起
      var weekKey = fmtDate_();                                       // 當天日期＝本週鍵
      if (String(getSetting_('weeklySummaryLastSent') || '') === weekKey) return;
      var emails = parseEmails_(getSetting_('weeklyMailList'));
      if (!emails.length) return;
      sendWeeklySummary(emails);
      setSetting_('weeklySummaryLastSent', weekKey, 'scheduler');
    } catch (e) { console.error('weeklySummaryTick: ' + e.message); }
  }

  /* ===== 管理台 API：副本/週報清單設定與測試寄信 ===== */
  function ccMailGet(user) {
    SecurityService.requireAdmin(user);
    var cfg = ccConfig_();
    return ok_({ list: String(getSetting_('ccMailList') || ''), events: cfg.events,
      eventDefs: CC_EVENTS, weeklyList: String(getSetting_('weeklyMailList') || '') });
  }

  function ccMailSet(user, payload) {
    SecurityService.requireAdmin(user);
    if (payload.list !== undefined) {
      var raw = String(payload.list || '');
      var bad = raw.split(/[\n,;]+/).map(function (e) { return e.trim(); }).filter(Boolean)
        .filter(function (e) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); });
      if (bad.length) throw ApiError_('BAD_EMAIL', 'Invalid email(s): ' + bad.join(', '), 'Email 格式錯誤：' + bad.join('、'));
      setSetting_('ccMailList', parseEmails_(raw).join('\n'), user.id);
    }
    if (payload.events !== undefined) setSetting_('ccMailEvents', JSON.stringify(payload.events || {}), user.id);
    if (payload.weeklyList !== undefined) {
      var raw2 = String(payload.weeklyList || '');
      var bad2 = raw2.split(/[\n,;]+/).map(function (e) { return e.trim(); }).filter(Boolean)
        .filter(function (e) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); });
      if (bad2.length) throw ApiError_('BAD_EMAIL', 'Invalid email(s): ' + bad2.join(', '), 'Email 格式錯誤：' + bad2.join('、'));
      setSetting_('weeklyMailList', parseEmails_(raw2).join('\n'), user.id);
    }
    AuditService.log({ user: user, actionType: 'CC_MAIL_SET', entityType: 'Settings',
      entityId: 'ccMail', success: true });
    return ok_({ saved: true });
  }

  /** 測試寄信：eventKey = weeklySummary 或任一 CC 事件（用範例內容），寄到指定信箱 */
  function mailTest(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['email', 'eventKey']);
    var email = String(payload.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ApiError_('BAD_EMAIL', 'Invalid email', 'Email 格式錯誤');
    var key = String(payload.eventKey);
    if (key === 'weeklySummary') {
      var r = sendWeeklySummary([email]);
      return ok_({ sent: true, kind: 'weeklySummary', counts: r.counts });
    }
    var def = null;
    CC_EVENTS.forEach(function (d) { if (d[0] === key) def = d; });
    if (!def) throw ApiError_('BAD_EVENT', 'Unknown event: ' + key, '未知的事件：' + key);
    // 示範資料：先找「仍在有效期內」的執行中 PTW（逾期事件則優先找已逾期的）；
    // 找不到才用內建範例物件（日期以今天為基準產生，不會過期）
    var nowStr2 = fmtDateTime_();
    var isOpen = function (p) {
      return asBool_(p.isActive) && (p.status === CFG.STATUS.ACTIVE || p.status === CFG.STATUS.EXTENDED);
    };
    var wantOverdue = /OVERDUE|EXPIR/i.test(key);
    var real = Repo.findOne('PTW_Master', function (p) {
      return isOpen(p) && (wantOverdue ? (p.validTo && String(p.validTo) < nowStr2)
                                       : !(p.validTo && String(p.validTo) < nowStr2));
    }) || Repo.findOne('PTW_Master', isOpen);
    var demo = real || { id: '', ptwNumber: 'OPTW-0001', _companyName: 'Test Contractor Alpha 測試承商',
      validFrom: fmtDateTime_(new Date(Date.now() - (wantOverdue ? 10 : 1) * 86400000)),
      validTo: fmtDateTime_(new Date(Date.now() + (wantOverdue ? -3 : 5) * 86400000)),
      vessel: 'DLB-1600 Derrick Lay Barge',
      areaLocation: 'KP 12+350 ~ KP 12+600', workDescription: 'Riser tie-in welding works 海管立管銲接接合作業',
      _holderName: 'Alpha T1 Holder', status: CFG.STATUS.ACTIVE };
    emailRaw(email,
      '[TEST] ' + def[2] + ': ' + demo.ptwNumber, '[測試] ' + def[1] + '：' + demo.ptwNumber,
      'This is a TEST email for the event "' + def[2] + '". The layout and PTW information table below are exactly what recipients will see.',
      '這是「' + def[1] + '」事件的測試信，版面與下方 PTW 資訊表即為正式信件的樣子。',
      demo, 'CC_' + key.toUpperCase());
    return ok_({ sent: true, kind: key });
  }

  return {
    emailRaw: emailRaw, issueListGet: issueListGet, issueListSet: issueListSet,
    adminCc: adminCc, ptwBrief: ptwBrief, ccEventDefs: ccEventDefs,
    buildWeeklySummary: buildWeeklySummary, sendWeeklySummary: sendWeeklySummary,
    weeklySummaryTick: weeklySummaryTick,
    ccMailGet: ccMailGet, ccMailSet: ccMailSet, mailTest: mailTest,
    notifyAdminsAccountApplied: notifyAdminsAccountApplied,
    sendAccountApproved: sendAccountApproved,
    sendAccountRejected: sendAccountRejected,
    sendPasswordResetEmail: sendPasswordResetEmail,
    listMine: listMine,
    markRead: markRead,
    push: push_,
    ptwLink: ptwLink_
  };
})();

/* ============================== AuthService.gs ============================== */
/**
 * AuthService.gs — 登入/登出、Session Token、帳號申請、忘記/重設/變更密碼、鎖定
 * 密碼：SHA-256(salt‖pepper‖password) × 10000 迭代；Salt 每人隨機；Pepper 存 Script Properties。
 */

var AuthService = (function () {

  // ---------- Session ----------

  function createSession_(user, userAgent) {
    var token = randomToken_(32) + randomToken_(32);
    var nowMs = Date.now();
    var expires = new Date(nowMs + CFG.SESSION_HOURS * 3600 * 1000);
    var expiresStr = fmtDateTime_(expires);
    Repo.insert('Sessions', {
      id: token, userId: user.id,
      createdAt: fmtDateTime_(), expiresAt: expiresStr,
      lastSeenAt: fmtDateTime_(), userAgent: userAgent || '', isRevoked: false
    });
    try { CacheService.getScriptCache().put('sess_' + token, user.id + '|' + expiresStr, CFG.CACHE_TTL_SEC); } catch (e) {}
    return { token: token, expiresAt: expiresStr };
  }

  /** 驗證 token → user 物件；失敗擲 401（快取命中時不讀 Sessions 表） */
  function verifySession(token) {
    if (!token) throw ApiError_('UNAUTHORIZED', 'Login required', '請先登入');
    var cache = CacheService.getScriptCache();
    var nowStr = fmtDateTime_();
    var userId = null;
    var hit = null;
    try { hit = cache.get('sess_' + token); } catch (e) {}
    if (hit && hit.indexOf('|') > 0) {
      var parts = hit.split('|');
      if (parts[1] > nowStr) userId = parts[0];          // 快取有效 → 免讀表
    }
    if (!userId) {
      var session = Repo.findOne('Sessions', function (s) { return s.id === token; });
      if (!session || asBool_(session.isRevoked)) throw ApiError_('UNAUTHORIZED', 'Invalid session', '連線階段無效，請重新登入');
      if (session.expiresAt < nowStr) throw ApiError_('SESSION_EXPIRED', 'Session expired', '連線階段已到期，請重新登入');
      userId = session.userId;
      try { cache.put('sess_' + token, userId + '|' + session.expiresAt, CFG.CACHE_TTL_SEC); } catch (e) {}
    }
    var user = Repo.getById('Users', userId);
    if (!user || !asBool_(user.isActive) || user.status !== 'Active') {
      try { cache.remove('sess_' + token); } catch (e) {}
      throw ApiError_('UNAUTHORIZED', 'Account is not active', '帳號非啟用狀態');
    }
    var company = Repo.getById('Companies', user.companyId);
    if (company && !asBool_(company.isActive)) {
      throw ApiError_('COMPANY_DISABLED', 'Your company is disabled', '所屬公司已停用');
    }
    return user;
  }

  /** 密碼驗證：先用帳號記錄的迭代數，再嘗試歷史迭代數清單（版本升級自癒） */
  function verifyPassword_(user, password) {
    var stored = Number(user.hashIter) || 0;
    var candidates = [];
    if (stored > 0) candidates.push(stored);
    CFG.HASH_ITERATIONS_FALLBACKS.forEach(function (n) {
      if (candidates.indexOf(n) < 0) candidates.push(n);
    });
    for (var i = 0; i < candidates.length; i++) {
      if (hashPassword_(password, user.passwordSalt, candidates[i]) === user.passwordHash) {
        return { matched: true, iterUsed: candidates[i] };
      }
    }
    return { matched: false, iterUsed: stored || CFG.HASH_ITERATIONS };
  }

  // ---------- Login / Logout ----------

  function login(payload, meta) {
    requireFields_(payload, ['email', 'password']);
    var email = normEmail_(payload.email);
    SecurityService.rateLimit('login_' + email, 30);

    var user = Repo.findOne('Users', function (u) { return normEmail_(u.email) === email; });
    var fail = function (reason, msgEn, msgZh) {
      Repo.insert('LoginAttempts', {
        email: email, success: false, reason: reason,
        clientInfo: meta.clientInfo || '', userAgent: meta.userAgent || '', timestamp: fmtDateTime_()
      });
      AuditService.log({ userName: email, actionType: 'LOGIN_FAILED', entityType: 'Auth', comment: reason,
        userAgent: meta.userAgent, success: false });
      return err_(reason, msgEn, msgZh);
    };

    if (!user) return fail('BAD_CREDENTIALS', 'Invalid email or password', '帳號或密碼錯誤');
    if (user.status === 'PendingApproval') return fail('PENDING_APPROVAL', 'Account pending approval', '帳號尚待管理員核准');
    if (user.status === 'Disabled' || !asBool_(user.isActive)) return fail('DISABLED', 'Account disabled', '帳號已停用');
    if (user.status === 'Locked' && user.lockedUntil && user.lockedUntil > fmtDateTime_()) {
      return fail('LOCKED', 'Account locked until ' + user.lockedUntil, '帳號已鎖定至 ' + user.lockedUntil);
    }
    var company = Repo.getById('Companies', user.companyId);
    if (company && !asBool_(company.isActive)) return fail('COMPANY_DISABLED', 'Company disabled', '所屬公司已停用');

    // 依帳號記錄的迭代數驗證；不符時依歷史迭代數清單自動辨識（自癒）
    var verify = verifyPassword_(user, String(payload.password));
    var matched = verify.matched, iter = verify.iterUsed;
    if (!matched) {
      var count = Number(user.failedLoginCount || 0) + 1;
      var patch = { failedLoginCount: count };
      if (count >= CFG.MAX_FAILED_LOGIN) {
        patch.status = 'Locked';
        patch.lockedUntil = fmtDateTime_(new Date(Date.now() + CFG.LOCK_MINUTES * 60000));
      }
      Repo.update('Users', user.id, patch, 'system');
      return fail('BAD_CREDENTIALS', 'Invalid email or password', '帳號或密碼錯誤');
    }

    // 成功：只在必要時寫回（省一次鎖定讀寫，登入更快）
    var needRehash = (iter !== CFG.HASH_ITERATIONS || Number(user.hashIter) !== CFG.HASH_ITERATIONS);
    var needReset = Number(user.failedLoginCount || 0) > 0 || user.status !== 'Active' || !!user.lockedUntil;
    if (needRehash || needReset) {
      var successPatch = { failedLoginCount: 0, status: 'Active', lockedUntil: '' };
      if (needRehash) {
        var newSalt = randomToken_(32);
        successPatch.passwordSalt = newSalt;
        successPatch.passwordHash = hashPassword_(String(payload.password), newSalt, CFG.HASH_ITERATIONS);
        successPatch.hashIter = CFG.HASH_ITERATIONS;
      }
      Repo.update('Users', user.id, successPatch, 'system');
    }
    var session = createSession_(user, meta.userAgent);
    Repo.insert('LoginAttempts', {
      email: email, success: true, reason: '',
      clientInfo: meta.clientInfo || '', userAgent: meta.userAgent || '', timestamp: fmtDateTime_()
    });
    AuditService.log({ user: user, actionType: 'LOGIN', entityType: 'Auth', sessionId: session.token.substring(0, 12),
      userAgent: meta.userAgent, success: true });

    return ok_({
      token: session.token,
      expiresAt: session.expiresAt,
      user: publicUser_(user),
      mustChangePassword: asBool_(user.mustChangePassword)
    });
  }

  function logout(user, token) {
    return ok_(revokeToken_(user, token));
  }

  function revokeToken_(user, token) {
    var session = Repo.findOne('Sessions', function (s) { return s.id === token; });
    if (session) {
      Repo.update('Sessions', session.id, { isRevoked: true }, user ? user.id : 'system');
    }
    CacheService.getScriptCache().remove('sess_' + token);
    AuditService.log({ user: user, actionType: 'LOGOUT', entityType: 'Auth', success: true });
    return { loggedOut: true };
  }

  // ---------- 帳號申請（9.2） ----------

  function applyAccount(payload, meta) {
    requireFields_(payload, ['nameZh', 'nameEn', 'companyName', 'title', 'email', 'phone',
      'password', 'confirmPassword', 'vessel', 'applyReason', 'appliedTier']);
    if (!payload.signatureBase64) {
      throw ApiError_('SIGNATURE_REQUIRED', 'Signature image is required', '請上傳簽名檔（白紙簽名拍照並清除背景）');
    }
    var email = normEmail_(payload.email);
    SecurityService.rateLimit('apply_' + (meta.clientInfo || 'x'), 10);
    if (!isValidEmail_(email)) throw ApiError_('BAD_EMAIL', 'Invalid email format', 'Email 格式錯誤');
    // Tier 0 已取消：申請層級僅接受 1–5（Tier 1 = 承商持有人／申請人，可兼任兩者）
    var appliedTier = Number(payload.appliedTier);
    if (isNaN(appliedTier) || appliedTier < 1 || appliedTier > 5) {
      throw ApiError_('BAD_TIER', 'Applied tier must be 1–5', '申請層級須為 Tier 1–5');
    }
    if (payload.password !== payload.confirmPassword) {
      throw ApiError_('PASSWORD_MISMATCH', 'Passwords do not match', '兩次密碼輸入不一致');
    }
    if (!isStrongPassword_(payload.password)) {
      throw ApiError_('WEAK_PASSWORD', 'Password must be ≥8 chars with letters and numbers', '密碼須至少 8 碼且含英文與數字');
    }
    if (Repo.findOne('Users', function (u) { return normEmail_(u.email) === email; })) {
      throw ApiError_('EMAIL_EXISTS', 'This email is already registered', '此 Email 已註冊');
    }
    // 公司：以名稱對應既有公司；找不到則暫存名稱，由管理員核准時指定
    var company = Repo.findOne('Companies', function (c) {
      return c.nameZh === payload.companyName || c.nameEn === payload.companyName;
    });
    var sigFileId = '';
    try { sigFileId = DriveService.saveAccountSignature(payload.signatureBase64, email); }
    catch (e) { throw ApiError_('SIGNATURE_SAVE_FAILED', 'Signature save failed: ' + (e.msgEn || e.message), '簽名檔儲存失敗：' + (e.msgZh || e.message)); }
    var salt = randomToken_(32);
    var user = Repo.insert('Users', {
      email: email, nameZh: payload.nameZh, nameEn: payload.nameEn, signatureFileId: sigFileId,
      companyId: company ? company.id : ('PENDING:' + payload.companyName),
      title: payload.title, phone: payload.phone, vessel: payload.vessel,
      tier: '', isAdmin: false, badgeNo: payload.badgeNo || '',
      passwordSalt: salt, passwordHash: hashPassword_(String(payload.password), salt), hashIter: CFG.HASH_ITERATIONS,
      status: 'PendingApproval', failedLoginCount: 0, mustChangePassword: false, isHse: asBool_(payload.isHse),
      applyReason: payload.applyReason, appliedTier: payload.appliedTier, langPref: 'en'
    }, 'self-apply');
    AuditService.log({ userName: email, actionType: 'ACCOUNT_APPLY', entityType: 'User', entityId: user.id, success: true });
    NotificationService.notifyAdminsAccountApplied(user);
    try { NotificationService.adminCc('accountApplied',
      'New account application: ' + user.nameEn, '新帳號申請：' + user.nameZh,
      user.nameEn + ' (' + user.email + ') applied for Tier ' + user.appliedTier + '.',
      user.nameZh + '（' + user.email + '）申請 Tier ' + user.appliedTier + ' 帳號，待管理員審核。', ''); } catch (eCc) {}
    return ok_({ applied: true, status: 'PendingApproval' });
  }

  // ---------- 忘記/重設/變更密碼（9.3） ----------

  function forgotPassword(payload, meta) {
    requireFields_(payload, ['email']);
    var email = normEmail_(payload.email);
    SecurityService.rateLimit('forgot_' + email, 5);
    var user = Repo.findOne('Users', function (u) { return normEmail_(u.email) === email; });
    // 一律回成功，避免帳號探測
    if (user && user.status === 'Active') {
      var token = randomToken_(32);
      Repo.insert('PasswordResets', {
        userId: user.id, tokenHash: sha256_(token),
        expiresAt: fmtDateTime_(new Date(Date.now() + CFG.RESET_TOKEN_MINUTES * 60000)),
        usedAt: '', createdAt: fmtDateTime_()
      });
      NotificationService.sendPasswordResetEmail(user, token);
      AuditService.log({ user: user, actionType: 'PASSWORD_RESET_REQUEST', entityType: 'Auth', success: true });
    }
    return ok_({ sent: true });
  }

  function resetPassword(payload) {
    requireFields_(payload, ['email', 'token', 'newPassword']);
    var email = normEmail_(payload.email);
    var user = Repo.findOne('Users', function (u) { return normEmail_(u.email) === email; });
    if (!user) throw ApiError_('BAD_TOKEN', 'Invalid reset token', '重設連結無效');
    var tokenHash = sha256_(payload.token);
    var reset = Repo.findOne('PasswordResets', function (r) {
      return r.userId === user.id && r.tokenHash === tokenHash && !r.usedAt;
    });
    if (!reset) throw ApiError_('BAD_TOKEN', 'Invalid reset token', '重設連結無效');
    if (reset.expiresAt < fmtDateTime_()) throw ApiError_('TOKEN_EXPIRED', 'Reset token expired', '重設連結已過期');
    if (!isStrongPassword_(payload.newPassword)) {
      throw ApiError_('WEAK_PASSWORD', 'Password must be ≥8 chars with letters and numbers', '密碼須至少 8 碼且含英文與數字');
    }
    var salt = randomToken_(32);
    Repo.update('Users', user.id, {
      passwordSalt: salt, passwordHash: hashPassword_(String(payload.newPassword), salt),
      hashIter: CFG.HASH_ITERATIONS,
      failedLoginCount: 0, status: 'Active', lockedUntil: '', mustChangePassword: false
    }, user.id);
    Repo.update('PasswordResets', reset.id, { usedAt: fmtDateTime_() }, user.id);
    AuditService.log({ user: user, actionType: 'PASSWORD_RESET', entityType: 'Auth', success: true });
    return ok_({ reset: true });
  }

  function changePassword(user, payload) {
    requireFields_(payload, ['oldPassword', 'newPassword']);
    if (!verifyPassword_(user, String(payload.oldPassword)).matched) {
      throw ApiError_('BAD_CREDENTIALS', 'Old password incorrect', '舊密碼錯誤');
    }
    if (!isStrongPassword_(payload.newPassword)) {
      throw ApiError_('WEAK_PASSWORD', 'Password must be ≥8 chars with letters and numbers', '密碼須至少 8 碼且含英文與數字');
    }
    var salt = randomToken_(32);
    Repo.update('Users', user.id, {
      passwordSalt: salt, passwordHash: hashPassword_(String(payload.newPassword), salt),
      hashIter: CFG.HASH_ITERATIONS, mustChangePassword: false
    }, user.id);
    AuditService.log({ user: user, actionType: 'PASSWORD_CHANGE', entityType: 'Auth', success: true });
    return ok_({ changed: true });
  }

  // ---------- Me ----------

  function me(user) {
    var company = Repo.getById('Companies', user.companyId);
    var pendingCount = 0; // M3.2 起由 PTWService 提供待辦數
    return ok_({
      user: publicUser_(user),
      company: company ? { id: company.id, nameZh: company.nameZh, nameEn: company.nameEn, type: company.type } : null,
      trainingValidUntil: user.trainingValidUntil || null,
      trainingValid: !!(user.trainingValidUntil && user.trainingValidUntil >= fmtDate_()),
      pendingReviewCount: pendingCount
    });
  }

  function publicUser_(u) {
    return {
      id: u.id, email: u.email, nameZh: u.nameZh, nameEn: u.nameEn,
      companyId: u.companyId, title: u.title, phone: u.phone, vessel: u.vessel,
      tier: Number(u.tier || 0), isAdmin: asBool_(u.isAdmin), badgeNo: u.badgeNo,
      langPref: u.langPref || 'en'
    };
  }

  return {
    verifySession: verifySession,
    login: login,
    logout: logout,
    applyAccount: applyAccount,
    forgotPassword: forgotPassword,
    resetPassword: resetPassword,
    changePassword: changePassword,
    me: me,
    publicUser: publicUser_,
    createSessionFor: function (target, userAgent) { return createSession_(target, userAgent); }
  };
})();

/* ============================== UserService.gs ============================== */
/**
 * UserService.gs — 使用者管理（Admin）：審核、CRUD、停用/解鎖、重設密碼、代理人、匯出
 * 規則：已有歷史紀錄的使用者不得物理刪除，只能停用。
 */

var UserService = (function () {

  function list(user, payload) {
    SecurityService.requireAdmin(user);
    var rows = Repo.readAll('Users');
    var f = payload || {};
    if (f.status) rows = rows.filter(function (r) { return r.status === f.status; });
    if (f.companyId) rows = rows.filter(function (r) { return r.companyId === f.companyId; });
    if (f.q) {
      var q = String(f.q).toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.email).toLowerCase().indexOf(q) >= 0 ||
               String(r.nameZh).indexOf(f.q) >= 0 ||
               String(r.nameEn).toLowerCase().indexOf(q) >= 0;
      });
    }
    return ok_(rows.map(strip_));
  }

  function get(user, payload) {
    SecurityService.requireAdmin(user);
    var target = Repo.getById('Users', payload.userId);
    if (!target) throw ApiError_('NOT_FOUND', 'User not found', '找不到使用者');
    return ok_(strip_(target));
  }

  /** 管理員核准帳號申請：指定公司與 Tier */
  function approve(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['userId', 'companyId', 'tier']);
    var target = mustGet_(payload.userId);
    if (target.status !== 'PendingApproval') {
      throw ApiError_('BAD_STATE', 'User is not pending approval', '此帳號非待審核狀態');
    }
    var company = Repo.getById('Companies', payload.companyId);
    if (!company || !asBool_(company.isActive)) throw ApiError_('BAD_COMPANY', 'Invalid company', '公司無效或已停用');
    var tier = Number(payload.tier);
    // Tier 0 已取消：層級僅限 1–5（Tier 1 = 承商持有人／申請人）
    if (!(tier >= 1 && tier <= 5)) throw ApiError_('BAD_TIER', 'Tier must be 1–5', 'Tier 須為 1–5');

    Repo.update('Users', target.id, {
      status: 'Active', companyId: payload.companyId, tier: tier,
      isAdmin: asBool_(payload.isAdmin) && Number(payload.tier) === 5, // Admin 僅可由 Tier 5 兼任
      mustChangePassword: false
    }, user.id);
    AuditService.log({ user: user, actionType: 'ACCOUNT_APPROVE', entityType: 'User', entityId: target.id,
      newValue: { companyId: payload.companyId, tier: tier }, success: true });
    NotificationService.sendAccountApproved(Repo.getById('Users', target.id));
    try { NotificationService.adminCc('accountApproved',
      'Account approved: ' + target.nameEn, '帳號核准：' + target.nameZh,
      target.nameEn + ' (' + target.email + ') approved as Tier ' + tier + '.',
      target.nameZh + '（' + target.email + '）已核准為 Tier ' + tier + '。', ''); } catch (eCc) {}
    return ok_({ approved: true });
  }

  function reject(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['userId', 'reason']);
    var target = mustGet_(payload.userId);
    if (target.status !== 'PendingApproval') {
      throw ApiError_('BAD_STATE', 'User is not pending approval', '此帳號非待審核狀態');
    }
    Repo.update('Users', target.id, { status: 'Disabled', isActive: false }, user.id);
    AuditService.log({ user: user, actionType: 'ACCOUNT_REJECT', entityType: 'User', entityId: target.id,
      comment: payload.reason, success: true });
    NotificationService.sendAccountRejected(target, payload.reason);
    return ok_({ rejected: true });
  }

  /** Admin 直接新增使用者（免申請流程） */
  function create(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['email', 'nameZh', 'nameEn', 'companyId', 'title', 'tier', 'password']);
    var email = normEmail_(payload.email);
    if (!isValidEmail_(email)) throw ApiError_('BAD_EMAIL', 'Invalid email', 'Email 格式錯誤');
    if (Repo.findOne('Users', function (u) { return normEmail_(u.email) === email; })) {
      throw ApiError_('EMAIL_EXISTS', 'Email already exists', '此 Email 已存在');
    }
    if (!isStrongPassword_(payload.password)) {
      throw ApiError_('WEAK_PASSWORD', 'Password must be ≥8 chars with letters and numbers', '密碼強度不足');
    }
    if (!(Number(payload.tier) >= 1 && Number(payload.tier) <= 5)) {
      throw ApiError_('BAD_TIER', 'Tier must be 1–5', 'Tier 須為 1–5');
    }
    var salt = randomToken_(32);
    var created = Repo.insert('Users', {
      email: email, nameZh: payload.nameZh, nameEn: payload.nameEn,
      companyId: payload.companyId, title: payload.title, phone: payload.phone || '',
      vessel: payload.vessel || '', tier: Number(payload.tier),
      isAdmin: asBool_(payload.isAdmin) && Number(payload.tier) === 5,
      badgeNo: payload.badgeNo || '',
      passwordSalt: salt, passwordHash: hashPassword_(String(payload.password), salt), hashIter: CFG.HASH_ITERATIONS,
      status: 'Active', failedLoginCount: 0, mustChangePassword: true, langPref: 'en'
    }, user.id);
    AuditService.log({ user: user, actionType: 'USER_CREATE', entityType: 'User', entityId: created.id,
      newValue: { email: email, tier: payload.tier }, success: true });
    return ok_(strip_(created));
  }

  function update(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['userId']);
    var target = mustGet_(payload.userId);
    var allowed = ['nameZh', 'nameEn', 'companyId', 'title', 'phone', 'vessel', 'tier', 'badgeNo', 'isAdmin', 'langPref', 'isHse'];
    var patch = {};
    allowed.forEach(function (k) { if (payload[k] !== undefined) patch[k] = payload[k]; });
    if (patch.tier !== undefined) {
      patch.tier = Number(patch.tier);
      if (!(patch.tier >= 1 && patch.tier <= 5)) {
        throw ApiError_('BAD_TIER', 'Tier must be 1–5', 'Tier 須為 1–5');
      }
    }
    if (patch.isAdmin !== undefined) {
      var newTier = patch.tier !== undefined ? patch.tier : Number(target.tier);
      patch.isAdmin = asBool_(patch.isAdmin) && newTier === 5;
    }
    var updated = Repo.update('Users', target.id, patch, user.id);
    AuditService.log({ user: user, actionType: 'USER_UPDATE', entityType: 'User', entityId: target.id,
      oldValue: strip_(target), newValue: patch, success: true });
    return ok_(strip_(updated));
  }

  /** 停用（有歷史紀錄者以此取代刪除） */
  function disable(user, payload) {
    SecurityService.requireAdmin(user);
    var target = mustGet_(payload.userId);
    if (target.id === user.id) throw ApiError_('BAD_REQUEST', 'Cannot disable yourself', '不可停用自己');
    Repo.update('Users', target.id, { status: 'Disabled', isActive: false }, user.id);
    // 撤銷其所有 session
    Repo.find('Sessions', function (s) { return s.userId === target.id && !asBool_(s.isRevoked); })
      .forEach(function (s) {
        Repo.update('Sessions', s.id, { isRevoked: true }, user.id);
        CacheService.getScriptCache().remove('sess_' + s.id);
      });
    AuditService.log({ user: user, actionType: 'USER_DISABLE', entityType: 'User', entityId: target.id, success: true });
    return ok_({ disabled: true });
  }

  /** 刪除人員（Admin / Tier 5 專用）：直接自系統實際刪除，不保留 Deleted 註記。
   *  一併移除其 Sessions／通知／訓練紀錄／角色／代理設定／資料修改申請與簽名檔。
   *  歷史 PTW／簽核／稽核紀錄本身保留（其中的姓名將無法再顯示）。 */
  function deleteUser(user, payload) {
    SecurityService.requireAdmin(user);
    var target = mustGet_(payload.userId);
    if (target.id === user.id) throw ApiError_('BAD_REQUEST', 'Cannot delete yourself', '不可刪除自己');
    if (asBool_(target.isAdmin)) {
      var otherAdmins = Repo.find('Users', function (u2) {
        return u2.id !== target.id && asBool_(u2.isAdmin) && asBool_(u2.isActive);
      });
      if (!otherAdmins.length) throw ApiError_('BAD_REQUEST', 'Cannot delete the last administrator', '不可刪除最後一位系統管理員');
    }
    // 先清 session 快取，再實際刪除相關資料列
    Repo.find('Sessions', function (s) { return s.userId === target.id; })
      .forEach(function (s) {
        try { CacheService.getScriptCache().remove('sess_' + s.id); } catch (e) {}
      });
    Repo.removeWhere('Sessions', function (s) { return s.userId === target.id; });
    Repo.removeWhere('Notifications', function (n) { return n.userId === target.id; });
    Repo.removeWhere('TrainingProgress', function (tp) { return tp.userId === target.id; });
    Repo.removeWhere('UserRoles', function (ur) { return ur.userId === target.id; });
    Repo.removeWhere('Delegations', function (dg) {
      return dg.delegatorUserId === target.id || dg.delegateUserId === target.id;
    });
    Repo.removeWhere('ProfileChangeRequests', function (pr) { return pr.userId === target.id; });
    if (target.signatureFileId) {
      try { DriveApp.getFileById(target.signatureFileId).setTrashed(true); } catch (e) {}
    }
    Repo.remove('Users', target.id);
    AuditService.log({ user: user, actionType: 'USER_DELETE', entityType: 'User', entityId: target.id,
      oldValue: { email: target.email, nameEn: target.nameEn },
      comment: 'Hard delete (row removed from system)', success: true });
    return ok_({ deleted: true });
  }

  function enable(user, payload) {
    SecurityService.requireAdmin(user);
    var target = mustGet_(payload.userId);
    Repo.update('Users', target.id, { status: 'Active', isActive: true, failedLoginCount: 0, lockedUntil: '' }, user.id);
    AuditService.log({ user: user, actionType: 'USER_ENABLE', entityType: 'User', entityId: target.id, success: true });
    return ok_({ enabled: true });
  }

  function unlock(user, payload) {
    SecurityService.requireAdmin(user);
    var target = mustGet_(payload.userId);
    Repo.update('Users', target.id, { status: 'Active', failedLoginCount: 0, lockedUntil: '' }, user.id);
    AuditService.log({ user: user, actionType: 'USER_UNLOCK', entityType: 'User', entityId: target.id, success: true });
    return ok_({ unlocked: true });
  }

  function resetPasswordByAdmin(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['userId', 'newPassword']);
    var target = mustGet_(payload.userId);
    if (!isStrongPassword_(payload.newPassword)) {
      throw ApiError_('WEAK_PASSWORD', 'Password must be ≥8 chars with letters and numbers', '密碼強度不足');
    }
    var salt = randomToken_(32);
    Repo.update('Users', target.id, {
      passwordSalt: salt, passwordHash: hashPassword_(String(payload.newPassword), salt),
      hashIter: CFG.HASH_ITERATIONS,
      mustChangePassword: true, failedLoginCount: 0, status: 'Active', lockedUntil: ''
    }, user.id);
    AuditService.log({ user: user, actionType: 'USER_PASSWORD_RESET_BY_ADMIN', entityType: 'User', entityId: target.id, success: true });
    return ok_({ reset: true });
  }

  function setDelegation(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['delegatorUserId', 'delegateUserId', 'tier', 'validFrom', 'validTo']);
    if (payload.delegatorUserId === payload.delegateUserId) {
      throw ApiError_('BAD_REQUEST', 'Delegator and delegate must differ', '代理人不可為本人');
    }
    var d = Repo.insert('Delegations', {
      delegatorUserId: payload.delegatorUserId, delegateUserId: payload.delegateUserId,
      tier: Number(payload.tier), validFrom: payload.validFrom, validTo: payload.validTo
    }, user.id);
    AuditService.log({ user: user, actionType: 'DELEGATION_SET', entityType: 'Delegation', entityId: d.id,
      newValue: payload, success: true });
    return ok_(d);
  }

  function exportList(user) {
    SecurityService.requireAdmin(user);
    var companies = {};
    Repo.readAll('Companies').forEach(function (c) { companies[c.id] = c.nameEn || c.nameZh; });
    var header = ['Email', 'Name (ZH)', 'Name (EN)', 'Company', 'Title', 'Tier', 'Status', 'Vessel', 'Training Valid Until'];
    var lines = [header.join(',')];
    Repo.readAll('Users').forEach(function (u) {
      lines.push([u.email, u.nameZh, u.nameEn, companies[u.companyId] || u.companyId, u.title,
        u.tier, u.status, u.vessel, u.trainingValidUntil]
        .map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','));
    });
    return ok_({ csv: lines.join('\r\n'), fileName: 'users_' + fmtDate_() + '.csv' });
  }

  // ---------- 個人帳號管理（基本資料修改需管理員審核） ----------

  var PROFILE_FIELDS = ['nameZh', 'nameEn', 'title', 'phone', 'vessel', 'badgeNo'];

  function myProfile(user) {
    var pending = Repo.findOne('ProfileChangeRequests', function (r) {
      return r.userId === user.id && r.status === 'Pending' && asBool_(r.isActive);
    });
    var company = Repo.getById('Companies', user.companyId);
    return ok_({
      profile: { email: user.email, nameZh: user.nameZh, nameEn: user.nameEn, title: user.title,
        phone: user.phone, vessel: user.vessel, badgeNo: user.badgeNo,
        company: companyLabel_(company), tier: Number(user.tier || 0) },
      signatureBase64: DriveService.getSignatureBase64(user.signatureFileId),
      pendingRequest: pending ? { id: pending.id, changes: JSON.parse(pending.changesJson), createdAt: pending.createdAt } : null,
      trainingValidUntil: user.trainingValidUntil || ''
    });
  }

  /** 送出基本資料修改申請（需管理員審核後生效） */
  function requestProfileChange(user, payload) {
    var existing = Repo.findOne('ProfileChangeRequests', function (r) {
      return r.userId === user.id && r.status === 'Pending' && asBool_(r.isActive);
    });
    if (existing) {
      throw ApiError_('REQUEST_EXISTS', 'You already have a pending change request',
        '您已有一筆待審核的修改申請，請等待審核或先取消');
    }
    var changes = {};
    PROFILE_FIELDS.forEach(function (k) {
      if (payload[k] !== undefined && String(payload[k]) !== String(user[k] || '')) {
        changes[k] = { from: user[k] || '', to: String(payload[k]).trim() };
      }
    });
    if (!Object.keys(changes).length) {
      throw ApiError_('NO_CHANGES', 'No changes detected', '沒有偵測到任何修改');
    }
    var req = Repo.insert('ProfileChangeRequests', {
      userId: user.id, changesJson: JSON.stringify(changes), status: 'Pending',
      reviewedBy: '', reviewedAt: '', rejectReason: ''
    }, user.id);
    AuditService.log({ user: user, actionType: 'PROFILE_CHANGE_REQUEST', entityType: 'User', entityId: user.id,
      newValue: changes, success: true });
    // 通知管理員
    Repo.find('Users', function (u) { return asBool_(u.isAdmin) && u.status === 'Active' && asBool_(u.isActive); })
      .forEach(function (admin) {
        NotificationService.push(admin.id, 'PROFILE_CHANGE_PENDING', '',
          'Profile change request from ' + user.nameEn, '資料修改申請待審核：' + user.nameZh,
          Object.keys(changes).map(function (k) { return k + ': ' + changes[k].from + ' → ' + changes[k].to; }).join('; '),
          Object.keys(changes).map(function (k) { return k + '：' + changes[k].from + ' → ' + changes[k].to; }).join('；'),
          admin.email);
      });
    return ok_({ requestId: req.id, status: 'Pending' });
  }

  function cancelProfileChange(user, payload) {
    requireFields_(payload, ['requestId']);
    var req = Repo.getById('ProfileChangeRequests', payload.requestId);
    if (!req || req.userId !== user.id || req.status !== 'Pending') {
      throw ApiError_('NOT_FOUND', 'Pending request not found', '找不到待審核申請');
    }
    Repo.update('ProfileChangeRequests', req.id, { status: 'Cancelled', isActive: false }, user.id);
    return ok_({ cancelled: true });
  }

  /** 管理員：列出待審核的資料修改申請 */
  function profileRequestList(user) {
    SecurityService.requireAdmin(user);
    var users = {};
    Repo.readAll('Users').forEach(function (u) { users[u.id] = u; });
    var rows = Repo.find('ProfileChangeRequests', function (r) { return r.status === 'Pending' && asBool_(r.isActive); });
    rows.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    return ok_(rows.map(function (r) {
      var u = users[r.userId] || {};
      return { id: r.id, userId: r.userId, email: u.email || '',
        userName: (u.nameEn || '') + ' / ' + (u.nameZh || ''),
        changes: JSON.parse(r.changesJson), createdAt: r.createdAt };
    }));
  }

  /** 管理員：核准資料修改 → 套用到 Users */
  function profileRequestApprove(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['requestId']);
    var req = Repo.getById('ProfileChangeRequests', payload.requestId);
    if (!req || req.status !== 'Pending') throw ApiError_('BAD_STATE', 'Request is not pending', '此申請非待審核狀態');
    var changes = JSON.parse(req.changesJson);
    var patch = {};
    PROFILE_FIELDS.forEach(function (k) { if (changes[k]) patch[k] = changes[k].to; });
    Repo.update('Users', req.userId, patch, user.id);
    Repo.update('ProfileChangeRequests', req.id, { status: 'Approved', reviewedBy: user.id, reviewedAt: fmtDateTime_() }, user.id);
    AuditService.log({ user: user, actionType: 'PROFILE_CHANGE_APPROVE', entityType: 'User', entityId: req.userId,
      oldValue: Object.keys(changes).map(function (k) { return k + '=' + changes[k].from; }).join(','),
      newValue: patch, success: true });
    var target = Repo.getById('Users', req.userId);
    NotificationService.push(target.id, 'PROFILE_CHANGE_APPROVED', '',
      'Your profile change was approved', '您的資料修改申請已核准',
      'The changes are now in effect.', '修改內容已生效。', target.email);
    return ok_({ approved: true });
  }

  /** 管理員：拒絕資料修改（附原因） */
  function profileRequestReject(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['requestId', 'reason']);
    var req = Repo.getById('ProfileChangeRequests', payload.requestId);
    if (!req || req.status !== 'Pending') throw ApiError_('BAD_STATE', 'Request is not pending', '此申請非待審核狀態');
    Repo.update('ProfileChangeRequests', req.id, { status: 'Rejected', reviewedBy: user.id,
      reviewedAt: fmtDateTime_(), rejectReason: payload.reason }, user.id);
    AuditService.log({ user: user, actionType: 'PROFILE_CHANGE_REJECT', entityType: 'User', entityId: req.userId,
      comment: payload.reason, success: true });
    var target = Repo.getById('Users', req.userId);
    NotificationService.push(target.id, 'PROFILE_CHANGE_REJECTED', '',
      'Your profile change was rejected', '您的資料修改申請未通過',
      'Reason: ' + payload.reason, '原因：' + payload.reason, target.email);
    return ok_({ rejected: true });
  }

  function mustGet_(id) {
    var t = Repo.getById('Users', id);
    if (!t) throw ApiError_('NOT_FOUND', 'User not found', '找不到使用者');
    return t;
  }

  /** Admin：使用者詳細資訊（含簽名縮圖與訓練/統計） */
  function detail(user, payload) {
    SecurityService.requireAdmin(user);
    var t = mustGet_(payload.userId);
    var company = Repo.getById('Companies', t.companyId);
    var ptwCount = Repo.find('PTW_Master', function (p) { return p.applicantUserId === t.id && asBool_(p.isActive); }).length;
    var attempts = Repo.find('ExamAttempts', function (a) { return a.userId === t.id && a.submitAt; });
    attempts.sort(function (a, b) { return a.submitAt < b.submitAt ? 1 : -1; });
    return ok_({
      user: strip_(t),
      companyName: companyLabel_(company),
      signatureBase64: DriveService.getSignatureBase64(t.signatureFileId),
      ptwCount: ptwCount,
      lastExam: attempts[0] ? { submitAt: attempts[0].submitAt, score: attempts[0].score,
        passed: asBool_(attempts[0].passed) } : null
    });
  }

  /** 使用者更新自己的簽名檔 */
  function updateSignature(user, payload) {
    requireFields_(payload, ['signatureBase64']);
    var fid = DriveService.saveAccountSignature(payload.signatureBase64, user.email);
    Repo.update('Users', user.id, { signatureFileId: fid }, user.id);
    AuditService.log({ user: user, actionType: 'SIGNATURE_UPDATE', entityType: 'User', entityId: user.id, success: true });
    return ok_({ updated: true });
  }

  function strip_(u) {
    var o = {};
    for (var k in u) if (k !== 'passwordHash' && k !== 'passwordSalt' && k !== '_rowIndex') o[k] = u[k];
    return o;
  }

  /** 合格人員清單（登入即可檢視）：訓練有效者，分 Issuing（Tier2+）/ Performing（Tier1） */
  function certifiedList(user) {
    var today = fmtDate_();
    var coMap = {};
    Repo.readAll('Companies').forEach(function (c) { coMap[c.id] = c; });
    var TIER_DEPT = { 2: '承商職安衛|Contractor HSE', 3: 'NMDC 施工部門|NMDC Engineering',
      4: 'NMDC 安衛部門|NMDC EHS', 5: 'PTW 協調員|PTW Coordinator' };
    var rows = Repo.find('Users', function (u2) {
      return asBool_(u2.isActive) && u2.status === 'Active' && !asBool_(u2.isTestUser) &&
        ((u2.trainingValidUntil && u2.trainingValidUntil >= today) || asBool_(u2.isAdmin));
    }).map(function (u2) {
      var co = coMap[u2.companyId] || {};
      var tier = Number(u2.tier);
      return {
        type: tier >= 2 ? 'Issuing' : 'Performing',
        dept: tier >= 2 ? (TIER_DEPT[tier] || '') : '',
        companyZh: co.nameZh || '', companyEn: co.nameEn || '',
        nameZh: u2.nameZh || '', nameEn: u2.nameEn || '',
        title: u2.title || '', tier: tier, isHse: asBool_(u2.isHse),
        trainedAt: String(u2.trainingPassedAt || '').substring(0, 10),
        validUntil: String(u2.trainingValidUntil || '').substring(0, 10)
      };
    });
    rows.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'Issuing' ? -1 : 1;
      return (a.companyEn + a.nameEn) < (b.companyEn + b.nameEn) ? -1 : 1;
    });
    return ok_({ rows: rows, today: today });
  }

  return { certifiedList: certifiedList,
    list: list, get: get, approve: approve, reject: reject, create: create, update: update,
    disable: disable, enable: enable, unlock: unlock, deleteUser: deleteUser,
    resetPasswordByAdmin: resetPasswordByAdmin, setDelegation: setDelegation, exportList: exportList,
    myProfile: myProfile, requestProfileChange: requestProfileChange, cancelProfileChange: cancelProfileChange,
    detail: detail, updateSignature: updateSignature,
    profileRequestList: profileRequestList, profileRequestApprove: profileRequestApprove,
    profileRequestReject: profileRequestReject
  };
})();

/* ============================== CompanyService.gs ============================== */
/**
 * CompanyService.gs — 公司管理（Admin）
 * 規則：已有歷史 PTW 的公司不得物理刪除，只能停用。
 */

var CompanyService = (function () {

  function list(user) {
    // 一般使用者也需要公司清單（下拉選單），僅回傳基本欄位
    var rows = Repo.readAll('Companies');
    if (!asBool_(user.isAdmin)) {
      rows = rows.filter(function (c) { return asBool_(c.isActive); });
    }
    return ok_(rows.map(function (c) {
      return { id: c.id, nameZh: c.nameZh, nameEn: c.nameEn, type: c.type, isActive: asBool_(c.isActive) };
    }));
  }

  function create(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['nameZh', 'nameEn', 'type']);
    if (['Contractor', 'NMDC', 'TPC'].indexOf(payload.type) < 0) {
      throw ApiError_('BAD_TYPE', 'type must be Contractor / NMDC / TPC', '公司類型須為 Contractor / NMDC / TPC');
    }
    var dup = Repo.findOne('Companies', function (c) {
      return c.nameZh === payload.nameZh || c.nameEn === payload.nameEn;
    });
    if (dup) throw ApiError_('DUPLICATE', 'Company already exists', '公司已存在');
    var c = Repo.insert('Companies', {
      nameZh: payload.nameZh, nameEn: payload.nameEn, type: payload.type
    }, user.id);
    AuditService.log({ user: user, actionType: 'COMPANY_CREATE', entityType: 'Company', entityId: c.id,
      newValue: payload, success: true });
    return ok_(c);
  }

  function update(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['companyId']);
    var target = Repo.getById('Companies', payload.companyId);
    if (!target) throw ApiError_('NOT_FOUND', 'Company not found', '找不到公司');
    var patch = {};
    ['nameZh', 'nameEn', 'type'].forEach(function (k) { if (payload[k] !== undefined) patch[k] = payload[k]; });
    var updated = Repo.update('Companies', target.id, patch, user.id);
    AuditService.log({ user: user, actionType: 'COMPANY_UPDATE', entityType: 'Company', entityId: target.id,
      oldValue: target, newValue: patch, success: true });
    return ok_(updated);
  }

  function disable(user, payload) {
    SecurityService.requireAdmin(user);
    var target = Repo.getById('Companies', payload.companyId);
    if (!target) throw ApiError_('NOT_FOUND', 'Company not found', '找不到公司');
    Repo.update('Companies', target.id, { isActive: false }, user.id);
    AuditService.log({ user: user, actionType: 'COMPANY_DISABLE', entityType: 'Company', entityId: target.id, success: true });
    return ok_({ disabled: true });
  }

  function enable(user, payload) {
    SecurityService.requireAdmin(user);
    var target = Repo.getById('Companies', payload.companyId);
    if (!target) throw ApiError_('NOT_FOUND', 'Company not found', '找不到公司');
    Repo.update('Companies', target.id, { isActive: true }, user.id);
    AuditService.log({ user: user, actionType: 'COMPANY_ENABLE', entityType: 'Company', entityId: target.id, success: true });
    return ok_({ enabled: true });
  }

  /** 公司 PTW 統計（M3.2 後 PTW_Master 有資料時生效） */
  function stats(user, payload) {
    SecurityService.requireAdmin(user);
    var ptws = Repo.find('PTW_Master', function (p) { return p.companyId === payload.companyId; });
    var byStatus = {};
    ptws.forEach(function (p) { byStatus[p.status] = (byStatus[p.status] || 0) + 1; });
    return ok_({ total: ptws.length, byStatus: byStatus });
  }

  /** 公開：申請帳號用公司下拉選單（僅回傳名稱） */
  function options() {
    var rows = Repo.find('Companies', function (c) { return asBool_(c.isActive); });
    return ok_(rows.map(function (c) {
      return { id: c.id, nameZh: c.nameZh, nameEn: c.nameEn, type: c.type };
    }));
  }

  return { list: list, create: create, update: update, disable: disable, enable: enable, stats: stats, options: options };
})();

/* ============================== TestModeService.gs ============================== */
/**
 * TestModeService.gs — 測試模式（僅 Admin / Tier 5）
 * 建立測試公司與各 Tier 測試人員，並允許管理員一鍵切換身分（impersonate）測試完整流程。
 * 不動任何既有架構：測試人員就是一般 Users 資料列（isTestUser=true），走完全相同的權限與流程。
 */

var TestModeService = (function () {

  var TEST_PW = 'Test1234';

  var COMPANIES = [
    { key: 'A', nameZh: 'Test Contractor Alpha', nameEn: 'Test Contractor Alpha', type: 'Contractor' },
    { key: 'B', nameZh: 'Test Contractor Beta', nameEn: 'Test Contractor Beta', type: 'Contractor' }
  ];

  // email 為唯一鍵（重複執行不會重建）
  function personaDefs_(coA, coB, nmdc) {
    return [
      { email: 'test.a.t0@ptw.test', nameZh: 'Alpha T1 Holder', nameEn: 'Alpha T1 Holder', tier: 1, companyId: coA.id, title: 'Rigger Foreman', vessel: 'DLB1600' },
      { email: 'test.a.t1@ptw.test', nameZh: 'Alpha T1 Applicant', nameEn: 'Alpha T1 Applicant', tier: 1, companyId: coA.id, title: 'Site Engineer', vessel: 'DLB1600' },
      { email: 'test.a.t2@ptw.test', nameZh: 'Alpha T2 HSE', nameEn: 'Alpha T2 HSE', tier: 2, companyId: coA.id, title: 'HSE Officer', vessel: 'DLB1600' },
      { email: 'test.b.t1@ptw.test', nameZh: 'Beta T1 Applicant', nameEn: 'Beta T1 Applicant', tier: 1, companyId: coB.id, title: 'Foreman', vessel: 'Support Vessel' },
      { email: 'test.b.t2@ptw.test', nameZh: 'Beta T2 HSE', nameEn: 'Beta T2 HSE', tier: 2, companyId: coB.id, title: 'HSE Supervisor', vessel: 'Support Vessel' },
      { email: 'test.n.t3@ptw.test', nameZh: 'NMDC T3 Construction', nameEn: 'NMDC T3 Construction', tier: 3, companyId: nmdc.id, title: 'Construction Engineer', vessel: '-' },
      { email: 'test.n.t4@ptw.test', nameZh: 'NMDC T4 HSE', nameEn: 'NMDC T4 HSE', tier: 4, companyId: nmdc.id, title: 'HSE Lead', vessel: '-' },
      { email: 'test.n.t5@ptw.test', nameZh: 'NMDC T5 Coordinator', nameEn: 'NMDC T5 Coordinator', tier: 5, companyId: nmdc.id, title: 'PTW Coordinator', vessel: '-' }
    ];
  }

  function ensureCompany_(def) {
    var found = Repo.findOne('Companies', function (c) { return c.nameEn === def.nameEn || c.nameZh === def.nameZh; });
    if (found) {
      var patch = {};
      if (!asBool_(found.isActive)) patch.isActive = true;
      if (found.nameZh !== def.nameZh) patch.nameZh = def.nameZh;
      if (Object.keys(patch).length) Repo.update('Companies', found.id, patch, 'testmode');
      return found;
    }
    return Repo.insert('Companies', { nameZh: def.nameZh, nameEn: def.nameEn, type: def.type }, 'testmode');
  }

  /** 建立/修復測試公司與測試人員（idempotent） */
  function enable(user) {
    SecurityService.requireAdmin(user);
    var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC' && asBool_(c.isActive); });
    if (!nmdc) throw ApiError_('NO_NMDC', 'NMDC company not found', '找不到 NMDC 公司資料');
    var coA = ensureCompany_(COMPANIES[0]);
    var coB = ensureCompany_(COMPANIES[1]);

    var trainingUntil = fmtDate_(new Date(Date.now() + 3 * 365 * 86400000));
    var created = 0;
    personaDefs_(coA, coB, nmdc).forEach(function (d) {
      var existing = Repo.findOne('Users', function (u) { return normEmail_(u.email) === d.email; });
      if (existing) {
        // 修復：若被停用/刪除則復原，確保可切換；名稱同步為最新定義（全英文）
        var fix = {};
        if (existing.status !== 'Active' || !asBool_(existing.isActive)) {
          fix = { status: 'Active', isActive: true, lockedUntil: '', failedLoginCount: 0 };
        }
        if (existing.nameZh !== d.nameZh || existing.nameEn !== d.nameEn) {
          fix.nameZh = d.nameZh; fix.nameEn = d.nameEn;
        }
        if (Number(existing.tier) !== Number(d.tier)) fix.tier = d.tier;  // Tier 0 → 1 等定義變更同步
        if (Object.keys(fix).length) Repo.update('Users', existing.id, fix, 'testmode');
        return;
      }
      var salt = randomToken_(32);
      Repo.insert('Users', {
        email: d.email, nameZh: d.nameZh, nameEn: d.nameEn,
        companyId: d.companyId, title: d.title, phone: '0900000000', vessel: d.vessel,
        tier: d.tier, isAdmin: false, badgeNo: 'TEST-' + d.tier,
        passwordSalt: salt, passwordHash: hashPassword_(TEST_PW, salt), hashIter: CFG.HASH_ITERATIONS,
        status: 'Active', failedLoginCount: 0, mustChangePassword: false,
        applyReason: 'Test mode persona', appliedTier: d.tier,
        trainingPassedAt: fmtDateTime_(), trainingValidUntil: trainingUntil,
        langPref: 'en', isTestUser: true
      }, 'testmode');
      created++;
    });
    AuditService.log({ user: user, actionType: 'TESTMODE_ENABLE', entityType: 'System',
      comment: 'created=' + created, success: true });
    try { ensureExamplePtw_(); } catch (e) { console.error('example ptw failed: ' + e.message); }
    return personas(user);
  }

  /** 範例 PTW（Example-001）：完整填寫、已核發生效，可測試 PDF/展延/暫停/結案全流程 */
  function ensureExamplePtw_() {
    if (Repo.findOne('PTW_Master', function (p) { return p.ptwNumber === 'Example-001' && asBool_(p.isActive); })) return;
    var testUsers = Repo.find('Users', function (u) { return asBool_(u.isTestUser) && asBool_(u.isActive); });
    var byTier = function (t, coId) {
      return testUsers.filter(function (u) {
        return Number(u.tier) === t && (!coId || u.companyId === coId);
      })[0];
    };
    var t1 = testUsers.filter(function (u) { return Number(u.tier) === 1; })[0];
    if (!t1) return;
    var t2 = byTier(2, t1.companyId), t3 = byTier(3), t4 = byTier(4), t5 = byTier(5);
    if (!t2 || !t3 || !t4 || !t5) return;
    var SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    var today = fmtDate_();
    var to = fmtDate_(new Date(Date.now() + 7 * 86400000));

    var d = PTWService.createDraft(t1);
    var pid = d.data.ptwId;
    PTWService.saveDraft(t1, { ptwId: pid,
      vessel: 'DLB-1600 Derrick Lay Barge', executionDate: today,
      areaLocation: 'KP 12+350 ~ KP 12+600, Tongxiao offshore pipeline route (EXAMPLE)',
      workDescription: '[EXAMPLE] Riser tie-in welding works: butt-weld (tie-in weld) on the existing 24" subsea pipeline riser, including pre-heating, TIG root pass, SMAW fill & cap, and post-weld NDT inspection.',
      toolsEquipment: 'Diesel welding machines x2, TIG torch set, angle grinders, gas detector (O2/LEL/H2S/CO), portable fire extinguishers x4, fire hose',
      validFrom: today, validTo: to,
      scaffoldingRequired: 'Y', gasTestRequired: 'Y', cssIsoRequired: 'N',
      wtHotWork: true, wtColdWork: true,
      holderUserId: JSON.stringify([t1.id]), paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzNakedFlame: true, hzSparks: true, hzFireExplosion: true, hzOverWater: true,
        pcFireWatch: true, pcFireExt: true, pcGasDetection: true, pcLifeJacket: true, scaffoldConfirm: true }),
      docChecksJson: JSON.stringify({ docJsaRa: true, docMethodStatement: true }) });
    CertificateService.save(t1, { ptwId: pid, certType: 'HW', markComplete: true,
      dataJson: JSON.stringify({ hw_hz01: 'Y', hw_hz02: 'Y', hw_swaAttached: 'Y',
        hw_ctrl01: 'Y', hw_ctrl03: 'Y', hw_ctrl06: 'Y', hw_wsc01: 'Y', hw_wsc02: 'Y' }) });
    var b64 = Utilities.base64Encode('example test document');
    ['MethodStatement', 'RiskAssessment', 'DailyValidation', 'TbmHip', 'SelfInspection', 'GasMonitorLog']
      .forEach(function (cat) {
        DriveService.uploadAttachment(t1, { ptwId: pid, fileName: 'Example_' + cat + '.pdf',
          mimeType: 'application/pdf', base64: b64, category: cat });
      });
    PTWService.submit(t1, { ptwId: pid }); // 測試人員建立 → 編號自動為 Example-001，簽發沿用
    ApprovalService.approve(t2, { ptwId: pid, signatureDataUrl: SIG, comment: '[EXAMPLE] JSA and personnel qualifications verified.' }, {});
    ApprovalService.approve(t3, { ptwId: pid, signatureDataUrl: SIG, comment: '[EXAMPLE] Construction method confirmed.' }, {});
    ApprovalService.approve(t4, { ptwId: pid, signatureDataUrl: SIG, comment: '[EXAMPLE] Hazard identification and precautions comply with requirements.' }, {});
    ApprovalService.approve(t5, { ptwId: pid, signatureDataUrl: SIG, comment: '[EXAMPLE] Approved for issue.' }, {});
    console.log('Example-001 sample PTW created.');
  }

  /** 測試人員清單（含公司名，供下拉選單） */
  function personas(user) {
    SecurityService.requireAdmin(user);
    var coMap = {};
    Repo.readAll('Companies').forEach(function (c) { coMap[c.id] = c; });
    var rows = Repo.find('Users', function (u) { return asBool_(u.isTestUser) && asBool_(u.isActive); });
    rows.sort(function (a, b) {
      var ka = (coMap[a.companyId] || {}).nameEn + Number(a.tier), kb = (coMap[b.companyId] || {}).nameEn + Number(b.tier);
      return ka < kb ? -1 : 1;
    });
    return ok_({
      personas: rows.map(function (u) {
        var co = coMap[u.companyId] || {};
        return { id: u.id, email: u.email, nameZh: u.nameZh, nameEn: u.nameEn, tier: Number(u.tier),
          companyZh: co.nameZh || '', companyEn: co.nameEn || '' };
      }),
      password: TEST_PW
    });
  }

  /** 以測試人員身分建立 session（只允許切換到 isTestUser 帳號） */
  function impersonate(user, payload, meta) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['userId']);
    var target = Repo.getById('Users', payload.userId);
    if (!target) throw ApiError_('NOT_FOUND', 'User not found', '找不到使用者');
    if (!asBool_(target.isTestUser)) {
      throw ApiError_('NOT_TEST_USER', 'Can only impersonate test-mode users', '僅能切換為測試人員身分');
    }
    if (target.status !== 'Active' || !asBool_(target.isActive)) {
      Repo.update('Users', target.id, { status: 'Active', isActive: true, lockedUntil: '', failedLoginCount: 0 }, 'testmode');
      target = Repo.getById('Users', target.id);
    }
    var session = AuthService.createSessionFor(target, (meta && meta.userAgent) || 'testmode');
    AuditService.log({ user: user, actionType: 'TESTMODE_IMPERSONATE', entityType: 'User', entityId: target.id,
      comment: 'as ' + target.email, success: true });
    return ok_({ token: session.token, expiresAt: session.expiresAt, user: AuthService.publicUser(target) });
  }

  /** 清除測試資料：軟刪除所有測試人員建立的 PTW（可重複測試） */
  function reset(user) {
    SecurityService.requireAdmin(user);
    var testIds = {};
    Repo.find('Users', function (u) { return asBool_(u.isTestUser); })
      .forEach(function (u) { testIds[u.id] = true; });
    var cleared = 0;
    Repo.find('PTW_Master', function (p) { return asBool_(p.isActive) && testIds[p.applicantUserId]; })
      .forEach(function (p) {
        Repo.update('PTW_Master', p.id, { isActive: false }, user.id);
        cleared++;
      });
    AuditService.log({ user: user, actionType: 'TESTMODE_RESET', entityType: 'System',
      comment: 'cleared=' + cleared, success: true });
    return ok_({ cleared: cleared });
  }

  /**
   * 一鍵重置（測試結束用）：刪除所有 PTW（含證書/簽核/附件/歷程）、所有公司（NMDC 保留）、
   * 所有人員（只留 paultong.ehs@gmail.com；testnmdc 於下次開頁自動重建）；
   * 編號自 OPTW-0001 重新開始；Drive 的 PTW 資料夾移至垃圾桶。
   * 保留：題庫、訓練課程、系統設定、下載專區、公告、稽核紀錄。
   */
  var KEEP_ADMIN_EMAIL = 'paultong.ehs@gmail.com';

  function factoryReset(user, payload) {
    SecurityService.requireAdmin(user);
    if (String(payload && payload.confirm) !== 'RESET') {
      throw ApiError_('CONFIRM_REQUIRED', 'Type RESET to confirm', '請輸入 RESET 以確認執行');
    }
    var keep = Repo.findOne('Users', function (u) { return normEmail_(u.email) === KEEP_ADMIN_EMAIL; });
    if (!keep) {
      throw ApiError_('KEEP_ADMIN_MISSING',
        'Admin account ' + KEEP_ADMIN_EMAIL + ' not found — create it first, then reset',
        '找不到要保留的管理員帳號 ' + KEEP_ADMIN_EMAIL + '，請先建立該帳號再執行重置');
    }
    // 1) Drive：PTW 資料夾移至垃圾桶；被刪人員的簽名檔一併清除
    Repo.readAll('PTW_Master').forEach(function (p) {
      if (p.driveFolderId) { try { DriveApp.getFolderById(p.driveFolderId).setTrashed(true); } catch (e) {} }
    });
    Repo.readAll('Users').forEach(function (u) {
      if (u.id !== keep.id && u.signatureFileId) {
        try { DriveApp.getFileById(u.signatureFileId).setTrashed(true); } catch (e) {}
      }
    });
    // 2) 交易資料全清
    ['PTW_Master', 'PTW_Hazards', 'PTW_GasTests', 'PTW_Certificates',
     'Cert_HotWork', 'Cert_ColdWork', 'Cert_ElectricalIso', 'Cert_ProcessIso',
     'Cert_ConfinedSpace', 'Cert_Excavation', 'Cert_Radiography', 'Cert_Diving',
     'PTW_Attachments', 'PTW_Approvals', 'PTW_Comments', 'PTW_StatusHistory',
     'PTW_Versions', 'PTW_Signatures', 'PTW_Revalidations',
     'Notifications', 'ExamAttempts', 'ExamAnswers', 'TrainingProgress',
     'UserRoles', 'Delegations', 'ProfileChangeRequests'
    ].forEach(function (n) { try { Repo.removeWhere(n, function () { return true; }); } catch (e) { console.error('reset wipe ' + n + ': ' + e.message); } });
    // 3) 編號歸零（計數表清空；資料已清空，下一號即 0001）
    try { Repo.removeWhere('Sequences', function () { return true; }); } catch (e) {}
    // 4) 人員：只留指定管理員；其 session 保留（其他人全部登出）
    try { Repo.removeWhere('Sessions', function (s) { return s.userId !== keep.id; }); } catch (e) {}
    Repo.removeWhere('Users', function (u) { return u.id !== keep.id; });
    // 5) 公司：保留 NMDC 與保留管理員所屬公司
    var keepCo = {}; if (keep.companyId) keepCo[keep.companyId] = true;
    Repo.find('Companies', function (c) { return c.type === 'NMDC'; }).forEach(function (c) { keepCo[c.id] = true; });
    Repo.removeWhere('Companies', function (c) { return !keepCo[c.id]; });
    AuditService.log({ user: user, actionType: 'FACTORY_RESET', entityType: 'System',
      comment: 'All PTWs/companies/users wiped; kept ' + KEEP_ADMIN_EMAIL + '; numbering restarted', success: true });
    return ok_({ reset: true, keptAdmin: KEEP_ADMIN_EMAIL });
  }

  return { enable: enable, personas: personas, impersonate: impersonate, reset: reset,
    factoryReset: factoryReset };
})();

/* ============================== DashboardService.gs ============================== */
/**
 * DashboardService.gs — 首頁 Dashboard：KPI（全員相同）＋「待您審核」佇列
 */

var DashboardService = (function () {

  function dashboard(user) {
    var all = SecurityService.stripTestPtws(user, Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); }));
    // 承商隔離：Tier 1–2（非管理員）之 KPI／待辦僅計本公司 PTW；Tier 3–5 與管理員看全部
    if (!asBool_(user.isAdmin) && Number(user.tier) < 3) {
      all = all.filter(function (p) { return p.companyId === user.companyId; });
    }
    var S = CFG.STATUS;
    var nowStr = fmtDateTime_();
    var reminderH = Number(getSetting_('expiryReminderHours')) || 24;
    var soonStr = fmtDateTime_(new Date(Date.now() + reminderH * 3600 * 1000));

    var pendingSet = [S.SUBMITTED, S.PENDING_T2, S.PENDING_T3, S.PENDING_T4, S.PENDING_T5];
    var openSet = [S.APPROVED, S.ACTIVE, S.EXTENDED, S.SUSPENDED];

    function c(fn) { return all.filter(fn).length; }

    // KPI — Tier 3+／管理員為全域數字；承商（Tier 1–2）僅本公司數字
    var kpi = {
      total: all.length,
      draft: c(function (p) { return p.status === S.DRAFT; }),
      pending: c(function (p) { return pendingSet.indexOf(p.status) >= 0; }),
      approved: c(function (p) { return p.status === S.APPROVED; }),
      active: c(function (p) { return ptwTimeState_(p, nowStr) === 'active'; }),
      issuedPending: c(function (p) { return ptwTimeState_(p, nowStr) === 'notStarted'; }),
      expiringSoon: c(function (p) {
        return (p.status === S.ACTIVE || p.status === S.EXTENDED) &&
          p.validTo && p.validTo > nowStr && p.validTo <= soonStr;
      }),
      expired: c(function (p) { return p.status === S.EXPIRED; }),
      overdueOpen: c(function (p) {
        var closedSet = [S.CLOSED, S.CANCELLED];
        return p.validTo && p.validTo < nowStr && closedSet.indexOf(p.status) < 0 &&
          p.status !== S.DRAFT && pendingSet.indexOf(p.status) < 0;
      }),
      returned: c(function (p) { return p.status === S.RETURNED || p.status === S.RETURNED_CORRECTION; }),
      closed: c(function (p) { return p.status === S.CLOSED; })
    };

    // 「待您審核」佇列 — 規格 5.2
    var companyMap = {};
    Repo.readAll('Companies').forEach(function (co) { companyMap[co.id] = { en: co.nameEn, zh: co.nameZh }; });
    var userMap = {};
    Repo.readAll('Users').forEach(function (u2) { userMap[u2.id] = u2.nameEn || u2.nameZh || u2.email; });

    var tier = Number(user.tier);
    var openOverdue = [S.ACTIVE, S.EXTENDED, S.EXPIRED, S.WORK_COMPLETED];
    var myQueue = all.filter(function (p) {
      // 退回修改：申請人本人須處理（也列入待辦）
      if ((p.status === S.RETURNED || p.status === S.RETURNED_CORRECTION) && p.applicantUserId === user.id) return true;
      // 逾期未關單：提醒承商申請人（Tier 1）儘速走結案流程
      if (p.applicantUserId === user.id && p.validTo && p.validTo < nowStr && openOverdue.indexOf(p.status) >= 0) return true;
      // 結案確認輪到我這一關
      if (p.status === S.PENDING_CLOSEOUT && Number(p.coCurrentTier) === tier &&
          (tier !== 2 || p.companyId === user.companyId) && p.applicantUserId !== user.id) return true;
      if (pendingSet.indexOf(p.status) < 0) return false;
      if (Number(p.currentTier) !== tier) return false;
      if (p.applicantUserId === user.id) return false;                 // 不得審自己的
      if (tier === 2 && p.companyId !== user.companyId) return false;  // T2 限本公司
      return true;
    }).map(function (p) {
      var since = parseDateTime_(p.submittedAt || p.updatedAt || p.createdAt);
      var waitingDays = since ? Math.floor((Date.now() - since.getTime()) / 86400000) : 0;
      var co = companyMap[p.companyId] || {};
      var overdueClose = (p.applicantUserId === user.id && p.validTo && p.validTo < nowStr &&
        openOverdue.indexOf(p.status) >= 0);
      return {
        id: p.id,
        overdueClose: overdueClose,
        ptwNumber: p.ptwNumber || p.tempNumber,
        companyEn: co.en || '', companyZh: co.zh || '',
        areaLocation: p.areaLocation,
        status: p.status,
        currentTier: p.currentTier,
        currentReviewer: userMap[p.currentReviewerId] || '',
        waitingDays: waitingDays
      };
    });
    myQueue.sort(function (a, b) { return b.waitingDays - a.waitingDays; });

    // 我的 PTW 數（依資料範圍）
    var mine = SecurityService.scopePtwList(user, all);

    return ok_({
      kpi: kpi,
      myQueue: myQueue,
      myPtwCount: (tier === 1) ? mine.filter(function (p) { return p.applicantUserId === user.id; }).length : mine.length,
      trainingValid: !!(user.trainingValidUntil && user.trainingValidUntil >= fmtDate_()),
      trainingValidUntil: user.trainingValidUntil || null
    });
  }

  /** 首頁看板（公開）：執行中（淺綠框）/ 逾期未關（淺紅框），附件下載區上方；
   *  未登入＝全部公司；登入承商（Tier 1–2）＝本公司；測試 PTW 僅管理員/測試身分可見
   *  欄位：PTW編號、執行日期、船舶、工作區域、工作內容、持有人 */
  function board(user) {
    var rows = Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); });
    var all;
    if (!user) {
      all = rows;   // 未登入（公開看板）：顯示「所有」執行中／逾期 PTW，不做任何過濾
    } else {
      // 登入後：管理員／Tier5／測試身分可見測試 PTW；承商（Tier 1–2）僅列本公司
      all = SecurityService.stripTestPtws(user, rows);
      if (!asBool_(user.isAdmin) && Number(user.tier) < 3) {
        all = all.filter(function (p) { return p.companyId === user.companyId; });
      }
    }
    var S = CFG.STATUS;
    var nowStr = fmtDateTime_();
    var pendingSet = [S.SUBMITTED, S.PENDING_T2, S.PENDING_T3, S.PENDING_T4, S.PENDING_T5];
    var userMap = {};
    Repo.readAll('Users').forEach(function (u) { userMap[u.id] = u; });
    var row = function (p) {
      var h = userMap[p.holderUserId] || {};
      return {
        id: p.id, number: p.ptwNumber || p.tempNumber,
        executionDate: String(p.executionDate || '').substring(0, 10),
        validFrom: String(p.validFrom || '').substring(0, 10),
        vessel: p.vessel || '', areaLocation: p.areaLocation || '',
        workDescription: p.workDescription || '',
        holderZh: h.nameZh || '', holderEn: h.nameEn || '',
        validTo: String(p.validTo || '').substring(0, 10), status: p.status
      };
    };
    // 執行中：狀態 Active/Extended 且「現在」落在有效期間內；
    // 已核發但尚未到開工日（validFrom > now）不列在首頁看板（僅 KPI「已核發待生效」與清單篩選可見）；
    // 已逾期者只出現在 Overdue 清單（不重複顯示）
    var active = all.filter(function (p) {
      return ptwTimeState_(p, nowStr) === 'active';
    }).map(row).slice(0, 12);
    var closedSet = [S.CLOSED, S.CANCELLED, S.DRAFT];
    var overdue = all.filter(function (p) {
      return p.validTo && p.validTo < nowStr && closedSet.indexOf(p.status) < 0 && pendingSet.indexOf(p.status) < 0;
    }).map(row).slice(0, 12);
    return ok_({ active: active, overdue: overdue });
  }

  return { dashboard: dashboard, board: board };
})();

/* ============================== TrainingService.gs ============================== */
/**
 * TrainingService.gs — 線上訓練（規格 §6 Step 1、§10.3）
 * 影片觀看以「前端每 15 秒回報實際播放秒數」累計，伺服器端以牆鐘時間上限防灌秒；
 * 累計 ≥ minWatchPercent（預設 90%）才可進入考試。
 */

var TrainingService = (function () {

  /** 取用中課程；lang 指定時優先取該語言版本，其次無語言別（舊資料），再退回任一 */
  function activeCourse_(lang) {
    var rows = Repo.find('TrainingCourses', function (c) { return asBool_(c.isActive); });
    if (!rows.length) return null;
    if (lang) {
      var exact = rows.filter(function (c) { return String(c.langCode || '') === lang; });
      if (exact.length) return exact[0];
    }
    var legacy = rows.filter(function (c) { return !c.langCode; });
    return legacy[0] || rows[0];
  }

  function myProgress_(userId, courseId) {
    return Repo.findOne('TrainingProgress', function (p) {
      return p.userId === userId && p.courseId === courseId && asBool_(p.isActive);
    });
  }

  /** 課程影片清單（支援多部；相容舊單一 youtubeVideoId） */
  function courseVideos_(course) {
    var vids = [];
    try { vids = JSON.parse(course.videosJson || '[]') || []; } catch (e) { vids = []; }
    vids = vids.filter(function (v) { return v && v.id; });
    if (!vids.length && course.youtubeVideoId) {
      vids = [{ id: course.youtubeVideoId, title: '', durationSec: Number(course.durationSec || 0) }];
    }
    return vids;
  }

  /** 每部影片觀看秒數（相容舊資料：舊 watchedSec 歸到第一部） */
  function videoProg_(prog, vids) {
    var vp = {};
    try { vp = JSON.parse((prog && prog.videoProgressJson) || '{}') || {}; } catch (e) { vp = {}; }
    if (prog && !Object.keys(vp).length && Number(prog.watchedSec || 0) > 0 && vids.length) {
      vp[vids[0].id] = Number(prog.watchedSec || 0);
    }
    return vp;
  }

  /** 依影片清單與觀看秒數計算彙總（總秒數/百分比/是否全部完成） */
  function summarize_(vids, vp, minPct) {
    var totalDur = 0, totalWatched = 0, allDone = vids.length > 0;
    var list = vids.map(function (v) {
      var dur = Number(v.durationSec || 0);
      var sec = Math.min(Number(vp[v.id] || 0), dur > 0 ? dur : Number(vp[v.id] || 0));
      var pct = dur > 0 ? Math.min(100, Math.round(sec * 100 / dur)) : 0;
      var done = dur > 0 && pct >= minPct;
      if (!done) allDone = false;
      totalDur += dur; totalWatched += Math.min(sec, dur > 0 ? dur : sec);
      return { id: v.id, title: v.title || '', durationSec: dur, watchedSec: sec, watchPercent: pct, completed: done };
    });
    return { videos: list, totalDur: totalDur, totalWatched: totalWatched,
      totalPct: totalDur > 0 ? Math.min(100, Math.round(totalWatched * 100 / totalDur)) : 0,
      completed: allDone };
  }

  /** 今日（台北）是否仍在考試鎖定期 → 回傳鎖定日或 null */
  function examLock_(userId, courseId) {
    var today = fmtDate_();
    var attempts = Repo.find('ExamAttempts', function (a) {
      return a.userId === userId && (!courseId || a.courseId === courseId);
    });
    for (var i = 0; i < attempts.length; i++) {
      var a = attempts[i];
      if (!asBool_(a.passed) && a.lockedUntilDate && String(a.lockedUntilDate).substring(0, 10) > today) {
        return String(a.lockedUntilDate).substring(0, 10);
      }
    }
    return null;
  }

  /** 訓練頁初始資料（payload.lang: 'zh'|'en' 依介面語言取對應課程） */
  function getCourse(user, payload) {
    var course = activeCourse_(payload && payload.lang);
    if (!course) return ok_({ course: null });
    var prog = myProgress_(user.id, course.id);
    var minPct = Number(course.minWatchPercent || getSetting_('minWatchPercent') || 90);
    var vids = courseVideos_(course);
    var vp = videoProg_(prog, vids);
    var sum = summarize_(vids, vp, minPct);
    var completed = (prog ? asBool_(prog.completed) : false) || sum.completed;
    var lockDate = examLock_(user.id, course.id);
    var passed = !!(user.trainingValidUntil && user.trainingValidUntil >= fmtDate_());
    return ok_({
      course: {
        id: course.id, title: course.title, youtubeVideoId: vids.length ? vids[0].id : course.youtubeVideoId,
        videos: sum.videos,
        durationSec: sum.totalDur, courseVersion: course.courseVersion,
        validityMonths: Number(course.validityMonths || 36), minWatchPercent: minPct
      },
      progress: {
        watchedSec: sum.totalWatched, watchPercent: sum.totalPct, completed: completed,
        watchStartAt: prog ? prog.watchStartAt : '', watchCompletedAt: prog ? prog.watchCompletedAt : ''
      },
      canTakeExam: completed && !lockDate,
      examLockedUntil: lockDate,
      lastExam: (function () {
        var atts = Repo.find('ExamAttempts', function (a) { return a.userId === user.id && a.submitAt; });
        atts.sort(function (a, b) { return a.submitAt < b.submitAt ? 1 : -1; });
        return atts[0] ? { submitAt: atts[0].submitAt, score: Number(atts[0].score || 0), passed: asBool_(atts[0].passed) } : null;
      })(),
      trainingPassed: passed,
      trainingPassedAt: user.trainingPassedAt || '',
      trainingValidUntil: user.trainingValidUntil || ''
    });
  }

  /**
   * 前端每 ~15 秒回報實際播放秒數（deltaSec）。
   * 防灌秒：本次可累計上限 =（距上次回報的牆鐘秒數）+15 容差，且單次 ≤ 120。
   */
  function reportProgress(user, payload) {
    requireFields_(payload, ['courseId', 'deltaSec']);
    var course = Repo.getById('TrainingCourses', payload.courseId);
    if (!course || !asBool_(course.isActive)) throw ApiError_('NO_COURSE', 'Course not found', '找不到課程');

    var vids = courseVideos_(course);
    if (!vids.length) throw ApiError_('NO_COURSE', 'Course has no videos', '課程尚未設定影片');
    var videoId = String(payload.videoId || vids[0].id);
    var vIdx = -1;
    vids.forEach(function (v, i) { if (v.id === videoId) vIdx = i; });
    if (vIdx < 0) { vIdx = 0; videoId = vids[0].id; }

    // 影片長度：若該部影片未設定，採用播放器回報（>60 秒才接受）
    if (!Number(vids[vIdx].durationSec || 0) && payload.playerDurationSec && Number(payload.playerDurationSec) > 60) {
      vids[vIdx].durationSec = Math.round(Number(payload.playerDurationSec));
      Repo.update('TrainingCourses', course.id, {
        videosJson: JSON.stringify(vids),
        durationSec: vids.reduce(function (a, v) { return a + Number(v.durationSec || 0); }, 0)
      }, user.id);
    }

    var delta = Math.max(0, Math.min(120, Math.round(Number(payload.deltaSec))));
    var prog = myProgress_(user.id, course.id);
    var nowMs = Date.now();
    if (prog) {
      var last = parseDateTime_(prog.updatedAt);
      var elapsed = last ? Math.max(0, (nowMs - last.getTime()) / 1000) : 999;
      delta = Math.min(delta, Math.round(elapsed) + 15); // 牆鐘上限
    }
    var minPct = Number(course.minWatchPercent || getSetting_('minWatchPercent') || 90);

    var wasCompleted;
    if (!prog) {
      prog = Repo.insert('TrainingProgress', {
        userId: user.id, courseId: course.id,
        watchStartAt: fmtDateTime_(), watchCompletedAt: '',
        watchedSec: 0, watchPercent: 0, completed: false, videoProgressJson: '{}'
      }, user.id);
      wasCompleted = false;
    } else {
      wasCompleted = asBool_(prog.completed);
    }

    var vp = videoProg_(prog, vids);
    var dur = Number(vids[vIdx].durationSec || 0);
    var sec = Number(vp[videoId] || 0) + delta;
    if (dur > 0) sec = Math.min(sec, dur);
    vp[videoId] = sec;

    var sum = summarize_(vids, vp, minPct);
    var completed = wasCompleted || sum.completed;
    var patch = { watchedSec: sum.totalWatched, watchPercent: sum.totalPct, completed: completed,
      videoProgressJson: JSON.stringify(vp) };
    if (completed && !prog.watchCompletedAt) patch.watchCompletedAt = fmtDateTime_();
    Repo.update('TrainingProgress', prog.id, patch, user.id);

    if (completed && !wasCompleted) {
      AuditService.log({ user: user, actionType: 'TRAINING_VIDEO_COMPLETED', entityType: 'Training',
        entityId: course.id, success: true });
    }
    return ok_({ watchedSec: sum.totalWatched, watchPercent: sum.totalPct, completed: completed,
      durationSec: sum.totalDur, videos: sum.videos,
      video: { id: videoId, watchedSec: sec, durationSec: dur,
        watchPercent: dur > 0 ? Math.min(100, Math.round(sec * 100 / dur)) : 0 } });
  }

  // ---------- 管理（§10.3） ----------

  /** 設定/更新課程（單一啟用課程） */
  function setCourse(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['title']);
    var norm = function (v) { return String(v || '').replace(/^.*(?:youtu\.be\/|v=)([\w-]{6,}).*$/, '$1').trim(); };
    var langCode = String(payload.langCode || '');
    // 依語言別找既有課程；zh 可承接無語言別之舊課程
    var existing = Repo.findOne('TrainingCourses', function (c) {
      return asBool_(c.isActive) && String(c.langCode || '') === langCode;
    }) || (langCode === 'zh' ? Repo.findOne('TrainingCourses', function (c) {
      return asBool_(c.isActive) && !c.langCode;
    }) : null) || (langCode === '' ? activeCourse_() : null);
    var oldVids = existing ? courseVideos_(existing) : [];
    var oldDur = {}; oldVids.forEach(function (v) { oldDur[v.id] = Number(v.durationSec || 0); });

    // 多部影片（payload.videos）優先；相容舊單一 youtubeVideoId
    var vids = [];
    if (payload.videos && payload.videos.length) {
      payload.videos.forEach(function (v) {
        var id = norm(v.id || v.url || '');
        if (!id) return;
        vids.push({ id: id, title: String(v.title || '').trim(),
          durationSec: Number(v.durationSec || oldDur[id] || 0) });
      });
    } else if (payload.youtubeVideoId) {
      var single = norm(payload.youtubeVideoId);
      vids = [{ id: single, title: '', durationSec: Number(payload.durationSec || oldDur[single] || 0) }];
    }
    if (!vids.length) throw ApiError_('MISSING_FIELDS', 'At least one video is required', '至少需一部影片');

    var data = {
      title: payload.title,
      langCode: langCode || (existing ? (existing.langCode || '') : ''),
      youtubeVideoId: vids[0].id,
      videosJson: JSON.stringify(vids),
      durationSec: vids.reduce(function (a, v) { return a + Number(v.durationSec || 0); }, 0),
      courseVersion: payload.courseVersion || (existing ? existing.courseVersion : 'v1'),
      validityMonths: Number(payload.validityMonths || 36),
      minWatchPercent: Number(payload.minWatchPercent || 90)
    };
    var saved;
    if (existing) {
      // 影片清單變更 = 觀看進度重新計算；相同清單僅更新欄位
      var oldIds = oldVids.map(function (v) { return v.id; }).join(',');
      var newIds = vids.map(function (v) { return v.id; }).join(',');
      var videoChanged = oldIds !== newIds;
      saved = Repo.update('TrainingCourses', existing.id, data, user.id);
      if (videoChanged) {
        Repo.find('TrainingProgress', function (p) { return p.courseId === existing.id && asBool_(p.isActive); })
          .forEach(function (p) { Repo.update('TrainingProgress', p.id, { isActive: false }, user.id); });
      }
    } else {
      saved = Repo.insert('TrainingCourses', data, user.id);
    }
    AuditService.log({ user: user, actionType: 'TRAINING_COURSE_SET', entityType: 'TrainingCourse',
      entityId: saved.id, newValue: data, success: true });
    return ok_(saved);
  }

  /** 訓練/考試紀錄總覽（成績、未通過、到期名單） */
  function records(user) {
    SecurityService.requireAdmin(user);
    var users = {}, out = [];
    Repo.readAll('Users').forEach(function (u2) { users[u2.id] = u2; });
    var attempts = Repo.readAll('ExamAttempts').filter(function (a) { return !asBool_(a.isPractice); });
    attempts.sort(function (a, b) { return a.startAt < b.startAt ? 1 : -1; });
    attempts.forEach(function (a) {
      var u2 = users[a.userId] || {};
      out.push({
        attemptId: a.id, userId: a.userId,
        userName: (u2.nameEn || '') + ' / ' + (u2.nameZh || ''), email: u2.email || '',
        attemptNo: a.attemptNo, startAt: a.startAt, submitAt: a.submitAt,
        score: a.score, passed: asBool_(a.passed), lockedUntilDate: a.lockedUntilDate || ''
      });
    });
    var today = fmtDate_();
    var soon = fmtDate_(new Date(Date.now() + 60 * 86400000));
    var expiry = Object.keys(users).map(function (id) { return users[id]; })
      .filter(function (u2) { return u2.trainingValidUntil; })
      .map(function (u2) {
        return { userId: u2.id, email: u2.email, name: (u2.nameEn || '') + ' / ' + (u2.nameZh || ''),
          trainingValidUntil: u2.trainingValidUntil,
          status: u2.trainingValidUntil < today ? 'Expired' : (u2.trainingValidUntil <= soon ? 'ExpiringSoon' : 'Valid') };
      });
    return ok_({ attempts: out, expiry: expiry });
  }

  /** 重新開放考試（清除鎖定） */
  function reopen(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['userId']);
    var n = 0;
    Repo.find('ExamAttempts', function (a) {
      return a.userId === payload.userId && a.lockedUntilDate && !asBool_(a.passed);
    }).forEach(function (a) { Repo.update('ExamAttempts', a.id, { lockedUntilDate: '' }, user.id); n++; });
    AuditService.log({ user: user, actionType: 'EXAM_REOPEN', entityType: 'ExamAttempt',
      entityId: payload.userId, comment: 'cleared ' + n + ' locks', success: true });
    return ok_({ cleared: n });
  }

  /** 管理端：中/英課程分列（精確依 langCode；舊無語言別課程列為 zh） */
  function adminCourses(user) {
    SecurityService.requireAdmin(user);
    var rows = Repo.find('TrainingCourses', function (c) { return asBool_(c.isActive); });
    var pick = function (lang) {
      var exact = rows.filter(function (c) { return String(c.langCode || '') === lang; })[0];
      if (!exact && lang === 'zh') exact = rows.filter(function (c) { return !c.langCode; })[0];
      if (!exact) return null;
      return { id: exact.id, title: exact.title, courseVersion: exact.courseVersion,
        langCode: exact.langCode || '', videos: courseVideos_(exact) };
    };
    return ok_({ zh: pick('zh'), en: pick('en') });
  }

  return { getCourse: getCourse, reportProgress: reportProgress, setCourse: setCourse, adminCourses: adminCourses,
    records: records, reopen: reopen, examLock: examLock_, myProgress: myProgress_, activeCourse: activeCourse_ };
})();

/* ============================== ExamService.gs ============================== */
/**
 * ExamService.gs — 線上考試（規格 §6 Step 2/3）
 * 19 題 = 18 選擇（MC，每題 5 分）+ 1 配對（Match，10 分），滿分 100、60 及格。
 * - 題庫可勾選「必考」（mustInclude）：出題時必考題優先納入，餘額由其他題目隨機補滿。
 * - 管理員可自題庫執行「測試考試」（practice）：不寫入正式紀錄、不鎖定、不影響訓練效期。
 * - 題目與選項隨機排序；正確答案只存伺服器端，絕不下發前端。
 * - 未交卷的 attempt 重新 start 會回傳同一份題組（防重新整理換題）。
 * - 未及格：鎖定至台北時間隔日 00:00（伺服器判定，換瀏覽器/重登入無法繞過）。
 * - 及格：更新 Users.trainingPassedAt / trainingValidUntil（+validityMonths，預設 36 個月）。
 */

var ExamService = (function () {

  /** 考試組成（固定）：18 題選擇 × 5 分 + 1 題配合 × 10 分 = 100 */
  function examCfg_() {
    return { mcCount: 18, mcPoints: 5, matchCount: 1, matchPoints: 10, total: 100 };
  }

  function shuffle_(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** 依台北日期加月數（訓練效期用） */
  function addMonthsTaipei_(months) {
    var parts = fmtDate_().split('-').map(Number);
    var y = parts[0], m = parts[1] - 1 + months, d = Math.min(parts[2], 28);
    y += Math.floor(m / 12); m = m % 12;
    var mm = ('0' + (m + 1)).slice(-2), dd = ('0' + d).slice(-2);
    return y + '-' + mm + '-' + dd;
  }

  /** 從題庫抽題：必考（mustInclude）優先納入，餘額依「分類平均」隨機補滿
   *  （每輪取目前入選題數最少的分類，各分類輪流出題，避免某分類過多/過少） */
  function pickSet_(list, count) {
    var catOf = function (q) { return String(q.category || '').trim() || '(none)'; };
    var picked = shuffle_(list.filter(function (q) { return asBool_(q.mustInclude); })).slice(0, count);
    var counts = {};
    picked.forEach(function (q) { counts[catOf(q)] = (counts[catOf(q)] || 0) + 1; });
    // 其餘題目依分類分組（排除必考題，必考已優先處理）
    var groups = {};
    list.forEach(function (q) {
      if (asBool_(q.mustInclude)) return;
      var c = catOf(q); (groups[c] = groups[c] || []).push(q);
    });
    Object.keys(groups).forEach(function (c) { groups[c] = shuffle_(groups[c]); });
    while (picked.length < count) {
      var cats = shuffle_(Object.keys(groups).filter(function (c) { return groups[c].length; }));
      if (!cats.length) break;
      cats.sort(function (a, b) { return (counts[a] || 0) - (counts[b] || 0); }); // 題數最少的分類優先
      var c2 = cats[0];
      picked.push(groups[c2].pop());
      counts[c2] = (counts[c2] || 0) + 1;
    }
    return picked;
  }

  /** 出題：依設定之題數/配分（預設 18 MC×5 + 1 Match×10）；必考優先、各分類平均、題目與選項隨機排序 */
  function buildQuestionSet_() {
    var cfg = examCfg_();
    var bank = Repo.find('QuestionBank', function (q) { return asBool_(q.isActive); });
    var mcs = pickSet_(bank.filter(function (q) { return q.type === 'MC'; }), cfg.mcCount);
    var matches = pickSet_(bank.filter(function (q) { return q.type === 'Match'; }), cfg.matchCount);
    if (mcs.length < cfg.mcCount || matches.length < cfg.matchCount) {
      throw ApiError_('BANK_TOO_SMALL',
        'Question bank needs at least ' + cfg.mcCount + ' MC and ' + cfg.matchCount + ' matching questions',
        '題庫不足：至少需 ' + cfg.mcCount + ' 題選擇題與 ' + cfg.matchCount + ' 題配對題');
    }
    var set = [];
    shuffle_(mcs).forEach(function (q) {
      var options = shuffle_(JSON.parse(q.optionsJson)); // [{key,textZh,textEn}...] 或 ["文字"...]
      set.push({ questionId: q.id, type: 'MC', questionZh: q.questionZh, questionEn: q.questionEn,
        options: options, answer: JSON.parse(q.answerJson), points: cfg.mcPoints });
    });
    shuffle_(matches).forEach(function (q) {
      var opts = JSON.parse(q.optionsJson); // {left:[...], right:[...]}
      set.push({ questionId: q.id, type: 'Match', questionZh: q.questionZh, questionEn: q.questionEn,
        options: { left: opts.left, right: shuffle_(opts.right), diagram: opts.diagram || '' },
        answer: JSON.parse(q.answerJson), points: cfg.matchPoints });
    });
    return shuffle_(set);
  }


  /** 去除答案的前端安全版 */
  function clientSet_(set) {
    return set.map(function (q, i) {
      return { seq: i + 1, questionId: q.questionId, type: q.type,
        questionZh: q.questionZh, questionEn: q.questionEn, options: q.options, points: q.points };
    });
  }

  function myOpenAttempt_(userId, courseId, practice) {
    return Repo.findOne('ExamAttempts', function (a) {
      return a.userId === userId && a.courseId === courseId && a.startAt && !a.submitAt &&
        asBool_(a.isActive) && asBool_(a.isPractice) === !!practice;
    });
  }

  /** Step 2 進入考試（payload.practice：管理員題庫測試模式 — 不寫正式紀錄） */
  function start(user, payload) {
    var practice = !!(payload && payload.practice);
    if (practice) SecurityService.requireAdmin(user);
    var course = TrainingService.activeCourse(payload && payload.lang);
    if (!course) throw ApiError_('NO_COURSE', 'No active training course', '尚未設定訓練課程');

    if (!practice) {
      // 1) 影片須完成（≥90%）
      var prog = TrainingService.myProgress(user.id, course.id);
      if (!prog || !asBool_(prog.completed)) {
        throw ApiError_('VIDEO_NOT_COMPLETED', 'Please finish the training video first',
          '請先完成訓練影片觀看（≥' + (course.minWatchPercent || 90) + '%）');
      }
      // 2) 鎖定期（未及格隔日才能重考；台北時區；伺服器判定）
      var lock = TrainingService.examLock(user.id, course.id);
      if (lock) {
        throw ApiError_('EXAM_LOCKED', 'Failed today — next attempt available on ' + lock,
          '今日考試未通過，' + lock + ' 起可重新上課及考試');
      }
      // 3) 已有未交卷 attempt → 回同一份題組（防重新整理換題）
      var openAttempt = myOpenAttempt_(user.id, course.id, false);
      if (openAttempt) {
        var savedSet = JSON.parse(openAttempt.questionSetJson);
        return ok_({ attemptId: openAttempt.id, resumed: true, startAt: openAttempt.startAt,
          passScore: Number(getSetting_('passScore')) || 60, questions: clientSet_(savedSet) });
      }
    } else {
      // 測試模式：捨棄舊的未交卷測試場次，每次都抽新題組
      Repo.find('ExamAttempts', function (a) {
        return a.userId === user.id && asBool_(a.isPractice) && !a.submitAt && asBool_(a.isActive);
      }).forEach(function (a) { Repo.update('ExamAttempts', a.id, { isActive: false }, user.id); });
    }
    // 4) 新 attempt
    var set = buildQuestionSet_();
    var attemptNo = practice ? 0 : Repo.find('ExamAttempts', function (a) {
      return a.userId === user.id && !asBool_(a.isPractice);
    }).length + 1;
    var attempt = Repo.insert('ExamAttempts', {
      userId: user.id, courseId: course.id, attemptNo: attemptNo,
      questionSetJson: JSON.stringify(set), isPractice: practice,
      startAt: fmtDateTime_(), submitAt: '', score: '', passed: false,
      lockedUntilDate: '', sessionId: ''
    }, user.id);
    if (!practice) {
      AuditService.log({ user: user, actionType: 'EXAM_START', entityType: 'ExamAttempt',
        entityId: attempt.id, comment: 'attemptNo=' + attemptNo, success: true });
    }
    return ok_({ attemptId: attempt.id, resumed: false, startAt: attempt.startAt, practice: practice,
      passScore: Number(getSetting_('passScore')) || 60, questions: clientSet_(set) });
  }

  /** 單題計分 */
  function scoreQuestion_(q, userAnswer) {
    if (q.type === 'MC') {
      // answer 格式：{correct:"選項文字"} 或 "選項文字"
      var correct = (q.answer && q.answer.correct !== undefined) ? q.answer.correct : q.answer;
      var got = (userAnswer === correct);
      return { isCorrect: got, points: got ? q.points : 0, correct: correct };
    }
    // Match：answer = {左:右,...}；userAnswer = {左:右,...}；全對才給分（全有全無）
    var pairs = Object.keys(q.answer || {});
    if (!pairs.length) return { isCorrect: false, points: 0, correct: q.answer };
    var hit = 0;
    pairs.forEach(function (k) { if (userAnswer && userAnswer[k] === q.answer[k]) hit++; });
    var all = (hit === pairs.length);
    return { isCorrect: all, points: all ? q.points : 0, correct: q.answer };
  }

  /** Step 2 交卷（防重複送出） */
  function submit(user, payload) {
    requireFields_(payload, ['attemptId', 'answers']);
    return Repo.withLock(function () {
      var attempt = Repo.getById('ExamAttempts', payload.attemptId);
      if (!attempt || attempt.userId !== user.id) throw ApiError_('NOT_FOUND', 'Attempt not found', '找不到考試場次');
      if (attempt.submitAt) throw ApiError_('ALREADY_SUBMITTED', 'This exam was already submitted', '本場考試已交卷，不可重複送出');

      var practice = asBool_(attempt.isPractice);
      var set = JSON.parse(attempt.questionSetJson);
      var answers = payload.answers || {}; // {questionId: answer}
      var total = 0, results = [];
      set.forEach(function (q) {
        var r = scoreQuestion_(q, answers[q.questionId]);
        total += r.points;
        if (!practice) {
          Repo.insert('ExamAnswers', {
            attemptId: attempt.id, questionId: q.questionId,
            answerJson: JSON.stringify(answers[q.questionId] === undefined ? null : answers[q.questionId]),
            isCorrect: r.isCorrect, pointsAwarded: r.points
          }, user.id);
        }
        results.push({ questionId: q.questionId, isCorrect: r.isCorrect, points: r.points,
          correct: r.correct }); // correct 僅在設定開啟時回傳（見下）
      });

      var passScore = Number(getSetting_('passScore')) || 60;
      var passed = total >= passScore;
      var patch = { submitAt: fmtDateTime_(), score: total, passed: passed };
      var nextDate = null;
      if (!passed && !practice) {
        nextDate = fmtDate_(nextTaipeiMidnight_());
        patch.lockedUntilDate = nextDate;
      }
      Repo.update('ExamAttempts', attempt.id, patch, user.id);

      if (passed && !practice) {
        var course = Repo.getById('TrainingCourses', attempt.courseId);
        var months = Number((course && course.validityMonths) || 36);
        Repo.update('Users', user.id, {
          trainingPassedAt: fmtDateTime_(),
          trainingValidUntil: addMonthsTaipei_(months)
        }, user.id);
        try { NotificationService.adminCc('trainingPassed',
          'Training exam passed: ' + (user.nameEn || user.nameZh), '訓練考試通過：' + (user.nameZh || user.nameEn),
          (user.nameEn || '') + ' (' + user.email + ') passed with score ' + total + '/100.',
          (user.nameZh || '') + '（' + user.email + '）以 ' + total + '/100 分通過訓練考試。', ''); } catch (eCc) {}
      }
      if (!practice) {
        AuditService.log({ user: user, actionType: passed ? 'EXAM_PASSED' : 'EXAM_FAILED',
          entityType: 'ExamAttempt', entityId: attempt.id,
          newValue: { score: total, passed: passed }, success: true });
      }

      // 測試模式：一律回傳正確答案供管理員核對題目
      var showAnswers = practice || String(getSetting_('showAnswersAfterExam') || 'false') === 'true';
      return ok_({
        score: total, passScore: passScore, passed: passed, practice: practice,
        nextExamDate: nextDate,
        trainingValidUntil: (passed && !practice) ? addMonthsTaipei_(Number(getSetting_('trainingValidityMonths')) || 36) : null,
        results: results.map(function (r) {
          return showAnswers ? r : { questionId: r.questionId, isCorrect: r.isCorrect, points: r.points };
        })
      });
    });
  }

  function myHistory(user) {
    var rows = Repo.find('ExamAttempts', function (a) { return a.userId === user.id && !asBool_(a.isPractice); });
    rows.sort(function (a, b) { return a.startAt < b.startAt ? 1 : -1; });
    return ok_(rows.map(function (a) {
      return { attemptNo: a.attemptNo, startAt: a.startAt, submitAt: a.submitAt,
        score: a.score, passed: asBool_(a.passed), lockedUntilDate: a.lockedUntilDate };
    }));
  }

  // ---------- 題庫管理（Admin） ----------

  function qList(user) {
    SecurityService.requireAdmin(user);
    return ok_(Repo.readAll('QuestionBank').map(function (q) { delete q._rowIndex; return q; }));
  }

  function qSave(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['type', 'questionZh', 'questionEn', 'optionsJson', 'answerJson']);
    if (['MC', 'Match'].indexOf(payload.type) < 0) throw ApiError_('BAD_TYPE', 'type must be MC or Match', '題型須為 MC 或 Match');
    try { JSON.parse(payload.optionsJson); JSON.parse(payload.answerJson); }
    catch (e) { throw ApiError_('BAD_JSON', 'optionsJson / answerJson must be valid JSON', '選項或答案 JSON 格式錯誤'); }
    var data = {
      type: payload.type, questionZh: payload.questionZh, questionEn: payload.questionEn,
      optionsJson: payload.optionsJson, answerJson: payload.answerJson,
      points: Number(payload.points || 10), category: payload.category || '',
      difficulty: payload.difficulty || 'Normal',
      mustInclude: asBool_(payload.mustInclude)   // ⭐ 必考：出題時必定納入
    };
    var saved = payload.id
      ? Repo.update('QuestionBank', payload.id, data, user.id)
      : Repo.insert('QuestionBank', data, user.id);
    AuditService.log({ user: user, actionType: payload.id ? 'QUESTION_UPDATE' : 'QUESTION_CREATE',
      entityType: 'QuestionBank', entityId: saved.id, success: true });
    return ok_({ id: saved.id });
  }

  /** 直接切換「必考」旗標（題庫清單上勾選，免進編輯器） */
  function qSetMust(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['id']);
    var q = Repo.getById('QuestionBank', payload.id);
    if (!q) throw ApiError_('NOT_FOUND', 'Question not found', '找不到題目');
    Repo.update('QuestionBank', q.id, { mustInclude: asBool_(payload.mustInclude) }, user.id);
    AuditService.log({ user: user, actionType: 'QUESTION_UPDATE', entityType: 'QuestionBank',
      entityId: q.id, comment: 'mustInclude=' + asBool_(payload.mustInclude), success: true });
    return ok_({ id: q.id, mustInclude: asBool_(payload.mustInclude) });
  }

  /** 批次設定/取消「必考」（勾選多題一次處理） */
  function qSetMustMany(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['ids']);
    var ids = payload.ids;
    if (!Array.isArray(ids) || !ids.length) throw ApiError_('BAD_REQUEST', 'Select at least one question', '請至少選擇一題');
    var on = asBool_(payload.mustInclude), n = 0;
    ids.forEach(function (id) {
      var q = Repo.getById('QuestionBank', id);
      if (q) { Repo.update('QuestionBank', id, { mustInclude: on }, user.id); n++; }
    });
    AuditService.log({ user: user, actionType: 'QUESTION_UPDATE', entityType: 'QuestionBank',
      comment: 'bulk mustInclude=' + on + ' × ' + n, success: true });
    return ok_({ updated: n, mustInclude: on });
  }

  /** 批次刪除題目（實際自題庫刪除；歷史考卷因存有題目快照不受影響） */
  function qDeleteMany(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['ids']);
    var ids = payload.ids;
    if (!Array.isArray(ids) || !ids.length) throw ApiError_('BAD_REQUEST', 'Select at least one question', '請至少選擇一題');
    var n = 0;
    ids.forEach(function (id) { n += Repo.remove('QuestionBank', id); });
    AuditService.log({ user: user, actionType: 'QUESTION_DELETE', entityType: 'QuestionBank',
      comment: 'bulk delete: ' + n + ' question(s)', success: true });
    return ok_({ deleted: n });
  }

  function qDisable(user, payload) {
    SecurityService.requireAdmin(user);
    Repo.update('QuestionBank', payload.id, { isActive: false }, user.id);
    AuditService.log({ user: user, actionType: 'QUESTION_DISABLE', entityType: 'QuestionBank',
      entityId: payload.id, success: true });
    return ok_({ disabled: true });
  }

  /** 匯入：JSON 陣列 */
  function qImport(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['questions']);
    var arr = payload.questions;
    if (!Array.isArray(arr)) throw ApiError_('BAD_JSON', 'questions must be an array', 'questions 須為陣列');
    var n = 0, errors = [];
    arr.forEach(function (q, i) {
      try { qSave(user, q); n++; }
      catch (e) { errors.push('#' + (i + 1) + ': ' + (e.msgZh || e.message)); }
    });
    return ok_({ imported: n, errors: errors });
  }

  function qExport(user) {
    SecurityService.requireAdmin(user);
    var rows = Repo.readAll('QuestionBank').map(function (q) {
      return { type: q.type, questionZh: q.questionZh, questionEn: q.questionEn,
        optionsJson: q.optionsJson, answerJson: q.answerJson, points: q.points,
        category: q.category, difficulty: q.difficulty, isActive: asBool_(q.isActive) };
    });
    return ok_({ json: JSON.stringify(rows, null, 2), fileName: 'question_bank_' + fmtDate_() + '.json' });
  }

  return { start: start, submit: submit, myHistory: myHistory,
    qList: qList, qSave: qSave, qDisable: qDisable, qDeleteMany: qDeleteMany, qSetMust: qSetMust,
    qSetMustMany: qSetMustMany,
    qImport: qImport, qExport: qExport };
})();

/* ============================== PTWService.gs ============================== */
/**
 * PTWService.gs — PTW 申請（規格 §7）：草稿、儲存、清單、提交、撤回
 * - 表單勾選群（危害/現場狀況/關鍵安全系統/預防措施）存 PTW_Master.checksJson
 * - 氣體測試（重複列）草稿期存 gasTestsJson；輔助文件勾選存 docChecksJson
 * - 正式 PTW 編號於「核准」時產生（Q 決議）；草稿/送審使用 TMP 編號
 */

var PTWService = (function () {

  /** saveDraft 可寫入的主表欄位白名單 */
  var EDITABLE = ['vessel', 'executionDate', 'continuationOfPermitNo', 'areaLocation',
    'workDescription', 'toolsEquipment',
    'wtHotWork', 'wtColdWork', 'wtDiving', 'wtRadiography', 'wtConfinedSpace', 'wtExcavation', 'wtElectricalIso', 'wtProcessIso',
    'validFrom', 'validTo', 'validHours', 'scaffoldingRequired',
    'gasTestRequired', 'gasTestInterval', 'gasTestIntervalOther', 'cssIsoRequired',
    'psOthers', 'hzOthers', 'cssOthers', 'pcOthers',
    'holderUserId', 'coHolderUserId', 'paUserId', 'paDeclarationAccepted',
    'checksJson', 'gasTestsJson', 'docChecksJson',
    'companyId'];   // 僅 Tier 3–5／管理員可改（代承商建單）；Tier 1–2 於 saveDraft 內強制鎖回本公司

  var EDIT_STATUSES = [CFG.STATUS.DRAFT, CFG.STATUS.RETURNED, CFG.STATUS.RETURNED_CORRECTION];

  function mustGet_(ptwId) {
    var m = Repo.getById('PTW_Master', ptwId);
    if (!m || !asBool_(m.isActive)) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    return m;
  }

  function assertOwnerEditable_(user, m) {
    if (m.applicantUserId !== user.id) {
      throw ApiError_('FORBIDDEN', 'Only the applicant can edit this PTW', '僅申請人可編輯此 PTW');
    }
    if (EDIT_STATUSES.indexOf(m.status) < 0) {
      throw ApiError_('BAD_STATE', 'PTW is not editable in status ' + m.status, '目前狀態不可編輯：' + m.status);
    }
  }

  function requireTrainedTier1_(user) {
    if (Number(user.tier) !== 1 && !asBool_(user.isAdmin)) {
      throw ApiError_('FORBIDDEN', 'Only Tier 1 (Contractor Applicant) can create a PTW', '僅 Tier 1 承商申請者可建立 PTW');
    }
    var valid = (user.trainingValidUntil && user.trainingValidUntil >= fmtDate_()) || asBool_(user.isAdmin);
    if (!valid) {
      throw ApiError_('TRAINING_REQUIRED', 'You must pass the PTW training before creating a PTW',
        '請先完成 PTW 訓練並通過考試，才可建立 PTW');
    }
  }

  /** 勾選作業類型 → 需要的證書類型 */
  function requiredCerts(m) {
    var out = [];
    Object.keys(CFG.CERT_TYPES).forEach(function (k) {
      var t = CFG.CERT_TYPES[k];
      if (t.noCert) return; // 總部決議：Cold Work 等免證書型別不列入
      if (asBool_(m[t.workTypeFlag])) out.push(k);
    });
    return out;
  }

  /** 是否至少勾選一項作業類型（與是否需要證書無關） */
  function anyWorkType_(m) {
    return Object.keys(CFG.CERT_TYPES).some(function (k) {
      return asBool_(m[CFG.CERT_TYPES[k].workTypeFlag]);
    });
  }

  // ---------- CRUD ----------

  /** 測試人員專用編號：Example-001, 002…（不占正式序號） */
  function nextExampleNo_() {
    var max = 0;
    Repo.readAll('PTW_Master').forEach(function (p) {
      [p.ptwNumber, p.tempNumber].forEach(function (n) {
        var mm = String(n || '').match(/^Example-(\d+)$/i);
        if (mm) max = Math.max(max, Number(mm[1]));
      });
    });
    return 'Example-' + ('000' + (max + 1)).slice(-3);
  }

  function createDraft(user) {
    requireTrainedTier1_(user);
    var temp = asBool_(user.isTestUser) ? nextExampleNo_() : SequenceService.next('TMP');
    var m = Repo.insert('PTW_Master', {
      tempNumber: temp, ptwNumber: '', version: 1, status: CFG.STATUS.DRAFT,
      companyId: user.companyId, applicantUserId: user.id,
      vessel: user.vessel || '', executionDate: '', areaLocation: '',
      workDescription: '', toolsEquipment: '',
      wtHotWork: false, wtColdWork: false, wtDiving: false, wtRadiography: false,
      wtConfinedSpace: false, wtExcavation: false, wtElectricalIso: false, wtProcessIso: false,
      scaffoldingRequired: '', gasTestRequired: '', cssIsoRequired: '',
      paDeclarationAccepted: false, checksJson: '{}', gasTestsJson: '[]', docChecksJson: '{}',
      currentTier: '', currentReviewerId: ''
    }, user.id);
    AuditService.log({ user: user, actionType: 'PTW_CREATE', entityType: 'PTW', entityId: m.id,
      ptwNumber: temp, success: true });
    return ok_({ ptwId: m.id, tempNumber: temp });
  }

  function saveDraft(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    assertOwnerEditable_(user, m);
    var patch = {};
    EDITABLE.forEach(function (k) { if (payload[k] !== undefined) patch[k] = payload[k]; });
    // 申請公司：Tier 1–2 一律鎖回本公司；Tier 3–5／管理員可代承商指定（須為啟用中的公司）
    if (patch.companyId !== undefined) {
      if (String(patch.companyId).trim() === '') {
        delete patch.companyId;                    // 尚未選擇 → 保留原值，不視為錯誤
      } else if (!asBool_(user.isAdmin) && Number(user.tier) < 3) {
        delete patch.companyId;
      } else {
        var co = Repo.getById('Companies', String(patch.companyId));
        if (!co || !asBool_(co.isActive)) {
          throw ApiError_('BAD_COMPANY', 'Unknown or disabled company', '公司不存在或已停用');
        }
        // 換公司後，原本挑選的持有人若非該公司人員即自動清空，避免送審才被擋
        if (String(patch.companyId) !== String(m.companyId)) {
          var keep = function (raw) {
            return JSON.stringify(idList_(raw).filter(function (id) {
              var u2 = Repo.getById('Users', id);
              return u2 && String(u2.companyId) === String(patch.companyId);
            }));
          };
          if (patch.holderUserId === undefined) patch.holderUserId = keep(m.holderUserId);
          if (patch.coHolderUserId === undefined) patch.coHolderUserId = keep(m.coHolderUserId);
        }
      }
    }
    // 日期簡化（僅日期）：From 補 00:00:00、To 補 23:59:59
    if (patch.validFrom !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(patch.validFrom))) {
      patch.validFrom = patch.validFrom + ' 00:00:00';
    }
    if (patch.validTo !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(patch.validTo))) {
      patch.validTo = patch.validTo + ' 23:59:59';
    }
    // 計算有效時數
    if (patch.validFrom !== undefined || patch.validTo !== undefined) {
      var from = parseDateTime_(patch.validFrom !== undefined ? patch.validFrom : m.validFrom);
      var to = parseDateTime_(patch.validTo !== undefined ? patch.validTo : m.validTo);
      if (from && to && to > from) patch.validHours = Math.round((to - from) / 3600000 * 10) / 10;
    }
    var updated = Repo.update('PTW_Master', m.id, patch, user.id);
    AuditService.log({ user: user, actionType: 'PTW_UPDATE', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber || m.tempNumber, newValue: Object.keys(patch).join(','), success: true });
    return ok_({ saved: true, completion: completion_(updated) });
  }

  function get(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    SecurityService.assertCanViewPtw(user, m);
    var certs = Repo.find('PTW_Certificates', function (c) { return c.ptwId === m.id && asBool_(c.isActive); });
    var certDetails = {};
    certs.forEach(function (c) {
      var t = CFG.CERT_TYPES[c.certType];
      if (!t) return;
      var row = Repo.findOne(t.sheet, function (r) { return r.certificateId === c.id && asBool_(r.isActive); });
      certDetails[c.certType] = { certificateId: c.id, certNo: c.certNo, status: c.status,
        dataJson: row ? row.dataJson : '{}' };
    });
    var company = Repo.getById('Companies', m.companyId);
    var out = {}; for (var k in m) if (k !== '_rowIndex') out[k] = m[k];
    out.companyName = companyLabel_(company);
    out.requiredCerts = requiredCerts(m);
    out.certs = certDetails;
    out.completion = completion_(m);
    out.editable = (m.applicantUserId === user.id && EDIT_STATUSES.indexOf(m.status) >= 0);
    return ok_(out);
  }

  function list(user, payload) {
    var f = payload || {};
    var rows = Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); });
    rows = SecurityService.scopePtwList(user, rows);
    if (f.status) {
      if (f.status === '_pending') {
        var pend = [CFG.STATUS.SUBMITTED, CFG.STATUS.PENDING_T2, CFG.STATUS.PENDING_T3, CFG.STATUS.PENDING_T4, CFG.STATUS.PENDING_T5];
        rows = rows.filter(function (p) { return pend.indexOf(p.status) >= 0; });
      } else if (f.status === '_returned') {
        rows = rows.filter(function (p) { return p.status === CFG.STATUS.RETURNED || p.status === CFG.STATUS.RETURNED_CORRECTION; });
      } else if (f.status === '_active') {
        var nowA = fmtDateTime_();
        rows = rows.filter(function (p) { return ptwTimeState_(p, nowA) === 'active'; });
      } else if (f.status === '_issuedPending') {
        var nowI = fmtDateTime_();
        rows = rows.filter(function (p) { return ptwTimeState_(p, nowI) === 'notStarted'; });
      } else if (f.status === '_expiringSoon') {
        var nowS = fmtDateTime_();
        var soonS = fmtDateTime_(new Date(Date.now() + (Number(getSetting_('expiryReminderHours')) || 24) * 3600 * 1000));
        rows = rows.filter(function (p) {
          return (p.status === CFG.STATUS.ACTIVE || p.status === CFG.STATUS.EXTENDED) &&
            p.validTo && p.validTo > nowS && p.validTo <= soonS;
        });
      } else if (f.status === '_overdueOpen') {
        var now2 = fmtDateTime_();
        var closed2 = [CFG.STATUS.CLOSED, CFG.STATUS.CANCELLED, CFG.STATUS.DRAFT];
        var pend2 = [CFG.STATUS.SUBMITTED, CFG.STATUS.PENDING_T2, CFG.STATUS.PENDING_T3, CFG.STATUS.PENDING_T4, CFG.STATUS.PENDING_T5];
        rows = rows.filter(function (p) {
          return p.validTo && p.validTo < now2 && closed2.indexOf(p.status) < 0 && pend2.indexOf(p.status) < 0;
        });
      } else {
        rows = rows.filter(function (p) { return p.status === f.status; });
      }
    }
    if (f.mine) rows = rows.filter(function (p) { return p.applicantUserId === user.id; });
    if (f.companyId) rows = rows.filter(function (p) { return p.companyId === f.companyId; });
    if (f.q) {
      var q = String(f.q).toLowerCase();
      rows = rows.filter(function (p) {
        return String(p.ptwNumber + ' ' + p.tempNumber + ' ' + p.areaLocation + ' ' + p.workDescription)
          .toLowerCase().indexOf(q) >= 0;
      });
    }
    var companies = {};
    Repo.readAll('Companies').forEach(function (c) { companies[c.id] = companyLabel_(c); });
    rows.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
    var page = Math.max(1, f.page || 1);
    var size = f.forExport ? Math.min(2000, rows.length || 1) : Math.min(50, f.pageSize || 20);
    return ok_({
      total: rows.length, page: page,
      rows: rows.slice((page - 1) * size, page * size).map(function (p) {
        return { id: p.id, number: p.ptwNumber || p.tempNumber, status: p.status,
          company: companies[p.companyId] || '', areaLocation: p.areaLocation,
          workDescription: String(p.workDescription || '').substring(0, 80),
          validFrom: p.validFrom, validTo: p.validTo, currentTier: p.currentTier,
          version: p.version, updatedAt: p.updatedAt,
          isMine: p.applicantUserId === user.id,
          // 完工申報／關單：同承商公司人員皆可（未到期亦可提前關單），Tier 5／管理員亦可
          canClose: asBool_(user.isAdmin) || Number(user.tier) === 5 ||
            (!!p.companyId && String(p.companyId) === String(user.companyId)) };
      })
    });
  }

  // ---------- 提交 ----------

  var REQUIRED_MASTER = ['vessel', 'executionDate', 'areaLocation', 'workDescription', 'toolsEquipment',
    'validFrom', 'validTo', 'scaffoldingRequired', 'gasTestRequired', 'cssIsoRequired',
    'holderUserId'];

  /** 多值人員欄位（JSON 陣列；相容舊單一 id） */
  function idList_(v) {
    var raw = String(v || '');
    if (!raw) return [];
    if (raw.charAt(0) === '[') { try { return JSON.parse(raw) || []; } catch (e) { return []; } }
    return [raw];
  }

  /** 完成百分比（草稿指引用） */
  function completion_(m) {
    var total = REQUIRED_MASTER.length + 3; // + 工作類型 + 危害 + 聲明
    var done = REQUIRED_MASTER.filter(function (k) { return String(m[k] || '').trim() !== ''; }).length;
    if (anyWorkType_(m)) done++;
    var checks = {}; try { checks = JSON.parse(m.checksJson || '{}'); } catch (e) {}
    if (Object.keys(checks).some(function (k) { return k.indexOf('hz') === 0 && checks[k]; })) done++;
    if (asBool_(m.paDeclarationAccepted)) done++;
    return Math.round(done * 100 / total);
  }

  function validateForSubmit_(user, m) {
    var errors = [];
    REQUIRED_MASTER.forEach(function (k) {
      if (String(m[k] || '').trim() === '') errors.push(k);
    });
    // (4) 主持有人可多位；且不得為工安人員
    var holders = idList_(m.holderUserId);
    if (!holders.length) {
      if (errors.indexOf('holderUserId') < 0) errors.push('holderUserId（至少一位主持有人）');
    }
    var badHse = holders.concat(idList_(m.coHolderUserId)).filter(function (id) {
      var u2 = Repo.getById('Users', id);
      return u2 && asBool_(u2.isHse);
    });
    if (badHse.length) errors.push('holders（HSE 人員不得擔任持有人 HSE cannot be a permit holder）');
    // 持有人限本公司：承商 A 的 PTW 持有人／副持有人必須是承商 A 的人員（後端強制，防竄改）
    var badCompany = holders.concat(idList_(m.coHolderUserId)).filter(function (id) {
      var u2 = Repo.getById('Users', id);
      return !u2 || u2.companyId !== m.companyId;
    });
    if (badCompany.length) errors.push('holders（持有人須為申請公司之人員 Holders/Co-holders must belong to the applicant’s company）');
    var certsNeeded = requiredCerts(m);
    if (!anyWorkType_(m)) errors.push('workTypes（至少勾選一項作業類型 at least one work type）');
    var checks = {}; try { checks = JSON.parse(m.checksJson || '{}'); } catch (e) {}
    if (!Object.keys(checks).some(function (k) { return k.indexOf('hz') === 0 && checks[k]; })) {
      errors.push('hazards（至少勾選一項危害 at least one hazard）');
    }
    if (!Object.keys(checks).some(function (k) { return k.indexOf('pc') === 0 && checks[k]; })) {
      errors.push('precautions（至少勾選一項預防措施 at least one precaution）');
    }
    if (!asBool_(m.paDeclarationAccepted)) errors.push('paDeclarationAccepted（申請人聲明）');
    // (5) Method Statement 與 Risk Assessment 為必要附件
    var atts = Repo.find('PTW_Attachments', function (a) { return a.ptwId === m.id && asBool_(a.isActive); });
    var hasMs = atts.some(function (a) { return String(a.category) === 'MethodStatement'; });
    var hasRa = atts.some(function (a) { return String(a.category) === 'RiskAssessment'; });
    if (!hasMs) errors.push('attachment:MethodStatement（必須上傳 Method Statement）');
    if (!hasRa) errors.push('attachment:RiskAssessment（必須上傳 JSA/Risk Assessment）');
    // 依作業類型：提交前必附資格文件
    [['wtDiving','DivingDocs','潛水文件（潛水員證書/潛水計畫）Diving docs'],
     ['wtRadiography','RadiographyDocs','輻射文件（執照/射源證明）Radiography docs'],
     ['wtExcavation','ExcavationDocs','開挖文件（圖面/管線調查）Excavation docs'],
     ['wtElectricalIso','LotoDocs','電氣隔離文件（LOTO 紀錄）LOTO docs']].forEach(function (r) {
      if (asBool_(m[r[0]]) && !atts.some(function (a) { return String(a.category) === r[1]; })) {
        errors.push('attachment:' + r[1] + '（必須上傳 ' + r[2] + '）');
      }
    });
    var from = parseDateTime_(m.validFrom), to = parseDateTime_(m.validTo);
    if (from && to && to <= from) errors.push('validTo 須晚於 validFrom');

    // 附加證書聯動：勾選作業類型必須完成對應證書
    var missingCerts = [];
    certsNeeded.forEach(function (k) {
      var cert = Repo.findOne('PTW_Certificates', function (c) {
        return c.ptwId === m.id && c.certType === k && asBool_(c.isActive);
      });
      if (!cert || cert.status !== 'Complete') {
        missingCerts.push(CFG.CERT_TYPES[k].nameZh + ' ' + CFG.CERT_TYPES[k].nameEn);
      }
    });
    return { errors: errors, missingCerts: missingCerts };
  }

  function submit(user, payload) {
    requireFields_(payload, ['ptwId']);
    return Repo.withLock(function () {
      var m = mustGet_(payload.ptwId);
      assertOwnerEditable_(user, m); // 含申請人與可編輯狀態檢查
      requireTrainedTier1_(user);

      var v = validateForSubmit_(user, m);
      if (v.errors.length || v.missingCerts.length) {
        return err_('VALIDATION_FAILED',
          (v.errors.length ? 'Missing/invalid: ' + v.errors.join(', ') + '. ' : '') +
          (v.missingCerts.length ? 'Incomplete certificates: ' + v.missingCerts.join('; ') : ''),
          (v.errors.length ? '欄位缺漏：' + v.errors.join('、') + '。' : '') +
          (v.missingCerts.length ? '未完成附加證書：' + v.missingCerts.join('；') : ''));
      }
      // 防重複提交
      if (m.status !== CFG.STATUS.DRAFT && m.status !== CFG.STATUS.RETURNED && m.status !== CFG.STATUS.RETURNED_CORRECTION) {
        throw ApiError_('BAD_STATE', 'Already submitted', '已提交，請勿重複送出');
      }

      var isResubmit = (m.status === CFG.STATUS.RETURNED || m.status === CFG.STATUS.RETURNED_CORRECTION);
      var newVersion = isResubmit ? Number(m.version) + 1 : Number(m.version || 1);

      // 版本快照
      var snapshot = {}; for (var k in m) if (k !== '_rowIndex') snapshot[k] = m[k];
      Repo.insert('PTW_Versions', {
        ptwId: m.id, version: newVersion, snapshotJson: JSON.stringify(snapshot),
        diffJson: '', submittedAt: fmtDateTime_(), submittedBy: user.id
      }, user.id);

      // (通知) 指定審閱人（選填）：驗證屬於本公司 Tier 2
      var designated = null;
      if (payload.reviewerId) {
        designated = Repo.getById('Users', payload.reviewerId);
        if (!designated || Number(designated.tier) !== 2 || designated.companyId !== m.companyId ||
            designated.status !== 'Active' || !asBool_(designated.isActive)) {
          throw ApiError_('BAD_REVIEWER', 'Selected reviewer is not a valid Tier 2 of your company', '指定的審閱人非本公司有效 Tier 2 人員');
        }
      }
      var newStatus = CFG.STATUS.PENDING_T2; // 重新送審預設從 Tier 2（SystemSettings resubmitStartTier）
      Repo.update('PTW_Master', m.id, {
        status: newStatus, version: newVersion, currentTier: 2,
        currentReviewerId: designated ? designated.id : '',
        submittedAt: fmtDateTime_()
      }, user.id);
      Repo.insert('PTW_StatusHistory', {
        ptwId: m.id, fromStatus: m.status, toStatus: newStatus, byUserId: user.id,
        reason: isResubmit ? 'Resubmitted v' + newVersion : 'Submitted', timestamp: fmtDateTime_()
      }, user.id);
      AuditService.log({ user: user, actionType: isResubmit ? 'PTW_RESUBMIT' : 'PTW_SUBMIT',
        entityType: 'PTW', entityId: m.id, ptwNumber: m.tempNumber, newValue: { version: newVersion }, success: true });

      // 通知：指定審閱人 → 只寄該員；未指定 → 本公司全部 Tier 2（任一人審閱即可）
      try {
        var targets = designated ? [designated] : Repo.find('Users', function (u2) {
          return Number(u2.tier) === 2 && u2.companyId === m.companyId && u2.status === 'Active' && asBool_(u2.isActive);
        });
        targets.forEach(function (r) {
          NotificationService.push(r.id, 'PTW_PENDING_REVIEW', m.id,
            (designated ? '👤 PTW assigned to YOU for review: ' : 'PTW pending your review: ') + m.tempNumber,
            (designated ? '👤 指定由您審閱的 PTW：' : '待您審核的 PTW：') + m.tempNumber,
            'Work: ' + String(m.workDescription).substring(0, 100), '工作內容：' + String(m.workDescription).substring(0, 100),
            r.email);
        });
      } catch (e) { console.error(e.message); }

      try { NotificationService.adminCc('ptwSubmitted', 'PTW submitted for review: ' + m.tempNumber, 'PTW 提交送審：' + m.tempNumber, NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), m.id); } catch (eCc) {}
      return ok_({ submitted: true, status: newStatus, version: newVersion, number: m.tempNumber });
    });
  }

  function withdraw(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    if (m.applicantUserId !== user.id) throw ApiError_('FORBIDDEN', 'Not your PTW', '非您的 PTW');
    var allowed = [CFG.STATUS.DRAFT, CFG.STATUS.SUBMITTED, CFG.STATUS.PENDING_T2];
    if (allowed.indexOf(m.status) < 0) {
      throw ApiError_('BAD_STATE', 'Cannot withdraw in status ' + m.status, '目前狀態不可撤回：' + m.status);
    }
    Repo.update('PTW_Master', m.id, { status: CFG.STATUS.CANCELLED }, user.id);
    Repo.insert('PTW_StatusHistory', { ptwId: m.id, fromStatus: m.status, toStatus: CFG.STATUS.CANCELLED,
      byUserId: user.id, reason: 'Withdrawn by applicant', timestamp: fmtDateTime_() }, user.id);
    AuditService.log({ user: user, actionType: 'PTW_WITHDRAW', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber || m.tempNumber, success: true });
    return ok_({ cancelled: true });
  }

  /** 刪除 PTW（Admin / Tier 5 專用；軟刪除保留稽核紀錄） */
  function deletePtw(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    var reason = String(payload.reason || '').trim();
    var byName = (user.nameZh || user.nameEn || user.email) + '（' + (asBool_(user.isAdmin) ? 'Admin' : 'Tier 5') + '）';
    Repo.update('PTW_Master', m.id, { isActive: false, status: CFG.STATUS.CANCELLED }, user.id);
    Repo.insert('PTW_StatusHistory', { ptwId: m.id, fromStatus: m.status, toStatus: CFG.STATUS.CANCELLED,
      byUserId: user.id,
      reason: 'Deleted by ' + (asBool_(user.isAdmin) ? 'Admin' : 'Tier 5') + (reason ? ' — ' + reason : ''),
      timestamp: fmtDateTime_() }, user.id);
    AuditService.log({ user: user, actionType: 'PTW_DELETE', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber || m.tempNumber, success: true, details: reason });
    try { notifyDeleted_(user, m, byName, reason); } catch (eN) { console.error('deletePtw notify: ' + eN.message); }
    return ok_({ deleted: true });
  }

  /** 刪除通知：申請人／持有人／共同持有人／目前審核人／曾核准者 ＋ 管理員副本 */
  function notifyDeleted_(user, m, byName, reason) {
    var num = m.ptwNumber || m.tempNumber;
    // 快照：狀態欄顯示「已刪除（原：xxx）」，按鈕退回「開啟系統」（PTW 已不存在）
    var snap = {
      id: '', ptwNumber: num, companyId: m.companyId, holderUserId: m.holderUserId,
      validFrom: m.validFrom, validTo: m.validTo, vessel: m.vessel,
      areaLocation: m.areaLocation, workDescription: m.workDescription,
      _statusText: '🗑 已刪除 Deleted（原狀態 was: ' + String(m.status || '—') + '）'
    };
    var titleEn = 'PTW deleted: ' + num;
    var titleZh = 'PTW 已刪除：' + num;
    var msgEn = 'This PTW was deleted by ' + byName + ' on ' + fmtDateTime_() +
      ' and no longer appears in any list. ' +
      (reason ? 'Reason: ' + reason + '. ' : '') +
      'If the work is still required, please submit a new PTW application.';
    var msgZh = '此 PTW 已由 ' + byName + ' 於 ' + fmtDateTime_() + ' 刪除，將不再出現於任何清單。' +
      (reason ? '刪除原因：' + reason + '。' : '') +
      '若作業仍需執行，請重新提出 PTW 申請。（稽核紀錄仍完整保留）';

    var ids = {};
    [m.applicantUserId, m.currentReviewerId].forEach(function (id) { if (id) ids[id] = true; });
    [m.holderUserId, m.coHolderUserId].forEach(function (raw) {
      var s = String(raw || '');
      if (s.charAt(0) === '[') { try { JSON.parse(s).forEach(function (id) { if (id) ids[id] = true; }); } catch (e) {} }
      else if (s) ids[s] = true;
    });
    Repo.find('PTW_Approvals', function (a) { return a.ptwId === m.id && a.action === 'Approve'; })
      .forEach(function (a) { if (a.reviewerUserId) ids[a.reviewerUserId] = true; });
    delete ids[user.id];   // 操作者本人不用再收一封
    Object.keys(ids).forEach(function (uid) {
      var u2 = Repo.getById('Users', uid);
      if (!u2) return;
      NotificationService.push(u2.id, 'PTW_DELETED', snap, titleEn, titleZh, msgEn, msgZh,
        (u2.email && /@/.test(u2.email)) ? u2.email : '');
    });
    NotificationService.adminCc('ptwDeleted', titleEn, titleZh, msgEn, msgZh, snap);
  }

  /** (通知) 下一關審閱人候選清單：草稿/退回 → Tier 2（本公司）；審核中 → currentTier+1 */
  function nextReviewers(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    SecurityService.assertCanViewPtw(user, m);
    var target = (EDIT_STATUSES.indexOf(m.status) >= 0) ? 2 : Number(m.currentTier) + 1;
    if (!(target >= 2 && target <= 5)) return ok_({ tier: null, users: [] });
    var rows = Repo.find('Users', function (u2) {
      if (Number(u2.tier) !== target || u2.status !== 'Active' || !asBool_(u2.isActive)) return false;
      if (target === 2) return u2.companyId === m.companyId;
      return true;
    });
    return ok_({ tier: target, users: rows.map(function (u2) {
      return { id: u2.id, nameZh: u2.nameZh, nameEn: u2.nameEn };
    }) });
  }

  /** 人員選擇器：主持有人/副持有人 — 承商 Tier 1（可兼申請人/持有人）、訓練有效者（T1/T2 限本公司；T3+ 可見全部） */
  /** 持有人候選清單 — 一律只列「該 PTW 申請公司」的人員。
   *  payload.ptwId（優先）或 payload.companyId 指定公司；Tier 1–2 一律鎖回本公司。 */
  function pickerUsers(user, payload) {
    payload = payload || {};
    var scopeCompany = user.companyId;
    if (asBool_(user.isAdmin) || Number(user.tier) >= 3) {
      // 明確指定的 companyId 優先（切換公司當下草稿可能尚未寫入）
      if (payload.companyId) {
        scopeCompany = String(payload.companyId);
      } else if (payload.ptwId) {
        var m = Repo.getById('PTW_Master', String(payload.ptwId));
        if (m && m.companyId) scopeCompany = m.companyId;
      }
    }
    var today = fmtDate_();
    var rows = Repo.find('Users', function (u2) {
      if (u2.status !== 'Active' || !asBool_(u2.isActive)) return false;
      if (Number(u2.tier) !== 1) return false;                      // 只列承商 Tier 1（Holder / Applicant）
      if (asBool_(u2.isHse)) return false;                          // HSE 人員不可擔任持有人
      if (String(u2.companyId) !== String(scopeCompany)) return false;  // 僅該申請公司之人員
      return !!(u2.trainingValidUntil && u2.trainingValidUntil >= today); // 訓練通過才可擔任持有人
    });
    return ok_(rows.map(function (u2) {
      return { id: u2.id, nameZh: u2.nameZh, nameEn: u2.nameEn, title: u2.title,
        tier: Number(u2.tier || 0), companyId: u2.companyId };
    }));
  }

  return { createDraft: createDraft, saveDraft: saveDraft, get: get, list: list,
    submit: submit, withdraw: withdraw, deletePtw: deletePtw, pickerUsers: pickerUsers, nextReviewers: nextReviewers,
    requiredCerts: requiredCerts, validateForSubmit: validateForSubmit_ };
})();

/* ============================== CertificateService.gs ============================== */
/**
 * CertificateService.gs — 七種附加證書（規格 §7 Step 3）
 * 表單欄位存於各 Cert_* 實體表的 dataJson（欄位 ID 依 Phase 1 Mapping Table）。
 * 證書編號於首次建立時依 Q4 編碼取號（HW-0001…）。
 */

var CertificateService = (function () {

  function mustGetPtw_(ptwId) {
    var m = Repo.getById('PTW_Master', ptwId);
    if (!m || !asBool_(m.isActive)) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    return m;
  }

  /** 儲存證書（申請人於可編輯狀態） */
  function save(user, payload) {
    requireFields_(payload, ['ptwId', 'certType']);
    var type = CFG.CERT_TYPES[payload.certType];
    if (!type) throw ApiError_('BAD_TYPE', 'Unknown certificate type', '未知的證書類型');
    var m = mustGetPtw_(payload.ptwId);
    if (m.applicantUserId !== user.id) {
      throw ApiError_('FORBIDDEN', 'Only the applicant can edit certificates', '僅申請人可編輯證書');
    }
    var editable = [CFG.STATUS.DRAFT, CFG.STATUS.RETURNED, CFG.STATUS.RETURNED_CORRECTION];
    if (editable.indexOf(m.status) < 0) {
      throw ApiError_('BAD_STATE', 'PTW is not editable', '目前狀態不可編輯證書');
    }
    if (type.noCert) {
      throw ApiError_('BAD_STATE', 'This work type does not require a certificate',
        '此作業類型免附證書（總部決議：Cold Work 免證書）');
    }
    if (!asBool_(m[type.workTypeFlag])) {
      throw ApiError_('BAD_STATE', 'This work type is not selected on the main permit',
        '主表未勾選此作業類型，無需此證書');
    }
    var dataJson = payload.dataJson || '{}';
    try { JSON.parse(dataJson); } catch (e) { throw ApiError_('BAD_JSON', 'dataJson invalid', '證書資料格式錯誤'); }

    return Repo.withLock(function () {
      var cert = Repo.findOne('PTW_Certificates', function (c) {
        return c.ptwId === m.id && c.certType === payload.certType && asBool_(c.isActive);
      });
      var certNo;
      if (!cert) {
        certNo = SequenceService.next(payload.certType);
        cert = Repo.insert('PTW_Certificates', {
          ptwId: m.id, certType: payload.certType, certNo: certNo, status: 'Draft'
        }, user.id);
        Repo.insert(type.sheet, {
          certificateId: cert.id, ptwId: m.id, certNo: certNo, dataJson: dataJson
        }, user.id);
      } else {
        certNo = cert.certNo;
        var row = Repo.findOne(type.sheet, function (r) { return r.certificateId === cert.id && asBool_(r.isActive); });
        if (row) Repo.update(type.sheet, row.id, { dataJson: dataJson }, user.id);
        else Repo.insert(type.sheet, { certificateId: cert.id, ptwId: m.id, certNo: certNo, dataJson: dataJson }, user.id);
      }
      var newStatus = asBool_(payload.markComplete) ? 'Complete' : 'Draft';
      Repo.update('PTW_Certificates', cert.id, { status: newStatus }, user.id);
      AuditService.log({ user: user, actionType: 'CERT_SAVE', entityType: 'Certificate', entityId: cert.id,
        ptwNumber: m.ptwNumber || m.tempNumber,
        newValue: { certType: payload.certType, certNo: certNo, status: newStatus }, success: true });
      return ok_({ certificateId: cert.id, certNo: certNo, status: newStatus });
    });
  }

  /** 取消勾選作業類型時，將對應證書作廢（保留紀錄） */
  function deactivate(user, payload) {
    requireFields_(payload, ['ptwId', 'certType']);
    var m = mustGetPtw_(payload.ptwId);
    if (m.applicantUserId !== user.id) throw ApiError_('FORBIDDEN', 'Not your PTW', '非您的 PTW');
    var cert = Repo.findOne('PTW_Certificates', function (c) {
      return c.ptwId === m.id && c.certType === payload.certType && asBool_(c.isActive);
    });
    if (cert) {
      Repo.update('PTW_Certificates', cert.id, { status: 'Cancelled', isActive: false }, user.id);
      AuditService.log({ user: user, actionType: 'CERT_CANCEL', entityType: 'Certificate', entityId: cert.id,
        ptwNumber: m.ptwNumber || m.tempNumber, success: true });
    }
    return ok_({ cancelled: !!cert });
  }

  return { save: save, deactivate: deactivate };
})();

/* ============================== DriveService.gs ============================== */
/**
 * DriveService.gs — 附件與簽名檔（規格 §7 Step 4/5）
 * 資料夾：root/{年度}/{公司}/{PTW編號}/{分類}；簽名存 _system/signatures/{編號}/
 * Sheets 僅存 metadata。
 */

var DriveService = (function () {

  // 每個 PTW 五個子資料夾（2026-08 決議）
  var FOLDER_NAMES = ['01_Application', '02_Certificates', '03_Support_Documents',
    '04_Approval_Records', '05_Close_out_evidence'];
  var CATEGORIES = { Application: '01_Application', Certificates: '02_Certificates',
    MethodStatement: '03_Support_Documents', RiskAssessment: '03_Support_Documents',
    Supporting: '03_Support_Documents', Approval: '04_Approval_Records',
    CloseOut: '05_Close_out_evidence', Closeout: '05_Close_out_evidence',
    DivingDocs: '03_Support_Documents', RadiographyDocs: '03_Support_Documents',
    ExcavationDocs: '03_Support_Documents', LotoDocs: '03_Support_Documents',
    GasMonitorLog: '05_Close_out_evidence', EntryLog: '05_Close_out_evidence',
    DailyValidation: '05_Close_out_evidence', TbmHip: '05_Close_out_evidence', SelfInspection: '05_Close_out_evidence',
    // 依作業類型觸發的關單文件（規則見 CloseoutRules.gs）
    DiveLog: '05_Close_out_evidence', RadiationDose: '05_Close_out_evidence', SourceLog: '05_Close_out_evidence',
    ExcavationCheck: '05_Close_out_evidence', BackfillConfirm: '05_Close_out_evidence',
    LotoLog: '05_Close_out_evidence', IsolationRegister: '05_Close_out_evidence',
    ScaffoldCheck: '05_Close_out_evidence' };

  var ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'dwg', 'zip', 'csv', 'txt'];

  function root_() { return DriveApp.getFolderById(getProp_('DRIVE_ROOT_FOLDER_ID')); }

  function sub_(parent, name) {
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }

  /** 取得（必要時建立）PTW 專屬資料夾 */
  function ptwFolder_(m) {
    if (m.driveFolderId) {
      try { return DriveApp.getFolderById(m.driveFolderId); } catch (e) { /* rebuild */ }
    }
    // 直接於 root 下以 PTW 編號建資料夾（依 2026-08 決議，不再分年度/公司層）
    var folder = sub_(root_(), m.ptwNumber || m.tempNumber);
    FOLDER_NAMES.forEach(function (n) { sub_(folder, n); });
    // QR 掃描免登入檢視：資料夾設為「知道連結的人可檢視」
    try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e) { console.error('folder sharing failed: ' + e.message); }
    Repo.update('PTW_Master', m.id, { driveFolderId: folder.getId() }, 'system');
    return folder;
  }

  /** 上傳附件（base64） */
  function uploadAttachment(user, payload) {
    requireFields_(payload, ['ptwId', 'fileName', 'mimeType', 'base64', 'category']);
    var m = Repo.getById('PTW_Master', payload.ptwId);
    if (!m || !asBool_(m.isActive)) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    SecurityService.assertCanViewPtw(user, m);
    var cat = CATEGORIES[payload.category] ? payload.category : 'Supporting';

    var ext = String(payload.fileName).split('.').pop().toLowerCase();
    if (ALLOWED_EXT.indexOf(ext) < 0) {
      throw ApiError_('BAD_FILE_TYPE', 'File type not allowed: .' + ext, '不允許的檔案類型：.' + ext);
    }
    var bytes;
    try { bytes = Utilities.base64Decode(payload.base64); }
    catch (e) { throw ApiError_('BAD_FILE', 'Invalid file data', '檔案資料無效'); }
    var maxMb = Number(getSetting_('maxUploadMb')) || 25;
    if (bytes.length > maxMb * 1024 * 1024) {
      throw ApiError_('FILE_TOO_LARGE', 'Max ' + maxMb + ' MB', '檔案超過上限 ' + maxMb + ' MB');
    }
    var folder = sub_(ptwFolder_(m), CATEGORIES[cat]);
    var file = folder.createFile(Utilities.newBlob(bytes, payload.mimeType, payload.fileName));
    var row = Repo.insert('PTW_Attachments', {
      ptwId: m.id, certificateId: payload.certificateId || '',
      fileName: payload.fileName, driveFileId: file.getId(), fileUrl: file.getUrl(),
      fileType: ext, fileSizeBytes: bytes.length, category: cat,
      uploadedBy: user.id, uploadedAt: fmtDateTime_()
    }, user.id);
    AuditService.log({ user: user, actionType: 'ATTACHMENT_UPLOAD', entityType: 'Attachment', entityId: row.id,
      ptwNumber: m.ptwNumber || m.tempNumber, newValue: { fileName: payload.fileName, category: cat }, success: true });
    return ok_({ attachmentId: row.id, fileUrl: file.getUrl() });
  }

  function listAttachments(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = Repo.getById('PTW_Master', payload.ptwId);
    if (!m) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    SecurityService.assertCanViewPtw(user, m);
    var rows = Repo.find('PTW_Attachments', function (a) { return a.ptwId === m.id && asBool_(a.isActive); });
    return ok_(rows.map(function (a) {
      return { id: a.id, fileName: a.fileName, fileUrl: a.fileUrl, fileType: a.fileType,
        sizeKb: Math.round(Number(a.fileSizeBytes || 0) / 1024), category: a.category,
        uploadedBy: a.uploadedBy, uploadedAt: a.uploadedAt };
    }));
  }

  function disableAttachment(user, payload) {
    requireFields_(payload, ['attachmentId']);
    var a = Repo.getById('PTW_Attachments', payload.attachmentId);
    if (!a) throw ApiError_('NOT_FOUND', 'Attachment not found', '找不到附件');
    var m = Repo.getById('PTW_Master', a.ptwId);
    if (a.uploadedBy !== user.id && Number(user.tier) !== 5 && !asBool_(user.isAdmin)) {
      throw ApiError_('FORBIDDEN', 'Only uploader or Tier 5 can remove', '僅上傳者或 Tier 5 可移除');
    }
    Repo.update('PTW_Attachments', a.id, { isActive: false }, user.id);
    AuditService.log({ user: user, actionType: 'ATTACHMENT_DISABLE', entityType: 'Attachment', entityId: a.id,
      ptwNumber: m ? (m.ptwNumber || m.tempNumber) : '', success: true });
    return ok_({ disabled: true });
  }

  /** 儲存電子簽名 PNG → Drive；回傳 PTW_Signatures.id */
  function saveSignature(user, m, roleCode, signatureDataUrl) {
    var fileId = '', hash = '';
    if (signatureDataUrl && String(signatureDataUrl).indexOf('data:image') === 0) {
      try {
        var b64 = String(signatureDataUrl).split(',')[1];
        var bytes = Utilities.base64Decode(b64);
        hash = sha256_(b64);
        var sig = sub_(sub_(sub_(root_(), '_system'), 'signatures'), m.ptwNumber || m.tempNumber);
        var f = sig.createFile(Utilities.newBlob(bytes, 'image/png',
          roleCode + '_' + user.id.substring(0, 8) + '_' + Date.now() + '.png'));
        fileId = f.getId();
      } catch (e) { console.error('signature save failed: ' + e.message); }
    }
    var row = Repo.insert('PTW_Signatures', {
      ptwId: m.id, certificateId: '', roleCode: roleCode, userId: user.id,
      signatureFileId: fileId, signatureHash: hash, signedAt: fmtDateTime_(),
      isVoided: false, voidedReason: '', voidedAt: ''
    }, user.id);
    return row.id;
  }

  /** 儲存帳號簽名檔（申請/更新）；回傳 fileId */
  function saveAccountSignature(base64Png, ownerLabel) {
    var bytes = Utilities.base64Decode(base64Png);
    if (bytes.length > 2 * 1024 * 1024) {
      throw ApiError_('FILE_TOO_LARGE', 'Signature image too large (max 2MB)', '簽名檔過大（上限 2MB）');
    }
    var folder = sub_(sub_(sub_(root_(), '_system'), 'signatures'), 'accounts');
    var f = folder.createFile(Utilities.newBlob(bytes, 'image/png',
      'sig_' + String(ownerLabel).replace(/[^\w.-]/g, '_') + '_' + Date.now() + '.png'));
    return f.getId();
  }

  /** 讀帳號簽名檔為 base64（無檔回空字串） */
  function getSignatureBase64(fileId) {
    if (!fileId) return '';
    try { return Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes()); }
    catch (e) { return ''; }
  }

  /** (6) 下載專區：上傳公開文件（Admin） */
  function uploadPublicDoc(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['titleZh', 'titleEn', 'fileName', 'mimeType', 'base64']);
    var bytes = Utilities.base64Decode(payload.base64);
    var maxMb = Number(getSetting_('maxUploadMb')) || 25;
    if (bytes.length > maxMb * 1024 * 1024) throw ApiError_('FILE_TOO_LARGE', 'Max ' + maxMb + 'MB', '檔案過大');
    var folder = sub_(sub_(root_(), '_system'), 'downloads');
    var f = folder.createFile(Utilities.newBlob(bytes, payload.mimeType, payload.fileName));
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e) { console.error('setSharing failed: ' + e.message); }
    var row = Repo.insert('Downloads', {
      title: payload.titleEn + ' / ' + payload.titleZh,
      titleZh: payload.titleZh, titleEn: payload.titleEn,
      description: payload.description || '', category: payload.category || '',
      fileName: payload.fileName, driveFileId: f.getId(), fileUrl: f.getUrl(),
      uploadedBy: user.id, uploadedAt: fmtDateTime_()
    }, user.id);
    AuditService.log({ user: user, actionType: 'DOWNLOAD_UPLOAD', entityType: 'Download', entityId: row.id,
      newValue: { title: payload.titleEn }, success: true });
    return ok_({ id: row.id, fileUrl: f.getUrl() });
  }

  /** 下載清單（公開） */
  function listDownloads() {
    var rows = Repo.find('Downloads', function (d) { return asBool_(d.isActive); });
    rows.sort(function (a, b) { return a.uploadedAt < b.uploadedAt ? 1 : -1; });
    return ok_(rows.map(function (d) {
      return { id: d.id, title: d.title,
        titleZh: d.titleZh || d.title, titleEn: d.titleEn || d.title,
        description: d.description, category: d.category,
        fileName: d.fileName, fileUrl: d.fileUrl, uploadedAt: d.uploadedAt };
    }));
  }

  function disableDownload(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['id']);
    Repo.update('Downloads', payload.id, { isActive: false }, user.id);
    AuditService.log({ user: user, actionType: 'DOWNLOAD_DISABLE', entityType: 'Download', entityId: payload.id, success: true });
    return ok_({ disabled: true });
  }

  /** (公告) 新增系統公告 */
  function announceAdd(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['textZh', 'textEn']);
    var row = Repo.insert('Announcements', {
      textZh: payload.textZh, textEn: payload.textEn,
      level: payload.level || 'info'
    }, user.id);
    AuditService.log({ user: user, actionType: 'ANNOUNCE_ADD', entityType: 'Announcement', entityId: row.id, success: true });
    return ok_({ id: row.id });
  }
  /** (公告) 公開清單（最新在前，取 5 則） */
  function announceList() {
    var rows = Repo.find('Announcements', function (a) { return asBool_(a.isActive); });
    rows.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    return ok_(rows.slice(0, 5).map(function (a) {
      return { id: a.id, textZh: a.textZh, textEn: a.textEn, level: a.level || 'info', createdAt: a.createdAt };
    }));
  }
  function announceDisable(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['id']);
    Repo.update('Announcements', payload.id, { isActive: false }, user.id);
    AuditService.log({ user: user, actionType: 'ANNOUNCE_DISABLE', entityType: 'Announcement', entityId: payload.id, success: true });
    return ok_({ disabled: true });
  }

  /** PTW 資料夾網址（QR 用；必要時建立並設為公開） */
  function ptwFolderUrl(m) {
    try { return ptwFolder_(m).getUrl(); } catch (e) { return ''; }
  }

  /** 將檔案存入 PTW 指定子資料夾 */
  function savePtwFile(mRow, folderName, blob) {
    var folder = ptwFolder_(mRow);
    return sub_(folder, folderName).createFile(blob);
  }

  /** 前端瀏覽器引擎產生之現場聯 PDF → 存入 01_Application */
  function saveSitePdf(user, payload) {
    requireFields_(payload, ['ptwId', 'base64', 'fileName']);
    var mRow = Repo.getById('PTW_Master', payload.ptwId);
    if (!mRow || !asBool_(mRow.isActive)) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    SecurityService.assertCanViewPtw(user, mRow);
    var bytes;
    try { bytes = Utilities.base64Decode(payload.base64); }
    catch (e) { throw ApiError_('BAD_FILE', 'Invalid file data', '檔案資料無效'); }
    var blob = Utilities.newBlob(bytes, 'application/pdf', String(payload.fileName).replace(/[^\w.\-一-龥]/g, '_'));
    var folder = sub_(ptwFolder_(mRow), '01_Application');
    // 取代舊檔：同編號之舊 Site Copy 移至垃圾桶，資料夾內永遠只留最新版
    try {
      var prefix = (mRow.ptwNumber || mRow.tempNumber) + '_SiteCopy';
      var it = folder.getFiles();
      while (it.hasNext()) {
        var f0 = it.next();
        if (String(f0.getName()).indexOf(prefix) === 0) f0.setTrashed(true);
      }
    } catch (e) { console.error('old site copy cleanup failed: ' + e.message); }
    var f = folder.createFile(blob);
    AuditService.log({ user: user, actionType: 'PTW_SITECOPY_SAVED', entityType: 'PTW', entityId: mRow.id,
      ptwNumber: mRow.ptwNumber || mRow.tempNumber, success: true });
    return ok_({ saved: true, fileId: f.getId() });
  }

  return { uploadAttachment: uploadAttachment, listAttachments: listAttachments,
    ptwFolderUrl: ptwFolderUrl, savePtwFile: savePtwFile, saveSitePdf: saveSitePdf,
    announceAdd: announceAdd, announceList: announceList, announceDisable: announceDisable,
    disableAttachment: disableAttachment, saveSignature: saveSignature,
    saveAccountSignature: saveAccountSignature, getSignatureBase64: getSignatureBase64,
    uploadPublicDoc: uploadPublicDoc, listDownloads: listDownloads, disableDownload: disableDownload };
})();

/* ============================== ApprovalService.gs ============================== */
/**
 * ApprovalService.gs — 固定 Tier 簽核（規格 §3/§4）
 * 流程：T2 承商工安 → T3 NMDC 施工 → T4 NMDC HSE → T5 Coordinator 簽發
 * - 不得跳級、不得審自己的（SecurityService.assertCanReview）
 * - 退回強制 Comment＋原因；可退回申請人（Returned for Revision）或上一關（Returned for Correction, Q10）
 * - 退回申請人時：既有簽核簽名全部作廢（重新送審後全部重簽）
 * - Tier 5 核准＝簽發：產生正式 PTW 編號（Q 決議），狀態 Approved；再由 T5 啟用 → Active
 */

var ApprovalService = (function () {

  var TIER_STATUS = { 2: CFG.STATUS.PENDING_T2, 3: CFG.STATUS.PENDING_T3,
    4: CFG.STATUS.PENDING_T4, 5: CFG.STATUS.PENDING_T5 };
  var TIER_NAMES = { 2: 'Contractor HSE 承商工安', 3: 'NMDC Construction 施工部門',
    4: 'NMDC HSE 環安衛', 5: 'PTW Coordinator 工作許可協調員' };

  function mustGet_(ptwId) {
    var m = Repo.getById('PTW_Master', ptwId);
    if (!m || !asBool_(m.isActive)) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    return m;
  }

  function pendingStatusOk_(m) {
    var pend = [CFG.STATUS.PENDING_T2, CFG.STATUS.PENDING_T3, CFG.STATUS.PENDING_T4, CFG.STATUS.PENDING_T5];
    if (pend.indexOf(m.status) < 0) {
      throw ApiError_('BAD_STATE', 'PTW is not pending review (status: ' + m.status + ')',
        '此 PTW 非待簽核狀態：' + m.status);
    }
  }

  function notifyTier_(m, tier, type, titleEn, titleZh, msgEn, msgZh, onlyUserId) {
    var onlyIds = onlyUserId ? (Array.isArray(onlyUserId) ? onlyUserId : [onlyUserId]) : null;
    var users = Repo.find('Users', function (u) {
      if (onlyIds && onlyIds.length) return onlyIds.indexOf(u.id) >= 0;
      if (Number(u.tier) !== tier || u.status !== 'Active' || !asBool_(u.isActive)) return false;
      if (tier === 2) return u.companyId === m.companyId; // T2 限申請公司
      return true;
    });
    users.forEach(function (u) {
      NotificationService.push(u.id, type, m.id, titleEn, titleZh, msgEn, msgZh, u.email);
    });
  }

  function notifyApplicant_(m, type, titleEn, titleZh, msgEn, msgZh) {
    var applicant = Repo.getById('Users', m.applicantUserId);
    if (applicant) NotificationService.push(applicant.id, type, m.id, titleEn, titleZh, msgEn, msgZh, applicant.email);
  }

  /** 核准（當關者或代理人；含電子簽名） */
  function approve(user, payload, meta) {
    requireFields_(payload, ['ptwId']);
    return Repo.withLock(function () {
      var m = mustGet_(payload.ptwId);
      pendingStatusOk_(m);
      SecurityService.assertCanReview(user, m);

      var tier = Number(m.currentTier);
      var num = m.ptwNumber || m.tempNumber;
      var signatureId = DriveService.saveSignature(user, m, 'TIER' + tier + '_REVIEWER', payload.signatureDataUrl);

      Repo.insert('PTW_Approvals', {
        ptwId: m.id, version: m.version, tier: tier, action: 'Approve',
        reviewerUserId: user.id, comment: payload.comment || '', returnReason: '',
        signatureId: signatureId, sessionId: (meta && meta.token ? String(meta.token).substring(0, 12) : ''),
        userAgent: (meta && meta.userAgent) || '', clientInfo: '', decidedAt: fmtDateTime_()
      }, user.id);

      // (通知) 指定下一關審閱人（選填；可多位 — 例如不同船別分屬不同施工組）
      var nextRevIds = [];
      if (tier < 5) {
        var rawIds = [];
        if (payload.nextReviewerIds && payload.nextReviewerIds.length) rawIds = payload.nextReviewerIds;
        else if (payload.nextReviewerId) rawIds = [payload.nextReviewerId];
        rawIds.forEach(function (rid) {
          var u2 = Repo.getById('Users', rid);
          if (!u2 || Number(u2.tier) !== tier + 1 || u2.status !== 'Active' || !asBool_(u2.isActive)) {
            throw ApiError_('BAD_REVIEWER', 'Selected next reviewer is not a valid Tier ' + (tier + 1) + ' user',
              '指定的審閱人非有效的 Tier ' + (tier + 1) + ' 人員');
          }
          if (nextRevIds.indexOf(u2.id) < 0) nextRevIds.push(u2.id);
        });
      }
      var nextRev = nextRevIds.length === 1 ? Repo.getById('Users', nextRevIds[0]) : null;
      var patch, newStatus;
      if (tier < 5) {
        newStatus = TIER_STATUS[tier + 1];
        // 單一指定 → 記錄為當前審閱人；多位指定 → 不鎖定（被通知者任一人可審）
        patch = { status: newStatus, currentTier: tier + 1, currentReviewerId: nextRev ? nextRev.id : '' };
      } else {
        // Tier 5 簽發：產生正式編號，核准即生效（Active，依有效期間工作，無需另行啟用）
        newStatus = CFG.STATUS.ACTIVE;
        var applicant0 = Repo.getById('Users', m.applicantUserId);
        var isTestPtw = applicant0 && asBool_(applicant0.isTestUser);
        var official = m.ptwNumber || (isTestPtw ? m.tempNumber : SequenceService.next('PTW'));
        patch = { status: newStatus, currentTier: '', currentReviewerId: '',
          ptwNumber: official, approvedAt: fmtDateTime_(), activatedAt: fmtDateTime_() };
        num = official;
      }
      Repo.update('PTW_Master', m.id, patch, user.id);
      Repo.insert('PTW_StatusHistory', { ptwId: m.id, fromStatus: m.status, toStatus: newStatus,
        byUserId: user.id, reason: 'Approved by Tier ' + tier, timestamp: fmtDateTime_() }, user.id);
      AuditService.log({ user: user, actionType: 'PTW_APPROVE', entityType: 'PTW', entityId: m.id,
        ptwNumber: num, comment: payload.comment || '', newValue: { tier: tier, to: newStatus },
        sessionId: meta && meta.token ? String(meta.token).substring(0, 12) : '',
        userAgent: (meta && meta.userAgent) || '', success: true });

      if (tier < 5) {
        notifyTier_(m, tier + 1, 'PTW_PENDING_REVIEW',
          (nextRevIds.length ? '👤 PTW assigned to YOU for review: ' : 'PTW pending your review: ') + num,
          (nextRevIds.length ? '👤 指定由您審閱的 PTW：' : '待您審核的 PTW：') + num,
          'Approved by ' + TIER_NAMES[tier] + '. Now at your step.', '已通過 ' + TIER_NAMES[tier] + '，輪到您審核。',
          nextRevIds.length ? nextRevIds : null);
        notifyApplicant_(m, 'PTW_PROGRESS',
          'PTW ' + num + ' passed Tier ' + tier, 'PTW ' + num + ' 已通過第 ' + tier + ' 關',
          'Now pending: ' + TIER_NAMES[tier + 1], '目前待審：' + TIER_NAMES[tier + 1]);
      } else {
        notifyApplicant_(m, 'PTW_APPROVED',
          '🎉 PTW ISSUED & ACTIVE: ' + num, '🎉 PTW 已核准簽發並生效：' + num,
          'Official PTW number issued: ' + num + '. The permit is now ACTIVE — work may proceed within the valid period.',
          '正式編號已產生：' + num + '。許可證即刻生效，請於有效期間內依許可內容工作。');
        issueBroadcast_(m, num); // 正式核發：通知所有審查流程參與者＋核發通知清單
      try { NotificationService.adminCc('ptwIssued', 'PTW issued & active: ' + num, 'PTW 核發生效：' + num, NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), m.id); } catch (eCc) {}

        try { PdfService.saveApprovalRecord(Repo.getById('PTW_Master', m.id)); }
        catch (e) { console.error('approval record save failed: ' + e.message); } // 審核歷程 → 04_Approval_Records
      }
      return ok_({ approved: true, newStatus: newStatus, number: num });
    });
  }

  /** T5 核發廣播：申請人＋全部審查人＋系統管理設定之核發通知清單 */
  function issueBroadcast_(m, num) {
    try {
      if (/^Example/i.test(String(num))) return; // 測試模式範例 PTW：不寄核發通知

      var titleEn = '📢 PTW ISSUED: ' + num, titleZh = '📢 PTW 正式核發：' + num;
      var msgEn = 'The PTW has passed all reviews and is officially issued by the PTW Coordinator (Tier 5).';
      var msgZh = '本 PTW 已完成所有審查，由 PTW 協調員（Tier 5）正式核發。';
      var sent = {};
      // 審查鏈上所有核准者
      Repo.find('PTW_Approvals', function (a) { return a.ptwId === m.id && a.action === 'Approve'; })
        .forEach(function (a) { sent[a.reviewerUserId] = true; });
      sent[m.applicantUserId] = true;
      Object.keys(sent).forEach(function (uid) {
        var u2 = Repo.getById('Users', uid);
        if (u2 && u2.email) NotificationService.push(u2.id, 'PTW_ISSUED', m.id, titleEn, titleZh, msgEn, msgZh, u2.email);
      });
      // 額外核發通知清單（系統管理設定；分號/逗號/換行分隔）
      String(getSetting_('issueNotifyList') || '').split(/[\n,;]+/).map(function (e) { return e.trim(); })
        .filter(function (e) { return /@/.test(e); })
        .forEach(function (email) { NotificationService.emailRaw(email, titleEn, titleZh, msgEn, msgZh, m.id, 'PTW_ISSUED'); });
    } catch (e) { console.error('issueBroadcast failed: ' + e.message); }
  }

  /** 退回（強制 Comment＋原因；target: applicant | previousTier） */
  function returnPtw(user, payload, meta) {
    requireFields_(payload, ['ptwId', 'comment', 'returnReason']);
    if (!String(payload.comment).trim()) {
      throw ApiError_('COMMENT_REQUIRED', 'Comment is required to return a PTW', '退回必須填寫 Comment');
    }
    return Repo.withLock(function () {
      var m = mustGet_(payload.ptwId);
      pendingStatusOk_(m);
      SecurityService.assertCanReview(user, m);

      var tier = Number(m.currentTier);
      var num = m.ptwNumber || m.tempNumber;
      var toPrev = (payload.target === 'previousTier' && tier > 2);
      var action = toPrev ? 'ReturnToPreviousTier' : 'ReturnToApplicant';

      Repo.insert('PTW_Approvals', {
        ptwId: m.id, version: m.version, tier: tier, action: action,
        reviewerUserId: user.id, comment: payload.comment, returnReason: payload.returnReason,
        signatureId: '', sessionId: meta && meta.token ? String(meta.token).substring(0, 12) : '',
        userAgent: (meta && meta.userAgent) || '', clientInfo: '', decidedAt: fmtDateTime_()
      }, user.id);
      Repo.insert('PTW_Comments', { ptwId: m.id, userId: user.id, tier: tier,
        comment: '[' + payload.returnReason + '] ' + payload.comment, timestamp: fmtDateTime_() }, user.id);

      var patch, newStatus;
      if (toPrev) {
        // Q10：退回上一關，該關重審（可修正後再核准續行）
        newStatus = TIER_STATUS[tier - 1];
        patch = { status: newStatus, currentTier: tier - 1, currentReviewerId: '' };
      } else {
        // 退回申請人：全部簽核簽名作廢，重新送審後由 Tier 2 重審
        newStatus = CFG.STATUS.RETURNED;
        patch = { status: newStatus, currentTier: '', currentReviewerId: '' };
        Repo.find('PTW_Signatures', function (s) { return s.ptwId === m.id && !asBool_(s.isVoided); })
          .forEach(function (s) {
            Repo.update('PTW_Signatures', s.id, { isVoided: true,
              voidedReason: 'PTW returned for revision', voidedAt: fmtDateTime_() }, user.id);
          });
      }
      Repo.update('PTW_Master', m.id, patch, user.id);
      Repo.insert('PTW_StatusHistory', { ptwId: m.id, fromStatus: m.status, toStatus: newStatus,
        byUserId: user.id, reason: '[' + payload.returnReason + '] by Tier ' + tier, timestamp: fmtDateTime_() }, user.id);
      AuditService.log({ user: user, actionType: 'PTW_RETURN', entityType: 'PTW', entityId: m.id,
        ptwNumber: num, comment: payload.comment,
        newValue: { target: action, reason: payload.returnReason }, success: true });

      if (toPrev) {
        notifyTier_(m, tier - 1, 'PTW_RETURNED_CORRECTION',
          'PTW returned to your tier for correction: ' + num, 'PTW 退回您的關卡修正：' + num,
          'Returned by ' + TIER_NAMES[tier] + '. Reason: [' + payload.returnReason + '] ' + payload.comment,
          '由 ' + TIER_NAMES[tier] + ' 退回。原因：[' + payload.returnReason + '] ' + payload.comment);
      }
      notifyApplicant_(m, 'PTW_RETURNED',
        'PTW returned: ' + num, 'PTW 被退回：' + num,
        'Returned by Tier ' + tier + ' (' + TIER_NAMES[tier] + '). Reason: [' + payload.returnReason + '] ' + payload.comment +
        (toPrev ? ' (returned to previous tier)' : ' Please revise and resubmit.'),
        '由第 ' + tier + ' 關（' + TIER_NAMES[tier] + '）退回。原因：[' + payload.returnReason + '] ' + payload.comment +
        (toPrev ? '（退回上一關修正）' : ' 請修改後重新送審。'));
      try { NotificationService.adminCc('ptwReturned', 'PTW returned: ' + num, 'PTW 退回修改：' + num, NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), m.id); } catch (eCc) {}
      return ok_({ returned: true, newStatus: newStatus, target: action });
    });
  }

  /** Tier 5 啟用：Approved → Active（開工） */
  function activate(user, payload) {
    SecurityService.requireAdminOrTier5(user);
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    if (m.status !== CFG.STATUS.APPROVED) {
      throw ApiError_('BAD_STATE', 'Only Approved PTW can be activated', '僅「已核准」的 PTW 可啟用');
    }
    Repo.update('PTW_Master', m.id, { status: CFG.STATUS.ACTIVE, activatedAt: fmtDateTime_() }, user.id);
    Repo.insert('PTW_StatusHistory', { ptwId: m.id, fromStatus: m.status, toStatus: CFG.STATUS.ACTIVE,
      byUserId: user.id, reason: 'Activated', timestamp: fmtDateTime_() }, user.id);
    AuditService.log({ user: user, actionType: 'PTW_ACTIVATE', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber, success: true });
    notifyApplicant_(m, 'PTW_ACTIVATED', 'PTW is now ACTIVE: ' + m.ptwNumber,
      'PTW 已啟用（執行中）：' + m.ptwNumber, 'Work may commence per permit conditions.',
      '可依許可證條件開始作業。');
    return ok_({ activated: true });
  }

  /**
   * 管理員直接調整關卡（跳關）：T2–T5 審核、直接核准（Active，走正常核發流程）、
   * 退回申請人、結案流程各關（CO2–CO5）。強制填寫原因並於簽核歷程留痕（AdminOverride）。
   * 被跳過的關卡不會有簽名／核准紀錄（Site Copy 該關顯示空白）。
   */
  function adminForceStage(user, payload, meta) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['ptwId', 'target']);
    var reason = String(payload.reason || '').trim();
    if (!reason) {
      throw ApiError_('REASON_REQUIRED', 'A reason is required for a stage override', '請填寫調整原因');
    }
    return Repo.withLock(function () {
      var m = mustGet_(payload.ptwId);
      if ([CFG.STATUS.CLOSED, CFG.STATUS.CANCELLED].indexOf(m.status) >= 0) {
        throw ApiError_('BAD_STATE', 'A closed/cancelled PTW cannot be adjusted', '已關閉／作廢的 PTW 不可調整關卡');
      }
      var target = String(payload.target || '').toUpperCase();
      var now = fmtDateTime_();
      var num = m.ptwNumber || m.tempNumber;
      // 共通：離開結案流程時清除結案確認鏈
      var coClear = { wcDeclarationAccepted: false, coCurrentTier: '',
        coT2UserId: '', coT2At: '', coT3UserId: '', coT3At: '', coT4UserId: '', coT4At: '', coT5UserId: '', coT5At: '' };
      var patch = {}, k, newStatus = '', descEn = '', descZh = '', overrideTier = '';
      var mm = target.match(/^T([2-5])$/), mc = target.match(/^CO([2-5])$/);
      if (mm) {
        var tno = Number(mm[1]);
        newStatus = TIER_STATUS[tno];
        for (k in coClear) patch[k] = coClear[k];
        patch.status = newStatus; patch.currentTier = tno; patch.currentReviewerId = '';
        overrideTier = tno;
        descEn = 'moved directly to Tier ' + tno + ' review'; descZh = '直接移至第 ' + tno + ' 關審核';
      } else if (target === 'ACTIVE') {
        var applicant0 = Repo.getById('Users', m.applicantUserId);
        var isTestPtw = applicant0 && asBool_(applicant0.isTestUser);
        var official = m.ptwNumber || (isTestPtw ? m.tempNumber : SequenceService.next('PTW'));
        newStatus = CFG.STATUS.ACTIVE;
        for (k in coClear) patch[k] = coClear[k];
        patch.status = newStatus; patch.currentTier = ''; patch.currentReviewerId = '';
        patch.ptwNumber = official; patch.approvedAt = m.approvedAt || now; patch.activatedAt = now;
        num = official; overrideTier = 5;
        descEn = 'directly approved & issued'; descZh = '直接核准並核發生效';
      } else if (target === 'RETURN') {
        newStatus = CFG.STATUS.RETURNED;
        for (k in coClear) patch[k] = coClear[k];
        patch.status = newStatus; patch.currentTier = ''; patch.currentReviewerId = '';
        // 與一般退回一致：作廢既有簽名，申請人可重新編輯送審
        Repo.find('PTW_Signatures', function (s) { return s.ptwId === m.id && !asBool_(s.isVoided); })
          .forEach(function (s) {
            Repo.update('PTW_Signatures', s.id, { isVoided: true,
              voidedReason: 'Admin stage override: returned for revision', voidedAt: now }, user.id);
          });
        descEn = 'returned to applicant for revision'; descZh = '退回申請人修改';
      } else if (mc) {
        var cno = Number(mc[1]);
        newStatus = CFG.STATUS.PENDING_CLOSEOUT;
        patch.status = newStatus; patch.currentTier = ''; patch.currentReviewerId = '';
        patch.wcDeclarationAccepted = true; patch.coCurrentTier = cno;
        // 清除該關（含）之後的確認紀錄，從該關重新確認
        for (var c2 = cno; c2 <= 5; c2++) { patch['coT' + c2 + 'UserId'] = ''; patch['coT' + c2 + 'At'] = ''; }
        overrideTier = cno;
        descEn = 'moved directly to close-out step: Tier ' + cno; descZh = '直接移至結案確認關卡：Tier ' + cno;
      } else {
        throw ApiError_('BAD_TARGET', 'Unknown target stage: ' + target, '未知的目標關卡：' + target);
      }
      Repo.update('PTW_Master', m.id, patch, user.id);
      // 簽核歷程留痕（不計入 Site Copy 的 Approve 列）
      Repo.insert('PTW_Approvals', {
        ptwId: m.id, version: m.version, tier: overrideTier || '', action: 'AdminOverride',
        reviewerUserId: user.id, comment: '[' + target + '] ' + reason, returnReason: '',
        signatureId: '', sessionId: (meta && meta.token ? String(meta.token).substring(0, 12) : ''),
        userAgent: (meta && meta.userAgent) || '', clientInfo: '', decidedAt: now
      }, user.id);
      Repo.insert('PTW_StatusHistory', { ptwId: m.id, fromStatus: m.status, toStatus: newStatus,
        byUserId: user.id, reason: 'Admin stage override: ' + reason, timestamp: now }, user.id);
      AuditService.log({ user: user, actionType: 'PTW_ADMIN_FORCE_STAGE', entityType: 'PTW', entityId: m.id,
        ptwNumber: num, comment: '[' + target + '] ' + reason,
        newValue: { target: target, from: m.status, to: newStatus },
        sessionId: meta && meta.token ? String(meta.token).substring(0, 12) : '',
        userAgent: (meta && meta.userAgent) || '', success: true });
      // 通知
      if (mm) {
        notifyTier_(m, Number(mm[1]), 'PTW_PENDING_REVIEW',
          'PTW pending your review (admin adjustment): ' + num,
          '待您審核的 PTW（管理員調整關卡）：' + num,
          'The administrator moved this PTW directly to your review step. Reason: ' + reason,
          '管理員已將此 PTW 直接調整至您的審核關卡。原因：' + reason);
        notifyApplicant_(m, 'PTW_PROGRESS',
          'PTW ' + num + ' was moved to Tier ' + mm[1] + ' review by the administrator',
          'PTW ' + num + ' 已由管理員調整至第 ' + mm[1] + ' 關審核',
          'Reason: ' + reason, '原因：' + reason);
      } else if (target === 'ACTIVE') {
        notifyApplicant_(m, 'PTW_APPROVED',
          '🎉 PTW ISSUED & ACTIVE: ' + num, '🎉 PTW 已核准簽發並生效：' + num,
          'Official PTW number issued: ' + num + '. The permit is now ACTIVE — work may proceed within the valid period.',
          '正式編號已產生：' + num + '。許可證即刻生效，請於有效期間內依許可內容工作。');
        issueBroadcast_(m, num); // 正常核發流程：核發廣播（申請人＋審查人＋核發通知清單）
      try { NotificationService.adminCc('ptwIssued', 'PTW issued & active: ' + num, 'PTW 核發生效：' + num, NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), m.id); } catch (eCc) {}

        try { PdfService.saveApprovalRecord(Repo.getById('PTW_Master', m.id)); }
        catch (e) { console.error('approval record save failed: ' + e.message); }
      } else if (target === 'RETURN') {
        notifyApplicant_(m, 'PTW_RETURNED',
          'PTW returned by administrator: ' + num, 'PTW 已由管理員退回：' + num,
          'Reason: ' + reason + ' — please revise and resubmit.', '原因：' + reason + '，請修改後重新送審。');
      } else if (mc) {
        notifyTier_(m, Number(mc[1]), 'PTW_CLOSEOUT_REVIEW',
          '🏁 PTW close-out awaiting your confirmation (admin adjustment): ' + num,
          '🏁 待您確認結案的 PTW（管理員調整關卡）：' + num,
          'The administrator moved this PTW directly to your close-out confirmation step. Reason: ' + reason,
          '管理員已將此 PTW 直接調整至您的結案確認關卡。原因：' + reason);
      }
      try { NotificationService.adminCc('adminOverride', 'Admin stage override [' + target + ']: ' + num, '管理員調整關卡 [' + target + ']：' + num, 'Reason: ' + reason, '原因：' + reason, m.id); } catch (eCc) {}
      return ok_({ forced: true, target: target, newStatus: newStatus, number: num,
        descEn: descEn, descZh: descZh });
    });
  }

  /** 簽核歷程（含審查人姓名） */
  function history(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    SecurityService.assertCanViewPtw(user, m);
    var users = {};
    Repo.readAll('Users').forEach(function (u) { users[u.id] = (u.nameEn || '') + ' / ' + (u.nameZh || ''); });
    var approvals = Repo.find('PTW_Approvals', function (a) { return a.ptwId === m.id; })
      .map(function (a) {
        return { version: a.version, tier: a.tier, tierName: TIER_NAMES[a.tier] || ('Tier ' + a.tier),
          action: a.action, reviewer: users[a.reviewerUserId] || '', comment: a.comment,
          returnReason: a.returnReason, decidedAt: a.decidedAt, hasSignature: !!a.signatureId };
      });
    approvals.sort(function (a, b) { return a.decidedAt < b.decidedAt ? -1 : 1; });
    var historyRows = Repo.find('PTW_StatusHistory', function (s) { return s.ptwId === m.id; })
      .map(function (s) { return { from: s.fromStatus, to: s.toStatus, by: users[s.byUserId] || '',
        reason: s.reason, at: s.timestamp }; });
    historyRows.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    return ok_({ approvals: approvals, statusHistory: historyRows,
      currentTier: m.currentTier, status: m.status });
  }

  return { approve: approve, returnPtw: returnPtw, activate: activate, history: history,
    adminForceStage: adminForceStage };
})();

/* ============================== CertFormDefs.gs ============================== */
/**
 * CertFormDefs.gs — 七種證書欄位定義（單一來源）
 * 前端經 system.certForms 取得；PdfService 用於 A4 證書版面標籤。
 * f=[欄位ID, 標籤(中英), 型別]；型別: t文字/ta多行/yn是否/c勾選/d日期/n數字
 */

var CERT_FIELD_DEFS = {
 HW:{sections:[
  {t:'基本資料 Basic',f:[['hw_date','日期 Date','d'],['hw_location','地點 Location','t'],['hw_workDescription','工作描述 Description of Work','ta'],['hw_paName','執行單位姓名 PA Name','t'],['hw_paTitle','職稱 Title','t'],['hw_duration','工作持續時間 Duration','t']]},
  {t:'已識別的危害 Hazards Identified',f:[['hw_hz01','明火 Open Flame','yn'],['hw_hz02','焊接渣/燃燒飛濺物 Welding Slag/Sparks','yn'],['hw_hz03','高溫表面(>65°C) Hot Surfaces','yn'],['hw_hz04','煙霧 Smoke','yn'],['hw_hz05','粉塵/非毒性煙霧 Dust/Non-toxic Fumes','yn'],['hw_hz06','焊接閃光 Welding Flash','yn'],['hw_hz07','絆倒危險 Trip Hazards','yn'],['hw_hz08','壓力軟管故障 Pressurised Hose Failure','yn'],['hw_hz09','氣瓶故障 Gas Cylinder Failure','yn'],['hw_hz10','毒性煙霧 Toxic Fumes','yn'],['hw_swaAttached','SWA/RA 已附 Safe Work Analysis Attached','yn']]},
  {t:'危害控制措施 Controls',f:[['hw_ctrl01','提供防火毯 Fire Blanket','yn'],['hw_ctrl02','必要時關閉火警/煙霧探測器 Suppress Detectors','yn'],['hw_ctrl03','指派防火員 Fire Watch','yn'],['hw_ctrl04','消防水帶&加壓噴嘴 Fire Hose Pressurised','yn'],['hw_ctrl05','持續監控 Continuous Monitoring','yn'],['hw_ctrl06','適用滅火器 Suitable Extinguisher','yn'],['hw_ctrl07','設置圈圍與警示牌 Barriers & Signage','yn'],['hw_ctrl08','電焊機獨立接地 Welder Separate Earth','yn'],['hw_ctrl09','作業下方鋪防火毯 Blanket Below Work','yn'],['hw_ctrl10','需要加壓工作艙 Pressurised Habitat','yn'],['hw_ctrlOthersText','其他 Others','t']]},
  {t:'其他危險 Additional Hazards',f:[['hw_addHz01','使用物質產生額外危險 Substances Hazards','yn'],['hw_addHz02','存在放射性源 Radioactive Source','yn'],['hw_addHz03','手動搬運危險 Manual Handling','yn'],['hw_addHz03Measures','若是：控制措施 If yes: Controls','t'],['hw_addHz04','低比活度垢/氮氣/礦物纖維 LSA/N2/Fibres','yn']]},
  {t:'工作現場控制措施 1–16 Work Site Controls',f:[['hw_wsc01','1.出入口/逃生路線暢通 Access & Escape Clear','yn'],['hw_wsc02','2.移除可燃易燃物 Remove Flammables','yn'],['hw_wsc03','3.防護屏障保護通行人員 Screens Erected','yn'],['hw_wsc04','4.防火監視員作業前/中檢查 Fire Watcher Checks','yn'],['hw_wsc05','5.氣瓶直立固定/避熱/瓶閥手把 Cylinders Secured','yn'],['hw_wsc06','6.檢查上下方防墜物 Inspect Above/Below','yn'],['hw_wsc07','7.必要時抽排煙霧、故障停工 Extraction System','yn'],['hw_wsc08','8.電纜軟管縮短固定防護 Cables/Hoses Managed','yn'],['hw_wsc09','9.設備依規定接地 Equipment Grounded','yn'],['hw_wsc10','10.合格人員檢查電氣設備 Electrical Checked','yn'],['hw_wsc11','11.依隔離證完成隔離 Isolation per Certificate','yn'],['hw_wsc12','12.出氣孔覆蓋封堵 Drains Covered','yn'],['hw_wsc13','13.排空/沖洗/惰化/排氣完成 Drained/Purged','yn'],['hw_wsc14','14.休息時關閉氣瓶閥門 Valves Closed on Breaks','yn'],['hw_wsc15','15.空瓶送回指定區 Empty Cylinders Returned','yn'],['hw_wsc16','16.通知作業區所有人員 Personnel Informed','yn']]}]},
 GW:{sections:[
  {t:'基本資料 Basic',f:[['cw_date','日期 Date','d'],['cw_location','地點 Location','t'],['cw_workDescription','工作描述 Description','ta'],['cw_paName','執行單位姓名 PA Name','t'],['cw_paTitle','職稱 Title','t'],['cw_duration','工作持續時間 Duration','t']]},
  {t:'工作類型 Type of Work',f:[['cw_wt01','塗裝 Painting','c'],['cw_wt02','吊掛作業 Rigging','c'],['cw_wt03','靜水壓力測試 Hydrostatic Test','c'],['cw_wt04','安全關鍵設備 Safety Critical Equipment','c'],['cw_wt05','施工架工作 Scaffolding','c'],['cw_wt06','隔離電氣工作 Electrical Isolation Work','c'],['cw_wt07','非破壞性測試 NDT','c'],['cw_wt08','機具搬運重物 Heavy Lifting','c'],['cw_wt09','機械工作 Mechanical Work','c'],['cw_wt10','消防系統 Firefighting System','c'],['cw_wt11','檢查工作 Inspection','c'],['cw_wt12','其他 Other','c'],['cw_wtOtherText','其他說明 Other Description','t']]},
  {t:'現場安全管制 1–9 Site Safety Controls',f:[['cw_wsc01','1.工作條件允許安全作業 Conditions Suitable','yn'],['cw_wsc02','2.工作不產生危險 No New Hazards','yn'],['cw_wsc03','3.已發放適當 PPE PPE Issued','yn'],['cw_wsc04','4.通風照明充足 Ventilation & Lighting','yn'],['cw_wsc05','5.周圍無熱源/火花 No Heat Sources Nearby','yn'],['cw_wsc06','6.安全標誌已展示 Signs Displayed','yn'],['cw_wsc07','7.額外許可證已簽署 Additional Permits Signed','yn'],['cw_wsc08','8.人員勝任能力已評估 Competence Assessed','yn'],['cw_wsc09','9.標準安全檢查清單完成 Std Checklist Done','yn'],['cw_additionalPrecautions','額外安全預防措施 Additional Precautions','ta']]}]},
 EI:{sections:[
  {t:'隔離申請 Isolation Request',f:[['ei_date','日期 Date','d'],['ei_area','區域 Area','t'],['ei_equipment','需隔離的設備 Equipment to be Isolated','t'],['ei_natureOfWork','工作性質 Nature of Work','t'],['ei_tagNo','標籤編號 Tag No','t'],['ei_requestedByName','申請人姓名 Requested By','t'],['ei_requestedByTrade','工種 Trade','t']]},
  {t:'電氣隔離 Electrical Isolation',f:[['ei_breakersDetail','斷路器/隔離開關及位置 Breakers & Locations','ta'],['ei_isolationType','隔離類型 Partial部分/Total全部','t'],['ei_breakerOff','斷路器關閉 Breaker Off','yn'],['ei_shuttersLocked','閘門鎖定 Shutters Locked','yn'],['ei_lockedOffCb','鎖定斷路器/隔離開關 Locked Off C.B.','yn'],['ei_noVoltageCheck','電壓檢測 No Voltage Check','yn'],['ei_addEarthing','額外接地 Additional Earthing','yn'],['ei_padlocksTaken','取走掛鎖及鑰匙 Padlocks & Keys','yn'],['ei_inergenLockoff','鎖定惰性氣體滅火系統 Inergen Lockoff','yn'],['ei_rackingOut','抽出/降下斷路器 Racking Out','yn'],['ei_mainIsolatorOff','主隔離開關關閉 Main Isolator OFF','yn'],['ei_mainFusesRemoved','移除主熔絲 Main Fuses Removed','yn'],['ei_earthingSwitch','配電箱接地開關 Earthing Switch','yn'],['ei_controlFusesRemoved','移除控制熔絲 Control Fuses Removed','yn'],['ei_warningPosted','張貼警告標示 Warning Posted','yn'],['ei_isolationDone','隔離 Isolation','yn'],['ei_earthingPositions','接地位置及編號 Earthing Positions','t'],['ei_comments','備註 Comments','ta'],['ei_declTagNo','聲明標籤編號 Declaration Tag No','t']]}]},
 PI:{sections:[
  {t:'隔離申請 Isolation Request',f:[['pi_date','日期 Date','d'],['pi_area','區域 Area','t'],['pi_workDescription','工作描述 Description of Work','ta'],['pi_equipment','需作業之設備 Equipment to be Worked On','t'],['pi_tagNo','標籤編號 Tag No','t'],['pi_location','位置 Location','t'],['pi_requestedByName','申請人姓名 Requested By','t'],['pi_requestedByBadge','證章號碼 Badge No','t']]},
  {t:'隔離確認 Isolation Confirmation',f:[['pi_processIsoDone','製程隔離已執行 Process Isolation Carried Out','yn'],['pi_processSupName','製程主管姓名 Process Supervisor','t'],['pi_elecIsoDone','低壓電氣隔離已執行 L.V. Electrical Isolation Carried Out','yn'],['pi_elecSupName','電氣主管姓名 Electrical Supervisor','t'],['pi_mechIsoDone','設備/儀器隔離已執行 Equipment/Instrumentation Isolation Carried Out','yn'],['pi_mechSupName','機械主管姓名 Mechanical Supervisor','t'],['pi_isolationDetail','隔離內容/位置說明 Isolation Details & Locations','ta'],['pi_comments','備註 Comments','ta']]}]},
 CS:{sections:[
  {t:'基本資料 Basic',f:[['cse_date','日期 Date','d'],['cse_area','區域 Area','t'],['cse_workDescription','工作描述 Description','ta'],['cse_spaceToEnter','將進入的密閉空間 Space to Enter','t'],['cse_location','地點 Location','t'],['cse_paName','姓名 Name','t'],['cse_paTitle','職稱 Title','t'],['cse_duration','工作持續時間 Duration','t'],['cse_portableGasCertNo','便攜式氣體檢測證書編號 Portable Gas Cert No','t']]},
  {t:'已識別的危害 Hazards (16)',f:[['cse_hz01','缺氧窒息 Lack of Oxygen','yn'],['cse_hz02','可燃氣體/蒸氣 Flammable Gases','yn'],['cse_hz03','有毒氣體/蒸汽 Toxic Gases','yn'],['cse_hz04','通風不足 Inadequate Ventilation','yn'],['cse_hz05','照明不足 Inadequate Lighting','yn'],['cse_hz06','移動機械傷害 Moving Equipment','yn'],['cse_hz07','殘留危險液體 Hazardous Liquid','yn'],['cse_hz08','殘留物質風險 Residue Material','yn'],['cse_hz09','自燃性沉積物 Pyrophoric Scale','yn'],['cse_hz10','外部污染風險 External Contamination','yn'],['cse_hz11','觸電 Electric Shock','yn'],['cse_hz12','腐蝕性物質 Corrosive Materials','yn'],['cse_hz13','被包圍/困住 Engulfment/Entrapment','yn'],['cse_hz14','極端溫度 Extreme Temperatures','yn'],['cse_hz15','天然放射性物質 NORM','yn'],['cse_hz16','人工作業/滑絆跌/落物 Manual Handling/Slips/Drops','yn'],['cse_otherHazards','其他特定危害 Other Hazards','ta']]},
  {t:'控制措施 Controls (22)',f:[['cse_ctrl01','空氣檢測在安全範圍 Atmosphere Safe','yn'],['cse_ctrl02','通風換氣 Additional Ventilation','yn'],['cse_ctrl03','機械隔離 Mechanical Isolation','yn'],['cse_ctrl04','清除排空危險物質 Clean & Purge','yn'],['cse_ctrl05','供氣/SCBA Supplied Air/SCBA','yn'],['cse_ctrl06','額外照明 Additional Lighting','yn'],['cse_ctrl07','通知緊急應變人員 ERT Informed','yn'],['cse_ctrl08','電氣隔離 Electrical Isolation','yn'],['cse_ctrl09','安全標誌與圍欄 Signs & Barriers','yn'],['cse_ctrl10','風險評估 Risk Assessment','yn'],['cse_ctrl11','指派急救人員 First Aider','yn'],['cse_ctrl12','救援計畫與設備 Rescue Plan','yn'],['cse_ctrl13','持續大氣監測 Continuous Monitoring','yn'],['cse_ctrl14','溫度在安全範圍 Temperature Safe','yn'],['cse_ctrl15','安全帶 Safe Harness','yn'],['cse_ctrl16','安全母索 Life Line','yn'],['cse_ctrl17','符合作業之 PPE Appropriate PPE','yn'],['cse_ctrl18','人員已受 CSE 訓練 CSE Trained','yn'],['cse_ctrl19','人員進出管制記錄 Entry/Exit Log','yn'],['cse_ctrl20','通訊系統 Communication System','yn'],['cse_ctrl21','指派待命人員 Standby Person','yn'],['cse_ctrl22','SCBA 時指派救援人員 Rescue if SCBA','yn'],['cse_otherControls','其他特定控制措施 Other Controls','ta']]}]},
 EC:{sections:[
  {t:'基本資料 Basic',f:[['exc_date','日期 Date','d'],['exc_area','區域 Area','t'],['exc_workDescription','工作描述 Description','ta'],['exc_location','地點 Location','t'],['exc_paName','姓名 Name','t'],['exc_paTitle','職稱 Title','t'],['exc_duration','工作持續時間 Duration','t']]},
  {t:'隔離/預防措施 Isolations & Precautions',f:[['exc_needElecIso','需要電氣隔離證 Electrical Isolation Required','yn'],['exc_needAddPpe','需要額外 PPE Additional PPE','yn'],['exc_needCableLocator','需要地下電纜探測器 Cable Locator','yn'],['exc_isoCertNoE','隔離證號 Isolation Cert No (E)','t'],['exc_otherPrecautions','其他預防措施 Other Precautions（開挖前須送測量團隊審閱 Survey team review first）','ta']]}]},
 RG:{sections:[
  {t:'基本資料 Basic',f:[['rac_date','日期 Date','d'],['rac_location','工作地點 Location','t'],['rac_equipmentLine','設備/線別 Equipment/Line','t'],['rac_tagNo','標籤號碼 Tag No','t'],['rac_supervisorName','輻射檢測主管姓名 Radiography Supervisor','t'],['rac_supervisorBadgeNo','證章號碼 Badge No','t'],['rac_company','公司 Company','t'],['rac_contactPhone','聯絡電話 Contact Phone','t'],['rac_sourceType','放射性來源類型 Source Type','t'],['rac_sourceNo','來源編號 Source No','t'],['rac_activityGbq','活度 Activity (GBq)','n']]},
  {t:'須提供文件 Documents Available',f:[['rac_docQualCerts','人員資格證書 Qualification Certificates','yn'],['rac_docDecayChart','衰變曲線表 Decay Chart','yn'],['rac_docContainerCert','曝露容器證明及洩漏測試 Container Cert & Leak Test','yn'],['rac_docCalibrationCert','劑量率儀校正證明 Calibration Certificate','yn'],['rac_docFilmBadge','人員劑量監測器 Film Badge','yn']]},
  {t:'預防措施 Precautions（RPS，由 HSE 驗證）',f:[['rac_areaMarked','區域已依 7.5 µSv/h 標示 Area Marked','yn'],['rac_safeLimitDistanceM','標示範圍(公尺) Distance (m)','n'],['rac_areaClearPersons','管制區無未授權人員 Area Clear','yn'],['rac_personsInformed','周邊人員已通知 Persons Informed','yn'],['rac_flashingLight','曝露時啟動警示閃燈 Flashing Light','yn'],['rac_additionalPrecautions','額外預防措施 Additional Precautions','ta']]}]},
 DO:{sections:[
  {t:'基本資料 Basic',f:[['div_date','日期 Date','d'],['div_area','區域 Area','t'],['div_company','潛水公司 Diving Company','t'],['div_vessel','潛水支援船/駁船 DSV/Barge','t'],['div_location','潛水地點 Diving Location','t'],['div_divingType','潛水類型 Type of Diving','t'],['div_depthM','深度 Depth (m)','n'],['div_startDateTime','開始 Start','t'],['div_duration','期間 Duration','t'],['div_workDescription','工作說明 Description','ta'],['div_workNature','工作地點/性質 Location/Nature','t'],['div_applicantName','申請人姓名 Applicant','t'],['div_applicantTitle','職稱 Title','t']]},
  {t:'應採取的預防措施 Precautions（執行權限 PA）',f:[['div_pc01','顯示國際訊號 International Signals','c'],['div_pc02','與潛水主管討論工作 Discussed with Dive Supt','c'],['div_pc03','天氣適宜且同意潛水 Weather Suitable & Agreed','c'],['div_pc04','潛水地點周圍安全 Area Around Site Safe','c'],['div_pc05','壓縮機於乾淨空氣區進氣 Compressor Clean Air','c'],['div_pc06','危險作業已停止 Dangerous Ops Stopped','c'],['div_pc07','船隻固定/螺旋槳停止 Vessel Secured/Props Stopped','c'],['div_pc08','警告標誌及監視人員 Signs & Watchmen','c'],['div_pc09','潛水控制台2米淨空 2m Clear at Dive Control','c'],['div_pc10','全船廣播潛水警告 Diving Broadcast','c'],['div_pc11','安全進出海 Safe Access to Sea','c'],['div_pc12','潛水區安全 Dive Area Safe','c'],['div_pc13','潛水員健康+醫療證明 Divers Fit & Certified','c'],['div_pc14','急救裝備達標 First Aid Equipment','c'],['div_pc15','潛水醫護人員數量 Medic Requirement','c'],['div_pc16','潛水員已簡報 Divers Briefed','c'],['div_pc17','潛水設備檢查已認證 Equipment Checked & Certified','c'],['div_pc18','個人裝備每潛檢查 Personal Gear Checked','c'],['div_pc19','與設施商定禁區 Exclusion Zone Agreed','c'],['div_pc20','監視員已部署 Watchmen Deployed','c'],['div_pc21','安全設備可立即使用 Safety Equipment Ready','c'],['div_pc22','適當 PPE Provided/Worn PPE','c'],['div_pc23','駕駛室/潛水控制通信 Comms Bridge/Dive Control','c'],['div_pc24','非潛水支援裝備檢查 Non-diving Equipment Checked','c'],['div_pc25','通知設施每次潛水始末 Notify Start/End','c'],['div_pc26','船舶演習提前30分鐘通知 Drills 30min Notice','c'],['div_pc27','每潛檢查潛水通訊 Comms Checked Each Dive','c'],['div_pc28','記錄及監測設備就位 Recording/Monitoring OK','c'],['div_pc29','安全支援設備備妥 Support Equipment Ready','c'],['div_pc30','已批准工作程序 Approved Procedures','c'],['div_pc31','專案安全計畫已提交 Safety Plan Submitted','c'],['div_pc32','通知駕駛台每潛始末 Notify Bridge Start/End','c'],['div_pcOthers','其他 Others','t']]},
  {t:'安裝所需的安全預防措施 Installation Precautions（設施主管）',f:[['div_ip01','無腳手架/管狀提升設備 No Scaffolding/Tubulars','c'],['div_ip02','潛水區上方無吊運 No Lifting Over Dive Area','c'],['div_ip03','無高空作業 No Work at Height','c'],['div_ip04','沒有釣魚 No Fishing','c'],['div_ip05','沒有傾倒 No Dumping','c'],['div_ip06','無水泥排放 No Cement Discharge','c'],['div_ip07','船上方無燃燒作業 No Hot Work Above','c'],['div_ip08','5m內吸入口鎖定隔離 Intakes Locked Out (5m)','c'],['div_ip09','附近無噴砂/噴漆 No Blasting/Painting Nearby','c'],['div_ip10','定期廣播潛水作業 Periodic PA Warnings','c'],['div_ip11','監控海底設備啟動控制 Subsea Controls Monitored','c'],['div_ip12','向進入船隻廣播警告 Vessels Warned','c'],['div_ip13','未經許可不得移動物品 No Movement w/o Permission','c'],['div_ip14','控制點放置警告標誌 Warning Signs at Controls','c'],['div_ip15','鑽探作業提前30分鐘警告 30min Warning for Ops','c'],['div_ipOthers','其他 Others','t']]}]}
};

/* ============================== QRLib.gs ============================== */
/**
 * QRLib.gs — 內建 QR Code 產生器（qrcode-generator v1.4.4, MIT, Kazuhiko Arase）
 * 用途：PDF 之 QR 不再依賴外部 API（api.qrserver.com），離線/配額問題全免。
 */
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

/* ============================== PdfService.gs ============================== */
/**
 * PdfService.gs — PDF 匯出（Q 決議：主表 A3 橫式、各證書 A4 直式；版面依 Excel 重排）
 * 內容：全部申請內容、勾選、證書、簽名圖、審查紀錄、Comment、QR Code、版本、產生日期。
 * 產出同時存 Drive（04_Approval_Records / 02_Certificates）並回傳 base64 供下載。
 */

var PdfService = (function () {

  /** 公司 Logo（內嵌 base64，PDF 左上角使用） */
  var LOGO_NMDC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAARgAAABUCAMAAABuvdgdAAAAYFBMVEWWoajS4+NSXWYVJDAcol0mOEZ0jo5seISvu8IhaVST2bWu6s1szZhNrnYIVzMArz7///8CJDgEGSkCtVDv9/cAChcGKUEwRVMMqVG3wsYDEhzl6+/N1tpLWWNWZnCZp69vOnjmAAAAIHRSTlP/////////////////////AP///////////////////3wvzbcAAAu9SURBVHja7ZzrlquoEoBBoibdu/eRatCIt/d/y0OBGgW8JvtHZoU1a2a6o7R81p0iRGQiOzFO3bQ5Kc4qqDM3JaUzruRalpRW09sOP72oSZekbZsmCemutTsHacpTa6ibKvsnQ9Dka/6bq4LQ4HFRNBEpqzPviXZtwUFKiTMp/R9WNGQGh8SSnHl+KoH8C3ER3z+X7/kHJfDg0EtiuK4iIcdeEiWFpgEwn0wzigkdFUhfIxt6QmI05+T1OkX/XO73r/m8JAQm12vheW7WxCCOyt3PUadcAnfnND+D5A15gOGKkxNgOFdR/VIwArn8/t5dVQqA0Uggt1wQEspNV20/i8gqg6VHO2HykMKC9GDMj+lhJUVJPEN07bG/L/dfH8ySKiGX/LEkGZPt10SYnEkd9wVHgdEgA4ZzGdFjekGt7KlIvEBmrHVBNUIue8F4i5JFue5EaSthzzz4vi0Y1LnuoMTYWWRRn3CXIdNLkztyOQ8GJZ+IFTBlLPcibmq0Mf0P0VEbMzzMC8gI8aXF5VkwuKLlRyFa+2HfXKDICEa/fHbAO9VqUEqQbfW0JvVqZMYTYHK+/HqRS75b8rIeTG7MjuoOgzH3sfJJgflO7pffI2Dy3PHdo3uRzQIXhR/DDjQxQJdlE4nB+1p6VJUGws+JywPLLjD5wCawTh1eBdTJ9/kznzabCLk4YLiMryfA4Huip8nQP/fevOwFY7ksvXxZ+mQwumCh2PmRYYxzK5L5YLTZSQ6CGcLP60mB+b7oYPd+TGKmi/E+hdjjIoqQnVJcp1qUiqrs2nhAY5xJAAzGs3RHaFJ7MbVKxSlvdL/PuewAE7dRE0U6C1SGDvjK5Iwk4Kd1tFJPHqRsbKIwWAXHxvR3HFIlyK0XVLfj6kR/DJRjYKD3yaKiJIpDHth5kNp30zrYp05ES5gy9kV4YPLHTTvAgGe2gJNjuVOfAzhjB5jpHJ1ZweyauTkQWSR9XQxofqWFZvw1CWofxrMHVanPEKojacWfe4jLQTCZSGDdytBALh0W7paMjx8GYzMEcRQMerXyiNX9/X0aDD4lcTVlLg8BC1NvViYXwGCGsJoe1gvB9S4DpW2uzQF8KvqfyzEwuBjiLF1ObYGIwUmggYSXNrM4xVLALeNVW9otRZGy3fZqYkGNEM3lLzkIRo/ICTpuYun+nOdQYHK3keAtgck34lm9tAbCRQ0MacSGwHz/LGDRXNgJMEQ5l0x0xRUnDntCrmWJQXVaefn696mEfMiz9mX/w71fQaOr/3W5/WX8BBg3glNkSZp0sFJkT4JB875qS6+MGS655wxXMwSaXBbE5X5jjxDrCJisnYsFTNJhd4WQPA0G6xers2jPH1InsCHNWvASEpnLBbnMFrUTjHAr5hO4whVoWT4vMX3Rc0UxCEg3m+tTmDTk1YSgQW9kuTBACTwlMaWzG5LOq9OzFdUvAbP28s0TFWxB1kJBoqA/YTXSXIy4aC5njK8bV0G0HN7Bi8CgOq3ZUpGGQ5ocoAuo0WVJXP72t8WnJMaRi1Uw9EVgtjIEcWWhIjPkTtFTqxZupy2Iy6OK8WIwvo2pXwaGB17+7KmihW0JwCBRDMGuUSOnxGCdkRaXofCUnzG+nipN0kjBXDDkdWAwnl2teC9VmmEIKIzVvfy6YCwWzQXCrnY3GKd0Oa1eO1ExV+krwXC1HtLUS3s2lui4neYVX+6/DzV6AozjrqcuOXVtDKvOgYHlPYWVDEGkC+qkMEOg3z+X+7rVfQaMyFpYNLCd6zZ36ZIHBvJ0aVdqPZ61FTDtjLz7WEL/+BHd/zADwJjOW/cJ40udDDoSs/rdZlHYz7B9MAW92plYINhbr9FEksfcr96Dui056eRH+fxPgOnkLP6elB2Eb2QWdli2JEY7EhqFDcZm+pUsCNut16O7y4US+QowVexoUrlif2yO6Vcd9G8oXQFjNmoJh9DGRLPFObxvPkrMfJvk8uWXmHaBiVzhd1PI+QusAnWDzpcZzSUuxAqYyiqt9LdCEcyGDFbBkGYEM+Fy+aGm9pY/C0brinLaf7r5ghNfX2Vgs6dkCopqA4z1MnBUYgZhWwAzLUj9oX0VKT+uSsI1bY7ACKeNytU0c9HVLYaAxC3VagOM6T7KeX4YjLZQynX8HpjLz7dNvk+pUjvNRyKQG3GFMLbZDz+aR1OjoAk3T52zRmyA0aAbx5ZOn2jVBitH2OZg7mh1l+qOe8AUtR3XpIkRixPcBZ4ysLOkL1QsSrrrlSRtARLGdgmxITHCVLzPgMmujuzOwNyN1X0CDMfW3MduPDDHrQYCW1HIPNwRO9/Uh76RRKyBQf9VF+oEmCqjLUwLnjMwRo0GK34KjHl+nYaDH6fr+LIOOQg6L8DCpLkR5i2tkBuRWwNj4CSTvdjdEpM5wjZx12h1RfYkGJw7XyirlWHHWS52mUEgvxu7Nt04ZqYWgxbncKRNb+osNJg+hLlcvmfPHQLTbYPxGqzyvhmKLRZbalOKzrdbqnIM8cVCgDeTwnbUwEP9i8LYYJhJzCX5Fv8AzGhOi5W917qQ+yci22DEkB4eBYPbK8omlRaMzqS/qBOKvwhM3udyqwUFEe1t2pRptWVjxhLdGTAZbZSVmHufGnkpyuskBmRB1uJyof90x+WeibDHfB+YTJiGAnUQDAqbiZtuxvD+oaFahdd/eQYMcL2a7R1z/YZhS2oAjNyR2Muuq2CFotQaqqLj/fHaBuf8ctFO+osGbnZzJfDBkC0w2m+ruNvZbFw2a2gYQFv3kS+adDNWC386gI/UnjqGH9SkUtsYdNIiWCwe//74EMQr5+aBMUZokhUROfBAZcvllM1YrdZhIxsP1GiJmQ/Jq+USXXTqRAVhf32rOzb1gJz8df3GpHQlRgZPuEkp0evFbUePdqbXJLInt4b6AU6nJ2vJuKmRkTYaR2HGypk+SrJTo06+l4B2kT+cv0ILf0RR07Rt0pVnu/UpSZoiRro4eFG0ZD4XcRudxD85BnpA0kKVtc3fnHsmSokZZe2bP5J9Rlj/Pwg+YD5gPmA+YD5gPmA+YD5gPmA+YD5g3n7sSCvF3jnEf1FidvDZmZq/KxhRVaZGov8z/FiJ8X8NoWoc5o4KL6nmfRD0Sq60L07hp9lwZfW2YFrZbzwzc9QBq3zcrJByZTcjSf/VVv1p4xp/VBC3Y81ckJu9wJYzI9k3YlGG353xrmCaHoy0/Zl47NHuYVTD6WLcmDEsbKW61jcoJaWSfW+QwBYnS87cUDGw20OJRli/r8ToBRUsjpn9RqAUN2kUtgKJ4YgsgomLOC7soY1aY7g1TTFIEMqcYm2SFlLa/agr5FhursH0u74vGP30aGbs67cHZbGTagIGbuJhVjQY07/fAo/786XKQBWE9Ha7ZTwWWQGmGfaNwUw3E5BCjEozAzPdHzRgcDNSmyWjiwxbGKcuSlCzZw1gDh+/sSq1HQ57FjlRLEHdqc0pnAFMTPQFxDaUWTAVvVlLQoEbFROU0trsvwh75DTuG8ffF4w9LWZ6srEvU6YixjVPwOTmCmVPn9fS9HRjJwOKGpU8x2/XQpML47ELPMmobGvjG4PRC9JuJuolRqb4whVBVaofXkm73hGM2drj9qvttMTE2HpVYdMaGxqiKPbv0+y9wUBDCElS0htf7JKPQKtL3IO5oiqZUQ0S094MjoFTaZx2EXM2dtinbOgae2Mw06YPC4ZiMBNjt5kBo/qjFuJhY+KhJ1zzMzhM98/jaGkCg8X+j3glA0agMmldya2NUcrxSjpIHnwOnqYfmv2uD1XC8xjvLzGNVZT6ITHmwD48bEyvSp0YwaDI2JVTjHrTsq47rYAjmFS9v8TwfkfeOtdeBUrs6eglRmrjYa6ILRiOAZ72Vf1XO5D+SADmBM1/R5UiOQzSS0xkwrVUMmlzQaI/YwzRFBaMcU9CZwB9B9AV28F1LqUU6ybTvjkYMg6jN5QQe0TJ9C+YhLserzDLrox7EllJOvu5Dn+6tG3aKJn0qF1JnyBk/wdu4N19lA9z0gAAAABJRU5ErkJggg==';
  var LOGO_TPC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAABgFBMVEX9/f4AAAABZqoAWqLlAQwQc7NNlsQzhrzT5vG10+eIudiny+JrqM6Yw93y6+7E3OwjfbYBfr18stQAf38McbH6x8z0h5D719oWd7TsN0XuRlPpGSbqJzQAAP8RdLLwWWUAVao9jcD4tbvxZ3L3qK8BaaxdoMoEbK7zeoT4vcIAf/9CjsABaqsUd7Q0hrz1k5v2nKQDaqwDa60A//8FbK4AqqroEh0ifbadxuAifbY3isH73uEDbK0XebfvUl3ycn0mgbnsMT4AAH9WlrpvqND///8AP38AUp4AVf8JZJo/kMFZl8dtmsh/ssyNquL/v/8AX58ff58OcrMid6oifLpBib1Ajr9Fksh/v7+UqtSLudCyzOWq1NQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+1fl8AAAAgHRSTlP/AP7+//3+/v///v7+/v///gT/AtL///9z/////wGs/wP/////U//U//8C/21UKf//JK8BEAP/aP9TKf+dJv//Vf8CDhACBP8DCf8SDgoJBAgIng8lJ/8hBAwLCgYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBmne0AAAxESURBVHjapRoFexy3UqtdLdOxj2wf9EwxhBwHmiZN0r7CY4b//zvezAhW2jtTqi8527fSjIZpmXf3Ou3g55eLD3v7/T4XHJbg/f7+3vnfvsCDead3DwB218P5y+/h882r/T6n5fu++sDV/8v5t/C4d/i1CJ7j5d7s9YW8dxTmaZHBKtI8jDQte4Rj/hUI5gD+vx/2AZDPozyLWWvFWR4RIfvnnzzv5aMRwInPcHmAHhYSXjdcRIJWFG7ShDAWIWwQ/b2/et7hoxD0vvf+/QpZE6UIPA0Fsl4x35e/ijBFJCnQASj+7J32Ho4Atn6A2/MwYazKa47gorBbJFUMq0qKbhiRsKMu4EhCRPHNLXxiO4X7d+R9WAEPEBDctWJbK+niMx5mcAlE8eypdzh/CAJg5ivgSAS3T4WCwFiZkO4oGeRpQoJJF4AjAiElEbAPiDi9H0HP+4zXTyX4GnnAUGGkCATpLP0e5YgkzmFXBHdI4eG7n7wf7kPQ8S76wo9ivJNfo4iTEOmowzSrlK7GFagUfOmLHFhXAgoexiyOfNF/6nXuRtDxPsAVc8Zy7gsEn9bIpUKbQUn/aFXpmeJPCZuR5Jwjmzp3Iegg+3nGqoguhVziUVEawZ6UWcrWjbGlSCaggP1+WLIM2NTGwFz4e4KLihVwfWBrUfukSmYtl+wfgg0ura+yM1/qAxxJWAXHn7gYWBt+HSN7zoCnIdzKUc+TYxYjfcOho65ALfC0qpFNcd3GwFr8qRkL6QBQUWeO4o8mJbIZvpxcOg8K4dcJnesyFrW4xCz4rzV8ENiGsNirnA0YEzzCX6dr1/FJ2EB5zsoaMbzcRnDoXQADY4SfkcolLcudDUnZyfWdBEv3IYggZKyLGGJQk6eNxTHjH36FqFIp+DVagrvGY/iA24Fc4dFxMGg5DuEvCE+XVZwfdU6ftxB0PLDfjOUEX+B13HUQgLJmZOFkH+M2BiA6QhqAxAwckxED0+7/lQDyCoQA8Ddt+N8RTxY+EuCTGILrUWsPYYAbVvABYji0EZx6/0TxxcTDehv+MFih7eJjlANq1zqYbmM4Qx0RqEr8xfOeheDQ2+c8hh0hkx/uugpm+APkg5JRDFwFs3ILw0Y+BnN5pkggBL8DDfVTpCwG/YysI4OSLksML5GJsLoSD5tJDFeWHBBKwv2CpYZJjOL77/vAoARpLxCJWW/HpJPBUAHOMKIBBOLhIAjw8cyyugQVseuLEph09KKnEZCLSIg3QJut/+MpwLkmOGhkZgklGXwyCSxZpEg/AkrQZfwgEcznnwQP5d1DP3dkO2Zvp4GEkPo63vtc7ZoEwQQUeGwdQQAJ3hKiaGc+JwREQMyQfzd+bTu3IHgPnA4kl5PCWpLMEpCvDgJSMS0Gaa0L+EV6PaTgD30gIEXYwrcYhMcncMkDdutaBnKtbSb9LBkdghSIgo53LgArEpA6GjqRh6dSGW9SZxXaAOWyxFDDJXMgoZJOj0GU3wcVKtA+BI9tAch1okj3naV3juUmSwxo6cSoCGzh1GOn3gUqbgReyiFgoOB/J//MKaMwC7ImFSTcbdLcgD+gyYUPXrXHQMScI8oSiKsa+5rJgx/VN4KfsdIsbdRk5XItmZZVIbUUz4CY2dxDEef4pbHhcgbK5zBXOSBLWYw+q53TUXBsLhPDZQsUM1CAHMrg7wxuVWjxTrUAtJXWvHb1h3yaikQgAqR1qj14Tm4nRO/+AoQMRoBKi4iZTTUimWjBcT91EcjQoKU1vKQjM5UxASsqhIhpEiMdQvFmviu3wYnWUJSbYLu8f+PM39OZA01vTCYV8Xce+2MfontIRBW25h2DE9WBF4JglDgrw5zdSOXjhCmluFI8Kshn5PzokF3gRkFqK/XimHbCkUtjwiHfuRYmoQFfMbpulAKZUQCFwMen7BwUlESgXOTAcHNQNv5l52r8SmncxlgeEOo//4btwS9ofIkSwaxt+lifJTtXqzJE7z2VulqDVZED5U8Yyrjro7NLZSAcDx3n9Yi1Cg4GU3ItIUoYNB+kzNDMQvATuS9D+Rhucsy+bn0M2NsZ5jddknIKwnvGUIkW9DcWE6ho43HLps7CW5cb9strMLXJGL0FqJBUI4YmFJHOAkfHoA7l2D2V/eh4Ucer/tjKX5do+QfHpEZoW+BhwCAK0lIBcqG8fNRK2fLIWlg626ud4dDdhoOY9DTERI6hJ5ICZ6PlvVxOt016xxpVoDmZNAQm7QwQ3HIydhakTkmFS/1dxbsPPQJB5vM7FqjfvQgsFpW7NtcI5zYE4nYW3UBczrSQfRQyK493YQBNCAtIy2vsFYFXKszPG+HnDxFyo6ajMbiIctg6JNCrhRhTGyHX6FgoUXQWFaAHK2DPxqip9NbK0K4wKI0vW3qKWU4iYyTlnTqCRv6iXWYtWTmZ4T26xtDQVWyMqzgANzRsFS8xpRAR8bsrKYgwS6tacRpPsxG5itxyFTqgpVIhZsHVqJ34n2HtQMWPQgC8waKybRNXwWp5TY4S2SH5/o7cddK4awgHq6mJxXb8pQpWIggRI6iGq6MDCv4rKTYMyNJdy4DDTcCR+cTK1VQEm/rAREJQyZrV57FbR5u4j2ZQ6YAjQyb579hKSSG4Lk+aiIPMzrJKIoA/YWuVNSo0NOcG0jilElHIVEG/S9mMTqpp53r6UF+0GmvKhyppyiRIDPoqbUEhKKVbq6R61CTuXe3/oXw0sSBvmD9REXmiLQf/q7RFJV4qiKrQR5tHTei80XGAW1VO2qR2B+W1lenjVRPfJF6UOkaUGKXmBDJ0Mm2CP9w8OgP3X+t4IBo3dCDrlNlM51Fotyp1fOqx+Rc0tS5WDCZXGwSD927en5LmWzKojRta6zR5olSvRJ0UKAZKfk36HpNpKK1YMilqK2MWmLyAcWVVlVS5cUO6QBiyS6MIG9Ajk75DASJUppc1vqU05ddSZ8wtR62pVSXOxHaOMaQR1PjAAkSVUCSU2q4Bj50SrZ3d6UTW3SUJCNFNxbqE0kUg1lCF00aYOHcD95BWlQyZcaRFfOIUcooArGNDWQT2ZBmLdfgNdUlMDdJYnDKeinyqErKONLhlarYoXhIBVVPG6kI8ohpdlE4VPF1r82cLtDFpaBFXJgMaejx0BEDMWVBToinE578gCRk+2jiVMjAYscx09G8Sr4Uuhd7DJksAZFAEyWol6GZIiBIQNpNARUao51LBN/LuC/hxligNnehmmGHQz5KB1Aw5dNs5Madujx1nKdm8tLLtwvbRY7LDA6vVoBoqNZr+0Z96VkPqXHYSZLfHcvPrEwoR12+NDgKCqlIMpMi3Lu12UcZuMIS7DSnTUiPcoaOrCtTEQpBLKk62mnYxxjjZ92u11MAe3mBELKkdt9jGsNKKCAgS2bMrp1uNTVJeqj63moLeS5AzicbsaecLAx1wctkUe28bl4IfUoEe72hrmsZsQV4z2m78Tq41BbJ9fdUusxIFH7Dvasx6z3uf+7KjhxnE2Y7W9cT01VLU0FZ2VhDtG2occ7DhrdayaY7n1Ejf+LzVOyinQ4UAncWsVcbJU3D/4rbmuG7v04ggl+10l01vpwNCgD3NldtmSyKamBB8zMbRyd02oKAGN2W2UZuIARRvYGjAx7UDv1QTk8inhPXWAUUzYsHhR0LzhrpwSrwVKDJcYeSkZThISmkMAnKTI5af7hsSJbUcy4RyjNVgWFOOPCytOZQcooFvQ82L7x4SNWMuFsrZUhbhNK5RqJNRLNjJW8N7nPbSyFPQjbIdg7StQd1rOagr1M0Qhl+bgXXJYjWpiwuaEOIsMDnTPL13UGeNGku8XR7TNI7TrFGNe6sqK3IaMPOzVJOR0whEHN07asRh6Sc1LMWL0UgZJ9Y1dyt9Hm0yJKVYcDU0xInvC6/3oHHvnhr3Eoo6r+S8F+4dUnW/6RbSYSc5zYMrNe598qBxLw2sL/TAutrIUWyxVXBXKQ1ka+Ti4wbWcuT+Wo/cGQnTb157uKHXHjjN4WmYTSP3o3PP6z3qpYFf98xLA8CKSLR71yLskvoW+NKA2Ot4vd6jXnsASfxCrz0I+doDlDWplAEE/Vy99VAidXD7vRePfe1Bvbjxn9cPenEDNPNw/htePeG3vnrCf8urJ/LlmTnhaF6e4VZn5GhfQj+cf/XbOeb1n/+9OQcsR0Ld+whf//n2X2T5973+83+bg9kBB/U6mwAAAABJRU5ErkJggg==';
  /** 左上角雙 Logo 區塊（NMDC ENERGY ＋ 台電） */
  function logosHtml_(h) {
    h = h || 30;
    return '<div style="display:flex;align-items:center;gap:8px">' +
      '<img src="' + LOGO_NMDC + '" style="height:' + h + 'px">' +
      '<img src="' + LOGO_TPC + '" style="height:' + Math.round(h * 1.12) + 'px">' +
      '</div>';
  }

  var CHK = function (on) { return on ? '☑' : '☐'; };
  var YN = function (v) { return v === 'Y' ? '<b>☑ YES</b> &nbsp; ☐ NO' : (v === 'N' ? '☐ YES &nbsp; <b>☑ NO</b>' : '☐ YES &nbsp; ☐ NO'); };

  function css_(pageSize) {
    var isMain = /420mm/.test(pageSize);
    return '<style>' +
      '@page{size:' + pageSize + ';margin:6mm}' +
      'body{font-family:Arial,"Noto Sans CJK TC",sans-serif;font-size:' + (isMain ? '7.6pt' : '9pt') + ';color:#14202b;margin:0;line-height:' + (isMain ? '1.15' : '1.4') + '}' +
      'h1{font-size:' + (isMain ? '13pt' : '15pt') + ';margin:0;text-align:center;color:#0b3a5c;letter-spacing:.5px}' +
      '.hdr{border:2px solid #0b3a5c;padding:' + (isMain ? '2px 6px' : '5px 10px') + ';margin-bottom:' + (isMain ? '2px' : '5px') + ';display:flex;justify-content:space-between;align-items:center}' +
      'table{border-collapse:collapse;width:100%;margin-bottom:' + (isMain ? '2px' : '4px') + '}' +
      'td,th{border:1px solid #4a6a86;padding:' + (isMain ? '1.5px 3px' : '2.5px 5px') + ';vertical-align:top;line-height:' + (isMain ? '1.2' : '1.4') + '}' +
      'th{background:#dbe7f1;color:#0b3a5c;text-align:left}' +
      '.sec{background:#0b3a5c;color:#fff;font-weight:bold;padding:' + (isMain ? '1.5px 6px' : '3px 8px') + ';font-size:' + (isMain ? '8pt' : '9pt') + ';letter-spacing:.4px' + (isMain ? '' : ';border-radius:3px 3px 0 0') + '}' +
      '.cols3{columns:3;-webkit-columns:3}.cols2{columns:2;-webkit-columns:2}' +
      '.chk{break-inside:avoid;font-size:' + (isMain ? '7.2pt' : '8.5pt') + ';line-height:' + (isMain ? '1.3' : '1.55') + '}' +
      '.sig{height:' + (isMain ? '24px' : '30px') + '}.sig-cell{text-align:center}' +
      '.small{font-size:' + (isMain ? '6.8pt' : '7.5pt') + ';color:#333;line-height:1.2}' +
      '.foot{font-size:' + (isMain ? '6.6pt' : '7pt') + ';color:#5b7183;margin-top:4px;border-top:1px solid #b9cbd9;padding-top:2px}' +
      (isMain ? 'html,body{height:100%}' : '') +
      '</style>';
  }

  function esc_(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 簽名圖 inline base64（失敗回空） */
  function sigImg_(signatureId) {
    if (!signatureId) return '';
    try {
      var s = Repo.getById('PTW_Signatures', signatureId);
      if (!s || !s.signatureFileId || asBool_(s.isVoided)) return '';
      var bytes = DriveApp.getFileById(s.signatureFileId).getBlob().getBytes();
      return '<img class="sig" src="data:image/png;base64,' + Utilities.base64Encode(bytes) + '">';
    } catch (e) { return ''; }
  }

  /** QR Code（連至系統，開啟需登入＋權限） */
  function qrImg_(ptwId) {
    try {
      var url = (getProp_('FRONTEND_URL', true) || ScriptApp.getService().getUrl() || '') + '?ptw=' + ptwId;
      var png = UrlFetchApp.fetch('https://quickchart.io/qr?size=110&text=' + encodeURIComponent(url),
        { muteHttpExceptions: true });
      if (png.getResponseCode && png.getResponseCode() !== 200) return '';
      return '<img style="width:26mm;height:26mm" src="data:image/png;base64,' +
        Utilities.base64Encode(png.getContent ? png.getContent() : png.getBytes()) + '">';
    } catch (e) { return ''; }
  }

  function checksHtml_(defs, checks) {
    return '<div class="cols3">' + defs.map(function (d) {
      return '<div class="chk">' + CHK(checks[d[0]]) + ' ' + esc_(d[1]) + '</div>';
    }).join('') + '</div>';
  }

  /** 主表勾選群定義（與前端一致的精簡標籤） */
  var HZ = [['hzFallHeight','Fall From Height'],['hzLifting','Lifting'],['hzLineOfFire','Line of Fire'],
    ['hzMobileEquip','Mobile Equipment'],['hzHazEnergy','Hazardous Energy'],['hzOverWater','Over/Near Water'],
    ['hzExcavation','Excavation'],['hzDriving','Driving'],['hzConfinedSpace','Confined Space'],
    ['hzMovingMachinery','Moving Machinery'],['hzDroppedObject','Dropped Object'],['hzElectricity','Electricity'],
    ['hzFireExplosion','Fire/Explosion'],['hzNakedFlame','Naked Flame'],['hzSparks','Sparks'],
    ['hzGasCylinders','Gas Cylinders'],['hzUgCables','U.G. Cables'],['hzPressure','Pressure'],
    ['hzNoise','Noise'],['hzChemical','Chemical'],['hzSlipTrip','Slip/Trip/Fall'],
    ['hzSharpEdges','Sharp Edges'],['hzWeatherSea','Weather/Sea'],['hzRadiation','Radiation'],
    ['hzManOverboard','Man Overboard'],['hzSimops','SIMOPs'],['hzVesselMovement','Vessel Move/Anchor'],
    ['hzDivingOps','Diving Ops'],['hzNightWork','Night Work'],['hzHeatStress','Heat Stress'],
    ['hzFatigue','Fatigue'],['hzToxicGas','H2S / Toxic Gas']];
  var PS = [['psMechIso','Mech. Isolation'],['psSpadedBlinded','Spaded/Blinded'],['psElecIso','Elec. Isolation'],
    ['psDepressurised','Depressurised'],['psWatchman','Watchman'],['psGasFree','Gas Free'],
    ['psDrained','Drained'],['psInerted','Inerted'],['psVentilated','Ventilated'],
    ['psGasChecksDone','Gas Checks'],['psAreaClear','Area Clear'],
    ['psLinesFlushed','Lines Flushed'],['psValvesClosed','Valves Closed/Tagged'],
    ['psCommsEstablished','Comms Established'],['psWeatherChecked','Weather Checked'],
    ['psRescueStandby','Rescue Standby']];
  var CSSY = [['cssFireGasDetection','Fire & Gas Detection'],['cssFireWater','Fire Water System'],['cssAlarmPA','Alarm / PA System'],
    ['cssFixedFF','Fixed Fire Fighting'],['cssLifeSaving','Life Saving Equipment'],['cssEscapeBlocked','Escape Routes Blocked']];
  var PC = [['pcEyeProtection','Eye'],['pcHearing','Hearing'],['pcChemClothing','Chem. Clothing'],
    ['pcGloves','Gloves'],['pcFaceVisor','Face Visor'],['pcHarness','Harness'],
    ['pcLifeJacket','Life Jacket'],['pcRespiratory','Respiratory'],['pcScaffBarriers','Scaff. Barriers'],
    ['pcH2sTrained','H2S Trained'],['pcEscapeSets','Escape Sets'],['pcFullBA','Full BA'],
    ['pcAccessLimit','Access Limit'],['pcFireExt','Extinguisher'],['pcFireHose','Fire Hose'],
    ['pcWarningNotices','Warning Notices'],['pcLighting','Lighting'],['pcRadioChannel','Radio'],
    ['pcLoto','LOTO'],['pcGasDetection','Gas Detection'],['pcClearCombustibles','Clear Combustibles'],
    ['pcFireWatch','Fire Watch'],['pcFireBlanket','Fire Blanket'],['pcNonFerric','Non Ferric'],
    ['pcEnvProtection','Env. Protection'],['pcLiftingInspection','Lifting Insp.'],
    ['pcMobRescue','MOB Rescue'],['pcStandbyVessel','Standby Vessel'],
    ['pcDiveFlag','Diving Flag'],['pcSimopsCoord','SIMOPs Coord.'],
    ['pcHydration','Hydration/Heat'],['pcWorkRestCycle','Work/Rest Cycle']];
  var WT = [['wtHotWork','Hot Work'],['wtColdWork','Cold Work'],['wtDiving','Diving'],
    ['wtRadiography','Radiography'],['wtConfinedSpace','Confined Space'],
    ['wtElectricalIso','Electrical Iso']]; // Excavation 已自系統移除；Cold Work 免證書
  var DOCS = [['docJsaRa','JSA/RA'],['docMethodStatement','Method Statement']];

  /** 標籤只留英文（資料值不處理） */
  function en_(str) {
    var out = String(str || '').replace(/[\u4e00-\u9fff\u3000-\u303f]+/g, '')
      .replace(/（/g, '(').replace(/）/g, ')').replace(/：/g, ':')
      .replace(/，/g, ', ').replace(/、/g, ', ').replace(/；/g, '; ')
      .replace(/\(\s*[,;:\/\-\s]+/g, '(').replace(/[,;:\/\-\s]+\s*\)/g, ')')
      .replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim()
      .replace(/^[\/,:;·\-\s&]+/, '').replace(/[\/,:;·\-\s&]+$/, '').trim();
    return out || String(str || '');
  }

  /** QR：指向該 PTW 的 Drive 資料夾（公開連結，現場掃描免登入）。
   *  以內建 QRLib 產生（HTML 表格繪製，瀏覽器/html2canvas/GAS 轉換器皆可靠），不依賴外部 API。 */
  function qrTable_(url, sizePx) {
    var qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var n = qr.getModuleCount();
    var cell = Math.max(1, Math.floor((sizePx || 78) / n));
    var h = '<table style="border-collapse:collapse;margin:0 auto;border:3px solid #fff;background:#fff">';
    for (var r = 0; r < n; r++) {
      h += '<tr style="height:' + cell + 'px">';
      for (var c = 0; c < n; c++) {
        h += '<td style="width:' + cell + 'px;height:' + cell + 'px;padding:0;border:0;font-size:0;line-height:0;background:' +
          (qr.isDark(r, c) ? '#14202b' : '#fff') + '"></td>';
      }
      h += '</tr>';
    }
    return h + '</table>';
  }
  function folderQr_(m) {
    var url = '';
    try { url = DriveService.ptwFolderUrl(m); } catch (e) {}
    if (!url) { try { url = (getProp_('FRONTEND_URL', true) || ScriptApp.getService().getUrl() || '') + '?ptw=' + m.id; } catch (e) {} }
    if (!url) return { img: '', url: '' };
    try {
      // createDataURL：QRLib 內建 GIF 編碼（純 JS、無 canvas），影像連續無縫、掃描可靠
      var qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      var dataUrl = qr.createDataURL(6, 2);
      return { img: '<img src="' + dataUrl + '" style="width:78px;height:78px;image-rendering:pixelated">', url: url };
    } catch (e) { console.error('QR generate failed: ' + e.message); }
    // 備援：外部 QR API
    try {
      var api = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=0&data=' + encodeURIComponent(url);
      var res = UrlFetchApp.fetch(api, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        return { img: '<img src="data:image/png;base64,' + Utilities.base64Encode(res.getContent()) + '" style="width:82px;height:82px">', url: url };
      }
    } catch (e2) {}
    return { img: '', url: url };
  }

  /** ===== A4 現場聯 Site Copy（依用戶 mock 版面：圓角區塊、左上雙 Logo、QR 框） ===== */
  function siteCopyHtml_(m, ctx) {
    var qr = folderQr_(m);
    var d10 = function (v) { return esc_(String(v || '').substring(0, 10)); };
    var CB = function (b) { return '<span class="cb' + (b ? ' on' : '') + '">' + (b ? '&#10003;' : '&nbsp;') + '</span>'; };
    var YN2 = function (v) {
      return '<span style="white-space:nowrap">' + CB(v === 'Y') + ' YES&nbsp;&nbsp;' + CB(v === 'N') + ' NO</span>';
    };
    var byTier = {}; ctx.approvals.forEach(function (a) { if (a.action === 'Approve') byTier[a.tier] = a; });
    // Performing Authority：只列姓名（簽名圖只在 Review History）
    var nameLine = function (ids) {
      var names = ids.map(function (id) { return esc_(ctx.names[id] || ''); }).filter(Boolean);
      return names.join('&nbsp;·&nbsp;') || '&nbsp;';
    };
    var revRow = function (r) {
      return '<tr><td>' + esc_(r ? String(r.date || '').substring(0, 10) : '') + '</td><td></td><td></td>' +
        '<td></td><td></td><td></td></tr>';
    };
    var revs = ctx.revalidations || [];
    var revRows = '';
    for (var i = 0; i < 7; i++) revRows += revRow(revs[i]); // 至少留空 7 列手寫簽名

    var signRow = function (title, a) {
      return '<tr><td class="rhTitle">' + title + '</td>' +
        '<td>' + esc_(a ? a.reviewer : '') + '</td>' +
        '<td>' + esc_(a ? String(a.decidedAt).substring(0, 10) : '') + '</td>' +
        '<td>' + esc_(a ? String(a.decidedAt).substring(11, 16) : '') + '</td>' +
        '<td class="sig-cell">' + (a ? a.sigHtml : '') + '</td></tr>';
    };

    var h = '<html><head><meta charset="utf-8">' + siteCss_() + '</head><body>';

    // ===== 抬頭（圓角框：左雙 Logo、中標題+PERMIT VALID、右 QR 框）=====
    h += '<div class="box hdbox"><table class="bare"><tr>' +
      '<td style="width:120px;vertical-align:middle;padding:2px 4px">' +
        '<img src="' + LOGO_NMDC + '" style="height:24px;display:block;margin-bottom:6px">' +
        '<img src="' + LOGO_TPC + '" style="height:52px;display:block">' +
      '</td>' +
      '<td style="text-align:center;vertical-align:middle;padding:0 8px">' +
        '<div class="projzh">通霄電廠二期更新改建計畫海底輸氣管線統包工程</div>' +
        '<div class="projen">Subsea Gas Pipeline of Tung-Hsiao Power Plant 2nd Stage Renewal Project</div>' +
        '<div class="hdrule"></div>' +
        '<div class="doctitle">OFFSHORE PERMIT TO WORK</div>' +
        '<div class="validbar"><span class="vlabel">PERMIT VALID</span>' +
          '<span class="vdates">' + d10(m.validFrom) + ' &nbsp;~&nbsp; ' + d10(m.validTo) + '</span></div>' +
      '</td>' +
      '<td style="width:118px;vertical-align:middle"><div class="qrbox">' +
        '<div class="qrtxt">詳情請掃描 QR Code<br>For details, please<br>scan QR Code</div>' + qr.img +
      '</div></td>' +
      '</tr></table></div>';

    // ===== CERTIFICATE ＋ 基本資料 =====
    h += '<div class="box"><table class="grid">' +
      '<colgroup><col style="width:14%"><col style="width:16%"><col style="width:16%"><col style="width:54%"></colgroup><tr>' +
      '<th class="hdr" colspan="2">CERTIFICATE</th>' +
      '<th class="hdr">PTW NO.</th>' +
      '<td class="big">' + esc_(m.ptwNumber || m.tempNumber) + '</td></tr>' +
      '<tr><td class="ck">' + CB(asBool_(m.wtHotWork)) + ' Hot work</td><td class="ck">' + CB(asBool_(m.wtConfinedSpace)) + ' Confined space</td>' +
      '<th class="lbl">AREA / LOCATION</th><td>' + esc_(m.areaLocation) + '</td></tr>' +
      '<tr><td class="ck">' + CB(asBool_(m.wtDiving)) + ' Diving</td><td class="ck">' + CB(asBool_(m.wtRadiography)) + ' Radiography</td>' +
      '<th class="lbl">SUPPLIER NAME</th><td>' + esc_(ctx.companyName) + '</td></tr>' +
      '<tr><td class="ck">' + CB(asBool_(m.wtElectricalIso)) + ' Electrical Iso</td><td class="ck">' + CB(asBool_(m.wtColdWork)) + ' Cold work</td>' +
      '<th class="lbl">VESSEL</th><td>' + esc_(m.vessel) + '</td></tr></table></div>';

    // ===== 工作內容 =====
    h += '<div class="box"><table class="grid"><tr>' +
      '<th class="hdr" style="width:36%">WORK DESCRIPTION</th>' +
      '<th class="hdr" style="width:28%">TOOLS AND<br>EQUIPMENT TO BE USED</th>' +
      '<th class="hdr" style="width:18%">GAS TESTING<br>REQUIRED</th>' +
      '<th class="hdr" style="width:18%">SCAFFOLDING<br>REQUIRED?</th></tr>' +
      '<tr><td class="wrap">' + esc_(m.workDescription) + '</td>' +
      '<td class="wrap">' + esc_(m.toolsEquipment) + '</td>' +
      '<td style="text-align:center;vertical-align:middle">' + YN2(m.gasTestRequired) + '</td>' +
      '<td style="text-align:center;vertical-align:middle">' + YN2(m.scaffoldingRequired) + '</td></tr></table></div>';

    // ===== PERFORMING AUTHORITY =====
    h += '<div class="box"><div class="sec">PERFORMING AUTHORITY</div>' +
      '<table class="grid"><tr><th class="lbl" style="width:33%;text-align:center">APPLICANT</th>' +
      '<th class="lbl" style="width:34%;text-align:center">HOLDER</th>' +
      '<th class="lbl" style="width:33%;text-align:center">CO-HOLDER</th></tr>' +
      '<tr class="parow"><td style="text-align:center;font-weight:700">' + nameLine([m.applicantUserId]) + '</td>' +
      '<td style="text-align:center;font-weight:700">' + nameLine(idList__(m.holderUserId)) + '</td>' +
      '<td style="text-align:center;font-weight:700">' + nameLine(idList__(m.coHolderUserId)) + '</td></tr></table></div>';

    // ===== RE-VALIDATION（7 列大格手寫）=====
    h += '<div class="box"><div class="sec">RE-VALIDATION <span class="note">(NOTE: EVERY SHIFT NEEDS TO BE RE-VALIDATED BEFORE PROCEEDING WITH THE WORK)</span></div>' +
      '<table class="grid rv"><tr>' +
      '<th class="lbl" style="width:15%;text-align:center">DATE /<br>TIME</th><th class="lbl" style="width:17%;text-align:center">EHS</th>' +
      '<th class="lbl" style="width:18%;text-align:center">SUPERVISOR</th>' +
      '<th class="lbl" style="width:15%;text-align:center">DATE /<br>TIME</th><th class="lbl" style="width:17%;text-align:center">EHS</th>' +
      '<th class="lbl" style="width:18%;text-align:center">SUPERVISOR</th></tr>' +
      revRows + '</table></div>';

    // ===== REVIEW HISTORY =====
    h += '<div class="box"><div class="sec">REVIEW HISTORY</div>' +
      '<table class="grid rh"><tr><th class="lbl" style="width:22%;text-align:center">TITLE</th>' +
      '<th class="lbl" style="width:28%;text-align:center">NAME</th>' +
      '<th class="lbl" style="width:16%;text-align:center">DATE</th><th class="lbl" style="width:12%;text-align:center">TIME</th>' +
      '<th class="lbl" style="width:22%;text-align:center">SIGNATURE</th></tr>' +
      (function () {
        var appAt = m.submittedAt || m.createdAt;
        return '<tr><td class="rhTitle">Supplier applicant</td>' +
          '<td>' + esc_(ctx.names[m.applicantUserId] || '') + '</td>' +
          '<td>' + esc_(String(appAt).substring(0, 10)) + '</td><td>' + esc_(String(appAt).substring(11, 16)) + '</td>' +
          '<td class="sig-cell">' + accSig_(ctx, m.applicantUserId) + '</td></tr>';
      })() +
      signRow('Supplier EHS', byTier[2]) +
      signRow('NMDC engineer', byTier[3]) +
      signRow('NMDC EHS', byTier[4]) +
      signRow('NMDC PTW coord.', byTier[5]) +
      '</table></div>';

    h += '<div class="box notes"><div class="nsec">NOTES</div><ol>' +
      '<li>This site copy must be displayed at the worksite for the duration of the work; the permit is invalid if not displayed.</li>' +
      '<li>Re-validation above must be completed and signed before work starts on every shift.</li>' +
      '<li>Stop work immediately and notify EHS if work conditions change or any abnormality occurs.</li>' +
      '<li>Anyone may stop the work upon observing an unsafe condition (Stop Work Authority).</li>' +
      '<li>Scan the QR code (top right) for the full permit, certificates and attachments.</li>' +
      '</ol></div>' +
      '<div class="foot"><span style="float:right">' + esc_(m.ptwNumber || m.tempNumber) + ' · v' + esc_(m.version) +
      ' · generated ' + fmtDateTime_() + ' (Asia/Taipei)</span></div>';
    return h + '</body></html>';
  }

  function idList__(v) {
    var raw = String(v || '');
    if (!raw) return [];
    if (raw.charAt(0) === '[') { try { return JSON.parse(raw) || []; } catch (e) { return []; } }
    return [raw];
  }

  function siteCss_() {
    // 依用戶 mock：圓角區塊、深藍標題列、淺藍灰標籤列、方框勾選
    return '<style>' +
      '@page{size:210mm 297mm;margin:6mm}' +
      'body{font-family:"Arial Narrow",Arial,Helvetica,"Noto Sans CJK TC",sans-serif;font-size:9pt;line-height:1.3;color:#0e2a47;margin:0}' +
      '.box{border:2px solid #0b3a5c;border-radius:10px;overflow:hidden;margin-bottom:4px;background:#fff}' +
      'table{border-collapse:collapse;width:100%;table-layout:fixed}' +
      'table.bare td{border:0;padding:0}' +
      '.grid td,.grid th{border:1px solid #6d87a3;padding:3px 6px;vertical-align:middle;word-wrap:break-word}' +
      '.grid tr td:first-child,.grid tr th:first-child{border-left:0}' +
      '.grid tr td:last-child,.grid tr th:last-child{border-right:0}' +
      '.grid tr:first-child td,.grid tr:first-child th{border-top:0}' +
      '.grid tr:last-child td,.grid tr:last-child th{border-bottom:0}' +
      '.hdbox{padding:6px 8px;background:#f4f8fc}' +
      '.hdrule{height:1.5px;background:#0b3a5c;opacity:.25;width:88%;margin:3px auto}' +
      '.projzh{font-size:11.5pt;font-weight:700;color:#0b3a5c;letter-spacing:2px}' +
      '.projen{font-size:8pt;font-weight:600;color:#4a6076;margin-top:1px;letter-spacing:.3px}' +
      '.doctitle{white-space:nowrap;font-size:17pt;font-weight:800;letter-spacing:3px;color:#0b3a5c;font-family:"Arial Narrow",Arial,sans-serif;margin:1px 0 3px}' +
      '.validbar{display:inline-block;background:#0b3a5c;color:#fff;border-radius:20px;padding:4px 22px;text-align:center;margin-top:1px;border:1.5px solid #ffd400}' +
      '.validbar .vlabel{color:#ffd400;font-size:10pt;font-weight:800;letter-spacing:2px;margin-right:14px}' +
      '.validbar .vdates{font-size:12pt;font-weight:800;letter-spacing:1px}' +
      '.qrbox{border:1.5px solid #0b3a5c;border-radius:8px;padding:4px;text-align:center;background:#fff}' +
      '.qrbox img{width:64px;height:64px}' +
      '.qrbox table{margin:0 auto!important}' +
      '.qrtxt{font-size:6.8pt;font-weight:700;color:#12233a;line-height:1.25;margin-bottom:3px}' +
      '.sec{background:#0b3a5c;color:#fff;font-weight:700;font-size:9.5pt;letter-spacing:.6px;padding:4px 10px}' +
      '.sec .note{font-weight:700;font-size:7.5pt;opacity:.95}' +
      '.hdr{background:#0b3a5c;color:#fff;text-align:center;font-weight:700;font-size:9pt;letter-spacing:.4px}' +
      '.lbl{background:#dde4ee;color:#0e2a47;font-weight:700;font-size:8.5pt;letter-spacing:.3px}' +
      '.big{font-size:13pt;font-weight:800;color:#0b3a5c;letter-spacing:.5px}' +
      '.ck{font-size:8pt;font-weight:600;white-space:nowrap;overflow:hidden;padding-left:4px}' +
      '.cb{display:inline-block;width:11px;height:11px;border:1.5px solid #0e2a47;border-radius:2px;' +
        'text-align:center;line-height:11px;font-size:9px;vertical-align:-1px;margin-right:4px}' +
      '.cb.on{background:#0b3a5c;color:#fff;border-color:#0b3a5c}' +
      '.wrap{white-space:pre-wrap;line-height:1.35;height:52px;font-size:8.5pt;vertical-align:top}' +
      '.parow td{height:22px}' +
      '.rv td{height:23px}' + // 手寫簽名列
      '.rh td{height:16px;font-size:7.5pt;padding:1px 5px}' +
      '.rhTitle{font-weight:700;background:#f2f5fa;font-size:7.5pt}' +
      '.sig-cell{text-align:center;vertical-align:middle}' +
      '.sig-cell img,.sig{max-height:14px;max-width:90px}' +
      '.notes{padding:0 0 3px;border-color:#d9534f}' +
      '.nsec{background:#d9534f;color:#fff;font-weight:700;font-size:8pt;letter-spacing:.8px;padding:2px 10px}' +
      '.notes ol{margin:3px 0 0 20px;padding:0}' +
      '.notes li{font-size:7.2pt;color:#c0504d;line-height:1.4;margin-bottom:1px;font-weight:600}' +
      '.foot{font-size:6.5pt;color:#5b7183;padding-top:0;line-height:1.1}' +
      '</style>';
  }

  /** 主表 A3 HTML — 版面依原始 Excel「0. 主表 PTW sheet」編排 */
  function mainHtml_(m, ctx) {
    var checks = {}; try { checks = JSON.parse(m.checksJson || '{}'); } catch (e) {}
    var docs = {}; try { docs = JSON.parse(m.docChecksJson || '{}'); } catch (e) {}
    var wtChecks = {}; WT.forEach(function (d) { wtChecks[d[0]] = asBool_(m[d[0]]); });
    var d10 = function (v) { return esc_(String(v || '').substring(0, 10)); };

    // 簽核資訊分派（依 Excel 簽核區）：T2=執行單位工安、T3=施工部門主管、T4=HSE、T5=協調員
    var byTier = {};
    ctx.approvals.forEach(function (a) { if (a.action === 'Approve') byTier[a.tier] = a; });
    var signRow = function (label, a, docCheck) {
      return '<tr><td style="width:26%">' + label + '</td>' +
        '<td style="width:24%">' + (a ? esc_(a.reviewer) : '') + '</td>' +
        '<td style="width:16%">' + (a ? esc_(String(a.decidedAt).substring(0, 10)) : '') + '</td>' +
        '<td style="width:10%">' + (a ? esc_(String(a.decidedAt).substring(11, 16)) : '') + '</td>' +
        '<td style="width:16%">' + (a ? a.sigHtml : '') + '</td>' +
        '<td style="width:8%;font-size:6.5pt">' + (docCheck || '') + '</td></tr>';
    };

    var h = '<html><head><meta charset="utf-8">' + css_('420mm 297mm') + '</head><body>';
    // ===== 表頭（同 Excel 首列）=====
    h += '<table style="margin-bottom:2px"><tr>' +
      '<td style="width:46%;border:2px solid #0b3a5c;padding:2px 6px;vertical-align:middle">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<img src="' + LOGO_NMDC + '" style="height:20px"><img src="' + LOGO_TPC + '" style="height:26px">' +
      '<div style="flex:1;text-align:center"><h1>WORK PERMIT</h1>' +
      '<div class="small">Tung-Hsiao Power Plant 2nd Stage Renewal Project — Subsea Gas Pipeline · Proj.No P2913</div></div></div></td>' +
      '<td style="width:27%;border:2px solid #000"><b>PTW Number :</b><br>' +
      '<span style="font-size:13pt;font-weight:bold">' + esc_(m.ptwNumber || m.tempNumber) + '</span>' +
      '<div class="small">CONTINUATION OF PERMIT No: ' + esc_(m.continuationOfPermitNo || '—') + '</div>' +
      '<div class="small">Date: ' + d10(m.executionDate) + ' · v' + esc_(m.version) + ' · ' + esc_(m.status) + '</div></td>' +
      '<td style="width:27%;border:2px solid #000;text-align:center"><b>AUTHORIZED GAS TESTER<br></b><br>' + ctx.qr + '</td></tr></table>';

    // ===== 作業類型（Excel J6–AA7）＋ 基本資訊 =====
    h += '<table><tr>' +
      '<td style="width:46%"><div class="cols2">' + WT.map(function (d) {
        var code = { wtHotWork: 'HW', wtColdWork: 'GW', wtDiving: 'DO', wtRadiography: 'RG',
          wtConfinedSpace: 'CS', wtExcavation: 'EC', wtElectricalIso: 'EI' }[d[0]];
        var cert = ctx.certs[code];
        return '<div class="chk">' + CHK(wtChecks[d[0]]) + ' ' + esc_(d[1]) +
          (cert ? ' <b>[' + esc_(cert.certNo) + ']</b>' : '') + '</div>';
      }).join('') + '</div></td>' +
      '<td style="width:27%"><b>Area / Location:</b><br>' + esc_(m.areaLocation) + '</td>' +
      '<td style="width:27%"><b>Company Name:</b> ' + esc_(ctx.companyName) +
      '<br><b>Vessel:</b> ' + esc_(m.vessel) + '</td></tr></table>';

    // ===== 左右兩欄主體（左 60% / 右 40%，同 Excel 配置）=====
    h += '<table style="border:0"><tr><td style="width:60%;border:0;padding:0;vertical-align:top">';

    // --- 左欄 ---
    h += '<div class="sec">PERMIT INFORMATION </div>' +
      '<table><tr><th style="width:50%">DESCRIPTION OF WORK TO BE PERFORMED </th>' +
      '<th>TOOLS AND EQUIPMENT TO BE USED </th></tr>' +
      '<tr><td style="height:34px">' + esc_(m.workDescription) + '</td><td>' + esc_(m.toolsEquipment) + '</td></tr></table>' +
      '<table><tr><th>Permit Valid</th><td>From: ' + d10(m.validFrom) + ' &nbsp;→&nbsp; To: ' + d10(m.validTo) + '</td>' +
      '<th>SCAFFOLDING REQUIRED ?</th><td>' + YN(m.scaffoldingRequired) + '</td></tr></table>';

    h += '<div class="sec">HAZARD IDENTIFICATION — HAZARDS IDENTIFIED </div>' +
      checksHtml_(HZ, checks) +
      (m.hzOthers ? '<div class="small">Others: ' + esc_(m.hzOthers) + '</div>' : '');

    h += '<div class="sec">CRITICAL &amp; SAFETY SYSTEMS ISOLATION — REQUIRED? ' + YN(m.cssIsoRequired) + '</div>' +
      checksHtml_(CSSY, checks) +
      (m.cssOthers ? '<div class="small">Others: ' + esc_(m.cssOthers) + '</div>' : '');

    h += '<div class="sec">PRECAUTIONS TO BE TAKEN </div>' +
      checksHtml_(PC, checks) +
      (m.pcOthers ? '<div class="small">Others: ' + esc_(m.pcOthers) + '</div>' : '');

    h += '<div class="sec">COMPLEMENTARY CERTIFICATES </div>' +
      '<div class="cols3">' + WT.filter(function (d) {
        var code = { wtHotWork: 'HW', wtColdWork: 'GW', wtDiving: 'DO', wtRadiography: 'RG',
          wtConfinedSpace: 'CS', wtExcavation: 'EC', wtElectricalIso: 'EI' }[d[0]];
        return !(CFG.CERT_TYPES[code] && CFG.CERT_TYPES[code].noCert); // Cold Work 免證書不列
      }).map(function (d) {
        var code = { wtHotWork: 'HW', wtColdWork: 'GW', wtDiving: 'DO', wtRadiography: 'RG',
          wtConfinedSpace: 'CS', wtExcavation: 'EC', wtElectricalIso: 'EI' }[d[0]];
        var cert = ctx.certs[code];
        return '<div class="chk">' + CHK(!!cert) + ' ' + esc_(d[1]) + ' — No. ' +
          (cert ? '<b>' + esc_(cert.certNo) + '</b>' : '＿＿＿＿＿') + '</div>';
      }).join('') + '</div>';

    h += '<div class="sec">REQUIRED SUPPORTING DOCUMENTS </div>' +
      checksHtml_(DOCS, docs);

    // 執行單位工安（T2）
    h += '<div class="sec">PERFORMING AUTHORITY HSE </div>' +
      '<table><tr><th>Name </th><th>Date </th><th>Time </th><th>Signature </th></tr>' +
      (function () { var a = byTier[2];
        return '<tr><td>' + (a ? esc_(a.reviewer) : '') + '</td><td>' + (a ? esc_(String(a.decidedAt).substring(0, 10)) : '') +
          '</td><td>' + (a ? esc_(String(a.decidedAt).substring(11, 16)) : '') + '</td><td class="sig-cell">' + (a ? a.sigHtml : '') + '</td></tr>'; })() +
      '</table>' +
      '<div class="small" style="border:1px solid #555;padding:3px">' + CHK(asBool_(m.paDeclarationAccepted)) + ' ' +
      'I, the Performing Authority, understand the precautions to be undertaken and fully accept the responsibility to carry out the job in the safest manner and that this permit is valid only as long as the terms and conditions are maintained.</div>' +
      '<table><tr><th>Applicant </th><th>Holder </th><th>Co-Holder(s) </th></tr>' +
      '<tr><td>' + nameSig_(ctx, m.applicantUserId) +
      '</td><td>' + (idList__(m.holderUserId).map(function (x) { return nameSig_(ctx, x); }).join('') || '—') +
      '</td><td>' + coHolderSigs_(m, ctx) + '</td></tr></table>';

    h += '</td><td style="width:40%;border:0;padding:0 0 0 4px;vertical-align:top">';

    // --- 右欄（同 Excel 右側）---
    h += '<div class="sec">GAS TEST Required :' + YN(m.gasTestRequired) + '</div>' +
      '<table><tr><th>O2<br></th><th>LEL<br></th><th>H2S<br></th><th>CO<br></th><th>H2<br></th><th>Tester Name<br></th><th>Signature<br></th><th>Date<br></th><th>Time<br></th></tr>' +
      '<tr><td style="height:16px"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>' +
      '<tr><td style="height:16px"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>' +
      '<tr><td style="height:16px"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>' +
      (asBool_(m.wtHotWork) || asBool_(m.wtConfinedSpace)
        ? '<div class="small" style="color:#900">⚠ Hot Work / Confined Space: gas monitoring &amp; entry/exit logs — see attachments.</div>' : '');

    h += '<div class="sec">PLANT STATUS REQUIRED </div>' +
      '<div class="cols2">' + PS.map(function (d) {
        return '<div class="chk">' + CHK(checks[d[0]]) + ' ' + esc_(d[1]) + '</div>';
      }).join('') + '</div>' +
      (m.psOthers ? '<div class="small">Others: ' + esc_(m.psOthers) + '</div>' : '');

    // REVALIDATION 重新驗證（Excel BB36 區塊；自動驗證欄位）
    h += '<div class="sec">REVALIDATION </div>' +
      '<table><tr><th>Performing Authority<br></th><th>Date<br></th><th>From<br></th><th>To<br></th>' +
      '<th>Discipline supervisor<br></th><th>HSE<br></th></tr>' +
      ctx.revalidations.map(function (r) {
        return '<tr><td>' + (nameSig_(ctx, r.paUserId) || nameSig_(ctx, idList__(m.holderUserId)[0])) + '</td><td>' + esc_(r.date) +
          '</td><td>' + esc_(String(r.fromTime || '').substring(0, 10)) + '</td><td>' + esc_(String(r.newValidTo || r.toTime || '').substring(0, 10)) +
          '</td><td></td><td></td></tr>';
      }).join('') +
      '<tr><td style="height:15px"></td><td></td><td></td><td></td><td></td><td></td></tr>' +
      '<tr><td style="height:15px"></td><td></td><td></td><td></td><td></td><td></td></tr></table>';

    // REVALIDATION and ISSUING AUTHORITY 簽核區（T3/T4/T5）
    h += '<div class="sec">REVALIDATION and ISSUING AUTHORITY </div>' +
      '<table><tr><th> Role</th><th>Name </th><th>Date </th><th>Time </th><th>Signature </th><th>Check<br></th></tr>' +
      signRow('Discipline supervisor', byTier[3], '') +
      signRow('HSE', byTier[4], 'RA/JSA') +
      signRow('PTW coordinator', byTier[5], '') +
      '</table>';

    // WORK COMPLETION（Excel AW63）
    h += '<div class="sec">WORK COMPLETION </div>' +
      '<div class="small" style="border:1px solid #555;padding:3px">' + CHK(asBool_(m.wcDeclarationAccepted)) + ' ' +
      'I hereby declare that the work detailed in this permit has been completed / stopped in a safe condition.' +
      (m.closedAt ? 'Closed: ' + esc_(m.closedAt) : '') + '</div>' +
      '<table><tr><th>Holder </th><th>NMDC Engineer </th></tr>' +
      '<tr><td style="height:26px">' + (idList__(m.holderUserId).map(function (x) { return nameSig_(ctx, x); }).join('') || '') + '</td><td></td></tr></table>';

    h += '</td></tr></table>';

    h += '<div class="foot">DISTRIBUTION: Original — kept in the PTW Coordinator\u2019s folder ｜ Copy — posted on site by the Work Permit Holder · ' +
      'System generated ' + fmtDateTime_() + ' (Asia/Taipei) · Offshore PTW System · v' + esc_(m.version) + '</div>';
    return h + '</body></html>';
  }

  /** 證書欄位自動帶入主表（與前端 certAutoVal 同規則；PDF 一律以主表為準） */
  /** 使用者帳號簽名檔 → <img>（每次匯出以 ctx 快取） */
  function accSig_(ctx, userId) {
    if (!userId) return '';
    ctx._accSig = ctx._accSig || {};
    if (ctx._accSig[userId] !== undefined) return ctx._accSig[userId];
    var html = '';
    try {
      var u = Repo.getById('Users', userId);
      if (u && u.signatureFileId) {
        var b64 = DriveService.getSignatureBase64(u.signatureFileId);
        if (b64) html = '<img src="data:image/png;base64,' + b64 + '" style="max-height:22px;max-width:110px;display:block;margin:1px auto 0">';
      }
    } catch (e) {}
    ctx._accSig[userId] = html;
    return html;
  }
  /** 姓名＋簽名檔（人名處一律附上簽名圖） */
  function nameSig_(ctx, userId) {
    if (!userId) return '';
    return '<div style="text-align:center">' + esc_(ctx.names[userId] || '') + accSig_(ctx, userId) + '</div>';
  }

  /** 副持有人（JSON 陣列或單一 id）→ 名單字串 */
  function coHolderIds_(m) {
    var raw = String(m.coHolderUserId || '');
    if (!raw) return [];
    if (raw.charAt(0) === '[') { try { return JSON.parse(raw); } catch (e) { return []; } }
    return [raw];
  }
  function coHolderNames_(m, ctx) {
    return coHolderIds_(m).map(function (id) { return ctx.names[id] || ''; }).filter(Boolean).join('');
  }
  /** 副持有人 姓名＋簽名（多人並列） */
  function coHolderSigs_(m, ctx) {
    var ids = coHolderIds_(m);
    if (!ids.length) return '—';
    return ids.map(function (id) { return nameSig_(ctx, id); }).join('');
  }

  function certAuto_(m, ctx, id) {
    if (/_date$/.test(id)) return m.executionDate || '';
    if (/_area$/.test(id)) return m.areaLocation || '';
    if (/_location$/.test(id)) return m.areaLocation || '';
    if (/_workDescription$/.test(id)) return m.workDescription || '';
    if (/_duration$/.test(id)) return (m.validFrom && m.validTo) ? (m.validFrom + ' → ' + m.validTo) : '';
    if (/_paName$/.test(id)) {
      var hs = idList__(m.holderUserId).map(function (x) { return ctx.names[x] || ''; }).filter(Boolean);
      return hs.join(' / ');
    }
    if (/_paTitle$/.test(id)) return ctx.titles[idList__(m.holderUserId)[0]] || '';
    if (id === 'div_applicantName') return ctx.names[m.applicantUserId] || '';
    if (id === 'div_applicantTitle') return ctx.titles[m.applicantUserId] || '';
    if (id === 'div_vessel') return m.vessel || '';
    if (id === 'div_startDateTime') return m.validFrom || '';
    if (id === 'div_workNature') return m.workDescription || '';
    if (id === 'rac_company' || id === 'div_company') return ctx.companyName || '';
    return null;
  }

  /** 證書 A4 HTML（資料驅動：CERT_FIELD_DEFS） */
  function certHtml_(m, certType, cert, data, ctx) {
    var def = CERT_FIELD_DEFS[certType];
    var t = CFG.CERT_TYPES[certType];
    var h = '<html><head><meta charset="utf-8">' + css_('A4 portrait') + '</head><body>';
    h += '<div class="hdr">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<img src="' + LOGO_NMDC + '" style="height:24px"><img src="' + LOGO_TPC + '" style="height:30px"></div>' +
      '<div style="text-align:center;flex:1;padding:0 8px"><h1>' + esc_(t.nameEn.toUpperCase()) + '</h1>' +
      '<div class="small">Tung-Hsiao Power Plant 2nd Stage Renewal Project — Subsea Gas Pipeline · Proj.No P2913</div></div>' +
      '<div style="text-align:right"><b style="font-size:13pt;color:#0b3a5c">' + esc_(cert.certNo) + '</b>' +
      '<div class="small">MAIN PERMIT: ' + esc_(m.ptwNumber || m.tempNumber) + '</div>' +
      '<div class="small">Status: ' + esc_(cert.status) + '</div></div></div>';
    def.sections.forEach(function (sec) {
      h += '<div class="sec">' + esc_(en_(sec.t)) + '</div><table>';
      sec.f.forEach(function (f) {
        var id = f[0], label = f[1], type = f[2], v = data[id];
        var auto = certAuto_(m, ctx, id);
        if (auto !== null) v = auto; // 自動欄位一律以主表為準
        var disp;
        if (type === 'yn') disp = YN(v);
        else if (type === 'c') disp = CHK(!!v);
        else disp = esc_(v || '');
        // 人名欄位附上簽名檔圖片
        if (/_paName$/.test(id)) {
          var hsig = idList__(m.holderUserId).map(function (x) { return nameSig_(ctx, x); }).join('');
          if (hsig) disp = hsig;
        } else if (id === 'div_applicantName') {
          disp = nameSig_(ctx, m.applicantUserId) || disp;
        }
        h += '<tr><th style="width:55%">' + esc_(en_(label)) + '</th><td>' + disp + '</td></tr>';
      });
      h += '</table>';
    });
    h += '<div class="foot">This certificate is valid only together with main permit ' + esc_(m.ptwNumber || m.tempNumber) +
      '<span style="float:right">System generated ' + fmtDateTime_() + ' (Asia/Taipei) · v' + esc_(m.version) + '</span></div>';
    return h + '</body></html>';
  }

  function toPdf_(html, name) {
    return Utilities.newBlob(html, 'text/html', name + '.html').getAs('application/pdf').setName(name + '.pdf');
  }

  /** 匯出用 ctx（公司/人名/簽核/證書/展延） */
  function buildCtx_(m) {
    var company = Repo.getById('Companies', m.companyId);
    var names = {}, titles = {};
    Repo.readAll('Users').forEach(function (u) {
      var en = u.nameEn || '', zh = u.nameZh || '';
      names[u.id] = (zh && zh !== en) ? (en + ' / ' + zh) : (en || zh);
      titles[u.id] = u.title || '';
    });
    var approvals = Repo.find('PTW_Approvals', function (a) { return a.ptwId === m.id; });
    approvals.sort(function (a, b) { return a.decidedAt < b.decidedAt ? -1 : 1; });
    var TIER_NAMES = { 2: 'Contractor HSE 承商工安', 3: 'NMDC Construction 施工部門',
      4: 'NMDC HSE 環安衛', 5: 'PTW Coordinator 協調員' };
    var ctx = {
      companyName: companyLabel_(company),
      names: names, titles: titles,
      qr: folderQr_(m).img || qrImg_(m.id), // QR 一律指向該 PTW 的 Drive 資料夾（無資料夾時回退系統連結）
      certs: {},
      approvals: approvals.map(function (a) {
        return { tier: a.tier, tierName: TIER_NAMES[a.tier] || '', reviewer: names[a.reviewerUserId] || '',
          action: a.action, returnReason: a.returnReason, comment: a.comment, decidedAt: a.decidedAt,
          sigHtml: sigImg_(a.signatureId) };
      })
    };
    var certRows = Repo.find('PTW_Certificates', function (c) { return c.ptwId === m.id && asBool_(c.isActive); });
    certRows.forEach(function (c) { ctx.certs[c.certType] = c; });
    ctx.certRows = certRows;
    ctx.revalidations = Repo.find('PTW_Revalidations', function (r) { return r.ptwId === m.id && asBool_(r.isActive); });
    ctx.revalidations.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    return ctx;
  }

  var PDF_READY_STATUSES = function () {
    var S = CFG.STATUS;
    return [S.APPROVED, S.ACTIVE, S.EXTENDED, S.SUSPENDED, S.WORK_COMPLETED, S.PENDING_CLOSEOUT, S.CLOSED];
  };

  /** 現場聯 HTML（前端以瀏覽器引擎轉 PDF，確保與樣張一致） */
  function siteHtml(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = Repo.getById('PTW_Master', payload.ptwId);
    if (!m || !asBool_(m.isActive)) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    SecurityService.assertCanViewPtw(user, m);
    if (PDF_READY_STATUSES().indexOf(m.status) < 0) {
      throw ApiError_('BAD_STATE',
        'PDF downloads are available only after final (Tier 5) approval',
        'PDF 下載須待 Tier 5 核准簽發後才可使用');
    }
    var ctx = buildCtx_(m);
    var num = m.ptwNumber || m.tempNumber;
    return ok_({ html: siteCopyHtml_(m, ctx), fileName: num + '_SiteCopy_A4.pdf' });
  }

  /** T5 核發時：審核歷程 PDF 存入 04_Approval_Records */
  function saveApprovalRecord(m) {
    var ctx = buildCtx_(m);
    var num = m.ptwNumber || m.tempNumber;
    var byTier = {}; ctx.approvals.forEach(function (a) { if (a.action === 'Approve') byTier[a.tier] = a; });
    var row = function (title, a) {
      return '<tr><td><b>' + title + '</b></td><td>' + esc_(a ? a.reviewer : '') + '</td>' +
        '<td>' + esc_(a ? String(a.decidedAt).substring(0, 16) : '') + '</td>' +
        '<td>' + (a ? a.sigHtml : '') + '</td>' +
        '<td>' + esc_(a ? (a.comment || '') : '') + '</td></tr>';
    };
    var h = '<html><head><meta charset="utf-8">' + css_('A4 portrait') + '</head><body>' +
      '<div class="hdr"><h1>APPROVAL RECORD 審核歷程</h1>' +
      '<div style="text-align:right"><b style="font-size:13pt">' + esc_(num) + '</b>' +
      '<div class="small">Issued: ' + esc_(String(m.approvedAt || '').substring(0, 16)) + '</div></div></div>' +
      '<table><tr><th>Role</th><th>Name</th><th>Date / Time</th><th>Signature</th><th>Comment</th></tr>' +
      '<tr><td><b>Applicant 申請人</b></td><td>' + esc_(ctx.names[m.applicantUserId] || '') + '</td>' +
      '<td>' + esc_(String(m.submittedAt || m.createdAt).substring(0, 16)) + '</td>' +
      '<td>' + accSig_(ctx, m.applicantUserId) + '</td><td></td></tr>' +
      row('Contractor HSE 承商工安 (T2)', byTier[2]) +
      row('NMDC Engineering 施工部門 (T3)', byTier[3]) +
      row('NMDC EHS 環安衛 (T4)', byTier[4]) +
      row('PTW Coordinator 協調員 (T5)', byTier[5]) +
      '</table>' +
      '<div class="small" style="margin-top:6px">Full review history 完整歷程：</div>' +
      '<table><tr><th>Time</th><th>Tier</th><th>Reviewer</th><th>Action</th><th>Comment</th></tr>' +
      ctx.approvals.map(function (a) {
        return '<tr><td class="small">' + esc_(String(a.decidedAt).substring(0, 16)) + '</td><td>T' + esc_(a.tier) + '</td>' +
          '<td>' + esc_(a.reviewer) + '</td><td>' + esc_(a.action) + '</td><td class="small">' + esc_(a.comment || '') + '</td></tr>';
      }).join('') + '</table>' +
      '<div class="foot">System generated ' + fmtDateTime_() + ' (Asia/Taipei) · ' + esc_(num) + '</div></body></html>';
    var blob = toPdf_(h, num + '_ApprovalRecord');
    DriveService.savePtwFile(m, '04_Approval_Records', blob);
  }

  /** 匯出：主表 A3 + 已建立證書各一份 A4 */
  function exportPdf(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = Repo.getById('PTW_Master', payload.ptwId);
    if (!m || !asBool_(m.isActive)) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    SecurityService.assertCanViewPtw(user, m);
    var ctx = buildCtx_(m);
    var certRows = ctx.certRows;

    var files = [];
    var num = m.ptwNumber || m.tempNumber;
    var kind = (payload.kind || 'all');   // site | main | certs | all
    // 現場聯／完整主表／證書：一律 Tier 5 核准簽發後才可輸出
    var approvedReady = PDF_READY_STATUSES().indexOf(m.status) >= 0;
    if (!approvedReady) {
      throw ApiError_('BAD_STATE',
        'PDF downloads are available only after final (Tier 5) approval',
        'PDF 下載（現場聯／完整主表／證書）須待 Tier 5 核准簽發後才可使用');
    }
    if (kind === 'site' || kind === 'all') {
      files.push({ blob: toPdf_(siteCopyHtml_(m, ctx), num + '_SiteCopy_A4'), cat: 'Approval' });
    }
    if (kind === 'main' || kind === 'all') {
      files.push({ blob: toPdf_(mainHtml_(m, ctx), num + '_FullPermit_A3'), cat: 'Approval' });
    }
    if (kind === 'certs' || kind === 'all') {
      certRows.forEach(function (c) {
        var t = CFG.CERT_TYPES[c.certType];
        var row = Repo.findOne(t.sheet, function (r) { return r.certificateId === c.id && asBool_(r.isActive); });
        var data = {}; try { data = JSON.parse((row && row.dataJson) || '{}'); } catch (e) {}
        files.push({ blob: toPdf_(certHtml_(m, c.certType, c, data, ctx), num + '_' + c.certNo + '_A4'), cat: 'Certificates' });
      });
    }

    // 存 Drive（失敗不中斷下載）
    try {
      var folderMap = { Approval: '01_Application', Certificates: '02_Certificates' }; // Site Copy/主表 → 01
      var root = DriveApp.getFolderById(getProp_('DRIVE_ROOT_FOLDER_ID'));
      if (m.driveFolderId) {
        var pf = DriveApp.getFolderById(m.driveFolderId);
        files.forEach(function (f) {
          var it = pf.getFoldersByName(folderMap[f.cat]);
          (it.hasNext() ? it.next() : pf.createFolder(folderMap[f.cat])).createFile(f.blob);
        });
      }
    } catch (e) { console.error('PDF drive save failed: ' + e.message); }

    AuditService.log({ user: user, actionType: 'PTW_EXPORT_PDF', entityType: 'PTW', entityId: m.id,
      ptwNumber: num, newValue: { files: files.length }, success: true });
    return ok_({
      folderUrl: (function () { try { return DriveService.ptwFolderUrl(m); } catch (e) { return ''; } })(),
      files: files.map(function (f) {
        return { fileName: f.blob.getName(), mimeType: 'application/pdf',
          base64: Utilities.base64Encode(f.blob.getBytes()) };
      })
    });
  }

  return { exportPdf: exportPdf, siteHtml: siteHtml, saveApprovalRecord: saveApprovalRecord };
})();

/* ============================== CloseoutRules.gs ============================== */
/**
 * CloseoutRules.gs — 關單必附文件規則（全系統唯一真相）
 *
 * 設計重點：
 *  - 規則集中在下方 RULES 一張表，日後增減文件只改這裡，前端／後端／核發信自動同步。
 *  - 觸發依據＝第 1 步勾選的「作業類型」（wtHotWork…）與 gasTestRequired / scaffoldingRequired。
 *  - 兩級制：
 *      required    必要 —— 未上傳即擋下完工申報
 *      recommended 強烈建議 —— 畫面黃色提醒，但不擋關單（表單尚未備妥的項目先放這裡）
 *      optional    選配 —— 僅列出供參考
 *    管理台可把 recommended 逐項升級為 required（設定鍵 closeoutRequiredKeys），
 *    表單備妥後不必改程式即可收緊。
 */
var CloseoutRules = (function () {

  /** when: 'always' 或條件陣列（任一成立即觸發） */
  var RULES = [
    { key: 'DailyValidation', when: 'always', level: 'required',
      zh: '現場聯 A4 每日複驗紀錄（簽名後回傳）', en: 'Site Copy (A4) re-validation record (signed)' },
    { key: 'TbmHip', when: 'always', level: 'required',
      zh: '每班次 TBM / HIP 紀錄', en: 'TBM / HIP records (per shift)' },

    { key: 'GasMonitorLog', when: ['wtHotWork', 'wtConfinedSpace', 'gasTestRequired'], level: 'required',
      zh: '氣體監測記錄表', en: 'Gas Monitoring Log' },
    { key: 'EntryLog', when: ['wtConfinedSpace'], level: 'required',
      zh: '局限空間人員進出管制表', en: 'Confined Space Personnel Entry Control Log' },

    { key: 'DiveLog', when: ['wtDiving'], level: 'recommended',
      zh: '潛水作業紀錄表（下潛／出水時間、深度、潛水員、水面支援、減壓）',
      en: 'Dive Log (in/out times, depth, divers, surface support, decompression)' },

    { key: 'RadiationDose', when: ['wtRadiography'], level: 'recommended',
      zh: '輻射偵測與劑量紀錄', en: 'Radiation survey & personal dose records' },
    { key: 'SourceLog', when: ['wtRadiography'], level: 'recommended',
      zh: '射源領用／歸還帳管紀錄', en: 'Radioactive source issue / return accountability log' },

    { key: 'ExcavationCheck', when: ['wtExcavation'], level: 'recommended',
      zh: '開挖每日檢點紀錄（邊坡／支撐／積水／管線）',
      en: 'Daily excavation inspection record (slope, shoring, water, services)' },
    { key: 'BackfillConfirm', when: ['wtExcavation'], level: 'recommended',
      zh: '回填與現場復原確認', en: 'Backfill and site reinstatement confirmation' },

    { key: 'LotoLog', when: ['wtElectricalIso'], level: 'recommended',
      zh: 'LOTO 上鎖掛牌與解除紀錄', en: 'LOTO application and removal record' },
    { key: 'IsolationRegister', when: ['wtProcessIso'], level: 'recommended',
      zh: '隔離／解除隔離清單（含解除確認簽名）',
      en: 'Isolation register incl. signed de-isolation confirmation' },

    { key: 'ScaffoldCheck', when: ['scaffoldingRequired'], level: 'recommended',
      zh: '施工架每日檢點表', en: 'Daily scaffolding inspection checklist' },

    { key: 'SelfInspection', when: 'always', level: 'optional',
      zh: '相關自檢表（施工架、電動手工具、船舶天車／吊車等）',
      en: 'Self-inspection checklists (scaffolding, power tools, davit/crane, etc.)' },
    { key: 'CloseOut', when: 'always', level: 'optional',
      zh: '其他結案佐證文件（照片、交接紀錄等）',
      en: 'Other close-out evidence (photos, handover records, etc.)' }
  ];

  /** 條件判斷：wt* 為布林欄位；gasTestRequired / scaffoldingRequired 為 'Y'/'N' */
  function hit_(m, cond) {
    if (cond === 'gasTestRequired') return String(m.gasTestRequired) === 'Y';
    if (cond === 'scaffoldingRequired') return String(m.scaffoldingRequired) === 'Y';
    return asBool_(m[cond]);
  }

  /** 管理台升級清單：哪些 recommended 已被提升為 required */
  function upgraded_() {
    var raw = '';
    try { raw = getSetting_('closeoutRequiredKeys') || ''; } catch (e) {}
    var out = {};
    String(raw).split(/[\s,;]+/).forEach(function (k) { if (k) out[k] = true; });
    return out;
  }

  /**
   * 解析某張 PTW 適用的關單文件清單。
   * 回傳 [{key, level, zh, en, why}]，level 已套用管理台升級設定。
   */
  function forPtw(m) {
    if (!m) return [];
    var up = upgraded_();
    var out = [];
    RULES.forEach(function (r) {
      var why = [];
      if (r.when !== 'always') {
        var any = false;
        r.when.forEach(function (c) { if (hit_(m, c)) { any = true; why.push(c); } });
        if (!any) return;
      }
      var level = r.level;
      if (level === 'recommended' && up[r.key]) level = 'required';
      out.push({ key: r.key, level: level, zh: r.zh, en: r.en, why: why });
    });
    return out;
  }

  /** 完工申報檢核：回傳缺少的「必要」文件名稱陣列（空陣列＝可關單） */
  function missingRequired(m, hasCat) {
    return forPtw(m).filter(function (r) {
      return r.level === 'required' && !hasCat(r.key);
    }).map(function (r) { return r.zh + ' ' + r.en; });
  }

  /** 規則總表（管理台設定畫面用） */
  function all() { return RULES.slice(); }

  return { forPtw: forPtw, missingRequired: missingRequired, all: all, upgraded: upgraded_ };
})();

/* ============================== LifecycleService.gs ============================== */
/**
 * LifecycleService.gs — PTW 生命週期（Phase 4）：延長、暫停、恢復、完工、關閉
 * 權限：申請（延長/完工）＝申請人 Tier 1；執行（延長/暫停/恢復/關閉）＝Tier 5。
 */

var LifecycleService = (function () {

  function mustGet_(ptwId) {
    var m = Repo.getById('PTW_Master', ptwId);
    if (!m || !asBool_(m.isActive)) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    return m;
  }

  function setStatus_(user, m, to, reason) {
    Repo.update('PTW_Master', m.id, { status: to }, user.id);
    Repo.insert('PTW_StatusHistory', { ptwId: m.id, fromStatus: m.status, toStatus: to,
      byUserId: user.id, reason: reason || '', timestamp: fmtDateTime_() }, user.id);
  }

  function notifyApplicant_(m, type, tEn, tZh, mEn, mZh) {
    var a = Repo.getById('Users', m.applicantUserId);
    if (a) NotificationService.push(a.id, type, m.id, tEn, tZh, mEn, mZh, a.email);
  }

  function notifyT5_(m, type, tEn, tZh, mEn, mZh) {
    Repo.find('Users', function (u) {
      return Number(u.tier) === 5 && u.status === 'Active' && asBool_(u.isActive);
    }).forEach(function (u) { NotificationService.push(u.id, type, m.id, tEn, tZh, mEn, mZh, u.email); });
  }

  /** T5 暫停 / 恢復 */
  function suspend(user, payload) {
    SecurityService.requireAdminOrTier5(user);
    requireFields_(payload, ['ptwId', 'reason']);
    var m = mustGet_(payload.ptwId);
    if ([CFG.STATUS.ACTIVE, CFG.STATUS.EXTENDED].indexOf(m.status) < 0) {
      throw ApiError_('BAD_STATE', 'Only Active/Extended can be suspended', '僅執行中/已延長可暫停');
    }
    setStatus_(user, m, CFG.STATUS.SUSPENDED, payload.reason);
    AuditService.log({ user: user, actionType: 'PTW_SUSPEND', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber, comment: payload.reason, success: true });
    notifyApplicant_(m, 'PTW_SUSPENDED', '⛔ PTW suspended: ' + m.ptwNumber, '⛔ PTW 已暫停：' + m.ptwNumber,
      'Reason: ' + payload.reason + '. Stop work immediately.', '原因：' + payload.reason + '。請立即停止作業。');
    try { NotificationService.adminCc('ptwSuspended', 'PTW suspended: ' + (m.ptwNumber || m.tempNumber), 'PTW 暫停：' + (m.ptwNumber || m.tempNumber), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), m.id); } catch (eCc) {}
    return ok_({ suspended: true });
  }

  function resume(user, payload) {
    SecurityService.requireAdminOrTier5(user);
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    if (m.status !== CFG.STATUS.SUSPENDED) {
      throw ApiError_('BAD_STATE', 'Only Suspended can be resumed', '僅暫停中的 PTW 可恢復');
    }
    if (m.validTo < fmtDateTime_()) {
      throw ApiError_('EXPIRED', 'PTW already expired — close it out and raise a new PTW', 'PTW 已過期，請辦理關閉並重新申請新 PTW');
    }
    setStatus_(user, m, CFG.STATUS.ACTIVE, 'Resumed');
    AuditService.log({ user: user, actionType: 'PTW_RESUME', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber, success: true });
    notifyApplicant_(m, 'PTW_RESUMED', 'PTW resumed: ' + m.ptwNumber, 'PTW 已恢復：' + m.ptwNumber,
      'Work may continue.', '可繼續作業。');
    try { NotificationService.adminCc('ptwResumed', 'PTW resumed: ' + (m.ptwNumber || m.tempNumber), 'PTW 復工：' + (m.ptwNumber || m.tempNumber), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), m.id); } catch (eCc) {}
    return ok_({ resumed: true });
  }

  /** T1 完工申報（含完工聲明）→ Pending Close-out */
  /** 可否提出完工申報：同承商公司人員、或 Tier 5／管理員 */
  function canRequestClosure_(user, m) {
    if (!user) return false;
    if (asBool_(user.isAdmin) || Number(user.tier) === 5) return true;
    return !!(m.companyId && String(user.companyId) === String(m.companyId));
  }

  function requestClosure(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    // 完工申報：同一承商公司的人員皆可提出（作業可能提早完成，申請人不一定在班上）；
    // NMDC Tier 5／管理員亦可代為申報。未到期即可提早關單 —— 狀態允許即可，不檢查有效期。
    if (!canRequestClosure_(user, m)) {
      throw ApiError_('FORBIDDEN', 'Only personnel of the permit-holding company (or Tier 5/Admin) may declare completion',
        '僅該 PTW 所屬承商公司之人員（或 Tier 5／管理員）可申報完工');
    }
    if ([CFG.STATUS.ACTIVE, CFG.STATUS.EXTENDED, CFG.STATUS.SUSPENDED, CFG.STATUS.EXPIRED].indexOf(m.status) < 0) {
      throw ApiError_('BAD_STATE', 'Cannot close in status ' + m.status, '目前狀態不可申報完工：' + m.status);
    }
    if (!asBool_(payload.wcDeclarationAccepted)) {
      throw ApiError_('DECLARATION_REQUIRED', 'Work completion declaration must be accepted', '請勾選完工聲明');
    }
    // (6) 結案文件必須先上傳
    var atts = Repo.find('PTW_Attachments', function (a) {
      return a.ptwId === m.id && asBool_(a.isActive);
    });
    var hasCat = function (c) { return atts.some(function (a) { return String(a.category) === c; }); };
    // 關單必附文件一律由 CloseoutRules 決定（依作業類型觸發，管理台可升級建議項為必要）
    var missing = CloseoutRules.missingRequired(m, hasCat);
    if (missing.length) {
      throw ApiError_('CLOSEOUT_DOCS_REQUIRED',
        'Please upload before declaring completion: ' + missing.join(' / '),
        '申報完工前須先上傳：' + missing.join('、'));
    }
    Repo.update('PTW_Master', m.id, { wcDeclarationAccepted: true, coCurrentTier: 2,
      coT3UserId: '', coT3At: '', coT4UserId: '', coT4At: '', coT5UserId: '', coT5At: '' }, user.id);
    // 申報人不一定是申請人（同公司同事亦可），且可能提早關單 —— 都記進歷程與稽核
    var who = (user.nameZh || user.nameEn || user.email) +
      (user.id === m.applicantUserId ? '' : '\uff08\u4ee3\u7533\u8acb\u4eba\u7533\u5831 on behalf of applicant\uff09');
    var early = !!(m.validTo && String(m.validTo) > fmtDateTime_());
    setStatus_(user, m, CFG.STATUS.PENDING_CLOSEOUT,
      'Work completed declared by ' + who + (early ? ' (early close-out \u63d0\u524d\u95dc\u55ae)' : ''));
    AuditService.log({ user: user, actionType: 'PTW_WORK_COMPLETED', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber, success: true, details: early ? 'early close-out' : '' });
    notifyT5_(m, 'PTW_PENDING_CLOSEOUT',
      'PTW pending close-out: ' + m.ptwNumber, 'PTW \u5f85\u95dc\u9589\u78ba\u8a8d\uff1a' + m.ptwNumber,
      who + ' declared work completed' + (early ? ' before the permit expiry (early close-out)' : '') + '. Please verify and close.',
      who + ' \u5df2\u7533\u5831\u5b8c\u5de5' + (early ? '\uff08\u672a\u5230\u671f\u63d0\u524d\u95dc\u55ae\uff09' : '') + '\uff0c\u8acb\u78ba\u8a8d\u4e26\u95dc\u9589\u3002');
    try { NotificationService.adminCc('ptwWorkCompleted', 'Work completion declared: ' + (m.ptwNumber || m.tempNumber), '完工申報：' + (m.ptwNumber || m.tempNumber), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), m.id); } catch (eCc) {}
    return ok_({ pendingCloseout: true });
  }

  /** (6) 結案確認：依序 T3 工程 → T4 EHS → T5 協調員 */
  var CO_TIER_NAME = { 2: 'Contractor HSE 承商職安衛', 3: 'NMDC Engineering Team 施工組',
    4: 'NMDC EHS 工安組', 5: 'NMDC PTW Coordinator 協調員' };
  function closeoutConfirm(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    if (m.status !== CFG.STATUS.PENDING_CLOSEOUT) {
      throw ApiError_('BAD_STATE', 'PTW is not pending close-out', '此 PTW 非待結案確認狀態');
    }
    var step = Number(m.coCurrentTier || 2);
    var tier = Number(user.tier);
    if (tier !== step && !asBool_(user.isAdmin)) {
      throw ApiError_('NOT_YOUR_TURN', 'Close-out is awaiting ' + CO_TIER_NAME[step],
        '結案確認目前輪到：' + CO_TIER_NAME[step]);
    }
    // 承商職安衛（T2）限本公司
    if (step === 2 && !asBool_(user.isAdmin) && user.companyId !== m.companyId) {
      throw ApiError_('FORBIDDEN', 'Only the contractor\'s own HSE can confirm this step',
        '此步驟僅限該承商之職安衛人員確認');
    }
    var patch = {};
    patch['coT' + step + 'UserId'] = user.id;
    patch['coT' + step + 'At'] = fmtDateTime_();
    if (step < 5) {
      patch.coCurrentTier = step + 1;
      Repo.update('PTW_Master', m.id, patch, user.id);
      AuditService.log({ user: user, actionType: 'PTW_CLOSEOUT_CONFIRM', entityType: 'PTW', entityId: m.id,
        ptwNumber: m.ptwNumber, comment: CO_TIER_NAME[step] + ' confirmed', success: true });
      notifyTierUsers_(m, step + 1, 'PTW_PENDING_CLOSEOUT',
        'Close-out confirmation required: ' + m.ptwNumber, 'PTW 待結案確認：' + m.ptwNumber,
        CO_TIER_NAME[step] + ' has confirmed. Now awaiting ' + CO_TIER_NAME[step + 1] + '.',
        CO_TIER_NAME[step] + ' 已確認，現在輪到 ' + CO_TIER_NAME[step + 1] + '。');
      return ok_({ confirmed: true, nextTier: step + 1, closed: false });
    }
    // T5 為最後一關 → 正式關閉
    patch.coCurrentTier = '';
    patch.closedAt = fmtDateTime_();
    Repo.update('PTW_Master', m.id, patch, user.id);
    setStatus_(user, m, CFG.STATUS.CLOSED, payload.comment || 'Closed after full close-out confirmation chain');
    AuditService.log({ user: user, actionType: 'PTW_CLOSE', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber, comment: payload.comment || '', success: true });
    notifyApplicant_(m, 'PTW_CLOSED', 'PTW closed: ' + m.ptwNumber, 'PTW 已關閉：' + m.ptwNumber,
      'Contractor HSE and all NMDC departments have confirmed. The permit is now formally closed.',
      '承商職安衛與 NMDC 各部門均已確認，本許可證已正式關閉。');
    try { NotificationService.adminCc('ptwClosed', 'PTW closed: ' + (m.ptwNumber || m.tempNumber), 'PTW 關單完成：' + (m.ptwNumber || m.tempNumber), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), NotificationService.ptwBrief(Repo.getById('PTW_Master', m.id)), m.id); } catch (eCc) {}
    return ok_({ confirmed: true, closed: true });
  }

  /** 結案審閱「有意見」→ 退回上一關（第一關 T2 有意見則退回申請人重新整理附件） */
  function closeoutReturn(user, payload) {
    requireFields_(payload, ['ptwId', 'comment']);
    if (!String(payload.comment).trim()) {
      throw ApiError_('COMMENT_REQUIRED', 'Comment is required', '退回必須填寫意見');
    }
    var m = mustGet_(payload.ptwId);
    if (m.status !== CFG.STATUS.PENDING_CLOSEOUT) {
      throw ApiError_('BAD_STATE', 'PTW is not pending close-out', '此 PTW 非待結案確認狀態');
    }
    var step = Number(m.coCurrentTier || 2);
    var tier = Number(user.tier);
    if (tier !== step && !asBool_(user.isAdmin)) {
      throw ApiError_('NOT_YOUR_TURN', 'Close-out is awaiting ' + CO_TIER_NAME[step],
        '結案確認目前輪到：' + CO_TIER_NAME[step]);
    }
    if (step === 2 && !asBool_(user.isAdmin) && user.companyId !== m.companyId) {
      throw ApiError_('FORBIDDEN', 'Only the contractor\'s own HSE can act on this step',
        '此步驟僅限該承商之職安衛人員');
    }
    var cmt = '[Close-out ' + CO_TIER_NAME[step] + '] ' + String(payload.comment).trim();
    Repo.insert('PTW_Comments', { ptwId: m.id, userId: user.id, tier: tier, comment: cmt,
      timestamp: fmtDateTime_() }, user.id);
    if (step === 2) {
      // 退回申請人：重新整理/上傳結案附件後再次申報完工
      Repo.update('PTW_Master', m.id, { coCurrentTier: '', wcDeclarationAccepted: false,
        coT2UserId: '', coT2At: '', coT3UserId: '', coT3At: '', coT4UserId: '', coT4At: '', coT5UserId: '', coT5At: '' }, user.id);
      setStatus_(user, m, CFG.STATUS.ACTIVE, 'Close-out returned to applicant: ' + payload.comment);
      notifyApplicant_(m, 'PTW_CLOSEOUT_RETURNED',
        '↩️ Close-out returned: ' + (m.ptwNumber || m.tempNumber), '↩️ 結案退回：' + (m.ptwNumber || m.tempNumber),
        'Contractor HSE returned the close-out. Comment: ' + payload.comment +
        ' — please update the close-out attachments and declare completion again.',
        '承商職安衛退回結案。意見：' + payload.comment + ' — 請重新整理結案附件後再次申報完工。');
    } else {
      var prev = step - 1;
      var patch = { coCurrentTier: prev };
      patch['coT' + prev + 'UserId'] = '';
      patch['coT' + prev + 'At'] = '';
      Repo.update('PTW_Master', m.id, patch, user.id);
      notifyTierUsers_(m, prev, 'PTW_CLOSEOUT_RETURNED',
        '↩️ Close-out returned to you: ' + (m.ptwNumber || m.tempNumber),
        '↩️ 結案退回至您這一關：' + (m.ptwNumber || m.tempNumber),
        CO_TIER_NAME[step] + ' has an objection: ' + payload.comment,
        CO_TIER_NAME[step] + ' 有意見：' + payload.comment);
      notifyApplicant_(m, 'PTW_CLOSEOUT_RETURNED',
        'Close-out step returned: ' + (m.ptwNumber || m.tempNumber), '結案流程退回一關：' + (m.ptwNumber || m.tempNumber),
        CO_TIER_NAME[step] + ' → ' + CO_TIER_NAME[prev] + '. Comment: ' + payload.comment,
        CO_TIER_NAME[step] + ' → ' + CO_TIER_NAME[prev] + '。意見：' + payload.comment);
    }
    AuditService.log({ user: user, actionType: 'PTW_CLOSEOUT_RETURN', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber || m.tempNumber, comment: payload.comment, success: true });
    return ok_({ returned: true, to: step === 2 ? 'applicant' : ('tier' + (step - 1)) });
  }

  function notifyTierUsers_(m, tier, type, tEn, tZh, mEn, mZh) {
    Repo.find('Users', function (u) {
      if (Number(u.tier) !== tier || u.status !== 'Active' || !asBool_(u.isActive)) return false;
      if (tier === 2) return u.companyId === m.companyId; // 承商職安衛限本公司
      return true;
    }).forEach(function (u) { NotificationService.push(u.id, type, m.id, tEn, tZh, mEn, mZh, u.email); });
  }

  /** T5 直接關閉（逾期/暫停等特殊情形；正常結案請走 closeoutConfirm） */
  function close(user, payload) {
    SecurityService.requireAdminOrTier5(user);
    requireFields_(payload, ['ptwId']);
    var m = mustGet_(payload.ptwId);
    if ([CFG.STATUS.PENDING_CLOSEOUT, CFG.STATUS.EXPIRED, CFG.STATUS.SUSPENDED].indexOf(m.status) < 0) {
      throw ApiError_('BAD_STATE', 'Cannot close in status ' + m.status, '目前狀態不可關閉：' + m.status);
    }
    if (m.status === CFG.STATUS.PENDING_CLOSEOUT && Number(m.coCurrentTier || 3) < 5 && !asBool_(user.isAdmin)) {
      throw ApiError_('CLOSEOUT_PENDING', 'Close-out still awaiting ' + CO_TIER_NAME[Number(m.coCurrentTier || 3)],
        '結案確認尚待：' + CO_TIER_NAME[Number(m.coCurrentTier || 3)]);
    }
    Repo.update('PTW_Master', m.id, { closedAt: fmtDateTime_() }, user.id);
    setStatus_(user, m, CFG.STATUS.CLOSED, payload.comment || 'Closed by PTW Coordinator');
    AuditService.log({ user: user, actionType: 'PTW_CLOSE', entityType: 'PTW', entityId: m.id,
      ptwNumber: m.ptwNumber, comment: payload.comment || '', success: true });
    notifyApplicant_(m, 'PTW_CLOSED', 'PTW closed: ' + m.ptwNumber, 'PTW 已關閉：' + m.ptwNumber,
      'The permit is now formally closed.', '本許可證已正式關閉。');
    return ok_({ closed: true });
  }

  return { closeoutReturn: closeoutReturn, suspend: suspend,
    resume: resume, requestClosure: requestClosure, close: close, closeoutConfirm: closeoutConfirm };
})();

/* ============================== SchedulerService.gs ============================== */
/**
 * SchedulerService.gs — 時間觸發排程（Phase 4）
 * scanExpiry()：每小時執行 — 到期標記 Expired、即將到期提醒（24h）、逾期未關閉警示、訓練到期提醒。
 * setupTriggers()：建立/重建 trigger（oneClickSetup 會自動呼叫）。
 */

var SchedulerService = (function () {

  /** 是否已於今日發過同類通知（避免重複轟炸） */
  function alreadyNotifiedToday_(userId, type, ptwId) {
    var today = fmtDate_();
    return !!Repo.findOne('Notifications', function (n) {
      return n.userId === userId && n.type === type && n.ptwId === (ptwId || '') &&
        String(n.createdAt).substring(0, 10) === today;
    });
  }

  function notifyOnce_(userId, email, type, ptwId, tEn, tZh, mEn, mZh) {
    if (alreadyNotifiedToday_(userId, type, ptwId)) return;
    NotificationService.push(userId, type, ptwId, tEn, tZh, mEn, mZh, email);
  }

  function scanExpiry() {
    try { NotificationService.weeklySummaryTick(); } catch (eW) {}   // 週日 20:00 後寄出每週摘要（每週一次）
    var now = fmtDateTime_();
    var reminderH = Number(getSetting_('expiryReminderHours')) || 24;
    var soon = fmtDateTime_(new Date(Date.now() + reminderH * 3600 * 1000));
    var users = {};
    Repo.readAll('Users').forEach(function (u) { users[u.id] = u; });
    var t5 = Repo.find('Users', function (u) {
      return Number(u.tier) === 5 && u.status === 'Active' && asBool_(u.isActive);
    });

    var count = { expired: 0, expiring: 0, overdue: 0, training: 0 };
    Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); }).forEach(function (m) {
      var num = m.ptwNumber || m.tempNumber;
      var applicant = users[m.applicantUserId];

      // 1) Active/Extended 過期 → Expired（測試案例15）
      if ((m.status === CFG.STATUS.ACTIVE || m.status === CFG.STATUS.EXTENDED) && m.validTo && m.validTo < now) {
        Repo.update('PTW_Master', m.id, { status: CFG.STATUS.EXPIRED }, 'scheduler');
        Repo.insert('PTW_StatusHistory', { ptwId: m.id, fromStatus: m.status, toStatus: CFG.STATUS.EXPIRED,
          byUserId: 'scheduler', reason: 'Auto-expired (validTo passed)', timestamp: now }, 'scheduler');
        AuditService.log({ userName: 'scheduler', actionType: 'PTW_AUTO_EXPIRE', entityType: 'PTW',
          entityId: m.id, ptwNumber: num, success: true });
        if (applicant) notifyOnce_(applicant.id, applicant.email, 'PTW_EXPIRED', m.id,
          '⏰ PTW EXPIRED: ' + num, '⏰ PTW 已到期：' + num,
          'Stop work and proceed with close-out.', '請停止作業並辦理關閉。');
        try { NotificationService.adminCc('ptwOverdue', 'PTW overdue (not closed): ' + num,
          'PTW 逾期未關：' + num, NotificationService.ptwBrief(m), NotificationService.ptwBrief(m), m.id); } catch (eCc) {}
        count.expired++;
        return;
      }
      // 2) 即將到期提醒（24h 內）
      if ((m.status === CFG.STATUS.ACTIVE || m.status === CFG.STATUS.EXTENDED) &&
          m.validTo && m.validTo > now && m.validTo <= soon) {
        if (applicant) notifyOnce_(applicant.id, applicant.email, 'PTW_EXPIRING_SOON', m.id,
          '⚠️ PTW expiring soon: ' + num + ' (' + m.validTo + ')', '⚠️ PTW 即將到期：' + num + '（' + m.validTo + '）',
          'Extend or complete the work before expiry.', '請於到期前延長或完成作業。');
        count.expiring++;
      }
      // 3) 逾期未關閉（Expired 且未關閉）→ 提醒 T5（測試案例16 Dashboard 已即時顯示）
      if (m.status === CFG.STATUS.EXPIRED) {
        t5.forEach(function (u5) {
          notifyOnce_(u5.id, u5.email, 'PTW_OVERDUE_OPEN', m.id,
            '🔴 Overdue PTW not closed: ' + num, '🔴 逾期未關閉 PTW：' + num,
            'Expired at ' + m.validTo + ' and still not closed.', '已於 ' + m.validTo + ' 到期，尚未關閉。');
        });
        count.overdue++;
      }
    });

    // 4) 訓練即將到期（60 天內，每日一次）
    var trainingSoon = fmtDate_(new Date(Date.now() + 60 * 86400000));
    Repo.find('Users', function (u) {
      return u.status === 'Active' && asBool_(u.isActive) && u.trainingValidUntil &&
        u.trainingValidUntil > fmtDate_() && u.trainingValidUntil <= trainingSoon;
    }).forEach(function (u) {
      notifyOnce_(u.id, u.email, 'TRAINING_EXPIRING', '',
        'Your PTW training expires on ' + u.trainingValidUntil, '您的 PTW 訓練將於 ' + u.trainingValidUntil + ' 到期',
        'Please retake the training and exam before expiry.', '請於到期前重新完成訓練與考試。');
      count.training++;
    });

    console.log('scanExpiry done: ' + JSON.stringify(count));
    return count;
  }

  /** 建立時間觸發器（冪等：先刪同名） */
  function setupTriggers() {
    try {
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'scheduledScan') ScriptApp.deleteTrigger(t);
      });
      ScriptApp.newTrigger('scheduledScan').timeBased().everyHours(1).create();
      console.log('setupTriggers: hourly scheduledScan created.');
      return 'ok';
    } catch (e) {
      console.error('setupTriggers failed: ' + e.message);
      return 'failed: ' + e.message;
    }
  }

  return { scanExpiry: scanExpiry, setupTriggers: setupTriggers };
})();

/** trigger 進入點（頂層函式） */
function scheduledScan() { SchedulerService.scanExpiry(); }

/* ============================== ReportService.gs ============================== */
/**
 * ReportService.gs — 進階報表（Phase 4）：逾期、公司別、類型、月度、簽核歷程、版本比較
 * 報表限 Tier 5 / Admin；PTW 清單匯出依使用者資料範圍。
 */

var ReportService = (function () {

  var WT_KEYS = [['wtHotWork', 'Hot Work 動火'], ['wtColdWork', 'Cold Work 一般'], ['wtDiving', 'Diving 潛水'],
    ['wtRadiography', 'Radiography 輻射'], ['wtConfinedSpace', 'Confined Space 局限空間'],
    ['wtExcavation', 'Excavation 開挖'], ['wtElectricalIso', 'Electrical Iso 電氣隔離'],
    ['wtProcessIso', 'Process Iso 製程隔離']];

  function activePtws_() {
    return Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); });
  }

  function companyMap_() {
    var map = {};
    Repo.readAll('Companies').forEach(function (c) { map[c.id] = companyLabel_(c); });
    return map;
  }

  /** 逾期未關閉報表 */
  function overdue(user) {
    SecurityService.requireAdminOrTier5(user);
    var now = fmtDateTime_(), nowMs = Date.now();
    var companies = companyMap_();
    var closedSet = [CFG.STATUS.CLOSED, CFG.STATUS.CANCELLED, CFG.STATUS.DRAFT];
    var rows = activePtws_().filter(function (p) {
      if (closedSet.indexOf(p.status) >= 0) return false;
      return p.status === CFG.STATUS.EXPIRED || (p.validTo && p.validTo < now &&
        [CFG.STATUS.ACTIVE, CFG.STATUS.EXTENDED, CFG.STATUS.SUSPENDED, CFG.STATUS.PENDING_CLOSEOUT].indexOf(p.status) >= 0);
    }).map(function (p) {
      var to = parseDateTime_(p.validTo);
      return { number: p.ptwNumber || p.tempNumber, company: companies[p.companyId] || '',
        areaLocation: p.areaLocation, status: p.status, validTo: p.validTo,
        daysOverdue: to ? Math.max(0, Math.floor((nowMs - to.getTime()) / 86400000)) : '' };
    });
    rows.sort(function (a, b) { return b.daysOverdue - a.daysOverdue; });
    return ok_(rows);
  }

  /** 公司別統計 */
  function byCompany(user) {
    SecurityService.requireAdminOrTier5(user);
    var companies = companyMap_();
    var agg = {};
    activePtws_().forEach(function (p) {
      var k = p.companyId;
      if (!agg[k]) agg[k] = { company: companies[k] || k, total: 0, byStatus: {} };
      agg[k].total++;
      agg[k].byStatus[p.status] = (agg[k].byStatus[p.status] || 0) + 1;
    });
    return ok_(Object.keys(agg).map(function (k) { return agg[k]; })
      .sort(function (a, b) { return b.total - a.total; }));
  }

  /** PTW 類型統計 */
  function byType(user) {
    SecurityService.requireAdminOrTier5(user);
    var rows = activePtws_();
    return ok_(WT_KEYS.map(function (d) {
      return { type: d[1], count: rows.filter(function (p) { return asBool_(p[d[0]]); }).length };
    }));
  }

  /** 月度統計（近 12 個月：建立/核准/關閉） */
  function monthly(user) {
    SecurityService.requireAdminOrTier5(user);
    var agg = {};
    function bump(dateStr, key) {
      if (!dateStr) return;
      var mo = String(dateStr).substring(0, 7);
      if (!agg[mo]) agg[mo] = { month: mo, created: 0, approved: 0, closed: 0 };
      agg[mo][key]++;
    }
    activePtws_().forEach(function (p) {
      bump(p.createdAt, 'created'); bump(p.approvedAt, 'approved'); bump(p.closedAt, 'closed');
    });
    var rows = Object.keys(agg).sort().map(function (k) { return agg[k]; });
    return ok_(rows.slice(-12));
  }

  /** 簽核歷程總匯出 */
  function approvalsExport(user) {
    SecurityService.requireAdminOrTier5(user);
    var names = {};
    Repo.readAll('Users').forEach(function (u) { names[u.id] = (u.nameEn || '') + ' / ' + (u.nameZh || ''); });
    var numbers = {};
    activePtws_().forEach(function (p) { numbers[p.id] = p.ptwNumber || p.tempNumber; });
    var rows = Repo.readAll('PTW_Approvals').map(function (a) {
      return { number: numbers[a.ptwId] || '', version: a.version, tier: a.tier, action: a.action,
        reviewer: names[a.reviewerUserId] || '', comment: a.comment, returnReason: a.returnReason,
        decidedAt: a.decidedAt };
    });
    rows.sort(function (a, b) { return a.decidedAt < b.decidedAt ? 1 : -1; });
    return ok_(rows);
  }

  /** 版本清單與比較（欄位差異；含勾選群 JSON 展開比較） */
  function versionDiff(user, payload) {
    requireFields_(payload, ['ptwId']);
    var m = Repo.getById('PTW_Master', payload.ptwId);
    if (!m) throw ApiError_('NOT_FOUND', 'PTW not found', '找不到 PTW');
    SecurityService.assertCanViewPtw(user, m);
    var versions = Repo.find('PTW_Versions', function (v) { return v.ptwId === m.id; });
    versions.sort(function (a, b) { return Number(a.version) - Number(b.version); });
    var list = versions.map(function (v) {
      return { version: Number(v.version), submittedAt: v.submittedAt, submittedBy: v.submittedBy };
    });
    if (payload.v1 === undefined || payload.v2 === undefined || versions.length < 2) {
      return ok_({ versions: list, diff: null });
    }
    var s1 = null, s2 = null;
    versions.forEach(function (v) {
      if (Number(v.version) === Number(payload.v1)) s1 = JSON.parse(v.snapshotJson);
      if (Number(v.version) === Number(payload.v2)) s2 = JSON.parse(v.snapshotJson);
    });
    if (!s1 || !s2) throw ApiError_('NOT_FOUND', 'Version snapshot not found', '找不到版本快照');

    var SKIP = ['updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'version', 'status',
      'currentTier', 'currentReviewerId', 'submittedAt', '_rowIndex', 'isActive'];
    var JSON_FIELDS = ['checksJson', 'gasTestsJson', 'docChecksJson'];
    var diff = [];
    var keys = {};
    Object.keys(s1).concat(Object.keys(s2)).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      if (SKIP.indexOf(k) >= 0) return;
      var a = s1[k], b = s2[k];
      if (JSON_FIELDS.indexOf(k) >= 0) {
        var ja = {}, jb = {};
        try { ja = JSON.parse(a || (k === 'gasTestsJson' ? '[]' : '{}')); } catch (e) {}
        try { jb = JSON.parse(b || (k === 'gasTestsJson' ? '[]' : '{}')); } catch (e) {}
        if (k === 'gasTestsJson') {
          if (JSON.stringify(ja) !== JSON.stringify(jb)) {
            diff.push({ field: '氣體測試紀錄 Gas Tests', from: ja.length + ' rows', to: jb.length + ' rows' });
          }
          return;
        }
        var subKeys = {};
        Object.keys(ja).concat(Object.keys(jb)).forEach(function (sk) { subKeys[sk] = true; });
        Object.keys(subKeys).forEach(function (sk) {
          var va = !!ja[sk], vb = !!jb[sk];
          if (va !== vb) diff.push({ field: sk, from: va ? '☑' : '☐', to: vb ? '☑' : '☐' });
        });
        return;
      }
      if (String(a === undefined ? '' : a) !== String(b === undefined ? '' : b)) {
        diff.push({ field: k, from: String(a || ''), to: String(b || '') });
      }
    });
    return ok_({ versions: list, diff: diff, v1: Number(payload.v1), v2: Number(payload.v2) });
  }

  // ---------- 代理簽核管理 ----------

  function delegationList(user) {
    SecurityService.requireAdmin(user);
    var names = {};
    Repo.readAll('Users').forEach(function (u) { names[u.id] = (u.nameEn || '') + ' / ' + (u.nameZh || ''); });
    var rows = Repo.find('Delegations', function (d) { return asBool_(d.isActive); });
    return ok_(rows.map(function (d) {
      return { id: d.id, delegator: names[d.delegatorUserId] || d.delegatorUserId,
        delegate: names[d.delegateUserId] || d.delegateUserId, tier: d.tier,
        validFrom: d.validFrom, validTo: d.validTo };
    }));
  }

  function delegationDisable(user, payload) {
    SecurityService.requireAdmin(user);
    requireFields_(payload, ['delegationId']);
    Repo.update('Delegations', payload.delegationId, { isActive: false }, user.id);
    AuditService.log({ user: user, actionType: 'DELEGATION_DISABLE', entityType: 'Delegation',
      entityId: payload.delegationId, success: true });
    return ok_({ disabled: true });
  }

  /** 編號總表：每張 PTW 的正式編號＋各證書編號；並列出各序號的缺號（將由系統補發） */
  function numbersOverview(user) {
    SecurityService.requireAdmin(user);
    var companies = {}; Repo.readAll('Companies').forEach(function (c) { companies[c.id] = c.nameZh || c.nameEn; });
    var certByPtw = {}, usedByPrefix = {};
    var useNum = function (no) {
      var mm = String(no || '').match(/^([A-Za-z-]*?)(\d+)$/);
      if (!mm) return;
      var pfx = mm[1].replace(/-$/, '') || 'PTW';
      (usedByPrefix[pfx] = usedByPrefix[pfx] || []).push(Number(mm[2]));
    };
    Repo.find('PTW_Certificates', function (c) { return asBool_(c.isActive); }).forEach(function (c) {
      (certByPtw[c.ptwId] = certByPtw[c.ptwId] || {})[c.certType] = c.certNo;
      useNum(c.certNo);
    });
    var rows = SecurityService.stripTestPtws(user, Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); }))
      .map(function (p) {
        if (p.ptwNumber) useNum(p.ptwNumber);
        return { id: p.id, number: p.ptwNumber || p.tempNumber, official: !!p.ptwNumber,
          status: p.status, company: companies[p.companyId] || '',
          certs: certByPtw[p.id] || {}, executionDate: String(p.executionDate || '').substring(0, 10) };
      });
    rows.sort(function (a, b) { return String(a.number) < String(b.number) ? -1 : 1; });
    // 缺號（1..max 之間未使用）＝ 下次補發的號碼
    var gaps = {};
    Object.keys(usedByPrefix).forEach(function (pfx) {
      var used = {}; usedByPrefix[pfx].forEach(function (n) { used[n] = true; });
      var max = Math.max.apply(null, usedByPrefix[pfx]);
      var g = [];
      for (var i = 1; i < max; i++) if (!used[i]) g.push(i);
      if (g.length) gaps[pfx] = g;
    });
    return ok_({ rows: rows, gaps: gaps });
  }

  return { overdue: overdue, byCompany: byCompany, byType: byType, monthly: monthly,
    approvalsExport: approvalsExport, versionDiff: versionDiff, numbersOverview: numbersOverview,
    delegationList: delegationList, delegationDisable: delegationDisable };
})();

/* ============================== Setup.gs ============================== */
/**
 * Setup.gs — 系統初始化（僅由專案擁有者在 GAS 編輯器中手動執行）
 *
 * 執行前必須先設定 Script Properties：
 *   SPREADSHEET_ID        資料庫 Spreadsheet ID
 *   DRIVE_ROOT_FOLDER_ID  Google Drive 根資料夾 ID（Offshore PTW System）
 *   PEPPER                長隨機字串（自行產生，勿外流；設定後不可再更改）
 *   ADMIN_EMAIL           第一位系統管理員 Email
 *   ADMIN_INIT_PASSWORD   管理員初始密碼（首次登入強制變更）
 *   FRONTEND_URL          （選填）前端網址，Email 內連結用
 */

/** 1) 建立所有工作表與首列欄名（冪等：已存在則只補缺漏欄） */
function initSheets() {
  var ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      var existing = sh.getLastColumn() > 0
        ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
      var missing = SHEETS[name].filter(function (h) { return existing.indexOf(h) < 0; });
      if (missing.length) {
        sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      }
    }
  });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('工作表1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  console.log('initSheets done: ' + Object.keys(SHEETS).length + ' sheets.');
}

/** 2) 種子資料：SystemSettings、Sequences、Roles、NMDC 公司、管理員帳號 */
function seedData() {
  // SystemSettings
  Object.keys(CFG.DEFAULTS).forEach(function (k) {
    var existing = Repo.findOne('SystemSettings', function (r) { return r.key === k; });
    if (!existing) {
      Repo.upsertByKey('SystemSettings', 'key', k, { value: String(CFG.DEFAULTS[k]), description: 'default' });
    }
  });
  // Sequences
  ['PTW', 'TMP', 'HW', 'GW', 'DO', 'RG', 'CS', 'EC', 'EI'].forEach(function (key) {
    var existing = Repo.findOne('Sequences', function (r) { return r.key === key; });
    if (!existing) Repo.upsertByKey('Sequences', 'key', key, { currentValue: 0, format: '' });
  });
  // Roles（簽名職務字典）
  var roles = [
    ['PERFORMING_AUTHORITY', '執行單位', 'Performing Authority', ''],
    ['ISSUING_AUTHORITY', '授權/發證單位', 'Issuing Authority', 'company=NMDC'],
    ['HOLDER', '主持有人', 'Holder', ''],
    ['CO_HOLDER', '副持有人', 'Co-Holder', ''],
    ['CONTRACTOR_HSE', '承商工安', 'Contractor HSE', 'tier=2'],
    ['NMDC_CONSTRUCTION', 'NMDC 施工部門', 'NMDC Construction', 'tier=3'],
    ['NMDC_HSE', 'NMDC 環安衛', 'NMDC HSE', 'tier=4'],
    ['PTW_COORDINATOR', '工作許可協調員', 'PTW Coordinator', 'tier=5'],
    ['NMDC_ENGINEER', 'NMDC 工程師', 'NMDC Engineer', 'company=NMDC'],
    ['SURVEY_TEAM', '測量團隊', 'Survey Team', 'company=NMDC'],
    ['DIVING_SUPERVISOR', '潛水監督員', 'Diving Supervisor', ''],
    ['BARGE_MASTER', '駁船主管/船長', 'Barge Supervisor / Master', ''],
    ['FACILITY_SUPERVISOR', '設施主管', 'Facility Supervisor', ''],
    ['RADIOGRAPHY_SUPERVISOR', '輻射檢測主管', 'Radiography Supervisor', ''],
    ['GAS_TESTER', '氣體測試員', 'Gas Tester', '']
  ];
  roles.forEach(function (r) {
    var existing = Repo.findOne('Roles', function (row) { return row.code === r[0]; });
    if (!existing) {
      Repo.insert('Roles', { code: r[0], nameZh: r[1], nameEn: r[2], pickerFilter: r[3] }, 'setup');
    }
  });
  // NMDC 公司
  var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC'; });
  if (!nmdc) {
    nmdc = Repo.insert('Companies', { nameZh: 'NMDC', nameEn: 'NMDC', type: 'NMDC' }, 'setup');
  }
  // 管理員帳號
  var adminEmail = normEmail_(getProp_('ADMIN_EMAIL'));
  var admin = Repo.findOne('Users', function (u) { return normEmail_(u.email) === adminEmail; });
  if (!admin) {
    var salt = randomToken_(32);
    Repo.insert('Users', {
      email: adminEmail, nameZh: '系統管理員', nameEn: 'System Administrator',
      companyId: nmdc.id, title: 'PTW Coordinator / Admin', phone: '', vessel: '',
      tier: 5, isAdmin: true, badgeNo: '',
      passwordSalt: salt,
      passwordHash: hashPassword_(getProp_('ADMIN_INIT_PASSWORD'), salt),
      hashIter: CFG.HASH_ITERATIONS,
      status: 'Active', failedLoginCount: 0, mustChangePassword: true, langPref: 'en',
      trainingPassedAt: fmtDateTime_(), trainingValidUntil: fmtDate_(new Date(Date.now() + 3 * 365 * 86400000))
    }, 'setup');
    console.log('Admin user created: ' + adminEmail + '（首次登入須變更密碼）');
  } else {
    // 既有管理員：補齊訓練資格（管理員視同訓練通過）
    if (!admin.trainingValidUntil || admin.trainingValidUntil < fmtDate_()) {
      Repo.update('Users', admin.id, { trainingPassedAt: fmtDateTime_(),
        trainingValidUntil: fmtDate_(new Date(Date.now() + 3 * 365 * 86400000)) }, 'setup');
    }
    console.log('Admin user already exists: ' + adminEmail);
  }
  // 預設訓練課程（影片待管理員設定）
  if (!Repo.findOne('TrainingCourses', function (c) { return asBool_(c.isActive); })) {
    Repo.insert('TrainingCourses', {
      title: 'PTW Safety Training 工作許可安全訓練', youtubeVideoId: '',
      durationSec: 0, courseVersion: 'v1', validityMonths: 36, minWatchPercent: 90
    }, 'setup');
  }
  // 範例題庫（僅在題庫為空時建立；正式題目請於系統管理維護）
  if (Repo.readAll('QuestionBank').length === 0) seedSampleQuestions_();
  console.log('seedData done.');
}

/** PTW 流程圖配合題（唯一配合題；必考、全對才得 10 分；考試畫面顯示挖空流程圖） */
function ptwProcessMatchQuestion_() {
  var R = {
    perf: 'Performing 施工方',
    eng: 'Issuing — Engineer 簽發方（工程師）',
    ehs: 'Issuing — EHS 簽發方（職安衛）',
    coord: 'Issuing — PTW Coordinator 簽發方（PTW 協調員）',
    both: 'Issuing + Performing 簽發方＋施工方'
  };
  var L = [
    '① Prepare PTW application and supporting documents 準備 PTW 申請與輔助文件',
    '② Confirm method statement 確認施工方法說明書',
    '③ Confirm risk assessment 確認風險評估',
    '④ Confirm all documentation and authorization 確認所有文件並授權核發',
    '⑤ Revalidation before / during / after work 作業前中後執行驗證（Revalidation）',
    '⑥ Confirm work completion and sign-off by relevant parties 確認完工並由相關方簽認'
  ];
  var ans = {};
  ans[L[0]] = R.perf; ans[L[1]] = R.eng; ans[L[2]] = R.ehs;
  ans[L[3]] = R.coord; ans[L[4]] = R.both; ans[L[5]] = R.both;
  return { type: 'Match',
    questionZh: '請完成 PTW 作業流程：依下方流程圖，為 ①～⑥ 每個空格選出正確的負責角色（全對才得分）',
    questionEn: 'Complete the PTW workflow: for each blank ①–⑥ in the diagram below, select the party responsible for that step (all answers must be correct to score)',
    optionsJson: JSON.stringify({ left: L, right: [R.perf, R.eng, R.ehs, R.coord, R.both], diagram: 'ptwProcess' }),
    answerJson: JSON.stringify(ans),
    points: 10, category: 'PTWProcess', difficulty: 'Normal', mustInclude: true };
}

/** 範例題庫：18 題選擇 + 1 題 PTW 流程圖配合題（category=Sample／PTWProcess） */
function seedSampleQuestions_() {
  var MC = function (zh, en, opts, correct) {
    return { type: 'MC', questionZh: zh, questionEn: en,
      optionsJson: JSON.stringify(opts), answerJson: JSON.stringify({ correct: correct }),
      points: 10, category: 'Sample', difficulty: 'Normal' };
  };
  var qs = [
    MC('進行任何許可作業前，作業人員必須？', 'Before starting any permitted work, workers must?',
      ['確認 PTW 已核准且在有效期限內 Confirm PTW approved and valid', '直接開工 Start work directly',
       '口頭告知同事即可 Verbal notice to colleagues only', '先開工再補申請 Work first, apply later'],
      '確認 PTW 已核准且在有效期限內 Confirm PTW approved and valid'),
    MC('動火作業（Hot Work）開始前必須完成？', 'Before Hot Work starts, what must be completed?',
      ['氣體測試 Gas test', '午餐 Lunch', '洗車 Car wash', '無需任何準備 Nothing'],
      '氣體測試 Gas test'),
    MC('進入局限空間前最重要的檢測項目是？', 'The most critical test before confined space entry is?',
      ['氧氣濃度及有害氣體 O2 and toxic gases', '濕度 Humidity', '照度 Light level', '溫度 Temperature only'],
      '氧氣濃度及有害氣體 O2 and toxic gases'),
    MC('PTW 有效期限屆滿但工作未完成，應？', 'PTW expired but work unfinished. You should?',
      ['停止作業並申請延長/重新驗證 Stop work and apply for extension/revalidation', '繼續作業 Continue working',
       '自行塗改日期 Modify the date yourself', '請同事代簽 Ask a colleague to sign'],
      '停止作業並申請延長/重新驗證 Stop work and apply for extension/revalidation'),
    MC('發現現場出現緊急狀況時，第一步應？', 'When an emergency occurs on site, the first step is?',
      ['停止作業、撤離並通報 Stop work, evacuate and report', '拍照打卡 Take photos', '繼續趕工 Rush the work', '下班 Go home'],
      '停止作業、撤離並通報 Stop work, evacuate and report'),
    MC('個人防護具（PPE）的主要目的為？', 'The main purpose of PPE is?',
      ['降低人員暴露於危害的風險 Reduce exposure to hazards', '好看 Fashion', '公司規定而已 Just company rule', '增加工作速度 Work faster'],
      '降低人員暴露於危害的風險 Reduce exposure to hazards'),
    MC('潛水作業進行期間，下列何者禁止？', 'During diving operations, which is prohibited?',
      ['潛水區域上方吊掛作業 Lifting over the dive area', '持續通訊 Continuous comms',
       '待命人員就位 Standby person in place', '掛出國際信號旗 Display international signals'],
      '潛水區域上方吊掛作業 Lifting over the dive area'),
    MC('PTW 被退回（Returned）時，申請人應？', 'When a PTW is returned, the applicant should?',
      ['依審查意見修改後重新送審 Revise per comments and resubmit', '直接刪除 Delete it',
       '找別人重新申請一張 Ask someone else to apply', '不理會 Ignore it'],
      '依審查意見修改後重新送審 Revise per comments and resubmit'),
    MC('高處作業時，人員應？', 'When working at height, workers must?',
      ['全程 100% 繫掛合格安全吊帶 Use certified harness with 100% tie-off', '手扶欄杆即可 Just hold the rail',
       '天氣好就不用防護 No protection on fine days', '只有新人需要 Only new workers need it'],
      '全程 100% 繫掛合格安全吊帶 Use certified harness with 100% tie-off'),
    MC('施工架（Scaffolding）使用前應？', 'Before using scaffolding, you must?',
      ['確認掛牌合格並每日檢查 Confirm tagged and inspected daily', '直接攀爬 Climb directly',
       '自行拆改後使用 Modify it yourself', '只看外觀 Visual check only'],
      '確認掛牌合格並每日檢查 Confirm tagged and inspected daily'),
    MC('吊掛作業進行中，地面人員應？', 'During lifting operations, ground personnel should?',
      ['遠離吊物下方及迴轉半徑 Stay clear of suspended load and swing radius', '站在吊物下指揮 Stand under the load',
       '協助用手扶穩吊物 Steady the load by hand', '穿越吊掛區抄捷徑 Cut through the lifting zone'],
      '遠離吊物下方及迴轉半徑 Stay clear of suspended load and swing radius'),
    MC('LOTO（上鎖掛牌）的目的是？', 'The purpose of LOTO (Lock-out Tag-out) is?',
      ['隔離危險能量避免意外啟動 Isolate hazardous energy to prevent accidental start-up', '防小偷 Prevent theft',
       '標示物品所有人 Mark ownership', '裝飾設備 Decoration'],
      '隔離危險能量避免意外啟動 Isolate hazardous energy to prevent accidental start-up'),
    MC('船舶作業期間人員落水，第一時間應？', 'If a person falls overboard during vessel operations, the first action is?',
      ['大喊落水並拋救生圈、通報駕駛台 Shout MOB, throw lifebuoy, alert the bridge', '先拍影片 Record a video first',
       '自行跳水救援 Jump in yourself immediately', '等他自己游回來 Wait for them to swim back'],
      '大喊落水並拋救生圈、通報駕駛台 Shout MOB, throw lifebuoy, alert the bridge'),
    MC('氣體測試結果超出容許值時應？', 'If gas test readings exceed acceptable limits, you should?',
      ['停止作業、通風並重新測試合格後才可作業 Stop work, ventilate and retest until acceptable', '照常作業 Work as usual',
       '縮短作業時間即可 Just shorten the work period', '改由別人進入 Send someone else in'],
      '停止作業、通風並重新測試合格後才可作業 Stop work, ventilate and retest until acceptable'),
    MC('TBM（工具箱會議）應於何時進行？', 'When should the Toolbox Meeting (TBM) be held?',
      ['每日開工前 Before work starts each day', '每月一次 Once a month', '出事後才開 Only after an incident', '不需要 Not needed'],
      '每日開工前 Before work starts each day'),
    MC('發現同事未依 PTW 條件作業時，你應？', 'If you see a colleague working outside PTW conditions, you should?',
      ['立即制止並通報持有人/工安 Stop the work and report to the holder/HSE', '裝作沒看到 Ignore it',
       '下班後再說 Mention it after work', '幫他把風 Keep watch for him'],
      '立即制止並通報持有人/工安 Stop the work and report to the holder/HSE'),
    MC('雷雨或強風超過作業限制時，戶外高處作業應？', 'When thunderstorms or wind exceed limits, outdoor work at height should?',
      ['立即停止並待命 Stop immediately and stand by', '加快完成 Speed up to finish', '照常進行 Continue as normal', '改成兩人一起爬 Climb in pairs'],
      '立即停止並待命 Stop immediately and stand by'),
    MC('PTW 現場聯（Site Copy）應放置於？', 'The PTW Site Copy must be kept?',
      ['作業現場明顯處供查核 Displayed at the worksite for verification', '辦公室抽屜 In an office drawer',
       '個人口袋 In a pocket', '不需要攜帶 Not required'],
      '作業現場明顯處供查核 Displayed at the worksite for verification'),
    ptwProcessMatchQuestion_()
  ];
  qs.forEach(function (q) { Repo.insert('QuestionBank', q, 'setup'); });
  console.log('seedSampleQuestions_: ' + qs.length + ' sample questions inserted.');
}

/** 3) 建立 Drive 根資料夾結構 */
function initDriveFolders() {
  var root = DriveApp.getFolderById(getProp_('DRIVE_ROOT_FOLDER_ID'));
  var sys = getOrCreateFolder_(root, '_system');
  getOrCreateFolder_(sys, 'logo');
  getOrCreateFolder_(sys, 'templates');
  getOrCreateFolder_(sys, 'signatures');
  getOrCreateFolder_(root, String(new Date().getFullYear()));
  console.log('initDriveFolders done under: ' + root.getName());
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 一鍵初始化 */
function initSystem() {
  initSheets();
  seedData();
  initDriveFolders();
  console.log('initSystem completed.');
}

/* ============================== Code.gs ============================== */
/**
 * Code.gs — Web App 進入點與 API 路由
 *
 * 前端呼叫方式（避免 CORS preflight）：
 *   POST <WebAppURL>
 *   Content-Type: text/plain;charset=utf-8
 *   Body: JSON.stringify({ action, token, payload, meta:{userAgent} })
 *
 * 回應一律 JSON：{ok:true,data} 或 {ok:false,errorCode,msgEn,msgZh}
 */

/** 免登入 action 白名單 */
var PUBLIC_ACTIONS = {
  'ptw.board': true,
  'home.public': true,
  'downloads.list': true,
  'company.options': true,
  'announce.list': true,
  'contact.get': true,
  'personnel.list': true,
  'auth.login': true,
  'auth.applyAccount': true,
  'auth.forgotPassword': true,
  'auth.resetPassword': true,
  'system.ping': true
};

/** 首頁資料包（home.bootstrap 與登入 piggyback 共用） */
function homeBundle_(u) {
  return {
    dashboard: DashboardService.dashboard(u).data,
    board: DashboardService.board(u).data,
    notify: NotificationService.listMine(u, { page: 1 }).data,
    downloads: DriveService.listDownloads().data,
    announcements: DriveService.announceList().data
  };
}

/** action → handler 對照表 */
function routes_() {
  return {
    // Auth
    'auth.login':          function (u, p, m) {
      var r = AuthService.login(p, m);
      // 登入成功即順路帶回首頁資料（省去登入後第二次往返，加快進入首頁）
      if (r && r.ok && r.data && r.data.token && !r.data.mustChangePassword) {
        try { r.data.home = homeBundle_(AuthService.verifySession(r.data.token)); }
        catch (e) { console.error('login home piggyback failed: ' + e.message); }
      }
      return r;
    },
    'auth.logout':         function (u, p, m) { return AuthService.logout(u, m.token); },
    'auth.applyAccount':   function (u, p, m) { return AuthService.applyAccount(p, m); },
    'auth.forgotPassword': function (u, p, m) { return AuthService.forgotPassword(p, m); },
    'auth.resetPassword':  function (u, p) { return AuthService.resetPassword(p); },
    'auth.changePassword': function (u, p) { return AuthService.changePassword(u, p); },
    'auth.me':             function (u) { return AuthService.me(u); },

    // Users (Admin)
    'user.list':    function (u, p) { return UserService.list(u, p); },
    'personnel.list': function (u) { return UserService.certifiedList(u); },
    'user.get':     function (u, p) { return UserService.get(u, p); },
    'user.approve': function (u, p) { return UserService.approve(u, p); },
    'user.reject':  function (u, p) { return UserService.reject(u, p); },
    'user.create':  function (u, p) { return UserService.create(u, p); },
    'user.update':  function (u, p) { return UserService.update(u, p); },
    'user.disable': function (u, p) { return UserService.disable(u, p); },
    'user.delete':  function (u, p) { return UserService.deleteUser(u, p); },
    'user.enable':  function (u, p) { return UserService.enable(u, p); },
    'user.unlock':  function (u, p) { return UserService.unlock(u, p); },
    'user.resetPasswordByAdmin': function (u, p) { return UserService.resetPasswordByAdmin(u, p); },
    'user.setDelegation':        function (u, p) { return UserService.setDelegation(u, p); },
    'user.export':  function (u) { return UserService.exportList(u); },

    // 個人帳號管理（修改需管理員審核）
    'profile.get':           function (u) { return UserService.myProfile(u); },
    'profile.requestChange': function (u, p) { return UserService.requestProfileChange(u, p); },
    'profile.cancelRequest': function (u, p) { return UserService.cancelProfileChange(u, p); },
    'admin.testMode.enable':      function (u) { return TestModeService.enable(u); },
    'admin.testMode.personas':    function (u) { return TestModeService.personas(u); },
    'admin.testMode.impersonate': function (u, p, m) { return TestModeService.impersonate(u, p, m); },
    'admin.testMode.reset':       function (u) { return TestModeService.reset(u); },
    'admin.profileReq.list':    function (u) { return UserService.profileRequestList(u); },
    'admin.profileReq.approve': function (u, p) { return UserService.profileRequestApprove(u, p); },
    'admin.profileReq.reject':  function (u, p) { return UserService.profileRequestReject(u, p); },

    // Companies
    'company.list':    function (u) { return CompanyService.list(u); },
    'company.create':  function (u, p) { return CompanyService.create(u, p); },
    'company.update':  function (u, p) { return CompanyService.update(u, p); },
    'company.disable': function (u, p) { return CompanyService.disable(u, p); },
    'company.enable':  function (u, p) { return CompanyService.enable(u, p); },
    'company.stats':   function (u, p) { return CompanyService.stats(u, p); },

    // Dashboard
    'ptw.dashboard':   function (u) { return DashboardService.dashboard(u); },
    'ptw.board':       function (u) { return DashboardService.board(u); },
    'contact.get':     function () { return ok_({ info: String(getSetting_('contactInfo') || ''),
      infoEn: String(getSetting_('contactInfoEn') || '') }); },
    'admin.contact.set': function (u, p) {
      SecurityService.requireAdmin(u);
      if (p && p.text !== undefined) setSetting_('contactInfo', String(p.text || ''), u.id);
      if (p && p.textEn !== undefined) setSetting_('contactInfoEn', String(p.textEn || ''), u.id);
      AuditService.log({ user: u, actionType: 'CONTACT_INFO_SET', entityType: 'Settings',
        entityId: 'contactInfo', success: true });
      return ok_({ saved: true });
    },
    'company.options': function () { return CompanyService.options(); },

    // Training / Exam
    'training.getCourse':      function (u, p) { return TrainingService.getCourse(u, p); },
    'admin.training.courses':  function (u) { return TrainingService.adminCourses(u); },
    'admin.issueList.get':     function (u) { return NotificationService.issueListGet(u); },
    'admin.ccMail.get':        function (u) { return NotificationService.ccMailGet(u); },
    'admin.ccMail.set':        function (u, p) { return NotificationService.ccMailSet(u, p); },
    'admin.mail.test':         function (u, p) { return NotificationService.mailTest(u, p); },
    'admin.system.factoryReset': function (u, p) { return TestModeService.factoryReset(u, p); },
    // 關單文件規則：檢視全表＋將「建議」項目升級為「必要」
    'admin.closeout.rules': function (u) {
      SecurityService.requireAdmin(u);
      var up = CloseoutRules.upgraded();
      return ok_({ rules: CloseoutRules.all().map(function (r) {
        return { key: r.key, level: (r.level === 'recommended' && up[r.key]) ? 'required' : r.level,
          baseLevel: r.level, upgraded: !!up[r.key], zh: r.zh, en: r.en,
          when: (r.when === 'always') ? 'always' : r.when };
      }) });
    },
    'admin.closeout.setRequired': function (u, p) {
      SecurityService.requireAdmin(u);
      var keys = (p && p.keys) || [];
      if (!(keys instanceof Array)) keys = String(keys).split(/[\s,;]+/);
      var valid = {}; CloseoutRules.all().forEach(function (r) { if (r.level === 'recommended') valid[r.key] = true; });
      keys = keys.filter(function (k) { return valid[k]; });
      setSetting_('closeoutRequiredKeys', keys.join(','), u.id);
      AuditService.log({ user: u, actionType: 'CLOSEOUT_RULES_SET', entityType: 'Settings',
        entityId: 'closeoutRequiredKeys', newValue: keys.join(','), success: true });
      return ok_({ saved: true, keys: keys });
    },
    'admin.issueList.set':     function (u, p) { return NotificationService.issueListSet(u, p); },
    'training.reportProgress': function (u, p) { return TrainingService.reportProgress(u, p); },
    'exam.start':              function (u, p) { return ExamService.start(u, p); },
    'exam.submit':             function (u, p) { return ExamService.submit(u, p); },
    'exam.myHistory':          function (u) { return ExamService.myHistory(u); },
    'admin.training.setCourse': function (u, p) { return TrainingService.setCourse(u, p); },
    'admin.training.records':   function (u) { return TrainingService.records(u); },
    'admin.training.reopen':    function (u, p) { return TrainingService.reopen(u, p); },
    'admin.question.list':    function (u) { return ExamService.qList(u); },
    'admin.question.save':    function (u, p) { return ExamService.qSave(u, p); },
    'admin.question.disable': function (u, p) { return ExamService.qDisable(u, p); },
    'admin.question.deleteMany': function (u, p) { return ExamService.qDeleteMany(u, p); },
    'admin.question.setMust': function (u, p) { return ExamService.qSetMust(u, p); },
    'admin.question.setMustMany': function (u, p) { return ExamService.qSetMustMany(u, p); },
    'admin.question.import':  function (u, p) { return ExamService.qImport(u, p); },
    'admin.question.export':  function (u) { return ExamService.qExport(u); },

    // PTW（M3.3）
    'ptw.createDraft': function (u) { return PTWService.createDraft(u); },
    'ptw.saveDraft':   function (u, p) { return PTWService.saveDraft(u, p); },
    'ptw.get':         function (u, p) { return PTWService.get(u, p); },
    'ptw.list':        function (u, p) { return PTWService.list(u, p); },
    'ptw.submit':      function (u, p) { return PTWService.submit(u, p); },
    'ptw.withdraw':    function (u, p) { return PTWService.withdraw(u, p); },
    'ptw.delete':      function (u, p) { return PTWService.deletePtw(u, p); },
    'ptw.pickerUsers': function (u, p) { return PTWService.pickerUsers(u, p); },
    'ptw.nextReviewers': function (u, p) { return PTWService.nextReviewers(u, p); },
    'cert.save':       function (u, p) { return CertificateService.save(u, p); },
    'cert.deactivate': function (u, p) { return CertificateService.deactivate(u, p); },

    // 簽核（M3.4）
    'approval.approve':  function (u, p, m) { return ApprovalService.approve(u, p, m); },
    'approval.return':   function (u, p, m) { return ApprovalService.returnPtw(u, p, m); },
    'approval.activate': function (u, p) { return ApprovalService.activate(u, p); },
    'approval.history':  function (u, p) { return ApprovalService.history(u, p); },
    'admin.ptw.forceStage': function (u, p, m) { return ApprovalService.adminForceStage(u, p, m); },
    'attach.upload':     function (u, p) { return DriveService.uploadAttachment(u, p); },
    'attach.list':       function (u, p) { return DriveService.listAttachments(u, p); },
    'attach.disable':    function (u, p) { return DriveService.disableAttachment(u, p); },

    // Phase 4：PDF / 生命週期 / 證書欄位定義
    'ptw.siteHtml':    function (u, p) { return PdfService.siteHtml(u, p); },
    'ptw.saveSitePdf': function (u, p) { return DriveService.saveSitePdf(u, p); },
    'ptw.exportPdf':          function (u, p) { return PdfService.exportPdf(u, p); },
    'ptw.suspend':            function (u, p) { return LifecycleService.suspend(u, p); },
    'ptw.resume':             function (u, p) { return LifecycleService.resume(u, p); },
    'ptw.requestClosure':     function (u, p) { return LifecycleService.requestClosure(u, p); },
    'ptw.close':              function (u, p) { return LifecycleService.close(u, p); },
    'ptw.closeoutConfirm':    function (u, p) { return LifecycleService.closeoutConfirm(u, p); },
    'ptw.closeoutReturn':     function (u, p) { return LifecycleService.closeoutReturn(u, p); },
    'system.certForms':       function () { return ok_(CERT_FIELD_DEFS); },

    // Phase 4 收尾：報表 / 版本比較 / 代理簽核
    'report.overdue':         function (u) { return ReportService.overdue(u); },
    'admin.numbers.overview': function (u) { return ReportService.numbersOverview(u); },
    'report.byCompany':       function (u) { return ReportService.byCompany(u); },
    'report.byType':          function (u) { return ReportService.byType(u); },
    'report.monthly':         function (u) { return ReportService.monthly(u); },
    'report.approvalsExport': function (u) { return ReportService.approvalsExport(u); },
    'ptw.versionDiff':        function (u, p) { return ReportService.versionDiff(u, p); },
    'admin.delegation.list':    function (u) { return ReportService.delegationList(u); },
    'admin.delegation.disable': function (u, p) { return ReportService.delegationDisable(u, p); },

    // Notifications
    'notify.list':     function (u, p) { return NotificationService.listMine(u, p); },
    'notify.markRead': function (u, p) { return NotificationService.markRead(u, p); },

    // Audit (Admin / T5)
    'admin.audit.list': function (u, p) { return AuditService.list(u, p); },

    // ---- 合併端點（一個畫面一次呼叫，大幅減少往返） ----
    'home.bootstrap': function (u) { return ok_(homeBundle_(u)); },
    'home.public': function (u) {   // 未登入首頁一次取回（原本 3 支呼叫）
      return ok_({
        downloads: DriveService.listDownloads().data,
        board: DashboardService.board(u).data,
        announcements: DriveService.announceList().data
      });
    },
    'ptw.open': function (u, p) {
      var g = PTWService.get(u, p).data; // 主表失敗＝真錯誤，照常擲出
      var safe = function (fn, fb) { try { return fn(); } catch (e) { console.error('ptw.open part: ' + e.message); return fb; } };
      return ok_({
        ptw: g,
        history: safe(function () { return ApprovalService.history(u, p).data; }, { approvals: [], statusHistory: [] }),
        versions: safe(function () { return ReportService.versionDiff(u, { ptwId: p.ptwId }).data.versions; }, []),
        attachments: safe(function () { return DriveService.listAttachments(u, p).data; }, []),
        pickers: safe(function () { return PTWService.pickerUsers(u, p).data; }, []),   // 依該 PTW 的申請公司過濾
        companies: safe(function () { return CompanyService.list(u).data; }, []),       // 申請公司下拉／名稱對照
        closeoutDocs: safe(function () { return CloseoutRules.forPtw(g); }, []),        // 依作業類型算出的關單文件清單
        mySignature: safe(function () { return DriveService.getSignatureBase64(u.signatureFileId); }, ''),
        certForms: CERT_FIELD_DEFS
      });
    },
    'admin.bootstrap': function (u) {
      SecurityService.requireAdmin(u);
      // 各區塊容錯：單一區塊失敗回 null，前端自動改走個別 API（錯誤在該 API 明確呈現）
      var safe = function (fn) { try { return fn().data; } catch (e) { console.error('admin.bootstrap part failed: ' + e.message); return null; } };
      return ok_({
        companies: safe(function () { return CompanyService.list(u); }),
        pendingUsers: safe(function () { return UserService.list(u, { status: 'PendingApproval' }); }),
        users: safe(function () { return UserService.list(u, {}); }),
        profileReqs: safe(function () { return UserService.profileRequestList(u); }),
        course: safe(function () { return TrainingService.getCourse(u); }),
        questions: safe(function () { return ExamService.qList(u); }),
        records: safe(function () { return TrainingService.records(u); }),
        audit: safe(function () { return AuditService.list(u, { page: 1, pageSize: 100 }); })
      });
    },

    // 下載專區（(6)）
    'downloads.list':          function () { return DriveService.listDownloads(); },
    'announce.list':          function () { return DriveService.announceList(); },
    'admin.announce.add':     function (u, p) { return DriveService.announceAdd(u, p); },
    'admin.announce.disable': function (u, p) { return DriveService.announceDisable(u, p); },
    'admin.download.upload':   function (u, p) { return DriveService.uploadPublicDoc(u, p); },
    'admin.download.disable':  function (u, p) { return DriveService.disableDownload(u, p); },
    // 使用者詳情 / 簽名
    'user.detail':             function (u, p) { return UserService.detail(u, p); },
    'profile.updateSignature': function (u, p) { return UserService.updateSignature(u, p); },

    // System
    'system.ping': function () { return ok_({ pong: true, time: fmtDateTime_(), tz: CFG.TIMEZONE }); }
  };
}

/** 核心處理：doPost 與 google.script.run（apiCall）共用 */
function handleRequest_(req) {
  var action = String((req && req.action) || '');
  var payload = (req && req.payload) || {};
  var meta = {
    token: (req && req.token) || '',
    userAgent: (req && req.meta && req.meta.userAgent) || '',
    clientInfo: (req && req.meta && req.meta.clientInfo) || ''
  };
  var table = routes_();
  if (!table[action]) return err_('UNKNOWN_ACTION', 'Unknown action: ' + action, '未知的操作：' + action);

  var t0 = Date.now();
  try {
    var user = null;
    if (!PUBLIC_ACTIONS[action]) {
      user = AuthService.verifySession(meta.token);
    } else if (meta.token) {
      // 公開路由若帶有效 token 則附上身分（例：看板對管理員/測試身分顯示測試 PTW）；無效則視同未登入
      try { user = AuthService.verifySession(meta.token); } catch (eTok) { user = null; }
    }
    var result = table[action](user, payload, meta);
    if (result && typeof result === 'object') result.serverMs = Date.now() - t0;
    return result;
  } catch (ex) {
    var errRes;
    if (ex && ex.apiCode) {
      errRes = err_(ex.apiCode, ex.msgEn, ex.msgZh);
    } else {
      console.error('API error [' + action + ']: ' + ex.message + '\n' + (ex.stack || ''));
      AuditService.log({ userName: 'system', actionType: 'API_ERROR', entityType: action,
        comment: ex.message, success: false });
      // 帶出實際錯誤訊息，方便排障（內部系統，非公開服務）
      errRes = err_('INTERNAL', 'Internal error: ' + ex.message,
        '系統內部錯誤：' + ex.message);
    }
    errRes.serverMs = Date.now() - t0;
    return errRes;
  }
}

function doPost(e) {
  var req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return json_(err_('BAD_JSON', 'Request body is not valid JSON', '請求格式錯誤'));
  }
  return json_(handleRequest_(req));
}

/** google.script.run 橋接（HtmlService 前端用；免 CORS、免 API URL 設定） */
function apiCall(requestJson) {
  var req = {};
  try { req = JSON.parse(requestJson || '{}'); }
  catch (e) { return JSON.stringify(err_('BAD_JSON', 'Bad request', '請求格式錯誤')); }
  return JSON.stringify(handleRequest_(req));
}

function doGet(e) {
  // API 健康檢查：<url>?api=ping ；預設回傳內嵌前端（見 OneClick.gs 的 doGet 覆寫）
  return json_(ok_({ service: 'Offshore PTW System API', time: fmtDateTime_(), version: 'M3.1' }));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================== Tests.gs ============================== */
/**
 * Tests.gs — M3.1 伺服器端測試（在 GAS 編輯器直接執行 runAllTests_M31）
 * 測試會建立 TEST- 開頭的資料；testCleanup() 可停用測試帳號。
 */


/** 測試輔助：上傳必要附件（Method Statement + Risk Assessment） */
function attachMsRa_(user, ptwId) {
  var b64 = Utilities.base64Encode('test-doc');
  ['MethodStatement', 'RiskAssessment'].forEach(function (cat) {
    var has = Repo.findOne('PTW_Attachments', function (a) {
      return a.ptwId === ptwId && a.category === cat && asBool_(a.isActive);
    });
    if (!has) {
      DriveService.uploadAttachment(user, { ptwId: ptwId, fileName: cat + '.pdf',
        mimeType: 'application/pdf', base64: b64, category: cat });
    }
  });
}

function runAllTests_M31() {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push('✅ ' + name); }
    catch (e) { results.push('❌ ' + name + ' → ' + e.message); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); };

  var testEmail = 'test-applicant@example.com';
  var testPw = 'Test1234';

  t('T01 initSystem 已建立所有工作表', function () {
    Object.keys(SHEETS).forEach(function (name) {
      assert(getSpreadsheet_().getSheetByName(name), 'missing sheet ' + name);
    });
  });

  t('T02 密碼雜湊：相同輸入相同輸出、不同 salt 不同輸出', function () {
    var h1 = hashPassword_('abc12345', 'SALT_A');
    var h2 = hashPassword_('abc12345', 'SALT_A');
    var h3 = hashPassword_('abc12345', 'SALT_B');
    assert(h1 === h2 && h1 !== h3, 'hash behaviour wrong');
  });

  t('T03 公式注入防護', function () {
    assert(sanitizeCell_('=1+1') === "'=1+1", 'formula not escaped');
    assert(sanitizeCell_('normal') === 'normal', 'normal string altered');
  });

  t('T04 帳號申請 → PendingApproval，未核准不得登入', function () {
    var existing = Repo.findOne('Users', function (u) { return u.email === testEmail; });
    if (!existing) {
      AuthService.applyAccount({
        nameZh: '測試員', nameEn: 'Test Applicant', companyName: 'NMDC',
        title: 'Tester', email: testEmail, phone: '0912345678',
        password: testPw, confirmPassword: testPw, vessel: 'TEST-VESSEL',
        applyReason: 'test', appliedTier: 1,
        signatureBase64: Utilities.base64Encode('test-signature-png')
      }, { userAgent: 'test' });
    }
    var login = AuthService.login({ email: testEmail, password: testPw }, { userAgent: 'test' });
    assert(login.ok === false && login.errorCode === 'PENDING_APPROVAL', 'pending user should not log in');
  });

  t('T05 管理員核准後可登入、密碼錯誤累計、鎖定', function () {
    var admin = Repo.findOne('Users', function (u) { return asBool_(u.isAdmin); });
    var target = Repo.findOne('Users', function (u) { return u.email === testEmail; });
    var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC'; });
    if (target.status === 'PendingApproval') {
      UserService.approve(admin, { userId: target.id, companyId: nmdc.id, tier: 1 });
    }
    var okLogin = AuthService.login({ email: testEmail, password: testPw }, { userAgent: 'test' });
    assert(okLogin.ok === true && okLogin.data.token, 'approved user should log in');
    var badLogin = AuthService.login({ email: testEmail, password: 'WRONG1234' }, { userAgent: 'test' });
    assert(badLogin.ok === false && badLogin.errorCode === 'BAD_CREDENTIALS', 'wrong password accepted?');
    var u = Repo.findOne('Users', function (x) { return x.email === testEmail; });
    assert(Number(u.failedLoginCount) >= 1, 'failedLoginCount not incremented');
  });

  t('T06 Session 驗證與登出撤銷', function () {
    var login = AuthService.login({ email: testEmail, password: testPw }, { userAgent: 'test' });
    var token = login.data.token;
    var user = AuthService.verifySession(token);
    assert(user.email === testEmail, 'session user mismatch');
    AuthService.logout(user, token);
    var revoked = false;
    try { AuthService.verifySession(token); } catch (e) { revoked = true; }
    assert(revoked, 'revoked session still valid');
  });

  t('T07 RBAC：Tier1 不可呼叫 user.list', function () {
    var t1 = Repo.findOne('Users', function (u) { return u.email === testEmail; });
    var denied = false;
    try { UserService.list(t1, {}); } catch (e) { denied = (e.apiCode === 'FORBIDDEN'); }
    assert(denied, 'Tier1 accessed admin API');
  });

  t('T08 SequenceService 連號且不重複', function () {
    var a = SequenceService.next('TMP');
    var b = SequenceService.next('TMP');
    assert(a !== b, 'duplicated number');
    var na = Number(a.match(/(\d+)$/)[1]), nb = Number(b.match(/(\d+)$/)[1]);
    assert(nb === na + 1, 'not sequential: ' + a + ' → ' + b);
  });

  t('T09 nextTaipeiMidnight 為未來時間且 00:00', function () {
    var d = nextTaipeiMidnight_();
    assert(d.getTime() > Date.now(), 'not future');
    assert(fmtTime_(d) === '00:00', 'not midnight Taipei: ' + fmtTime_(d));
  });

  t('T10 AuditLog 有 LOGIN 紀錄', function () {
    var rows = Repo.find('AuditLog', function (r) { return r.actionType === 'LOGIN'; });
    assert(rows.length > 0, 'no LOGIN audit rows');
  });

  console.log('\n===== M3.1 Test Results =====\n' + results.join('\n'));
  return results;
}

/** M3.2 訓練＋考試測試（先跑 runAllTests_M31 以確保測試帳號存在） */
function runAllTests_M32() {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push('✅ ' + name); }
    catch (e) { results.push('❌ ' + name + ' → ' + e.message); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); };

  var admin = Repo.findOne('Users', function (u) { return asBool_(u.isAdmin); });
  var testEmail = 'test-applicant@example.com';
  var t1 = Repo.findOne('Users', function (u) { return u.email === testEmail; });
  if (!t1) throw new Error('先執行 runAllTests_M31 建立測試帳號');
  if (t1.status !== 'Active') { Repo.update('Users', t1.id, { status: 'Active', isActive: true }, 'test'); t1 = Repo.getById('Users', t1.id); }

  // 設定測試課程（120 秒短片）
  TrainingService.setCourse(admin, { title: 'TEST Course', youtubeVideoId: 'dQw4w9WgXcQ', durationSec: 120, courseVersion: 'test-v1' });
  var course = TrainingService.activeCourse();

  t('T11 未看影片 → exam.start 拒絕', function () {
    // 清掉舊進度
    Repo.find('TrainingProgress', function (p) { return p.userId === t1.id; })
      .forEach(function (p) { Repo.update('TrainingProgress', p.id, { isActive: false }, 'test'); });
    var denied = false;
    try { ExamService.start(t1); } catch (e) { denied = (e.apiCode === 'VIDEO_NOT_COMPLETED'); }
    assert(denied, 'exam started without video');
  });

  t('T12 進度回報累計且防灌秒（單次 1000 秒被上限截斷）', function () {
    var r = TrainingService.reportProgress(t1, { courseId: course.id, deltaSec: 1000 });
    assert(r.data.watchedSec <= 135, 'anti-cheat cap failed: ' + r.data.watchedSec); // ≤120 上限＋容差
  });

  t('T13 觀看 ≥90% → completed', function () {
    // 連續回報到 108 秒（90% of 120）
    for (var i = 0; i < 10; i++) {
      Repo.find('TrainingProgress', function (p) { return p.userId === t1.id && asBool_(p.isActive); })
        .forEach(function (p) { Repo.update('TrainingProgress', p.id, { updatedAt: '2020-01-01 00:00:00' }, 'test'); });
      var r = TrainingService.reportProgress(t1, { courseId: course.id, deltaSec: 15 });
      if (r.data.completed) break;
    }
    var prog = TrainingService.myProgress(t1.id, course.id);
    assert(asBool_(prog.completed), 'not completed: ' + prog.watchedSec + 's');
  });

  var attemptId, questions;
  t('T14 exam.start 出 19 題（18 MC×5 + 1 Match×10）且不含答案', function () {
    var r = ExamService.start(t1);
    attemptId = r.data.attemptId; questions = r.data.questions;
    assert(questions.length === 19, 'expected 19 questions, got ' + questions.length);
    var mc = questions.filter(function (q) { return q.type === 'MC'; });
    var mt = questions.filter(function (q) { return q.type === 'Match'; });
    assert(mc.length === 18 && mt.length === 1, 'MC=' + mc.length + ' Match=' + mt.length);
    assert(mc.every(function (q) { return Number(q.points) === 5; }), 'MC points must be 5');
    assert(Number(mt[0].points) === 10, 'Match points must be 10');
    assert(!JSON.stringify(questions).match(/"answer"/), 'answers leaked to client!');
  });

  t('T15 重新 start 回同一份題組（防重新整理換題）', function () {
    var r = ExamService.start(t1);
    assert(r.data.resumed === true && r.data.attemptId === attemptId, 'question set changed on refresh');
  });

  t('T16 全對交卷 → 100 分通過、效期 +36 個月', function () {
    var full = JSON.parse(Repo.getById('ExamAttempts', attemptId).questionSetJson);
    var answers = {};
    full.forEach(function (q) {
      answers[q.questionId] = (q.type === 'MC')
        ? (q.answer.correct !== undefined ? q.answer.correct : q.answer)
        : q.answer;
    });
    var r = ExamService.submit(t1, { attemptId: attemptId, answers: answers });
    assert(r.data.score === 100 && r.data.passed === true, 'score=' + r.data.score);
    var u = Repo.getById('Users', t1.id);
    assert(u.trainingValidUntil && u.trainingValidUntil > fmtDate_(), 'validUntil not set');
  });

  t('T17 重複交卷被拒', function () {
    var denied = false;
    try { ExamService.submit(t1, { attemptId: attemptId, answers: {} }); }
    catch (e) { denied = (e.apiCode === 'ALREADY_SUBMITTED'); }
    assert(denied, 'double submit accepted');
  });

  t('T18 全錯交卷 → 未通過、鎖定至隔日、同日再考被拒', function () {
    var r0 = ExamService.start(t1); // 新場次
    var full = JSON.parse(Repo.getById('ExamAttempts', r0.data.attemptId).questionSetJson);
    var answers = {};
    full.forEach(function (q) { answers[q.questionId] = (q.type === 'MC') ? '__WRONG__' : {}; });
    var r = ExamService.submit(t1, { attemptId: r0.data.attemptId, answers: answers });
    assert(r.data.passed === false && r.data.score === 0, 'score=' + r.data.score);
    assert(r.data.nextExamDate === fmtDate_(nextTaipeiMidnight_()), 'nextDate wrong: ' + r.data.nextExamDate);
    var denied = false;
    try { ExamService.start(t1); } catch (e) { denied = (e.apiCode === 'EXAM_LOCKED'); }
    assert(denied, 'same-day retake allowed');
  });

  t('T19 Admin 重新開放 → 可再考', function () {
    TrainingService.reopen(admin, { userId: t1.id });
    var r = ExamService.start(t1);
    assert(r.data.attemptId, 'cannot start after reopen');
    // 清理：作廢這場未交卷 attempt
    Repo.update('ExamAttempts', r.data.attemptId, { submitAt: fmtDateTime_(), score: 0, passed: false }, 'test');
  });

  t('T20 題庫管理：新增/停用/匯出', function () {
    var saved = ExamService.qSave(admin, { type: 'MC', questionZh: '測試題', questionEn: 'Test Q',
      optionsJson: '["A","B","C"]', answerJson: '{"correct":"A"}', points: 10, category: 'TEST' });
    ExamService.qDisable(admin, { id: saved.data.id });
    var q = Repo.getById('QuestionBank', saved.data.id);
    assert(!asBool_(q.isActive), 'disable failed');
    var exp = ExamService.qExport(admin);
    assert(exp.data.json.indexOf('測試題') >= 0, 'export missing question');
  });

  console.log('\n===== M3.2 Test Results =====\n' + results.join('\n'));
  return results;
}

/** M3.3 PTW 申請測試（需先跑 M31、M32 使測試帳號通過訓練） */
function runAllTests_M33() {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push('✅ ' + name); }
    catch (e) { results.push('❌ ' + name + ' → ' + e.message); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); };

  var admin = Repo.findOne('Users', function (u) { return asBool_(u.isAdmin); });
  var t1 = Repo.findOne('Users', function (u) { return u.email === 'test-applicant@example.com'; });
  var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC'; });
  if (t1.status !== 'Active') { Repo.update('Users', t1.id, { status: 'Active', isActive: true }, 'test'); t1 = Repo.getById('Users', t1.id); }

  t('T21 未通過訓練者不得建立 PTW（測試案例1）', function () {
    var old = t1.trainingValidUntil;
    Repo.update('Users', t1.id, { trainingValidUntil: '' }, 'test');
    var fresh = Repo.getById('Users', t1.id);
    var denied = false;
    try { PTWService.createDraft(fresh); } catch (e) { denied = (e.apiCode === 'TRAINING_REQUIRED'); }
    Repo.update('Users', t1.id, { trainingValidUntil: old || '2029-12-31' }, 'test');
    t1 = Repo.getById('Users', t1.id);
    assert(denied, 'untrained user created PTW');
  });

  var ptwId;
  t('T22 建立草稿：TMP 編號唯一遞增', function () {
    var a = PTWService.createDraft(t1); var b = PTWService.createDraft(t1);
    assert(a.data.tempNumber !== b.data.tempNumber, 'temp numbers duplicated');
    ptwId = a.data.ptwId;
    // 取消第二張
    PTWService.withdraw(t1, { ptwId: b.data.ptwId });
  });

  t('T23 儲存草稿與讀回（欄位 + 勾選 + 氣測列）', function () {
    PTWService.saveDraft(t1, { ptwId: ptwId,
      vessel: 'DLB-TEST', executionDate: '2026-08-01', areaLocation: 'KP0+300 潮間帶',
      workDescription: '海管焊接 Hot work on pipeline', toolsEquipment: '電焊機 Welder',
      validFrom: '2026-08-01 08:00:00', validTo: '2026-08-01 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'Y', gasTestInterval: 'Continuous', cssIsoRequired: 'N',
      wtHotWork: true, holderUserId: t1.id, paUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzFireExplosion: true, hzNakedFlame: true, pcFireExt: true, pcFireWatch: true }),
      gasTestsJson: JSON.stringify([{ o2: '20.9', lel: '0', tester: 'AGT Wang', date: '2026-08-01', time: '07:30' }])
    });
    var g = PTWService.get(t1, { ptwId: ptwId });
    assert(g.data.vessel === 'DLB-TEST', 'field roundtrip failed');
    assert(g.data.validHours === 10, 'validHours calc: ' + g.data.validHours);
    assert(g.data.requiredCerts.length === 1 && g.data.requiredCerts[0] === 'HW', 'requiredCerts wrong');
    assert(JSON.parse(g.data.gasTestsJson).length === 1, 'gas rows lost');
  });

  t('T24 勾選動火但未完成證書 → 提交被拒（測試案例10）', function () {
    attachMsRa_(t1, ptwId);
    var r = PTWService.submit(t1, { ptwId: ptwId });
    assert(r.ok === false && r.errorCode === 'VALIDATION_FAILED', 'submit allowed without HW cert');
    assert(r.msgZh.indexOf('動火') >= 0, 'error message should mention Hot Work cert: ' + r.msgZh);
  });

  t('T25 完成動火證書（HW-xxxx 編號）→ 提交成功 → PendingTier2 + 版本快照', function () {
    var c = CertificateService.save(t1, { ptwId: ptwId, certType: 'HW',
      dataJson: JSON.stringify({ hw_date: '2026-08-01', hw_location: 'KP0+300', hw_workDescription: '焊接',
        hw_hz01: 'Y', hw_ctrl01: 'Y', hw_wsc01: 'Y' }), markComplete: true });
    assert(/^HW-\d{4}$/.test(c.data.certNo), 'cert no format: ' + c.data.certNo);
    attachMsRa_(t1, ptwId);
    var r = PTWService.submit(t1, { ptwId: ptwId });
    assert(r.ok === true && r.data.status === CFG.STATUS.PENDING_T2, 'submit failed: ' + JSON.stringify(r));
    var ver = Repo.findOne('PTW_Versions', function (v) { return v.ptwId === ptwId; });
    assert(ver && JSON.parse(ver.snapshotJson).vessel === 'DLB-TEST', 'version snapshot missing');
    var m = Repo.getById('PTW_Master', ptwId);
    assert(Number(m.currentTier) === 2, 'currentTier should be 2');
  });

  t('T26 提交後不可再編輯、不可重複提交', function () {
    var denied = false;
    try { PTWService.saveDraft(t1, { ptwId: ptwId, vessel: 'HACK' }); }
    catch (e) { denied = (e.apiCode === 'BAD_STATE'); }
    assert(denied, 'edited a submitted PTW');
    var denied2 = false;
    try { PTWService.submit(t1, { ptwId: ptwId }); }
    catch (e) { denied2 = (e.apiCode === 'BAD_STATE'); }
    assert(denied2, 'double submit allowed');
  });

  t('T27 資料範圍：他公司 Tier1 不可見（測試案例13）', function () {
    // 建立另一家公司與使用者
    var co = Repo.findOne('Companies', function (c) { return c.nameEn === 'TEST-CO-B'; }) ||
      Repo.insert('Companies', { nameZh: '測試公司B', nameEn: 'TEST-CO-B', type: 'Contractor' }, 'test');
    var other = Repo.findOne('Users', function (u) { return u.email === 'test-other@example.com'; }) ||
      Repo.insert('Users', { email: 'test-other@example.com', nameZh: '別家', nameEn: 'Other', companyId: co.id,
        title: 'T', phone: '', vessel: '', tier: 1, isAdmin: false, passwordSalt: 'x', passwordHash: 'x',
        status: 'Active', failedLoginCount: 0, mustChangePassword: false, langPref: 'en' }, 'test');
    var denied = false;
    try { PTWService.get(other, { ptwId: ptwId }); }
    catch (e) { denied = (e.apiCode === 'FORBIDDEN_SCOPE'); }
    assert(denied, 'cross-company access allowed');
    var listOther = PTWService.list(other, {});
    assert(listOther.data.rows.every(function (r) { return r.id !== ptwId; }), 'cross-company PTW in list');
  });

  t('T28 Dashboard KPI 反映待簽核 + Tier2 佇列', function () {
    var d = DashboardService.dashboard(admin);
    assert(d.data.kpi.pending >= 1, 'pending KPI should be ≥1');
    // 建 Tier2 同公司審查者 → 佇列應含此 PTW
    var t2 = Repo.findOne('Users', function (u) { return u.email === 'test-t2@example.com'; }) ||
      Repo.insert('Users', { email: 'test-t2@example.com', nameZh: '工安', nameEn: 'HSE-T2', companyId: t1.companyId,
        title: 'HSE', phone: '', vessel: '', tier: 2, isAdmin: false, passwordSalt: 'x', passwordHash: 'x',
        status: 'Active', failedLoginCount: 0, mustChangePassword: false, langPref: 'en' }, 'test');
    var d2 = DashboardService.dashboard(Repo.getById('Users', t2.id));
    assert(d2.data.myQueue.some(function (q) { return q.id === ptwId; }), 'Tier2 queue missing the PTW');
  });

  console.log('\n===== M3.3 Test Results =====\n' + results.join('\n'));
  return results;
}

/** M3.4 簽核流程測試（需先跑 M31–M33 產生 PendingTier2 的 PTW） */
function runAllTests_M34() {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push('✅ ' + name); }
    catch (e) { results.push('❌ ' + name + ' → ' + e.message); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); };

  var t1 = Repo.findOne('Users', function (u) { return u.email === 'test-applicant@example.com'; });
  var t2 = Repo.findOne('Users', function (u) { return u.email === 'test-t2@example.com'; });
  var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC'; });
  var mk = function (email, tier) {
    var u = Repo.findOne('Users', function (x) { return x.email === email; });
    if (!u) u = Repo.insert('Users', { email: email, nameZh: 'T' + tier, nameEn: 'Tier' + tier, companyId: nmdc.id,
      title: 'R', phone: '', vessel: '', tier: tier, isAdmin: tier === 5, passwordSalt: 'x', passwordHash: 'x',
      status: 'Active', failedLoginCount: 0, mustChangePassword: false, langPref: 'en' }, 'test');
    return u;
  };
  var t3 = mk('test-t3@example.com', 3), t4 = mk('test-t4@example.com', 4), t5 = mk('test-t5@example.com', 5);
  var m = Repo.findOne('PTW_Master', function (p) { return p.status === CFG.STATUS.PENDING_T2 && asBool_(p.isActive); });
  if (!m) throw new Error('先執行 runAllTests_M33 產生待審 PTW');
  var ptwId = m.id;
  var SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  t('T29 Tier1 不得核准自己的 PTW（測試案例4）', function () {
    var denied = false;
    try { ApprovalService.approve(t1, { ptwId: ptwId, signatureDataUrl: SIG }, {}); }
    catch (e) { denied = (e.apiCode === 'SELF_APPROVAL' || e.apiCode === 'NOT_YOUR_TURN'); }
    assert(denied, 'applicant approved own PTW');
  });

  t('T30 Tier3 不得跳過 Tier2 直接核准（測試案例5）', function () {
    var denied = false;
    try { ApprovalService.approve(t3, { ptwId: ptwId, signatureDataUrl: SIG }, {}); }
    catch (e) { denied = (e.apiCode === 'NOT_YOUR_TURN'); }
    assert(denied, 'tier skipping allowed');
  });

  t('T31 退回未填 Comment 不得送出（測試案例6）', function () {
    var denied = false;
    try { ApprovalService.returnPtw(t2, { ptwId: ptwId, comment: '  ', returnReason: 'Other' }, {}); }
    catch (e) { denied = (e.apiCode === 'COMMENT_REQUIRED' || e.apiCode === 'MISSING_FIELDS'); }
    assert(denied, 'return without comment accepted');
  });

  t('T32 Tier2 退回申請人 → Returned、簽名作廢、申請人可修改（測試案例7）', function () {
    // 先核准一關產生簽名，再由 T3 退回申請人
    ApprovalService.approve(t2, { ptwId: ptwId, signatureDataUrl: SIG, comment: 'ok' }, {});
    var r = ApprovalService.returnPtw(t3, { ptwId: ptwId, comment: '請補危害辨識', returnReason: 'HazardId', target: 'applicant' }, {});
    assert(r.data.newStatus === CFG.STATUS.RETURNED, 'status: ' + r.data.newStatus);
    var sigs = Repo.find('PTW_Signatures', function (s) { return s.ptwId === ptwId; });
    assert(sigs.length > 0 && sigs.every(function (s) { return asBool_(s.isVoided); }), 'signatures not voided');
    // 申請人可修改
    var saved = PTWService.saveDraft(t1, { ptwId: ptwId, areaLocation: 'KP0+300 修訂 rev' });
    assert(saved.ok, 'applicant cannot edit returned PTW');
  });

  t('T33 重新提交 → v2、從 Tier2 重審（測試案例8/9）', function () {
    var r = PTWService.submit(t1, { ptwId: ptwId });
    assert(r.ok && r.data.version === 2, 'version should be 2: ' + JSON.stringify(r.data));
    var m2 = Repo.getById('PTW_Master', ptwId);
    assert(m2.status === CFG.STATUS.PENDING_T2 && Number(m2.currentTier) === 2, 'not back to Tier2');
    var vers = Repo.find('PTW_Versions', function (v) { return v.ptwId === ptwId; });
    assert(vers.length === 2, 'version snapshots: ' + vers.length);
  });

  t('T34 完整簽核鏈 2→3→4→5 → Approved + 正式編號（測試案例17/20）', function () {
    ApprovalService.approve(t2, { ptwId: ptwId, signatureDataUrl: SIG }, {});
    ApprovalService.approve(t3, { ptwId: ptwId, signatureDataUrl: SIG }, {});
    ApprovalService.approve(t4, { ptwId: ptwId, signatureDataUrl: SIG }, {});
    var r = ApprovalService.approve(t5, { ptwId: ptwId, signatureDataUrl: SIG, comment: 'issue' }, {});
    assert(r.data.newStatus === CFG.STATUS.ACTIVE, 'not active on issue: ' + r.data.newStatus);
    assert(/^OPTW-\d{4}$/.test(r.data.number), 'official number: ' + r.data.number);
    var audits = Repo.find('AuditLog', function (a) { return a.actionType === 'PTW_APPROVE' && a.entityId === ptwId; });
    assert(audits.length >= 4, 'approve audit rows: ' + audits.length);
  });

  t('T35 核准即生效：T5 簽發後直接 Active（無需啟用步驟）', function () {
    var mAct = Repo.getById('PTW_Master', ptwId);
    assert(mAct.status === CFG.STATUS.ACTIVE, 'not active after issue: ' + mAct.status);
    assert(mAct.activatedAt, 'activatedAt not set on issue');
  });

  t('T36 簽核歷程完整（含退回與 4 次核准）', function () {
    var h = ApprovalService.history(t5, { ptwId: ptwId });
    var acts = h.data.approvals;
    assert(acts.filter(function (a) { return a.action === 'Approve'; }).length >= 5, 'approve rows');
    assert(acts.some(function (a) { return a.action === 'ReturnToApplicant'; }), 'return row missing');
  });

  t('T37 退回上一關（Q10 Returned for Correction）', function () {
    // 建第二張 PTW 走到 T3，再由 T3 退回上一關 T2
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V2', executionDate: '2026-08-02',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-02 08:00:00', validTo: '2026-08-02 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, holderUserId: t1.id, paUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
    attachMsRa_(t1, d.data.ptwId);
    PTWService.submit(t1, { ptwId: d.data.ptwId });
    ApprovalService.approve(t2, { ptwId: d.data.ptwId, signatureDataUrl: SIG }, {});
    var r = ApprovalService.returnPtw(t3, { ptwId: d.data.ptwId, comment: '請 T2 補確認', returnReason: 'Other', target: 'previousTier' }, {});
    assert(r.data.newStatus === CFG.STATUS.PENDING_T2, 'should be back at T2: ' + r.data.newStatus);
    // T2 可再核准續行
    var r2 = ApprovalService.approve(t2, { ptwId: d.data.ptwId, signatureDataUrl: SIG }, {});
    assert(r2.data.newStatus === CFG.STATUS.PENDING_T3, 'flow not resumed');
  });

  t('T38 資料修改申請：送出→Pending 未生效→核准後生效', function () {
    var fresh = Repo.getById('Users', t1.id);
    var r = UserService.requestProfileChange(fresh, { title: 'Senior Welder', phone: '0987-654-321' });
    assert(r.data.status === 'Pending', 'not pending');
    assert(Repo.getById('Users', t1.id).title !== 'Senior Welder', 'change applied before approval!');
    // 重複申請被拒
    var dup = false;
    try { UserService.requestProfileChange(Repo.getById('Users', t1.id), { title: 'X' }); }
    catch (e) { dup = (e.apiCode === 'REQUEST_EXISTS'); }
    assert(dup, 'duplicate request allowed');
    var admin = Repo.findOne('Users', function (u) { return asBool_(u.isAdmin); });
    UserService.profileRequestApprove(admin, { requestId: r.data.requestId });
    var after = Repo.getById('Users', t1.id);
    assert(after.title === 'Senior Welder' && after.phone === '0987-654-321', 'change not applied after approval');
  });

  t('T39 資料修改申請：拒絕不生效＋附原因', function () {
    var fresh = Repo.getById('Users', t1.id);
    var r = UserService.requestProfileChange(fresh, { vessel: 'HACK-SHIP' });
    var admin = Repo.findOne('Users', function (u) { return asBool_(u.isAdmin); });
    UserService.profileRequestReject(admin, { requestId: r.data.requestId, reason: '船舶名稱不正確' });
    assert(Repo.getById('Users', t1.id).vessel !== 'HACK-SHIP', 'rejected change applied!');
    var req = Repo.getById('ProfileChangeRequests', r.data.requestId);
    assert(req.status === 'Rejected' && req.rejectReason === '船舶名稱不正確', 'reject metadata missing');
  });

  console.log('\n===== M3.4 Test Results =====\n' + results.join('\n'));
  return results;
}

/** M4.1 生命週期＋PDF＋排程測試（需先跑 M31–M34 產生 Active 的 PTW） */
function runAllTests_M41() {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push('✅ ' + name); }
    catch (e) { results.push('❌ ' + name + ' → ' + e.message); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); };

  var t1 = Repo.findOne('Users', function (u) { return u.email === 'test-applicant@example.com'; });
  var t2 = Repo.findOne('Users', function (u) { return u.email === 'test-t2@example.com'; });
  var t3 = Repo.findOne('Users', function (u) { return u.email === 'test-t3@example.com'; });
  var t4 = Repo.findOne('Users', function (u) { return u.email === 'test-t4@example.com'; });
  var t5 = Repo.findOne('Users', function (u) { return u.email === 'test-t5@example.com'; });
  var m = Repo.findOne('PTW_Master', function (p) { return p.status === CFG.STATUS.ACTIVE && asBool_(p.isActive); });
  if (!m) throw new Error('先執行 runAllTests_M34 產生 Active PTW');
  var ptwId = m.id;

  t('T40 證書欄位定義 API（前後端單一來源）', function () {
    assert(CERT_FIELD_DEFS.HW && CERT_FIELD_DEFS.DO && CERT_FIELD_DEFS.CS, 'defs missing');
    assert(CERT_FIELD_DEFS.HW.sections.some(function (s) {
      return s.f.some(function (f) { return f[0] === 'hw_wsc16'; });
    }), 'HW wsc16 missing');
  });

  t('T42 暫停 → Suspended；恢復 → Active', function () {
    LifecycleService.suspend(t5, { ptwId: ptwId, reason: '颱風 Typhoon' });
    assert(Repo.getById('PTW_Master', ptwId).status === CFG.STATUS.SUSPENDED, 'not suspended');
    LifecycleService.resume(t5, { ptwId: ptwId });
    assert(Repo.getById('PTW_Master', ptwId).status === CFG.STATUS.ACTIVE, 'not resumed');
  });

  t('T43 到期掃描：過期 Active → Expired（測試案例15）', function () {
    Repo.update('PTW_Master', ptwId, { validTo: '2020-01-01 00:00:00' }, 'test');
    var r = SchedulerService.scanExpiry();
    assert(r.expired >= 1, 'nothing expired');
    assert(Repo.getById('PTW_Master', ptwId).status === CFG.STATUS.EXPIRED, 'status not Expired');
  });

  t('T44 完工申報（需結案文件＋三部門確認）→ Closed', function () {
    var denied = false;
    try { LifecycleService.requestClosure(t1, { ptwId: ptwId, wcDeclarationAccepted: false }); }
    catch (e) { denied = (e.apiCode === 'DECLARATION_REQUIRED'); }
    assert(denied, 'closure without declaration accepted');
    // 結案文件未上傳 → 應被擋
    var deniedDocs = false;
    try { LifecycleService.requestClosure(t1, { ptwId: ptwId, wcDeclarationAccepted: true }); }
    catch (e) { deniedDocs = (e.apiCode === 'CLOSEOUT_DOCS_REQUIRED'); }
    assert(deniedDocs, 'closure allowed without close-out documents');
    DriveService.uploadAttachment(t1, { ptwId: ptwId, fileName: 'closeout.pdf',
      mimeType: 'application/pdf', base64: Utilities.base64Encode('doc'), category: 'CloseOut' });
    // 固定必要兩項：每日驗證紀錄 / TBM+HIP（自檢表 SelfInspection 為選配，刻意不上傳）
    ['DailyValidation', 'TbmHip'].forEach(function (cat) {
      DriveService.uploadAttachment(t1, { ptwId: ptwId, fileName: cat + '.pdf',
        mimeType: 'application/pdf', base64: Utilities.base64Encode('doc'), category: cat });
    });
    // 涉及動火/氣測/局限空間 → 氣體監測記錄表與人員管制表為結案必要
    var mChk = Repo.getById('PTW_Master', ptwId);
    if (mChk.gasTestRequired === 'Y' || asBool_(mChk.wtHotWork) || asBool_(mChk.wtConfinedSpace)) {
      var deniedGas = false;
      try { LifecycleService.requestClosure(t1, { ptwId: ptwId, wcDeclarationAccepted: true }); }
      catch (e) { deniedGas = (e.apiCode === 'CLOSEOUT_DOCS_REQUIRED'); }
      assert(deniedGas, 'closure allowed without gas monitoring log');
      DriveService.uploadAttachment(t1, { ptwId: ptwId, fileName: 'gas-log.pdf',
        mimeType: 'application/pdf', base64: Utilities.base64Encode('doc'), category: 'GasMonitorLog' });
    }
    if (asBool_(mChk.wtConfinedSpace)) {
      DriveService.uploadAttachment(t1, { ptwId: ptwId, fileName: 'entry-log.pdf',
        mimeType: 'application/pdf', base64: Utilities.base64Encode('doc'), category: 'EntryLog' });
    }
    // 自檢表未上傳仍應可申報完工（選配）
    assert(!Repo.find('PTW_Attachments', function (a) {
      return a.ptwId === ptwId && String(a.category) === 'SelfInspection' && asBool_(a.isActive);
    }).length, 'test setup: SelfInspection should not be uploaded here');
    LifecycleService.requestClosure(t1, { ptwId: ptwId, wcDeclarationAccepted: true });
    var mCo = Repo.getById('PTW_Master', ptwId);
    assert(mCo.status === CFG.STATUS.PENDING_CLOSEOUT && Number(mCo.coCurrentTier) === 2, 'not pending closeout at T2 (contractor HSE)');
    // 順序：T4 不能先確認
    var denied2 = false;
    try { LifecycleService.closeoutConfirm(t4, { ptwId: ptwId }); } catch (e) { denied2 = (e.apiCode === 'NOT_YOUR_TURN'); }
    assert(denied2, 'T4 confirmed out of order');
    // 第一關：承商職安衛（T2，限本公司）
    var r2co = LifecycleService.closeoutConfirm(t2, { ptwId: ptwId });
    assert(r2co.data.nextTier === 3 && !r2co.data.closed, 'T2 (contractor HSE) confirm did not advance');
    // T5 也不能在 T3/T4 未確認前直接關閉
    var t5NonAdmin = Repo.findOne('Users', function (u) { return Number(u.tier) === 5 && !asBool_(u.isAdmin) && asBool_(u.isActive); });
    if (t5NonAdmin) {
      var denied3 = false;
      try { LifecycleService.close(t5NonAdmin, { ptwId: ptwId }); } catch (e) { denied3 = (e.apiCode === 'CLOSEOUT_PENDING'); }
      assert(denied3, 'T5 closed before 3-dept confirmation');
    }
    var r3 = LifecycleService.closeoutConfirm(t3, { ptwId: ptwId });
    assert(r3.data.nextTier === 4 && !r3.data.closed, 'T3 confirm did not advance');
    var r4 = LifecycleService.closeoutConfirm(t4, { ptwId: ptwId });
    assert(r4.data.nextTier === 5, 'T4 confirm did not advance');
    var r5 = LifecycleService.closeoutConfirm(t5, { ptwId: ptwId, comment: 'Confirmed' });
    assert(r5.data.closed === true, 'T5 confirm did not close');
    var m3 = Repo.getById('PTW_Master', ptwId);
    assert(m3.status === CFG.STATUS.CLOSED && m3.closedAt, 'not closed');
    assert(m3.coT3At && m3.coT4At && m3.coT5At, 'closeout confirmations not recorded');
  });

  t('T45 PDF 匯出：現場聯＋完整主表＋證書、可分別輸出', function () {
    var r = PdfService.exportPdf(t1, { ptwId: ptwId });
    assert(r.ok && r.data.files.length >= 3, 'files: ' + (r.data ? r.data.files.length : 0));
    var names = r.data.files.map(function (f) { return f.fileName; }).join(',');
    assert(/SiteCopy_A4\.pdf/.test(names), 'site copy missing: ' + names);
    assert(/FullPermit_A3\.pdf/.test(names), 'full permit missing: ' + names);
    // 分別輸出
    var rs = PdfService.exportPdf(t1, { ptwId: ptwId, kind: 'site' });
    assert(rs.data.files.length === 1 && /SiteCopy_A4/.test(rs.data.files[0].fileName), 'kind=site wrong');
    var rc = PdfService.exportPdf(t1, { ptwId: ptwId, kind: 'certs' });
    assert(rc.data.files.length >= 1 && /_A4\.pdf$/.test(rc.data.files[0].fileName), 'kind=certs wrong');
    assert(r.data.files[0].base64.length > 10, 'pdf empty');
    var audits = Repo.find('AuditLog', function (a) { return a.actionType === 'PTW_EXPORT_PDF'; });
    assert(audits.length >= 1, 'export not audited');
  });

  console.log('\n===== M4.1 Test Results =====\n' + results.join('\n'));
  return results;
}

/** M4.2 報表＋版本比較＋代理測試（需先跑 M31–M41） */
function runAllTests_M42() {
  var results = [];
  var t = function (name, fn) {
    try { fn(); results.push('✅ ' + name); }
    catch (e) { results.push('❌ ' + name + ' → ' + e.message); }
  };
  var assert = function (cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); };

  var admin = Repo.findOne('Users', function (u) { return asBool_(u.isAdmin); });
  var t1 = Repo.findOne('Users', function (u) { return u.email === 'test-applicant@example.com'; });
  var t2 = Repo.findOne('Users', function (u) { return u.email === 'test-t2@example.com'; });
  var t3 = Repo.findOne('Users', function (u) { return u.email === 'test-t3@example.com'; });
  var t4 = Repo.findOne('Users', function (u) { return u.email === 'test-t4@example.com'; });
  var t5 = Repo.findOne('Users', function (u) { return u.email === 'test-t5@example.com'; });

  t('T45d 關單文件規則：依作業類型觸發，管理台可將建議項升級為必要', function () {
    var keys = function (m, level) {
      return CloseoutRules.forPtw(m).filter(function (d) { return d.level === level; })
        .map(function (d) { return d.key; });
    };
    var base = { companyId: 'c1' };
    // 所有 PTW 的共同兩項
    var cold = keys({ companyId: 'c1', wtColdWork: true }, 'required');
    assert(cold.length === 2 && cold.indexOf('DailyValidation') >= 0 && cold.indexOf('TbmHip') >= 0,
      'cold work should require exactly the two common records: ' + cold.join(','));
    // 動火 → 氣測
    var hot = keys({ companyId: 'c1', wtHotWork: true }, 'required');
    assert(hot.indexOf('GasMonitorLog') >= 0 && hot.indexOf('EntryLog') < 0, 'hot work rule wrong: ' + hot.join(','));
    // 局限空間 → 氣測 + 進出管制表
    var cs = keys({ companyId: 'c1', wtConfinedSpace: true }, 'required');
    assert(cs.indexOf('GasMonitorLog') >= 0 && cs.indexOf('EntryLog') >= 0, 'confined space rule wrong: ' + cs.join(','));
    // 其餘作業類型 → 建議層級
    [['wtDiving', 'DiveLog'], ['wtRadiography', 'RadiationDose'], ['wtExcavation', 'ExcavationCheck'],
     ['wtElectricalIso', 'LotoLog'], ['wtProcessIso', 'IsolationRegister']].forEach(function (r) {
      var m = { companyId: 'c1' }; m[r[0]] = true;
      assert(keys(m, 'recommended').indexOf(r[1]) >= 0, r[0] + ' should recommend ' + r[1]);
      assert(keys(m, 'required').indexOf(r[1]) < 0, r[1] + ' should not block close-out by default');
    });
    // 施工架＝Y → 建議施工架檢點表
    assert(keys({ companyId: 'c1', scaffoldingRequired: 'Y' }, 'recommended').indexOf('ScaffoldCheck') >= 0,
      'scaffolding rule missing');
    // 未勾選的作業類型不得出現
    assert(keys({ companyId: 'c1', wtColdWork: true }, 'recommended').length === 0,
      'cold work should not trigger any type-specific document');
    // 管理台升級：建議 → 必要
    var before = getSetting_('closeoutRequiredKeys');
    setSetting_('closeoutRequiredKeys', 'DiveLog', 'test');
    assert(keys({ companyId: 'c1', wtDiving: true }, 'required').indexOf('DiveLog') >= 0,
      'upgrade to required failed');
    setSetting_('closeoutRequiredKeys', before || '', 'test');
    assert(keys({ companyId: 'c1', wtDiving: true }, 'required').indexOf('DiveLog') < 0, 'downgrade failed');
  });

  t('T45c 提前關單：PTW 未到期時，同公司人員可申報完工；他家承商不可', function () {
    var d = PTWService.createDraft(t1).data;
    Repo.update('PTW_Master', d.ptwId, {
      status: CFG.STATUS.ACTIVE, ptwNumber: 'OPTW-EARLY', companyId: t1.companyId,
      validFrom: fmtDateTime_(new Date(Date.now() - 86400000)),
      validTo: fmtDateTime_(new Date(Date.now() + 5 * 86400000))   // 還有 5 天才到期
    }, 'test');
    ['DailyValidation', 'TbmHip'].forEach(function (c) {
      DriveService.uploadAttachment(t1, { ptwId: d.ptwId, fileName: c + '.pdf',
        mimeType: 'application/pdf', base64: Utilities.base64Encode('d'), category: c });
    });
    var m0 = Repo.getById('PTW_Master', d.ptwId);
    assert(m0.validTo > fmtDateTime_(), 'fixture should not be expired');
    // 他家承商：看不到也關不了
    var outsider = Repo.findOne('Users', function (u) {
      return Number(u.tier) <= 2 && u.companyId && u.companyId !== t1.companyId && asBool_(u.isActive);
    });
    if (outsider) {
      var denied = false;
      try { LifecycleService.requestClosure(outsider, { ptwId: d.ptwId, wcDeclarationAccepted: true }); }
      catch (e) { denied = (e.apiCode === 'FORBIDDEN' || e.apiCode === 'FORBIDDEN_SCOPE'); }
      assert(denied, 'another contractor could close this PTW');
      assert(!PTWService.list(outsider, {}).data.rows.some(function (r) { return r.id === d.ptwId; }),
        'another contractor can see this PTW');
    }
    // 同公司 Tier 2：看得到、可關單（未到期）
    assert(PTWService.list(t2, {}).data.rows.some(function (r) { return r.id === d.ptwId && r.canClose; }),
      'same-company colleague cannot see/close the PTW');
    LifecycleService.requestClosure(t2, { ptwId: d.ptwId, wcDeclarationAccepted: true });
    assert(Repo.getById('PTW_Master', d.ptwId).status === CFG.STATUS.PENDING_CLOSEOUT,
      'early close-out by same-company colleague failed');
    Repo.update('PTW_Master', d.ptwId, { isActive: false }, 'test');
  });

  t('T45b 持有人鎖定：僅申請人（Tier 1）可指定，Tier 2–5 與管理員一律擋下', function () {
    var d = PTWService.createDraft(t1).data;
    var holders = Repo.find('Users', function (u) {
      return Number(u.tier) === 1 && u.companyId === t1.companyId && asBool_(u.isActive);
    });
    assert(holders.length >= 1, 'no tier-1 holder candidates');
    PTWService.saveDraft(t1, { ptwId: d.ptwId, holderUserId: JSON.stringify([holders[0].id]) });
    var orig = Repo.getById('PTW_Master', d.ptwId).holderUserId;
    assert(orig && JSON.parse(orig).length === 1, 'applicant could not set holder');
    // 各關審查人與管理員都不得變更持有人／副持有人
    [t2, t3, t4, t5, admin].forEach(function (u) {
      if (!u) return;
      var denied = false;
      try {
        PTWService.saveDraft(u, { ptwId: d.ptwId, holderUserId: JSON.stringify([]), coHolderUserId: JSON.stringify([]) });
      } catch (e) { denied = (e.apiCode === 'FORBIDDEN'); }
      assert(denied, 'tier ' + u.tier + ' was allowed to change holders');
      assert(Repo.getById('PTW_Master', d.ptwId).holderUserId === orig, 'holders changed by tier ' + u.tier);
    });
    // 送審中：連申請人本人也不可改（必須先被退回）
    Repo.update('PTW_Master', d.ptwId, { status: CFG.STATUS.PENDING_T2 }, 'test');
    var lockedWhileReview = false;
    try { PTWService.saveDraft(t1, { ptwId: d.ptwId, holderUserId: JSON.stringify([]) }); }
    catch (e) { lockedWhileReview = (e.apiCode === 'BAD_STATE'); }
    assert(lockedWhileReview, 'applicant changed holders while under review');
    // 退回後才解鎖
    Repo.update('PTW_Master', d.ptwId, { status: CFG.STATUS.RETURNED }, 'test');
    PTWService.saveDraft(t1, { ptwId: d.ptwId, holderUserId: JSON.stringify([holders[0].id]) });
    assert(Repo.getById('PTW_Master', d.ptwId).holderUserId === orig, 'applicant cannot edit after return');
    Repo.update('PTW_Master', d.ptwId, { isActive: false }, 'test');
  });

  t('T46 報表權限：Tier1 不可讀報表', function () {
    var denied = false;
    try { ReportService.overdue(t1); } catch (e) { denied = (e.apiCode === 'FORBIDDEN'); }
    assert(denied, 'T1 read reports');
  });

  t('T47 公司別/類型/月度/逾期報表有資料且結構正確', function () {
    var bc = ReportService.byCompany(admin);
    assert(bc.data.length >= 1 && bc.data[0].total >= 1, 'byCompany empty');
    var bt = ReportService.byType(admin);
    assert(bt.data.length === 8, 'byType should list 8 work types');
    assert(bt.data.some(function (r) { return r.count >= 1; }), 'no type counts');
    var mo = ReportService.monthly(admin);
    assert(mo.data.length >= 1 && mo.data[0].month.match(/^\d{4}-\d{2}$/), 'monthly format');
    ReportService.overdue(admin); // 不擲錯即可（Closed 後可能為 0 筆）
  });

  t('T48 簽核歷程匯出含 PTW 編號與動作', function () {
    var r = ReportService.approvalsExport(admin);
    assert(r.data.length >= 5, 'approvals rows: ' + r.data.length);
    assert(r.data.every(function (a) { return a.number && a.action; }), 'missing fields');
  });

  t('T49 版本比較：v1→v2 顯示欄位差異（areaLocation 修訂）', function () {
    var m = Repo.findOne('PTW_Master', function (p) { return Number(p.version) === 2 && asBool_(p.isActive); });
    assert(m, 'no v2 PTW');
    var list = ReportService.versionDiff(t1, { ptwId: m.id });
    assert(list.data.versions.length === 2, 'versions: ' + list.data.versions.length);
    var r = ReportService.versionDiff(t1, { ptwId: m.id, v1: 1, v2: 2 });
    assert(r.data.diff.some(function (d) { return d.field === 'areaLocation'; }),
      'areaLocation diff missing: ' + JSON.stringify(r.data.diff));
  });

  t('T50 代理簽核：設定→列表→代理人可審→停用後不可審', function () {
    // t3 代理 t2（Tier 2），建一張新 PTW 到 PendingTier2 讓 t3 以代理身分核准
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V3', executionDate: '2026-08-03',
      areaLocation: 'B', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-03 08:00:00', validTo: '2026-08-03 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, holderUserId: t1.id, paUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
    attachMsRa_(t1, d.data.ptwId);
    PTWService.submit(t1, { ptwId: d.data.ptwId });

    UserService.setDelegation(admin, { delegatorUserId: t2.id, delegateUserId: t3.id, tier: 2,
      validFrom: '2020-01-01 00:00:00', validTo: '2030-12-31 23:59:59' });
    var lst = ReportService.delegationList(admin);
    assert(lst.data.length >= 1, 'delegation list empty');
    // t3（Tier3）以 Tier2 代理身分核准
    var r = ApprovalService.approve(t3, { ptwId: d.data.ptwId,
      signatureDataUrl: 'data:image/png;base64,aGk=' }, {});
    assert(r.ok && r.data.newStatus === CFG.STATUS.PENDING_T3, 'delegate approve failed');
    // 停用代理
    ReportService.delegationDisable(admin, { delegationId: lst.data[0].id });
    var lst2 = ReportService.delegationList(admin);
    assert(lst2.data.length === lst.data.length - 1, 'delegation not disabled');
    PTWService.withdraw && Repo.update('PTW_Master', d.data.ptwId, { status: CFG.STATUS.CANCELLED }, 'test');
  });

  t('T51 PTW 清單匯出模式（forExport 不分頁）', function () {
    var r = PTWService.list(admin, { forExport: 1 });
    assert(r.data.rows.length === r.data.total, 'export should return all rows');
  });

  t('T52 Tier 5 具備全部權限（requireAdmin 放行；Tier 1 拒絕）', function () {
    var t5 = Repo.findOne('Users', function (u) { return Number(u.tier) === 5 && !asBool_(u.isAdmin); });
    if (!t5) {
      var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC'; });
      t5 = Repo.insert('Users', { email: 'test-t5x@example.com', nameEn: 'T5X', nameZh: 'T5X',
        companyId: nmdc.id, tier: 5, isAdmin: false, status: 'Active',
        passwordSalt: 's', passwordHash: 'h', hashIter: CFG.HASH_ITERATIONS }, 'test');
    }
    SecurityService.requireAdmin(t5); // 不應丟錯
    var denied = false;
    try { SecurityService.requireAdmin(t1); } catch (e) { denied = (e.apiCode === 'FORBIDDEN'); }
    assert(denied, 'Tier1 should be denied admin actions');
  });

  t('T53 刪除 PTW：Tier 5 可刪（軟刪除＋稽核）、Tier 1 不可', function () {
    var t5 = Repo.findOne('Users', function (u) { return Number(u.tier) === 5 && u.status === 'Active'; }) || admin;
    var draft = PTWService.createDraft(t1).data;
    var denied = false;
    try { PTWService.deletePtw(t1, { ptwId: draft.ptwId }); } catch (e) { denied = (e.apiCode === 'FORBIDDEN'); }
    assert(denied, 'Tier1 should not delete PTW');
    var r = PTWService.deletePtw(t5, { ptwId: draft.ptwId });
    assert(r.ok && r.data.deleted, 'T5 delete failed');
    var m = Repo.getById('PTW_Master', draft.ptwId);
    assert(!asBool_(m.isActive), 'PTW should be inactive after delete');
    var hist = Repo.find('PTW_StatusHistory', function (h) { return h.ptwId === draft.ptwId && /Deleted/.test(h.reason || ''); });
    assert(hist.length >= 1, 'delete should write status history');
  });

  t('T54 刪除人員：不可刪自己、不可刪最後管理員、可刪一般人員', function () {
    var denied = false;
    try { UserService.deleteUser(admin, { userId: admin.id }); } catch (e) { denied = true; }
    assert(denied, 'should not delete self');
    var admins = Repo.find('Users', function (u) { return asBool_(u.isAdmin) && asBool_(u.isActive); });
    if (admins.length === 1) {
      var denied2 = false;
      try { UserService.deleteUser({ id: 'other', tier: 5, isAdmin: false }, { userId: admin.id }); }
      catch (e) { denied2 = true; }
      assert(denied2, 'should not delete last admin');
    }
    var victim = Repo.insert('Users', { email: 'test-del@example.com', nameEn: 'Del', nameZh: 'Del',
      companyId: t1.companyId, tier: 1, isAdmin: false, status: 'Active',
      passwordSalt: 's', passwordHash: 'h', hashIter: CFG.HASH_ITERATIONS }, 'test');
    // 相關個人資料列（應一併刪除）
    Repo.insert('Sessions', { id: Utilities.getUuid(), userId: victim.id, createdAt: fmtDateTime_(),
      expiresAt: '2030-01-01 00:00:00', lastSeenAt: fmtDateTime_(), userAgent: 'x', isRevoked: false }, 'test');
    Repo.insert('Notifications', { userId: victim.id, type: 'X', ptwId: '', titleEn: 'n', titleZh: 'n',
      messageEn: 'm', messageZh: 'm', isRead: false, emailSent: false }, 'test');
    Repo.insert('TrainingProgress', { userId: victim.id, courseId: 'c', watchedSec: 1, watchPercent: 1,
      completed: false }, 'test');
    var r = UserService.deleteUser(admin, { userId: victim.id });
    assert(r.ok && r.data.deleted, 'delete user failed');
    // 硬刪除：使用者列與其相關資料列都應消失
    assert(!Repo.getById('Users', victim.id), 'user row should be hard-deleted');
    assert(!Repo.find('Sessions', function (s) { return s.userId === victim.id; }).length, 'sessions remain');
    assert(!Repo.find('Notifications', function (n) { return n.userId === victim.id; }).length, 'notifications remain');
    assert(!Repo.find('TrainingProgress', function (tp) { return tp.userId === victim.id; }).length, 'training progress remains');
  });

  t('T55 測試模式：建立 7 員、可切換測試身分、不可切換一般帳號', function () {
    var r = TestModeService.enable(admin);
    assert(r.ok && r.data.personas.length === 8, 'expected 8 personas, got ' + (r.data.personas || []).length);
    var tiers = r.data.personas.map(function (p) { return p.tier; }).sort().join(',');
    assert(tiers === '1,1,1,2,2,3,4,5', 'tier mix wrong: ' + tiers);
    var p1 = r.data.personas.filter(function (p) { return p.tier === 1; })[0];
    var imp = TestModeService.impersonate(admin, { userId: p1.id }, { userAgent: 'test' });
    assert(imp.ok && imp.data.token, 'impersonate failed');
    var asUser = AuthService.verifySession(imp.data.token);
    assert(asUser.id === p1.id, 'session not bound to persona');
    var denied = false;
    try { TestModeService.impersonate(admin, { userId: t1.id }, {}); }
    catch (e) { denied = (e.apiCode === 'NOT_TEST_USER'); }
    assert(denied, 'should refuse impersonating non-test user');
    // 重複 enable 不重建（idempotent）
    var r2 = TestModeService.enable(admin);
    assert(r2.data.personas.length === 8, 'enable not idempotent');
    // reset 清除測試 PTW
    var draft = PTWService.createDraft(asUser).data;
    var rr = TestModeService.reset(admin);
    assert(rr.ok && rr.data.cleared >= 1, 'reset cleared nothing');
    assert(!asBool_(Repo.getById('PTW_Master', draft.ptwId).isActive), 'test PTW still active');
  });

  t('T56 首頁看板（公開）：執行中/逾期清單含編號、執行日期、船舶、區域、內容、持有人', function () {
    // 造一筆 Active 與一筆逾期
    var d1 = PTWService.createDraft(t1).data;
    Repo.update('PTW_Master', d1.ptwId, { status: CFG.STATUS.ACTIVE, executionDate: '2026-08-01',
      vessel: 'DLB1600', areaLocation: 'KP0+300', workDescription: 'Board test work',
      holderUserId: t1.id, validTo: '2099-01-01 23:59:59' }, 'test');
    var d2 = PTWService.createDraft(t1).data;
    Repo.update('PTW_Master', d2.ptwId, { status: CFG.STATUS.ACTIVE, executionDate: '2026-01-01',
      vessel: 'SV-2', areaLocation: 'KP1+000', workDescription: 'Overdue test work',
      holderUserId: t1.id, validTo: '2026-01-02 23:59:59' }, 'test');
    var b = DashboardService.board().data;
    var a = b.active.filter(function (r) { return r.id === d1.ptwId; })[0];
    assert(a, 'active PTW not on board');
    assert(a.executionDate === '2026-08-01' && a.vessel === 'DLB1600' &&
      a.areaLocation === 'KP0+300' && a.workDescription === 'Board test work' &&
      (a.holderEn || a.holderZh), 'active board fields wrong: ' + JSON.stringify(a));
    var o = b.overdue.filter(function (r) { return r.id === d2.ptwId; })[0];
    assert(o && o.vessel === 'SV-2', 'overdue PTW not on board');
    // 清理：不留在看板上
    Repo.update('PTW_Master', d1.ptwId, { isActive: false }, 'test');
    Repo.update('PTW_Master', d2.ptwId, { isActive: false }, 'test');
    // 公開路由（無登入）：任何訪客皆可看到看板
    var res = handleRequest_({ action: 'ptw.board', token: '', payload: {}, meta: {} });
    assert(res.ok === true, 'ptw.board should be public');
  });

  t('T57 指定審閱人：nextReviewers 清單、submit 指定僅通知該員、approve 指定下一關', function () {
    var t2b = Repo.findOne('Users', function (u) { return u.email === 'test-t2b@example.com'; });
    if (!t2b) {
      t2b = Repo.insert('Users', { email: 'test-t2b@example.com', nameEn: 'T2B', nameZh: 'T2B',
        companyId: t1.companyId, tier: 2, isAdmin: false, status: 'Active',
        passwordSalt: 's', passwordHash: 'h', hashIter: CFG.HASH_ITERATIONS }, 'test');
    }
    var SIG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V3', executionDate: '2026-08-03',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-03 08:00:00', validTo: '2026-08-04 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, holderUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
    // nextReviewers（草稿 → 本公司 Tier 2，至少 2 人）
    var nr = PTWService.nextReviewers(t1, { ptwId: d.data.ptwId });
    assert(nr.data.tier === 2 && nr.data.users.length >= 2, 'nextReviewers t2 list: ' + nr.data.users.length);
    // 指定 t2b 提交 → currentReviewerId 設定、僅 t2b 收到待審通知
    var before = Repo.find('Notifications', function (n) { return n.ptwId === d.data.ptwId && n.type === 'PTW_PENDING_REVIEW'; }).length;
    attachMsRa_(t1, d.data.ptwId);
    PTWService.submit(t1, { ptwId: d.data.ptwId, reviewerId: t2b.id });
    var m = Repo.getById('PTW_Master', d.data.ptwId);
    assert(m.currentReviewerId === t2b.id, 'currentReviewerId not set on submit');
    var notes = Repo.find('Notifications', function (n) { return n.ptwId === d.data.ptwId && n.type === 'PTW_PENDING_REVIEW'; });
    assert(notes.length - before === 1 && notes[notes.length - 1].userId === t2b.id, 'should notify designated only');
    // 其他同層（test-t2）仍可審閱（任一人即可）
    var r2 = ApprovalService.approve(t2, { ptwId: d.data.ptwId, signatureDataUrl: SIG2, nextReviewerId: t3.id }, {});
    assert(r2.data.newStatus === CFG.STATUS.PENDING_T3, 'not advanced to T3');
    var m2 = Repo.getById('PTW_Master', d.data.ptwId);
    assert(m2.currentReviewerId === t3.id, 'next designated reviewer not set');
    // 指定通知僅 1 筆給 t3
    var n3 = Repo.find('Notifications', function (n) { return n.ptwId === d.data.ptwId && n.type === 'PTW_PENDING_REVIEW' && n.userId === t3.id; });
    assert(n3.length >= 1, 't3 not notified');
    // 指定錯誤層級應被拒
    var denied = false;
    try { ApprovalService.approve(t3, { ptwId: d.data.ptwId, signatureDataUrl: SIG2, nextReviewerId: t2b.id }, {}); }
    catch (e) { denied = (e.apiCode === 'BAD_REVIEWER'); }
    assert(denied, 'wrong-tier designation not rejected');
    // 不指定也可正常續行（通知全部 T4）
    var r4 = ApprovalService.approve(t3, { ptwId: d.data.ptwId, signatureDataUrl: SIG2 }, {});
    assert(r4.data.newStatus === CFG.STATUS.PENDING_T4, 'not advanced to T4');
  });

  t('T58 審核信含 PTW 直達連結；帳號簽名檔可直接用於簽核', function () {
    // 直達連結
    var link = NotificationService.ptwLink('PTWID123');
    assert(/[?&]ptw=PTWID123/.test(link), 'deep link missing ptw param: ' + link);
    // 帳號簽名檔簽核：以 base64 dataURL 提交（前端「一鍵確認」路徑）
    var SIG3 = 'data:image/png;base64,' + Utilities.base64Encode('acct-signature-bytes');
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V4', executionDate: '2026-08-06',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-06 08:00:00', validTo: '2026-08-07 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, holderUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
    attachMsRa_(t1, d.data.ptwId);
    PTWService.submit(t1, { ptwId: d.data.ptwId });
    var r = ApprovalService.approve(t2, { ptwId: d.data.ptwId, signatureDataUrl: SIG3 }, {});
    assert(r.ok && r.data.newStatus === CFG.STATUS.PENDING_T3, 'approve with account signature failed');
    var sig = Repo.findOne('PTW_Signatures', function (x) { return x.ptwId === d.data.ptwId && x.userId === t2.id; });
    assert(sig && sig.signatureFileId, 'signature not stored');
    // 待審通知含 ptwId（信件才有直達連結）
    var n = Repo.find('Notifications', function (x) { return x.ptwId === d.data.ptwId && x.type === 'PTW_PENDING_REVIEW'; });
    assert(n.length >= 1 && n[0].ptwId === d.data.ptwId, 'review notification missing ptwId');
  });

  t('T59 編號補空號：釋出的中間號碼會被下一張補上；已發出的號碼不變', function () {
    // 取三個 PTW 號並實際寫入 → 造出中間空號
    var mk = function () {
      return Repo.insert('PTW_Master', { ptwNumber: SequenceService.next('PTW'), status: CFG.STATUS.APPROVED,
        companyId: t1.companyId, applicantUserId: t1.id, version: 1 }, 'test');
    };
    var a1 = mk(), a2 = mk(), a3 = mk();
    var n = function (x) { return Number(String(x.ptwNumber).match(/(\d+)$/)[1]); };
    assert(n(a2) === n(a1) + 1 && n(a3) === n(a2) + 1, 'not sequential: ' + a1.ptwNumber + ',' + a2.ptwNumber + ',' + a3.ptwNumber);
    var gapNo = a2.ptwNumber, keepNo = a3.ptwNumber;
    // 刪除中間那張（號碼釋出）
    Repo.update('PTW_Master', a2.id, { ptwNumber: '', isActive: false }, 'test');
    var next1 = SequenceService.next('PTW');
    assert(next1 === gapNo, 'gap not reused: expected ' + gapNo + ' got ' + next1);
    // 已發出的號碼未被更動
    assert(Repo.getById('PTW_Master', a3.id).ptwNumber === keepNo, 'issued number changed!');
    // 證書編號同規則
    var c1 = SequenceService.next('CS'), c2 = SequenceService.next('CS');
    assert(c1 !== c2, 'cert numbers duplicated: ' + c1 + ' / ' + c2);
  });

  t('T60 現場聯 PDF：QR 指向 Drive 資料夾、標籤只留英文', function () {
    var mAct = Repo.findOne('PTW_Master', function (p) { return p.status === CFG.STATUS.CLOSED || p.status === CFG.STATUS.ACTIVE; });
    if (!mAct) return;
    var r = PdfService.exportPdf(admin, { ptwId: mAct.id, kind: 'site' });
    assert(r.ok && r.data.files.length === 1, 'site copy not generated');
    assert(typeof r.data.folderUrl === 'string', 'folderUrl missing');
    var mm = Repo.getById('PTW_Master', mAct.id);
    assert(mm.driveFolderId, 'PTW drive folder not created');
  });

  t('T61 Cold Work 免證書：可直接提交、GW 證書建立被拒', function () {
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V9', executionDate: '2026-08-10',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-10 08:00:00', validTo: '2026-08-10 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, holderUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
    // requiredCerts 不含 GW
    var g = PTWService.get(t1, { ptwId: d.data.ptwId });
    assert(g.data.requiredCerts.indexOf('GW') < 0, 'GW should not be required');
    // GW 證書建立被拒
    var blocked = false;
    try { CertificateService.save(t1, { ptwId: d.data.ptwId, certType: 'GW', dataJson: '{}', markComplete: true }); }
    catch (e) { blocked = (e.apiCode === 'BAD_STATE'); }
    assert(blocked, 'GW cert save should be rejected');
    // 純 Cold Work 免證書即可提交
    attachMsRa_(t1, d.data.ptwId);
    var r = PTWService.submit(t1, { ptwId: d.data.ptwId });
    assert(r.ok && r.data.status === CFG.STATUS.PENDING_T2, 'cold-work-only submit failed: ' + JSON.stringify(r.data));
  });

  t('T62 多部訓練影片：每部皆須 ≥90% 才算完成', function () {
    TrainingService.setCourse(admin, { title: 'Multi Video Course',
      videos: [{ id: 'vidAAA111', title: 'Part 1' }, { id: 'vidBBB222', title: 'Part 2' }],
      courseVersion: 'mv1' });
    var course = TrainingService.activeCourse();
    var vids = JSON.parse(course.videosJson);
    assert(vids.length === 2 && course.youtubeVideoId === 'vidAAA111', 'videosJson wrong');
    // 清掉舊進度
    Repo.find('TrainingProgress', function (p) { return p.userId === t1.id && asBool_(p.isActive); })
      .forEach(function (p) { Repo.update('TrainingProgress', p.id, { isActive: false }, 'test'); });
    var watchUp = function (vid) {
      var r2;
      for (var i = 0; i < 10; i++) {
        Repo.find('TrainingProgress', function (p) { return p.userId === t1.id && asBool_(p.isActive); })
          .forEach(function (p) { Repo.update('TrainingProgress', p.id, { updatedAt: '2020-01-01 00:00:00' }, 'test'); });
        r2 = TrainingService.reportProgress(t1, { courseId: course.id, deltaSec: 15,
          videoId: vid, playerDurationSec: 100 });
        var v2 = r2.data.videos.filter(function (x) { return x.id === vid; })[0];
        if (v2 && v2.completed) break;
      }
      return r2;
    };
    var r = watchUp('vidAAA111');
    assert(!r.data.completed, 'completed too early (only video 1 watched)');
    var v1 = r.data.videos.filter(function (x) { return x.id === 'vidAAA111'; })[0];
    assert(v1.completed, 'video 1 not completed: ' + JSON.stringify(v1));
    r = watchUp('vidBBB222');
    assert(r.data.completed, 'course not completed after both videos: ' + JSON.stringify(r.data.videos));
    var prog = TrainingService.myProgress(t1.id, course.id);
    assert(asBool_(prog.completed), 'progress row not completed');
  });

  t('T63 作業類型附件強制：潛水文件未上傳 → 提交被擋；上傳後可提交', function () {
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V10', executionDate: '2026-08-12',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-12 08:00:00', validTo: '2026-08-12 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtDiving: true, holderUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzDivingOps: true, pcStandbyVessel: true }) });
    CertificateService.save(t1, { ptwId: d.data.ptwId, certType: 'DO', dataJson: '{}', markComplete: true });
    attachMsRa_(t1, d.data.ptwId);
    var r0 = PTWService.submit(t1, { ptwId: d.data.ptwId });
    assert(r0.ok === false && String(r0.msgEn || '').indexOf('DivingDocs') >= 0,
      'submitted without diving docs: ' + JSON.stringify(r0));
    DriveService.uploadAttachment(t1, { ptwId: d.data.ptwId, fileName: 'diver-certs.pdf',
      mimeType: 'application/pdf', base64: Utilities.base64Encode('doc'), category: 'DivingDocs' });
    var r = PTWService.submit(t1, { ptwId: d.data.ptwId });
    assert(r.ok && r.data.status === CFG.STATUS.PENDING_T2, 'submit after diving docs failed');
  });

  t('T64 現場聯 Site Copy：核准前不可輸出、核准後可輸出', function () {
    var draft = Repo.findOne('PTW_Master', function (p) {
      return asBool_(p.isActive) && (p.status === CFG.STATUS.DRAFT || String(p.status).indexOf('Pending') === 0);
    });
    if (draft) {
      ['site', 'main', 'certs', 'all'].forEach(function (k) {
        var blocked = false;
        try { PdfService.exportPdf(admin, { ptwId: draft.id, kind: k }); }
        catch (e) { blocked = (e.apiCode === 'BAD_STATE'); }
        assert(blocked, k + ' PDF generated before approval');
      });
    }
    var done = Repo.findOne('PTW_Master', function (p) {
      return asBool_(p.isActive) && [CFG.STATUS.APPROVED, CFG.STATUS.ACTIVE, CFG.STATUS.CLOSED].indexOf(p.status) >= 0;
    });
    if (done) {
      var r = PdfService.exportPdf(admin, { ptwId: done.id, kind: 'site' });
      assert(r.ok && r.data.files.length === 1, 'site copy not generated after approval');
    }
  });

  t('T65 結案審閱退回：T3 有意見退回 T2；T2 有意見退回申請人（Active）；重走全鏈可關閉', function () {
    // 建一張走到 Active 的 PTW
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V11', executionDate: '2026-08-13',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-13 08:00:00', validTo: '2026-08-13 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, holderUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
    attachMsRa_(t1, d.data.ptwId);
    PTWService.submit(t1, { ptwId: d.data.ptwId });
    var SIG65 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    ApprovalService.approve(t2, { ptwId: d.data.ptwId, signatureDataUrl: SIG65 }, {});
    ApprovalService.approve(t3, { ptwId: d.data.ptwId, signatureDataUrl: SIG65 }, {});
    ApprovalService.approve(t4, { ptwId: d.data.ptwId, signatureDataUrl: SIG65 }, {});
    ApprovalService.approve(t5, { ptwId: d.data.ptwId, signatureDataUrl: SIG65 }, {});
    var pid = d.data.ptwId;
    assert(Repo.getById('PTW_Master', pid).status === CFG.STATUS.ACTIVE, 'not active');
    // 結案附件＋申報完工
    ['CloseOut', 'DailyValidation', 'TbmHip', 'SelfInspection'].forEach(function (cat) {
      DriveService.uploadAttachment(t1, { ptwId: pid, fileName: cat + '.pdf',
        mimeType: 'application/pdf', base64: Utilities.base64Encode('doc'), category: cat });
    });
    LifecycleService.requestClosure(t1, { ptwId: pid, wcDeclarationAccepted: true });
    // T2 無意見 → T3
    LifecycleService.closeoutConfirm(t2, { ptwId: pid });
    // T3 有意見 → 退回 T2
    var r1 = LifecycleService.closeoutReturn(t3, { ptwId: pid, comment: '附件不齊' });
    assert(r1.data.to === 'tier2', 'not returned to tier2: ' + r1.data.to);
    var m1 = Repo.getById('PTW_Master', pid);
    assert(Number(m1.coCurrentTier) === 2 && !m1.coT2At, 'T2 confirmation not reset');
    // T2 有意見 → 退回申請人（Active）
    var r2 = LifecycleService.closeoutReturn(t2, { ptwId: pid, comment: '請補每日驗證紀錄' });
    assert(r2.data.to === 'applicant', 'not returned to applicant');
    var m2 = Repo.getById('PTW_Master', pid);
    assert(m2.status === CFG.STATUS.ACTIVE && !m2.coCurrentTier, 'not back to Active');
    // 申請人重新申報 → 全鏈確認 → Closed
    LifecycleService.requestClosure(t1, { ptwId: pid, wcDeclarationAccepted: true });
    LifecycleService.closeoutConfirm(t2, { ptwId: pid });
    LifecycleService.closeoutConfirm(t3, { ptwId: pid });
    LifecycleService.closeoutConfirm(t4, { ptwId: pid });
    var r5 = LifecycleService.closeoutConfirm(t5, { ptwId: pid, comment: 'ok' });
    assert(r5.data.closed === true, 'final close failed');
    assert(Repo.getById('PTW_Master', pid).status === CFG.STATUS.CLOSED, 'not closed');
  });

  t('T66 T2→T3 指定多位審閱人：僅被選者收到通知、任一人可審', function () {
    // 準備第二位 T3
    var t3b = Repo.findOne('Users', function (u) { return u.email === 'test-t3b@example.com'; });
    if (!t3b) {
      t3b = Repo.insert('Users', { email: 'test-t3b@example.com', nameZh: '測三乙', nameEn: 'T3 B',
        companyId: t3.companyId, tier: 3, isAdmin: false, status: 'Active',
        passwordSalt: 's', passwordHash: 'h', hashIter: CFG.HASH_ITERATIONS,
        trainingPassedAt: fmtDateTime_(), trainingValidUntil: '2029-12-31' }, 'test');
    }
    var SIG66 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V12', executionDate: '2026-08-14',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-14 08:00:00', validTo: '2026-08-14 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, holderUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
    attachMsRa_(t1, d.data.ptwId);
    PTWService.submit(t1, { ptwId: d.data.ptwId });
    var before = Repo.find('Notifications', function (n) {
      return n.ptwId === d.data.ptwId && n.type === 'PTW_PENDING_REVIEW';
    }).length;
    // T2 核准並指定兩位 T3
    var r = ApprovalService.approve(t2, { ptwId: d.data.ptwId, signatureDataUrl: SIG66,
      nextReviewerIds: [t3.id, t3b.id] }, {});
    assert(r.ok && r.data.newStatus === CFG.STATUS.PENDING_T3, 'approve to T3 failed');
    var m = Repo.getById('PTW_Master', d.data.ptwId);
    assert(!m.currentReviewerId, 'multi-select should not lock a single reviewer');
    var notifs = Repo.find('Notifications', function (n) {
      return n.ptwId === d.data.ptwId && n.type === 'PTW_PENDING_REVIEW';
    }).slice(before);
    var uids = notifs.map(function (n) { return n.userId; });
    assert(uids.indexOf(t3.id) >= 0 && uids.indexOf(t3b.id) >= 0, 'both selected T3 not notified');
    assert(uids.length === 2, 'unexpected notify count: ' + uids.length);
    // 任一被選者可審：t3b 核准
    var r2 = ApprovalService.approve(t3b, { ptwId: d.data.ptwId, signatureDataUrl: SIG66 }, {});
    assert(r2.ok && r2.data.newStatus === CFG.STATUS.PENDING_T4, 't3b could not review');
  });

  t('T67 持有人限本公司：他公司人員不得擔任持有人', function () {
    var coB = Repo.findOne('Companies', function (c) { return c.nameEn === 'TEST-CO-B67'; }) ||
      Repo.insert('Companies', { nameZh: '測試公司B67', nameEn: 'TEST-CO-B67', type: 'Contractor' }, 'test');
    var uB = Repo.findOne('Users', function (u) { return u.email === 'test-t1b67@example.com'; }) ||
      Repo.insert('Users', { email: 'test-t1b67@example.com', nameZh: '乙壹', nameEn: 'B Co T1',
        companyId: coB.id, tier: 1, isAdmin: false, status: 'Active',
        passwordSalt: 's', passwordHash: 'h', hashIter: CFG.HASH_ITERATIONS,
        trainingPassedAt: fmtDateTime_(), trainingValidUntil: '2029-12-31' }, 'test');
    var d = PTWService.createDraft(t1);
    var base = { ptwId: d.data.ptwId, vessel: 'V13', executionDate: '2026-08-15',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-15 08:00:00', validTo: '2026-08-15 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) };
    base.holderUserId = uB.id;                       // 他公司人員 → 應被擋
    PTWService.saveDraft(t1, base);
    attachMsRa_(t1, d.data.ptwId);
    var r0 = PTWService.submit(t1, { ptwId: d.data.ptwId });
    assert(r0.ok === false && String(r0.msgEn || '').indexOf('holders') >= 0,
      'cross-company holder not blocked: ' + (r0.msgEn || 'submitted!'));
    base.holderUserId = t1.id;                       // 本公司 → 可提交
    PTWService.saveDraft(t1, base);
    var r1 = PTWService.submit(t1, { ptwId: d.data.ptwId });
    assert(r1.ok === true, 'same-company holder blocked: ' + (r1.msgEn || ''));
  });

  t('T68 承商隔離：Tier1 儀表板 KPI 僅計本公司；管理員見全部', function () {
    var kAll = DashboardService.dashboard(admin).data.kpi.total;
    var k1 = DashboardService.dashboard(t1).data.kpi.total;
    var mine = SecurityService.stripTestPtws(t1,
      Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); }))
      .filter(function (p) { return p.companyId === t1.companyId; }).length;
    assert(k1 === mine, 'contractor KPI not company-scoped: ' + k1 + ' vs ' + mine);
    assert(kAll >= k1, 'admin KPI smaller than contractor KPI');
  });

  t('T69 看板：未登入顯示全部（含測試 PTW）、管理員與測試身分可見', function () {
    var SIG69 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    Repo.update('Users', t1.id, { isTestUser: true }, 'test');   // 模擬測試身分建立 Example PTW
    try {
      var d = PTWService.createDraft(t1);
      PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V14', executionDate: '2026-08-16',
        areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
        validFrom: '2026-08-16 08:00:00', validTo: '2026-08-16 18:00:00',
        scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
        wtColdWork: true, holderUserId: t1.id, paDeclarationAccepted: true,
        checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
      attachMsRa_(t1, d.data.ptwId);
      PTWService.submit(t1, { ptwId: d.data.ptwId });
      ApprovalService.approve(t2, { ptwId: d.data.ptwId, signatureDataUrl: SIG69 }, {});
      ApprovalService.approve(t3, { ptwId: d.data.ptwId, signatureDataUrl: SIG69 }, {});
      ApprovalService.approve(t4, { ptwId: d.data.ptwId, signatureDataUrl: SIG69 }, {});
      ApprovalService.approve(t5, { ptwId: d.data.ptwId, signatureDataUrl: SIG69 }, {});
      var m = Repo.getById('PTW_Master', d.data.ptwId);
      assert(m.status === CFG.STATUS.ACTIVE, 'test PTW not active');
      var inList = function (b) {
        return b.active.concat(b.overdue).some(function (r) { return r.id === d.data.ptwId; });
      };
      assert(inList(DashboardService.board(null).data), 'public board must show ALL PTWs (incl. test) when not logged in');
      assert(inList(DashboardService.board(admin).data), 'admin board missing test PTW');
      var t1Fresh = Repo.getById('Users', t1.id);   // 實際執行時 verifySession 會回傳最新使用者資料
      assert(inList(DashboardService.board(t1Fresh).data), 'test user board missing own test PTW');
      Repo.update('PTW_Master', d.data.ptwId, { isActive: false }, 'test');  // 清理
    } finally {
      Repo.update('Users', t1.id, { isTestUser: false }, 'test');
    }
  });

  t('T70 管理員直接調整關卡：跳關/退回/直接核准/結案關卡', function () {
    var d = PTWService.createDraft(t1);
    PTWService.saveDraft(t1, { ptwId: d.data.ptwId, vessel: 'V15', executionDate: '2026-08-17',
      areaLocation: 'A', workDescription: 'W', toolsEquipment: 'T',
      validFrom: '2026-08-17 08:00:00', validTo: '2026-08-17 18:00:00',
      scaffoldingRequired: 'N', gasTestRequired: 'N', cssIsoRequired: 'N',
      wtColdWork: true, holderUserId: t1.id, paDeclarationAccepted: true,
      checksJson: JSON.stringify({ hzSlipTrip: true, pcGloves: true }) });
    attachMsRa_(t1, d.data.ptwId);
    PTWService.submit(t1, { ptwId: d.data.ptwId });
    var pid = d.data.ptwId;
    // 非管理員不可
    var denied = false;
    try { ApprovalService.adminForceStage(t2, { ptwId: pid, target: 'T4', reason: 'x' }, {}); }
    catch (e) { denied = (e.apiCode === 'FORBIDDEN'); }
    assert(denied, 'non-admin allowed to force stage');
    // 未填原因不可
    var noReason = false;
    try { ApprovalService.adminForceStage(admin, { ptwId: pid, target: 'T4', reason: '  ' }, {}); }
    catch (e) { noReason = (e.apiCode === 'REASON_REQUIRED'); }
    assert(noReason, 'reason not enforced');
    // 跳到 T4
    var r1 = ApprovalService.adminForceStage(admin, { ptwId: pid, target: 'T4', reason: '測試跳關' }, {});
    var m1 = Repo.getById('PTW_Master', pid);
    assert(r1.ok && m1.status === CFG.STATUS.PENDING_T4 && Number(m1.currentTier) === 4, 'jump to T4 failed');
    var ov = Repo.find('PTW_Approvals', function (a) { return a.ptwId === pid && a.action === 'AdminOverride'; });
    assert(ov.length === 1 && ov[0].comment.indexOf('測試跳關') >= 0, 'override history entry missing');
    // T4 有收到通知
    assert(Repo.find('Notifications', function (n) { return n.ptwId === pid && n.userId === t4.id; }).length >= 1,
      'T4 not notified');
    // 退回申請人
    ApprovalService.adminForceStage(admin, { ptwId: pid, target: 'RETURN', reason: '退回測試' }, {});
    assert(Repo.getById('PTW_Master', pid).status === CFG.STATUS.RETURNED, 'force return failed');
    // 直接核准 → 正式編號 + Active
    var r3 = ApprovalService.adminForceStage(admin, { ptwId: pid, target: 'ACTIVE', reason: '直接核准測試' }, {});
    var m3 = Repo.getById('PTW_Master', pid);
    assert(m3.status === CFG.STATUS.ACTIVE && /^OPTW-\d{4}$/.test(m3.ptwNumber) && m3.activatedAt,
      'direct approve failed: ' + m3.status + '/' + m3.ptwNumber);
    assert(r3.data.number === m3.ptwNumber, 'number mismatch');
    // Site Copy 的核准列不受 AdminOverride 影響（僅計 action=Approve）
    // 跳到結案第 4 關 → t4 確認 → t5 確認關單
    ApprovalService.adminForceStage(admin, { ptwId: pid, target: 'CO4', reason: '結案跳關測試' }, {});
    var m4 = Repo.getById('PTW_Master', pid);
    assert(m4.status === CFG.STATUS.PENDING_CLOSEOUT && Number(m4.coCurrentTier) === 4, 'jump to CO4 failed');
    LifecycleService.closeoutConfirm(t4, { ptwId: pid });
    var r5 = LifecycleService.closeoutConfirm(t5, { ptwId: pid });
    assert(r5.data.closed === true && Repo.getById('PTW_Master', pid).status === CFG.STATUS.CLOSED,
      'close after CO4 jump failed');
    // 已關閉不可再調整
    var closedDenied = false;
    try { ApprovalService.adminForceStage(admin, { ptwId: pid, target: 'T3', reason: 'x' }, {}); }
    catch (e) { closedDenied = (e.apiCode === 'BAD_STATE'); }
    assert(closedDenied, 'closed PTW adjustable');
  });

  t('T71 考題：必考題必納入、管理員測試考試不留正式紀錄', function () {
    // 必考：標記一題 MC 為必考 → 連續出題 3 次皆應包含
    var mustQ = ExamService.qSave(admin, { type: 'MC', questionZh: '必考測試題', questionEn: 'Must-include test Q',
      optionsJson: '["對 Right","錯 Wrong"]', answerJson: '{"correct":"對 Right"}', mustInclude: true, category: 'TEST' });
    var beforeAttempts = Repo.find('ExamAttempts', function (a) { return a.userId === admin.id; }).length;
    for (var i = 0; i < 3; i++) {
      var r = ExamService.start(admin, { practice: 1 });
      assert(r.data.practice === true, 'practice flag missing');
      var qs = r.data.questions;
      assert(qs.length === 19, 'practice set size wrong: ' + qs.length);
      assert(qs.some(function (q) { return q.questionId === mustQ.data.id; }), 'must-include question missing (round ' + i + ')');
    }
    // 測試考試交卷：不寫 ExamAnswers、不鎖定、不影響效期、強制回傳正確答案
    var rp = ExamService.start(admin, { practice: 1 });
    var full = JSON.parse(Repo.getById('ExamAttempts', rp.data.attemptId).questionSetJson);
    var answers = {};
    full.forEach(function (q) { answers[q.questionId] = (q.type === 'MC') ? '__WRONG__' : {}; });
    var validBefore = Repo.getById('Users', admin.id).trainingValidUntil;
    var rs = ExamService.submit(admin, { attemptId: rp.data.attemptId, answers: answers });
    assert(rs.data.practice === true && rs.data.passed === false && rs.data.score === 0, 'practice submit wrong');
    assert(!rs.data.nextExamDate, 'practice must not lock');
    assert(rs.data.results.every(function (x) { return x.correct !== undefined; }), 'practice must return correct answers');
    assert(!Repo.find('ExamAnswers', function (a) { return a.attemptId === rp.data.attemptId; }).length,
      'practice wrote ExamAnswers');
    assert(Repo.getById('Users', admin.id).trainingValidUntil === validBefore, 'practice changed training validity');
    assert(!TrainingService.examLock(admin.id, null), 'practice created exam lock');
    // 正式歷史不含測試場次
    var hist = ExamService.myHistory(admin);
    assert(hist.data.every(function (a) { return Number(a.attemptNo) !== 0; }), 'practice attempts leaked into history');
    // 非管理員不可測試考試
    var denied = false;
    try { ExamService.start(t1, { practice: 1 }); } catch (e) { denied = (e.apiCode === 'FORBIDDEN' || e.apiCode === 'EXAM_LOCKED'); }
    assert(denied, 'non-admin allowed practice exam');
    ExamService.qDisable(admin, { id: mustQ.data.id }); // 清理
  });

  t('T72 題庫批次刪除、出題各分類平均', function () {
    // 批次刪除（實際移除資料列）
    var a1 = ExamService.qSave(admin, { type: 'MC', questionZh: '刪1', questionEn: 'D1',
      optionsJson: '["A","B"]', answerJson: '{"correct":"A"}' });
    var a2 = ExamService.qSave(admin, { type: 'MC', questionZh: '刪2', questionEn: 'D2',
      optionsJson: '["A","B"]', answerJson: '{"correct":"A"}' });
    var r = ExamService.qDeleteMany(admin, { ids: [a1.data.id, a2.data.id] });
    assert(r.data.deleted === 2, 'bulk delete failed: ' + r.data.deleted);
    assert(!Repo.getById('QuestionBank', a1.data.id) && !Repo.getById('QuestionBank', a2.data.id), 'rows remain');
    // 分類平均：暫時停用現有 MC，建立 3 分類 × 8 題 → 18 題應為 6/6/6
    var offIds = [];
    Repo.find('QuestionBank', function (q) { return asBool_(q.isActive) && q.type === 'MC'; })
      .forEach(function (q) { offIds.push(q.id); Repo.update('QuestionBank', q.id, { isActive: false }, 'test'); });
    var newIds = [];
    ['CatA', 'CatB', 'CatC'].forEach(function (cat) {
      for (var i = 0; i < 8; i++) {
        var s = ExamService.qSave(admin, { type: 'MC', questionZh: cat + i, questionEn: cat + i,
          optionsJson: '["A","B"]', answerJson: '{"correct":"A"}', category: cat });
        newIds.push(s.data.id);
      }
    });
    try {
      var rp = ExamService.start(admin, { practice: 1 });
      var set = JSON.parse(Repo.getById('ExamAttempts', rp.data.attemptId).questionSetJson);
      var counts = {};
      set.filter(function (q) { return q.type === 'MC'; }).forEach(function (q) {
        var qq = Repo.getById('QuestionBank', q.questionId);
        var c = (qq && qq.category) || '?';
        counts[c] = (counts[c] || 0) + 1;
      });
      assert(counts.CatA === 6 && counts.CatB === 6 && counts.CatC === 6,
        'categories not balanced: ' + JSON.stringify(counts));
    } finally {
      newIds.forEach(function (id) { Repo.remove('QuestionBank', id); });
      offIds.forEach(function (id) { Repo.update('QuestionBank', id, { isActive: true }, 'test'); });
    }
  });

  t('T73 必考批次勾選、流程圖配合題（全對才得分）', function () {
    // 必考批次設定/取消
    var ids = Repo.find('QuestionBank', function (q) { return asBool_(q.isActive) && q.type === 'MC'; })
      .slice(0, 3).map(function (q) { return q.id; });
    var r1 = ExamService.qSetMustMany(admin, { ids: ids, mustInclude: true });
    assert(r1.data.updated === 3, 'bulk set must failed');
    assert(ids.every(function (id) { return asBool_(Repo.getById('QuestionBank', id).mustInclude); }), 'must not set');
    var r2 = ExamService.qSetMustMany(admin, { ids: ids, mustInclude: false });
    assert(r2.data.updated === 3 &&
      ids.every(function (id) { return !asBool_(Repo.getById('QuestionBank', id).mustInclude); }), 'must not unset');
    // 既有部署自動升級：確保 PTW 流程圖配合題存在且為唯一配合題（必考）
    ensurePtwProcessQuestion_();
    var diagQs = Repo.find('QuestionBank', function (q) {
      return asBool_(q.isActive) && String(q.optionsJson || '').indexOf('"diagram":"ptwProcess"') >= 0;
    });
    assert(diagQs.length === 1 && asBool_(diagQs[0].mustInclude), 'diagram question missing/not must');
    assert(!Repo.find('QuestionBank', function (q) {
      return q.type === 'Match' && q.category === 'Sample';
    }).length, 'old sample match questions remain');
    // 流程圖題必被抽入；配合題全對才得 10 分（部分正確 = 0 分）
    var rp = ExamService.start(admin, { practice: 1 });
    var set = JSON.parse(Repo.getById('ExamAttempts', rp.data.attemptId).questionSetJson);
    var mt = set.filter(function (q) { return q.type === 'Match'; });
    assert(mt.length === 1 && mt[0].questionId === diagQs[0].id, 'diagram question not drawn');
    var answers = {};
    set.forEach(function (q) {
      if (q.type === 'MC') { answers[q.questionId] = '__WRONG__'; }
      else {
        var partial = {}; var keys = Object.keys(q.answer);
        partial[keys[0]] = q.answer[keys[0]];           // 只答對第一格
        answers[q.questionId] = partial;
      }
    });
    var rs = ExamService.submit(admin, { attemptId: rp.data.attemptId, answers: answers });
    assert(rs.data.score === 0, 'partial match must score 0, got ' + rs.data.score);
    // 全對 → 10 分
    var rp2 = ExamService.start(admin, { practice: 1 });
    var set2 = JSON.parse(Repo.getById('ExamAttempts', rp2.data.attemptId).questionSetJson);
    var a2 = {};
    set2.forEach(function (q) { a2[q.questionId] = (q.type === 'MC') ? '__WRONG__' : q.answer; });
    var rs2 = ExamService.submit(admin, { attemptId: rp2.data.attemptId, answers: a2 });
    assert(rs2.data.score === 10, 'full match should score 10, got ' + rs2.data.score);
  });

  t('T74 看板不重複：逾期的 Active PTW 只列於 Overdue', function () {
    var d = PTWService.createDraft(t1).data;
    Repo.update('PTW_Master', d.ptwId, { status: CFG.STATUS.ACTIVE, executionDate: '2026-01-01',
      vessel: 'V-OD', areaLocation: 'KP', workDescription: 'overdue-dup test',
      holderUserId: t1.id, validTo: '2026-01-02 23:59:59' }, 'test');
    var b = DashboardService.board(admin).data;
    var inA = b.active.some(function (r) { return r.id === d.ptwId; });
    var inO = b.overdue.some(function (r) { return r.id === d.ptwId; });
    assert(!inA && inO, 'expired PTW placement wrong: active=' + inA + ' overdue=' + inO);
    Repo.update('PTW_Master', d.ptwId, { isActive: false }, 'test');
  });

  t('T75 副本清單/週報設定與測試寄信', function () {
    var r1 = NotificationService.ccMailSet(admin, { list: 'cc1@x.com\ncc2@x.com',
      events: { ptwReturned: false }, weeklyList: 'wk@x.com' });
    assert(r1.ok, 'ccMailSet failed');
    var g = NotificationService.ccMailGet(admin).data;
    assert(g.list.indexOf('cc1@x.com') >= 0 && g.weeklyList === 'wk@x.com', 'cc settings roundtrip failed');
    assert(g.events.ptwReturned === false, 'event toggle not saved');
    assert(g.eventDefs.length >= 12, 'event defs missing');
    // 無效 email 擋下
    var bad = false;
    try { NotificationService.ccMailSet(admin, { list: 'not-an-email' }); }
    catch (e) { bad = (e.apiCode === 'BAD_EMAIL'); }
    assert(bad, 'invalid email accepted');
    // 週報內容：建一筆 Active，摘要應含其編號與統計
    var d = PTWService.createDraft(t1).data;
    Repo.update('PTW_Master', d.ptwId, { status: CFG.STATUS.ACTIVE, executionDate: '2026-09-09',
      vessel: 'DLB-1600', areaLocation: 'KP', workDescription: 'weekly summary test',
      holderUserId: t1.id, validFrom: '2026-09-09 00:00:00', validTo: '2099-01-01 23:59:59' }, 'test');
    var sum = NotificationService.buildWeeklySummary();
    assert(sum.html.indexOf('DLB-1600') >= 0 && sum.counts.active >= 1, 'weekly summary missing data');
    // 測試寄信：週報與事件皆可
    assert(NotificationService.mailTest(admin, { email: 'me@x.com', eventKey: 'weeklySummary' }).ok, 'weekly test mail failed');
    assert(NotificationService.mailTest(admin, { email: 'me@x.com', eventKey: 'ptwIssued' }).ok, 'event test mail failed');
    var badEv = false;
    try { NotificationService.mailTest(admin, { email: 'me@x.com', eventKey: 'nope' }); }
    catch (e) { badEv = (e.apiCode === 'BAD_EVENT'); }
    assert(badEv, 'unknown event accepted');
    Repo.update('PTW_Master', d.ptwId, { isActive: false }, 'test');
  });

  t('T76 一鍵重置：清空 PTW/公司/人員、編號歸零、只留指定管理員', function () {
    // 準備保留帳號
    var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC'; });
    var keep = Repo.findOne('Users', function (u) { return normEmail_(u.email) === 'paultong.ehs@gmail.com'; }) ||
      Repo.insert('Users', { email: 'paultong.ehs@gmail.com', nameZh: 'Paul', nameEn: 'Paul',
        companyId: nmdc.id, tier: 5, isAdmin: true, status: 'Active',
        passwordSalt: 's', passwordHash: 'h', hashIter: CFG.HASH_ITERATIONS }, 'test');
    // 未輸入確認字 → 拒絕
    var denied = false;
    try { TestModeService.factoryReset(admin, { confirm: 'no' }); }
    catch (e) { denied = (e.apiCode === 'CONFIRM_REQUIRED'); }
    assert(denied, 'reset ran without confirmation');
    // 執行重置
    var r = TestModeService.factoryReset(admin, { confirm: 'RESET' });
    assert(r.ok && r.data.keptAdmin === 'paultong.ehs@gmail.com', 'reset failed');
    assert(Repo.readAll('PTW_Master').length === 0, 'PTWs remain');
    assert(Repo.readAll('PTW_Certificates').length === 0 && Repo.readAll('PTW_Approvals').length === 0 &&
      Repo.readAll('PTW_Attachments').length === 0, 'PTW child records remain');
    var us = Repo.readAll('Users');
    assert(us.length === 1 && normEmail_(us[0].email) === 'paultong.ehs@gmail.com', 'users not wiped: ' + us.length);
    assert(Repo.readAll('Companies').every(function (c) { return c.type === 'NMDC' || c.id === keep.companyId; }),
      'contractor companies remain');
    assert(Repo.readAll('Sequences').length === 0, 'sequences not reset');
    assert(SequenceService.next('PTW') === 'OPTW-0001', 'numbering did not restart');
    // 題庫/課程/設定保留
    assert(Repo.readAll('QuestionBank').length > 0, 'question bank wiped!');
    assert(Repo.readAll('TrainingCourses').length > 0, 'courses wiped!');
  });

  console.log('\n===== M4.2 Test Results =====\n' + results.join('\n'));
  return results;
}

/** 測試資料清理（停用測試帳號） */
function testCleanup() {
  var admin = Repo.findOne('Users', function (u) { return asBool_(u.isAdmin); });
  var t1 = Repo.findOne('Users', function (u) { return u.email === 'test-applicant@example.com'; });
  if (t1) UserService.disable(admin, { userId: t1.id });
  console.log('testCleanup done.');
}

/* ============================== OneClick.gs ============================== */
/**
 * OneClick.gs — 一鍵安裝
 * 執行 oneClickSetup() 一次即可：自動建立資料庫 Spreadsheet、Drive 資料夾、
 * 產生 PEPPER 與管理員初始密碼、建表、種子資料。之後只需「部署 → 網頁應用程式」。
 *
 * 若想使用自己已建立的 Google Sheet / Drive 資料夾，
 * 請在檔案最上方 ONE_CLICK_CONFIG 內貼上 ID；留空則自動建立。
 */

function oneClickSetup() {
  var props = PropertiesService.getScriptProperties();
  var cfgIn = (typeof ONE_CLICK_CONFIG !== 'undefined') ? ONE_CLICK_CONFIG : {};
  var report = [];

  // 1) Spreadsheet
  var ssId = (cfgIn.SPREADSHEET_ID || '').trim() || props.getProperty('SPREADSHEET_ID');
  if (!ssId) {
    var ss = SpreadsheetApp.create('Offshore PTW Database');
    ssId = ss.getId();
    report.push('✅ 已自動建立資料庫 Spreadsheet：Offshore PTW Database');
  } else {
    SpreadsheetApp.openById(ssId).getName(); // 驗證可存取
    report.push('✅ 使用既有 Spreadsheet：' + ssId);
  }
  props.setProperty('SPREADSHEET_ID', ssId);

  // 2) Drive 根資料夾
  var folderId = (cfgIn.DRIVE_ROOT_FOLDER_ID || '').trim() || props.getProperty('DRIVE_ROOT_FOLDER_ID');
  if (!folderId) {
    var folder = DriveApp.createFolder('Offshore PTW System');
    folderId = folder.getId();
    report.push('✅ 已自動建立 Drive 根資料夾：Offshore PTW System');
  } else {
    DriveApp.getFolderById(folderId).getName(); // 驗證可存取
    report.push('✅ 使用既有 Drive 資料夾：' + folderId);
  }
  props.setProperty('DRIVE_ROOT_FOLDER_ID', folderId);

  // 3) 把 Spreadsheet 移入根資料夾（失敗不中斷）
  try {
    DriveApp.getFileById(ssId).moveTo(DriveApp.getFolderById(folderId));
    report.push('✅ Spreadsheet 已移入根資料夾');
  } catch (e) { report.push('ℹ️ Spreadsheet 未移動（' + e.message + '）'); }

  // 4) PEPPER（只產生一次，之後永不更改）
  if (!props.getProperty('PEPPER')) {
    props.setProperty('PEPPER', randomToken_(48) + randomToken_(48));
    report.push('✅ 已產生 PEPPER（密碼加密用，請勿刪除此指令碼屬性）');
  } else {
    report.push('✅ PEPPER 已存在（沿用）');
  }

  // 5) 管理員帳號：預設為執行者本人
  var adminEmail = props.getProperty('ADMIN_EMAIL');
  if (!adminEmail) {
    adminEmail = normEmail_(Session.getActiveUser().getEmail());
    if (!adminEmail) throw new Error('無法取得您的 Email，請在指令碼屬性手動設定 ADMIN_EMAIL 後重新執行。');
    props.setProperty('ADMIN_EMAIL', adminEmail);
  }
  var adminPw = props.getProperty('ADMIN_INIT_PASSWORD');
  var pwGenerated = false;
  if (!adminPw) {
    adminPw = 'Ptw' + randomToken_(9).replace(/[^A-Za-z0-9]/g, 'x').substring(0, 8) + '9';
    props.setProperty('ADMIN_INIT_PASSWORD', adminPw);
    pwGenerated = true;
  }

  // 6) 建表 + 種子資料 + Drive 子資料夾 + 到期掃描排程
  initSheets();
  seedData();
  initDriveFolders();
  report.push('✅ 資料表 ' + Object.keys(SHEETS).length + ' 張已建立、種子資料完成');
  report.push(ensureQuickAdmin_());
  var trg = SchedulerService.setupTriggers();
  report.push(trg === 'ok' ? '✅ 每小時到期掃描排程已建立' : 'ℹ️ 排程建立略過（' + trg + '），可稍後手動執行 setupTriggers');

  // 7) 總結
  var summary = [
    '========================================',
    '🎉 Offshore PTW System 一鍵安裝完成！',
    '========================================',
    report.join('\n'),
    '',
    '📋 資料庫：https://docs.google.com/spreadsheets/d/' + ssId,
    '📁 Drive：https://drive.google.com/drive/folders/' + folderId,
    '',
    '👤 管理員帳號：' + adminEmail,
    '⚡ 快速管理員：帳號 admin ／ 密碼 admin（僅限內部測試環境使用）',
    pwGenerated
      ? ('🔑 初始密碼：' + adminPw + '（首次登入會要求變更）')
      : '🔑 初始密碼：沿用先前設定（指令碼屬性 ADMIN_INIT_PASSWORD）',
    '',
    '▶️ 最後一步：右上「部署」→「新增部署」→ 類型「網頁應用程式」',
    '   執行身分：我／存取權：所有人 → 複製網址，用瀏覽器開啟即可使用。',
    '========================================'
  ].join('\n');
  console.log(summary);
  return summary;
}

/**
 * 忘記管理員密碼時：在 GAS 編輯器選擇此函式執行，
 * 執行紀錄會顯示新密碼（登入後會要求變更）。
 */
function resetAdminPassword() {
  var props = PropertiesService.getScriptProperties();
  var adminEmail = normEmail_(props.getProperty('ADMIN_EMAIL') || Session.getActiveUser().getEmail());
  var user = Repo.findOne('Users', function (u) { return normEmail_(u.email) === adminEmail; });
  if (!user) throw new Error('找不到管理員帳號：' + adminEmail + '（請確認指令碼屬性 ADMIN_EMAIL）');
  var pw = 'Ptw' + randomToken_(9).replace(/[^A-Za-z0-9]/g, 'x').substring(0, 8) + '9';
  var salt = randomToken_(32);
  Repo.update('Users', user.id, {
    passwordSalt: salt, passwordHash: hashPassword_(pw, salt), hashIter: CFG.HASH_ITERATIONS,
    status: 'Active', isActive: true, failedLoginCount: 0, lockedUntil: '', mustChangePassword: true
  }, 'setup');
  props.setProperty('ADMIN_INIT_PASSWORD', pw);
  var msg = '🔑 管理員密碼已重設\n帳號：' + adminEmail + '\n新密碼：' + pw + '\n（首次登入會要求變更）';
  console.log(msg);
  return msg;
}

/** 覆寫 doGet：直接提供內嵌前端頁面（?api=ping 健康檢查；?ptw=<id> QR 直達） */
function ensureDriveRootCurrent_() {
  try {
    var cfgIn = (typeof ONE_CLICK_CONFIG !== 'undefined') ? ONE_CLICK_CONFIG : {};
    var want = (cfgIn.DRIVE_ROOT_FOLDER_ID || '').trim();
    if (want && getProp_('DRIVE_ROOT_FOLDER_ID', true) !== want) {
      PropertiesService.getScriptProperties().setProperty('DRIVE_ROOT_FOLDER_ID', want);
    }
  } catch (e) {}
}

/** 既有部署自動升級：確保題庫有 PTW 流程圖配合題，並移除舊的範例配合題（每次執行僅在缺少時動作） */
function ensurePtwProcessQuestion_() {
  try {
    var has = Repo.findOne('QuestionBank', function (q) {
      return asBool_(q.isActive) && String(q.optionsJson || '').indexOf('"diagram":"ptwProcess"') >= 0;
    });
    if (has) return;
    Repo.insert('QuestionBank', ptwProcessMatchQuestion_(), 'system');
    // 移除舊的內建範例配合題（category=Sample 的 Match）
    Repo.find('QuestionBank', function (q) { return q.type === 'Match' && q.category === 'Sample'; })
      .forEach(function (q) { Repo.remove('QuestionBank', q.id); });
  } catch (e) { console.error('ensurePtwProcessQuestion_: ' + e.message); }
}

/** 既有部署自動升級：Tier 0 已取消 → 所有 Tier 0 使用者（含待審申請）自動轉為 Tier 1 */
function ensureNoTierZero_() {
  try {
    Repo.find('Users', function (u) { return Number(u.tier) === 0 || Number(u.appliedTier) === 0; })
      .forEach(function (u) {
        var patch = {};
        if (Number(u.tier) === 0) patch.tier = 1;
        if (Number(u.appliedTier) === 0) patch.appliedTier = 1;
        Repo.update('Users', u.id, patch, 'system');
      });
  } catch (e) { console.error('ensureNoTierZero_: ' + e.message); }
}

function doGet(e) {
  ensureDriveRootCurrent_();
  ensurePtwProcessQuestion_();
  ensureNoTierZero_();
  ensureTestNmdcAdmin_();
  if (e && e.parameter && e.parameter.api) {
    return ContentService.createTextOutput(JSON.stringify(
      ok_({ service: 'Offshore PTW System API', time: fmtDateTime_(), version: 'M4.1-onefile' })
    )).setMimeType(ContentService.MimeType.JSON);
  }
  var html = INDEX_HTML_;
  var openId = (e && e.parameter && e.parameter.ptw) ? String(e.parameter.ptw).replace(/[^\w-]/g, '') : '';
  if (openId) html = html.replace('window.PTW_OPEN_ID=null', "window.PTW_OPEN_ID='" + openId + "'");
  // 瀏覽次數：每次載入頁面 +1（Script Properties 累計），注入頁面左下角顯示
  var views = 0;
  try {
    var sp = PropertiesService.getScriptProperties();
    views = Number(sp.getProperty('pageViews') || 0) + 1;
    sp.setProperty('pageViews', String(views));
  } catch (eV) {}
  html = html.replace('window.PTW_VIEWS=0', 'window.PTW_VIEWS=' + views);
  // 本系統的對外網址（GAS 網頁在 iframe 內，location.href 取不到真實網址）→ 供「開新視窗」使用
  var appUrl = '';
  try { appUrl = getProp_('FRONTEND_URL', true) || ScriptApp.getService().getUrl() || ''; } catch (eU) {}
  html = html.replace("window.PTW_APP_URL=''", "window.PTW_APP_URL='" + String(appUrl).replace(/'/g, '') + "'");
  // ?view=downloads → 開啟後自動捲到附件下載專區
  var goto_ = (e && e.parameter && e.parameter.view) ? String(e.parameter.view).replace(/[^\w-]/g, '') : '';
  if (goto_) html = html.replace("window.PTW_GOTO=''", "window.PTW_GOTO='" + goto_ + "'");
  return HtmlService.createHtmlOutput(html)
    .setTitle('Offshore PTW System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/** 快速管理員帳號（admin / admin）— 依業主要求，僅限內部/測試環境。
 *  直接寫入資料表（繞過密碼強度政策）；重複執行不會重建。可獨立執行本函式。 */
function ensureQuickAdmin_() {
  var trainedUntil = fmtDate_(new Date(Date.now() + 3 * 365 * 86400000));
  var existing = Repo.findOne('Users', function (u) { return normEmail_(u.email) === 'admin'; });
  if (existing) {
    var fix = {};
    if (existing.status !== 'Active' || !asBool_(existing.isActive)) {
      fix.status = 'Active'; fix.isActive = true; fix.lockedUntil = ''; fix.failedLoginCount = 0;
    }
    if (!existing.trainingValidUntil || existing.trainingValidUntil < fmtDate_()) {
      fix.trainingPassedAt = fmtDateTime_(); fix.trainingValidUntil = trainedUntil;
    }
    if (Object.keys(fix).length) Repo.update('Users', existing.id, fix, 'setup');
    return '✅ 快速管理員 admin 已存在（沿用，訓練資格已補齊）';
  }
  var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC'; });
  var salt = randomToken_(32);
  Repo.insert('Users', {
    email: 'admin', nameZh: '系統管理員', nameEn: 'Quick Admin',
    companyId: nmdc ? nmdc.id : '', title: 'System Admin', phone: '', vessel: '-',
    tier: 5, isAdmin: true, badgeNo: '',
    passwordSalt: salt, passwordHash: hashPassword_('admin', salt), hashIter: CFG.HASH_ITERATIONS,
    status: 'Active', failedLoginCount: 0, mustChangePassword: false, langPref: 'zh',
    trainingPassedAt: fmtDateTime_(), trainingValidUntil: trainedUntil
  }, 'setup');
  return '✅ 已建立快速管理員：帳號 admin ／ 密碼 admin';
}

/** 手動建立/修復快速管理員（在編輯器直接執行本函式即可） */
function createQuickAdmin() {
  console.log(ensureQuickAdmin_());
}

/** 測試管理員帳號（testnmdc / testnmdc）— 具 Admin 權限；重複執行不重建，密碼固定回復為 testnmdc */
function ensureTestNmdcAdmin_() {
  try {
    var trainedUntil = fmtDate_(new Date(Date.now() + 3 * 365 * 86400000));
    var existing = Repo.findOne('Users', function (u) { return normEmail_(u.email) === 'testnmdc'; });
    if (existing) {
      var fix = {};
      if (existing.status !== 'Active' || !asBool_(existing.isActive)) {
        fix.status = 'Active'; fix.isActive = true; fix.lockedUntil = ''; fix.failedLoginCount = 0;
      }
      if (!asBool_(existing.isAdmin) || Number(existing.tier) !== 5) { fix.isAdmin = true; fix.tier = 5; }
      if (!asBool_(existing.isTestUser)) fix.isTestUser = true;   // 測試身分：PTW 用 Example 編號、可一鍵清除
      if (!existing.trainingValidUntil || existing.trainingValidUntil < fmtDate_()) {
        fix.trainingPassedAt = fmtDateTime_(); fix.trainingValidUntil = trainedUntil;
      }
      if (Object.keys(fix).length) Repo.update('Users', existing.id, fix, 'setup');
      return;
    }
    var nmdc = Repo.findOne('Companies', function (c) { return c.type === 'NMDC'; });
    var salt = randomToken_(32);
    Repo.insert('Users', {
      email: 'testnmdc', nameZh: '測試管理員', nameEn: 'Test NMDC Admin',
      companyId: nmdc ? nmdc.id : '', title: 'Test Admin', phone: '', vessel: '-',
      tier: 5, isAdmin: true, isTestUser: true, badgeNo: '',
      passwordSalt: salt, passwordHash: hashPassword_('testnmdc', salt), hashIter: CFG.HASH_ITERATIONS,
      status: 'Active', failedLoginCount: 0, mustChangePassword: false, langPref: 'zh',
      trainingPassedAt: fmtDateTime_(), trainingValidUntil: trainedUntil
    }, 'setup');
  } catch (e) { console.error('ensureTestNmdcAdmin_: ' + e.message); }
}


/**
 * 一次性工具：將既有 PTW 資料夾搬遷至新結構（root/PTW編號/01~05）。
 * 部署新版後於編輯器選擇本函式執行一次即可（例：OPTW-0002）。
 */
function migratePtwFoldersToNewStructure() {
  ensureDriveRootCurrent_();
  var root = DriveApp.getFolderById(getProp_('DRIVE_ROOT_FOLDER_ID'));
  var NEW_FOLDERS = ['01_Application', '02_Certificates', '03_Support_Documents',
    '04_Approval_Records', '05_Close_out_evidence'];
  var MAP = { '01_Application': '01_Application', '02_Certificates': '02_Certificates',
    '03_Method_Statement': '03_Support_Documents', '04_Risk_Assessment': '03_Support_Documents',
    '05_Supporting_Documents': '03_Support_Documents', '06_Approval_Records': '04_Approval_Records',
    '07_Close-out': '05_Close_out_evidence' };
  Repo.find('PTW_Master', function (p) { return asBool_(p.isActive); }).forEach(function (m) {
    var num = m.ptwNumber || m.tempNumber;
    if (!num) return;
    var it = root.getFoldersByName(num);
    var nf = it.hasNext() ? it.next() : root.createFolder(num);
    NEW_FOLDERS.forEach(function (n) {
      if (!nf.getFoldersByName(n).hasNext()) nf.createFolder(n);
    });
    if (m.driveFolderId && m.driveFolderId !== nf.getId()) {
      try {
        var of = DriveApp.getFolderById(m.driveFolderId);
        var subs = of.getFolders();
        while (subs.hasNext()) {
          var sf = subs.next();
          var target = MAP[sf.getName()] || (NEW_FOLDERS.indexOf(sf.getName()) >= 0 ? sf.getName() : null);
          if (!target) continue;
          var tf = nf.getFoldersByName(target).next();
          var files = sf.getFiles();
          while (files.hasNext()) files.next().moveTo(tf);
        }
      } catch (e) { console.error('migrate ' + num + ' move failed: ' + e.message); }
    }
    try { nf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e) { console.error('sharing failed: ' + e.message); }
    Repo.update('PTW_Master', m.id, { driveFolderId: nf.getId() }, 'migration');
    console.log('✅ migrated: ' + num);
  });
  console.log('migratePtwFoldersToNewStructure done.');
}

/* ====== 內嵌前端頁面（由 doGet 提供） ====== */
var INDEX_HTML_ = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offshore PTW System</title>
<link href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/css/bootstrap.min.css" rel="stylesheet">
<style>
:root { --navy:#0b3a5c; --navy2:#072a44; --accent:#f0a500; --cyan:#31c3f0; --foam:#e9f6ff; }
/* ===== 海事科技感 Maritime-Tech Theme ===== */
body { font-family:'Segoe UI','Microsoft JhengHei',Arial,sans-serif; overflow-x:hidden;
 background:linear-gradient(180deg,#051d31 0%,#0a3352 38%,#0d466b 100%) fixed; min-height:100vh; position:relative; }
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
 background-image:linear-gradient(rgba(90,190,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(90,190,255,.05) 1px,transparent 1px);
 background-size:34px 34px}
body::after{content:'';position:fixed;left:0;right:0;bottom:0;height:180px;pointer-events:none;z-index:0;opacity:.5;
 background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 180'><path d='M0 90 Q150 40 300 90 T600 90 T900 90 T1200 90 V180 H0 Z' fill='rgba(49,195,240,0.10)'/><path d='M0 120 Q150 75 300 120 T600 120 T900 120 T1200 120 V180 H0 Z' fill='rgba(49,195,240,0.14)'/></svg>") bottom/1200px 180px repeat-x}
main{position:relative;z-index:1}
.ptw-header { background:linear-gradient(90deg,#051d31,#0b3a5c 60%,#0f5e8e); color:#fff; padding:.6rem 1rem;
 display:flex; align-items:center; gap:.75rem; position:relative; z-index:2;
 border-bottom:2px solid rgba(49,195,240,.55); box-shadow:0 4px 20px rgba(3,20,35,.5); }
.ptw-header::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;
 background:linear-gradient(90deg,transparent 0%,transparent 35%,var(--cyan) 50%,transparent 65%,transparent 100%);
 background-size:220% 100%;background-repeat:no-repeat;
 animation:scanline 3.5s linear infinite}
/* 以 background-position 位移（不影響版面寬度，杜絕水平卷軸） */
@keyframes scanline{0%{background-position-x:120%}100%{background-position-x:-120%}}
.ptw-header .title { font-weight:800; letter-spacing:1px; text-shadow:0 0 12px rgba(49,195,240,.5); }
.ptw-header .subtitle { font-size:.75rem; opacity:.85; }
.lang button { background:transparent; border:1px solid rgba(255,255,255,.5); color:#fff; border-radius:4px; padding:2px 10px; font-size:.8rem; }
.lang button.active { background:var(--accent); border-color:var(--accent); color:#072a44; font-weight:700; }
.card-x { background:rgba(255,255,255,.96); border:1px solid rgba(158,197,232,.55); border-radius:14px;
 box-shadow:0 6px 22px rgba(3,24,42,.30); backdrop-filter:blur(3px); }
.btn-navy { background:linear-gradient(135deg,#0b3a5c,#1173b8); border:0; color:#fff;
 box-shadow:0 3px 10px rgba(11,90,160,.35); transition:box-shadow .15s,transform .12s; }
.btn-navy:hover { background:linear-gradient(135deg,#0d4a75,#1a8ad0); color:#fff;
 box-shadow:0 5px 16px rgba(49,195,240,.45); transform:translateY(-1px); }
/* 深色背景上的直排標題 */
#homeLoggedIn > h5{color:#e9f6ff;text-shadow:0 1px 6px rgba(2,18,32,.7)}
.footer{color:#9dc4de !important}
.badge-status-PendingApproval { background:#f0a500; color:#072a44; }
.badge-status-Active { background:#1e7e34; }
.badge-status-Disabled { background:#6c757d; }
.badge-status-Locked { background:#c62828; }
.footer { color:#7a8ca0; font-size:.75rem; text-align:center; padding:1.2rem 0; }
@media (max-width:576px){ .ptw-header .subtitle{display:none;} }
.chkpill{display:inline-flex;align-items:center;gap:5px;border:1px solid #cfdcea;border-radius:18px;
 padding:4px 12px 4px 8px;font-size:.82rem;background:#fff;cursor:pointer;user-select:none;margin:0;
 transition:background .1s,border-color .1s}
.chkpill.on{background:#e3f0ff;border-color:#0b6bcb;font-weight:600}
.chkpill input{margin:0}
.stepcard{border-left:5px solid var(--navy);border-radius:8px}
.stepcard h6.sect{background:linear-gradient(90deg,#eef4fa,#fff);border-left:4px solid #f0a500;
 padding:6px 10px;border-radius:4px;margin:14px 0 8px;font-weight:700}
.hbtn{border:0;border-radius:14px;padding:18px 8px 14px;text-align:center;width:100%;cursor:pointer;
 background:linear-gradient(160deg,#ffffff,#eef4fa);box-shadow:0 3px 10px rgba(11,58,92,.10);
 border:1px solid #dbe4ee;transition:transform .12s,box-shadow .12s}
.hbtn:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(49,195,240,.4);border-color:#7fd4f5}
.hbtn .ic{width:52px;height:52px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
 font-size:1.5rem;margin-bottom:8px;color:#fff;box-shadow:inset 0 -3px 6px rgba(0,0,0,.15)}
.hbtn .lb{font-weight:600;font-size:.92rem;color:#123}
.flowbar{background:rgba(255,255,255,.93);border:1px solid rgba(158,197,232,.6);border-radius:14px;
 padding:10px 6px 12px;margin-bottom:14px;box-shadow:0 6px 22px rgba(3,24,42,.30);backdrop-filter:blur(3px)}
.fbtitle{text-align:center;font-weight:700;color:#0b3a5c;font-size:1rem;margin-bottom:6px}
.fbrow{display:flex;flex-wrap:nowrap;align-items:flex-start;justify-content:center;gap:0}
.flowstep{display:flex;flex-direction:column;align-items:center;flex:1 1 0;min-width:0;padding:4px 1px}
.flowstep .fi{width:48px;height:48px;border-radius:50%;background:#fff;
 border:2px solid #9ec5e8;box-shadow:0 1px 4px rgba(11,58,92,.15);color:#0b3a5c;
 display:flex;align-items:center;justify-content:center;font-size:1.5rem}
.flowstep .ft{font-size:.68rem;font-weight:600;color:#234;margin-top:3px;text-align:center;line-height:1.15}
.flowarrow{color:#f0a500;font-weight:bold;font-size:1rem;padding:0;margin-top:18px;flex:0 0 auto}
@media(max-width:860px){
 .flowstep .fi{width:34px;height:34px;font-size:1.05rem;border-width:1.5px}
 .flowstep .ft{font-size:.58rem}
 .flowarrow{font-size:.8rem;margin-top:12px}
}
.flowstep .fi{position:relative}
.fnum{display:none;position:absolute;top:-5px;left:-5px;width:16px;height:16px;border-radius:50%;
 background:#f0a500;color:#fff;font-size:.62rem;font-weight:700;align-items:center;justify-content:center;
 box-shadow:0 1px 3px rgba(0,0,0,.25)}
@media(max-width:576px){
 .fbrow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px 4px;justify-items:center}
 .flowarrow{display:none}
 .flowstep{padding:0}
 .flowstep .fi{width:42px;height:42px;font-size:1.3rem;border-width:2px}
 .flowstep .ft{font-size:.62rem;margin-top:4px}
 .fnum{display:flex}
 .fbtitle{font-size:.92rem}
}
#netbar{position:fixed;top:0;left:0;height:3px;width:100%;z-index:2000;display:none;overflow:hidden;background:rgba(240,165,0,.25)}
/* 首頁公告欄（常駐） */
.annBoard{background:linear-gradient(135deg,rgba(6,29,48,.92),rgba(11,58,92,.92));color:#dff1ff;
 border:1px solid rgba(49,195,240,.45);border-radius:14px;padding:12px 16px;
 box-shadow:0 6px 22px rgba(3,24,42,.4),inset 0 0 30px rgba(49,195,240,.05)}
.annBoard .annHead{font-weight:800;letter-spacing:.5px;display:flex;align-items:center;gap:8px;
 border-bottom:1px solid rgba(49,195,240,.3);padding-bottom:6px;margin-bottom:8px}
.annBoard .annLive{margin-left:auto;font-size:.7rem;color:#37e08b;letter-spacing:2px}
.annBoard .annLive::before{content:'●';margin-right:4px;animation:pulse 1.6s infinite}
/* (3) 系統管理頁 科技感 */
#viewAdmin .nav-tabs{border:0;gap:6px;flex-wrap:wrap;margin-bottom:4px}
#viewAdmin .nav-tabs .nav-link{border:1px solid #cfe0ef;border-radius:9px;color:#0b3a5c;background:#fff;
 font-weight:600;font-size:.85rem;padding:.45rem .8rem;transition:all .15s}
#viewAdmin .nav-tabs .nav-link:hover{border-color:#1173b8;box-shadow:0 2px 8px rgba(17,115,184,.18)}
#viewAdmin .nav-tabs .nav-link.active{background:linear-gradient(135deg,#0b3a5c,#1173b8);color:#fff;
 border-color:transparent;box-shadow:0 4px 14px rgba(11,90,160,.35)}
#viewAdmin .tab-content>.tab-pane{padding-top:10px}
#viewAdmin .card-x{border:1px solid #dbe8f4;border-top:3px solid #1173b8;border-radius:12px;
 box-shadow:0 4px 16px rgba(11,58,92,.07)}
#viewAdmin .table thead th{background:#f0f6fb;color:#0b3a5c;border-bottom:2px solid #cfe0ef}
.adminBanner{background:linear-gradient(120deg,#081f33 0%,#0b3a5c 55%,#0f5e8e 100%);color:#fff;border-radius:14px;
 padding:16px 22px;margin-bottom:14px;position:relative;overflow:hidden;
 box-shadow:0 8px 24px rgba(8,31,51,.35)}
.adminBanner::before{content:'';position:absolute;inset:0;
 background-image:linear-gradient(rgba(120,200,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(120,200,255,.07) 1px,transparent 1px);
 background-size:26px 26px}
.adminBanner h5{margin:0;font-weight:800;letter-spacing:.5px}
.adminBanner .sub{opacity:.75;font-size:.8rem}
.adminBanner .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#37e08b;
 box-shadow:0 0 8px #37e08b;margin-right:6px;animation:pulse 1.6s infinite}
@keyframes pulse{50%{opacity:.35}}
#netbar::after{content:'';display:block;height:100%;width:38%;background:var(--accent);
 animation:netslide 1s linear infinite;border-radius:2px}
@keyframes netslide{0%{transform:translateX(-40%)}100%{transform:translateX(280%)}}
</style>
</head>
<body>

<!-- 測試模式頂部列（僅管理員啟用後顯示） -->
<div id="testBar" class="d-none" style="background:linear-gradient(90deg,#e65100,#f57c00);color:#fff;
  padding:6px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.85rem;position:sticky;top:0;z-index:1100">
  <span style="font-weight:700">🧪 <span data-i18n="tm.bar">TEST MODE</span></span>
  <select id="tmSelect" class="form-select form-select-sm" style="max-width:340px" onchange="tmSwitch(this.value)"></select>
  <button class="btn btn-sm btn-light" onclick="tmExit()" data-i18n="tm.exit">Exit test mode</button>
</div>

<header class="ptw-header">
  <span style="font-size:1.4rem;cursor:pointer" onclick="goHome()" title="Home 首頁">⚓</span>
  <div class="flex-grow-1" style="cursor:pointer" onclick="goHome()" title="Home 首頁">
    <div class="title" data-i18n="app.title">Offshore PTW System</div>
    <div class="subtitle" id="subtitle" data-i18n="app.project"></div>
  </div>
  <button class="btn btn-sm btn-outline-light me-2" onclick="openCertified()" title="合格人員 Certified Personnel">🪪 <span data-l>合格人員 Certified</span></button>
  <div class="lang me-2">
    <button id="btnEn" onclick="switchLang('en')">EN</button>
    <button id="btnZh" onclick="switchLang('zh')">中文</button>
  </div>
  <div class="dropdown">
    <button class="btn btn-sm btn-outline-light dropdown-toggle" type="button" id="acctMenuBtn"
            data-bs-toggle="dropdown" aria-expanded="false">
      <span id="acctMenuLabel">👤 <span data-i18n="menu.guest">Account</span></span>
    </button>
    <ul class="dropdown-menu dropdown-menu-end" id="acctMenu" style="min-width:230px"></ul>
  </div>
</header>

<!-- ==================== 登入區 ==================== -->
<main class="container" style="max-width:980px" id="viewAuth">
  <div class="mt-3"><a href="#" onclick="enter();return false">← <span data-i18n="app.title">Offshore PTW System</span></a></div>
  <div class="row justify-content-center g-4 mt-0">
    <div class="col-md-6" id="panelLogin">
      <div class="card-x p-4">
        <h4 data-i18n="login.title">Sign in</h4>
        <div id="loginAlert" class="alert alert-danger d-none"></div>
        <div class="mb-3">
          <label class="form-label" data-i18n="login.email">Email (account)</label>
          <input type="email" id="loginEmail" class="form-control" autocomplete="username">
        </div>
        <div class="mb-3">
          <label class="form-label" data-i18n="login.password">Password</label>
          <div class="input-group">
            <input type="password" id="loginPassword" class="form-control" autocomplete="current-password">
            <button class="btn btn-outline-secondary" type="button" id="btnTogglePw" onclick="togglePw()" data-i18n="login.show">Show</button>
          </div>
        </div>
        <div class="form-check mb-3">
          <input class="form-check-input" type="checkbox" id="keepSignedIn" checked>
          <label class="form-check-label small text-muted" for="keepSignedIn" data-i18n="login.keep">Keep me signed in on this computer</label>
        </div>
        <button class="btn btn-navy w-100" id="btnLogin" onclick="doLogin()"><span data-i18n="login.submit">Sign in</span></button>
        <div class="d-flex justify-content-between mt-3">
          <a href="#" onclick="showPanel('Apply');return false" data-i18n="login.apply">Apply for an account</a>
          <a href="#" onclick="showPanel('Forgot');return false" data-i18n="login.forgot">Forgot password?</a>
        </div>
      </div>
    </div>

    <div class="col-md-8 d-none" id="panelApply">
      <div class="card-x p-4">
        <h4 data-i18n="apply.title">Account Application</h4>
        <div id="applyAlert" class="alert d-none"></div>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label" data-i18n="apply.nameZh"></label><input id="apNameZh" class="form-control"></div>
          <div class="col-md-6"><label class="form-label" data-i18n="apply.nameEn"></label><input id="apNameEn" class="form-control"></div>
          <div class="col-md-6"><label class="form-label" data-i18n="apply.company"></label>
            <select id="apCompany" class="form-select"><option value="">--</option></select></div>
          <div class="col-md-3"><label class="form-label" data-i18n="apply.title2"></label><input id="apTitle" class="form-control"></div>
          <div class="col-md-3"><label class="form-label" data-i18n="apply.isHse">是否為 HSE 人員？</label>
            <select id="apIsHse" class="form-select">
              <option value="">--</option>
              <option value="N" data-i18n="common.no">否 No</option>
              <option value="Y" data-i18n="common.yes">是 Yes</option>
            </select></div>
          <div class="col-md-6"><label class="form-label" data-i18n="login.email"></label><input id="apEmail" type="email" class="form-control"></div>
          <div class="col-md-6"><label class="form-label" data-i18n="apply.phone"></label><input id="apPhone" class="form-control"></div>
          <div class="col-md-6"><label class="form-label" data-i18n="apply.vessel"></label><input id="apVessel" class="form-control"></div>
          <div class="col-md-6"><label class="form-label"><span data-i18n="apply.tier"></span>
            <a href="#" onclick="showTierHelp();return false" title="Tier 說明" style="text-decoration:none;margin-left:4px">
            <span style="display:inline-flex;width:18px;height:18px;border-radius:50%;background:#0b6bcb;color:#fff;align-items:center;justify-content:center;font-size:.72rem;font-weight:700">?</span></a></label>
            <select id="apTier" class="form-select">
              <option value="1" selected style="color:#b35c00;font-weight:600">【承商 Contractor】Tier 1 — 承商持有人／申請人 Holder / Applicant</option>
              <option value="2" style="color:#b35c00;font-weight:600">【承商 Contractor】Tier 2 — 承商職安衛 Contractor HSE</option>
              <option value="3" style="color:#0b6bcb;font-weight:600">【NMDC】Tier 3 — 施工部門 Construction</option>
              <option value="4" style="color:#0b6bcb;font-weight:600">【NMDC】Tier 4 — 安衛部門 HSE</option>
              <option value="5" style="color:#0b6bcb;font-weight:600">【NMDC】Tier 5 — PTW 協調員 Coordinator</option>
            </select></div>
          <div class="col-12"><label class="form-label" data-i18n="apply.reason"></label><textarea id="apReason" class="form-control" rows="2"></textarea></div>
          <div class="col-md-6"><label class="form-label" data-i18n="apply.password"></label><input id="apPw" type="password" class="form-control"></div>
          <div class="col-md-6"><label class="form-label" data-i18n="apply.confirm"></label><input id="apPw2" type="password" class="form-control"></div>
          <div class="col-12">
            <label class="form-label fw-bold" data-i18n="sig.title">簽名檔 ＊</label>
            <ol class="small text-muted mb-2" style="padding-left:1.2rem" id="apSigSteps">
              <li data-i18n="sig.step1">在白紙上簽名</li>
              <li data-i18n="sig.step2">拍照並上傳檔案</li>
              <li data-i18n="sig.step3">按下「清除背景」按鈕</li>
              <li data-i18n="sig.step4">確認簽名檔無誤（之後將使用此作為您的簽名檔案）</li>
            </ol>
            <div class="d-flex gap-2 flex-wrap align-items-center">
              <input type="file" id="apSigFile" accept="image/*" class="form-control" style="max-width:280px" onchange="sigLoadImage(this,'ap')">
              <button type="button" class="btn btn-outline-primary" id="apSigBtn" onclick="sigRemoveBg('ap')" disabled data-i18n="sig.removeBg">清除背景</button>
            </div>
            <div id="apSigMsg" class="small text-muted mt-1"></div>
            <canvas id="apSigCanvas" width="480" height="180" class="d-none mt-2" style="border:1px dashed #9ec5e8;border-radius:6px;max-width:100%;background:repeating-conic-gradient(#f2f2f2 0% 25%,#fff 0% 50%) 50%/16px 16px"></canvas>
          </div>
        </div>
        <div class="mt-3 d-flex gap-2">
          <button class="btn btn-navy" id="btnApply" onclick="doApply()" data-i18n="apply.submit"></button>
          <button class="btn btn-outline-secondary" onclick="showPanel('Login')" data-i18n="common.cancel"></button>
        </div>
      </div>
    </div>

    <div class="col-md-6 d-none" id="panelForgot">
      <div class="card-x p-4">
        <h4 data-i18n="forgot.title">Password Reset</h4>
        <div id="forgotAlert" class="alert d-none"></div>
        <p class="small text-muted" data-i18n="forgot.hint"></p>
        <label class="form-label" data-i18n="login.email"></label>
        <input id="fgEmail" type="email" class="form-control mb-2">
        <button class="btn btn-navy" onclick="doForgot()" data-i18n="forgot.submit"></button>
        <hr>
        <p class="small text-muted" data-l>Have a reset code from email? 已收到重設碼？</p>
        <input id="rsToken" class="form-control mb-2" data-l-ph placeholder="Reset code 重設碼">
        <input id="rsPw" type="password" class="form-control mb-2" data-l-ph placeholder="New password 新密碼">
        <button class="btn btn-outline-primary" onclick="doReset()" data-i18n="reset.submit"></button>
        <div class="mt-3"><a href="#" onclick="showPanel('Login');return false" data-i18n="login.title"></a></div>
      </div>
    </div>
  </div>
</main>

<!-- ==================== 管理主控台 ==================== -->
<main class="container-fluid mt-3 d-none" style="max-width:1200px" id="viewAdmin">
  <div class="adminBanner">
    <h5>⚙️ <span data-i18n="admin.consoleTitle">System Administration Console</span></h5>
    <div class="sub"><span class="dot"></span><span data-i18n="admin.consoleSub">Offshore PTW System · Tongxiao P2 Subsea Gas Pipeline (P2913)</span></div>
  </div>
  <ul class="nav nav-tabs">
    <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tabPending" type="button">
      <span data-i18n="admin.pending">Pending</span> <span id="pendingCount" class="badge bg-danger"></span></button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabUsers" type="button" data-i18n="admin.users">Users</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabCompanies" type="button" data-i18n="admin.companies">Companies</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabTraining" type="button" data-i18n="trAdmin.title">Training</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabDownloads" type="button" onclick="loadAdminDownloads()">📥 <span data-i18n="dl.title">Downloads</span></button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabAnnounce" type="button" onclick="loadAdminAnnounces()">📢 <span data-i18n="ann.title">Announcements</span></button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabReports" type="button" onclick="loadReports()">📊 <span data-i18n="rp.title">Reports</span></button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabAudit" type="button" data-i18n="admin.audit">Audit Trail</button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabFlowChart" type="button" onclick="loadFlowChart()">🗂 <span data-i18n="admin.flowChart">Approval Flow</span></button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabNumbers" type="button" onclick="loadNumbers()">🔢 <span data-i18n="admin.numbers">Numbers</span></button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabIssueMail" type="button" onclick="loadIssueList()">📬 <span data-l>核發通知 Issue Mail</span></button></li>
    <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabTestMode" type="button">🧪 <span data-i18n="tm.title">Test Mode</span></button></li>
  </ul>
  <div class="tab-content card-x p-3" style="border-top:0;border-top-left-radius:0">
    <div class="tab-pane fade show active" id="tabPending">
      <div id="pendingList" class="table-responsive"></div>
      <hr>
      <h6>📝 <span data-i18n="ac.reqTitle">Profile Change Requests 資料修改申請</span> <span id="profileReqCount" class="badge bg-warning text-dark"></span></h6>
      <div id="profileReqList" class="table-responsive"></div>
    </div>
    <div class="tab-pane fade" id="tabUsers">
      <div class="d-flex gap-2 mb-2 flex-wrap align-items-center">
        <input id="userSearch" class="form-control" style="max-width:240px" data-i18n-ph="common.search" oninput="loadUsers()">
        <select id="ufCompany" class="form-select" style="max-width:220px" onchange="loadUsers()"></select>
        <select id="ufTier" class="form-select" style="max-width:150px" onchange="loadUsers()">
          <option value="" data-l>Tier（全部 All）</option>
          <option value="1">Tier 1</option><option value="2">Tier 2</option>
          <option value="3">Tier 3</option><option value="4">Tier 4</option><option value="5">Tier 5</option>
        </select>
        <select id="ufStatus" class="form-select" style="max-width:170px" onchange="loadUsers()">
          <option value="" data-l>狀態（全部 Status）</option>
          <option value="Active">Active</option><option value="PendingApproval">PendingApproval</option>
          <option value="Locked">Locked</option><option value="Disabled">Disabled</option>
        </select>
        <button class="btn btn-sm btn-outline-secondary" onclick="exportUsers()" data-i18n="admin.exportUsers"></button>
        <span id="ufCount" class="small text-muted"></span>
      </div>
      <div id="userList" class="table-responsive"></div>
    </div>
    <div class="tab-pane fade" id="tabCompanies">
      <div class="row g-2 mb-3">
        <div class="col-md-3"><input id="coNameZh" class="form-control" placeholder="公司名稱（中文）"></div>
        <div class="col-md-3"><input id="coNameEn" class="form-control" placeholder="Company Name (EN)"></div>
        <div class="col-md-3"><select id="coType" class="form-select">
          <option value="Contractor" data-l>Contractor 承商</option><option value="NMDC">NMDC</option><option value="TPC" data-l>TPC 台電</option>
        </select></div>
        <div class="col-md-3"><button class="btn btn-navy w-100" onclick="addCompany()" data-i18n="admin.addCompany"></button></div>
      </div>
      <div class="d-flex gap-2 mb-2 flex-wrap">
        <input id="coSearch" class="form-control" style="max-width:240px" data-l-ph placeholder="搜尋公司 Search company…" oninput="loadCompanies()">
        <select id="cofType" class="form-select" style="max-width:180px" onchange="loadCompanies()">
          <option value="" data-l>類型（全部 Type）</option>
          <option value="Contractor" data-l>Contractor 承商</option><option value="NMDC">NMDC</option><option value="TPC" data-l>TPC 台電</option>
        </select>
      </div>
      <div id="companyList" class="table-responsive"></div>
    </div>
    <div class="tab-pane fade" id="tabTraining">
      <h6 data-i18n="trAdmin.title">Training Management</h6>
      <div class="border rounded p-2 mb-2" style="background:#f6f9fc">
        <b class="small">🇹🇼 <span data-l>中文版課程 Chinese Course（介面為中文的學員觀看）</span></b>
        <div class="row g-2 mt-1">
          <div class="col-md-4"><input id="tcTitle" class="form-control" data-i18n-ph="trAdmin.courseTitle"></div>
          <div class="col-md-4"><textarea id="tcVideo" class="form-control" rows="3" data-i18n-ph="trAdmin.videoId"></textarea></div>
          <div class="col-md-2"><input id="tcVersion" class="form-control" placeholder="v1"></div>
          <div class="col-md-2"><button class="btn btn-navy w-100" onclick="saveCourse('zh')" data-i18n="trAdmin.save"></button></div>
        </div>
      </div>
      <div class="border rounded p-2 mb-3" style="background:#f6f9fc">
        <b class="small">🇬🇧 <span data-l>英文版課程 English Course（介面為英文的學員觀看）</span></b>
        <div class="row g-2 mt-1">
          <div class="col-md-4"><input id="tcTitleEn" class="form-control" data-i18n-ph="trAdmin.courseTitle"></div>
          <div class="col-md-4"><textarea id="tcVideoEn" class="form-control" rows="3" data-i18n-ph="trAdmin.videoId"></textarea></div>
          <div class="col-md-2"><input id="tcVersionEn" class="form-control" placeholder="v1"></div>
          <div class="col-md-2"><button class="btn btn-navy w-100" onclick="saveCourse('en')" data-i18n="trAdmin.save"></button></div>
        </div>
      </div>
      <hr>
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h6 class="mb-0" data-i18n="trAdmin.qbank">Question Bank</h6>
        <div class="d-flex gap-1 flex-wrap">
          <button class="btn btn-sm btn-navy" onclick="openQEditor()">＋ <span data-i18n="qe.add">Add Question</span></button>
          <button class="btn btn-sm btn-warning" onclick="startPracticeExam()">🧪 <span data-l>測試考試 Test Exam</span></button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteSelectedQuestions()">🗑 <span data-l>刪除選取 Delete Selected</span></button>
          <button class="btn btn-sm btn-outline-danger fw-bold" onclick="setMustSelected(true)">⭐ <span data-l>設為必考 Set Must</span></button>
          <button class="btn btn-sm btn-outline-secondary" onclick="setMustSelected(false)">☆ <span data-l>取消必考 Unset Must</span></button>
          <button class="btn btn-sm btn-outline-primary" onclick="$('qXlsxFile').click()">⬆︎ <span data-i18n="qe.importX">Import Excel</span></button>
          <button class="btn btn-sm btn-outline-secondary" onclick="exportQuestionsXlsx()">⬇︎ <span data-i18n="qe.exportX">Export Excel</span></button>
          <button class="btn btn-sm btn-outline-secondary" onclick="downloadQTemplate()">📋 <span data-i18n="qe.template">Template</span></button>
          <input type="file" id="qXlsxFile" accept=".xlsx,.xls" class="d-none" onchange="importQuestionsXlsx(this)">
        </div>
      </div>
      <div class="small text-muted my-1">🧮 <span data-l>考試組成（固定）：18 題選擇題（各 5 分）＋ 1 題配合題（10 分，全對才得分）＝ 100 分，及格 60。</span></div>
      <!-- 題目編輯器 -->
      <div id="qEditor" class="card-x p-3 my-2 d-none" style="background:#f8fbff;border-color:#9ec5e8">
        <input type="hidden" id="qeId">
        <div class="row g-2">
          <div class="col-md-2"><label class="form-label small mb-0" data-l>題型 Type</label>
            <select id="qeType" class="form-select form-select-sm" onchange="renderQeTypeArea()">
              <option value="MC" data-l>選擇題 MC</option><option value="Match" data-l>配對題 Match</option>
            </select></div>
          <div class="col-md-2"><label class="form-label small mb-0" data-l>配分 Points</label>
            <input id="qePoints" type="number" class="form-control form-control-sm" value="10"></div>
          <div class="col-md-4"><label class="form-label small mb-0" data-l>分類 Category</label>
            <input id="qeCategory" class="form-control form-control-sm"></div>
          <div class="col-md-2"><label class="form-label small mb-0" data-l>難度 Difficulty</label>
            <select id="qeDifficulty" class="form-select form-select-sm">
              <option>Easy</option><option selected>Normal</option><option>Hard</option>
            </select></div>
          <div class="col-md-2"><label class="form-label small mb-0">&nbsp;</label>
            <div class="form-check mt-1"><input class="form-check-input" type="checkbox" id="qeMust">
              <label class="form-check-label small fw-bold" for="qeMust" style="color:#b02a37">⭐ <span data-l>必考 Must-include</span></label></div></div>
          <div class="col-md-6"><label class="form-label small mb-0" data-l>中文題目 Question (ZH)</label>
            <textarea id="qeZh" class="form-control form-control-sm" rows="2"></textarea></div>
          <div class="col-md-6"><label class="form-label small mb-0" data-l>英文題目 Question (EN)</label>
            <textarea id="qeEn" class="form-control form-control-sm" rows="2"></textarea></div>
        </div>
        <div id="qeTypeArea" class="mt-2"></div>
        <div class="mt-2 d-flex gap-2">
          <button class="btn btn-sm btn-navy" onclick="saveQEditor()">💾 <span data-i18n="common.save">Save</span></button>
          <button class="btn btn-sm btn-outline-secondary" onclick="$('qEditor').classList.add('d-none')" data-i18n="common.cancel">Cancel</button>
        </div>
      </div>
      <div id="qbankList" class="table-responsive my-2"></div>
      <hr>
      <div class="d-flex justify-content-between align-items-center">
        <h6 class="mb-0" data-i18n="trAdmin.records">Exam Records</h6>
        <button class="btn btn-sm btn-outline-secondary" onclick="exportExamRecords()" data-l>⬇︎ Export Excel 匯出訓練/考試紀錄</button>
      </div>
      <div id="examRecords" class="table-responsive"></div>
    </div>
    <div class="tab-pane fade" id="tabDownloads">
      <h6>📥 <span data-i18n="dl.title">Downloads 附件下載專區</span>（<span class="small text-muted">公開顯示於首頁 shown publicly on home page</span>）</h6>
      <div class="row g-2 mb-2">
        <div class="col-md-3"><input id="dlTitleZh" class="form-control form-control-sm" placeholder="中文名稱 ＊"></div>
        <div class="col-md-3"><input id="dlTitleEn" class="form-control form-control-sm" placeholder="English Title ＊"></div>
        <div class="col-md-3"><input id="dlDesc" class="form-control form-control-sm" data-l-ph placeholder="說明 Description"></div>
        <div class="col-md-3"><input type="file" id="dlFile" class="form-control form-control-sm"></div>
        <div class="col-12 col-md-2"><button class="btn btn-sm btn-navy w-100" id="btnDlUpload" onclick="adminUploadDownload()">⬆︎ Upload</button></div>
      </div>
      <div id="adminDlList" class="table-responsive"></div>
    </div>
    <div class="tab-pane fade" id="tabAnnounce">
      <h6>📢 <span data-i18n="ann.title">System Announcements 系統公告</span>（<span class="small text-muted" data-i18n="ann.hint">shown at the top of the home page 顯示於首頁頂部</span>）</h6>
      <div class="row g-2 mb-2">
        <div class="col-md-4"><input id="annZh" class="form-control form-control-sm" placeholder="公告內容（中文）＊"></div>
        <div class="col-md-4"><input id="annEn" class="form-control form-control-sm" placeholder="Announcement (English) ＊"></div>
        <div class="col-md-2"><select id="annLevel" class="form-select form-select-sm">
          <option value="info" data-l>ℹ️ 一般 Info</option>
          <option value="warning" data-l>⚠️ 注意 Warning</option>
          <option value="danger" data-l>🚨 重要 Critical</option>
        </select></div>
        <div class="col-md-2"><button class="btn btn-sm btn-navy w-100" onclick="adminAddAnnounce()">📢 <span data-i18n="ann.publish">Publish 發布</span></button></div>
      </div>
      <div id="adminAnnList"></div>
    </div>
    <div class="tab-pane fade" id="tabReports">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h6 class="mb-0">📊 <span data-i18n="rp.title">Reports 報表</span></h6>
        <div class="d-flex gap-1 flex-wrap">
          <button class="btn btn-sm btn-outline-secondary" onclick="exportReport('overdue')" data-l>⬇︎ 逾期 Overdue</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="exportReport('byCompany')" data-l>⬇︎ 公司別 By Company</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="exportReport('byType')" data-l>⬇︎ 類型 By Type</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="exportReport('monthly')" data-l>⬇︎ 月度 Monthly</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="exportApprovals()" data-l>⬇︎ 簽核歷程 Approvals</button>
        </div>
      </div>
      <div class="row g-3">
        <div class="col-lg-6"><h6 class="small fw-bold" data-l>🔴 逾期未關閉 Overdue (Not Closed)</h6><div id="rpOverdue" class="table-responsive"></div></div>
        <div class="col-lg-6"><h6 class="small fw-bold" data-l>🏢 公司別統計 By Company</h6><div id="rpCompany" class="table-responsive"></div></div>
        <div class="col-lg-6"><h6 class="small fw-bold" data-l>🧰 類型統計 By Work Type</h6><div id="rpType" class="table-responsive"></div></div>
        <div class="col-lg-6"><h6 class="small fw-bold" data-l>📅 月度統計 Monthly</h6><div id="rpMonthly" class="table-responsive"></div></div>
      </div>
      <hr>
      <h6 data-l>🤝 代理簽核 Delegations</h6>
      <div class="row g-2 mb-2">
        <div class="col-md-3"><select id="dgFrom" class="form-select form-select-sm"></select></div>
        <div class="col-md-3"><select id="dgTo" class="form-select form-select-sm"></select></div>
        <div class="col-md-1"><select id="dgTier" class="form-select form-select-sm">
          <option value="2">T2</option><option value="3">T3</option><option value="4">T4</option><option value="5">T5</option></select></div>
        <div class="col-md-2"><input id="dgStart" type="date" class="form-control form-control-sm"></div>
        <div class="col-md-2"><input id="dgEnd" type="date" class="form-control form-control-sm"></div>
        <div class="col-md-1"><button class="btn btn-sm btn-navy w-100" onclick="addDelegation()">＋</button></div>
      </div>
      <div id="dgList" class="table-responsive"></div>
    </div>
    <div class="tab-pane fade" id="tabAudit">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <span class="small text-muted" id="auditInfo"></span>
        <div class="d-flex gap-2 align-items-center">
          <button class="btn btn-sm btn-outline-secondary" id="auditPrev" onclick="loadAudit(null,auditPage-1)">←</button>
          <span class="small" id="auditPageLbl"></span>
          <button class="btn btn-sm btn-outline-secondary" id="auditNext" onclick="loadAudit(null,auditPage+1)">→</button>
        </div>
      </div>
      <div id="auditList" class="table-responsive"></div>
    </div>
    <div class="tab-pane fade" id="tabFlowChart">
      <div class="card-x p-3 mt-2">
        <p class="small text-muted mb-2" data-i18n="admin.flowChartHint">Approval authority chart — click a name to view the person's details.</p>
        <div id="flowChartWrap" class="small text-muted">—</div>
      </div>
    </div>
    <div class="tab-pane fade" id="tabNumbers">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h6 class="mb-0">🔢 <span data-l>編號總表 PTW & Certificate Numbers</span></h6>
        <button class="btn btn-sm btn-outline-primary" onclick="loadNumbers()">🔄 <span data-l>重新整理 Refresh</span></button>
      </div>
      <div id="numGaps"></div>
      <div id="numTable" class="table-responsive">Loading…</div>
    </div>
    <div class="tab-pane fade" id="tabIssueMail">
      <h6>📬 <span data-l>PTW 核發通知清單 Issue Notification List</span></h6>
      <div class="small text-muted mb-2" data-l>Tier 5 核准簽發時，除審查流程所有人外，以下信箱也會收到核發通知（一行一個 Email）。 When a PTW is issued at Tier 5, everyone in the review chain is notified — the emails below are additionally notified (one per line).</div>
      <textarea id="issueMailList" class="form-control" rows="6" placeholder="ehs@example.com&#10;pm@example.com"></textarea>
      <button class="btn btn-navy mt-2" onclick="saveIssueList()">💾 <span data-l>儲存清單 Save List</span></button>
      <span id="issueMailState" class="small text-muted ms-2"></span>
      <hr>
      <h6>📮 <span data-l>狀態變動副本清單 Status-Change CC List</span></h6>
      <div class="small text-muted mb-2" data-l>系統發生下列事件時，除當事人外，以下信箱會收到副本通知（一行一個 Email）；可勾選要啟用哪些事件。 When any of the events below occurs, the emails listed here receive a CC notification (one per line); tick which events are enabled.</div>
      <textarea id="ccMailList" class="form-control" rows="4" placeholder="ehs@example.com&#10;pm@example.com"></textarea>
      <div id="ccEventChecks" class="row g-1 mt-2 small"></div>
      <hr>
      <h6>🗓 <span data-l>每週摘要收件清單 Weekly Summary List</span></h6>
      <div class="small text-muted mb-2" data-l>每週日 20:00（台北時間）自動寄出 PTW 每週摘要（執行中／逾期未關明細）給以下信箱（一行一個 Email）。 Every Sunday 20:00 (Taipei) a PTW weekly summary (active / overdue details) is emailed to the addresses below (one per line).</div>
      <textarea id="weeklyMailList" class="form-control" rows="3" placeholder="manager@example.com"></textarea>
      <button class="btn btn-navy mt-2" onclick="saveCcMail()">💾 <span data-l>儲存副本與週報設定 Save CC & Weekly Settings</span></button>
      <span id="ccMailState" class="small text-muted ms-2"></span>
      <hr>
      <h6>🧪 <span data-l>測試寄信 Send Test Email</span></h6>
      <div class="small text-muted mb-2" data-l>選擇寄信時機並填寫信箱，寄出一封測試信查看內容（週報會使用目前實際資料）。 Choose a mail timing and enter an email to receive a sample (the weekly summary uses live data).</div>
      <div class="d-flex gap-2 flex-wrap">
        <select id="mailTestEvent" class="form-select form-select-sm" style="max-width:320px"></select>
        <input id="mailTestEmail" type="email" class="form-control form-control-sm" style="max-width:280px" placeholder="test@example.com">
        <button class="btn btn-sm btn-warning fw-bold" onclick="sendMailTest()">📧 <span data-l>寄出測試信 Send Test</span></button>
        <span id="mailTestState" class="small text-muted align-self-center"></span>
      </div>
      <hr>
      <h6>💬 <span data-l>右下角聯繫視窗內容 Contact Popup Content</span></h6>
      <div class="small text-muted mb-2" data-l>所有使用者點右下角 💬 按鈕看到的內容，依介面語言顯示對應版本。 Shown via the 💬 button; the version matching the UI language is displayed.</div>
      <div class="row g-2"><div class="col-md-6">
        <b class="small">🇹🇼 中文版</b>
        <textarea id="contactText" class="form-control" rows="7"></textarea>
      </div><div class="col-md-6">
        <b class="small">🇬🇧 English</b>
        <textarea id="contactTextEn" class="form-control" rows="7"></textarea>
      </div></div>
      <button class="btn btn-navy mt-2" onclick="saveContactText()">💾 <span data-l>儲存內容 Save</span></button>
      <span id="contactState" class="small text-muted ms-2"></span>
    </div>
    <div class="tab-pane fade" id="tabTestMode">
      <div class="card-x p-3 mt-2">
        <p class="small text-muted mb-2" data-i18n="tm.desc">Creates test contractors and one user per tier, then lets you switch identity from the top bar — without registering accounts. Test users are ordinary accounts (marked test) and use the normal permission flow.</p>
        <button class="btn btn-primary me-2" onclick="tmEnable()">🧪 <span data-i18n="tm.enable">Enable / refresh personas</span></button>
        <button class="btn btn-outline-danger" onclick="tmReset()">🗑 <span data-i18n="tm.reset">Clear test PTW data</span></button>
        <div id="tmPersonaList" class="mt-3"></div>
      </div>
      <!-- ⚠️ 一鍵重置（Danger Zone） -->
      <div class="card-x p-3 mt-3" style="border:2px solid #c62828;background:#fff5f5">
        <h6 style="color:#c62828">☢️ <span data-l>一鍵重置系統 Factory Reset</span></h6>
        <div class="small mb-2" style="color:#8a1f1f" data-l>刪除「所有 PTW（含證書、簽核、附件紀錄）、所有公司（NMDC 保留）、所有人員及其訓練/考試紀錄」，只保留 paultong.ehs@gmail.com 管理員；PTW 與證書編號自 0001 重新開始；Drive 的 PTW 資料夾移至垃圾桶。保留：題庫、訓練課程、系統設定、下載專區、公告、稽核紀錄。此操作無法復原！ Deletes ALL PTWs, companies (NMDC kept) and users (keeps only paultong.ehs@gmail.com); numbering restarts from 0001; Drive PTW folders are moved to trash. Question bank, courses, settings, downloads, announcements and the audit trail are kept. This CANNOT be undone!</div>
        <button class="btn btn-danger fw-bold" onclick="doFactoryReset()">☢️ <span data-l>執行一鍵重置 Factory Reset</span></button>
      </div>
    </div>
  </div>
</main>

<!-- ==================== 首頁 Home Page（公開；點功能才登入） ==================== -->
<main class="container mt-3 d-none" id="viewHome" style="max-width:1200px">

  <!-- 系統公告區（取代舊歡迎橫幅；無公告時自動隱藏） -->
  <div id="annWrap" class="d-none mb-3"></div>

  <!-- 5.2 待您審核（緊接公告下方；未登入隱藏） -->
  <div id="queueWrap" class="card-x p-3 mb-3 d-none" style="background:#fdecea;border-color:#f1b0b7">
    <h5 class="mb-2">⚠️ <span data-i18n="home.actionRequired">Action Required 待您審核</span>
      <span id="queueCount" class="badge bg-danger"></span></h5>
    <div id="queueList" class="table-responsive"></div>
  </div>

  <!-- (7) 系統流程圖 -->
  <div class="flowbar" id="flowBar"></div>

  <!-- 5.3 功能按鈕（永遠可見） -->
  <div class="row g-3 mb-3" id="homeButtons"></div>

  <!-- 執行中 / 逾期未關 看板（公開；附件下載區上方兩框） -->
  <div class="row g-3 mb-3" id="boardWrap">
    <div class="col-md-6">
      <div class="card-x p-3 h-100" style="background:#e9f7ef;border-top:4px solid #146c43">
        <h6 class="mb-2">🟢 <span data-i18n="home.activePanel">Active PTW 執行中</span>
          <span id="activeCount" class="badge bg-success"></span></h6>
        <div id="activePanel" class="table-responsive small">—</div>
      </div>
    </div>
    <div class="col-md-6">
      <div class="card-x p-3 h-100" style="background:#fdecea;border-top:4px solid #b02a37">
        <h6 class="mb-2">🔴 <span data-i18n="home.overduePanel">Overdue (Not Closed) 逾期未關</span>
          <span id="overdueCount" class="badge bg-danger"></span></h6>
        <div id="overduePanel" class="table-responsive small">—</div>
      </div>
    </div>
  </div>

  <!-- (6) 附件下載專區（公開） -->
  <div class="card-x p-3 mb-3" id="downloadsWrap">
    <h5 class="mb-2">📥 <span data-i18n="dl.title">Downloads 附件下載專區</span></h5>
    <div id="downloadsList" class="small text-muted">—</div>
  </div>

  <!-- 登入後才顯示的區塊 -->
  <div id="homeLoggedIn" class="d-none">
    <!-- 5.1 KPI Dashboard -->
    <h5 class="mb-2">📊 <span data-i18n="home.kpiTitle">PTW Dashboard</span></h5>
    <div id="kpiRow" class="row g-2 mb-3"></div>

    <!-- 我的通知面板 -->
    <div class="card-x p-3 mb-4 d-none" id="notifyPanel">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h5 class="mb-0">🔔 <span data-i18n="home.btnNotify">My Notifications</span></h5>
        <button class="btn btn-sm btn-outline-secondary" onclick="$('notifyPanel').classList.add('d-none')">✕</button>
      </div>
      <div id="notifyList"></div>
    </div>
  </div>
</main>

<!-- ==================== 帳號管理 My Account ==================== -->
<main class="container mt-3 d-none" id="viewAccount" style="max-width:760px">
  <div class="card-x p-3 mb-3">
    <div class="d-flex justify-content-between align-items-center">
      <h5 class="mb-0">👤 <span data-i18n="ac.title">My Account 帳號管理</span></h5>
      <button class="btn btn-sm btn-outline-secondary" onclick="enter()">← <span data-i18n="ex.backHome">Home</span></button>
    </div>
    <div id="acPendingBanner" class="alert alert-warning mt-2 d-none"></div>
    <div class="row g-2 mt-1">
      <div class="col-md-6"><label class="form-label small mb-0" data-l>Email 帳號（不可修改）</label>
        <input id="acEmail" class="form-control form-control-sm" disabled></div>
      <div class="col-md-6"><label class="form-label small mb-0" data-i18n="ac.companyTier">Company / Tier（由管理員管理）</label>
        <input id="acCompany" class="form-control form-control-sm" disabled></div>
      <div class="col-md-6"><label class="form-label small mb-0" data-i18n="apply.nameZh">姓名（中文）</label>
        <input id="acNameZh" class="form-control form-control-sm"></div>
      <div class="col-md-6"><label class="form-label small mb-0" data-i18n="apply.nameEn">Name (English)</label>
        <input id="acNameEn" class="form-control form-control-sm"></div>
      <div class="col-md-6"><label class="form-label small mb-0" data-i18n="apply.title2">職稱 Job Title</label>
        <input id="acTitle" class="form-control form-control-sm"></div>
      <div class="col-md-6"><label class="form-label small mb-0" data-i18n="apply.phone">聯絡電話 Phone</label>
        <input id="acPhone" class="form-control form-control-sm"></div>
      <div class="col-md-6"><label class="form-label small mb-0" data-i18n="apply.vessel">所屬工作船舶 Vessel</label>
        <input id="acVessel" class="form-control form-control-sm"></div>
      <div class="col-md-6"><label class="form-label small mb-0" data-l>徽章編號 Badge No</label>
        <input id="acBadge" class="form-control form-control-sm"></div>
    </div>
    <div class="small text-muted mt-2" data-i18n="ac.note">⚠️ 基本資料修改須經系統管理員審核後才會生效。All changes require administrator approval.</div>
    <button class="btn btn-navy mt-2" id="btnAcSubmit" onclick="submitProfileChange()">📨 <span data-i18n="ac.submit">Submit Change Request 送出修改申請</span></button>
  </div>
  <div class="card-x p-3 mb-3">
    <h6>✍️ <span data-i18n="sig.title">簽名檔</span></h6>
    <div class="d-flex gap-3 flex-wrap align-items-start">
      <div><div class="small text-muted mb-1" data-l>Current 目前簽名：</div>
        <img id="acSigImg" style="max-height:70px;border:1px dashed #ccc;border-radius:6px;padding:4px;display:none">
        <span id="acSigNone" class="text-muted small" data-l>not set 未設定</span></div>
      <div class="flex-grow-1">
        <div class="d-flex gap-2 flex-wrap align-items-center">
          <input type="file" id="acSigFile" accept="image/*" class="form-control form-control-sm" style="max-width:250px" onchange="sigLoadImage(this,'ac')">
          <button type="button" class="btn btn-sm btn-outline-primary" id="acSigBtn" onclick="sigRemoveBg('ac')" disabled data-i18n="sig.removeBg">清除背景</button>
          <button type="button" class="btn btn-sm btn-navy" onclick="acSaveSignature()" data-l>💾 更新簽名 Update</button>
        </div>
        <div id="acSigMsg" class="small text-muted mt-1"></div>
        <canvas id="acSigCanvas" width="480" height="180" class="d-none mt-2" style="border:1px dashed #9ec5e8;border-radius:6px;max-width:100%;background:repeating-conic-gradient(#f2f2f2 0% 25%,#fff 0% 50%) 50%/16px 16px"></canvas>
      </div>
    </div>
  </div>
  <div class="card-x p-3 mb-4">
    <h6>🔑 <span data-i18n="ac.pw">Change Password 變更密碼</span>（<span data-i18n="ac.pwNote">即時生效，不需審核 takes effect immediately</span>）</h6>
    <div class="row g-2">
      <div class="col-md-4"><input id="acOldPw" type="password" class="form-control form-control-sm" placeholder="目前密碼 Current"></div>
      <div class="col-md-4"><input id="acNewPw" type="password" class="form-control form-control-sm" placeholder="新密碼 New (≥8, A-z+0-9)"></div>
      <div class="col-md-4"><button class="btn btn-outline-primary btn-sm w-100" onclick="acChangePw()" data-i18n="ac.pwBtn">Change 變更</button></div>
    </div>
  </div>
</main>

<!-- ==================== PTW 申請系統（規格 §7） ==================== -->
<main class="container-fluid mt-3 d-none" id="viewPtw" style="max-width:1250px">
  <!-- 清單模式 -->
  <div id="ptwListWrap">
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
      <h5 class="mb-0">📝 <span data-i18n="pw.title">PTW Application System</span></h5>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" onclick="enter()">← <span data-i18n="ex.backHome">Home</span></button>
        <button class="btn btn-sm btn-navy" id="btnNewPtw" onclick="newPtw()">＋ <span data-i18n="pw.new">Create New PTW</span></button>
      </div>
    </div>
    <div class="card-x p-2 mb-2 d-flex flex-wrap gap-2 align-items-center" id="ptwFilters">
      <select id="pfStatus" class="form-select form-select-sm" style="max-width:220px" onchange="loadPtwList()">
        <option value="" data-l>All 全部</option>
        <option value="Draft" data-l>Draft 草稿</option>
        <option value="_pending" data-l>Pending 待簽核</option>
        <option value="_returned" data-l>Returned 被退回</option>
        <option value="Approved" data-l>Approved 已核准</option>
        <option value="_active" data-l>Active 執行中</option>
        <option value="_issuedPending" data-l>Issued 已核發待生效</option>
        <option value="_expiringSoon" data-l>Expiring Soon 即將到期</option>
        <option value="Expired" data-l>Expired 已到期</option>
        <option value="_overdueOpen" data-l>Overdue 逾期未關</option>
        <option value="Closed" data-l>Closed 已關閉</option>
        <option value="Cancelled" data-l>Cancelled 已取消</option>
      </select>
      <input id="pfQ" class="form-control form-control-sm" style="max-width:260px" data-l-ph placeholder="Search 搜尋（編號/位置/內容）">
      <div class="form-check form-check-inline small">
        <input class="form-check-input" type="checkbox" id="pfMine"><label class="form-check-label" for="pfMine">My PTW 我的</label>
      </div>
      <button class="btn btn-sm btn-navy" onclick="loadPtwList()" data-i18n="common.search">Search</button>
      <button class="btn btn-sm btn-outline-secondary" onclick="exportPtwList()">⬇︎ Excel</button>
    </div>
    <div id="ptwList" class="table-responsive card-x p-2"></div>
  </div>

  <!-- 表單模式（Stepper） -->
  <div id="ptwFormWrap" class="d-none">
    <div class="card-x p-3 mb-2">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <b id="pfNumber">—</b> <span id="pfStatusBadge" class="badge bg-secondary">Draft</span>
          <span id="pfSaveState" class="small text-muted ms-2"></span>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-success" id="btnPdfSite" onclick="downloadPdf('site')" title="A4 Site Copy">🖨 <span data-i18n="pdf.site">Site Copy (A4)</span></button>
          <button class="btn btn-sm btn-outline-success" id="btnPdf" onclick="downloadPdf('main')" title="Full permit A3">⬇︎ <span data-i18n="pdf.full">Full Permit</span></button>
          <button class="btn btn-sm btn-outline-success" id="btnPdfCert" onclick="downloadPdf('certs')" title="Certificates">⬇︎ <span data-i18n="pdf.certs">Certificates</span></button>
          <button class="btn btn-sm btn-outline-primary" onclick="saveNow(true)">💾 <span data-i18n="pw.save">Save Draft</span></button>
          <button class="btn btn-sm btn-outline-secondary" onclick="closePtwForm()">✕ <span data-i18n="pw.close">Close</span></button>
        </div>
      </div>
      <div class="progress mt-2" style="height:16px">
        <div id="pfCompletion" class="progress-bar bg-info" style="width:0%">0%</div>
      </div>
      <div class="d-flex flex-wrap gap-1 mt-2" id="stepNav"></div>
    </div>
    <!-- 審核動作列佔位（實體已移至步驟區下方） -->
    <!-- 啟用步驟已移除：T5 核准即生效 -->
    <!-- 生命週期列（延長/暫停/恢復/完工/關閉） -->
    <div class="card-x p-3 mb-2 d-none" id="lifeBar" style="background:#eef6ff;border-color:#9ec5e8">
      <div class="d-flex flex-wrap gap-2 align-items-center" id="lifeButtons"></div>
    </div>
    <div id="valErrors"></div>
    <div id="stepContent"></div>
    <!-- 審查人本步驟意見（申請資料與簽核歷程之間） -->
    <div id="rvStepWrap"></div>
    <!-- 審核動作（僅最後一步顯示：全部無意見→核准；任一步有意見→退回） -->
    <div class="card-x p-3 mb-2 d-none" id="reviewBar" style="background:#fff8e6;border-color:#f0c36d">

      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <b>⚠️ <span data-i18n="rv.yourTurn">Action Required — this PTW is pending YOUR review</span></b>
        <div class="d-flex gap-2">
          <button class="btn btn-success" onclick="openApprove()">✅ <span data-i18n="rv.approve">Approve 核准</span></button>
          <button class="btn btn-outline-danger" onclick="toggleReturnForm()">↩️ <span data-i18n="rv.return">Return 退回</span></button>
        </div>
      </div>
      <!-- 退回表單 -->
      <div id="returnForm" class="d-none mt-3 border-top pt-2">
        <div class="row g-2">
          <div class="col-md-3"><label class="form-label small mb-0" data-i18n="rv.reason">Return Reason 退回原因 ＊</label>
            <select id="rvReason" class="form-select form-select-sm">
              <option value="IncompleteInfo" data-l>資料不全 Incomplete Info</option>
              <option value="HazardId" data-l>危害辨識不足 Hazard ID Insufficient</option>
              <option value="MissingDocs" data-l>文件缺漏 Missing Documents</option>
              <option value="Other" data-l>其他 Other</option>
            </select></div>
          <div class="col-md-3"><label class="form-label small mb-0" data-i18n="rv.target">Return To 退回對象</label>
            <select id="rvTarget" class="form-select form-select-sm">
              <option value="applicant" data-l>申請人 Applicant（全部重簽）</option>
              <option value="previousTier" id="rvPrevOpt" data-l>上一關 Previous Tier</option>
            </select></div>
          <div class="col-md-6"><label class="form-label small mb-0" data-i18n="rv.comment">Comment ＊（必填 required）</label>
            <textarea id="rvComment" class="form-control form-control-sm" rows="2"></textarea></div>
        </div>
        <button class="btn btn-sm btn-danger mt-2" onclick="doReturn()" data-i18n="rv.confirmReturn">Confirm Return 確認退回</button>
      </div>
    </div>

    <!-- 管理員：直接調整關卡（僅系統管理員／Tier 5 可見） -->
    <div id="adminStageWrap"></div>

    <!-- 簽核歷程 + 版本比較 -->
    <div class="card-x p-3 my-2" id="histWrap">
      <h6 style="cursor:pointer;margin-bottom:0" onclick="toggleHist()">🕓 <span data-i18n="rv.history">Approval History 簽核歷程</span>
        <span id="histArrow" style="float:right;color:#0b3a5c">▸</span></h6>
      <div id="histBody" class="d-none mt-2">
      <div id="histList" class="small text-muted">—</div>
      <div id="verCompareWrap" class="mt-2 d-none">
        <hr>
        <div class="d-flex gap-2 align-items-center flex-wrap">
          <b class="small">🔀 版本比較 Version Compare：</b>
          <select id="verA" class="form-select form-select-sm" style="max-width:130px"></select>
          <span>→</span>
          <select id="verB" class="form-select form-select-sm" style="max-width:130px"></select>
          <button class="btn btn-sm btn-outline-primary" onclick="compareVersions()" data-l>Compare 比較</button>
        </div>
        <div id="verDiff" class="mt-2"></div>
      </div>
      </div><!-- /histBody -->
    </div>
    <div class="d-flex justify-content-between my-3">
      <button class="btn btn-outline-secondary" id="btnPrevStep" onclick="gotoStep(curStep-1)">← <span data-i18n="pw.prev">Previous</span></button>
      <button class="btn btn-navy" id="btnNextStep" onclick="gotoStep(curStep+1)"><span data-i18n="pw.next">Next</span> →</button>
    </div>
  </div>
</main>

<!-- 簽名視窗 -->
<div class="position-fixed top-0 start-0 w-100 h-100 d-none" id="sigModal"
     style="background:rgba(0,0,0,.5);z-index:1090">
  <div class="card-x p-3 mx-auto mt-5" style="max-width:520px;background:#fff">
    <h6 data-i18n="rv.signTitle">Electronic Signature 電子簽名</h6>
    <div class="small text-muted mb-1" id="sigWho"></div>
    <!-- 帳號簽名檔（預設；一鍵確認即可） -->
    <div id="sigAccWrap" class="d-none">
      <div class="border rounded p-2 text-center" style="background:#f7fbff;border-color:#9ec5e8 !important">
        <img id="sigAccImg" style="max-height:110px;max-width:100%">
        <div class="small text-success mt-1" data-i18n="rv.useAccSig">Your registered signature will be applied.</div>
      </div>
      <!-- 手寫簽名入口已移除：簽核一律使用帳號簽名檔 -->
    </div>
    <!-- 手寫簽名板（無帳號簽名檔或改為手寫時顯示） -->
    <div id="sigDrawWrap" class="d-none">
      <canvas id="sigCanvas" width="480" height="180" style="border:2px dashed #9ec5e8;border-radius:6px;width:100%;touch-action:none;background:#fff"></canvas>
      <button class="btn btn-link btn-sm p-0 mt-1 d-none" id="sigBackAcc" onclick="sigSwitchToAcc()" data-i18n="rv.useAccSigBtn">Use my registered signature</button>
    </div>
    <div class="mb-2"><textarea id="apComment" class="form-control form-control-sm mt-2" rows="2"
      data-l-ph placeholder="Comment 意見（選填 optional）"></textarea></div>
    <div id="apNextRevWrap" class="d-none mb-2">
      <label class="form-label small mb-1 fw-bold" data-i18n="rv.nextReviewer">Next-tier reviewer</label>
      <select id="apNextRev" class="form-select form-select-sm"></select>
      <div id="apNextRevMulti" class="d-none border rounded p-2" style="max-height:170px;overflow:auto;background:#fff"></div>
      <div id="apNextRevHint" class="small text-muted mt-1 d-none" data-l>可複選：不同船別分屬不同施工組，勾選要通知的施工組人員；全不勾＝通知全部。任一被通知者審核即可。 Multi-select: tick the Tier-3 reviewers to notify (different vessels → different construction teams); none ticked = notify all. Any notified person may review.</div>
    </div>
    <div class="d-flex gap-2">
      <button class="btn btn-success flex-grow-1" onclick="confirmApprove()">✅ <span data-i18n="rv.signConfirm">Sign & Approve 簽名並核准</span></button>
      <button class="btn btn-outline-secondary d-none" id="btnSigClear" onclick="clearSig()" data-i18n="rv.signClear">Clear 清除</button>
      <button class="btn btn-outline-secondary" onclick="$('sigModal').classList.add('d-none')" data-i18n="common.cancel">Cancel</button>
    </div>
  </div>
</div>

<!-- ==================== 訓練 + 考試（規格 §6） ==================== -->
<main class="container-fluid mt-3 d-none" id="viewCertified" style="max-width:1250px">
  <div class="p-3 rounded-4" style="background:#0d1b2e;border:1px solid #1e3a5c;box-shadow:0 8px 30px rgba(2,12,24,.5)">
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-1">
      <div>
        <h5 class="mb-0" style="color:#e8f2fc">👤 <span data-l>合格人員 Certified Personnel</span> <span id="cpCount" style="color:#7fb2e5"></span></h5>
        <div class="small" id="cpStats" style="color:#7f95b0"></div>
      </div>
      <div class="d-flex gap-2 flex-wrap">
        <input id="cpSearch" class="form-control form-control-sm" style="max-width:220px;background:#12243c;border-color:#1e3a5c;color:#dce9f7"
          data-l-ph placeholder="搜尋姓名/公司/職稱… Search name/company/title…" oninput="renderCertified()">
        <select id="cpType" class="form-select form-select-sm" style="max-width:150px;background:#12243c;border-color:#1e3a5c;color:#dce9f7" onchange="renderCertified()">
          <option value="" data-l>全部類型 All Types</option>
          <option value="Issuing">Issuing</option>
          <option value="Performing">Performing</option>
        </select>
        <select id="cpCompany" class="form-select form-select-sm" style="max-width:180px;background:#12243c;border-color:#1e3a5c;color:#dce9f7" onchange="renderCertified()">
          <option value="" data-l>全部公司 All Companies</option>
        </select>
        <button class="btn btn-sm btn-outline-light" onclick="showView('home');renderHome()">← <span data-l>回首頁 Home</span></button>
      </div>
    </div>
    <div class="table-responsive mt-2" id="cpTable">Loading…</div>
  </div>
</main>
<main class="container mt-3 d-none" id="viewTraining" style="max-width:900px">
  <div class="card-x p-3 mb-3" id="trainingCard">
    <div class="d-flex justify-content-between align-items-center">
      <h5 class="mb-0">🎓 <span data-i18n="tr.title">Online PTW Training</span></h5>
      <button class="btn btn-sm btn-outline-secondary" onclick="enter()">← <span data-i18n="ex.backHome">Home</span></button>
    </div>
    <div id="trInfo" class="small text-muted mt-2"></div>
    <div id="trPlaylist" class="d-none my-2"></div>
    <div class="ratio ratio-16x9 my-2 d-none" id="playerWrap"><div id="ytPlayer"></div></div>
    <div class="progress my-2 d-none" id="trProgressWrap" style="height:22px">
      <div id="trProgressBar" class="progress-bar bg-success" style="width:0%">0%</div>
    </div>
    <div id="trStatus" class="small"></div>
    <button id="btnStartExam" class="btn btn-navy mt-2 d-none" onclick="startExam()"></button>
  </div>
  <div class="card-x p-3 mb-4 d-none" id="examArea"></div>
</main>

<div id="toast" class="position-fixed bottom-0 end-0 p-3" style="z-index:1080"></div>
<footer class="footer">Offshore PTW System · NMDC · Tung-Hsiao P2 Subsea Gas Pipeline EPC (P2913) · M3.1</footer>

<script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.3/js/bootstrap.bundle.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<!-- (10) 自訂確認/輸入視窗（取代原生 confirm/prompt，避免顯示網域字串） -->
<style>
@keyframes uiPop{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
#uiModalCard{animation:uiPop .18s cubic-bezier(.2,.8,.3,1)}
.uiKV{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e2eaf2;border-radius:9px;overflow:hidden}
.uiKV td{padding:8px 12px;font-size:.86rem;vertical-align:top;border-top:1px solid #eef3f8}
.uiKV tr:first-child td{border-top:0}
.uiKV td.k{width:38%;background:#f5f8fb;color:#5d7188;font-weight:600;white-space:nowrap}
.uiKV td.v{color:#1b2c3d}
.uiChip{display:inline-block;background:#e8f1fb;color:#0b5a94;border:1px solid #cfe2f5;border-radius:20px;
  padding:1px 10px;font-size:.78rem;font-weight:600;margin:2px 4px 2px 0}
.uiNote{background:#fff8e6;border:1px solid #f0dca8;border-left:4px solid #e0a800;color:#6b5417;
  border-radius:8px;padding:10px 12px;font-size:.83rem;line-height:1.6}
</style>
<div id="uiModal" style="display:none;position:fixed;inset:0;background:rgba(8,26,42,.55);z-index:2000;align-items:center;justify-content:center;padding:16px">
  <div id="uiModalCard" style="background:#fff;border-radius:14px;max-width:480px;width:100%;box-shadow:0 18px 52px rgba(0,0,0,.38);overflow:hidden">
    <div id="uiModalHead" class="d-none" style="background:linear-gradient(135deg,#0b3a5c 0%,#17608e 100%);color:#fff;padding:15px 20px">
      <div style="display:flex;align-items:center;gap:10px">
        <span id="uiModalIcon" style="font-size:1.5rem;line-height:1"></span>
        <div style="min-width:0">
          <div id="uiModalTitle" style="font-size:1.04rem;font-weight:700;line-height:1.3"></div>
          <div id="uiModalSub" style="font-size:.76rem;color:#bcd8ef;margin-top:1px"></div>
        </div>
      </div>
    </div>
    <div style="padding:18px 20px;max-height:64vh;overflow:auto">
      <div id="uiModalMsg" style="white-space:pre-wrap"></div>
      <input id="uiModalInput" class="form-control mt-3 d-none" onkeydown="if(event.key==='Enter')uiModalDone(true)">
    </div>
    <div class="text-end" style="padding:12px 20px;background:#f6f9fc;border-top:1px solid #e6edf4">
      <button class="btn btn-outline-secondary me-2" id="uiModalCancel" onclick="uiModalDone(false)">取消</button>
      <button class="btn btn-navy" id="uiModalOk" onclick="uiModalDone(true)">確定</button>
    </div>
  </div>
</div>
<div id="netbar"></div>
<!-- (2) 讀取中：全畫面淡化 + 置中視窗 -->
<div id="loadingPill" style="display:none;position:fixed;inset:0;z-index:1950;background:rgba(13,42,64,.38);
  backdrop-filter:blur(2px);align-items:center;justify-content:center">
  <div style="background:#fff;border-radius:16px;padding:28px 46px;text-align:center;
    box-shadow:0 12px 44px rgba(0,0,0,.35);min-width:240px">
    <div style="position:relative;width:74px;height:74px;margin:0 auto 12px">
      <div style="position:absolute;inset:0;border-radius:50%;border:5px solid #dbe8f4;border-top-color:#0b6bcb;animation:ldspin .9s linear infinite"></div>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:2rem">⚓</div>
    </div>
    <div id="loadingPillText" style="font-weight:700;color:#0b3a5c;font-size:1.05rem">讀取中，請稍候…</div>
    <div style="color:#8aa4b8;font-size:.8rem;margin-top:4px">Offshore PTW System</div>
  </div>
</div>
<style>@keyframes ldspin{to{transform:rotate(360deg)}}</style>
<button id="helpFab" onclick="showContact()" title="聯繫系統管理員 Contact Administrator"
 style="position:fixed;right:18px;bottom:18px;z-index:2500;width:54px;height:54px;border-radius:50%;border:0;
 background:linear-gradient(135deg,#0b3a5c,#1173b8);color:#fff;font-size:1.5rem;box-shadow:0 6px 18px rgba(3,24,42,.5);cursor:pointer">💬</button>
<div id="contactModal" style="position:fixed;inset:0;background:rgba(6,24,40,.6);z-index:3000;display:none;align-items:center;justify-content:center;backdrop-filter:blur(2px)">
  <div style="width:430px;max-width:92vw;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 20px 60px rgba(2,16,30,.55)">
    <div style="background:linear-gradient(120deg,#081f33,#0b3a5c 55%,#0f5e8e);color:#fff;padding:16px 20px;position:relative">
      <div style="font-size:1.9rem">🧑‍💼</div>
      <div style="font-weight:800;font-size:1.05rem;letter-spacing:.5px" data-l>聯繫系統管理員 Contact Administrator</div>
      <div class="small" style="opacity:.85" data-l>NMDC Offshore PTW System</div>
      <button onclick="$('contactModal').style.display='none'"
        style="position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font-size:.95rem;cursor:pointer">✕</button>
    </div>
    <div id="contactBody" class="p-3" style="line-height:1.6">Loading…</div>
  </div>
</div>
<script>window.PTW_OPEN_ID=null;window.PTW_VIEWS=0;window.PTW_APP_URL='';window.PTW_GOTO='';</script>

<!-- 瀏覽次數（左下角） -->
<div id="viewCounter" style="position:fixed;left:10px;bottom:8px;z-index:1200;background:rgba(11,42,64,.72);
  color:#cfe3f5;border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:2px 12px;
  font-size:.74rem;backdrop-filter:blur(3px);pointer-events:none">
  👁 <span data-l>瀏覽次數 Views</span>：<b id="viewCountVal">—</b>
</div>
<script>
'use strict';
function $(id){ return document.getElementById(id); }
function esc(s){ var d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; }

/* ---------- i18n（預設英文；Q16） ---------- */
var STRINGS = {
 'app.title':{en:'Offshore PTW System',zh:'離岸工作許可系統'},
 'app.project':{en:'Tung-Hsiao P2 Subsea Gas Pipeline (P2913)',zh:'通霄二期海底輸氣管線統包工程 (P2913)'},
 'common.search':{en:'Search',zh:'搜尋'},'common.cancel':{en:'Cancel',zh:'取消'},
 'common.logout':{en:'Log out',zh:'登出'},'common.actions':{en:'Actions',zh:'操作'},
 'login.title':{en:'Sign in',zh:'登入'},'login.email':{en:'Email (account)',zh:'Email（帳號）'},
 'login.password':{en:'Password',zh:'密碼'},'login.show':{en:'Show',zh:'顯示'},'login.hide':{en:'Hide',zh:'隱藏'},
 'login.submit':{en:'Sign in',zh:'登入'},'login.apply':{en:'Apply for an account',zh:'申請帳號'},
 'login.forgot':{en:'Forgot password?',zh:'忘記密碼？'},
 'login.keep':{en:'Keep me signed in on this computer (new tabs stay signed in; server session still expires after 8 hours)',
               zh:'在這台電腦保持登入（新開分頁免再登入；伺服器連線階段仍為 8 小時）'},
 'login.changePw':{en:'You must change your password. Enter a new password:',zh:'請設定新密碼：'},
 'apply.title':{en:'Account Application',zh:'帳號申請'},'apply.nameZh':{en:'Name (Chinese)',zh:'姓名（中文）'},
 'apply.nameEn':{en:'Name (English)',zh:'姓名（英文）'},'apply.company':{en:'Company Name',zh:'公司名稱'},
 'apply.title2':{en:'Job Title',zh:'職稱'},'apply.phone':{en:'Contact Phone',zh:'聯絡電話'},
 'apply.vessel':{en:'Working Vessel',zh:'所屬工作船舶'},'apply.reason':{en:'Application Reason',zh:'申請原因'},
 'apply.tier':{en:'Requested Tier',zh:'預計申請 Tier'},
 'apply.password':{en:'Password (≥8 chars, letters+numbers)',zh:'密碼（≥8 碼，含英文與數字）'},
 'apply.confirm':{en:'Confirm Password',zh:'確認密碼'},'apply.submit':{en:'Submit Application',zh:'送出申請'},
 'apply.success':{en:'Application submitted. You will receive an email once approved.',zh:'申請已送出，核准後將收到 Email 通知。'},
 'forgot.title':{en:'Password Reset',zh:'密碼重設'},
 'forgot.hint':{en:'Enter your registered email. A reset code (valid 15 min) will be sent.',zh:'輸入註冊 Email，系統將寄送 15 分鐘內有效的重設碼。'},
 'forgot.submit':{en:'Send Reset Email',zh:'寄送重設信'},
 'forgot.sent':{en:'If the email exists, a reset message has been sent.',zh:'若 Email 存在，重設信已寄出。'},
 'reset.newPassword':{en:'New Password',zh:'新密碼'},'reset.submit':{en:'Reset Password',zh:'重設密碼'},
 'reset.success':{en:'Password reset. Please sign in.',zh:'密碼已重設，請重新登入。'},
 'admin.pending':{en:'Pending Approvals',zh:'待審核帳號'},'admin.users':{en:'User Management',zh:'使用者管理'},
 'admin.companies':{en:'Company Management',zh:'公司管理'},'admin.audit':{en:'Audit Trail',zh:'稽核紀錄'},
 'admin.approve':{en:'Approve',zh:'核准'},'admin.rejectBtn':{en:'Reject',zh:'拒絕'},
 'admin.assignCompany':{en:'Assign Company',zh:'指定公司'},'admin.assignTier':{en:'Assign Tier',zh:'指定 Tier'},
 'admin.disable':{en:'Disable',zh:'停用'},'admin.enable':{en:'Enable',zh:'啟用'},'admin.unlock':{en:'Unlock',zh:'解鎖'},
 'rv.yourTurn':{en:'Action Required — this PTW is pending YOUR review',zh:'待您審核 — 此 PTW 正等待您簽核'},
 'rv.approve':{en:'Approve',zh:'核准'},
 'rv.return':{en:'Return',zh:'退回'},
 'rv.reason':{en:'Return Reason ＊',zh:'退回原因 ＊'},
 'rv.target':{en:'Return To',zh:'退回對象'},
 'rv.comment':{en:'Comment ＊ (required)',zh:'意見 ＊（必填）'},
 'rv.confirmReturn':{en:'Confirm Return',zh:'確認退回'},
 'rv.approvedMsg':{en:'PTW approved — activate before work starts',zh:'PTW 已核准 — 開工前請按啟用'},
 'rv.activate':{en:'Activate',zh:'啟用'},
 'rv.history':{en:'Approval History',zh:'簽核歷程'},
 'rv.signTitle':{en:'Electronic Signature',zh:'電子簽名'},
 'pdf.site':{en:'Site Copy (A4)',zh:'現場聯 A4'},
 'pdf.full':{en:'Full Permit',zh:'完整主表'},
 'pdf.certs':{en:'Certificates',zh:'證書'},
 'ptw.siteCopy':{en:'Site copy',zh:'現場聯'},
 'co.title':{en:'Close-out Confirmation',zh:'結案確認'},
 'co.await':{en:'Awaiting confirmation by',zh:'待確認部門'},
 'co.confirm':{en:'Confirm close-out',zh:'確認結案'},
 'co.docsHint':{en:'Contractor must upload close-out documents (attachment category: Close-out) before declaring completion.',zh:'承商須先上傳結案文件（附件分類：結案文件 Close-out）才能申報完工。'},
 'rv.useAccSig':{en:'Your registered signature will be applied when you confirm.',zh:'按下確認即以您註冊的簽名檔簽署。'},
 'rv.drawInstead':{en:'✍️ Draw a signature instead',zh:'✍️ 改用手寫簽名'},
 'rv.useAccSigBtn':{en:'↩ Use my registered signature',zh:'↩ 改用我的簽名檔'},
 'rv.noAccSig':{en:'No signature on file — please draw below, or upload one in My Account.',zh:'尚未設定簽名檔 — 請於下方手寫，或到「帳號設定」上傳簽名檔。'},
 'rv.nextReviewer':{en:'Assign next-tier reviewer (optional)',zh:'指定下一關審閱人（選填）'},
 'rv.notifyAll':{en:'Notify ALL reviewers at next tier (any one may review)',zh:'通知下一關全部人員（任一人審閱即可）'},
 'rv.signConfirm':{en:'Sign & Approve',zh:'簽名並核准'},
 'rv.signClear':{en:'Clear',zh:'清除'},
 'rv.stepGate':{en:'Please review each step in order — the Approve/Return buttons unlock after Step 8',zh:'請依序逐步檢視內容 — 看完第 8 步後才可核准/退回'},
 'rv.noSkip':{en:'Please review the steps in order (no skipping)',zh:'請依序檢視，不可跳步'},
 'common.loading':{en:'Loading…',zh:'載入中…'},
 'common.save':{en:'Save',zh:'儲存'},
 'ann.title':{en:'System Announcements',zh:'系統公告'},
 'ann.hint':{en:'shown at the top of the home page',zh:'顯示於首頁頂部'},
 'ann.publish':{en:'Publish',zh:'發布'},
 'admin.consoleTitle':{en:'System Administration Console',zh:'系統管理主控台'},
 'admin.consoleSub':{en:'Offshore PTW System · Tongxiao P2 Subsea Gas Pipeline (P2913)',zh:'離岸工作許可系統 · 通霄二期海管統包工程 (P2913)'},
 'admin.numbers':{en:'Numbers',zh:'編號總表'},
 'admin.flowChart':{en:'Approval Flow',zh:'審批流程'},
 'admin.flowChartHint':{en:'Approval authority chart — click a name to view that person\\'s details.',zh:'審批權限流程圖 — 點擊姓名可查看人員詳細資料。'},
 'tm.title':{en:'Test Mode',zh:'測試模式'},
 'tm.bar':{en:'TEST MODE — identity',zh:'測試模式 — 目前身分'},
 'tm.admin':{en:'👑 Admin (my real account)',zh:'👑 管理員（原始身分）'},
 'tm.enable':{en:'Enable / refresh personas',zh:'啟用／重新整理測試人員'},
 'tm.reset':{en:'Clear test PTW data',zh:'清除測試 PTW 資料'},
 'tm.exit':{en:'Exit test mode',zh:'退出測試模式'},
 'tm.desc':{en:'Creates two test contractors and one user per tier, then lets you switch identity from the top bar — no need to register accounts. Test users are ordinary accounts (marked as test) and follow the normal permission flow, so nothing in the existing system changes.',zh:'建立兩家測試承商與各 Tier 測試人員，之後可從頁面上方下拉選單直接切換身分測試，不必自己申請帳號。測試人員就是一般帳號（標記為測試），走完全相同的權限流程，不會動到既有系統架構。'},
 'tm.enabled':{en:'Test mode ready — switch identity from the top bar',zh:'測試模式已啟用 — 請用頁面上方下拉選單切換身分'},
 'tm.resetDone':{en:'Test PTWs cleared',zh:'測試 PTW 已清除'},
 'tm.resetConfirm':{en:'Delete all PTWs created by test users?',zh:'確定清除所有測試人員建立的 PTW？'},
 'admin.delete':{en:'Delete',zh:'刪除'},'admin.deleteUserConfirm':{en:'⚠️ Permanently delete this user from the system? This CANNOT be undone. Historical PTW / approval / audit records are kept, but this person\\'s name will no longer be shown in them.',zh:'⚠️ 確定將此使用者自系統永久刪除？此操作無法復原。歷史 PTW／簽核／稽核紀錄會保留，但其中將無法再顯示此人姓名。'},
 'ptw.delete':{en:'Delete PTW',zh:'刪除 PTW'},'ptw.deleteConfirm':{en:'Delete this PTW? It will be removed from all lists (audit trail is kept).',zh:'確定刪除此 PTW？將自所有清單移除（稽核紀錄保留）。'},
 'admin.resetPw':{en:'Reset Password',zh:'重設密碼'},'admin.addCompany':{en:'Add Company',zh:'新增公司'},
 'admin.exportUsers':{en:'Export Users (CSV)',zh:'匯出使用者 (CSV)'},
 'admin.status':{en:'Status',zh:'狀態'},'admin.email':{en:'Email',zh:'Email'},'admin.name':{en:'Name',zh:'姓名'},
 'admin.tier':{en:'Tier',zh:'Tier'},'admin.company':{en:'Company',zh:'公司'},
 'admin.rejectReason':{en:'Reject reason (required)',zh:'拒絕原因（必填）'},
 'home.heroTitle':{en:'Offshore Permit to Work System',zh:'離岸工作許可系統'},
 'home.heroText':{en:'Select a function below. You will be asked to sign in when required.',zh:'請點選下方功能，需要時系統會請您登入。'},
 'home.btnLogin':{en:'Sign in',zh:'登入'},
 'home.btnApplyAccount':{en:'Account Application',zh:'帳號申請'},
 'home.loginFirst':{en:'Please sign in to use this function.',zh:'請先登入後使用此功能。'},
 'home.kpiTitle':{en:'PTW Dashboard',zh:'PTW 總表'},
 'home.actionRequired':{en:'Action Required — pending your review',zh:'待您審核'},
 'home.noAction':{en:'No PTW is pending your review.',zh:'目前沒有待您審核的 PTW。'},
 'home.btnTraining':{en:'Online Training',zh:'線上訓練系統'},
 'home.btnPtw':{en:'PTW Application',zh:'線上 PTW 申請系統'},
 'home.btnAccount':{en:'My Account',zh:'帳號管理'},
 'home.btnSysAdmin':{en:'System Administration',zh:'系統管理'},
 'home.btnTodo':{en:'My Tasks',zh:'我的待辦事項'},
 'home.btnNotify':{en:'My Notifications',zh:'我的通知'},
 'home.btnMyPtw':{en:'My PTW',zh:'我的 PTW'},
 'home.btnLogout':{en:'Log out',zh:'登出'},
 'menu.guest':{en:'Account',zh:'帳號'},
 'menu.signedInAs':{en:'Signed in as',zh:'目前登入'},
 'menu.myAccount':{en:'My Account',zh:'我的帳號'},
 'menu.sysAdmin':{en:'System Administration',zh:'系統管理'},
 'home.btnInbox':{en:'My Tasks & Notifications',zh:'待辦與通知'},
 'home.comingSoon':{en:'This module opens in the next milestone (Training: M3.2 / PTW: M3.3).',zh:'此功能於下一階段開放（訓練系統：M3.2／PTW 申請：M3.3）。'},
 'home.changePwOld':{en:'Current password',zh:'目前密碼'},
 'home.changePwNew':{en:'New password (≥8 chars, letters+numbers)',zh:'新密碼（≥8 碼，含英文與數字）'},
 'home.pwChanged':{en:'Password changed.',zh:'密碼已變更。'},
 'home.noNotify':{en:'No notifications.',zh:'目前沒有通知。'},
 'kpi.total':{en:'Total PTW',zh:'PTW 總數'},
 'kpi.draft':{en:'Draft',zh:'草稿'},
 'kpi.pending':{en:'Under Review',zh:'簽核中'},
 'kpi.approved':{en:'Approved',zh:'已核准'},
 'kpi.active':{en:'Active (In Progress)',zh:'執行中'},
 'kpi.issuedPending':{en:'Issued (Not Started)',zh:'已核發待生效'},
 'kpi.expiringSoon':{en:'Expiring Soon',zh:'即將到期'},
 'kpi.expired':{en:'Expired',zh:'已到期'},
 'kpi.overdueOpen':{en:'Overdue (Not Closed)',zh:'逾期未關閉'},
 'kpi.returned':{en:'Returned',zh:'被退回'},
 'kpi.closed':{en:'Closed',zh:'已關閉'},
 'queue.ptwNo':{en:'PTW No.',zh:'PTW 編號'},'queue.company':{en:'Company',zh:'申請廠商'},
 'queue.location':{en:'Location',zh:'作業位置'},'queue.status':{en:'Status',zh:'目前狀態'},
 'queue.step':{en:'Current Step',zh:'目前簽核步驟'},'queue.reviewer':{en:'Reviewer',zh:'目前審閱人'},
 'queue.waiting':{en:'Waiting (days)',zh:'等待天數'},
 'tr.title':{en:'Online PTW Training',zh:'線上 PTW 訓練'},
 'tr.version':{en:'Course Version',zh:'課程版本'},
 'tr.duration':{en:'Video Length',zh:'影片長度'},
 'tr.myProgress':{en:'My Watch Progress',zh:'我的觀看進度'},
 'tr.noVideo':{en:'Training video has not been set by the administrator yet.',zh:'管理員尚未設定訓練影片。'},
 'tr.passed':{en:'Training PASSED — valid until',zh:'訓練已通過 — 有效期限至'},
 'tr.locked':{en:'Exam failed today. Next attempt available on',zh:'今日考試未通過，可重新上課及考試日期：'},
 'tr.needWatch':{en:'Watch at least 90% of every video to unlock the exam.',zh:'每部影片皆須觀看達 90% 以上才能進入考試。'},
 'tr.startExam':{en:'Start Exam (10 questions, pass ≥60)',zh:'進入考試（10 題，60 分及格）'},
 'tr.watchDone':{en:'Video completed — you may start the exam.',zh:'影片已完成 — 可以進入考試。'},
 'ex.title':{en:'PTW Training Exam',zh:'PTW 訓練考試'},
 'ex.hint':{en:'18 multiple-choice (5 pts each) + 1 matching (10 pts, all-or-nothing). Total 100, pass 60. Do not refresh during the exam.',zh:'18 題選擇題（每題 5 分）＋1 題配合題（10 分，全對才得分），滿分 100、60 分及格。考試中請勿重新整理。'},
 'ex.match':{en:'Matching — pick the matching item for each row',zh:'配對題 — 為每一列選擇對應項目'},
 'ex.submit':{en:'Submit Exam',zh:'交卷'},
 'ex.confirmSubmit':{en:'Submit your answers? You cannot change them afterwards.',zh:'確定交卷？交卷後不可修改。'},
 'ex.unanswered':{en:'Unanswered questions:',zh:'尚有未作答題目：'},
 'ex.passed':{en:'PASSED 通過',zh:'通過 PASSED'},
 'ex.failed':{en:'FAILED 未通過',zh:'未通過 FAILED'},
 'ex.score':{en:'Your score',zh:'您的得分'},
 'ex.nextDate':{en:'You may retake the training and exam on',zh:'可重新上課及考試日期：'},
 'ex.validUntil':{en:'Training valid until',zh:'訓練有效期限至'},
 'ex.backHome':{en:'Back to Home',zh:'回首頁'},
 'trAdmin.title':{en:'Training Management',zh:'訓練管理'},
 'trAdmin.courseTitle':{en:'Course Title',zh:'課程名稱'},
 'trAdmin.videoId':{en:'YouTube URL/ID — one per line (optionally "URL | Title")',zh:'YouTube 網址或 ID，一行一部（可加「網址 | 標題」）'},
 'trAdmin.save':{en:'Save Course',zh:'儲存課程'},
 'trAdmin.qbank':{en:'Question Bank',zh:'題庫'},
 'trAdmin.records':{en:'Exam Records',zh:'考試紀錄'},
 'trAdmin.reopen':{en:'Reopen Exam',zh:'重新開放考試'},
 'trAdmin.import':{en:'Import (JSON)',zh:'匯入 (JSON)'},
 'trAdmin.export':{en:'Export (JSON)',zh:'匯出 (JSON)'},
 'qe.add':{en:'Add Question',zh:'新增題目'},
 'qe.importX':{en:'Import Excel',zh:'匯入 Excel'},
 'qe.exportX':{en:'Export Excel',zh:'匯出 Excel'},
 'qe.template':{en:'Template',zh:'下載範本'},
 'ac.title':{en:'My Account',zh:'帳號管理'},
 'ac.companyTier':{en:'Company / Tier (managed by admin)',zh:'公司／Tier（由管理員管理）'},
 'ac.note':{en:'⚠️ Profile changes require administrator approval before taking effect.',zh:'⚠️ 基本資料修改須經系統管理員審核後才會生效。'},
 'ac.submit':{en:'Submit Change Request',zh:'送出修改申請'},
 'ac.pw':{en:'Change Password',zh:'變更密碼'},
 'ac.pwNote':{en:'takes effect immediately',zh:'即時生效，不需審核'},
 'ac.pwBtn':{en:'Change',zh:'變更'},
 'ac.reqTitle':{en:'Profile Change Requests',zh:'資料修改申請'},
 'rp.title':{en:'Reports',zh:'報表'},
 'dl.title':{en:'Downloads',zh:'附件下載專區'},
 'dl.none':{en:'No documents yet.',zh:'目前沒有可下載文件。'},
 'home.activePanel':{en:'Active PTW',zh:'執行中 PTW'},
 'home.overduePanel':{en:'Overdue (Not Closed)',zh:'逾期未關 PTW'},
 'flow.title':{en:'PTW Overall Workflow',zh:'PTW整體作業流程圖'},
 'flow.t0':{en:'Account Application',zh:'帳號申請'},
 'flow.t0b':{en:'Admin Approval',zh:'待管理員審核'},
 'flow.t1':{en:'Training & Exam',zh:'訓練考試'},
 'flow.t2':{en:'Contractor Applies PTW',zh:'承商申請人申請PTW'},
 'flow.t3':{en:'Contractor HSE Review',zh:'承商安衛部門審閱'},
 'flow.t4':{en:'NMDC Construction Review',zh:'NMDC 施工部門審閱'},
 'flow.t5':{en:'NMDC HSE Review',zh:'NMDC 安衛部門審閱'},
 'flow.t6':{en:'Coordinator Issues',zh:'NMDC 協調員簽發'},
 'flow.t7':{en:'Work Execution',zh:'執行作業'},
 'flow.t8':{en:'Close PTW',zh:'關閉PTW'},
 'sig.title':{en:'Signature (sign on white paper, take a photo)',zh:'簽名檔（請於白紙上簽名後拍照上傳）'},
 'sig.step1':{en:'Sign your name on a piece of white paper',zh:'在白紙上簽名'},
 'sig.step2':{en:'Take a photo and upload the file',zh:'拍照並上傳檔案'},
 'sig.step3':{en:'Click the "Remove background" button',zh:'按下「清除背景」按鈕'},
 'sig.step4':{en:'Confirm the signature looks correct (it will be used as your official signature)',zh:'確認簽名檔無誤（之後將使用此作為您的簽名檔案）'},
 'apply.isHse':{en:'Are you HSE personnel?',zh:'是否為 HSE 人員？'},
 'common.yes':{en:'Yes',zh:'是'},
 'common.no':{en:'No',zh:'否'},
 'apply.allRequired':{en:'All fields are required — please complete the highlighted fields',zh:'所有欄位皆為必填 — 請補齊紅框欄位'},
 'sig.choose':{en:'Choose photo',zh:'選擇照片'},
 'sig.removeBg':{en:'Remove background',zh:'清除背景'},
 'sig.tooPoor':{en:'Image quality too low or background too busy — please retake on clean white paper with good lighting.',zh:'畫質太差或背景太雜，無法處理 — 請在乾淨白紙上重簽、光線充足處重拍。'},
 'sig.done':{en:'Background removed. Looks good? If not, choose another photo.',zh:'背景已清除，確認簽名清晰；不滿意可重新選擇照片。'},
 'sig.required':{en:'Please upload your signature and click "Remove background".',zh:'請上傳簽名照片並按「清除背景」。'},
 'pw.title':{en:'PTW Application System',zh:'線上 PTW 申請系統'},
 'pw.new':{en:'Create New PTW',zh:'新增 PTW'},
 'pw.save':{en:'Save Draft',zh:'儲存草稿'},
 'pw.close':{en:'Close',zh:'關閉'},
 'pw.prev':{en:'Previous',zh:'上一步'},
 'pw.next':{en:'Next',zh:'下一步'},
 'pw.saved':{en:'Saved',zh:'已儲存'},
 'pw.saving':{en:'Saving…',zh:'儲存中…'},
 'pw.submit':{en:'Preview & Submit',zh:'預覽並提交'},
 'pw.confirmSubmit':{en:'Submit this PTW for review? It cannot be edited while under review.',zh:'確定提交送審？審查期間將無法編輯。'},
 'pw.submitted':{en:'PTW submitted — now pending Tier 2 review.',zh:'PTW 已提交 — 進入 Tier 2 承商工安審查。'},
 'pw.withdraw':{en:'Withdraw',zh:'撤回'},
 'pw.certComplete':{en:'Mark this certificate as COMPLETE',zh:'標記此證書為「已完成」'},
 'pw.certSave':{en:'Save Certificate',zh:'儲存證書'},
 'pw.noCert':{en:'No certificate required for the selected work types (Cold Work needs no certificate).',zh:'所選作業類型無需附加證書（一般作業 Cold Work 免附證書）。'},
 'pw.trainingNeeded':{en:'You must pass the PTW training before creating a PTW.',zh:'須先通過 PTW 訓練考試才能建立 PTW。'}
};
var lang='en';
try{ var sv=localStorage.getItem('ptw_lang')||sessionStorage.getItem('ptw_lang');
     if(sv==='zh'||sv==='en') lang=sv; }catch(e){}
function T(k){ var s=STRINGS[k]; return s?(s[lang]||s.en):k; }
/* (8) 單語顯示：雙語混寫字串依語言拆分（中文取 CJK＋縮寫；英文取拉丁詞） */
function L(str){
  if(!str) return str;
  var s0=String(str);
  if(!/[\\u4e00-\\u9fff]/.test(s0)) return s0;
  var toks=s0.split(/\\s+/), zh=[], en=[];
  toks.forEach(function(t){
    if(/[\\u4e00-\\u9fff]/.test(t)){ zh.push(t); }
    else if(/^[0-9A-Z\\/\\.\\-+&()（）:：＊*]+$/.test(t)&&/[A-Z0-9]/.test(t)&&t.length<=8){ zh.push(t); en.push(t); }
    else { en.push(t); }
  });
  var out=(lang==='zh'?zh:en).join(' ');
  return out||s0;
}
var STATUS_NAME={Draft:['Draft','草稿'],Submitted:['Submitted','已提交'],
 PendingTier2Review:['Pending T2 Review','待承商工安審查'],PendingTier3Review:['Pending T3 Review','待施工部門審查'],
 PendingTier4Review:['Pending T4 Review','待NMDC HSE審查'],PendingTier5Review:['Pending T5 Review','待協調員審查'],
 ReturnedForRevision:['Returned','退回修改'],ReturnedForCorrection:['Returned to prev. tier','退回上一關'],
 Approved:['Approved','已核准'],Active:['Active','執行中'],Suspended:['Suspended','已暫停'],
 Extended:['Extended','已延長'],Expired:['Expired','已到期'],WorkCompleted:['Work Completed','工作完成'],
 PendingCloseout:['Pending Close-out','待關閉'],Closed:['Closed','已關閉'],Cancelled:['Cancelled','已取消']};
function SN(st){ var n=STATUS_NAME[st]; return n?(lang==='zh'?n[1]:n[0]):st; }
function apiMsg(res){ if(!res) return 'Error'; return (lang==='zh'?(res.msgZh||res.msgEn):(res.msgEn||res.msgZh))||res.errorCode||'Error'; }
function applyI18n(){
  document.querySelectorAll('[data-i18n]').forEach(function(n){ n.textContent=T(n.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach(function(n){ n.setAttribute('placeholder',T(n.getAttribute('data-i18n-ph'))); });
  // 靜態雙語文字 → 依語言單語顯示（data-l：文字；data-l-ph：placeholder）
  document.querySelectorAll('[data-l]').forEach(function(n){
    if(!n.getAttribute('data-lraw')) n.setAttribute('data-lraw',n.textContent);
    n.textContent=L(n.getAttribute('data-lraw'));
  });
  document.querySelectorAll('[data-l-ph]').forEach(function(n){
    if(!n.getAttribute('data-lraw')) n.setAttribute('data-lraw',n.getAttribute('placeholder')||'');
    n.setAttribute('placeholder',L(n.getAttribute('data-lraw')));
  });
  // 申請帳號 Tier 下拉：依語言重建
  var apT=$('apTier');
  if(apT&&typeof TIER_TITLES!=='undefined'){
    var cur=apT.value;
    var h='';
    [1,2,3,4,5].forEach(function(t){
      var con=(t<=2);   // Tier 1–2 承商（橘）；Tier 3–5 NMDC（藍）
      var tag=con?(lang==='zh'?'【承商 Contractor】':'[Contractor] '):(lang==='zh'?'【NMDC】':'[NMDC] ');
      h+='<option value="'+t+'"'+(String(cur)===String(t)||(cur===''&&t===1)?' selected':'')+
        ' style="color:'+(con?'#b35c00':'#0b6bcb')+';font-weight:600">'+tag+'Tier '+t+' — '+
        esc(lang==='zh'?TIER_TITLES[t].zh:TIER_TITLES[t].en)+'</option>';
    });
    apT.innerHTML=h;
  }
}
function switchLang(l){
  lang=(l==='zh')?'zh':'en';
  try{ localStorage.setItem('ptw_lang',lang);}catch(e){ try{ sessionStorage.setItem('ptw_lang',lang);}catch(e2){} }
  $('btnEn').className=(lang==='en')?'active':''; $('btnZh').className=(lang==='zh')?'active':'';
  applyI18n();
  try{ renderAcctMenu((getToken()&&getUser())||null); }catch(e){}
  try{ renderTestBar(); }catch(e){}
  try{ refreshContactModal(); }catch(e){}
  // 切換語言時重繪目前畫面（修正：訓練/PTW/帳號頁停留在舊語言）
  if(currentView==='admin'){
    renderAdmin();
    // 停留在「審批流程」分頁時，依新語言重繪流程圖
    try{
      var fcPane=document.getElementById('tabFlowChart');
      if(fcPane&&fcPane.classList.contains('active')){
        if(window._adminUsers) renderFlowChart(window._adminUsers);
        else loadFlowChart();
      }
    }catch(e){}
  }
  if(currentView==='home') renderHome();
  if(currentView==='training'){ try{ if($('examArea').classList.contains('d-none')) loadTraining(); }catch(e){} }
  if(currentView==='ptw'){
    try{
      if(cur){ gotoStep(curStep); renderLifeBar(); renderReviewBar(); }
      else loadPtwList();
    }catch(e){}
  }
  if(currentView==='account'){ try{ openAccount(); }catch(e){} }
}

/* (10) 自訂視窗：uiConfirm / uiPrompt / uiAlert（Promise 版） */
var uiModalResolve=null,uiModalIsPrompt=false;
function uiDialog(o){
  return new Promise(function(resolve){
    uiModalResolve=resolve; uiModalIsPrompt=!!o.prompt;
    var msg=$('uiModalMsg');
    // 純文字訊息 → 自動排版（空行分段、首段略大），並把開頭的表情符號升格為標題圖示
    var auto=dlgAuto_(o);
    if(o.html){ msg.innerHTML=(o.msg?auto.body:'')+o.html; }
    else { msg.innerHTML=auto.body; }
    msg.style.whiteSpace='normal';
    // 標題列：呼叫端指定優先；沒指定就用自動推導的（所有視窗都有標題列，不再是白底一片字）
    var head=$('uiModalHead');
    var icon=o.icon||auto.icon, title=o.title||auto.title;
    if(title){
      $('uiModalIcon').textContent=icon||'';
      $('uiModalTitle').textContent=title;
      $('uiModalSub').textContent=o.sub||'';
      $('uiModalSub').style.display=o.sub?'':'none';
      head.style.background=o.headColor||dlgHeadColor_(icon);
      head.classList.remove('d-none');
    } else head.classList.add('d-none');
    $('uiModalCard').style.maxWidth=(o.width||480)+'px';
    var inp=$('uiModalInput');
    if(o.prompt){ inp.classList.remove('d-none'); inp.value=o.def||''; } else inp.classList.add('d-none');
    $('uiModalCancel').textContent=o.cancelText||(lang==='zh'?'取消':'Cancel');
    $('uiModalCancel').style.display=o.noCancel?'none':'';
    var ok=$('uiModalOk');
    ok.textContent=o.okText||(lang==='zh'?'確定':'OK');
    ok.className='btn '+(o.okClass||'btn-navy');
    $('uiModal').style.display='flex';
    if(o.prompt) setTimeout(function(){ inp.focus(); },60);
  });
}
function uiModalDone(ok){
  var r=uiModalResolve; uiModalResolve=null;
  $('uiModal').style.display='none';
  if(!r) return;
  if(uiModalIsPrompt) r(ok?$('uiModalInput').value:null);
  else r(!!ok);
}
/* ---- 視窗自動美化：開頭表情符號 → 標題圖示＋標題列配色；純文字 → 分段排版 ---- */
var DLG_LEAD=['⚠️','⚠','☢️','☢','🗑️','🗑','❌','🚫','✅','✔️','📝','📥','📤','ℹ️','🔔','🏁','💬','❓','📋','🚀','🔴','🟢','⏰','👥','🔑','📊','🎓','🧯'];
var DLG_DANGER=['⚠️','⚠','☢️','☢','🗑️','🗑','❌','🚫','🔴'];
var DLG_OK=['✅','✔️','🟢','🏁'];
function dlgHeadColor_(icon){
  if(DLG_DANGER.indexOf(icon)>=0) return 'linear-gradient(135deg,#8d1f1f 0%,#c0392b 100%)';
  if(DLG_OK.indexOf(icon)>=0)     return 'linear-gradient(135deg,#155d32 0%,#1e8449 100%)';
  return 'linear-gradient(135deg,#0b3a5c 0%,#17608e 100%)';
}
/** 依對話框種類與訊息內容，推導圖示、標題與已排版的內文 */
function dlgAuto_(o){
  var Z=(lang==='zh'), t=String(o.msg||'').trim(), icon='', title='';
  for(var i=0;i<DLG_LEAD.length;i++){
    if(t.indexOf(DLG_LEAD[i])===0){ icon=DLG_LEAD[i]; t=t.substring(DLG_LEAD[i].length).replace(/^[\\s:：]+/,''); break; }
  }
  if(o.prompt){ if(!icon) icon='✏️'; title=Z?'請輸入資料':'Input required'; }
  else if(o.noCancel){ if(!icon) icon='ℹ️'; title=Z?'系統提示':'Notice'; }
  else { if(!icon) icon='❓'; title=Z?'請確認':'Please confirm'; }
  if(DLG_DANGER.indexOf(icon)>=0) title=Z?'請注意':'Please read carefully';
  if(DLG_OK.indexOf(icon)>=0)     title=Z?'完成':'Done';
  // 空行分段；段內單一換行用 <br>；首段加大加粗
  var paras=t.split(/\\n\\s*\\n/).filter(function(p){ return p.trim()!==''; });
  var body=paras.map(function(p,idx){
    var s=esc(p.trim()).replace(/\\n/g,'<br>');
    return idx===0
      ? '<p style="margin:0 0 10px;font-size:15px;line-height:1.75;color:#1b2c3d;font-weight:600">'+s+'</p>'
      : '<p style="margin:0 0 8px;font-size:13.5px;line-height:1.7;color:#4a5b6d">'+s+'</p>';
  }).join('');
  return { icon:icon, title:title, body:body||'<p class="mb-0">&nbsp;</p>' };
}
function uiConfirm(msg,html,okText){ return uiDialog({msg:msg,html:html,okText:okText}); }
function uiPrompt(msg,def){ return uiDialog({msg:msg,prompt:true,def:def}); }
function uiAlert(msg,html){ return uiDialog({msg:msg,html:html,noCancel:true}); }

/* ---------- API（google.script.run 橋接，免設定 URL） ---------- */
var mem={};
/* 登入憑證存 localStorage → 同一台電腦新開分頁／重開瀏覽器皆免再登入
   （伺服器 Session 仍只有 8 小時，逾時一樣要重新登入）；
   若使用者在登入頁取消「保持登入」，則退回 sessionStorage＝僅此分頁有效。
   其餘快取（首頁／清單）維持 sessionStorage，不佔用長期空間。 */
var AUTH_KEYS={ptw_token:1,ptw_user:1,ptw_lang:1,ptw_tm_admin_token:1,ptw_tm_admin_user:1};
function authPersist(){ try{ return localStorage.getItem('ptw_keep')!=='0'; }catch(e){ return false; } }
function store_(k){
  if(!AUTH_KEYS[k]) return sessionStorage;
  return authPersist()?localStorage:sessionStorage;
}
function sget(k){
  try{
    var v=store_(k).getItem(k);
    if(v===null&&AUTH_KEYS[k]){ try{ v=sessionStorage.getItem(k); }catch(e2){} }  // 相容舊分頁
    return v;
  }catch(e){ return mem[k]||null; }
}
function sset(k,v){
  try{
    store_(k).setItem(k,v);
    if(AUTH_KEYS[k]){ try{ (authPersist()?sessionStorage:localStorage).removeItem(k); }catch(e2){} }
  }catch(e){ mem[k]=v; }
}
/** 登出／重置時把兩邊的憑證都清乾淨 */
function clearAuthStorage(){
  Object.keys(AUTH_KEYS).forEach(function(k){
    if(k==='ptw_lang') return;
    try{ localStorage.removeItem(k); }catch(e){}
    try{ sessionStorage.removeItem(k); }catch(e){}
  });
}
function getToken(){ return sget('ptw_token')||''; }
function getUser(){ try{return JSON.parse(sget('ptw_user')||'null');}catch(e){return null;} }
var inflight=0;
var loadingTimer=null;
function netBusy(d){
  inflight+=d;
  var b=$('netbar'); if(b) b.style.display=inflight>0?'block':'none';
  // (2) 浮動讀取視窗：忙碌超過 0.4 秒才顯示（避免快速操作閃爍）
  var pill=$('loadingPill');
  if(inflight>0){
    if(!loadingTimer&&pill&&pill.style.display==='none'){
      loadingTimer=setTimeout(function(){
        loadingTimer=null;
        if(inflight>0&&pill){ $('loadingPillText').textContent=(lang==='zh'?'讀取中，請稍候…':'Loading, please wait…'); pill.style.display='flex'; }
      },400);
    }
  }else{
    if(loadingTimer){ clearTimeout(loadingTimer); loadingTimer=null; }
    if(pill) pill.style.display='none';
  }
}
function api(action,payload,opts){
  var silent=!!(opts&&opts.silent);            // 靜默呼叫：不顯示讀取中視窗（背景進度回報等）
  if(!silent) netBusy(1);
  var t0=Date.now();
  return new Promise(function(resolve){
    google.script.run
      .withSuccessHandler(function(res){
        if(!silent) netBusy(-1);
        var r; try{ r=JSON.parse(res); }catch(e){ r={ok:false,errorCode:'BAD_RESPONSE',msgEn:'Invalid response',msgZh:'回應格式錯誤'}; }
        try{ console.log('[api] '+action+' total='+(Date.now()-t0)+'ms server='+(r.serverMs||'?')+'ms'); }catch(e){}
        if(r.ok===false && (r.errorCode==='UNAUTHORIZED'||r.errorCode==='SESSION_EXPIRED')){ clearAuthStorage(); showView('auth'); }
        resolve(r);
      })
      .withFailureHandler(function(err){ if(!silent) netBusy(-1); resolve({ok:false,errorCode:'NETWORK',msgEn:String(err&&err.message||err),msgZh:'連線錯誤，請重試'}); })
      .apiCall(JSON.stringify({action:action,token:getToken(),payload:payload||{},meta:{userAgent:navigator.userAgent.substring(0,250)}}));
  });
}

/* ---------- 視圖切換 ---------- */
var currentView='auth';
function showView(v){
  currentView=v;
  $('viewAuth').classList.toggle('d-none',v!=='auth');
  $('viewAdmin').classList.toggle('d-none',v!=='admin');
  $('viewHome').classList.toggle('d-none',v!=='home');
  $('viewTraining').classList.toggle('d-none',v!=='training');
  $('viewPtw').classList.toggle('d-none',v!=='ptw');
  $('viewAccount').classList.toggle('d-none',v!=='account');
  $('viewCertified').classList.toggle('d-none',v!=='certified');
  if(v!=='training') stopYtTracking();
  var u=(getToken()&&getUser())||null;
  renderAcctMenu(u);
  $('subtitle').textContent=u?(bi(u.nameEn,u.nameZh)+' · Tier '+u.tier+(u.isAdmin?' · Admin':'')):T('app.project');
}
function loadCompanyOptions(){
  var sel=$('apCompany'); if(!sel||sel.options.length>1) return;
  api('company.options',{}).then(function(res){
    if(!res.ok) return;
    var h='<option value="">--</option>';
    res.data.forEach(function(c){
      var nm=(lang==='zh'?(c.nameZh||c.nameEn):(c.nameEn||c.nameZh));
      h+='<option value="'+esc(c.nameZh||c.nameEn)+'">'+esc(nm)+(c.type?'（'+esc(c.type)+'）':'')+'</option>';
    });
    sel.innerHTML=h;
  });
}
function showTierHelp(){
  var Z=(lang==='zh');
  var rows=[
    ['Tier 1',Z?'承商持有人／申請人 Contractor Holder / Applicant':'Contractor Holder / Applicant','C',
     Z?'建立與提交 PTW、指定持有人／副持有人、填寫證書與上傳附件；通過教育訓練後也可擔任現場工單持有人（同一人可兼任申請人與持有人）。HSE 人員不可擔任持有人。':'Creates and submits PTWs, assigns holders/co-holders, completes certificates and uploads attachments; once training is passed, may also act as the on-site permit holder (the same person can be both applicant and holder). HSE personnel cannot act as a holder.'],
    ['Tier 2',Z?'承商職安衛 Contractor HSE':'Contractor HSE','C',
     Z?'承商內部第一關審查（僅限本公司 PTW）。':'First-line review within the contractor (own company PTWs only).'],
    ['Tier 3',Z?'NMDC 施工部門':'NMDC Construction','N',
     Z?'施工面審查：施工方法、介面與現場條件。':'Construction review: method, interfaces and site conditions.'],
    ['Tier 4',Z?'NMDC 安衛部門':'NMDC HSE','N',
     Z?'安衛面審查：危害辨識、預防措施與法規符合性。':'HSE review: hazards, precautions and compliance.'],
    ['Tier 5',Z?'NMDC PTW 協調員／系統管理員':'NMDC PTW Coordinator / System Admin','N',
     Z?'最終簽發、暫停與關閉 PTW；具系統管理權限。':'Final issue, suspension and close-out; has system administration rights.']];
  var h='<b style="font-size:1.05rem">'+(Z?'Tier 1–5 角色說明':'Tier 1–5 Roles')+'</b>'+
    '<div class="small mt-1"><span style="color:#b35c00;font-weight:700">■ '+(Z?'承商 Contractor':'Contractor')+'</span>　'+
    '<span style="color:#0b6bcb;font-weight:700">■ NMDC</span></div><div class="mt-2" style="text-align:left">';
  rows.forEach(function(r){
    var con=(r[2]==='C');
    h+='<div style="border-left:4px solid '+(con?'#b35c00':'#0b6bcb')+';background:'+(con?'#fdf6ee':'#f2f8fd')+';border-radius:6px;padding:6px 10px;margin-bottom:6px">'+
      '<b style="color:'+(con?'#b35c00':'#0b6bcb')+'">'+r[0]+'・'+esc(r[1])+'</b><div class="small text-muted">'+esc(r[3])+'</div></div>';
  });
  uiAlert(null,h+'</div>');
}
function showPanel(name){
  ['Login','Apply','Forgot'].forEach(function(p){ $('panel'+p).classList.add('d-none'); });
  $('panel'+name).classList.remove('d-none');
  if(name==='Apply') loadCompanyOptions();
}
function toast(msg,okType){
  var div=document.createElement('div');
  div.className='toast align-items-center text-bg-'+(okType?'success':'danger')+' border-0 show mb-2';
  div.innerHTML='<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto"></button></div>';
  div.querySelector('.toast-body').textContent=msg;
  div.querySelector('.btn-close').onclick=function(){div.remove();};
  $('toast').appendChild(div); setTimeout(function(){div.remove();},5000);
}
function alertBox(id,type,msg){ var el=$(id); el.className='alert alert-'+type; el.textContent=msg; el.classList.remove('d-none'); }

/* ---------- Auth ---------- */
function togglePw(){
  var i=$('loginPassword'),b=$('btnTogglePw'); var s=i.type==='password';
  i.type=s?'text':'password'; b.textContent=T(s?'login.hide':'login.show');
}
function doLogin(){
  var email=$('loginEmail').value.trim(),pw=$('loginPassword').value;
  if(!email||!pw){ alertBox('loginAlert','danger',T('login.email')+' / '+T('login.password')); return; }
  // 「保持登入」決定憑證放 localStorage（跨分頁）或 sessionStorage（僅此分頁）
  var keep=$('keepSignedIn');
  try{ localStorage.setItem('ptw_keep',(keep&&!keep.checked)?'0':'1'); }catch(e){}
  clearAuthStorage();
  $('btnLogin').disabled=true;
  api('auth.login',{email:email,password:pw}).then(function(res){
    $('btnLogin').disabled=false;
    if(!res.ok){ alertBox('loginAlert','danger',apiMsg(res)); return; }
    sset('ptw_token',res.data.token); sset('ptw_user',JSON.stringify(res.data.user));
    // 登入回應已順路帶回首頁資料 → 直接入快取，首頁零延遲渲染且不需再抓一次
    if(res.data.home){ try{ sset('ptw_home_cache_'+res.data.user.id,JSON.stringify({__t:Date.now(),data:res.data.home})); }catch(e){} }
    if(res.data.mustChangePassword){
      uiPrompt(T('login.changePw')).then(function(np){
        if(!np){ sset('ptw_token',''); return; }
        api('auth.changePassword',{oldPassword:pw,newPassword:np}).then(function(r2){
          if(r2.ok){ enter(); } else { alertBox('loginAlert','danger',apiMsg(r2)); }
        });
      });
      return;
    }
    enter();
  });
}
function enter(){
  showView('home');
  try{ renderTestBar(); }catch(e){}
  renderHome();
  if(pendingAction){ var fn=pendingAction; pendingAction=null; setTimeout(function(){ fn(); },200); }
}

/* ---------- 首頁（公開；點功能才登入） ---------- */
var pendingAction=null;
function requireLogin(fn){
  if(getToken()&&getUser()){ fn(); return; }
  pendingAction=fn;
  toast(T('home.loginFirst'),true);
  showView('auth'); showPanel('Login');
}
/* 首頁 KPI 只留六顆流程階段：總數 → 草稿 → 簽核中 → 已核發待生效 → 執行中 → 逾期未關
   （已核准／即將到期／已到期／被退回／已關閉 仍由後端計算，可從 PTW 清單篩選查看） */
var KPI_DEF=[
  ['total','#0b3a5c'],['draft','#6c757d'],['pending','#f0a500'],['issuedPending','#0b6bcb'],['active','#146c43'],['overdueOpen','#b02a37']
];
var KPI_FILTER={total:'',draft:'Draft',pending:'_pending',approved:'Approved',active:'_active',issuedPending:'_issuedPending',
 expiringSoon:'_expiringSoon',expired:'Expired',overdueOpen:'_overdueOpen',returned:'_returned',closed:'Closed'};
function renderKpis(k){
  var h='';
  KPI_DEF.forEach(function(d){
    h+='<div class="col-6 col-sm-4 col-md-3 col-lg" style="min-width:110px">'+
      '<div class="card-x p-2 text-center h-100" style="cursor:pointer" title="'+(lang==='zh'?'點擊查看清單':'Click to view list')+'" onclick="openPtwListWithStatus(\\''+(KPI_FILTER[d[0]]||'')+'\\')">'+
      '<div style="font-size:1.5rem;font-weight:700;color:'+d[1]+'">'+(k[d[0]]||0)+'</div>'+
      '<div class="small text-muted">'+T('kpi.'+d[0])+'</div></div></div>';
  });
  $('kpiRow').innerHTML=h;
}
function openPtwListWithStatus(st){
  showView('ptw');
  $('ptwFormWrap').classList.add('d-none'); $('ptwListWrap').classList.remove('d-none');
  $('pfStatus').value=st; $('pfMine').checked=false;
  loadPtwList();
}
function renderHomeData(d){
  renderKpis(d.dashboard.kpi);
  renderQueue(d.dashboard.myQueue||[]);
  if(d.board){ var bw0=$('boardWrap'); if(bw0) bw0.classList.remove('d-none'); renderBoard(d.board); }
  if(d.downloads) renderDownloads(d.downloads);
  if(d.announcements) renderAnnouncements(d.announcements);
  var btnPtw=$('hbtn_myptw_count'); if(btnPtw) btnPtw.textContent=d.dashboard.myPtwCount||0;
  var n=(d.notify&&d.notify.unread)||0;
  var b=$('hbtn_notify_count'); if(b){ b.textContent=n||''; b.style.display=n?'':'none'; }
}
/* 首頁看板：執行中（淺綠）/ 逾期未關（淺紅）— 附件下載區上方，公開 */
function renderBoard(b){
  renderBoardList('activePanel','activeCount',b.active||[],false);
  renderBoardList('overduePanel','overdueCount',b.overdue||[],true);
}
function renderBoardList(elId,cntId,rows,danger){
  $(cntId).textContent=rows.length||'';
  if(!rows.length){ $(elId).innerHTML='<span class="text-muted">—</span>'; return; }
  var Z=(lang==='zh');
  var canOpen=!!(getToken()&&getUser());
  var h='<table class="table table-sm table-hover mb-0" style="--bs-table-bg:transparent"><thead><tr>'+
    '<th>'+(Z?'PTW編號':'PTW No.')+'</th><th>'+(Z?'有效期間':'PTW Duration')+'</th>'+
    '<th>'+(Z?'船舶':'Vessel')+'</th><th>'+(Z?'工作區域':'Area')+'</th>'+
    '<th>'+(Z?'工作內容':'Work Description')+'</th><th>'+(Z?'持有人':'Holder')+'</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var wd=String(r.workDescription||'—'); if(wd.length>60) wd=wd.substring(0,60)+'…';
    h+='<tr'+(canOpen?' style="cursor:pointer" onclick="openPtwFromQueue(\\''+r.id+'\\')"':'')+'>'+
      '<td class="text-nowrap"><b'+(danger?' class="text-danger"':'')+'>'+esc(r.number)+'</b></td>'+
      '<td class="text-nowrap small">'+esc(r.validFrom||'—')+'<br>→ '+esc(r.validTo||'—')+'</td>'+
      '<td>'+esc(r.vessel||'—')+'</td>'+
      '<td>'+esc(r.areaLocation||'—')+'</td>'+
      '<td>'+esc(wd)+'</td>'+
      '<td>'+esc(Z?(r.holderZh||r.holderEn||'—'):(r.holderEn||r.holderZh||'—'))+'</td></tr>';
  });
  $(elId).innerHTML=h+'</tbody></table>';
}
/* (6) 下載專區（公開） */
function renderDownloads(rows){
  if(!rows||!rows.length){ $('downloadsList').innerHTML='<span class="text-muted">'+T('dl.none')+'</span>'; return; }
  var h='<div class="row g-2">';
  rows.forEach(function(d){
    var dn=(lang==='zh'?(d.titleZh||d.title):(d.titleEn||d.title));
    h+='<div class="col-md-4"><a class="d-block card-x p-2 text-decoration-none" href="'+esc(d.fileUrl)+'" target="_blank" rel="noopener">'+
      '📄 <b>'+esc(dn)+'</b>'+(d.description?'<div class="small text-muted">'+esc(d.description)+'</div>':'')+
      '<div class="small text-muted">'+esc(d.fileName)+'</div></a></div>';
  });
  $('downloadsList').innerHTML=h+'</div>';
}
function loadPublicDownloads(){
  // 未登入首頁：先用上次快取即時顯示，再用「一支」合併 API（home.public）背景更新
  var key='ptw_home_cache_public';
  var env=null; try{ env=JSON.parse(sget(key)||'null'); }catch(e){}
  var cached=env&&env.data;
  var render=function(d){
    if(d.downloads) renderDownloads(d.downloads);
    if(d.board){ var bw=$('boardWrap'); if(bw) bw.classList.remove('d-none'); renderBoard(d.board); }
    if(d.announcements) renderAnnouncements(d.announcements);
  };
  if(cached) render(cached);
  if(env&&env.__t&&(Date.now()-env.__t)<15000) return;
  api('home.public',{},{silent:!!cached}).then(function(res){
    if(res.ok){ try{ sset(key,JSON.stringify({__t:Date.now(),data:res.data})); }catch(e){} render(res.data); return; }
    if(res.errorCode!=='UNKNOWN_ACTION') return;
    api('downloads.list',{},{silent:!!cached}).then(function(r){ if(r.ok) renderDownloads(r.data); });
    api('ptw.board',{},{silent:!!cached}).then(function(r){
      if(r.ok){ var bw=$('boardWrap'); if(bw) bw.classList.remove('d-none'); renderBoard(r.data); }
    });
    loadPublicAnnounces();
  });
}
/* (7) 系統流程圖 */
function renderFlowBar(){
  var steps=[['👤','flow.t0'],['🔎','flow.t0b'],['🎓','flow.t1'],['📝','flow.t2'],['🦺','flow.t3'],['🏗️','flow.t4'],['🛡️','flow.t5'],['✅','flow.t6'],['⚙️','flow.t7'],['🏁','flow.t8']];
  var h='<div class="fbtitle">'+T('flow.title')+'</div><div class="fbrow">';
  steps.forEach(function(st,i){
    if(i>0) h+='<div class="flowarrow">➜</div>';
    h+='<div class="flowstep"><div class="fi"><span class="fnum">'+(i+1)+'</span>'+st[0]+'</div><div class="ft">'+T(st[1])+'</div></div>';
  });
  $('flowBar').innerHTML=h+'</div>';
}
function renderHome(){
  var u=(getToken()&&getUser())||null;
  renderHomeButtons(u);
  renderFlowBar();

  $('homeLoggedIn').classList.toggle('d-none',!u);
  if(!u) $('queueWrap').classList.add('d-none');
  if(!u){ loadPublicDownloads(); return; }
  // 先用上次快取立即渲染（0 延遲），背景更新
  var homeKey='ptw_home_cache_'+((getUser()||{}).id||'');
  var env=null; try{ env=JSON.parse(sget(homeKey)||'null'); }catch(e){}
  var cached=(env&&env.__t)?env.data:env;   // 新格式 {__t,data}；相容舊格式（直接是資料）
  if(cached){ renderHomeData(cached); }
  else $('kpiRow').innerHTML='<div class="text-muted small p-2">'+(lang==='zh'?'載入中…':'Loading…')+'</div>';
  // 剛登入帶回的資料還很新（<15 秒）→ 不需再抓一次
  if(env&&env.__t&&(Date.now()-env.__t)<15000) return;
  api('home.bootstrap',{},{silent:!!cached}).then(function(res){
    if(!res.ok){ if(!cached) $('kpiRow').innerHTML='<div class="text-danger small p-2">'+esc(apiMsg(res))+'</div>'; return; }
    try{ sset(homeKey,JSON.stringify({__t:Date.now(),data:res.data})); }catch(e){}
    renderHomeData(res.data);
  });
}
function renderQueue(rows){
  $('queueCount').textContent=rows.length||'';
  $('queueWrap').classList.remove('d-none');
  if(!rows.length){
    $('queueList').innerHTML='<div class="text-muted small">'+T('home.noAction')+'</div>';
    $('queueWrap').style.background='#f4f8fb'; $('queueWrap').style.borderColor='#dbe4ee';
    return;
  }
  $('queueWrap').style.background='#fdecea'; $('queueWrap').style.borderColor='#f1b0b7';
  var h='<table class="table table-sm mb-0" style="background:#fff"><thead><tr>'+
    '<th>'+T('queue.ptwNo')+'</th><th>'+T('queue.company')+'</th><th>'+T('queue.location')+'</th>'+
    '<th>'+T('queue.status')+'</th><th>'+T('queue.step')+'</th><th>'+T('queue.reviewer')+'</th><th>'+T('queue.waiting')+'</th></tr></thead><tbody>';
  rows.forEach(function(r){
    h+='<tr style="cursor:pointer" onclick="openPtwFromQueue(\\''+r.id+'\\')"><td><b>'+esc(r.ptwNumber)+'</b></td><td>'+esc(lang==='zh'?(r.companyZh||r.companyEn):(r.companyEn||r.companyZh))+'</td>'+
      '<td class="small">'+esc(r.areaLocation)+'</td><td>'+
      (r.overdueClose
        ?'<span class="badge bg-danger">⏰ '+(lang==='zh'?'已逾期 — 請關閉 PTW':'Overdue — please close this PTW')+'</span>'
        :'<span class="badge bg-warning text-dark">'+esc(SN(r.status))+'</span>')+'</td>'+
      '<td>Tier '+esc(r.currentTier)+'</td><td>'+esc(r.currentReviewer||'—')+'</td>'+
      '<td'+(r.waitingDays>=3?' class="text-danger fw-bold"':'')+'>'+esc(r.waitingDays)+'</td></tr>';
  });
  $('queueList').innerHTML=h+'</tbody></table>';
}
/* ===== 使用者編輯（系統管理） ===== */
function openUserEdit(uid){
  var r=(window._usersCache||[]).filter(function(x){ return x.id===uid; })[0];
  if(!r){ toast('User not found'); return; }
  var Z=(lang==='zh');
  var coOpts='';
  document.querySelectorAll('#ufCompany option').forEach(function(o){
    if(o.value) coOpts+='<option value="'+esc(o.value)+'"'+(o.value===r.companyId?' selected':'')+'>'+esc(o.textContent)+'</option>';
  });
  var tierOpts=[1,2,3,4,5].map(function(t){
    return '<option value="'+t+'"'+(Number(r.tier)===t?' selected':'')+'>Tier '+t+'</option>'; }).join('');
  var html='<div id="userEditModal" style="position:fixed;inset:0;background:rgba(6,24,40,.55);z-index:3000;display:flex;align-items:center;justify-content:center">'+
    '<div class="card-x p-3" style="width:560px;max-width:94vw;max-height:90vh;overflow:auto">'+
    '<h6>✏️ '+(Z?'編輯使用者資料':'Edit User')+' — '+esc(r.email)+'</h6>'+
    '<div class="row g-2">'+
    '<div class="col-6"><label class="form-label small mb-0">'+(Z?'中文姓名':'Name (ZH)')+'</label><input id="ue_nameZh" class="form-control form-control-sm" value="'+esc(r.nameZh||'')+'"></div>'+
    '<div class="col-6"><label class="form-label small mb-0">'+(Z?'英文姓名':'Name (EN)')+'</label><input id="ue_nameEn" class="form-control form-control-sm" value="'+esc(r.nameEn||'')+'"></div>'+
    '<div class="col-6"><label class="form-label small mb-0">'+(Z?'公司':'Company')+'</label><select id="ue_companyId" class="form-select form-select-sm">'+coOpts+'</select></div>'+
    '<div class="col-6"><label class="form-label small mb-0">Tier</label><select id="ue_tier" class="form-select form-select-sm">'+tierOpts+'</select></div>'+
    '<div class="col-6"><label class="form-label small mb-0">'+(Z?'職稱':'Title')+'</label><input id="ue_title" class="form-control form-control-sm" value="'+esc(r.title||'')+'"></div>'+
    '<div class="col-6"><label class="form-label small mb-0">'+(Z?'電話':'Phone')+'</label><input id="ue_phone" class="form-control form-control-sm" value="'+esc(r.phone||'')+'"></div>'+
    '<div class="col-6"><label class="form-label small mb-0">'+(Z?'船舶':'Vessel')+'</label><input id="ue_vessel" class="form-control form-control-sm" value="'+esc(r.vessel||'')+'"></div>'+
    '<div class="col-6"><label class="form-label small mb-0">'+(Z?'證號 Badge No':'Badge No')+'</label><input id="ue_badgeNo" class="form-control form-control-sm" value="'+esc(r.badgeNo||'')+'"></div>'+
    '<div class="col-6 pt-2"><div class="form-check"><input class="form-check-input" type="checkbox" id="ue_isHse"'+((r.isHse===true||r.isHse==='TRUE')?' checked':'')+'>'+
      '<label class="form-check-label small" for="ue_isHse">'+(Z?'HSE 人員（不可任持有人）':'HSE (cannot be a holder)')+'</label></div></div>'+
    '<div class="col-6 pt-2"><div class="form-check"><input class="form-check-input" type="checkbox" id="ue_isAdmin"'+((r.isAdmin===true||r.isAdmin==='TRUE')?' checked':'')+'>'+
      '<label class="form-check-label small" for="ue_isAdmin">'+(Z?'系統管理員（限 Tier 5）':'Admin (Tier 5 only)')+'</label></div></div>'+
    '</div>'+
    '<div class="d-flex gap-2 mt-3 justify-content-end">'+
    '<button class="btn btn-sm btn-outline-secondary" onclick="closeUserEdit()">'+(Z?'取消':'Cancel')+'</button>'+
    '<button class="btn btn-sm btn-navy" onclick="saveUserEdit(\\''+r.id+'\\')">💾 '+(Z?'儲存':'Save')+'</button>'+
    '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend',html);
}
function closeUserEdit(){ var m=$('userEditModal'); if(m) m.remove(); }
function saveUserEdit(uid){
  api('user.update',{userId:uid,
    nameZh:$('ue_nameZh').value.trim(),nameEn:$('ue_nameEn').value.trim(),
    companyId:$('ue_companyId').value,tier:Number($('ue_tier').value),
    title:$('ue_title').value.trim(),phone:$('ue_phone').value.trim(),
    vessel:$('ue_vessel').value.trim(),badgeNo:$('ue_badgeNo').value.trim(),
    isHse:$('ue_isHse').checked,isAdmin:$('ue_isAdmin').checked
  }).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    toast('✅ '+(lang==='zh'?'已更新':'Updated'),true);
    closeUserEdit(); loadUsers();
  });
}
/* 右下角：聯繫系統管理員（自動辨識 Line/電話/Email 美化為聯繫卡片） */
var contactCache=null; // {info,infoEn}
function renderContactBody(info){
  var intro=[],rows=[];
  String(info||'').split('\\n').forEach(function(line){
    var t=line.trim(); if(!t){ if(intro.length) intro.push(''); return; }
    var v=t.split(/[:：]/).slice(1).join(':').trim();
    if(/^line/i.test(t)&&v){
      rows.push(['💬','LINE',esc(v),null,v]);
    }else if(/whatsapp|電話|phone|tel/i.test(t)&&v){
      var digits=v.replace(/[^\\d+]/g,'').replace(/^\\+/,'');
      rows.push(['📱',(lang==='zh'?'電話 / WhatsApp':'Phone / WhatsApp'),esc(v),'https://wa.me/'+digits,v]);
    }else if(/mail|郵件/i.test(t)&&v){
      rows.push(['✉️','Email',esc(v),'mailto:'+v,v]);
    }else intro.push(esc(t));
  });
  var h='';
  if(intro.length) h+='<div class="small text-muted mb-3" style="white-space:pre-wrap">'+intro.join('\\n').trim()+'</div>';
  rows.forEach(function(r){
    var inner='<span style="width:38px;height:38px;border-radius:10px;background:#eaf3fb;display:inline-flex;align-items:center;justify-content:center;font-size:1.15rem;margin-right:10px;flex:0 0 38px">'+r[0]+'</span>'+
      '<span style="flex:1;min-width:0"><span class="d-block small text-muted">'+r[1]+'</span>'+
      '<b style="color:#0b3a5c;word-break:break-all">'+r[2]+'</b></span>';
    if(r[3]){
      h+='<a href="'+r[3]+'" target="_blank" rel="noopener" class="text-decoration-none d-flex align-items-center mb-2 p-2" '+
        'style="border:1px solid #dbe7f1;border-radius:12px;background:#f9fcff">'+inner+
        '<span style="color:#1173b8">↗</span></a>';
    }else{
      h+='<div class="d-flex align-items-center mb-2 p-2" style="border:1px solid #dbe7f1;border-radius:12px;background:#f9fcff">'+inner+
        '<button class="btn btn-sm btn-outline-primary" onclick="navigator.clipboard&&navigator.clipboard.writeText(\\''+esc(r[4])+'\\');toast(\\'📋 Copied\\',true)">'+(lang==='zh'?'複製':'Copy')+'</button></div>';
    }
  });
  $('contactBody').innerHTML=h||'—';
}
function refreshContactModal(){
  if($('contactModal').style.display==='flex') renderContactBody(contactTextForLang());
}
function contactTextForLang(){
  if(!contactCache) return '';
  return (lang==='en'&&contactCache.infoEn)?contactCache.infoEn:(contactCache.info||contactCache.infoEn||'');
}
function showContact(){
  $('contactModal').style.display='flex';
  if(contactCache){ renderContactBody(contactTextForLang()); return; }
  api('contact.get',{}).then(function(res){
    contactCache=res.ok?{info:res.data.info||'',infoEn:res.data.infoEn||''}:{info:'',infoEn:''};
    renderContactBody(contactTextForLang());
  });
}
/* 核發通知清單（系統管理） */
function loadIssueList(){
  api('admin.issueList.get',{}).then(function(res){
    if(res.ok) $('issueMailList').value=res.data.list||'';
  });
  api('contact.get',{}).then(function(res){
    if(res.ok){ $('contactText').value=res.data.info||''; $('contactTextEn').value=res.data.infoEn||''; }
  });
  loadCcMail();
}
/* 狀態變動副本 + 週報設定 + 測試寄信 */
var ccEventDefs=[];
function loadCcMail(){
  api('admin.ccMail.get',{}).then(function(res){
    if(!res.ok) return;
    var Z=(lang==='zh');
    $('ccMailList').value=res.data.list||'';
    $('weeklyMailList').value=res.data.weeklyList||'';
    ccEventDefs=res.data.eventDefs||[];
    var ev=res.data.events||{};
    $('ccEventChecks').innerHTML=ccEventDefs.map(function(d){
      var on=(ev[d[0]]!==false);
      return '<div class="col-md-4 col-6"><div class="form-check">'+
        '<input class="form-check-input ccEvChk" type="checkbox" id="ccev_'+d[0]+'"'+(on?' checked':'')+'>'+
        '<label class="form-check-label" for="ccev_'+d[0]+'">'+esc(Z?d[1]:d[2])+'</label></div></div>';
    }).join('');
    // 測試信下拉：所有寄信時機（副本事件 + 每週摘要）
    var opts=ccEventDefs.map(function(d){ return '<option value="'+d[0]+'">'+esc(Z?('副本：'+d[1]):('CC: '+d[2]))+'</option>'; });
    opts.push('<option value="weeklySummary">'+(Z?'🗓 每週摘要（週日 20:00）':'🗓 Weekly summary (Sun 20:00)')+'</option>');
    $('mailTestEvent').innerHTML=opts.join('');
  });
}
function saveCcMail(){
  var events={};
  document.querySelectorAll('.ccEvChk').forEach(function(c){ events[c.id.replace('ccev_','')]=c.checked; });
  api('admin.ccMail.set',{list:$('ccMailList').value,events:events,weeklyList:$('weeklyMailList').value})
  .then(function(res){
    if(res.ok){ $('ccMailState').textContent='✓'; toast('Saved ✅',true); }
    else toast(apiMsg(res));
  });
}
function sendMailTest(){
  var Z=(lang==='zh');
  var email=$('mailTestEmail').value.trim();
  if(!email){ toast(Z?'⚠️ 請填寫測試信箱':'⚠️ Enter a test email'); return; }
  $('mailTestState').textContent='⏳';
  api('admin.mail.test',{email:email,eventKey:$('mailTestEvent').value}).then(function(res){
    if(res.ok){
      $('mailTestState').textContent='✓';
      toast('📧 '+(Z?('測試信已寄出至 '+email):('Test email sent to '+email)),true);
    }else{ $('mailTestState').textContent=''; toast(apiMsg(res)); }
  });
}
function saveContactText(){
  api('admin.contact.set',{text:$('contactText').value,textEn:$('contactTextEn').value}).then(function(res){
    if(res.ok){ contactCache={info:$('contactText').value,infoEn:$('contactTextEn').value};
      $('contactState').textContent='✓'; toast('Saved ✅',true); }
    else toast(apiMsg(res));
  });
}
function saveIssueList(){
  api('admin.issueList.set',{list:$('issueMailList').value}).then(function(res){
    if(res.ok){ $('issueMailState').textContent='✓ '+res.data.count+(lang==='zh'?' 筆已儲存':' saved'); toast('Saved ✅',true); }
    else toast(apiMsg(res));
  });
}
/* ===== 合格人員 Certified Personnel ===== */
var cpRows=null;
function openCertified(){
  showView('certified');
  if(cpRows){ renderCertified(); return; }
  api('personnel.list',{}).then(function(res){
    if(!res.ok){ $('cpTable').innerHTML='<div class="text-danger small p-2">'+esc(apiMsg(res))+'</div>'; return; }
    cpRows=res.data.rows;
    // 公司下拉
    var cos={}; cpRows.forEach(function(r){ var n=r.companyEn||r.companyZh; if(n) cos[n]=r.companyZh||n; });
    $('cpCompany').innerHTML='<option value="">'+(lang==='zh'?'全部公司':'All Companies')+'</option>'+
      Object.keys(cos).sort().map(function(n){ return '<option value="'+esc(n)+'">'+esc(lang==='zh'?cos[n]:n)+'</option>'; }).join('');
    renderCertified();
  });
}
function renderCertified(){
  if(!cpRows) return;
  var Z=(lang==='zh');
  var q=($('cpSearch').value||'').trim().toLowerCase(), ft=$('cpType').value, fc=$('cpCompany').value;
  var rows=cpRows.filter(function(r){
    if(ft&&r.type!==ft) return false;
    if(fc&&(r.companyEn||r.companyZh)!==fc) return false;
    if(q){ var hay=(r.nameZh+' '+r.nameEn+' '+r.companyZh+' '+r.companyEn+' '+r.title+' '+r.dept).toLowerCase();
      if(hay.indexOf(q)<0) return false; }
    return true;
  });
  var iss=rows.filter(function(r){ return r.type==='Issuing'; }).length;
  $('cpCount').textContent='('+rows.length+'/'+cpRows.length+')';
  $('cpStats').textContent=(Z?('Issuing '+iss+' 人 | Performing '+(rows.length-iss)+' 人 | 共 '+rows.length+' 人')
    :('Issuing: '+iss+' | Performing: '+(rows.length-iss)+' | Total: '+rows.length));
  var today=localDate();
  var soon=localDate(new Date(Date.now()+60*86400000));
  var h='<table class="table table-sm mb-0" style="--bs-table-bg:transparent;color:#dce9f7">'+
    '<thead><tr style="border-bottom:2px solid #1e3a5c">'+
    ['#',Z?'類型':'Type',Z?'部門':'Dept.',Z?'公司':'Company',Z?'姓名':'Name',Z?'職稱':'Title',Z?'訓練日期':'Trained',Z?'效期':'Valid Until']
      .map(function(t){ return '<th style="color:#7fb2e5;border:0;background:#12243c">'+t+'</th>'; }).join('')+'</tr></thead><tbody>';
  rows.forEach(function(r,i){
    var typeBadge=r.type==='Issuing'
      ?'<span class="badge" style="background:#2a2a72;color:#b9c8ff">Issuing</span>'
      :'<span class="badge" style="background:#0f3d2e;color:#7fe5b2">Performing</span>';
    var vu=r.validUntil||'';
    var vuHtml=!vu?'-':(vu<today?'<span style="color:#ff7b7b;font-weight:700">'+esc(vu)+' ⚠</span>'
      :(vu<=soon?'<span style="color:#f0a500;font-weight:700">'+esc(vu)+'</span>':'<span style="color:#7f95b0">'+esc(vu)+'</span>'));
    h+='<tr style="border-bottom:1px solid #14283f">'+
      '<td style="border:0;color:#5f7790">'+(i+1)+'</td>'+
      '<td style="border:0">'+typeBadge+'</td>'+
      '<td style="border:0;color:#a9bdd4" class="small">'+esc((Z?r.dept.split('|')[0]:(r.dept.split('|')[1]||r.dept.split('|')[0]))||'-')+'</td>'+
      '<td style="border:0"><span class="badge" style="background:#123a5c;color:#7fd0ff">'+esc((Z?(r.companyZh||r.companyEn):(r.companyEn||r.companyZh)).substring(0,14))+'</span></td>'+
      '<td style="border:0;font-weight:700;color:#eef6ff">'+esc(Z?(r.nameZh||r.nameEn):(r.nameEn||r.nameZh))+(r.nameEn&&r.nameZh&&r.nameEn!==r.nameZh?' <span class="small" style="color:#7f95b0">'+esc(Z?r.nameEn:r.nameZh)+'</span>':'')+'</td>'+
      '<td style="border:0;color:#cfe0f2">'+esc(r.title||'-')+(r.isHse?' <span class="badge" style="background:#5c2a12;color:#ffb27f">HSE</span>':'')+'</td>'+
      '<td style="border:0;color:#a9bdd4">'+esc(r.trainedAt||'-')+'</td>'+
      '<td style="border:0">'+vuHtml+'</td></tr>';
  });
  $('cpTable').innerHTML=h+'</tbody></table>'+
    (rows.length?'':'<div class="small p-3" style="color:#7f95b0">'+(Z?'無符合條件的人員':'No matching personnel')+'</div>');
}
/* 編號總表（系統管理） */
function loadNumbers(){
  var Z=(lang==='zh');
  $('numTable').innerHTML='Loading…';
  api('admin.numbers.overview',{}).then(function(res){
    if(!res.ok){ $('numTable').innerHTML='<div class="text-danger small">'+esc(apiMsg(res))+'</div>'; return; }
    var d=res.data, CT=['HW','DO','RG','CS','EC','EI'];
    // 缺號提示
    var gk=Object.keys(d.gaps||{});
    $('numGaps').innerHTML=gk.length
      ?'<div class="alert alert-info py-2 small">♻️ <b>'+(Z?'目前缺號（將由系統自動補發，已發出號碼不變）：':'Current gaps (will be reused automatically; issued numbers never change):')+'</b> '+
        gk.map(function(p){ return '<span class="badge bg-secondary me-1">'+esc(p)+': '+d.gaps[p].join(', ')+'</span>'; }).join('')+'</div>'
      :'<div class="alert alert-success py-2 small">✅ '+(Z?'目前無缺號 — 所有編號連續':'No gaps — all numbers are sequential')+'</div>';
    if(!d.rows.length){ $('numTable').innerHTML='<div class="text-muted small p-2">'+(Z?'尚無 PTW':'No PTW yet')+'</div>'; return; }
    var h='<table class="table table-sm table-hover"><thead><tr><th>PTW No.</th><th>'+(Z?'狀態':'Status')+'</th><th>'+(Z?'承商':'Company')+'</th><th>'+(Z?'申請日期':'App Date')+'</th>'+
      CT.map(function(c){ return '<th>'+c+'</th>'; }).join('')+'</tr></thead><tbody>';
    d.rows.forEach(function(r){
      h+='<tr style="cursor:pointer" onclick="openPtwFromQueue(\\''+r.id+'\\')">'+
        '<td><b>'+esc(r.number)+'</b>'+(r.official?'':' <span class="badge bg-secondary">Draft</span>')+'</td>'+
        '<td><span class="badge bg-'+(r.status==='Closed'?'secondary':(r.status==='Active'?'success':'warning text-dark'))+'">'+esc(SN(r.status))+'</span></td>'+
        '<td class="small">'+esc(r.company)+'</td><td class="small">'+esc(r.executionDate)+'</td>'+
        CT.map(function(c){ return '<td class="small">'+esc(r.certs[c]||'—')+'</td>'; }).join('')+'</tr>';
    });
    $('numTable').innerHTML=h+'</tbody></table>';
  });
}
/* 右上角帳號選單：登入/註冊/我的帳號/系統管理/登出 */
function renderAcctMenu(u){
  var isAdm=!!(u&&(asB(u.isAdmin)||Number(u.tier)===5));
  var h='';
  if(u){
    $('acctMenuLabel').innerHTML='👤 '+esc((lang==='zh'?(u.nameZh||u.nameEn):(u.nameEn||u.nameZh))||'');
    h+='<li><h6 class="dropdown-header">'+T('menu.signedInAs')+'<br><b>'+esc(u.nameEn||'')+'</b>'+
       '<div class="small text-muted">Tier '+esc(u.tier)+(isAdm?' · Admin':'')+'</div></h6></li>'+
       '<li><hr class="dropdown-divider"></li>'+
       '<li><a class="dropdown-item" href="#" onclick="openAccount();return false">👤 '+T('menu.myAccount')+'</a></li>'+
       (isAdm?'<li><a class="dropdown-item" href="#" onclick="gotoAdmin();return false">⚙️ '+T('menu.sysAdmin')+'</a></li>':'')+
       '<li><hr class="dropdown-divider"></li>'+
       '<li><a class="dropdown-item text-danger" href="#" onclick="doLogout();return false">🚪 '+T('home.btnLogout')+'</a></li>';
  }else{
    $('acctMenuLabel').innerHTML='👤 <span>'+T('menu.guest')+'</span>';
    h+='<li><a class="dropdown-item" href="#" onclick="gotoLogin();return false">🔐 '+T('home.btnLogin')+'</a></li>'+
       '<li><a class="dropdown-item" href="#" onclick="gotoApply();return false">🪪 '+T('home.btnApplyAccount')+'</a></li>';
  }
  $('acctMenu').innerHTML=h;
}
function renderHomeButtons(u){
  var loggedIn=!!u;
  // 一般使用者四個功能一列：訓練 / 申請 PTW / 我的 PTW / 待辦與通知
  var defs=[
    {icon:'🎓',key:'home.btnTraining',fn:'requireLogin(openTraining)'},
    {icon:'📝',key:'home.btnPtw',fn:'requireLogin(openPtwList)'},
    {icon:'📁',key:'home.btnMyPtw',fn:'requireLogin(openMyPtw)',badge2:loggedIn?'hbtn_myptw_count':null},
    {icon:'🔔',key:'home.btnInbox',fn:'requireLogin(openInbox)',badge:loggedIn?'hbtn_notify_count':null}
  ];
  var colors={'home.btnTraining':'#7b1fa2','home.btnPtw':'#0b6bcb','home.btnMyPtw':'#2e7d32','home.btnInbox':'#c62828'};
  var h='';
  defs.forEach(function(d){
    if(d.adminOnly && !(u&&(asB(u.isAdmin)||Number(u.tier)===5))) return;
    var c=colors[d.key]||'#0b3a5c';
    h+='<div class="col-6 col-md-3"><button class="hbtn" onclick="'+d.fn+'">'+
      '<span class="ic" style="background:linear-gradient(160deg,'+c+','+c+'cc)">'+d.icon+
      (d.badge?'<span id="'+d.badge+'" class="badge bg-danger position-absolute" style="font-size:.6rem;transform:translate(18px,-16px)"></span>':'')+
      '</span><div class="lb">'+T(d.key)+'</div>'+
      (d.badge2?'<div class="small text-muted"><span id="'+d.badge2+'">0</span> PTW</div>':'')+
      '</button></div>';
  });
  $('homeButtons').innerHTML=h;
}
function comingSoon(){ toast(T('home.comingSoon'),true); }
function openPtwFromQueue(id){ showView('ptw'); $('ptwListWrap').classList.add('d-none'); openPtwForm(id); }
function gotoLogin(){ showView('auth'); showPanel('Login'); }
function gotoApply(){ showView('auth'); showPanel('Apply'); }
function goHome(){ enter(); }
/** 捲到首頁「附件下載專區」（本視窗內） */
function scrollToDownloads(){
  goHome();
  // 首頁的下載清單是非同步載入的，元素位置會變 → 重試數次直到捲到定位
  var tries=0;
  (function go(){
    var d=$('downloadsWrap');
    if(d){
      d.scrollIntoView({behavior:(tries?'auto':'smooth'),block:'start'});
      d.style.transition='box-shadow .4s'; d.style.boxShadow='0 0 0 3px #ffc107';
      setTimeout(function(){ d.style.boxShadow=''; },3000);
    }
    if(++tries<6) setTimeout(go,500);
  })();
}
/** 前往下載專區 — 一律開新視窗，絕不動到目前這一頁（表單填到一半不可被打斷）。
 *  GAS 網頁執行於 iframe，location.href 取不到對外網址，故使用後端注入的 PTW_APP_URL。
 *  若瀏覽器封鎖彈出視窗，改跳出視窗提供可點擊的連結（使用者親自點擊的連結不會被封鎖），
 *  仍然不會改變目前頁面。 */
function openDownloads(){
  var Z=(lang==='zh');
  var base=String(window.PTW_APP_URL||'');
  if(!base){
    uiDialog({icon:'📥',title:(Z?'無法取得系統網址':'System URL unavailable'),noCancel:true,okText:(Z?'知道了':'OK'),
      html:'<div class="small">'+(Z
        ?'請自行開新分頁進入本系統首頁的「附件下載專區」下載表單。<br><span class="text-muted">（目前這一頁的填寫內容不受影響，已保留。）</span>'
        :'Please open the system home page in a new tab and use the Downloads section.<br><span class="text-muted">(Your current form is untouched.)</span>')+'</div>'});
    return;
  }
  var url=base+(base.indexOf('?')<0?'?':'&')+'view=downloads';
  var w=null;
  try{ w=window.open(url,'_blank','noopener'); }catch(e){}
  if(w){ try{ w.focus(); }catch(e2){} toast(Z?'已於新視窗開啟下載專區':'Downloads opened in a new tab',true); return; }
  // 被封鎖 → 給一個使用者可直接點的連結，本頁完全不動
  uiDialog({icon:'📥',title:(Z?'請點下方連結開啟下載專區':'Click the link below to open Downloads'),
    sub:(Z?'瀏覽器封鎖了自動開啟的新視窗':'Your browser blocked the automatic pop-up'),
    noCancel:true,okText:(Z?'關閉':'Close'),width:520,
    html:'<div class="text-center mb-2">'+
      '<a href="'+esc(url)+'" target="_blank" rel="noopener" class="btn btn-warning fw-bold" onclick="uiModalDone(true)">📥 '+
      (Z?'在新分頁開啟下載專區':'Open Downloads in a new tab')+' ↗</a></div>'+
      '<div class="uiNote">'+(Z
        ?'目前這一頁<b>不會</b>被切走，填寫中的內容完全保留。<br>若連結無法點擊，可複製下方網址自行貼上：'
        :'This page will <b>not</b> navigate away — your form stays exactly as it is.<br>If the link does not work, copy the address below:')+
      '<div class="mt-2 p-2 small" style="background:#fff;border:1px solid #e2d3a0;border-radius:6px;word-break:break-all">'+esc(url)+'</div>'+
      '<button type="button" class="btn btn-sm btn-outline-secondary mt-2" onclick="copyText(\\''+esc(url).replace(/'/g,"\\\\'")+'\\')">📋 '+
      (Z?'複製網址':'Copy link')+'</button></div>'});
}
/** 複製文字到剪貼簿（含舊瀏覽器 fallback） */
function copyText(t){
  var done=function(){ toast(lang==='zh'?'📋 已複製網址':'📋 Link copied',true); };
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(done,function(){ copyFallback_(t,done); }); return; }
  }catch(e){}
  copyFallback_(t,done);
}
function copyFallback_(t,done){
  try{
    var ta=document.createElement('textarea');
    ta.value=t; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); done();
  }catch(e){ toast(lang==='zh'?'複製失敗，請手動選取網址':'Copy failed — please select the address manually'); }
}
function gotoAdmin(){ showView('admin'); renderAdmin(); }
function scrollToQueue(){ $('queueList').scrollIntoView({behavior:'smooth',block:'center'}); }
/* 待辦與通知合併：捲到待您審核區並展開通知面板 */
function openInbox(){
  showView('home');
  openNotify();
  setTimeout(function(){
    var q=$('queueWrap');
    if(q&&!q.classList.contains('d-none')) q.scrollIntoView({behavior:'smooth',block:'start'});
    else $('notifyPanel').scrollIntoView({behavior:'smooth',block:'center'});
  },150);
}
function openNotify(){
  $('notifyPanel').classList.remove('d-none');
  api('notify.list',{page:1}).then(function(res){
    if(!res.ok){ $('notifyList').innerHTML='<div class="text-muted">'+esc(apiMsg(res))+'</div>'; return; }
    if(!res.data.rows.length){ $('notifyList').innerHTML='<div class="text-muted">'+T('home.noNotify')+'</div>'; return; }
    var h='';
    res.data.rows.forEach(function(n){
      var unread=!(n.isRead===true||n.isRead==='TRUE');
      h+='<div class="border-bottom py-2'+(unread?' fw-semibold':'')+'" '+(unread?'style="cursor:pointer" onclick="markNotify(\\''+n.id+'\\')"':'')+'>'+
        (unread?'🔵 ':'')+esc(lang==='zh'?n.titleZh:n.titleEn)+
        '<div class="small text-muted fw-normal">'+esc(lang==='zh'?n.messageZh:n.messageEn)+'</div>'+
        '<div class="small text-muted fw-normal">'+esc(n.createdAt)+'</div></div>';
    });
    $('notifyList').innerHTML=h;
  });
  $('notifyPanel').scrollIntoView({behavior:'smooth'});
}
function markNotify(id){ api('notify.markRead',{notificationId:id}).then(function(){ openNotify(); renderHome(); }); }
/* ---------- 帳號管理 My Account ---------- */
function openAccount(){
  showView('account');
  api('profile.get',{}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var p=res.data.profile;
    $('acEmail').value=p.email; $('acCompany').value=p.company+' · Tier '+p.tier;
    $('acNameZh').value=p.nameZh||''; $('acNameEn').value=p.nameEn||'';
    $('acTitle').value=p.title||''; $('acPhone').value=p.phone||'';
    $('acVessel').value=p.vessel||''; $('acBadge').value=p.badgeNo||'';
    var sig=res.data.signatureBase64;
    if(sig){ $('acSigImg').src='data:image/png;base64,'+sig; $('acSigImg').style.display=''; $('acSigNone').style.display='none'; }
    else { $('acSigImg').style.display='none'; $('acSigNone').style.display=''; }
    var pend=res.data.pendingRequest;
    var banner=$('acPendingBanner');
    var editable=!pend;
    ['acNameZh','acNameEn','acTitle','acPhone','acVessel','acBadge'].forEach(function(id){ $(id).disabled=!editable; });
    $('btnAcSubmit').disabled=!editable;
    if(pend){
      var lines=Object.keys(pend.changes).map(function(k){
        return esc(k)+'：'+esc(pend.changes[k].from||'—')+' → <b>'+esc(pend.changes[k].to)+'</b>';
      }).join('<br>');
      banner.innerHTML='⏳ <b>'+(lang==='zh'?'您的修改申請正在等待管理員審核':'Your change request is pending admin approval')+
        '</b>（'+esc(pend.createdAt)+'）<br>'+lines+
        '<br><button class="btn btn-sm btn-outline-secondary mt-1" onclick="cancelProfileReq(\\''+pend.id+'\\')">'+
        (lang==='zh'?'取消申請':'Cancel request')+'</button>';
      banner.classList.remove('d-none');
    }else banner.classList.add('d-none');
  });
}
function submitProfileChange(){
  var payload={nameZh:$('acNameZh').value.trim(),nameEn:$('acNameEn').value.trim(),
    title:$('acTitle').value.trim(),phone:$('acPhone').value.trim(),
    vessel:$('acVessel').value.trim(),badgeNo:$('acBadge').value.trim()};
  api('profile.requestChange',payload).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    toast(lang==='zh'?'修改申請已送出，待管理員審核':'Change request submitted for admin approval',true);
    openAccount();
  });
}
function cancelProfileReq(id){
  api('profile.cancelRequest',{requestId:id}).then(function(res){
    if(res.ok){ toast(lang==='zh'?'已取消':'Cancelled',true); openAccount(); } else toast(apiMsg(res));
  });
}
function acSaveSignature(){
  if(!sigState.ac||!sigState.ac.cleaned){ toast(T('sig.required')); return; }
  api('profile.updateSignature',{signatureBase64:sigState.ac.dataUrl.split(',')[1]}).then(function(res){
    if(res.ok){ toast(lang==='zh'?'簽名已更新':'Signature updated',true); openAccount(); }
    else toast(apiMsg(res));
  });
}
function acChangePw(){
  var oldPw=$('acOldPw').value,newPw=$('acNewPw').value;
  if(!oldPw||!newPw){ toast(T('home.changePwNew')); return; }
  api('auth.changePassword',{oldPassword:oldPw,newPassword:newPw}).then(function(res){
    toast(res.ok?T('home.pwChanged'):apiMsg(res),res.ok);
    if(res.ok){ $('acOldPw').value=''; $('acNewPw').value=''; }
  });
}
function doLogout(){
  api('auth.logout',{}).then(function(){ clearAuthStorage(); pendingAction=null; clearDataCaches(); enter(); });
}
/* (1) 簽名檔處理：載入→清除背景（亮度門檻+透明化）→品質檢查 */
var sigState={};
function sigLoadImage(input,key){
  var f=input.files[0]; if(!f) return;
  var img=new Image();
  img.onload=function(){
    var c=$(key+'SigCanvas'),ctx=c.getContext('2d');
    // 等比縮放置中（預覽）
    var scale=Math.min(c.width/img.width,c.height/img.height);
    ctx.clearRect(0,0,c.width,c.height);
    ctx.drawImage(img,(c.width-img.width*scale)/2,(c.height-img.height*scale)/2,img.width*scale,img.height*scale);
    c.classList.remove('d-none');
    sigState[key]={cleaned:false,img:img}; // 保留原圖以全解析度處理
    $(key+'SigBtn').disabled=false;
    $(key+'SigMsg').textContent=(lang==='zh'?'已載入照片，請按「清除背景」':'Photo loaded — click "Remove background"');
  };
  img.onerror=function(){ $(key+'SigMsg').textContent=(lang==='zh'?'無法讀取圖片':'Cannot read image'); };
  img.src=URL.createObjectURL(f);
}
/* 簽名照片 → 去背＋去雜點＋自動裁切（處理光照不均：格狀背景估計＋連通元件過濾） */
function sigProcess_(img){
  var maxDim=1400;
  var sc=Math.min(1,maxDim/Math.max(img.width,img.height));
  var w=Math.max(1,Math.round(img.width*sc)),h=Math.max(1,Math.round(img.height*sc));
  var oc=document.createElement('canvas');oc.width=w;oc.height=h;
  var octx=oc.getContext('2d');
  octx.fillStyle='#fff';octx.fillRect(0,0,w,h); // 先鋪白底（避免透明 PNG 誤判為墨跡）
  octx.drawImage(img,0,0,w,h);
  var d=octx.getImageData(0,0,w,h),p=d.data,n=w*h;
  var lum=new Float32Array(n);
  for(var i=0;i<n;i++){var j=i*4;lum[i]=0.299*p[j]+0.587*p[j+1]+0.114*p[j+2];}
  // 1) 格狀背景亮度估計（每格取 85 百分位）＋雙線性內插 → 克服陰影/光照不均
  var cell=Math.max(16,Math.round(Math.max(w,h)/20));
  var gw=Math.ceil(w/cell),gh=Math.ceil(h/cell);
  var bgGrid=new Float32Array(gw*gh);
  for(var gy=0;gy<gh;gy++)for(var gx=0;gx<gw;gx++){
    var xs=gx*cell,ys=gy*cell,xe=Math.min(w,xs+cell),ye=Math.min(h,ys+cell),arr=[];
    for(var y=ys;y<ye;y+=2)for(var x=xs;x<xe;x+=2)arr.push(lum[y*w+x]);
    arr.sort(function(a,b){return a-b;});
    bgGrid[gy*gw+gx]=arr[Math.floor(arr.length*0.85)]||255;
  }
  var ratio=new Float32Array(n);
  for(var y2=0;y2<h;y2++){
    var fy=Math.min(gh-1,Math.max(0,y2/cell-0.5)),y0=Math.floor(fy),y1=Math.min(gh-1,y0+1),ty=fy-y0;
    for(var x2=0;x2<w;x2++){
      var fx=Math.min(gw-1,Math.max(0,x2/cell-0.5)),x0=Math.floor(fx),x1=Math.min(gw-1,x0+1),tx=fx-x0;
      var bg=bgGrid[y0*gw+x0]*(1-tx)*(1-ty)+bgGrid[y0*gw+x1]*tx*(1-ty)+bgGrid[y1*gw+x0]*(1-tx)*ty+bgGrid[y1*gw+x1]*tx*ty;
      ratio[y2*w+x2]=lum[y2*w+x2]/Math.max(bg,1);
    }
  }
  // 2) 二值遮罩（含柔邊）→ 連通元件：去除雜點與大面積陰影/桌面
  var BIN=0.88,SOLID=0.72,SOFT=0.90;
  var mask=new Uint8Array(n);
  for(var k=0;k<n;k++) if(ratio[k]<BIN) mask[k]=1;
  var label=new Int32Array(n),nextLbl=0,stack=new Int32Array(n);
  var compSize=[],compTouch=[],compMinX=[],compMaxX=[],compMinY=[],compMaxY=[];
  for(var s0=0;s0<n;s0++){
    if(!mask[s0]||label[s0]) continue;
    nextLbl++;var sp=0;stack[sp++]=s0;label[s0]=nextLbl;
    var size=0,touch=0,mnx=w,mxx=0,mny=h,mxy=0;
    while(sp>0){
      var q=stack[--sp];size++;
      var qx=q%w,qy=(q-qx)/w;
      if(qx<mnx)mnx=qx;if(qx>mxx)mxx=qx;if(qy<mny)mny=qy;if(qy>mxy)mxy=qy;
      if(qx===0||qy===0||qx===w-1||qy===h-1)touch++;
      if(qx>0&&mask[q-1]&&!label[q-1]){label[q-1]=nextLbl;stack[sp++]=q-1;}
      if(qx<w-1&&mask[q+1]&&!label[q+1]){label[q+1]=nextLbl;stack[sp++]=q+1;}
      if(qy>0&&mask[q-w]&&!label[q-w]){label[q-w]=nextLbl;stack[sp++]=q-w;}
      if(qy<h-1&&mask[q+w]&&!label[q+w]){label[q+w]=nextLbl;stack[sp++]=q+w;}
    }
    compSize[nextLbl]=size;compTouch[nextLbl]=touch;
    compMinX[nextLbl]=mnx;compMaxX[nextLbl]=mxx;compMinY[nextLbl]=mny;compMaxY[nextLbl]=mxy;
  }
  var minSize=Math.max(30,Math.round(n*0.00003));
  var cand=[];
  for(var L=1;L<=nextLbl;L++){
    if(compSize[L]<minSize) continue;                    // 雜點
    if(compTouch[L]>0&&compSize[L]>n*0.05) continue;     // 貼邊大面積＝桌面/紙緣陰影
    var bwc=compMaxX[L]-compMinX[L],bhc=compMaxY[L]-compMinY[L];
    if(compTouch[L]>0&&(bwc>w*0.95||bhc>h*0.95)) continue; // 貼邊且橫跨整幅＝邊框陰影
    cand.push(L);
  }
  var keep=new Uint8Array(nextLbl+1),bx0=w,bx1=0,by0=h,by1=0,inkPx=0;
  if(cand.length){
    // 聚類：以最大元件為核心，僅保留鄰近的元件（點、逗號等），排除遠處孤立污點
    cand.sort(function(a,b){return compSize[b]-compSize[a];});
    var core=cand[0];
    var ux0=compMinX[core],ux1=compMaxX[core],uy0=compMinY[core],uy1=compMaxY[core];
    var inCluster=new Uint8Array(nextLbl+1);inCluster[core]=1;
    var changed=true;
    while(changed){
      changed=false;
      var m=Math.round(Math.max(ux1-ux0,uy1-uy0)*0.35)+Math.round(Math.max(w,h)*0.02);
      for(var ci=0;ci<cand.length;ci++){
        var C=cand[ci];if(inCluster[C])continue;
        if(compMinX[C]<=ux1+m&&compMaxX[C]>=ux0-m&&compMinY[C]<=uy1+m&&compMaxY[C]>=uy0-m){
          inCluster[C]=1;changed=true;
          if(compMinX[C]<ux0)ux0=compMinX[C];if(compMaxX[C]>ux1)ux1=compMaxX[C];
          if(compMinY[C]<uy0)uy0=compMinY[C];if(compMaxY[C]>uy1)uy1=compMaxY[C];
        }
      }
    }
    for(var ki=0;ki<cand.length;ki++){
      var K=cand[ki];if(!inCluster[K])continue;
      keep[K]=1;inkPx+=compSize[K];
      if(compMinX[K]<bx0)bx0=compMinX[K];if(compMaxX[K]>bx1)bx1=compMaxX[K];
      if(compMinY[K]<by0)by0=compMinY[K];if(compMaxY[K]>by1)by1=compMaxY[K];
    }
  }
  if(!inkPx||inkPx/n<0.0004||inkPx/n>0.35||bx1-bx0<15||by1-by0<8) return null; // 幾乎無筆跡/整片黑/太小
  // 3) 裁切（含 5% 邊距）→ 輸出：保留原筆色（略加深），背景全透明，邊緣柔化
  var pad=Math.max(8,Math.round(Math.max(bx1-bx0,by1-by0)*0.05));
  var cx0=Math.max(0,bx0-pad),cy0=Math.max(0,by0-pad),cw=Math.min(w,bx1+pad+1)-cx0,ch=Math.min(h,by1+pad+1)-cy0;
  var out=document.createElement('canvas');out.width=cw;out.height=ch;
  var otx=out.getContext('2d');var od=otx.createImageData(cw,ch),op=od.data;
  for(var yy=0;yy<ch;yy++)for(var xx=0;xx<cw;xx++){
    var si=(yy+cy0)*w+(xx+cx0),di=(yy*cw+xx)*4;
    var Lb=label[si];
    if(!Lb||!keep[Lb]){op[di+3]=0;continue;}
    var r=ratio[si];
    var a=r<=SOLID?255:Math.max(0,Math.round((SOFT-r)/(SOFT-SOLID)*255));
    op[di]=Math.round(p[si*4]*0.82);op[di+1]=Math.round(p[si*4+1]*0.82);op[di+2]=Math.round(p[si*4+2]*0.82);op[di+3]=a;
  }
  otx.putImageData(od,0,0);
  // 4) 等比縮至寬 ≤700
  var fw=Math.min(700,cw),fh=Math.round(ch*fw/cw);
  var fin=document.createElement('canvas');fin.width=fw;fin.height=fh;
  fin.getContext('2d').drawImage(out,0,0,fw,fh);
  return fin;
}
function sigRemoveBg(key){
  var st=sigState[key];
  if(!st||!st.img){ $(key+'SigMsg').textContent=T('sig.tooPoor'); return; }
  var result=null;
  try{ result=sigProcess_(st.img); }catch(e){ result=null; }
  if(!result){
    $(key+'SigMsg').innerHTML='<span class="text-danger">'+T('sig.tooPoor')+'</span>';
    sigState[key].cleaned=false; return;
  }
  // 預覽：置中畫入棋盤格畫布
  var c=$(key+'SigCanvas'),ctx=c.getContext('2d');
  var scale=Math.min(c.width/result.width,c.height/result.height,1);
  ctx.clearRect(0,0,c.width,c.height);
  ctx.drawImage(result,(c.width-result.width*scale)/2,(c.height-result.height*scale)/2,result.width*scale,result.height*scale);
  sigState[key]={cleaned:true,img:st.img,dataUrl:result.toDataURL('image/png')};
  $(key+'SigMsg').innerHTML='<span class="text-success">✅ '+T('sig.done')+'</span>';
}
function doApply(){
  // (6) 所有欄位必填檢查＋紅框標示
  var ids=['apNameZh','apNameEn','apCompany','apTitle','apIsHse','apEmail','apPhone','apVessel','apTier','apReason','apPw','apPw2'];
  var missing=false;
  ids.forEach(function(id){
    var el=$(id); var v=(el.value||'').trim();
    el.classList.toggle('is-invalid',!v);
    if(!v) missing=true;
  });
  if(missing){ alertBox('applyAlert','danger',T('apply.allRequired')); return; }
  var p={nameZh:$('apNameZh').value.trim(),nameEn:$('apNameEn').value.trim(),companyName:$('apCompany').value.trim(),
    title:$('apTitle').value.trim(),isHse:$('apIsHse').value==='Y',email:$('apEmail').value.trim(),phone:$('apPhone').value.trim(),
    vessel:$('apVessel').value.trim(),appliedTier:$('apTier').value,applyReason:$('apReason').value.trim(),
    password:$('apPw').value,confirmPassword:$('apPw2').value};
  if(!sigState.ap||!sigState.ap.cleaned){ alertBox('applyAlert','danger',T('sig.required')); $('apSigMsg').innerHTML='<span class="text-danger">'+T('sig.required')+'</span>'; return; }
  p.signatureBase64=sigState.ap.dataUrl.split(',')[1];
  $('btnApply').disabled=true;
  api('auth.applyAccount',p).then(function(res){
    $('btnApply').disabled=false;
    if(res.ok){
      // 申請成功：跳出視窗提示，確認後回到登入頁
      uiAlert((lang==='zh'
        ?'🎉 帳號申請已送出！\\n\\n您的申請已交由系統管理員審核，核准後將寄送 Email 通知您，屆時即可登入使用。'
        :'🎉 Application submitted!\\n\\nYour account application has been sent to the administrator for review. You will receive an email notification once it is approved, and can then log in.'))
        .then(function(){ showPanel('Login'); });
    }else{
      alertBox('applyAlert','danger',apiMsg(res));
    }
  });
}
function doForgot(){
  var email=$('fgEmail').value.trim(); if(!email) return;
  api('auth.forgotPassword',{email:email}).then(function(res){
    alertBox('forgotAlert',res.ok?'success':'danger',res.ok?T('forgot.sent'):apiMsg(res));
  });
}
function doReset(){
  api('auth.resetPassword',{email:$('fgEmail').value.trim(),token:$('rsToken').value.trim(),newPassword:$('rsPw').value})
  .then(function(res){
    alertBox('forgotAlert',res.ok?'success':'danger',res.ok?T('reset.success'):apiMsg(res));
    if(res.ok) showPanel('Login');
  });
}

/* ---------- Admin ---------- */
var companies=[];
function renderAdmin(){
  // 單一合併呼叫載入整個管理主控台（原本 8 次往返 → 1 次）
  api('admin.bootstrap',{}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var d=res.data;
    companies=d.companies||[];
    window._adminUsers=d.users||null;
    loadPending(d.pendingUsers);
    loadProfileReqs(d.profileReqs);
    loadUsers(d.users);
    loadCompanies(d.companies);
    loadAudit(d.audit);
    loadTrainingAdmin(d);
    applyI18n();
  });
}
/* ---- 資料修改申請審核（Admin） ---- */
function loadProfileReqs(pre){
  var handle=function(res){
    if(!res.ok){ $('profileReqList').innerHTML='<div class="text-muted">'+esc(apiMsg(res))+'</div>'; return; }
    $('profileReqCount').textContent=res.data.length||'';
    if(!res.data.length){ $('profileReqList').innerHTML='<div class="text-muted small">'+(lang==='zh'?'目前無待審核申請':'No pending requests')+'</div>'; return; }
    var h='<table class="table table-sm table-hover"><thead><tr><th>User 使用者</th><th>Changes 修改內容（原 → 新）</th><th>Requested 申請時間</th><th></th></tr></thead><tbody>';
    res.data.forEach(function(r){
      var lines=Object.keys(r.changes).map(function(k){
        return '<div><span class="text-muted">'+esc(k)+':</span> '+esc(r.changes[k].from||'—')+' → <b>'+esc(r.changes[k].to)+'</b></div>';
      }).join('');
      h+='<tr><td class="small">'+esc(r.userName)+'<br>'+esc(r.email)+'</td>'+
        '<td class="small">'+lines+'</td><td class="small">'+esc(r.createdAt)+'</td>'+
        '<td class="text-nowrap"><button class="btn btn-sm btn-success me-1" onclick="approveProfileReq(\\''+r.id+'\\')">'+T('admin.approve')+'</button>'+
        '<button class="btn btn-sm btn-outline-danger" onclick="rejectProfileReq(\\''+r.id+'\\')">'+T('admin.rejectBtn')+'</button></td></tr>';
    });
    $('profileReqList').innerHTML=h+'</tbody></table>';
  };
  if(pre){ handle({ok:true,data:pre}); return; }
  api('admin.profileReq.list',{}).then(handle);
}
function approveProfileReq(id){
  api('admin.profileReq.approve',{requestId:id}).then(function(res){
    if(res.ok){ toast((lang==='zh'?'已核准並生效':'Approved & applied'),true); loadProfileReqs(); loadUsers(); } else toast(apiMsg(res));
  });
}
function rejectProfileReq(id){
  uiPrompt(T('admin.rejectReason')).then(function(reason){ if(!reason) return;
  api('admin.profileReq.reject',{requestId:id,reason:reason}).then(function(res){
    if(res.ok){ toast((lang==='zh'?'已拒絕':'Rejected'),true); loadProfileReqs(); } else toast(apiMsg(res));
  });});
}
/* ---------- Admin：訓練管理 ---------- */
function loadTrainingAdmin(boot){
  var fillForm=function(c,sfx){
    $('tcTitle'+sfx).value=c?(c.title||''):'';
    $('tcVideo'+sfx).value=c&&c.videos&&c.videos.length
      ?c.videos.map(function(v){ return v.id+(v.title?' | '+v.title:''); }).join('\\n'):'';
    $('tcVersion'+sfx).value=c?(c.courseVersion||'v1'):'v1';
  };
  api('admin.training.courses',{}).then(function(res){
    if(!res.ok) return;
    fillForm(res.data.zh,''); fillForm(res.data.en,'En');
  });
  var handleQ=function(res){
    if(!res.ok){ $('qbankList').innerHTML='<div class="text-muted">'+esc(apiMsg(res))+'</div>'; return; }
    qbankCache=res.data;
    var h='<table class="table table-sm table-hover"><thead><tr>'+
      '<th class="text-center"><input type="checkbox" id="qbAll" class="form-check-input" onclick="qbToggleAll(this)" title="'+(lang==='zh'?'全選（批次刪除用）':'Select all (for bulk delete)')+'"><br><span style="font-weight:400">🗑</span></th>'+
      '<th class="text-center" style="color:#b02a37">⭐<br>'+(lang==='zh'?'必考':'Must')+'</th>'+
      '<th>#</th><th>Type</th><th>Question</th><th>Pts</th><th>Cat.</th><th>Active</th><th></th></tr></thead><tbody>';
    res.data.forEach(function(q,i){
      h+='<tr class="'+(asB(q.isActive)?'':'table-secondary')+'">'+
        '<td class="text-center"><input type="checkbox" class="qbChk form-check-input" value="'+esc(q.id)+'" title="'+(lang==='zh'?'勾選後可批次刪除':'Select for bulk delete')+'"></td>'+
        '<td class="text-center"><input type="checkbox" class="form-check-input"'+(asB(q.mustInclude)?' checked':'')+
        ' onchange="toggleMust(\\''+esc(q.id)+'\\',this)" style="accent-color:#b02a37;border-color:#b02a37"'+
        ' title="'+(lang==='zh'?'必考（出題必定納入）':'Must-include in every exam')+'"></td>'+
        '<td>'+(i+1)+'</td><td>'+esc(q.type)+(asB(q.mustInclude)?'<br><span class="badge bg-danger">⭐</span>':'')+'</td>'+
        '<td class="small">'+esc(q.questionZh)+'<br><span class="text-muted">'+esc(q.questionEn)+'</span></td>'+
        '<td>'+esc(q.points)+'</td><td>'+esc(q.category)+'</td>'+
        '<td>'+(asB(q.isActive)?'✅':'—')+'</td>'+
        '<td class="text-nowrap"><button class="btn btn-sm btn-outline-primary me-1" onclick="editQuestion(\\''+q.id+'\\')">✏️ Edit</button>'+
        (asB(q.isActive)?'<button class="btn btn-sm btn-outline-secondary" onclick="disableQuestion(\\''+q.id+'\\')">'+T('admin.disable')+'</button>':'')+'</td></tr>';
    });
    $('qbankList').innerHTML=h+'</tbody></table>';
  };
  if(boot&&boot.questions){ handleQ({ok:true,data:boot.questions}); }
  else api('admin.question.list',{}).then(handleQ);
  var handleR=function(res){
    if(!res.ok){ $('examRecords').innerHTML='<div class="text-muted">'+esc(apiMsg(res))+'</div>'; return; }
    var h='<table class="table table-sm"><thead><tr><th>User</th><th>#</th><th>Start</th><th>Submit</th><th>Score</th><th>Result</th><th>Locked Until</th><th></th></tr></thead><tbody>';
    res.data.attempts.forEach(function(a){
      h+='<tr><td class="small">'+esc(a.userName)+'<br>'+esc(a.email)+'</td><td>'+esc(a.attemptNo)+'</td>'+
        '<td class="small">'+esc(a.startAt)+'</td><td class="small">'+esc(a.submitAt||'—')+'</td>'+
        '<td>'+esc(a.score===''?'—':a.score)+'</td>'+
        '<td>'+(a.submitAt?(a.passed?'<span class="badge bg-success">PASS</span>':'<span class="badge bg-danger">FAIL</span>'):'<span class="badge bg-secondary">…</span>')+'</td>'+
        '<td class="small">'+esc(a.lockedUntilDate||'—')+'</td>'+
        '<td>'+(a.lockedUntilDate&&!a.passed?'<button class="btn btn-sm btn-warning" onclick="reopenExam(\\''+a.userId+'\\')">'+T('trAdmin.reopen')+'</button>':'')+'</td></tr>';
    });
    $('examRecords').innerHTML=h+'</tbody></table>';
  };
  if(boot&&boot.records){ handleR({ok:true,data:boot.records}); }
  else api('admin.training.records',{}).then(handleR);
}
function asB(v){ return v===true||v==='TRUE'||v==='true'; }
/** 雙語顯示：英文 / 中文；兩者相同或其一為空時只顯示一次（避免「Alpha / Alpha」） */
function bi(en,zh){
  en=String(en==null?'':en).trim(); zh=String(zh==null?'':zh).trim();
  if(!en) return zh;
  if(!zh||zh===en) return en;
  return en+' / '+zh;
}
function saveCourse(lc){
  var sfx=(lc==='en')?'En':'';
  var vids=$('tcVideo'+sfx).value.split('\\n').map(function(l){
    var p2=l.split('|'); return {id:p2[0].trim(),title:(p2[1]||'').trim()};
  }).filter(function(v){ return v.id; });
  api('admin.training.setCourse',{title:$('tcTitle'+sfx).value.trim(),videos:vids,
    courseVersion:$('tcVersion'+sfx).value.trim()||'v1',langCode:lc||'zh'})
  .then(function(res){ toast(res.ok?((lc==='en'?'EN ':'中文 ')+'Course saved 已儲存'):apiMsg(res),res.ok); });
}
/* 批次設定/取消必考（用同一組勾選框） */
function setMustSelected(on){
  var ids=[];
  document.querySelectorAll('.qbChk:checked').forEach(function(c){ ids.push(c.value); });
  var Z=(lang==='zh');
  if(!ids.length){ toast(Z?'⚠️ 請先勾選題目':'⚠️ Please select questions first'); return; }
  api('admin.question.setMustMany',{ids:ids,mustInclude:on}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    toast((on?'⭐ ':'☆ ')+(Z?((on?'已設為必考 ':'已取消必考 ')+res.data.updated+' 題')
                          :(res.data.updated+' question(s) '+(on?'set as':'removed from')+' must-include')),true);
    loadTrainingAdmin();
  });
}
function toggleMust(id,el){
  var on=el.checked; el.disabled=true;
  api('admin.question.setMust',{id:id,mustInclude:on}).then(function(res){
    el.disabled=false;
    if(!res.ok){ el.checked=!on; toast(apiMsg(res)); return; }
    var q=(qbankCache||[]).filter(function(x){ return x.id===id; })[0];
    if(q) q.mustInclude=on;
    toast((on?'⭐ ':'')+(lang==='zh'?('必考已'+(on?'開啟':'取消')):('Must-include '+(on?'ON':'OFF'))),true);
  });
}
function qbToggleAll(el){
  document.querySelectorAll('.qbChk').forEach(function(c){ c.checked=el.checked; });
}
function deleteSelectedQuestions(){
  var ids=[];
  document.querySelectorAll('.qbChk:checked').forEach(function(c){ ids.push(c.value); });
  var Z=(lang==='zh');
  if(!ids.length){ toast(Z?'⚠️ 請先勾選要刪除的題目':'⚠️ Please select questions to delete'); return; }
  uiConfirm(Z?('⚠️ 確定永久刪除選取的 '+ids.length+' 題？此操作無法復原（歷史考卷不受影響）。')
             :('⚠️ Permanently delete the '+ids.length+' selected question(s)? This cannot be undone (past exams are not affected).'))
  .then(function(ok){
    if(!ok) return;
    api('admin.question.deleteMany',{ids:ids}).then(function(res){
      if(!res.ok){ toast(apiMsg(res)); return; }
      toast('🗑 '+(Z?('已刪除 '+res.data.deleted+' 題'):(res.data.deleted+' question(s) deleted')),true);
      loadTrainingAdmin();
    });
  });
}
function disableQuestion(id){
  api('admin.question.disable',{id:id}).then(function(res){ if(res.ok){ toast('OK',true); loadTrainingAdmin(); } else toast(apiMsg(res)); });
}

/* ===== 題目編輯器（介面直接新增/編輯，不碰 JSON） ===== */
var qbankCache=[];
function openQEditor(q){
  $('qEditor').classList.remove('d-none');
  $('qeId').value=q?q.id:'';
  $('qeType').value=q?q.type:'MC';
  $('qePoints').value=q?(q.points||10):10;
  $('qeCategory').value=q?(q.category||''):'';
  $('qeDifficulty').value=q?(q.difficulty||'Normal'):'Normal';
  $('qeMust').checked=q?asB(q.mustInclude):false;
  $('qeZh').value=q?q.questionZh:'';
  $('qeEn').value=q?q.questionEn:'';
  renderQeTypeArea(q);
  $('qEditor').scrollIntoView({behavior:'smooth'});
}
function renderQeTypeArea(q){
  var type=$('qeType').value, h='';
  if(type==='MC'){
    var opts=['','','',''], correct='';
    if(q&&q.type==='MC'){
      try{ opts=JSON.parse(q.optionsJson); var a=JSON.parse(q.answerJson); correct=(a.correct!==undefined?a.correct:a); }catch(e){}
    }
    h+='<label class="form-label small mb-1">選項 Options（勾選正確答案 ✔ = correct answer）</label><div id="qeOpts">';
    opts.forEach(function(o,i){ h+=qeOptRow(i,o,o===correct&&o!==''); });
    h+='</div><button class="btn btn-sm btn-outline-primary mt-1" onclick="addQeOpt()">＋ 選項 Option</button>';
  }else{
    var pairs=[['',''],['',''],['','']];
    if(q&&q.type==='Match'){
      try{ var op=JSON.parse(q.optionsJson), an=JSON.parse(q.answerJson);
        pairs=op.left.map(function(l){ return [l,an[l]||'']; }); }catch(e){}
    }
    h+='<label class="form-label small mb-1">配對組 Pairs（左項 Left ↔ 正確右項 Right）</label><div id="qePairs">';
    pairs.forEach(function(p,i){ h+=qePairRow(i,p[0],p[1]); });
    h+='</div><button class="btn btn-sm btn-outline-primary mt-1" onclick="addQePair()">＋ 配對 Pair</button>';
  }
  $('qeTypeArea').innerHTML=h;
}
function qeOptRow(i,val,isCorrect){
  return '<div class="input-group input-group-sm mb-1 qeOptRow">'+
    '<span class="input-group-text"><input type="radio" name="qeCorrect" value="'+i+'"'+(isCorrect?' checked':'')+' title="正確答案 Correct"></span>'+
    '<input class="form-control qeOptText" value="'+esc(val)+'" placeholder="選項文字 Option text">'+
    '<button class="btn btn-outline-danger" onclick="this.closest(\\'.qeOptRow\\').remove()">✕</button></div>';
}
function addQeOpt(){ var d=document.createElement('div'); d.innerHTML=qeOptRow(99,'',false); $('qeOpts').appendChild(d.firstChild); }
function qePairRow(i,l,r){
  return '<div class="row g-1 mb-1 qePairRow"><div class="col-5"><input class="form-control form-control-sm qePairL" value="'+esc(l)+'" placeholder="左項 Left"></div>'+
    '<div class="col-1 text-center">↔</div>'+
    '<div class="col-5"><input class="form-control form-control-sm qePairR" value="'+esc(r)+'" placeholder="右項 Right（正確配對）"></div>'+
    '<div class="col-1"><button class="btn btn-sm btn-outline-danger" onclick="this.closest(\\'.qePairRow\\').remove()">✕</button></div></div>';
}
function addQePair(){ var d=document.createElement('div'); d.innerHTML=qePairRow(99,'',''); $('qePairs').appendChild(d.firstChild); }
function saveQEditor(){
  var type=$('qeType').value, payload={
    id:$('qeId').value||undefined, type:type,
    questionZh:$('qeZh').value.trim(), questionEn:$('qeEn').value.trim(),
    points:Number($('qePoints').value)||10, category:$('qeCategory').value.trim(), difficulty:$('qeDifficulty').value,
    mustInclude:$('qeMust').checked
  };
  if(!payload.questionZh||!payload.questionEn){ toast('請填中英文題目 Fill both ZH & EN question'); return; }
  if(type==='MC'){
    var texts=[], correct='';
    var rows=document.querySelectorAll('.qeOptRow');
    rows.forEach(function(row){
      var t=row.querySelector('.qeOptText').value.trim();
      if(!t) return;
      texts.push(t);
      if(row.querySelector('input[type=radio]').checked) correct=t;
    });
    if(texts.length<2){ toast('至少 2 個選項 At least 2 options'); return; }
    if(!correct){ toast('請勾選正確答案 Select the correct answer'); return; }
    payload.optionsJson=JSON.stringify(texts);
    payload.answerJson=JSON.stringify({correct:correct});
  }else{
    var left=[], right=[], map={};
    document.querySelectorAll('.qePairRow').forEach(function(row){
      var l=row.querySelector('.qePairL').value.trim(), r=row.querySelector('.qePairR').value.trim();
      if(l&&r){ left.push(l); right.push(r); map[l]=r; }
    });
    if(left.length<2){ toast('至少 2 組配對 At least 2 pairs'); return; }
    payload.optionsJson=JSON.stringify({left:left,right:right});
    payload.answerJson=JSON.stringify(map);
  }
  api('admin.question.save',payload).then(function(res){
    if(res.ok){ toast('Question saved 題目已儲存',true); $('qEditor').classList.add('d-none'); loadTrainingAdmin(); }
    else toast(apiMsg(res));
  });
}
function editQuestion(id){
  var q=qbankCache.filter(function(x){ return x.id===id; })[0];
  if(q) openQEditor(q);
}

/* ===== Excel 匯入/匯出/範本（SheetJS） ===== */
var QX_HEADERS=['題型Type','中文題目QuestionZh','英文題目QuestionEn',
 '選項A OptionA','選項B OptionB','選項C OptionC','選項D OptionD','選項E OptionE','選項F OptionF',
 '正確答案Correct(A-F)','左1 Left1','右1 Right1','左2 Left2','右2 Right2','左3 Left3','右3 Right3','左4 Left4','右4 Right4',
 '配分Points','分類Category','難度Difficulty','必考MustInclude(Y/N)'];
function exportQuestionsXlsx(){
  var rows=[QX_HEADERS];
  qbankCache.filter(function(q){ return asB(q.isActive); }).forEach(function(q){
    var r=new Array(QX_HEADERS.length).fill('');
    r[0]=q.type; r[1]=q.questionZh; r[2]=q.questionEn;
    try{
      if(q.type==='MC'){
        var opts=JSON.parse(q.optionsJson), a=JSON.parse(q.answerJson);
        var correct=(a.correct!==undefined?a.correct:a);
        opts.slice(0,6).forEach(function(o,i){ r[3+i]=o; if(o===correct) r[9]=String.fromCharCode(65+i); });
      }else{
        var op=JSON.parse(q.optionsJson), an=JSON.parse(q.answerJson);
        op.left.slice(0,4).forEach(function(l,i){ r[10+i*2]=l; r[11+i*2]=an[l]||''; });
      }
    }catch(e){}
    r[18]=q.points; r[19]=q.category; r[20]=q.difficulty; r[21]=asB(q.mustInclude)?'Y':'';
    rows.push(r);
  });
  var ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=QX_HEADERS.map(function(h,i){ return {wch:i===1||i===2?40:(i>=3&&i<=8?22:14)}; });
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'QuestionBank');
  XLSX.writeFile(wb,'question_bank_'+new Date().toISOString().substring(0,10)+'.xlsx');
}
function downloadQTemplate(){
  var rows=[QX_HEADERS,
   ['MC','進行動火作業前必須完成什麼？','What must be completed before hot work?','氣體測試 Gas test','午餐 Lunch','洗車 Car wash','','','','A','','','','','','','','',10,'HotWork','Normal','Y'],
   ['Match','請將危害與控制措施配對','Match hazards with controls','','','','','','','','噪音 Noise','聽力保護 Hearing protection','高處 Height','安全帶 Harness','火花 Sparks','防火毯 Fire blanket','','',10,'PPE','Normal','']];
  var ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=QX_HEADERS.map(function(h,i){ return {wch:i===1||i===2?40:(i>=3&&i<=8?22:14)}; });
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'QuestionBank');
  XLSX.writeFile(wb,'question_bank_template.xlsx');
}
function importQuestionsXlsx(input){
  var file=input.files[0]; if(!file) return;
  var reader=new FileReader();
  reader.onload=function(e){
    input.value='';
    try{
      var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
      var rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
      if(rows.length<2){ toast('No data rows 無資料列'); return; }
      var questions=[], errors=[];
      rows.slice(1).forEach(function(r,idx){
        var line=idx+2;
        var type=String(r[0]||'').trim();
        if(!type) return; // 空列跳過
        if(type!=='MC'&&type!=='Match'){ errors.push('Row'+line+': 題型須為 MC 或 Match'); return; }
        var zh=String(r[1]||'').trim(), en=String(r[2]||'').trim();
        if(!zh||!en){ errors.push('Row'+line+': 缺中/英文題目'); return; }
        var q={type:type,questionZh:zh,questionEn:en,
          points:Number(r[18])||10,category:String(r[19]||''),difficulty:String(r[20]||'Normal'),
          mustInclude:/^y|true|1|是$/i.test(String(r[21]||'').trim())};
        if(type==='MC'){
          var opts=[]; for(var i=3;i<=8;i++){ var o=String(r[i]||'').trim(); if(o) opts.push(o); }
          var letter=String(r[9]||'').trim().toUpperCase();
          var ci=letter.charCodeAt(0)-65;
          if(opts.length<2){ errors.push('Row'+line+': 選項至少 2 個'); return; }
          if(!(ci>=0&&ci<opts.length)){ errors.push('Row'+line+': 正確答案須為 A-'+String.fromCharCode(64+opts.length)); return; }
          q.optionsJson=JSON.stringify(opts);
          q.answerJson=JSON.stringify({correct:opts[ci]});
        }else{
          var left=[],right=[],map={};
          for(var j=0;j<4;j++){
            var l=String(r[10+j*2]||'').trim(), rr=String(r[11+j*2]||'').trim();
            if(l&&rr){ left.push(l); right.push(rr); map[l]=rr; }
          }
          if(left.length<2){ errors.push('Row'+line+': 配對至少 2 組'); return; }
          q.optionsJson=JSON.stringify({left:left,right:right});
          q.answerJson=JSON.stringify(map);
        }
        questions.push(q);
      });
      if(!questions.length){ toast('No valid rows 無有效資料'+(errors.length?'：'+errors[0]:'')); return; }
      api('admin.question.import',{questions:questions}).then(function(res){
        if(!res.ok){ toast(apiMsg(res)); return; }
        var msg='Imported 匯入 '+res.data.imported+' 題';
        var allErr=errors.concat(res.data.errors||[]);
        if(allErr.length) msg+='；問題列 Issues: '+allErr.slice(0,5).join('; ')+(allErr.length>5?'…':'');
        toast(msg,true);
        loadTrainingAdmin();
      });
    }catch(err){ toast('Excel 讀取失敗 Read failed: '+err.message); }
  };
  reader.readAsArrayBuffer(file);
}
function reopenExam(userId){
  api('admin.training.reopen',{userId:userId}).then(function(res){
    toast(res.ok?('Reopened（cleared '+res.data.cleared+'）'):apiMsg(res),res.ok);
    if(res.ok) loadTrainingAdmin();
  });
}
function exportExamRecords(){
  api('admin.training.records',{}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var wb=XLSX.utils.book_new();
    var r1=[['User','Email','Attempt#','Start','Submit','Score','Passed','LockedUntil']];
    res.data.attempts.forEach(function(a){ r1.push([a.userName,a.email,a.attemptNo,a.startAt,a.submitAt,a.score,a.passed?'PASS':'FAIL',a.lockedUntilDate]); });
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(r1),'ExamRecords');
    var r2=[['User','Email','TrainingValidUntil','Status']];
    res.data.expiry.forEach(function(e){ r2.push([e.name,e.email,e.trainingValidUntil,e.status]); });
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(r2),'TrainingExpiry');
    XLSX.writeFile(wb,'training_records_'+new Date().toISOString().substring(0,10)+'.xlsx');
  });
}

/* ===== (6) 下載專區管理（Admin） ===== */
function loadAdminDownloads(){
  loadAdminAnnounces();
  api('downloads.list',{}).then(function(res){
    if(!res.ok){ $('adminDlList').innerHTML='<div class="text-muted small">'+esc(apiMsg(res))+'</div>'; return; }
    if(!res.data.length){ $('adminDlList').innerHTML='<div class="text-muted small">'+T('dl.none')+'</div>'; return; }
    var h='<table class="table table-sm table-hover"><thead><tr><th>Title</th><th>File</th><th>Uploaded</th><th></th></tr></thead><tbody>';
    res.data.forEach(function(d){
      h+='<tr><td><b>'+esc(d.titleZh||d.title)+'</b><br><small>'+esc(d.titleEn||'')+'</small>'+(d.description?'<br><small class="text-muted">'+esc(d.description)+'</small>':'')+'</td>'+
        '<td><a href="'+esc(d.fileUrl)+'" target="_blank" rel="noopener">'+esc(d.fileName)+'</a></td>'+
        '<td class="small">'+esc(d.uploadedAt)+'</td>'+
        '<td><button class="btn btn-sm btn-outline-danger" onclick="adminRemoveDownload(\\''+d.id+'\\')">✕</button></td></tr>';
    });
    $('adminDlList').innerHTML=h+'</tbody></table>';
  });
}
/* ===== 系統公告（首頁頂部） ===== */
function adminAddAnnounce(){
  var z=$('annZh').value.trim(), e=$('annEn').value.trim();
  if(!z||!e){ toast(lang==='zh'?'中文與英文公告內容皆必填':'Both Chinese and English texts are required'); return; }
  api('admin.announce.add',{textZh:z,textEn:e,level:$('annLevel').value}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    $('annZh').value='';$('annEn').value='';
    toast(lang==='zh'?'公告已發布':'Published',true);
    loadAdminAnnounces();
  });
}
function loadAdminAnnounces(){
  api('announce.list',{}).then(function(res){
    if(!res.ok){ return; }
    if(!res.data.length){ $('adminAnnList').innerHTML='<div class="text-muted small">'+(lang==='zh'?'（目前無公告）':'(No announcements)')+'</div>'; return; }
    var lv={info:'ℹ️',warning:'⚠️',danger:'🚨'};
    var h='<table class="table table-sm"><tbody>';
    res.data.forEach(function(a){
      h+='<tr><td style="width:30px">'+(lv[a.level]||'ℹ️')+'</td>'+
        '<td><b>'+esc(a.textZh)+'</b><br><small class="text-muted">'+esc(a.textEn)+'</small></td>'+
        '<td class="small text-nowrap">'+esc(String(a.createdAt||'').substring(0,10))+'</td>'+
        '<td><button class="btn btn-sm btn-outline-danger" onclick="removeAnnounce(\\''+a.id+'\\')">✕</button></td></tr>';
    });
    $('adminAnnList').innerHTML=h+'</tbody></table>';
  });
}
function removeAnnounce(id){
  uiConfirm(lang==='zh'?'下架此公告？':'Remove this announcement?').then(function(ok){ if(!ok) return;
    api('admin.announce.disable',{id:id}).then(function(res){
      if(res.ok){ toast('OK',true); loadAdminAnnounces(); loadPublicAnnounces(); } else toast(apiMsg(res));
    });
  });
}
/* 首頁公告欄（常駐顯示；登入前後皆可見） */
function renderAnnouncements(rows){
  var w=$('annWrap'),Z=(lang==='zh');
  var style={info:['rgba(49,195,240,.14)','rgba(49,195,240,.5)','#bfe8ff','ℹ️'],
             warning:['rgba(240,197,109,.16)','rgba(240,197,109,.55)','#ffe1a3','⚠️'],
             danger:['rgba(255,120,120,.16)','rgba(255,120,120,.55)','#ffc4c4','🚨']};
  var items='';
  if(rows&&rows.length){
    rows.forEach(function(a){
      var st=style[a.level]||style.info;
      items+='<div style="background:'+st[0]+';border:1px solid '+st[1]+';color:'+st[2]+';border-radius:10px;'+
        'padding:7px 12px;margin-bottom:6px;display:flex;gap:9px;align-items:flex-start">'+
        '<span>'+st[3]+'</span>'+
        '<div><b>'+esc(Z?a.textZh:a.textEn)+'</b>'+
        '<span class="small ms-2" style="opacity:.6">'+esc(String(a.createdAt||'').substring(0,10))+'</span></div></div>';
    });
  }else{
    items='<div class="small" style="opacity:.6">'+(Z?'（目前無公告 — 一切正常，安全作業！）':'(No announcements — all clear, work safe!)')+'</div>';
  }
  w.innerHTML='<div class="annBoard">'+
    '<div class="annHead">📢 '+(Z?'系統公告 Announcements':'System Announcements')+
    '<span class="annLive">LIVE</span></div>'+items+'</div>';
  w.classList.remove('d-none');
}
function loadPublicAnnounces(){
  api('announce.list',{}).then(function(res){ if(res.ok) renderAnnouncements(res.data); });
}
function adminUploadDownload(){
  var f=$('dlFile').files[0], tz=$('dlTitleZh').value.trim(), te=$('dlTitleEn').value.trim();
  if(!tz||!te||!f){ toast(lang==='zh'?'請填中文與英文名稱並選擇檔案':'Chinese & English titles and a file are required'); return; }
  if(f.size>15*1024*1024){ toast('Max 15 MB'); return; }
  var btn=$('btnDlUpload'); btn.disabled=true; btn.textContent='⏳';
  var reader=new FileReader();
  reader.onload=function(e){
    api('admin.download.upload',{titleZh:tz,titleEn:te,description:$('dlDesc').value.trim(),
      fileName:f.name,mimeType:f.type||'application/octet-stream',
      base64:String(e.target.result).split(',')[1]}).then(function(res){
      btn.disabled=false; btn.textContent='⬆︎ Upload';
      if(!res.ok){ toast(apiMsg(res)); return; }
      $('dlTitleZh').value='';$('dlTitleEn').value='';$('dlDesc').value='';$('dlFile').value='';
      toast(lang==='zh'?'已上傳，首頁下載區已更新':'Uploaded',true);
      loadAdminDownloads();
    });
  };
  reader.readAsDataURL(f);
}
function adminRemoveDownload(id){
  uiConfirm(lang==='zh'?'移除此下載文件？':'Remove this document?').then(function(ok){ if(!ok) return;
  api('admin.download.disable',{id:id}).then(function(res){
    if(res.ok){ toast('OK',true); loadAdminDownloads(); } else toast(apiMsg(res));
  });});
}

/* ===== 報表（Reports 分頁，T5/Admin） ===== */
var reportCache={};
function loadReports(){
  api('report.overdue',{}).then(function(res){
    if(!res.ok){ $('rpOverdue').innerHTML='<div class="small text-muted">'+esc(apiMsg(res))+'</div>'; return; }
    reportCache.overdue=res.data;
    var h='<table class="table table-sm"><thead><tr><th>No.</th><th>Company</th><th>Location</th><th>Status</th><th>Valid To</th><th>Days</th></tr></thead><tbody>';
    res.data.forEach(function(r){ h+='<tr><td>'+esc(r.number)+'</td><td class="small">'+esc(r.company)+'</td><td class="small">'+esc(r.areaLocation)+'</td><td>'+statusBadge(r.status)+'</td><td class="small">'+esc(r.validTo)+'</td><td class="text-danger fw-bold">'+esc(r.daysOverdue)+'</td></tr>'; });
    $('rpOverdue').innerHTML=res.data.length?h+'</tbody></table>':'<div class="small text-muted">無逾期 None 🎉</div>';
  });
  api('report.byCompany',{}).then(function(res){
    if(!res.ok) return; reportCache.byCompany=res.data;
    var h='<table class="table table-sm"><thead><tr><th>Company</th><th>Total</th><th>Detail</th></tr></thead><tbody>';
    res.data.forEach(function(r){
      var d=Object.keys(r.byStatus).map(function(s){ return s+': '+r.byStatus[s]; }).join(', ');
      h+='<tr><td class="small">'+esc(r.company)+'</td><td><b>'+r.total+'</b></td><td class="small">'+esc(d)+'</td></tr>'; });
    $('rpCompany').innerHTML=h+'</tbody></table>';
  });
  api('report.byType',{}).then(function(res){
    if(!res.ok) return; reportCache.byType=res.data;
    var h='<table class="table table-sm"><thead><tr><th>Work Type</th><th>Count</th></tr></thead><tbody>';
    res.data.forEach(function(r){ h+='<tr><td>'+esc(r.type)+'</td><td><b>'+r.count+'</b></td></tr>'; });
    $('rpType').innerHTML=h+'</tbody></table>';
  });
  api('report.monthly',{}).then(function(res){
    if(!res.ok) return; reportCache.monthly=res.data;
    var h='<table class="table table-sm"><thead><tr><th>Month</th><th>Created</th><th>Approved</th><th>Closed</th></tr></thead><tbody>';
    res.data.forEach(function(r){ h+='<tr><td>'+esc(r.month)+'</td><td>'+r.created+'</td><td>'+r.approved+'</td><td>'+r.closed+'</td></tr>'; });
    $('rpMonthly').innerHTML=h+'</tbody></table>';
  });
  loadDelegations();
}
function exportReport(kind){
  var data=reportCache[kind];
  if(!data){ toast('Load first 請先載入'); return; }
  var rows;
  if(kind==='overdue') rows=[['No.','Company','Location','Status','ValidTo','DaysOverdue']].concat(data.map(function(r){ return [r.number,r.company,r.areaLocation,r.status,r.validTo,r.daysOverdue]; }));
  else if(kind==='byCompany') rows=[['Company','Total','Detail']].concat(data.map(function(r){ return [r.company,r.total,Object.keys(r.byStatus).map(function(s){return s+':'+r.byStatus[s];}).join(', ')]; }));
  else if(kind==='byType') rows=[['WorkType','Count']].concat(data.map(function(r){ return [r.type,r.count]; }));
  else rows=[['Month','Created','Approved','Closed']].concat(data.map(function(r){ return [r.month,r.created,r.approved,r.closed]; }));
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),kind);
  XLSX.writeFile(wb,'report_'+kind+'_'+new Date().toISOString().substring(0,10)+'.xlsx');
}
function exportApprovals(){
  api('report.approvalsExport',{}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var rows=[['PTW No.','Version','Tier','Action','Reviewer','Comment','ReturnReason','Decided At']]
      .concat(res.data.map(function(a){ return [a.number,a.version,a.tier,a.action,a.reviewer,a.comment,a.returnReason,a.decidedAt]; }));
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Approvals');
    XLSX.writeFile(wb,'approval_history_'+new Date().toISOString().substring(0,10)+'.xlsx');
  });
}
/* 代理簽核 */
function loadDelegations(){
  api('user.list',{}).then(function(res){
    if(!res.ok) return;
    var opts='<option value="">--</option>'+res.data.filter(function(u){ return u.status==='Active'; })
      .map(function(u){ return '<option value="'+esc(u.id)+'">'+esc(u.nameEn)+' / '+esc(u.nameZh)+'（T'+esc(u.tier)+'）</option>'; }).join('');
    $('dgFrom').innerHTML=opts; $('dgTo').innerHTML=opts;
  });
  api('admin.delegation.list',{}).then(function(res){
    if(!res.ok){ $('dgList').innerHTML='<div class="small text-muted">'+esc(apiMsg(res))+'</div>'; return; }
    if(!res.data.length){ $('dgList').innerHTML='<div class="small text-muted">No delegations 無代理設定</div>'; return; }
    var h='<table class="table table-sm"><thead><tr><th>Delegator 被代理</th><th>Delegate 代理人</th><th>Tier</th><th>From</th><th>To</th><th></th></tr></thead><tbody>';
    res.data.forEach(function(d){
      h+='<tr><td class="small">'+esc(d.delegator)+'</td><td class="small">'+esc(d.delegate)+'</td><td>T'+esc(d.tier)+'</td>'+
        '<td class="small">'+esc(d.validFrom)+'</td><td class="small">'+esc(d.validTo)+'</td>'+
        '<td><button class="btn btn-sm btn-outline-danger" onclick="disableDelegation(\\''+d.id+'\\')">✕</button></td></tr>';
    });
    $('dgList').innerHTML=h+'</tbody></table>';
  });
}
function addDelegation(){
  var p={delegatorUserId:$('dgFrom').value,delegateUserId:$('dgTo').value,tier:$('dgTier').value,
    validFrom:$('dgStart').value?$('dgStart').value+' 00:00:00':'',validTo:$('dgEnd').value?$('dgEnd').value+' 23:59:59':''};
  if(!p.delegatorUserId||!p.delegateUserId||!p.validFrom||!p.validTo){ toast('請填齊代理設定 Fill all fields'); return; }
  api('user.setDelegation',p).then(function(res){
    if(res.ok){ toast('Delegation set 代理已設定',true); loadDelegations(); } else toast(apiMsg(res));
  });
}
function disableDelegation(id){
  api('admin.delegation.disable',{delegationId:id}).then(function(res){
    if(res.ok){ toast('OK',true); loadDelegations(); } else toast(apiMsg(res));
  });
}
function companyName(id){
  var c=companies.filter(function(x){return x.id===id;})[0];
  if(c) return lang==='zh'?c.nameZh:c.nameEn;
  return String(id||'').indexOf('PENDING:')===0?id.substring(8)+' (new)':(id||'—');
}
function companyOptions(){
  return companies.filter(function(c){return c.isActive;}).map(function(c){
    return '<option value="'+esc(c.id)+'">'+esc(c.nameEn)+' / '+esc(c.nameZh)+'</option>'; }).join('');
}
function loadPending(pre){
  var handle=function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var rows=res.data; $('pendingCount').textContent=rows.length||'';
    if(!rows.length){ $('pendingList').innerHTML='<div class="text-muted p-3">'+(lang==='zh'?'目前無待審核申請':'No pending applications')+'</div>'; return; }
    var h='<table class="table table-sm table-hover"><thead><tr><th>'+T('admin.email')+'</th><th>'+T('admin.name')+'</th><th>Company</th><th>Tier</th><th>Vessel</th><th>Reason</th><th>'+T('admin.assignCompany')+'</th><th>'+T('admin.assignTier')+'</th><th></th></tr></thead><tbody>';
    rows.forEach(function(r){
      h+='<tr><td>'+esc(r.email)+'</td><td>'+esc(r.nameEn)+'<br><small>'+esc(r.nameZh)+'</small></td>'+
        '<td>'+esc(companyName(r.companyId))+'</td><td>'+esc(r.appliedTier)+'</td><td>'+esc(r.vessel)+'</td>'+
        '<td class="small">'+esc(r.applyReason)+'</td>'+
        '<td><select id="apc_'+r.id+'" class="form-select form-select-sm">'+companyOptions()+'</select></td>'+
        '<td><select id="apt_'+r.id+'" class="form-select form-select-sm">'+[1,2,3,4,5].map(function(t){
          return '<option value="'+t+'"'+(String(t)===String(r.appliedTier)?' selected':'')+'>'+t+'</option>';}).join('')+'</select></td>'+
        '<td class="text-nowrap"><button class="btn btn-sm btn-success me-1" onclick="approveUser(\\''+r.id+'\\')">'+T('admin.approve')+'</button>'+
        '<button class="btn btn-sm btn-outline-danger" onclick="rejectUser(\\''+r.id+'\\')">'+T('admin.rejectBtn')+'</button></td></tr>';
    });
    $('pendingList').innerHTML=h+'</tbody></table>';
  };
  if(pre){ handle({ok:true,data:pre}); return; }
  api('user.list',{status:'PendingApproval'}).then(handle);
}
function approveUser(id){
  var companyId=$('apc_'+id).value,tier=$('apt_'+id).value;
  if(!companyId){ toast('Select a company 請指定公司'); return; }
  api('user.approve',{userId:id,companyId:companyId,tier:tier}).then(function(res){
    if(res.ok){ toast((lang==='zh'?'已核准':'Approved'),true); loadPending(); loadUsers(); } else toast(apiMsg(res));
  });
}
function rejectUser(id){
  uiPrompt(T('admin.rejectReason')).then(function(reason){ if(!reason) return;
  api('user.reject',{userId:id,reason:reason}).then(function(res){
    if(res.ok){ toast((lang==='zh'?'已拒絕':'Rejected'),true); loadPending(); } else toast(apiMsg(res));
  });});
}
function fillUserFilterCompanies(){
  var sel=$('ufCompany'); if(!sel||sel.options.length>1) return;
  var h='<option value="">'+(lang==='zh'?'公司（全部）':'Company (All)')+'</option>';
  (companies||[]).forEach(function(c){ h+='<option value="'+esc(c.id)+'">'+esc(lang==='zh'?(c.nameZh||c.nameEn):(c.nameEn||c.nameZh))+'</option>'; });
  sel.innerHTML=h;
}
function loadUsers(pre){
  fillUserFilterCompanies();
  var handle=function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    // (1) 前端篩選：公司 / Tier / 狀態
    var fc=$('ufCompany')?$('ufCompany').value:'', ft=$('ufTier')?$('ufTier').value:'', fs=$('ufStatus')?$('ufStatus').value:'';
    res={ok:true,data:res.data.filter(function(r){
      if(fc&&r.companyId!==fc) return false;
      if(ft!==''&&String(Number(r.tier))!==ft) return false;
      if(fs&&r.status!==fs) return false;
      return true;
    })};
    if($('ufCount')) $('ufCount').textContent=res.data.length+(lang==='zh'?' 位':' users');
    window._usersCache=res.data;
    var h='<table class="table table-sm table-hover"><thead><tr><th>'+T('admin.email')+'</th><th>'+T('admin.name')+'</th><th>'+T('admin.company')+'</th><th>Tier</th><th>'+T('admin.status')+'</th><th>Training</th><th>'+T('common.actions')+'</th></tr></thead><tbody>';
    res.data.forEach(function(r){
      var isAdm=(r.isAdmin===true||r.isAdmin==='TRUE');
      h+='<tr><td>'+esc(r.email)+(isAdm?' <span class="badge bg-dark">Admin</span>':'')+'</td>'+
        '<td><a href="#" onclick="showUserDetail(\\''+r.id+'\\');return false"><b>'+esc(r.nameEn)+'</b><br><small>'+esc(r.nameZh)+'</small></a></td>'+
        '<td>'+esc(companyName(r.companyId))+'</td><td>'+esc(r.tier)+'</td>'+
        '<td><span class="badge badge-status-'+esc(r.status)+'">'+esc(r.status)+'</span></td>'+
        '<td class="small">'+esc(r.trainingValidUntil||'—')+'</td>'+
        '<td class="text-nowrap">'+
        '<button class="btn btn-sm btn-outline-primary me-1" onclick="openUserEdit(\\''+r.id+'\\')">✏️</button>'+
        (r.status==='Locked'?'<button class="btn btn-sm btn-warning me-1" onclick="userAction(\\'user.unlock\\',\\''+r.id+'\\')">'+T('admin.unlock')+'</button>':'')+
        (r.status==='Disabled'
          ?'<button class="btn btn-sm btn-success me-1" onclick="userAction(\\'user.enable\\',\\''+r.id+'\\')">'+T('admin.enable')+'</button>'
          :'<button class="btn btn-sm btn-outline-secondary me-1" onclick="userAction(\\'user.disable\\',\\''+r.id+'\\')">'+T('admin.disable')+'</button>')+
        '<button class="btn btn-sm btn-outline-primary me-1" onclick="resetUserPw(\\''+r.id+'\\')">'+T('admin.resetPw')+'</button>'+
        '<button class="btn btn-sm btn-outline-danger" onclick="deleteUserBtn(\\''+r.id+'\\')">🗑 '+T('admin.delete')+'</button>'+
        '</td></tr>';
    });
    $('userList').innerHTML=h+'</tbody></table>';
  };
  var hasFilter=$('ufCompany').value||$('ufTier').value||$('ufStatus').value||$('userSearch').value.trim();
  if(pre&&!hasFilter){ handle({ok:true,data:pre}); return; }
  api('user.list',{q:$('userSearch').value.trim()}).then(handle);
}
/* (10) 使用者詳細資訊 */
function showUserDetail(id){
  api('user.detail',{userId:id}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var u=res.data.user;
    var rows=[
      ['Email',u.email],[lang==='zh'?'中文姓名':'Name (ZH)',u.nameZh],[lang==='zh'?'英文姓名':'Name (EN)',u.nameEn],
      [lang==='zh'?'公司':'Company',res.data.companyName],['Tier','Tier '+u.tier+(asB(u.isAdmin)?' · Admin':'')],
      [lang==='zh'?'職稱':'Title',u.title],[lang==='zh'?'電話':'Phone',u.phone],
      [lang==='zh'?'船舶':'Vessel',u.vessel],[lang==='zh'?'徽章編號':'Badge No',u.badgeNo||'—'],
      [lang==='zh'?'狀態':'Status',u.status],
      [lang==='zh'?'訓練通過':'Training passed',u.trainingPassedAt||'—'],
      [lang==='zh'?'訓練效期':'Training valid until',u.trainingValidUntil||'—'],
      [lang==='zh'?'PTW 數量':'PTW count',res.data.ptwCount],
      [lang==='zh'?'最近考試':'Last exam',res.data.lastExam?(res.data.lastExam.submitAt+' · '+res.data.lastExam.score+(res.data.lastExam.passed?' ✅':' ❌')):'—'],
      [lang==='zh'?'建立時間':'Created',u.createdAt]];
    var h='<div class="position-fixed top-0 start-0 w-100 h-100" id="udModal" style="background:rgba(0,0,0,.5);z-index:1090" onclick="if(event.target.id===\\'udModal\\')this.remove()">'+
      '<div class="card-x p-3 mx-auto mt-5" style="max-width:520px;background:#fff;max-height:80vh;overflow:auto">'+
      '<div class="d-flex justify-content-between"><h6>👤 '+esc(u.nameEn)+' / '+esc(u.nameZh)+'</h6>'+
      '<button class="btn btn-sm btn-outline-secondary" onclick="$(\\'udModal\\').remove()">✕</button></div>'+
      '<table class="table table-sm small">'+rows.map(function(r){
        return '<tr><th style="width:36%">'+esc(r[0])+'</th><td>'+esc(r[1]==null?'':r[1])+'</td></tr>';}).join('')+'</table>'+
      (res.data.signatureBase64?'<div class="small text-muted">'+(lang==='zh'?'簽名檔':'Signature')+':</div>'+
        '<img src="data:image/png;base64,'+res.data.signatureBase64+'" style="max-height:60px;border:1px dashed #ccc;border-radius:6px;padding:3px">':'')+
      '</div></div>';
    document.body.insertAdjacentHTML('beforeend',h);
  });
}
function userAction(action,id){
  api(action,{userId:id}).then(function(res){ if(res.ok){ toast('OK',true); loadUsers(); } else toast(apiMsg(res)); });
}
function deleteUserBtn(id){
  uiConfirm(T('admin.deleteUserConfirm')).then(function(ok){ if(!ok) return;
  api('user.delete',{userId:id}).then(function(res){
    if(res.ok){ toast(T('admin.delete')+' ✅',true); loadUsers(); } else toast(apiMsg(res));
  });});
}
/* (1) 審批權限流程圖 */
var TIER_TITLES={
 1:{zh:'承商持有人／申請人',en:'Contractor Holder / Applicant'},
 2:{zh:'承商職安衛',en:'Contractor HSE'},
 3:{zh:'NMDC 施工部門',en:'NMDC Construction'},
 4:{zh:'NMDC 安衛部門',en:'NMDC HSE'},
 5:{zh:'NMDC PTW 協調員／系統管理員',en:'NMDC PTW Coordinator / System Admin'}};
function loadFlowChart(){
  Promise.all([api('user.list',{}),api('company.list',{})]).then(function(rs){
    if(!rs[0].ok){ $('flowChartWrap').textContent=apiMsg(rs[0]); return; }
    if(rs[1].ok) companies=rs[1].data;
    window._adminUsers=rs[0].data;
    renderFlowChart(rs[0].data);
  });
}
var TIER_COLORS={0:'#0e7490',1:'#0b6bcb',2:'#7c3aed',3:'#b45309',4:'#be185d',5:'#166534'};
var TIER_ICONS={0:'🦺',1:'📝',2:'🛡️',3:'🏗️',4:'🧯',5:'✅'};
function closeoutFlowStrip(){
  var Z=(lang==='zh');
  var steps=[
    ['1','🧰',Z?'承商持有人':'Contractor Holder',Z?'上傳結案附件後按「完工申報」':'Upload close-out docs & declare completion'],
    ['2','🛡️',Z?'承商職安衛':'Contractor HSE',Z?'審核結案附件':'Review close-out documents'],
    ['3','🏗️',Z?'NMDC 施工組':'NMDC Engineering',Z?'確認施工完成':'Confirm work completed'],
    ['4','🧯',Z?'NMDC 工安組':'NMDC EHS',Z?'確認紀錄提送完整':'Confirm records complete'],
    ['5','✅',Z?'NMDC 協調員':'PTW Coordinator',Z?'確認關單（Closed）':'Final close-out (Closed)']];
  return '<div class="card-x p-3 mb-3"><h6 class="mb-2">🏁 '+(Z?'PTW 關閉流程':'PTW Close-out Flow')+'</h6>'+
    '<div class="d-flex flex-wrap align-items-stretch gap-2">'+
    steps.map(function(st,i){
      return (i?'<div class="align-self-center" style="color:#f0a500;font-weight:700">➜</div>':'')+
        '<div class="border rounded p-2 text-center" style="flex:1;min-width:150px;background:#f6f9fc">'+
        '<div style="font-size:1.3rem">'+st[1]+'</div><b class="small d-block" style="color:#0b3a5c">'+st[0]+'. '+st[2]+'</b>'+
        '<span class="small text-muted" style="font-size:.72rem">'+st[3]+'</span></div>';
    }).join('')+'</div></div>';
}
function renderFlowChart(users){
  var Z=(lang==='zh');
  var act=(users||[]).filter(function(u){ return u.status==='Active'&&(u.isActive===true||u.isActive==='TRUE'||u.isActive===undefined); });
  var contractors=(companies||[]).filter(function(c){ return c.type!=='NMDC'&&(c.isActive===true||c.isActive==='TRUE'); });
  var nameOf=function(u){ return Z?(u.nameZh||u.nameEn):(u.nameEn||u.nameZh); };
  var chips=function(list){
    if(!list.length) return '<span style="opacity:.55;font-size:.8rem">—</span>';
    return list.map(function(u){
      var initial=esc(String(nameOf(u)||'?').charAt(0));
      return '<a href="#" onclick="showUserDetail(\\''+u.id+'\\');return false" '+
        'style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.16);color:#fff;'+
        'text-decoration:none;border-radius:20px;padding:2px 10px 2px 3px;margin:2px;font-size:.8rem;border:1px solid rgba(255,255,255,.25)" '+
        'onmouseover="this.style.background=\\'rgba(255,255,255,.32)\\'" onmouseout="this.style.background=\\'rgba(255,255,255,.16)\\'">'+
        '<span style="width:20px;height:20px;border-radius:50%;background:#fff;color:#155e7d;display:inline-flex;'+
        'align-items:center;justify-content:center;font-weight:700;font-size:.72rem">'+initial+'</span>'+esc(nameOf(u))+'</a>';
    }).join('');
  };
  var tierBox=function(tier,list,wide){
    var c=TIER_COLORS[tier];
    return '<div style="background:linear-gradient(135deg,'+c+',#0b3a5c);color:#fff;border-radius:12px;padding:10px 10px 8px;'+
      'margin:0;text-align:center;box-shadow:0 4px 12px rgba(11,58,92,.25)'+(wide?';max-width:680px;margin-left:auto;margin-right:auto':'')+'">'+
      '<div style="display:flex;align-items:center;justify-content:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.3);padding-bottom:5px;margin-bottom:6px">'+
      '<span style="font-size:1.05rem">'+TIER_ICONS[tier]+'</span>'+
      '<span style="font-weight:800">Tier '+tier+'</span>'+
      '<span style="font-size:.76rem;opacity:.9">'+esc(Z?TIER_TITLES[tier].zh:TIER_TITLES[tier].en)+'</span>'+
      '<span style="background:rgba(255,255,255,.25);border-radius:10px;padding:0 8px;font-size:.72rem">'+list.length+'</span></div>'+
      chips(list)+'</div>';
  };
  var arrow='<div style="text-align:center;color:#8fb3cf;font-size:1rem;line-height:1.1;margin:1px 0">⬇</div>';
  var coHead=function(txt){ return '<div style="background:linear-gradient(135deg,#ffd400,#ffb700);border-radius:10px;'+
    'padding:6px 20px;font-weight:800;color:#333;display:inline-block;box-shadow:0 3px 8px rgba(180,140,0,.35)">🏢 '+esc(txt)+'</div>'; };
  var h='<div style="display:flex;flex-wrap:wrap;gap:18px;justify-content:center;align-items:flex-start">';
  contractors.forEach(function(c){
    var coUsers=act.filter(function(u){ return u.companyId===c.id; });
    h+='<div style="min-width:230px;max-width:300px;flex:1 1 230px;text-align:center;background:#f4f9fd;'+
      'border:1px solid #dbe8f4;border-radius:14px;padding:12px 10px">'+
      coHead(Z?(c.nameZh||c.nameEn):(c.nameEn||c.nameZh));
    [1,2].forEach(function(t){
      h+=arrow+tierBox(t,coUsers.filter(function(u){ return Number(u.tier)===t; }));
    });
    h+='</div>';
  });
  if(!contractors.length) h+='<div class="text-muted p-3">'+(Z?'（尚無承商公司）':'(No contractor companies yet)')+'</div>';
  h+='</div>';
  // NMDC 區（全寬）
  var nmdcCo=(companies||[]).filter(function(c){ return c.type==='NMDC'; }).map(function(c){ return c.id; });
  var nmdcUsers=act.filter(function(u){ return nmdcCo.indexOf(u.companyId)>=0; });
  h+='<div style="text-align:center;margin-top:14px">'+arrow+coHead('NMDC')+'</div>';
  [3,4].forEach(function(t){
    h+=arrow+tierBox(t,nmdcUsers.filter(function(u){ return Number(u.tier)===t; }),true);
  });
  var t5=act.filter(function(u){ return Number(u.tier)===5||u.isAdmin===true||u.isAdmin==='TRUE'; });
  var seen={},t5u=[]; t5.forEach(function(u){ if(!seen[u.id]){ seen[u.id]=1; t5u.push(u); } });
  h+=arrow+tierBox(5,t5u,true);
  h+='<div style="text-align:center;margin-top:8px;color:#166534;font-weight:700">'+arrow+'🏁 '+(Z?'簽發 → 執行 → 關閉':'Issue → Execute → Close')+'</div>';
  $('flowChartWrap').innerHTML=closeoutFlowStrip()+h;
}
/* ---- 測試模式（僅 Admin / Tier 5；不動既有架構） ---- */
function tmAdminToken(){ return sget('ptw_tm_admin_token')||''; }
function tmApi(action,payload){ // 一律以管理員 token 呼叫（即使目前是測試身分）
  var cur=getToken(), adm=tmAdminToken()||cur;
  sset('ptw_token',adm);
  var p=api(action,payload);      // token 於呼叫當下同步讀取
  sset('ptw_token',cur);
  return p;
}
function tmEnable(){
  api('admin.testMode.enable',{}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    if(!tmAdminToken()){ sset('ptw_tm_admin_token',getToken()); sset('ptw_tm_admin_user',sget('ptw_user')); }
    sset('ptw_tm_personas',JSON.stringify(res.data.personas));
    renderTestBar(); renderTmPersonaList(res.data);
    toast(T('tm.enabled'),true);
  });
}
function renderTmPersonaList(data){
  var h='<table class="table table-sm"><thead><tr><th>'+(lang==='zh'?'公司':'Company')+'</th><th>Tier</th><th>'+(lang==='zh'?'姓名':'Name')+'</th><th>Email</th></tr></thead><tbody>';
  (data.personas||[]).forEach(function(p){
    h+='<tr><td>'+esc(lang==='zh'?p.companyZh:p.companyEn)+'</td><td>Tier '+p.tier+'</td><td>'+esc(lang==='zh'?p.nameZh:p.nameEn)+'</td><td class="small">'+esc(p.email)+'</td></tr>';
  });
  h+='</tbody></table><div class="small text-muted">'+(lang==='zh'
    ?'以上帳號也可直接登入，密碼皆為 <code>'+esc(data.password||'Test1234')+'</code>'
    :'These accounts can also log in directly — password for all: <code>'+esc(data.password||'Test1234')+'</code>')+'</div>';
  $('tmPersonaList').innerHTML=h;
}
function renderTestBar(){
  var on=!!tmAdminToken();
  $('testBar').classList.toggle('d-none',!on);
  if(!on) return;
  var personas=[]; try{ personas=JSON.parse(sget('ptw_tm_personas')||'[]'); }catch(e){}
  var u=getUser()||{};
  var admU=null; try{ admU=JSON.parse(sget('ptw_tm_admin_user')||'null'); }catch(e){}
  var h='<option value="ADMIN"'+((admU&&u.id===admU.id)?' selected':'')+'>'+T('tm.admin')+'</option>';
  personas.forEach(function(p){
    var co=(lang==='zh'?p.companyZh:p.companyEn)||p.companyEn||'';
    var nm=(lang==='zh'?p.nameZh:p.nameEn)||p.nameEn||'';
    h+='<option value="'+esc(p.id)+'"'+(u.id===p.id?' selected':'')+'>'+esc(co)+' · Tier '+p.tier+' · '+esc(nm)+'</option>';
  });
  $('tmSelect').innerHTML=h;
}
function clearDataCaches(){
  try{
    var ks=[]; for(var i=0;i<sessionStorage.length;i++){ var k=sessionStorage.key(i);
      if(/^ptw_(home|list)_cache/.test(k)) ks.push(k); }
    ks.forEach(function(k){ sessionStorage.removeItem(k); });
  }catch(e){}
}
function tmSwitch(v){
  if(v==='ADMIN'){
    sset('ptw_token',tmAdminToken());
    sset('ptw_user',sget('ptw_tm_admin_user')||'null');
    clearDataCaches();
    enter(); return;
  }
  tmApi('admin.testMode.impersonate',{userId:v}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); renderTestBar(); return; }
    sset('ptw_token',res.data.token); sset('ptw_user',JSON.stringify(res.data.user));
    clearDataCaches();
    toast((lang==='zh'?'已切換身分：':'Now acting as: ')+(lang==='zh'?res.data.user.nameZh:res.data.user.nameEn),true);
    enter();
  });
}
function tmExit(){
  var adm=tmAdminToken();
  if(adm){ sset('ptw_token',adm); sset('ptw_user',sget('ptw_tm_admin_user')||'null'); }
  sset('ptw_tm_admin_token',''); sset('ptw_tm_admin_user',''); sset('ptw_tm_personas','');
  clearDataCaches();
  enter();
}
/* ☢️ 一鍵重置：輸入 RESET 才執行 */
function doFactoryReset(){
  var Z=(lang==='zh');
  uiPrompt(Z
    ?'☢️ 一鍵重置將刪除所有 PTW、公司與人員（只留 paultong.ehs@gmail.com），編號歸零，無法復原！\\n\\n請輸入大寫 RESET 確認執行：'
    :'☢️ Factory reset will delete ALL PTWs, companies and users (keeps only paultong.ehs@gmail.com) and restart numbering. This CANNOT be undone!\\n\\nType RESET (uppercase) to confirm:')
  .then(function(v){
    if(v===null||v===undefined) return;
    if(String(v).trim()!=='RESET'){ toast(Z?'⚠️ 未輸入 RESET，已取消':'⚠️ RESET not entered — cancelled'); return; }
    api('admin.system.factoryReset',{confirm:'RESET'}).then(function(res){
      if(!res.ok){ toast(apiMsg(res)); return; }
      clearDataCaches();
      uiAlert(Z
        ?'✅ 重置完成！\\n\\n系統已清空並保留管理員 '+res.data.keptAdmin+'。\\n編號將自 0001 重新開始；testnmdc 測試帳號會在下次載入頁面時自動重建。\\n\\n按確定後將重新整理頁面。'
        :'✅ Factory reset complete!\\n\\nOnly '+res.data.keptAdmin+' was kept. Numbering restarts from 0001; the testnmdc account will be recreated on next page load.\\n\\nThe page will now reload.')
      .then(function(){ clearAuthStorage(); try{ sessionStorage.clear(); }catch(e){} location.reload(); });
    });
  });
}
function tmReset(){
  uiConfirm(T('tm.resetConfirm')).then(function(ok){ if(!ok) return;
  tmApi('admin.testMode.reset',{}).then(function(res){
    toast(res.ok?(T('tm.resetDone')+'（'+res.data.cleared+'）'):apiMsg(res),res.ok);
  });});
}
function resetUserPw(id){
  uiPrompt(T('reset.newPassword')+' (≥8, A-z + 0-9)').then(function(pw){ if(!pw) return;
  api('user.resetPasswordByAdmin',{userId:id,newPassword:pw}).then(function(res){
    toast(res.ok?(lang==='zh'?'密碼已重設':'Password reset'):apiMsg(res),res.ok);
  });});
}
function exportUsers(){
  api('user.export',{}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var blob=new Blob(['﻿'+res.data.csv],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=res.data.fileName; a.click();
  });
}
function loadCompanies(pre){
  var handle=function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    companies=res.data;
    // (1) 篩選：名稱 / 類型
    var q=($('coSearch')?$('coSearch').value:'').trim().toLowerCase(), ftp=$('cofType')?$('cofType').value:'';
    res={ok:true,data:res.data.filter(function(c){
      if(ftp&&c.type!==ftp) return false;
      if(q&&String(c.nameEn).toLowerCase().indexOf(q)<0&&String(c.nameZh).indexOf($('coSearch').value.trim())<0) return false;
      return true;
    })};
    var h='<table class="table table-sm table-hover"><thead><tr><th>Name (EN)</th><th>名稱（中）</th><th>Type</th><th>'+T('admin.status')+'</th><th></th></tr></thead><tbody>';
    res.data.forEach(function(c){
      h+='<tr><td>'+esc(c.nameEn)+'</td><td>'+esc(c.nameZh)+'</td><td>'+esc(c.type)+'</td>'+
        '<td>'+(c.isActive?'<span class="badge bg-success">Active</span>':'<span class="badge bg-secondary">Disabled</span>')+'</td>'+
        '<td>'+(c.isActive
          ?'<button class="btn btn-sm btn-outline-secondary" onclick="companyAction(\\'company.disable\\',\\''+c.id+'\\')">'+T('admin.disable')+'</button>'
          :'<button class="btn btn-sm btn-success" onclick="companyAction(\\'company.enable\\',\\''+c.id+'\\')">'+T('admin.enable')+'</button>')+
        '</td></tr>';
    });
    $('companyList').innerHTML=h+'</tbody></table>';
  };
  if(pre&&!(($('coSearch')&&$('coSearch').value.trim())||($('cofType')&&$('cofType').value))){ handle({ok:true,data:pre}); return; }
  api('company.list',{}).then(handle);
}
function addCompany(){
  api('company.create',{nameZh:$('coNameZh').value.trim(),nameEn:$('coNameEn').value.trim(),type:$('coType').value})
  .then(function(res){
    if(res.ok){ toast((lang==='zh'?'公司已新增':'Company added'),true); $('coNameZh').value='';$('coNameEn').value=''; loadCompanies(); }
    else toast(apiMsg(res));
  });
}
function companyAction(action,id){
  api(action,{companyId:id}).then(function(res){ if(res.ok){ toast('OK',true); loadCompanies(); } else toast(apiMsg(res)); });
}
var auditPage=1;
function loadAudit(pre,page){
  var handle=function(res){
    if(!res.ok){ $('auditList').innerHTML='<div class="text-muted p-3">'+esc(apiMsg(res))+'</div>'; return; }
    auditPage=res.data.page||1;
    var total=res.data.total||0, pages=Math.max(1,Math.ceil(total/100));
    $('auditInfo').textContent=(lang==='zh'?('共 '+total+' 筆紀錄（全數保留）'):(total+' records (all retained)'));
    $('auditPageLbl').textContent=auditPage+' / '+pages;
    $('auditPrev').disabled=(auditPage<=1);
    $('auditNext').disabled=(auditPage>=pages);
    var h='<table class="table table-sm"><thead><tr><th>#</th><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>PTW</th><th>OK</th></tr></thead><tbody>';
    res.data.rows.forEach(function(r,i){
      h+='<tr><td class="small text-muted">'+((auditPage-1)*100+i+1)+'</td>'+
        '<td class="small text-nowrap">'+esc(r.timestamp)+'</td><td>'+esc(r.userName)+'</td><td>'+esc(r.actionType)+'</td>'+
        '<td class="small">'+esc(r.entityType)+'</td><td class="small">'+esc(r.ptwNumber)+'</td>'+
        '<td>'+((r.success===true||r.success==='TRUE')?'✅':'❌')+'</td></tr>';
    });
    $('auditList').innerHTML=h+'</tbody></table>';
  };
  if(pre){ handle({ok:true,data:pre}); return; }
  api('admin.audit.list',{page:page||1,pageSize:100}).then(handle);
}

/* ==================== PTW 申請（§7） ==================== */
/* ---- 勾選群定義（Excel 主表，Phase 1 Mapping Table） ---- */
var WT_DEF=[['wtHotWork','動火作業 Hot Work'],['wtColdWork','一般作業 Cold Work'],['wtDiving','潛水作業 Diving'],
 ['wtRadiography','輻射作業 Radiography'],['wtConfinedSpace','局限空間 Confined Space'],
 ['wtElectricalIso','電氣隔離 Electrical Isolation'],['wtProcessIso','製程隔離 Process Isolation']];
// 總部決議：一般作業 Cold Work 免附證書；開挖作業 Excavation 已自系統移除（wtExcavation 欄位僅為舊資料保留）
var HZ_DEF=[['hzFallHeight','從高處墜落 Fall From Height'],['hzLifting','起重作業 Lifting Operation'],
 ['hzLineOfFire','危險區域 Line of Fire'],['hzMobileEquip','移動設備 Mobile Equipment'],
 ['hzHazEnergy','危險能量 Hazardous Energy'],['hzOverWater','在水上/近水作業 Working Over/Near Water'],
 ['hzExcavation','開挖作業 Excavation'],['hzDriving','駕駛 Driving'],
 ['hzConfinedSpace','局限空間 Confined Space'],['hzMovingMachinery','運轉機械 Moving Machinery'],
 ['hzDroppedObject','掉落物體 Dropped Object'],['hzElectricity','電氣 Electricity'],
 ['hzFireExplosion','火災/爆炸 Fire/Explosion'],['hzNakedFlame','裸焰 Naked Flame'],
 ['hzSparks','飛焰/火星 Flying Particle/Sparks'],['hzGasCylinders','氣瓶 Gas Cylinders'],
 ['hzUgCables','地下電纜/燃氣管線 U.G. Cables/Gas Lines'],['hzPressure','壓力設備 Equipment Under Pressure'],
 ['hzNoise','噪音 Noise'],['hzChemical','化學品處理 Chemical Handling'],
 ['hzSlipTrip','滑倒/絆倒/跌倒 Slip/Trip/Fall'],['hzSharpEdges','鋒利的邊緣 Sharp Edges'],
 ['hzWeatherSea','天氣/海況 Weather/Sea State'],['hzRadiation','輻射 Radiation'],
 ['hzManOverboard','人員落水 Man Overboard'],['hzSimops','同時作業 SIMOPs'],
 ['hzVesselMovement','船舶移位/錨泊作業 Vessel Movement/Anchor Handling'],['hzDivingOps','潛水作業 Diving Operations'],
 ['hzNightWork','夜間作業 Night Work'],['hzHeatStress','熱危害/中暑 Heat Stress'],
 ['hzFatigue','疲勞 Fatigue'],['hzToxicGas','H2S/毒性氣體 Toxic Gas/H2S']];
var CSS_DEF=[['cssFireGasDetection','火災/氣體檢測斷開 Fire/Gas Detection Disconnecting'],
 ['cssFireWater','消防水切斷 Fire Water Disconnecting'],['cssAlarmPA','警報廣播系統斷開 Alarm P.A. System Disc.'],
 ['cssFixedFF','固定式消防系統斷開 Fixed F/F System Disc.'],['cssLifeSaving','救生設備斷開 Life Saving Appliances Disc.'],
 ['cssEscapeBlocked','逃生路線被阻塞 Escape Route Blocked']];
var PS_DEF=[['psMechIso','機械隔離 Mechanical Isolation'],['psSpadedBlinded','設備隔離/封盲 Spaded/Blinded'],
 ['psElecIso','電氣隔離 Electrical Isolation'],['psDepressurised','設備減壓 Depressurised'],
 ['psWatchman','監視者在場 Watchman Present'],['psGasFree','設備排空(氣體) Gas Free'],
 ['psDrained','設備排空(液體) Fully Drained'],['psInerted','設備惰化 Inerted'],
 ['psVentilated','設備通風 Ventilated'],['psGasChecksDone','氣體檢查已完成 Gas Checks Completed'],
 ['psAreaClear','區域內無可燃物 Area Clear of Combustibles'],
 ['psLinesFlushed','管線已沖洗/清管 Lines Flushed/Pigged'],['psValvesClosed','閥件關閉並掛牌 Valves Closed & Tagged'],
 ['psCommsEstablished','通訊已建立 Communications Established'],['psWeatherChecked','氣象海況已確認 Weather/Sea Checked'],
 ['psRescueStandby','救援設備待命 Rescue Equipment Standby']];
var PC_DEF=[['pcEyeProtection','眼睛保護 Eye Protection'],['pcHearing','聽力保護 Hearing Protection'],
 ['pcChemClothing','化學處理防護服 Chemical Handling Clothing'],['pcGloves','戴手套 Wear Gloves'],
 ['pcFaceVisor','配戴全面罩 Full Face Visor'],['pcHarness','安全吊帶/救生繩 Harness/Line'],
 ['pcLifeJacket','救生衣/工作背心 Life Jacket/Work Vest'],['pcRespiratory','呼吸保護 Respiratory Protection'],
 ['pcScaffBarriers','施工架屏障 Scaffolding Barriers'],['pcH2sTrained','僅限硫化氫訓練人員 H2S Trained Only'],
 ['pcEscapeSets','備用逃生裝備 Escape Sets Stand-By'],['pcFullBA','全套呼吸裝備 Full BA'],
 ['pcAccessLimit','進出限制 Limitation of Access'],['pcFireExt','滅火器 Fire Extinguisher'],
 ['pcFireHose','消防水帶展開 Fire Hose Run Out'],['pcWarningNotices','警告標示與屏障 Warning Notices & Barriers'],
 ['pcLighting','額外照明 Additional Lighting'],['pcRadioChannel','無線電通訊頻道 Radio Channel'],
 ['pcLoto','隔離/鎖定標示 Isolation/LOTO'],['pcGasDetection','氣體檢測要求 Gas Detection Requirement'],
 ['pcClearCombustibles','清除可燃物質 Clear Combustibles'],['pcFireWatch','消防值班人員待命 Fire Watchman'],
 ['pcFireBlanket','消防毯 Fire Blanket'],['pcNonFerric','非鐵質工具 Non Ferric Tools'],
 ['pcEnvProtection','環境保護 Environment Protection'],['pcLiftingInspection','起重索具/設備檢查 Lifting Insp.'],
 ['pcMobRescue','落水救援設備 MOB Rescue Equipment'],['pcStandbyVessel','戒護船待命 Standby Vessel'],
 ['pcDiveFlag','潛水旗/信號 Diving Flag & Signals'],['pcSimopsCoord','同時作業協調 SIMOPs Coordination'],
 ['pcHydration','飲水/防暑措施 Hydration & Heat Control'],['pcWorkRestCycle','工作休息輪替 Work/Rest Cycle']];
var DOC_DEF=[['docJsaRa','JSA/RA 工作安全分析/風險評估'],['docMethodStatement','Method Statement 施工方法']];

/* ---- 證書表單定義（欄位依 Phase 1 §3.2–3.8；F=[id,label,type]，type: t文字/ta多行/yn是否/c勾選/d日期/n數字 ---- */
var CERT_FORMS=null; // 由後端 system.certForms 載入（單一來源，見 CertFormDefs.gs）

/* ---- PTW 前端狀態 ---- */
var cur=null, curStep=0, dirty=false, saveTimer=null, pickerCache=null, pickerCacheCo=null;
window.addEventListener('beforeunload',function(e){
  if(dirty&&cur&&cur.editable){ e.preventDefault(); e.returnValue=''; }
});
var STEPS=[
 {n:'1',zh:'基本資料',en:'Basic Info'},
 {n:'2',zh:'危害與預防',en:'Hazards & Precautions'},
 {n:'3',zh:'氣體測試',en:'Gas Test'},
 {n:'4',zh:'人員',en:'Personnel'},
 {n:'5',zh:'附加證書',en:'Certificates'},
 {n:'6',zh:'文件/聲明/提交',en:'Docs & Submit'}];
/* 作業類型簡介（幫助申請人判斷勾選） */
var WT_INTRO={
 wtHotWork:['銲接、切割、研磨、加熱等產生明火或火花之作業（電銲、氧乙炔切割、砂輪機、噴砂）','Welding, cutting, grinding, heating or any work producing open flame or sparks (arc welding, oxy-fuel cutting, grinders, blasting)'],
 wtColdWork:['不產生明火/火花之一般作業（檢查、保養、組裝、搬運、油漆、保溫、腳手架搭設等），免附加證書','General work without open flame or sparks (inspection, maintenance, assembly, material handling, painting, insulation, scaffolding erection) — no certificate required'],
 wtDiving:['任何水下人員作業（水下檢查、水下切割／銲接、海床作業、水下安裝）','Any manned underwater work (inspection, underwater cutting/welding, seabed works, subsea installation)'],
 wtRadiography:['使用放射性射源之作業（RT 射線檢測、射源運搬與暫存）','Work using radioactive sources (radiographic testing, source transport & storage)'],
 wtConfinedSpace:['進入通風不良且出入受限之空間（儲槽、管內、船艙、人孔、泵艙）','Entry into poorly ventilated spaces with restricted access (tanks, pipelines, vessel holds, manholes, pump rooms)'],
 wtElectricalIso:['需對電氣設備隔離、掛牌上鎖（LOTO）後方可執行之作業','Work requiring electrical isolation and lock-out/tag-out (LOTO) before starting'],
 wtProcessIso:['需先對製程系統（管線／設備／儀器）隔離後方可執行之作業，含製程、電氣與機械隔離之確認','Work requiring process system isolation (piping/equipment/instrumentation) before starting, incl. process, electrical and mechanical isolation confirmation']};

function openPtwList(){ showView('ptw'); $('ptwFormWrap').classList.add('d-none'); $('ptwListWrap').classList.remove('d-none'); loadPtwList(); }
function openMyPtw(){ showView('ptw'); $('pfMine').checked=true; $('ptwFormWrap').classList.add('d-none'); $('ptwListWrap').classList.remove('d-none'); loadPtwList(); }

var STATUS_BADGE={Draft:'secondary',Submitted:'primary',PendingTier2Review:'warning text-dark',PendingTier3Review:'warning text-dark',
 PendingTier4Review:'warning text-dark',PendingTier5Review:'warning text-dark',ReturnedForRevision:'danger',ReturnedForCorrection:'danger',
 Approved:'success',Active:'success',Suspended:'info text-dark',Extended:'info text-dark',Expired:'danger',
 WorkCompleted:'success',PendingCloseout:'warning text-dark',Closed:'dark',Cancelled:'secondary'};
function statusBadge(s){ return '<span class="badge bg-'+(STATUS_BADGE[s]||'secondary')+'">'+esc(SN(s))+'</span>'; }

/** 清單刪除鍵：僅系統管理員（或 Tier 5）可見；後端 ptw.delete 亦同樣把關 */
function canDeletePtw(){ var u=getUser(); return !!(u&&(asB(u.isAdmin)||Number(u.tier)===5)); }
/** 清除 PTW 清單快取（刪除後避免舊資料被快取重繪回來） */
function clearPtwListCache(){
  try{ var del=[]; for(var i=0;i<sessionStorage.length;i++){ var k=sessionStorage.key(i);
    if(k&&k.indexOf('ptw_list_cache_')===0) del.push(k); }
    del.forEach(function(k){ sessionStorage.removeItem(k); }); }catch(e){}
  try{ Object.keys(mem).forEach(function(k){ if(k.indexOf('ptw_list_cache_')===0) delete mem[k]; }); }catch(e){}
}
function doDeletePtwRow(id,number){
  if(!canDeletePtw()){ toast(lang==='zh'?'僅限系統管理員':'Administrator only'); return; }
  var warn=(lang==='zh'
    ?'<div class="fw-bold mb-1" style="color:#b02121">🗑 確定刪除 '+esc(number||'')+' ？</div>'+
     '<div class="small text-muted mb-2">將自所有清單移除（稽核紀錄保留），且無法復原。<br>'+
     '系統會 email 通知<b>申請人、持有人／共同持有人、目前審核人與已核准人員</b>，並寄送管理員副本。</div>'+
     '<div class="small">請填寫刪除原因（可留空）：</div>'
    :'<div class="fw-bold mb-1" style="color:#b02121">🗑 Delete '+esc(number||'')+' ?</div>'+
     '<div class="small text-muted mb-2">It will be removed from all lists (audit trail is kept) and cannot be undone.<br>'+
     'The <b>applicant, holder(s)/co-holders, current reviewer and previous approvers</b> will be notified by email, with an admin copy.</div>'+
     '<div class="small">Reason for deletion (optional):</div>');
  uiDialog({html:warn,prompt:true,def:'',okText:(lang==='zh'?'刪除':'Delete')}).then(function(reason){
    if(reason===null) return;
    api('ptw.delete',{ptwId:id,reason:reason}).then(function(res){
      if(res.ok){ toast(T('ptw.delete')+' ✅ '+(number||''),true); clearPtwListCache();
        var fw=$('ptwFormWrap');
        if(fw&&!fw.classList.contains('d-none')){ dirty=false; cur=null; openPtwList(); } else loadPtwList();
        api('ptw.board',{},{silent:true}).then(function(b){ if(b.ok) renderBoard(b.data); }); }
      else toast(apiMsg(res));
    });
  });
}
function renderPtwListData(data){
    if(!data.rows.length){ $('ptwList').innerHTML='<div class="text-muted p-3">No PTW found 查無資料</div>'; return; }
    var res={data:data};
    var h='<table class="table table-sm table-hover"><thead><tr><th>No.</th><th>'+(lang==='zh'?'狀態':'Status')+'</th><th>'+(lang==='zh'?'公司':'Company')+'</th>'+
      '<th>'+(lang==='zh'?'位置':'Location')+'</th><th>'+(lang==='zh'?'工作內容':'Work')+'</th><th>'+(lang==='zh'?'有效期間':'Valid')+'</th><th>Tier</th><th>v</th><th></th></tr></thead><tbody>';
    res.data.rows.forEach(function(r){
      h+='<tr><td><b>'+esc(r.number)+'</b></td><td>'+statusBadge(r.status)+'</td><td class="small">'+esc(r.company)+'</td>'+
        '<td class="small">'+esc(r.areaLocation||'—')+'</td><td class="small">'+esc(r.workDescription||'—')+'</td>'+
        '<td class="small">'+esc(String(r.validFrom||'').substring(0,10))+' →<br>'+esc(String(r.validTo||'').substring(0,10))+'</td>'+
        '<td>'+esc(r.currentTier||'—')+'</td><td>'+esc(r.version)+'</td>'+
        '<td class="text-nowrap"><button class="btn btn-sm btn-outline-primary me-1" onclick="openPtwForm(\\''+r.id+'\\')">'+(r.isMine?(lang==='zh'?'開啟':'Open'):(lang==='zh'?'檢視':'View'))+'</button>'+
        (['Approved','Active','Extended','Suspended','WorkCompleted','PendingCloseout','Closed'].indexOf(r.status)>=0
          ?'<button class="btn btn-sm btn-success" title="'+esc(T('pdf.site'))+'" onclick="quickPdf(\\''+r.id+'\\',\\'site\\')">🖨</button>'+
           '<button class="btn btn-sm btn-outline-success ms-1" title="'+esc(T('pdf.full'))+'" onclick="quickPdf(\\''+r.id+'\\',\\'main\\')">📄</button>'+
           '<button class="btn btn-sm btn-outline-success ms-1" title="'+esc(T('pdf.certs'))+'" onclick="quickPdf(\\''+r.id+'\\',\\'certs\\')">📑</button>':'')+
        (r.canClose&&['Approved','Active','Extended','Suspended','Expired'].indexOf(r.status)>=0
          ?'<button class="btn btn-sm btn-danger ms-1" title="'+(lang==='zh'?'完工申報／關閉 PTW':'Declare completion / close PTW')+'" onclick="quickClosure(\\''+r.id+'\\')">🏁 '+(lang==='zh'?'關閉':'Close')+'</button>':'')+
        (canDeletePtw()
          ?'<button class="btn btn-sm btn-outline-danger ms-1" title="'+esc(T('ptw.delete'))+(lang==='zh'?'（僅管理員）':' (Admin only)')+'" onclick="doDeletePtwRow(\\''+r.id+'\\',\\''+esc(String(r.number||'')).replace(/'/g,"\\\\'")+'\\')">🗑</button>':'')+
        '</td></tr>';
    });
    $('ptwList').innerHTML=h+'</tbody></table><div class="small text-muted px-2">Total: '+res.data.total+'</div>';
}
function loadPtwList(){
  // 先用上次快取即時渲染（0 延遲），背景取新資料後更新
  var key='ptw_list_cache_'+((getUser()||{}).id||'')+'|'+$('pfStatus').value+'|'+$('pfQ').value.trim()+'|'+($('pfMine').checked?'1':'');
  var cached=null; try{ cached=JSON.parse(sget(key)||'null'); }catch(e){}
  if(cached) renderPtwListData(cached);
  else $('ptwList').innerHTML='<div class="text-muted small p-2">Loading…</div>';
  api('ptw.list',{status:$('pfStatus').value,q:$('pfQ').value.trim(),mine:$('pfMine').checked?1:'' },{silent:!!cached}).then(function(res){
    if(!res.ok){ if(!cached) $('ptwList').innerHTML='<div class="text-danger p-2">'+esc(apiMsg(res))+'</div>'; return; }
    try{ sset(key,JSON.stringify(res.data)); }catch(e){}
    renderPtwListData(res.data);
  });
}

function newPtw(){
  api('ptw.createDraft',{}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    openPtwForm(res.data.ptwId);
  });
}

function openPtwForm(ptwId){
  // 單一合併呼叫：主表+歷程+版本+附件+人員+證書定義 一次取回
  api('ptw.open',{ptwId:ptwId}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var d=res.data;
    pickerCache=d.pickers||pickerCache;
    companyCache=d.companies||companyCache;
    CERT_FORMS=d.certForms||CERT_FORMS;
    cur=d.ptw;
    cur._closeoutDocs=d.closeoutDocs||[];   // 關單文件規則（後端 CloseoutRules 依作業類型算出）
    pickerCacheCo=cur.companyId||'';   // 此清單是依這份 PTW 的申請公司取回的
    try{ cur._checks=JSON.parse(cur.checksJson||'{}'); }catch(e){ cur._checks={}; }
    try{ cur._gas=JSON.parse(cur.gasTestsJson||'[]'); }catch(e){ cur._gas=[]; }
    try{ cur._docs=JSON.parse(cur.docChecksJson||'{}'); }catch(e){ cur._docs={}; }
    cur._certData={};
    Object.keys(cur.certs||{}).forEach(function(k){
      try{ cur._certData[k]=JSON.parse(cur.certs[k].dataJson||'{}'); }catch(e){ cur._certData[k]={}; }
    });
    cur._attachments=d.attachments||[];
    cur._mySignature=d.mySignature||'';
    // 還原先前保存的逐步審查進度（例如中途去設定簽名檔）
    try{ cur._stepRv=JSON.parse(sget('ptw_rv_'+ptwId)||'{}')||{}; }catch(e){ cur._stepRv={}; }
    $('ptwListWrap').classList.add('d-none');
    $('ptwFormWrap').classList.remove('d-none');
    $('pfNumber').textContent=cur.ptwNumber||cur.tempNumber;
    $('pfStatusBadge').outerHTML='<span id="pfStatusBadge">'+statusBadge(cur.status)+'</span>';
    // 現場聯／完整主表／證書：Tier 5 核准簽發後才可下載
    var pdfReady=['Approved','Active','Extended','Suspended','WorkCompleted','PendingCloseout','Closed'].indexOf(cur.status)>=0;
    ['btnPdfSite','btnPdf','btnPdfCert'].forEach(function(id){ $(id).classList.toggle('d-none',!pdfReady); });
    updateCompletion(cur.completion);
    cur._maxSeen=0; // (3) 審查逐步檢視進度
    renderReviewBar();
    renderLifeBar();
    renderHistoryData(d.history);
    renderVersionsData(d.versions);
    renderAdminStage();
    gotoStep(0);
    if(window._afterOpenPtw==='closure'){ window._afterOpenPtw=null; setTimeout(function(){ reqClosure(); },400); }
  });
}
/* 清單列 🏁：開啟該 PTW 並直接進入完工申報流程 */
function quickClosure(id){
  window._afterOpenPtw='closure';
  openPtwForm(id);
}
/* ---- 生命週期（Phase 4）---- */
function renderLifeBar(){
  var u=getUser()||{}, s=cur.status;
  var isApplicant=(cur.applicantUserId===u.id);
  // 同公司即可申報完工／關單（PTW 未到期也能提前關），Tier 5／管理員亦可
  var canCloseThis=function(){
    return !!(asB(u.isAdmin)||Number(u.tier)===5||(cur.companyId&&cur.companyId===u.companyId));
  };
  var isT5=(Number(u.tier)===5||u.isAdmin);
  var btns=[];
  // 完工申報：同承商公司人員皆可（作業提早完成、申請人不在班上時仍可關單）
  if(canCloseThis()&&['Approved','Active','Extended','Suspended','Expired'].indexOf(s)>=0)
    btns.push('<button class="btn btn-sm btn-outline-success" onclick="reqClosure()">🏁 '+L('完工申報 Work Completed')+'</button>');
  if(isT5&&['Active','Extended'].indexOf(s)>=0)
    btns.push('<button class="btn btn-sm btn-warning" onclick="doSuspend()">⏸ '+L('暫停 Suspend')+'</button>');
  if(isT5&&s==='Suspended')
    btns.push('<button class="btn btn-sm btn-success" onclick="doResume()">▶️ '+L('恢復 Resume')+'</button>');
  if(isT5&&['PendingCloseout','Expired','Suspended'].indexOf(s)>=0)
    btns.push('<button class="btn btn-sm btn-dark" onclick="doClose()">🔒 '+L('關閉 Close')+'</button>');
  if((asB(u.isAdmin)||Number(u.tier)===5)&&cur.id&&!isMyReviewTurn())
    btns.push('<button class="btn btn-sm btn-danger" onclick="doDeletePtw()">🗑 '+T('ptw.delete')+'</button>');
  // (6) 結案三部門依序確認
  var CO_NAME={2:(lang==='zh'?'承商職安衛':'Contractor HSE'),3:(lang==='zh'?'NMDC 施工組':'NMDC Engineering'),
    4:(lang==='zh'?'NMDC 工安組':'NMDC EHS'),5:(lang==='zh'?'NMDC 協調員':'PTW Coordinator')};
  if(s==='PendingCloseout'){
    var step=Number(cur.coCurrentTier||2);
    var chain=[2,3,4,5].map(function(t){
      return '<span style="margin-right:10px">'+(cur['coT'+t+'At']?'✅':(t===step?'⏳':'⬜'))+' '+CO_NAME[t]+'</span>';
    }).join('');
    btns.push('<span class="small" style="display:block;width:100%;margin-bottom:4px">'+
      '<b>'+T('co.title')+'：</b>'+chain+'</span>');
    var myCoTurn=(Number(u.tier)===step&&(step!==2||u.companyId===cur.companyId))||asB(u.isAdmin);
    if(myCoTurn){
      btns.push('<button class="btn btn-sm btn-success" onclick="doCloseoutConfirm()">✅ '+(lang==='zh'?'無意見 — 確認':'No issues — Confirm')+'（'+CO_NAME[step]+'）</button>');
      btns.push('<button class="btn btn-sm btn-outline-danger ms-1" onclick="doCloseoutReturn()">💬 '+(lang==='zh'?'有意見 — 退回上一關':'Comment — Return to previous step')+'</button>');
    }
  }
  $('lifeBar').classList.toggle('d-none',!btns.length);
  $('lifeButtons').innerHTML=btns.join('')+
    (btns.length?'<span class="small text-muted ms-2">Status: '+esc(s)+'</span>':'');
}
function doDeletePtw(){ doDeletePtwRow(cur.id,cur.ptwNumber||cur.tempNumber||''); }
function doCloseoutReturn(){
  uiPrompt(lang==='zh'
    ?'請填寫退回意見（第一關承商職安衛退回時，將退回申請人重新整理結案附件）：'
    :'Enter your comment (a return at the Contractor-HSE step goes back to the applicant to update close-out attachments):')
  .then(function(cmt){
    if(cmt===null) return;
    if(!String(cmt||'').trim()){ toast(lang==='zh'?'退回必須填寫意見':'Comment is required'); return; }
    api('ptw.closeoutReturn',{ptwId:cur.id,comment:cmt}).then(function(res){
      if(!res.ok){ toast(apiMsg(res)); return; }
      toast((lang==='zh'?'已退回 ↩️':'Returned ↩️'),true);
      openPtwForm(cur.id);
    });
  });
}
function doCloseoutConfirm(){
  uiPrompt(lang==='zh'?'確認意見（選填）':'Confirmation comment (optional)').then(function(c){
    if(c===null) return;
    api('ptw.closeoutConfirm',{ptwId:cur.id,comment:c||''}).then(function(res){
      if(!res.ok){ toast(apiMsg(res)); return; }
      toast(res.data.closed?(lang==='zh'?'已完成三部門確認，PTW 正式關閉 🔒':'All confirmations complete — PTW closed 🔒')
        :(lang==='zh'?'已確認，轉下一部門':'Confirmed — passed to next department'),true);
      openPtwForm(cur.id);
    });
  });
}
function doSuspend(){
  uiPrompt(lang==='zh'?'暫停原因（必填）':'Suspend reason (required)').then(function(reason){ if(!reason) return;
  api('ptw.suspend',{ptwId:cur.id,reason:reason}).then(function(res){
    if(res.ok){ toast('Suspended ⏸',true); openPtwForm(cur.id); } else toast(apiMsg(res));
  });});
}
function doResume(){
  uiConfirm(lang==='zh'?'確認恢復此 PTW？':'Resume this PTW?').then(function(ok){ if(!ok) return;
  api('ptw.resume',{ptwId:cur.id}).then(function(res){
    if(res.ok){ toast('Resumed ▶️',true); openPtwForm(cur.id); } else toast(apiMsg(res));
  });});
}
function reqClosure(){
  var Z=(lang==='zh');
  // 關單文件清單一律取自後端 CloseoutRules（ptw.open 帶回的 cur._closeoutDocs），與後端擋件規則同一來源
  var docs=(cur._closeoutDocs||[]).slice();
  var order={required:0,recommended:1,optional:2};
  docs.sort(function(a,b){ return order[a.level]-order[b.level]; });
  var missingReq=docs.filter(function(d){ return d.level==='required'&&!attHas(d.key); });
  var missingRec=docs.filter(function(d){ return d.level==='recommended'&&!attHas(d.key); });
  var row=function(d){
    var has=attHas(d.key);
    var icon=has?'✅':(d.level==='required'?'❌':(d.level==='recommended'?'⚑':'▫️'));
    var tag=d.level==='required'?(Z?'必要':'required'):(d.level==='recommended'?(Z?'建議':'recommended'):(Z?'選配':'optional'));
    var tagStyle=d.level==='required'?'background:#fdeaea;color:#a13030;border-color:#f3c6c6'
      :(d.level==='recommended'?'background:#fff8e6;color:#8a5a00;border-color:#f0dca8':'background:#f2f4f7;color:#54657a;border-color:#dde3ea');
    return '<tr><td class="k" style="width:34px;text-align:center;font-size:1.05rem">'+icon+'</td>'+
      '<td class="v'+(has?'':(d.level==='required'?' fw-bold':''))+'" style="'+(has?'color:#54657a':'')+'">'+esc(Z?d.zh:d.en)+
      ' <span class="uiChip" style="'+tagStyle+'">'+tag+'</span></td></tr>';
  };
  var table='<table class="uiKV mb-3">'+docs.map(row).join('')+'</table>';
  var sub=(cur.ptwNumber||cur.tempNumber)+' · '+(Z?'關單文件檢核':'Close-out document check');
  // ── 缺必要文件：不給申報，直接帶去第 6 步上傳 ──
  if(missingReq.length){
    uiDialog({icon:'📎',width:560,noCancel:true,
      title:(Z?('尚缺 '+missingReq.length+' 份必要關單文件，無法申報完工'):('Missing '+missingReq.length+' mandatory close-out document(s) — cannot declare completion')),
      sub:sub,okText:(Z?'前往第 6 步上傳 →':'Go to Step 6 to upload →'),okClass:'btn-warning fw-bold',
      headColor:'linear-gradient(135deg,#8d1f1f 0%,#c0392b 100%)',
      html:table+'<div class="uiNote">'+(Z
        ?'❌ 標示的項目為本張 PTW 依作業類型必須檢附的紀錄，請於第 6 步「附件上傳」選擇對應分類上傳後，再回來按完工申報。'
        :'Items marked ❌ are mandatory for this PTW based on its work types. Upload them under the matching category in Step 6, then declare completion again.')+'</div>'})
    .then(function(){ gotoStep(STEPS.length-1); setTimeout(function(){ var el=$('attCategory'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); },300); });
    return;
  }
  // ── 必要文件齊全：顯示檢核結果＋完工聲明，確認後送出 ──
  var decl=Z
    ?'<b>完工聲明：</b>我特此聲明，本許可證中詳述的工作已在安全的情況下完成／停止，所有人員均已撤離，並且該區域已恢復安全。'
    :'<b>Declaration:</b> the work detailed in this permit has been completed / stopped in a safe condition, all personnel have been withdrawn and the area has been made safe.';
  var recNote=missingRec.length
    ?'<div class="uiNote mb-2">⚑ '+(Z
        ?('有 '+missingRec.length+' 份「建議」文件尚未上傳，目前不擋關單，但結案審閱人員可能會要求補件。')
        :(missingRec.length+' recommended document(s) not uploaded. Close-out is not blocked, but reviewers may ask for them.'))+'</div>'
    :'';
  uiDialog({icon:'🏁',width:560,
    title:(Z?'必要關單文件已齊全 — 確認申報完工？':'All mandatory close-out documents present — declare completion?'),
    sub:sub,okText:(Z?'確認申報完工':'Declare completion'),okClass:'btn-success fw-bold',
    html:table+recNote+'<div class="uiNote" style="background:#f2faf5;border-color:#bfe5cd;border-left-color:#1e7e34;color:#1c4a2e">'+decl+
      '<br><span class="small" style="opacity:.8">'+(Z?'送出後將依序由承商職安衛 → NMDC 施工 → EHS → 協調員確認關單。':'After submission, close-out is confirmed in sequence by Contractor HSE → NMDC Construction → EHS → Coordinator.')+'</span></div>'})
  .then(function(ok){ if(!ok) return;
    api('ptw.requestClosure',{ptwId:cur.id,wcDeclarationAccepted:true}).then(function(res){
      if(res.ok){ toast(lang==='zh'?'已申報完工，進入結案確認流程':'Completion declared — close-out review started',true); openPtwForm(cur.id); } else toast(apiMsg(res));
    });
  });
}
function doClose(){
  uiPrompt(lang==='zh'?'關閉備註（選填，可留空）':'Close comment (optional)').then(function(comment){
    if(comment===null) return;
    uiConfirm(lang==='zh'?'確認正式關閉此 PTW？':'Formally close this PTW?').then(function(ok){ if(!ok) return;
      api('ptw.close',{ptwId:cur.id,comment:comment||''}).then(function(res){
        if(res.ok){ toast('Closed 🔒',true); openPtwForm(cur.id); } else toast(apiMsg(res));
      });
    });
  });
}
/* 清單直接下載現場聯（承商每日列印用） */
function quickPdf(id,kind){
  if((kind||'site')==='site'){ siteCopyClient(id); return; }
  serverPdf(id,kind);
}
function serverPdf(id,kind){
  toast('⏳ PDF…',true);
  api('ptw.exportPdf',{ptwId:id,kind:kind||'site'}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    (res.data.files||[]).forEach(function(f,i){
      setTimeout(function(){
        var bytes=atob(f.base64), arr=new Uint8Array(bytes.length);
        for(var j=0;j<bytes.length;j++) arr[j]=bytes.charCodeAt(j);
        var a=document.createElement('a');
        a.href=URL.createObjectURL(new Blob([arr],{type:f.mimeType}));
        a.download=f.fileName; a.click();
      },i*600);
    });
    toast((res.data.files||[]).length+' PDF ✅',true);
  });
}
/* 現場聯：轉換引擎載入 iframe 內執行（樣式完整保留，輸出與樣張一致），並自動存入 Drive 01_Application */
var H2P_URL=window.H2P_SRC||'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
function siteCopyClient(id){
  toast('⏳ Site Copy PDF…',true);
  api('ptw.siteHtml',{ptwId:id}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var iframe=document.createElement('iframe');
    // A4 @ 96dpi：794×1123；引擎於 iframe 內執行，樣式不會丟失
    iframe.style.cssText='position:fixed;left:-12000px;top:0;width:794px;height:1200px;border:0';
    document.body.appendChild(iframe);
    var fallback=function(){ try{ iframe.remove(); }catch(e){} sitePrintView(res.data.html)||serverPdf(id,'site'); };
    var done=false;
    var t=setTimeout(function(){ if(!done){ done=true; fallback(); } },45000);
    iframe.onload=function(){
      var w=iframe.contentWindow,d=iframe.contentDocument;
      var sc=d.createElement('script');
      sc.src=H2P_URL;
      sc.onerror=function(){ try{ console.error('[sitepdf] engine load failed:',H2P_URL); }catch(_){} if(!done){ done=true; clearTimeout(t); fallback(); } };
      sc.onload=function(){
        setTimeout(function(){
          try{
            d.body.style.margin='0';
            // A4 滿版：量測內容高度，不足處自動加高 Re-validation 簽名列（滿頁又更好手寫）
            try{
              var TARGET=1092; // A4 1123px − 上下邊界(4mm×2)
              var h0=d.body.scrollHeight;
              if(h0<TARGET-6){
                var rows=d.querySelectorAll('.rv td');
                var rowCount=d.querySelectorAll('.rv tr').length-1; // 去表頭
                if(rowCount>0){
                  var per=Math.floor((TARGET-h0)/rowCount);
                  if(per>0){
                    var st=d.createElement('style');
                    st.textContent='.rv td{height:'+(23+per)+'px !important}';
                    d.head.appendChild(st);
                  }
                }
                // 殘餘 1~數 px：微調備註區底部留白
                var h1=d.body.scrollHeight;
                if(h1<TARGET-2){
                  var st2=d.createElement('style');
                  st2.textContent='.notes ol{padding-bottom:'+(TARGET-h1)+'px}';
                  d.head.appendChild(st2);
                }
              }
            }catch(e2){}
            w.html2pdf().set({
              margin:4, // 跨 iframe 環境需用純數字（陣列在 iframe 內判別會失敗）
              image:{type:'jpeg',quality:0.96},
              html2canvas:{scale:2,useCORS:true,logging:false},
              jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}
            }).from(d.body).outputPdf('datauristring').then(function(uri){
              if(done) return; done=true; clearTimeout(t);
              var a=document.createElement('a'); a.href=uri; a.download=res.data.fileName; a.click();
              api('ptw.saveSitePdf',{ptwId:id,base64:uri.split(',')[1],fileName:res.data.fileName})
                .then(function(sv){ toast(sv.ok?(lang==='zh'?'Site Copy ✅ 已下載並存入 Drive 01_Application':'Site Copy ✅ downloaded & saved to Drive 01_Application'):('PDF ✅ (Drive: '+apiMsg(sv)+')'),true); });
              iframe.remove();
            }).catch(function(err){ try{ console.error('[sitepdf] worker failed:',err); }catch(_){} if(!done){ done=true; clearTimeout(t); fallback(); } });
          }catch(e){ try{ console.error('[sitepdf] exception:',e); }catch(_){} if(!done){ done=true; clearTimeout(t); fallback(); } }
        },500); // 等字型/圖片就緒
      };
      d.head.appendChild(sc);
    };
    iframe.srcdoc=res.data.html;
  });
}
/* 備援：列印檢視（瀏覽器列印引擎 100% 保真，可直接列印或另存 PDF） */
function sitePrintView(html){
  try{
    var w=window.open('','_blank');
    if(!w) return false;
    w.document.open(); w.document.write(html); w.document.close();
    w.onload=function(){ setTimeout(function(){ w.print(); },400); };
    toast(lang==='zh'?'已開啟列印檢視 — 可直接列印或「另存為 PDF」':'Print view opened — print or "Save as PDF"',true);
    return true;
  }catch(e){ return false; }
}
function quickSiteCopy(id){ quickPdf(id,'site'); }
/* ---- PDF 下載 ---- */
function downloadPdf(kind){
  kind=kind||'all';
  if(kind==='site'){ siteCopyClient(cur.id); return; } // 現場聯一律走瀏覽器引擎（美化版）
  var btnId=(kind==='certs'?'btnPdfCert':'btnPdf');
  var btn=$(btnId), old=btn.innerHTML; btn.disabled=true; btn.textContent='⏳ …';
  api('ptw.exportPdf',{ptwId:cur.id,kind:kind}).then(function(res){
    btn.disabled=false; btn.innerHTML=old;
    if(!res.ok){ toast(apiMsg(res)); return; }
    if(!res.data.files.length){ toast(lang==='zh'?'沒有可下載的文件':'Nothing to download'); return; }
    res.data.files.forEach(function(f,i){
      setTimeout(function(){
        var bytes=atob(f.base64), arr=new Uint8Array(bytes.length);
        for(var j=0;j<bytes.length;j++) arr[j]=bytes.charCodeAt(j);
        var a=document.createElement('a');
        a.href=URL.createObjectURL(new Blob([arr],{type:f.mimeType}));
        a.download=f.fileName; a.click();
      },i*600);
    });
    toast((lang==='zh'?'已產生 ':'Generated ')+res.data.files.length+' PDF',true);
  });
}
/* ---- 審核動作（M3.4） ---- */
function renderReviewBar(){
  var u=getUser()||{};
  var myTurn=isMyReviewTurn();
  // 僅在最後一步顯示核准/退回（全部無意見→核准；任一步有意見→退回）
  $('reviewBar').classList.toggle('d-none',!myTurn||curStep!==STEPS.length-1);
  $('returnForm').classList.add('d-none');
  if(myTurn){
    $('rvPrevOpt').style.display=(Number(cur.currentTier)>2)?'':'none';
    // 每一步都須標記；全部「無意見」才可核准，任一步有意見 → 只能退回
    var allMarked=true,cmts=[];
    for(var i=0;i<STEPS.length;i++){
      if(!rvStepMarked(i)) allMarked=false;
      var st=(cur._stepRv||{})[i];
      if(st&&!st.ok&&String(st.c||'').trim()) cmts.push('[Step '+(i+1)+' '+(lang==='zh'?STEPS[i].zh:STEPS[i].en)+'] '+st.c.trim());
    }
    var hasCmt=cmts.length>0;
    var btns=$('reviewBar').querySelectorAll('button');
    btns.forEach(function(b){
      var isApprove=b.getAttribute('onclick')==='openApprove()';
      b.disabled=!allMarked||(isApprove&&hasCmt);
    });
    cur._rvCmts=cmts;
    var hint=$('rvGateHint');
    if(!hint){
      hint=document.createElement('div'); hint.id='rvGateHint'; hint.className='small text-danger mt-1';
      $('reviewBar').appendChild(hint);
    }
    hint.textContent=!allMarked
      ?('🔒 '+(lang==='zh'?'每一步驟皆須標記「無意見」或填寫意見後，才可核准/退回':'Mark every step (No issues / Comment) before you can approve or return'))
      :(hasCmt?('💬 '+(lang==='zh'?('有 '+cmts.length+' 步驟留有意見 — 僅能退回處理，意見已帶入退回表單'):(cmts.length+' step(s) have comments — the PTW must be returned; comments prefilled')) ):'');
    if(allMarked&&hasCmt){
      $('returnForm').classList.remove('d-none');
      if(!$('rvComment').value.trim()) $('rvComment').value=cmts.join('\\n');
      // 有意見 → 預設退回上一關（Tier 2 則退回申請人）
      $('rvTarget').value=(Number(cur.currentTier)>2)?'previousTier':'applicant';
    }
  }
  // 啟用步驟已移除：T5 核准即生效（Active）
}
function exportPtwList(){
  api('ptw.list',{status:$('pfStatus').value,q:$('pfQ').value.trim(),mine:$('pfMine').checked?1:'',forExport:1}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var rows=[['No.','Status','Company','Location','Work','Valid From','Valid To','Tier','Version','Updated']]
      .concat(res.data.rows.map(function(r){ return [r.number,r.status,r.company,r.areaLocation,r.workDescription,r.validFrom,r.validTo,r.currentTier,r.version,r.updatedAt]; }));
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'PTW');
    XLSX.writeFile(wb,'ptw_list_'+new Date().toISOString().substring(0,10)+'.xlsx');
  });
}
/* 版本比較 */
function renderVersionsData(versions){
  if(!versions||versions.length<2){ $('verCompareWrap').classList.add('d-none'); return; }
  $('verCompareWrap').classList.remove('d-none');
  var opts=versions.map(function(v){ return '<option value="'+v.version+'">v'+v.version+'（'+esc(v.submittedAt)+'）</option>'; }).join('');
  $('verA').innerHTML=opts; $('verB').innerHTML=opts;
  $('verA').value=versions[versions.length-2].version;
  $('verB').value=versions[versions.length-1].version;
  $('verDiff').innerHTML='';
}
function loadVersions(){
  api('ptw.versionDiff',{ptwId:cur.id}).then(function(res){
    if(res.ok) renderVersionsData(res.data.versions);
  });
}
function compareVersions(){
  api('ptw.versionDiff',{ptwId:cur.id,v1:$('verA').value,v2:$('verB').value}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    var d=res.data.diff||[];
    if(!d.length){ $('verDiff').innerHTML='<div class="small text-muted">兩版本相同 No differences</div>'; return; }
    var h='<table class="table table-sm"><thead><tr><th>欄位 Field</th><th>v'+esc(res.data.v1)+'</th><th>v'+esc(res.data.v2)+'</th></tr></thead><tbody>';
    d.forEach(function(x){ h+='<tr><td class="small">'+esc(x.field)+'</td><td class="small" style="background:#fdecea">'+esc(x.from)+'</td><td class="small" style="background:#e8f5e9">'+esc(x.to)+'</td></tr>'; });
    $('verDiff').innerHTML=h+'</tbody></table>';
  });
}
/* ===== 管理員：直接調整關卡 ===== */
function renderAdminStage(){
  var w=$('adminStageWrap'); if(!w) return;
  var u=getUser()||{};
  var isAdm=u.isAdmin===true||u.isAdmin==='TRUE'||Number(u.tier)===5;
  if(!isAdm||!cur||['Closed','Cancelled'].indexOf(cur.status)>=0){ w.innerHTML=''; return; }
  var Z=(lang==='zh');
  var opts=[
    ['T2',Z?'移至第 2 關審核（承商職安衛）':'Move to Tier 2 review (Contractor HSE)'],
    ['T3',Z?'移至第 3 關審核（NMDC 施工組）':'Move to Tier 3 review (NMDC Engineering)'],
    ['T4',Z?'移至第 4 關審核（NMDC 工安組）':'Move to Tier 4 review (NMDC HSE)'],
    ['T5',Z?'移至第 5 關審核（PTW 協調員）':'Move to Tier 5 review (PTW Coordinator)'],
    ['ACTIVE',Z?'⚡ 直接核准並核發生效（Active）':'⚡ Directly approve & issue (Active)'],
    ['RETURN',Z?'退回申請人修改（可編輯）':'Return to applicant for revision (editable)'],
    ['CO2',Z?'結案確認：承商職安衛':'Close-out step: Contractor HSE'],
    ['CO3',Z?'結案確認：NMDC 施工組':'Close-out step: NMDC Engineering'],
    ['CO4',Z?'結案確認：NMDC 工安組':'Close-out step: NMDC HSE'],
    ['CO5',Z?'結案確認：PTW 協調員（確認即關單）':'Close-out step: PTW Coordinator (final)']];
  w.innerHTML='<div class="card-x p-3 my-2" style="border:1.5px solid #b8860b;background:#fffdf4">'+
    '<h6 style="cursor:pointer;margin-bottom:0;color:#7a5a00" onclick="var b=$(\\'asBody\\');b.classList.toggle(\\'d-none\\');$(\\'asArrow\\').textContent=b.classList.contains(\\'d-none\\')?\\'▸\\':\\'▾\\'">⚙️ '+
    (Z?'管理員：直接調整關卡':'Admin: Force stage override')+
    '<span id="asArrow" style="float:right;color:#7a5a00">▸</span></h6>'+
    '<div id="asBody" class="d-none mt-2">'+
    '<div class="small mb-2" style="color:#8a6d00">'+(Z
      ?'⚠️ 跳過的關卡將沒有簽名與核准紀錄（Site Copy 該關顯示空白）。此操作會被記錄於簽核歷程與稽核紀錄。'
      :'⚠️ Skipped steps will have NO signature/approval record (blank on the Site Copy). This action is logged in the approval history and audit log.')+'</div>'+
    '<div class="d-flex gap-2 flex-wrap align-items-start">'+
    '<select id="asTarget" class="form-select form-select-sm" style="max-width:340px">'+
    opts.map(function(o){ return '<option value="'+o[0]+'">'+o[1]+'</option>'; }).join('')+'</select>'+
    '<button class="btn btn-sm btn-warning" onclick="doForceStage()">'+(Z?'執行調整':'Apply')+'</button></div>'+
    '<textarea id="asReason" class="form-control form-control-sm mt-2" rows="2" placeholder="'+
    (Z?'調整原因（必填）＊':'Reason (required) *')+'"></textarea>'+
    '</div></div>';
}
function doForceStage(){
  var Z=(lang==='zh');
  var reason=($('asReason').value||'').trim();
  if(!reason){ toast(Z?'⚠️ 請填寫調整原因':'⚠️ Please enter a reason'); $('asReason').focus(); return; }
  var sel=$('asTarget'); var label=sel.options[sel.selectedIndex].textContent;
  uiConfirm((Z?'確定要執行管理員關卡調整？\\n\\n→ ':'Apply admin stage override?\\n\\n→ ')+label+
    (Z?'\\n\\n原因：':'\\n\\nReason: ')+reason).then(function(ok){
    if(!ok) return;
    api('admin.ptw.forceStage',{ptwId:cur.id,target:sel.value,reason:reason}).then(function(res){
      if(!res.ok){ toast(apiMsg(res)); return; }
      toast('✅ '+(Z?(res.data.descZh||'已調整'):(res.data.descEn||'Stage updated'))+
        (res.data.target==='ACTIVE'?(' — '+res.data.number):''),true);
      openPtwForm(cur.id);
    });
  });
}
function renderHistoryData(data){
  var h='';
  (data&&data.approvals||[]).forEach(function(a){
    var icon=a.action==='Approve'?'✅':(a.action==='AdminOverride'?'⚙️':'↩️');
    h+='<div class="border-bottom py-1">'+icon+' <b>Tier '+esc(a.tier)+'</b> '+esc(a.tierName)+' · '+esc(a.reviewer)+
      ' · '+esc(a.action)+(a.returnReason?' ['+esc(a.returnReason)+']':'')+
      (a.comment?'<br><span class="ms-4">💬 '+esc(a.comment)+'</span>':'')+
      '<span class="text-muted"> · v'+esc(a.version)+' · '+esc(a.decidedAt)+(a.hasSignature?' · ✍️':'')+'</span></div>';
  });
  $('histList').innerHTML=h||'<span class="text-muted">—</span>';
}
function loadHistory(){
  loadVersions();
  api('approval.history',{ptwId:cur.id}).then(function(res){
    if(!res.ok){ $('histList').textContent=apiMsg(res); return; }
    renderHistoryData(res.data);
  });
}
/* 簽名板 */
var sigDrawn=false;
function openApprove(){
  var u=getUser()||{};
  $('sigWho').textContent=(lang==='zh'?'簽署人：':'Signing as: ')+bi(u.nameEn,u.nameZh)+' · Tier '+u.tier;
  // (通知) 下一關審閱人選擇（T5 簽發時無下一關）
  $('apNextRevWrap').classList.add('d-none');
  if(Number(cur.currentTier)<5){
    var toTier3=(Number(cur.currentTier)===2); // T2→T3：可複選多位（不同船別不同施工組）
    api('ptw.nextReviewers',{ptwId:cur.id}).then(function(res){
      if(!res.ok||!res.data.users||!res.data.users.length) return;
      $('apNextRev').classList.toggle('d-none',toTier3);
      $('apNextRevMulti').classList.toggle('d-none',!toTier3);
      $('apNextRevHint').classList.toggle('d-none',!toTier3);
      if(toTier3){
        $('apNextRevMulti').innerHTML=res.data.users.map(function(p){
          var nm=esc(lang==='zh'?(p.nameZh||p.nameEn):(p.nameEn||p.nameZh));
          return '<div class="form-check"><input class="form-check-input" type="checkbox" id="anr_'+esc(p.id)+'">'+
            '<label class="form-check-label small" for="anr_'+esc(p.id)+'">👤 '+nm+
            (p.title?' <span class="text-muted">'+esc(p.title)+'</span>':'')+'</label></div>';
        }).join('');
      }else{
        var h='<option value="">📣 '+T('rv.notifyAll')+'</option>';
        res.data.users.forEach(function(p){
          h+='<option value="'+esc(p.id)+'">👤 '+esc(lang==='zh'?(p.nameZh||p.nameEn):(p.nameEn||p.nameZh))+'</option>';
        });
        $('apNextRev').innerHTML=h;
      }
      if(res.data.users.length>1) $('apNextRevWrap').classList.remove('d-none');
    });
  }
  // 一律使用帳號簽名檔；尚未設定 → 先保存目前進度，再跳警告視窗引導前往設定（不提供手寫）
  if(!(cur&&cur._mySignature)){
    // 先儲存：申請草稿（若可編輯）＋本 PTW 的逐步審查進度（回來後自動還原）
    try{
      if(cur&&cur.editable){ collectStep(); if(dirty) saveNow(); }
      if(cur&&cur.id) sset('ptw_rv_'+cur.id,JSON.stringify(cur._stepRv||{}));
    }catch(e){}
    var Zs=(lang==='zh');
    uiDialog({icon:'✍️',width:560,
      title:(Zs?'尚未設定簽名檔':'Signature not set up'),
      sub:(Zs?'核准必須附上您註冊的簽名':'Approvals must carry your registered signature'),
      okText:(Zs?'前往設定 →':'Go to setup →'), okClass:'btn-warning fw-bold',
      headColor:'linear-gradient(135deg,#8a5a00 0%,#c8860d 100%)',
      html:'<p style="margin:0 0 12px;font-size:15px;line-height:1.75;color:#1b2c3d;font-weight:600">'+
        (Zs?'請先於「我的帳號」完成簽名檔設定，才能繼續核准這份 PTW。'
           :'Please set up your signature in My Account before approving this PTW.')+'</p>'+
        '<table class="uiKV mb-3">'+
        '<tr><td class="k">'+(Zs?'目前進度':'Your progress')+'</td><td class="v">✅ '+
          (Zs?'已自動保存，設定完成後回到此 PTW 即可接續審查':'Saved automatically — return to this PTW to continue')+'</td></tr>'+
        '<tr><td class="k">'+(Zs?'簽名檔怎麼做':'How to create it')+'</td><td class="v">'+
          (Zs?'於白紙上簽名 → 拍照上傳，系統會<b>自動去背</b>':'Sign on white paper → photograph and upload; the background is <b>removed automatically</b>')+'</td></tr>'+
        '</table>'+
        '<div class="uiNote">'+(Zs?'簽名檔只需設定一次，之後所有審核、簽發都會自動套用。'
          :'You only need to do this once — every later approval and issue will use it automatically.')+'</div>'})
    .then(function(ok){
      if(ok){ openAccount(); setTimeout(function(){
        var el=document.getElementById('acSigFile');
        if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});
          var box=el.closest('.card-x')||el.parentElement;
          box.style.outline='3px solid #f0a500'; setTimeout(function(){ box.style.outline=''; },4000); }
      },800); }
    });
    return;
  }
  $('sigModal').classList.remove('d-none');
  $('sigAccImg').src='data:image/png;base64,'+cur._mySignature;
  sigSwitchToAcc();
}
/* 簽名模式：acc = 使用帳號簽名檔；draw = 手寫 */
var sigMode='acc';
function sigSwitchToAcc(){
  sigMode='acc';
  $('sigAccWrap').classList.remove('d-none');
  $('sigDrawWrap').classList.add('d-none');
  $('btnSigClear').classList.add('d-none');
}
function sigSwitchToDraw(){
  sigMode='draw';
  $('sigAccWrap').classList.add('d-none');
  $('sigDrawWrap').classList.remove('d-none');
  $('btnSigClear').classList.remove('d-none');
  if(cur&&cur._mySignature) $('sigBackAcc').classList.remove('d-none');
  initSigPad(); clearSig();
}
var sigInit=false;
function initSigPad(){
  if(sigInit) return; sigInit=true;
  var c=$('sigCanvas'), ctx=c.getContext('2d'), drawing=false, last=null;
  function pos(e){
    var r=c.getBoundingClientRect();
    var t=e.touches?e.touches[0]:e;
    return {x:(t.clientX-r.left)*(c.width/r.width),y:(t.clientY-r.top)*(c.height/r.height)};
  }
  function start(e){ drawing=true; last=pos(e); e.preventDefault(); }
  function move(e){
    if(!drawing) return;
    var p=pos(e);
    ctx.strokeStyle='#123'; ctx.lineWidth=2.5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke();
    last=p; sigDrawn=true; e.preventDefault();
  }
  function end(){ drawing=false; }
  c.addEventListener('mousedown',start); c.addEventListener('mousemove',move);
  window.addEventListener('mouseup',end);
  c.addEventListener('touchstart',start,{passive:false});
  c.addEventListener('touchmove',move,{passive:false});
  c.addEventListener('touchend',end);
}
function clearSig(){
  var c=$('sigCanvas'); c.getContext('2d').clearRect(0,0,c.width,c.height); sigDrawn=false;
}
function confirmApprove(){
  var dataUrl;
  if(sigMode==='acc'&&cur&&cur._mySignature){
    dataUrl='data:image/png;base64,'+cur._mySignature;   // 直接使用帳號簽名檔
  }else{
    if(!sigDrawn){ toast(lang==='zh'?'請先簽名':'Please sign first'); return; }
    dataUrl=$('sigCanvas').toDataURL('image/png');
  }
  $('sigModal').classList.add('d-none');
  var nrvIds=[];
  if(!$('apNextRevWrap').classList.contains('d-none')){
    if(!$('apNextRevMulti').classList.contains('d-none')){
      document.querySelectorAll('#apNextRevMulti input:checked').forEach(function(el){ nrvIds.push(el.id.substring(4)); });
    }else if($('apNextRev').value){ nrvIds=[$('apNextRev').value]; }
  }
  api('approval.approve',{ptwId:cur.id,comment:$('apComment').value.trim(),signatureDataUrl:dataUrl,nextReviewerIds:nrvIds}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    try{ sset('ptw_rv_'+cur.id,''); }catch(e){}
    toast((lang==='zh'?'已核准 → ':'Approved → ')+res.data.newStatus+(res.data.newStatus==='Approved'?' · '+res.data.number:''),true);
    openPtwForm(cur.id);
  });
}
function toggleReturnForm(){ $('returnForm').classList.toggle('d-none'); }
function toggleHist(){
  var b=$('histBody'),a=$('histArrow');
  var open=b.classList.contains('d-none');
  b.classList.toggle('d-none',!open);
  a.textContent=open?'▾':'▸';
}
function doReturn(){
  var comment=$('rvComment').value.trim();
  if(!comment){ toast(lang==='zh'?'退回必須填寫 Comment':'Comment is required'); return; }
  uiConfirm(lang==='zh'?'確認退回此 PTW？':'Confirm return?').then(function(ok){ if(!ok) return;
  api('approval.return',{ptwId:cur.id,comment:comment,returnReason:$('rvReason').value,target:$('rvTarget').value})
  .then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    try{ sset('ptw_rv_'+cur.id,''); }catch(e){}
    toast((lang==='zh'?'已退回':'Returned')+' → '+res.data.newStatus,true);
    openPtwForm(cur.id);
  });});
}
function doActivate(){
  uiConfirm(lang==='zh'?'確認啟用此 PTW（開始執行）？':'Activate this PTW?').then(function(ok){ if(!ok) return;
  api('approval.activate',{ptwId:cur.id}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    toast('Active ✅',true); openPtwForm(cur.id);
  });});
}
function closePtwForm(){ if(dirty) saveNow(); cur=null; openPtwList(); }
function updateCompletion(pct){ var b=$('pfCompletion'); b.style.width=Math.max(3,pct)+'%'; b.textContent=pct+'%'; }
/** 持有人清單：帶 ptwId 讓後端依「該 PTW 的申請公司」過濾（管理員代承商建單時才會不同於自己的公司） */
var pickerLoading=false;
function loadPickerUsers(cb,companyId){
  // 同時帶 companyId：切換公司當下草稿可能還沒存完，直接指定可避免讀到舊公司
  var co=companyId||(cur&&cur.companyId)||'';
  if(pickerLoading) return;
  pickerLoading=true;
  api('ptw.pickerUsers',{ptwId:(cur&&cur.id)||'',companyId:co},{silent:true}).then(function(res){
    pickerLoading=false;
    pickerCache=res.ok?res.data:[];
    pickerCacheCo=co;
    // 清單換了就一定要重繪目前步驟，否則第 4 步的持有人清單會停在舊資料
    if(cur) renderStepContent();
    if(cb) cb();
  },function(){ pickerLoading=false; });
}
/** 公司清單（唯讀顯示名稱與管理員下拉都需要）— ptw.open 已一併回傳，此處僅作後備 */
function ensureCompanies(cb){
  if(companyCache){ if(cb) cb(); return; }
  api('company.list',{},{silent:true}).then(function(res){
    companyCache=res.ok?res.data:[];
    if(cb) cb(); else if(cur) renderStepContent();
  });
}

/* ---- 表單元件 ---- */
function fld(id,label,type,val,ro){
  var d='<div class="mb-2"><label class="form-label small mb-0">'+esc(L(label))+'</label>';
  var dis=ro?' disabled':'';
  if(type==='ta') d+='<textarea class="form-control form-control-sm pfld" id="f_'+id+'" rows="2"'+dis+'>'+esc(val||'')+'</textarea>';
  else if(type==='d') d+='<input type="date" class="form-control form-control-sm pfld" id="f_'+id+'" value="'+esc(val||'')+'"'+dis+'>';
  else if(type==='dt') d+='<input type="datetime-local" class="form-control form-control-sm pfld" id="f_'+id+'" value="'+esc((val||'').replace(' ','T').substring(0,16))+'"'+dis+'>';
  else if(type==='n') d+='<input type="number" class="form-control form-control-sm pfld" id="f_'+id+'" value="'+esc(val||'')+'"'+dis+'>';
  else d+='<input class="form-control form-control-sm pfld" id="f_'+id+'" value="'+esc(val||'')+'"'+dis+'>';
  return d+'</div>';
}
function ynFld(id,label,val,ro){
  var dis=ro?' disabled':'';
  return '<div class="d-flex justify-content-between align-items-center border-bottom py-1"><span class="small">'+esc(L(label))+'</span>'+
    '<span class="text-nowrap ms-2">'+
    '<label class="me-2"><input type="radio" name="f_'+id+'" value="Y" class="pfld"'+(val==='Y'?' checked':'')+dis+'> Yes 是</label>'+
    '<label><input type="radio" name="f_'+id+'" value="N" class="pfld"'+(val==='N'?' checked':'')+dis+'> No 否</label></span></div>';
}
/** 申請公司欄位：Tier 1–2 顯示唯讀（固定本公司）；Tier 3–5／管理員可代承商選擇 */
var companyCache=null;
/** PTW 表單用的公司名稱（注意：管理台另有同名的 companyName()，故此處用不同名稱避免覆蓋） */
function ptwCompanyName(id){
  var c=(companyCache||[]).filter(function(x){ return x.id===id; })[0];
  if(!c){ var u=getUser(); return (u&&u.companyId===id)?(u.companyName||''):''; }
  return lang==='zh'?(c.nameZh||c.nameEn):(c.nameEn||c.nameZh);
}
function canPickCompany(){ var u=getUser(); return !!(u&&(asB(u.isAdmin)||Number(u.tier)>=3)); }
function companyFld(ro){
  var Z=(lang==='zh'), label=Z?'申請公司 Applicant Company':'Applicant Company 申請公司';
  if(!companyCache){ ensureCompanies(); }   // 後備：ptw.open 沒帶回來時補抓一次
  if(!canPickCompany()||ro){
    return '<div class="mb-2"><label class="form-label small mb-0">'+esc(label)+'</label>'+
      '<input class="form-control form-control-sm" value="'+esc(ptwCompanyName(cur.companyId)||'—')+'" disabled></div>';
  }
  var opts=(companyCache||[]).filter(function(c){ return c.isActive!==false; })
    .map(function(c){
      var nm=bi(c.nameEn,c.nameZh);
      return '<option value="'+esc(c.id)+'"'+(c.id===cur.companyId?' selected':'')+'>'+
        (c.type==='Contractor'?'🏗 ':'🏢 ')+esc(nm)+'</option>';
    }).join('');
  return '<div class="mb-2"><label class="form-label small mb-0">'+esc(label)+
    ' <span class="text-danger">*</span></label>'+
    '<select class="form-select form-select-sm" id="f_companyId" onchange="onCompanyChange()">'+
    (cur.companyId?'':'<option value="">'+(Z?'— 請選擇申請公司 —':'— Select the applicant company —')+'</option>')+
    opts+'</select>'+
    '<div class="form-text small">'+(Z
      ?'代承商建立 PTW 時請先選擇公司；步驟 4 的持有人清單只會列出該公司的人員。'
      :'Select the company you are raising this PTW for — the Step 4 holder list shows only that company\\'s personnel.')+'</div></div>';
}
function onCompanyChange(){
  var sel=$('f_companyId'); if(!sel) return;
  var newId=sel.value;
  if(!newId||newId===cur.companyId) return;
  cur.companyId=newId;
  // 換公司 → 清掉非該公司的持有人並重新載入人員清單
  cur.holderUserId=''; cur.coHolderUserId=''; pickerCache=null; pickerCacheCo=newId;
  markDirty();
  // 先存草稿再抓人員（避免後端仍讀到舊公司），並在取回後重繪，讓步驟 4 立刻換成該公司人員
  api('ptw.saveDraft',{ptwId:cur.id,companyId:newId,holderUserId:'',coHolderUserId:''},{silent:true})
    .then(function(){
      dirty=false;
      loadPickerUsers(function(){
        toast((lang==='zh'?'已切換申請公司：':'Applicant company set to: ')+ptwCompanyName(newId)+
          '（'+(lang==='zh'?'持有人清單已更新':'holder list updated')+'）',true);
      },newId);
    });
}
function chkGrid(defs,checks,prefixCls,ro){
  var dis=ro?' disabled':'';
  var h='<div class="d-flex flex-wrap gap-1">';
  defs.forEach(function(d){
    var on=!!checks[d[0]];
    h+='<label class="chkpill'+(on?' on':'')+'" for="c_'+d[0]+'">'+
      '<input class="form-check-input pfld '+prefixCls+'" type="checkbox" id="c_'+d[0]+'"'+(on?' checked':'')+dis+
      ' onchange="this.closest(\\'.chkpill\\').classList.toggle(\\'on\\',this.checked)"> '+esc(L(d[1]))+'</label>';
  });
  return h+'</div>';
}
function personSel(id,label,val,ro){
  var dis=ro?' disabled':'';
  var h='<div class="mb-2"><label class="form-label small mb-0">'+esc(label)+'</label>'+
    '<select class="form-select form-select-sm pfld" id="f_'+id+'"'+dis+'><option value="">--</option>';
  (pickerCache||[]).forEach(function(u){
    h+='<option value="'+esc(u.id)+'"'+(val===u.id?' selected':'')+'>'+esc(bi(u.nameEn,u.nameZh)+'（'+u.title+'）')+'</option>';
  });
  return h+'</select></div>';
}

/* ---- Stepper ---- */
function isMyReviewTurn(){
  if(!cur) return false;
  var u=getUser()||{};
  return ['PendingTier2Review','PendingTier3Review','PendingTier4Review','PendingTier5Review'].indexOf(cur.status)>=0 &&
    Number(u.tier)===Number(cur.currentTier) && cur.applicantUserId!==u.id;
}
function gotoStep(i){
  // (3) 審查人強制依序：不可往前跳步（可回看）
  if(isMyReviewTurn() && i>(cur._maxSeen||0)+1){
    toast(T('rv.noSkip'));
    return;
  }
  // 審查人：本步驟須先標記「無意見」或填寫意見才能前進
  if(isMyReviewTurn() && i>curStep && !rvStepMarked(curStep)){
    toast(lang==='zh'?'請先於下方選擇「無意見」或填寫審查意見':'Please mark "No issues" or leave a comment for this step first');
    return;
  }
  // 申請人：步驟前進閘門
  if(cur&&cur.editable&&i>curStep){
    collectStep();
    if(curStep===0&&cur.scaffoldingRequired==='Y'&&!cur._checks.scaffoldConfirm){
      toast(lang==='zh'?'⚠️ 請先勾選施工架/高處作業安全確認':'⚠️ Please confirm the scaffolding / work-at-height safety requirements first');
      var sc=$('c_scaffoldConfirm'); if(sc){ sc.closest('.alert').scrollIntoView({behavior:'smooth',block:'center'}); }
      return;
    }
    if(curStep===3&&!idListOf(cur.holderUserId).length){
      toast(lang==='zh'?'⚠️ 請至少勾選一位主持有人':'⚠️ Please select at least one Holder');
      return;
    }
  }
  if(cur&&cur.editable&&curStep!==i){
    collectStep();
    if(dirty) saveNow(false,true); // 換步驟自動存檔：背景進行，不擋畫面
  }
  curStep=Math.max(0,Math.min(STEPS.length-1,i));
  if(isMyReviewTurn()&&curStep>(cur._maxSeen||0)){ cur._maxSeen=curStep; renderReviewBar(); }
  var nav='';
  var rvLimit=isMyReviewTurn()?((cur._maxSeen||0)+1):99;
  STEPS.forEach(function(s,j){
    var locked=(j>rvLimit);
    nav+='<button class="btn btn-sm '+(j===curStep?'btn-navy':'btn-outline-secondary')+'"'+(locked?' disabled style="opacity:.45"':'')+' onclick="gotoStep('+j+')">'+
      (locked?'🔒 ':'')+s.n+'. '+(lang==='zh'?s.zh:s.en)+'</button>';
  });
  $('stepNav').innerHTML=nav;
  $('btnPrevStep').disabled=(curStep===0);
  $('btnNextStep').style.visibility=(curStep===STEPS.length-1)?'hidden':'visible';
  renderStepContent();
  window.scrollTo(0,0);
}
function renderStepContent(){
  var ro=!cur.editable, h='<div class="card-x stepcard p-3">';
  var C=cur._checks;
  var sect=function(t){ return '<h6 class="sect">'+esc(L(t))+'</h6>'; };
  if(curStep===0){
    h+=sect('1-1. PTW 基本資料 Permit Information')+
      companyFld(ro)+
      '<div class="row"><div class="col-md-4">'+fld('vessel','工作船舶 Vessel','t',cur.vessel,ro)+'</div>'+
      '<div class="col-md-4">'+fld('executionDate','申請日期 Application Date','d',String(cur.executionDate||'').substring(0,10),ro)+'</div>'+
      '<div class="col-md-4">'+fld('continuationOfPermitNo','延續許可證號 Continuation Permit No','t',cur.continuationOfPermitNo,ro)+'</div></div>'+
      fld('areaLocation','區域/位置（請詳述）Area / Location (describe in detail)','ta',cur.areaLocation,ro)+
      sect('1-2. 作業類型 Work Type')+
      '<div class="small text-muted mb-1">'+(lang==='zh'?'勾選後需於 Step 5 完成對應證書；請參考各類型說明勾選':'Checked types require the matching certificate in Step 5 — see the description of each type')+'</div>';
    var Z0=(lang==='zh');
    h+='<div class="row g-2 mb-2">'+WT_DEF.map(function(d){
      return '<div class="col-md-6"><div class="border rounded p-2 h-100" style="background:#fff">'+
        '<div class="form-check mb-0"><input class="form-check-input pfld" type="checkbox" id="c_'+d[0]+'"'+
        (asB(cur[d[0]])?' checked':'')+(ro?' disabled':'')+'>'+
        '<label class="form-check-label fw-bold small" for="c_'+d[0]+'">'+esc(L(d[1]))+'</label></div>'+
        '<div class="small text-muted" style="font-size:.72rem;line-height:1.3">'+esc(WT_INTRO[d[0]]?WT_INTRO[d[0]][Z0?0:1]:'')+'</div>'+
        '</div></div>';
    }).join('')+'</div>';
    h+=sect('1-3. 工作內容與有效期限 Work · Tools · Validity')+
      fld('workDescription','待執行工作的描述 Description of Work','ta',cur.workDescription,ro)+
      fld('toolsEquipment','要使用的工具和設備 Tools & Equipment','ta',cur.toolsEquipment,ro)+
      '<div class="row"><div class="col-md-4">'+fld('validFrom','開始日期 Start Date','d',String(cur.validFrom||'').substring(0,10),ro)+'</div>'+
      '<div class="col-md-4">'+fld('validTo','結束日期 End Date','d',String(cur.validTo||'').substring(0,10),ro)+'</div>'+
      '<div class="col-md-4"><label class="form-label small mb-0">'+(lang==='zh'?'可使用天數 Days':'Days 可使用天數')+
        '<span class="text-muted" style="font-weight:400">（'+(lang==='zh'?'含起訖日':'incl. both dates')+'）</span></label>'+
        '<input type="number" min="1" max="90" step="1" class="form-control form-control-sm" id="f_validDays" value="'+esc(validDays())+'"'+(ro?' disabled':'')+'></div></div>'+
      '<div class="small text-muted mb-2">'+(lang==='zh'
        ?'開始日期預設＝申請日期，<b>結束日期自動排出 7 天（含開始日與結束日）</b>，例：9/18 → 9/24。三個欄位互相連動：改<b>開始日期</b>會沿用目前天數往後排、直接輸入<b>天數</b>會重算結束日期、改<b>結束日期</b>則天數即時重算。'
        :'Start defaults to the application date and the end date is auto-set to a <b>7-day window counting both the start and end dates</b> (e.g. 9/18 → 9/24). All three fields are linked: changing the <b>start date</b> keeps the current duration, typing a number of <b>days</b> recalculates the end date, and editing the <b>end date</b> updates the day count.')+'</div>'+
      ynFld('scaffoldingRequired','需要施工架嗎？ Scaffolding required?',cur.scaffoldingRequired,ro)+
      (cur.scaffoldingRequired==='Y'
        ?'<div class="alert py-2 small mt-2" style="background:#fdeaea;border:1px solid #e8a3a3;color:#a33">'+
         '<b>⚠️ '+(lang==='zh'?'施工架／高處作業安全要求':'Scaffolding / Work-at-Height Safety Requirements')+'</b><br>'+(lang==='zh'
          ?'於高處作業時請確認人員使用合格安全帶並保持 <b>100% tie-off</b>；施工架須經合格人員搭設並掛牌後方可使用，<b>每日使用前須檢點</b>確認安全合格；嚴禁攀爬未完成或未經檢查之施工架；工具應繫繩防落，下方作業區應設置警示圍籬。'
          :'For work at height, personnel must use certified full-body harnesses and maintain <b>100% tie-off</b>. Scaffolding must be erected by competent persons and tagged before use, and <b>inspected before use every day</b>. Never climb incomplete or uninspected scaffolding. Tools must be tethered and the area below barricaded.')+
         '<div class="form-check mt-2"><input class="form-check-input pfld" type="checkbox" id="c_scaffoldConfirm"'+
         (cur._checks.scaffoldConfirm?' checked':'')+(ro?' disabled':'')+'>'+
         '<label class="form-check-label fw-bold" for="c_scaffoldConfirm">'+(lang==='zh'
          ?'申請人已閱讀並確認遵守上述要求（未確認無法進入下一步）'
          :'I have read and will comply with the above requirements (required to proceed)')+'</label></div></div>'
        :'');
  }else if(curStep===1){
    h+=sect('3-1. 危害辨識 Hazards Identified')+
      '<div class="small text-muted mb-1">'+(lang==='zh'?'至少勾選一項':'Select at least one')+'</div>'+chkGrid(HZ_DEF,C,'',ro)+
      fld('hzOthers','其他危害 Other hazards','t',cur.hzOthers,ro)+
      sect('3-2. 關鍵安全系統隔離 Critical Safety System Isolation')+
      '<div class="small mb-1" style="color:#a33;font-weight:600">'+(lang==='zh'
        ?'如果有需要隔離以下設備再行工作，請務必勾選'
        :'If any of the following systems must be isolated before work, you MUST tick them')+'</div>'+
      chkGrid(CSS_DEF,C,'',ro)+
      fld('cssOthers','其他 Others','t',cur.cssOthers,ro)+
      sect('3-3. 現場狀況 Plant Status Required')+
      '<div class="small mb-1" style="color:#a33;font-weight:600">'+(lang==='zh'
        ?'如果您的工作現場需要使用這些措施確認「零能量」後才能工作，請勾選'
        :'Tick these if your worksite requires such measures to confirm ZERO ENERGY before work can start')+'</div>'+
      chkGrid(PS_DEF,C,'',ro)+
      fld('psOthers','其他 Others','t',cur.psOthers,ro)+
      sect('3-4. 應採取的預防措施 Precautions to be Taken')+
      '<div class="small mb-1" style="color:#a33;font-weight:600">'+(lang==='zh'
        ?'請根據您辨別出的現場危害進行預防措施（至少勾選一項）'
        :'Select precautions based on the hazards you identified above (at least one)')+'</div>'+
      chkGrid(PC_DEF,C,'',ro)+
      fld('pcOthers','其他 Others','t',cur.pcOthers,ro);
  }else if(curStep===2){
    var needGas=asB(cur.wtHotWork)||asB(cur.wtConfinedSpace);
    h+=sect('3. 氣體測試 Gas Test')+
      (function(){ var Z=(lang==='zh');
        // 何時需要：局限空間/動火強調 + 測試時機表格
        var chip=function(icon,txt){ return '<span style="display:inline-block;background:#a33;color:#fff;'+
          'border-radius:8px;padding:4px 12px;font-weight:800;margin:2px 6px 2px 0">'+icon+' '+txt+'</span>'; };
        var timing=[
          [Z?'作業開始前':'Before work starts', Z?'實施初測，<b>合格方可開始作業</b>':'Initial test — work may begin <b>only after acceptable results</b>'],
          [Z?'作業期間':'During work', Z?'<b>連續監測</b>，或至少<b>每小時複測一次</b>':'<b>Continuous monitoring</b>, or re-test at least <b>every hour</b>'],
          [Z?'中斷 ≥30 分鐘':'Interruption ≥30 min', Z?'恢復作業前<b>重新測試</b>':'<b>Re-test</b> before resuming work']];
        return '<div class="alert alert-light border py-2 small mb-2">📖 <b>'+
          (Z?'何時需要氣體測試？':'When is a gas test required?')+'</b><div class="mt-2">'+
          chip('🕳',Z?'局限空間進入 Confined Space Entry':'Confined Space Entry')+
          chip('🔥',Z?'動火作業 Hot Work':'Hot Work')+
          '<span class="text-muted">'+(Z?'或可能存在缺氧、可燃性或毒性氣體（如 H2S、CO）之作業'
            :'or any work where oxygen-deficient, flammable or toxic atmospheres (e.g. H2S, CO) may exist')+'</span></div>'+
          '<table class="table table-sm table-bordered mt-2 mb-0" style="background:#fff;max-width:560px">'+
          '<thead><tr><th style="width:34%;background:#0b3a5c;color:#fff">'+(Z?'測試時機 When':'When')+'</th>'+
          '<th style="background:#0b3a5c;color:#fff">'+(Z?'要求 Requirement':'Requirement')+'</th></tr></thead><tbody>'+
          timing.map(function(r){ return '<tr><td class="fw-bold">'+r[0]+'</td><td>'+r[1]+'</td></tr>'; }).join('')+
          '</tbody></table></div>';
      })()+
      ynFld('gasTestRequired','是否需要氣體測試？ Gas test required?',cur.gasTestRequired,ro)+
      (needGas&&cur.gasTestRequired!=='Y'
        ?'<div class="alert alert-warning py-2 mt-2 small">⚠️ '+(lang==='zh'
          ?'您已勾選動火作業或局限空間 — 正常情況應需要氣體測試，請確認。'
          :'Hot Work or Confined Space is selected — a gas test is normally required. Please confirm.')+'</div>':'')+
      (cur.gasTestRequired==='Y'
        ?(function(){ var Z=(lang==='zh');
          var gasRows=[
            [Z?'氧氣 O₂':'Oxygen O₂', '18 ~ 23.5%'],
            [Z?'可燃性氣體 LEL（爆炸下限）':'Flammable gas LEL', '&lt; 5%'],
            [Z?'一氧化碳 CO':'Carbon monoxide CO', '≤ 35 ppm'],
            [Z?'硫化氫 H₂S':'Hydrogen sulphide H₂S', '≤ 1 ppm']];
          return '<div class="alert py-2 mt-2 small" style="background:#fdeaea;border:1px solid #e8a3a3;color:#a33">'+
          '<b>🧪 '+(Z?'氣體監測合格數值（取台灣法規及 NMDC 規範之最嚴格值）':'Acceptable gas levels (strictest of Taiwan regulations & NMDC standards)')+'</b>'+
          '<table class="table table-sm table-bordered mt-2 mb-2" style="background:#fff;max-width:520px">'+
          '<thead><tr><th style="width:60%;background:#a33;color:#fff">'+(Z?'氣體 Gas':'Gas')+'</th>'+
          '<th style="background:#a33;color:#fff">'+(Z?'合格數值 Acceptable Level':'Acceptable Level')+'</th></tr></thead><tbody>'+
          gasRows.map(function(r){ return '<tr><td>'+r[0]+'</td><td class="fw-bold" style="color:#a33">'+r[1]+'</td></tr>'; }).join('')+
          '</tbody></table>'+(Z
          ?'請根據 <b>NMDC PTW Procedure</b> 進行氣體測試：於<b>船舶之局限空間、動火作業</b>工作前及工作期間，使用合格之氣體偵測儀確認符合上述數值，才可開始並持續進行工作。'
          :'Perform gas testing per the <b>NMDC PTW Procedure</b>: <b>before and during confined space work on vessels and hot work</b>, use a calibrated gas detector to confirm the above values before starting and continuously while working.')+'</div>'+
          // 📥 醒目下載提示（現場必備紀錄，結案必附）
          '<div class="mt-2 p-3" style="background:linear-gradient(135deg,#fff3cd,#ffe69c);border:2px solid #d39e00;border-radius:10px">'+
          '<div style="font-size:1.02rem;font-weight:800;color:#7a5a00">📥 '+
          (Z?'請下載現場紀錄表使用（關閉 PTW 時必須上傳）':'Download the site log sheets (must be uploaded when closing the PTW)')+'</div>'+
          '<div class="small mt-1" style="color:#6b5200">'+
          (Z?'請至首頁「<b>附件下載專區</b>」下載並<b>列印</b>下列表單，於現場填寫使用、保存完好：'
            :'Go to the home page <b>Downloads</b> section, download and <b>print</b> the following forms, complete them on site and keep them safe:')+'</div>'+
          '<div class="mt-1"><span class="badge text-dark" style="background:#fff;border:1px solid #d39e00;font-size:.85rem;margin:2px">📋 '+
          (Z?'氣體監測記錄表 Gas Monitoring Log':'Gas Monitoring Log')+'</span> '+
          '<span class="badge text-dark" style="background:#fff;border:1px solid #d39e00;font-size:.85rem;margin:2px">📋 '+
          (Z?'局限空間人員管制表 Confined Space Personnel Control Log':'Confined Space Personnel Control Log')+'</span></div>'+
          '<button type="button" class="btn btn-sm btn-warning fw-bold mt-2" onclick="openDownloads()">📥 '+
          (Z?'前往下載專區（開新視窗）':'Go to Downloads (new tab)')+' ↗</button></div>'; })():'');
  }else if(curStep===3){
    var coSel=coHolderIds(), hoSel=holderIds();
    // 人員清單與目前「申請公司」不一致（或尚未載入）→ 立即重抓，取回後會自動重繪本步驟
    var stale=(!pickerCache||pickerCacheCo!==(cur.companyId||''));
    if(stale) setTimeout(function(){ loadPickerUsers(null,cur.companyId||''); },0);
    var personBox=function(prefix,sel){
      if(stale) return '<div class="border rounded p-2 text-muted small" style="background:#fff">'+
        (lang==='zh'?'載入該公司人員中…':'Loading personnel for this company…')+'</div>';
      return '<div class="border rounded p-2" style="max-height:190px;overflow:auto;background:#fff">'+
        ((pickerCache||[]).map(function(u){
          return '<div class="form-check"><input class="form-check-input pfld" type="checkbox" id="'+prefix+esc(u.id)+'"'+
            (sel.indexOf(u.id)>=0?' checked':'')+(ro?' disabled data-ro="1"':'')+'>'+
            '<label class="form-check-label small" for="'+prefix+esc(u.id)+'">'+esc(bi(u.nameEn,u.nameZh))+
            ' <span class="text-muted">Tier '+u.tier+'・'+esc(u.title||'')+'</span></label></div>';
        }).join('')||'<span class="text-muted small">—</span>')+'</div>';
    };
    h+=sect('4. 人員 Personnel')+
      '<div class="small text-muted mb-2">'+(lang==='zh'
        ?'名單為 <b>'+esc(ptwCompanyName(cur.companyId)||'—')+'</b> 訓練有效之 Tier 1 人員；HSE 人員不可擔任持有人。若要改公司請回到步驟 1。'
        :'List shows trained Tier 1 personnel of <b>'+esc(ptwCompanyName(cur.companyId)||'—')+'</b>. HSE personnel cannot be a permit holder. To change company, go back to Step 1.')+'</div>'+
      // 審查人（Tier 2–5）與非申請人：持有人為唯讀，說明正確作法＝退回申請人修改
      (ro?'<div class="alert py-2 small mb-2" style="background:#eef4fb;border:1px solid #c4d8ee;color:#24486b">'+
        '🔒 <b>'+(lang==='zh'?'持有人僅能由申請人（Tier 1）指定':'Holders can only be assigned by the applicant (Tier 1)')+'</b><br>'+
        (lang==='zh'
          ?'審查人員（Tier 2–5）與系統管理員<b>皆不可</b>直接更動主持有人／副持有人。如名單有誤，請以<b>「退回修改」</b>將本 PTW 退回申請人更正後重新送審 — 此限制由後端強制，確保責任歸屬與稽核軌跡完整。'
          :'Reviewers (Tier 2–5) and administrators <b>cannot</b> change the holder or co-holders. If the list is wrong, use <b>Return for revision</b> so the applicant corrects it and resubmits — this is enforced server-side to keep accountability and the audit trail intact.')+
        '</div>':'')+
      '<div class="alert alert-warning py-2 small mb-2">⏰ '+(lang==='zh'
        ?'<b>如果是 24/7 連續工作，主持有人與副持有人合計至少需有兩位。</b>同一人不可同時為主持有人與副持有人。'
        :'<b>For 24/7 continuous work, at least TWO persons are required (Holder + Co-Holder combined).</b> The same person cannot be both Holder and Co-Holder.')+'</div>'+
      '<div class="row"><div class="col-md-6"><label class="form-label small mb-1 fw-bold">'+
        (lang==='zh'?'主持有人 Holder ＊（可複選，至少一位）':'Holder(s) ＊ — at least one, multiple allowed')+'</label>'+
        personBox('hld_',hoSel)+'</div>'+
      '<div class="col-md-6"><label class="form-label small mb-1 fw-bold">'+
        (lang==='zh'?'副持有人 Co-Holder（可複選）':'Co-Holder(s) — multiple allowed')+'</label>'+
        personBox('coh_',coSel)+'</div></div>'+
      '<div class="small text-muted mt-2">'+(lang==='zh'?'申請人：':'Applicant: ')+esc((getUser()||{}).nameEn||'')+(lang==='zh'?'（系統自動帶入）':' (auto-filled)')+'</div>';
  }else if(curStep===4){
    h+=sect('5. 附加證書 Complementary Certificates')+renderCertsStep(ro);
  }else{
    h+=sect('6. 輔助文件 / 附件 / 申請人聲明 / 提交 Documents · Declaration · Submit')+
      requiredDocsHtml()+
      '<h6 class="mt-3">📎 '+(lang==='zh'?'附件上傳（Method Statement、JSA/RA、圖面、證照、照片…）':'Attachments (Method Statement, JSA/RA, drawings, licences, photos…)')+'</h6>'+
      (function(){
        var uCo=getUser()||{};
        var canCoUpload=!cur.editable&&cur.applicantUserId===uCo.id&&
          ['Approved','Active','Extended','Suspended','Expired','WorkCompleted','PendingCloseout'].indexOf(cur.status)>=0;
        if(!canCoUpload) return '';
        var opt=function(v,l){ return '<option value="'+v+'">'+l+'</option>'; };
        return '<div class="alert alert-info py-2 small mb-2">🏁 '+(lang==='zh'
            ?'<b>結案附件上傳</b> — 執行中/結案審閱期間可隨時補上傳，檔案將存入該 PTW 資料夾的 <b>05_Close_out_evidence</b>。'
            :'<b>Close-out attachments</b> — upload any time during execution / close-out review; files are stored in <b>05_Close_out_evidence</b> of this PTW folder.')+'</div>'+
          '<div class="d-flex gap-2 flex-wrap align-items-center mb-2">'+
          '<select id="attCategory" class="form-select form-select-sm" style="max-width:280px">'+
          // 選項＝後端 CloseoutRules 依本張 PTW 作業類型算出的清單（必要 ◆ → 建議 ⚑ → 選配）
          (function(){
            var Zc=(lang==='zh'), mark={required:'◆ ',recommended:'⚑ ',optional:''};
            var tail={required:(Zc?'（必要）':' (required)'),recommended:(Zc?'（建議）':' (recommended)'),
                      optional:(Zc?'（選配）':' (optional)')};
            var order={required:0,recommended:1,optional:2};
            return (cur._closeoutDocs||[]).slice().sort(function(a,b){ return order[a.level]-order[b.level]; })
              .map(function(d){ return opt(d.key, mark[d.level]+(Zc?d.zh:d.en)+tail[d.level]); }).join('');
          })()+
          '</select>'+
          '<input type="file" id="attFile" class="form-control form-control-sm" style="max-width:320px">'+
          '<button class="btn btn-sm btn-navy" id="btnUpload" onclick="uploadAttachment()">⬆︎ '+L('Upload 上傳')+'</button></div>';
      })()+
      (cur.editable?('<div class="d-flex gap-2 flex-wrap align-items-center mb-2">'+
        '<select id="attCategory" class="form-select form-select-sm" style="max-width:260px">'+
        '<option value="MethodStatement">'+(lang==='zh'?'★ Method Statement 施工方法（必要）':'★ Method Statement (required)')+'</option>'+
        '<option value="RiskAssessment">'+(lang==='zh'?'★ JSA / Risk Assessment（必要）':'★ JSA / Risk Assessment (required)')+'</option>'+
        (asB(cur.wtDiving)?'<option value="DivingDocs">'+(lang==='zh'?'★ 潛水文件：證書/計畫（必要）':'★ Diving docs: certs/plan (required)')+'</option>':'')+
        (asB(cur.wtRadiography)?'<option value="RadiographyDocs">'+(lang==='zh'?'★ 輻射文件：執照/射源（必要）':'★ Radiography docs: licences/source (required)')+'</option>':'')+
        (asB(cur.wtExcavation)?'<option value="ExcavationDocs">'+(lang==='zh'?'★ 開挖文件：圖面/調查（必要）':'★ Excavation docs: drawings/survey (required)')+'</option>':'')+
        (asB(cur.wtElectricalIso)?'<option value="LotoDocs">'+(lang==='zh'?'★ 電氣隔離：LOTO 紀錄（必要）':'★ Electrical iso: LOTO records (required)')+'</option>':'')+
        '<option value="Supporting">'+L('輔助文件 Supporting')+'</option>'+
        '<option value="Certificates">'+L('證書相關 Certificates')+'</option>'+
        '</select>'+
        '<input type="file" id="attFile" class="form-control form-control-sm" style="max-width:320px">'+
        '<button class="btn btn-sm btn-navy" id="btnUpload" onclick="uploadAttachment()">⬆︎ '+L('Upload 上傳')+'</button></div>'):'')+
      '<div id="attList" class="small text-muted">Loading…</div>'+
      '<div class="form-check mt-3 p-3 border rounded" style="background:#f8f9fa">'+
      '<input class="form-check-input ms-0 me-2 pfld" type="checkbox" id="c_paDecl"'+(asB(cur.paDeclarationAccepted)?' checked':'')+(ro?' disabled':'')+'>'+
      '<label class="form-check-label small" for="c_paDecl">'+(lang==='zh'
        ?'<b>申請人聲明：</b>我了解需採取的預防措施，並完全接受以最安全方式開展工作的責任；本許可證僅在條款和條件得到維持期間有效。'
        :'<b>Declaration:</b> I understand the precautions to be undertaken and fully accept the responsibility to carry out the job in the safest manner; this permit is valid only as long as the terms and conditions are maintained.')+'</label></div>'+
      (cur.editable?'<button class="btn btn-navy w-100 mt-3" id="btnSubmitPtw" onclick="previewSubmit()">📤 '+T('pw.submit')+'</button>':'')+
      (cur.editable&&(cur.status==='Draft')?'<button class="btn btn-outline-danger w-100 mt-2" onclick="withdrawPtw()">🗑 '+T('pw.withdraw')+'</button>':'');
  }
  h+='</div>';
  $('stepContent').innerHTML=h;
  $('rvStepWrap').innerHTML=isMyReviewTurn()?rvStepBoxHtml():'';
  if(curStep===STEPS.length-1) loadAttachments();
  // 施工架/氣測 選「是」→ 重新渲染顯示紅色警示框
  ['scaffoldingRequired','gasTestRequired'].forEach(function(k){
    document.querySelectorAll('input[name="f_'+k+'"]').forEach(function(r){
      r.addEventListener('change',function(){ collectStep(); renderStepContent(); });
    });
  });
  if(curStep===3) setupHolderExclusion();
  if(isMyReviewTurn()){ setupRvStepBox(); renderReviewBar(); }
  if(cur.editable) attachDirtyListeners();
}
/* 主持有人／副持有人互斥：勾了主持有人就不可再當副持有人（反之亦然） */
function setupHolderExclusion(){
  // 唯讀（非申請人／送審中）時完全不啟用互斥邏輯 —— 否則 sync() 會把未被互斥擋住的
  // 核取方塊重新 enable，導致審查人看起來可以改持有人（後端仍會擋，但畫面會誤導）
  if(!(cur&&cur.editable)){
    document.querySelectorAll('[id^="hld_"],[id^="coh_"]').forEach(function(el){ el.disabled=true; });
    return;
  }
  var sync=function(){
    document.querySelectorAll('[id^="hld_"]').forEach(function(hel){
      var cel=$('coh_'+hel.id.substring(4));
      if(!cel) return;
      if(hel.checked){ cel.checked=false; cel.disabled=true; }
      else if(!cel.dataset.ro) cel.disabled=false;
    });
    document.querySelectorAll('[id^="coh_"]').forEach(function(cel){
      var hel=$('hld_'+cel.id.substring(4));
      if(!hel) return;
      if(cel.checked){ hel.checked=false; hel.disabled=true; }
      else if(!hel.dataset.ro) hel.disabled=false;
    });
  };
  document.querySelectorAll('[id^="hld_"],[id^="coh_"]').forEach(function(el){
    el.addEventListener('change',sync);
  });
  sync();
}
/* ===== 審查人每步意見（無意見 / 有意見+Comment） ===== */
function rvStepBoxHtml(){
  var Z=(lang==='zh');
  var st=(cur._stepRv||{})[curStep]||null;
  return '<div class="p-3 my-2" style="background:#8f1f1f;color:#fff;border:1px solid #6d1414;border-radius:14px;box-shadow:0 6px 22px rgba(90,10,10,.35)" id="rvStepBox">'+
    '<b>📋 '+(Z?('本步驟審查意見（Step '+(curStep+1)+'）'):('Your review of this step (Step '+(curStep+1)+')'))+'</b>'+
    '<div class="mt-2 d-flex gap-3 flex-wrap">'+
    '<div class="form-check"><input class="form-check-input" type="radio" name="rvStepOpt" id="rvsOk" value="ok"'+(st&&st.ok?' checked':'')+'>'+
    '<label class="form-check-label" for="rvsOk">✅ '+(Z?'無意見':'No issues')+'</label></div>'+
    '<div class="form-check"><input class="form-check-input" type="radio" name="rvStepOpt" id="rvsCmt" value="cmt"'+(st&&!st.ok?' checked':'')+'>'+
    '<label class="form-check-label" for="rvsCmt">💬 '+(Z?'有意見（填寫 Comment）':'Comment')+'</label></div></div>'+
    '<textarea id="rvStepCmt" class="form-control form-control-sm mt-2'+(st&&!st.ok?'':' d-none')+'" rows="2" placeholder="'+
    (Z?'請具體說明此步驟的問題…':'Describe the issue with this step…')+'">'+esc(st&&!st.ok?(st.c||''):'')+'</textarea>'+
    '<div class="small mt-1" style="color:#f3cais">'.replace('#f3cais','#f0c9c9')+(Z
      ?'每一步都須選擇「無意見」或填寫意見才能繼續；只要任一步有意見，最後僅能退回處理。'
      :'Mark every step as "No issues" or leave a comment. Any comment means the PTW must be returned instead of approved.')+'</div></div>';
}
function setupRvStepBox(){
  cur._stepRv=cur._stepRv||{};
  var save=function(){
    var ok=$('rvsOk')&&$('rvsOk').checked, cmt=$('rvsCmt')&&$('rvsCmt').checked;
    $('rvStepCmt').classList.toggle('d-none',!cmt);
    if(ok) cur._stepRv[curStep]={ok:true};
    else if(cmt){ var t=$('rvStepCmt').value.trim(); cur._stepRv[curStep]={ok:false,c:t}; }
    else delete cur._stepRv[curStep];
    renderReviewBar();
  };
  ['rvsOk','rvsCmt'].forEach(function(id){ var el=$(id); if(el) el.addEventListener('change',save); });
  var ta=$('rvStepCmt'); if(ta) ta.addEventListener('input',save);
}
/* 該步驟是否已完成審查標記（無意見 或 意見已填寫） */
function rvStepMarked(i){
  var st=(cur._stepRv||{})[i];
  return !!(st&&(st.ok||String(st.c||'').trim()));
}
/* (9) 依作業類型/氣測動態提醒須提交之證明文件 */
function attHas(cat){ return (cur._attachments||[]).some(function(a){ return String(a.category)===cat; }); }
function requiredDocsHtml(){
  var Z=(lang==='zh');
  var msOk=attHas('MethodStatement'), raOk=attHas('RiskAssessment');
  var mand='<div class="alert '+((msOk&&raOk)?'alert-success':'alert-danger')+' py-2 small mb-2">'+
    '<b>'+(Z?'必要附件（未上傳無法提交）':'Mandatory attachments (submission blocked without them)')+'</b><ul class="mb-0 mt-1">'+
    '<li>'+(msOk?'✅':'❌')+' Method Statement'+(Z?' 施工方法':'')+'</li>'+
    '<li>'+(raOk?'✅':'❌')+' JSA / Risk Assessment'+(Z?' 風險評估':'')+'</li></ul></div>';
  // 依作業類型：提交前必要（★ 擋提交）
  var pre=[];
  if(asB(cur.wtDiving)) pre.push([attHas('DivingDocs'),Z?'潛水文件：潛水員資格證書、潛水作業計畫':'Diving docs: diver certificates & dive plan']);
  if(asB(cur.wtRadiography)) pre.push([attHas('RadiographyDocs'),Z?'輻射文件：操作人員執照、射源證明':'Radiography docs: licences & source certificates']);
  if(asB(cur.wtExcavation)) pre.push([attHas('ExcavationDocs'),Z?'開挖文件：範圍圖面、地下管線調查':'Excavation docs: drawings & services survey']);
  if(asB(cur.wtElectricalIso)) pre.push([attHas('LotoDocs'),Z?'電氣隔離文件：LOTO 紀錄／掛牌':'Electrical iso docs: LOTO records/tags']);
  var preHtml=pre.length
    ?'<div class="alert '+(pre.every(function(x){return x[0];})?'alert-success':'alert-danger')+' py-2 small mb-2">'+
      '<b>'+(Z?'依作業類型必要附件（未上傳無法提交）':'Work-type mandatory attachments (submission blocked without them)')+'</b>'+
      '<ul class="mb-0 mt-1">'+pre.map(function(x){ return '<li>'+(x[0]?'✅':'❌')+' '+x[1]+'</li>'; }).join('')+'</ul></div>'
    :'';
  // 結案前必要（◆ 擋結案，不擋提交 — 施工中才填寫）
  // 關單文件清單由後端 CloseoutRules 依作業類型算出（ptw.open 帶回 closeoutDocs），
  // 前端只負責呈現，避免前後端規則各寫一份而不同步
  var docs=(cur._closeoutDocs||[]);
  var WHY_ZH={wtHotWork:'動火',wtConfinedSpace:'局限空間',wtDiving:'潛水',wtRadiography:'輻射',
    wtExcavation:'開挖',wtElectricalIso:'電氣隔離',wtProcessIso:'製程隔離',
    gasTestRequired:'需氣體測試',scaffoldingRequired:'施工架'};
  var WHY_EN={wtHotWork:'Hot Work',wtConfinedSpace:'Confined Space',wtDiving:'Diving',wtRadiography:'Radiography',
    wtExcavation:'Excavation',wtElectricalIso:'Electrical Iso.',wtProcessIso:'Process Iso.',
    gasTestRequired:'Gas test',scaffoldingRequired:'Scaffolding'};
  var tagFor=function(d){
    if(!d.why||!d.why.length) return '<span class="badge bg-secondary-subtle text-secondary-emphasis" style="font-weight:500">'+
      (Z?'所有 PTW':'All PTW')+'</span>';
    return d.why.map(function(w){ return '<span class="badge" style="background:#e8f1fb;color:#0b5a94;border:1px solid #cfe2f5;font-weight:500">'+
      esc(Z?(WHY_ZH[w]||w):(WHY_EN[w]||w))+'</span>'; }).join(' ');
  };
  var li=function(d,mark){
    return '<li class="mb-1">'+(attHas(d.key)?'✅':mark)+' '+esc(Z?d.zh:d.en)+' '+tagFor(d)+'</li>';
  };
  var req=docs.filter(function(d){ return d.level==='required'; });
  var rec=docs.filter(function(d){ return d.level==='recommended'; });
  var opt=docs.filter(function(d){ return d.level==='optional'; });
  var coHtml=
    (req.length?'<div class="alert alert-warning py-2 small mb-2">◆ <b>'+(Z
        ?'關單必附文件（施工中填寫，未上傳無法申報完工）'
        :'Mandatory at close-out (completed during work; completion cannot be declared without them)')+'</b>'+
      '<ul class="mb-0 mt-1 ps-3">'+req.map(function(d){ return li(d,'⬜'); }).join('')+'</ul></div>':'')+
    (rec.length?'<div class="alert py-2 small mb-2" style="background:#fff8e6;border:1px solid #f0dca8;color:#6b5417">'+
      '<b>⚑ '+(Z?'依作業類型強烈建議檢附（目前不擋關單）':'Strongly recommended for these work types (does not block close-out yet)')+'</b>'+
      '<ul class="mb-0 mt-1 ps-3">'+rec.map(function(d){ return li(d,'▫️'); }).join('')+'</ul>'+
      '<div class="small" style="opacity:.8">'+(Z
        ?'表單備妥後，管理員可於管理台將個別項目升級為「必附」。'
        :'Once the forms are published, an administrator can promote individual items to mandatory.')+'</div></div>':'')+
    (opt.length?'<div class="alert alert-secondary py-2 small mb-2"><b>'+(Z?'選配附件（不擋關單）':'Optional (does not block close-out)')+'</b>'+
      '<ul class="mb-0 mt-1 ps-3">'+opt.map(function(d){ return li(d,'▫️'); }).join('')+'</ul></div>':'');
  return mand+preHtml+coHtml;
}
/* ---- 附件（M3.4） ---- */
function renderAttachments(list){
    var res={ok:true,data:list};
    if(!res.data.length){ $('attList').innerHTML='<span class="text-muted">'+(lang==='zh'?'（尚無附件）':'(No attachments)')+'</span>'; return; }
    var h='<table class="table table-sm"><thead><tr><th>'+L('File 檔案')+'</th><th>'+L('Cat. 分類')+'</th><th>Size</th><th>'+L('Uploaded 上傳時間')+'</th><th></th></tr></thead><tbody>';
    res.data.forEach(function(a){
      h+='<tr><td><a href="'+esc(a.fileUrl)+'" target="_blank" rel="noopener">📄 '+esc(a.fileName)+'</a></td>'+
        '<td class="small">'+esc(a.category)+'</td><td class="small">'+esc(a.sizeKb)+' KB</td>'+
        '<td class="small">'+esc(a.uploadedAt)+'</td>'+
        '<td>'+(cur.editable?'<button class="btn btn-sm btn-outline-danger" onclick="removeAttachment(\\''+a.id+'\\')">✕</button>':'')+'</td></tr>';
    });
    $('attList').innerHTML=h+'</tbody></table>';
}
function loadAttachments(){
  // 先用 ptw.open 帶回的快取即時顯示；僅在上傳/刪除後重新抓
  if(cur._attachments){ renderAttachments(cur._attachments); return; }
  refreshAttachments();
}
function refreshAttachments(){
  api('attach.list',{ptwId:cur.id}).then(function(res){
    if(!res.ok){ $('attList').textContent=apiMsg(res); return; }
    cur._attachments=res.data;
    renderAttachments(res.data);
  });
}
function uploadAttachment(){
  var input=$('attFile'), file=input.files[0];
  if(!file){ toast(lang==='zh'?'請選擇檔案':'Choose a file'); return; }
  if(file.size>15*1024*1024){ toast(lang==='zh'?'單檔上限 15 MB（Web 上傳限制）':'Max 15 MB per file'); return; }
  var btn=$('btnUpload'); btn.disabled=true; btn.textContent='⏳ Uploading…';
  var reader=new FileReader();
  reader.onload=function(e){
    var b64=String(e.target.result).split(',')[1];
    api('attach.upload',{ptwId:cur.id,fileName:file.name,mimeType:file.type||'application/octet-stream',
      base64:b64,category:$('attCategory').value}).then(function(res){
      btn.disabled=false; btn.textContent='⬆︎ '+L('Upload 上傳');
      if(!res.ok){ toast(apiMsg(res)); return; }
      input.value=''; toast((lang==='zh'?'已上傳 ✅':'Uploaded ✅'),true); cur._attachments=null;
      api('attach.list',{ptwId:cur.id}).then(function(r2){ if(r2.ok){ cur._attachments=r2.data; renderStepContent(); } });
    });
  };
  reader.readAsDataURL(file);
}
function removeAttachment(id){
  uiConfirm(lang==='zh'?'移除此附件？':'Remove this attachment?').then(function(ok){ if(!ok) return;
  api('attach.disable',{attachmentId:id}).then(function(res){
    if(res.ok){ toast((lang==='zh'?'已移除':'Removed'),true); cur._attachments=null; refreshAttachments(); } else toast(apiMsg(res));
  });});
}
function attachDirtyListeners(){
  document.querySelectorAll('.pfld').forEach(function(el){
    el.addEventListener('change',function(){ markDirty(); });
    if(el.tagName==='TEXTAREA'||el.type==='text') el.addEventListener('input',function(){ markDirty(); });
  });
  var ed=$('f_executionDate');
  if(ed) ['change','input'].forEach(function(ev){ ed.addEventListener(ev,function(){
    var a=$('f_validFrom'),b2=$('f_validTo');
    if(!a||!b2||!/^\\d{4}-\\d{2}-\\d{2}$/.test(ed.value)) return;
    if(a.value) return;                     // 開始日期已填 → 不覆寫使用者指定的日期
    a.value=ed.value; syncValidDays(true);  // 未填 → 帶入申請日期並自動排出 7 天
  }); });
  var vf=$('f_validFrom'),vt=$('f_validTo'),vd=$('f_validDays');
  if(vf) ['change','input'].forEach(function(ev){ vf.addEventListener(ev,function(){ syncValidDays(true); }); });
  if(vt) ['change','input'].forEach(function(ev){ vt.addEventListener(ev,function(){ syncValidDays(false); }); });
  if(vd) ['change','input'].forEach(function(ev){ vd.addEventListener(ev,function(){ applyValidDays(); }); });
  syncValidDays(false);
}
function markDirty(){
  dirty=true; $('pfSaveState').textContent='● '+(lang==='zh'?'未儲存（換步驟時自動儲存）':'unsaved (auto-saves on step change)');
}
/* 氣體測試列 */
function renderGasRows(ro){
  var h='<table class="table table-sm"><thead><tr><th>O2</th><th>LEL</th><th>H2S</th><th>CO</th><th>H2</th><th>Tester 測試人員</th><th>Date</th><th>Time</th>'+(ro?'':'<th></th>')+'</tr></thead><tbody>';
  cur._gas.forEach(function(g,i){
    h+='<tr>'+['o2','lel','h2s','co','h2'].map(function(k){
      return '<td><input class="form-control form-control-sm gasf" data-i="'+i+'" data-k="'+k+'" value="'+esc(g[k]||'')+'" style="min-width:56px"'+(ro?' disabled':'')+'></td>';
    }).join('')+
    '<td><input class="form-control form-control-sm gasf" data-i="'+i+'" data-k="tester" value="'+esc(g.tester||'')+'"'+(ro?' disabled':'')+'></td>'+
    '<td><input type="date" class="form-control form-control-sm gasf" data-i="'+i+'" data-k="date" value="'+esc(g.date||'')+'"'+(ro?' disabled':'')+'></td>'+
    '<td><input type="time" class="form-control form-control-sm gasf" data-i="'+i+'" data-k="time" value="'+esc(g.time||'')+'"'+(ro?' disabled':'')+'></td>'+
    (ro?'':'<td><button class="btn btn-sm btn-outline-danger" onclick="delGasRow('+i+')">✕</button></td>')+'</tr>';
  });
  $('gasRows').innerHTML=h+'</tbody></table>';
  document.querySelectorAll('.gasf').forEach(function(el){
    el.addEventListener('change',function(){
      cur._gas[Number(el.getAttribute('data-i'))][el.getAttribute('data-k')]=el.value; markDirty();
    });
  });
}
function addGasRow(){ cur._gas.push({}); renderGasRows(false); markDirty(); }
function delGasRow(i){ cur._gas.splice(i,1); renderGasRows(false); markDirty(); }

/* 證書步驟 */
/** 證書欄位自動帶入主表（回傳 null = 非自動欄位） */
function certAutoVal(id){
  if(/_date$/.test(id)) return cur.executionDate||'';
  if(/_area$/.test(id)) return cur.areaLocation||'';
  if(/_location$/.test(id)) return cur.areaLocation||'';
  if(/_workDescription$/.test(id)) return cur.workDescription||'';
  if(/_duration$/.test(id)) return (cur.validFrom&&cur.validTo)?(cur.validFrom+' → '+cur.validTo):'';
  if(/_paName$/.test(id)) return idListOf(cur.holderUserId).map(pickerName).filter(Boolean).join('、');
  if(/_paTitle$/.test(id)) return pickerTitle(idListOf(cur.holderUserId)[0]||'');
  if(id==='div_applicantName') return pickerName(cur.applicantUserId)||((getUser()||{}).nameEn||'');
  if(id==='div_applicantTitle') return pickerTitle(cur.applicantUserId)||((getUser()||{}).title||'');
  if(id==='div_vessel') return cur.vessel||'';
  if(id==='div_startDateTime') return cur.validFrom||'';
  if(id==='div_workNature') return cur.workDescription||'';
  if(id==='rac_company'||id==='div_company') return cur.companyName||'';
  return null;
}
function pickerName(uid){
  if(!uid) return '';
  var u=(pickerCache||[]).filter(function(x){ return x.id===uid; })[0];
  return u?bi(u.nameEn,u.nameZh):'';
}
function pickerTitle(uid){
  if(!uid) return '';
  var u=(pickerCache||[]).filter(function(x){ return x.id===uid; })[0];
  return u?(u.title||''):'';
}
function renderCertsStep(ro){
  var needed=[];
  WT_DEF.forEach(function(d,i){
    var codes=['HW','GW','DO','RG','CS','EI','PI'];
    if(codes[i]==='GW') return; // Cold Work 免證書（總部決議）
    if(asB(cur[d[0]])) needed.push(codes[i]);
  });
  if(!needed.length) return '<div class="text-muted p-3">'+T('pw.noCert')+'</div>';
  var h='<div class="accordion" id="certAcc">';
  needed.forEach(function(code,i){
    var form=CERT_FORMS[code], info=cur.certs&&cur.certs[code];
    var data=cur._certData[code]||{};
    var done=info&&info.status==='Complete';
    h+='<div class="accordion-item"><h2 class="accordion-header">'+
      '<button class="accordion-button'+(i>0?' collapsed':'')+'" type="button" data-bs-toggle="collapse" data-bs-target="#cert_'+code+'">'+
      (done?'✅':'📄')+' <b class="ms-1">'+code+'</b>&nbsp;'+esc(L(certName(code)))+
      (info?'&nbsp;<span class="badge bg-'+(done?'success':'warning text-dark')+' ms-2">'+esc(info.certNo)+' · '+(done?'Complete':'Draft')+'</span>':'&nbsp;<span class="badge bg-secondary ms-2">'+L('未建立 Not Created')+'</span>')+
      '</button></h2>'+
      '<div id="cert_'+code+'" class="accordion-collapse collapse'+(i===0?' show':'')+'" data-bs-parent="#certAcc"><div class="accordion-body">';
    form.sections.forEach(function(sec){
      h+='<h6 class="mt-2 sect">'+esc(L(sec.t))+'</h6>';
      sec.f.forEach(function(f){
        var id=f[0],label=f[1],type=f[2],val=data[id];
        var auto=certAutoVal(id);
        if(auto!==null){
          // 自動帶入主表：唯讀顯示（PDF 與儲存以主表為準）
          h+='<div class="mb-2"><label class="form-label small mb-0">'+esc(L(label))+
             ' <span class="badge bg-light text-secondary border" style="font-size:.62rem">🔗 '+(lang==='zh'?'自動帶入主表':'auto from main permit')+'</span></label>'+
             '<input class="form-control form-control-sm" value="'+esc(auto)+'" disabled style="background:#f2f7fb"></div>';
          return;
        }
        if(type==='yn') h+=ynFld('CERT_'+code+'_'+id,label,val,ro);
        else if(type==='c') h+='<div class="form-check"><input class="form-check-input certf_'+code+'" type="checkbox" id="cc_'+code+'_'+id+'"'+(val?' checked':'')+(ro?' disabled':'')+'><label class="form-check-label small" for="cc_'+code+'_'+id+'">'+esc(L(label))+'</label></div>';
        else h+=fld('CERT_'+code+'_'+id,label,type,val,ro);
      });
    });
    if(!ro){
      h+='<button class="btn btn-navy mt-3" onclick="saveCert(\\''+code+'\\')">📤 '+(lang==='zh'?'提交證書':'Submit Certificate')+'</button>'+
        '<div class="small text-danger mt-1">⚠️ '+(lang==='zh'
          ?'需按「提交證書」此證書才算完成；所有勾選作業類型的證書皆須提交後，才能提交 PTW 申請。'
          :'You must click "Submit Certificate" for this certificate to count as complete. All certificates for the checked work types must be submitted before the PTW can be submitted.')+'</div>';
    }
    h+='</div></div></div>';
  });
  return h+'</div>';
}
function certName(code){
  var names={HW:'動火作業許可證 Hot Work Permit',GW:'一般作業許可證 Cold Work Permit',DO:'潛水作業證書 Diving Operations',
    RG:'輻射作業證明書 Radiography',CS:'侷限空間作業證書 Confined Space Entry',EC:'開挖作業許可證 Excavation',EI:'電氣隔離證書 Electrical Isolation',
    PI:'製程隔離證書 Process Isolation Certificate'};
  return names[code]||code;
}
function collectCert(code){
  var data={};
  CERT_FORMS[code].sections.forEach(function(sec){
    sec.f.forEach(function(f){
      var id=f[0],type=f[2];
      var auto=certAutoVal(id);
      if(auto!==null){ if(auto) data[id]=auto; return; } // 自動欄位以主表為準
      if(type==='yn'){
        var sel=document.querySelector('input[name="f_CERT_'+code+'_'+id+'"]:checked');
        if(sel) data[id]=sel.value;
      }else if(type==='c'){
        var el=$('cc_'+code+'_'+id); if(el&&el.checked) data[id]=true;
      }else{
        var el2=$('f_CERT_'+code+'_'+id); if(el2&&el2.value) data[id]=el2.value;
      }
    });
  });
  return data;
}
function saveCert(code){
  var data=collectCert(code);
  var complete=true; // (8) 按「提交證書」即視為完成
  // 先確保主表草稿（含作業類型勾選）已寫入伺服器，避免競態
  ensureSaved().then(function(sv){
    if(sv&&sv.ok===false){ return; } // 儲存失敗已提示，不繼續
    api('cert.save',{ptwId:cur.id,certType:code,dataJson:JSON.stringify(data),markComplete:complete}).then(function(res){
      if(!res.ok){ toast(apiMsg(res)); return; }
      toast(code+' '+res.data.certNo+' ✅ '+(lang==='zh'?'已提交':'Submitted'),true);
      cur._certData[code]=data;
      cur.certs=cur.certs||{};
      cur.certs[code]={certificateId:res.data.certificateId,certNo:res.data.certNo,status:res.data.status,dataJson:JSON.stringify(data)};
      renderStepContent();
    });
  });
}

/* 持有人/副持有人：以 JSON 陣列儲存（相容舊單一 id） */
function idListOf(v){
  var raw=String(v||'');
  if(!raw) return [];
  if(raw.charAt(0)==='['){ try{ return JSON.parse(raw)||[]; }catch(e){ return []; } }
  return [raw];
}
function coHolderIds(){ return idListOf(cur.coHolderUserId); }
function holderIds(){ return idListOf(cur.holderUserId); }
/** id 陣列 → 顯示名稱（用 pickerCache 對照，取不到就略過） */
function namesOfIds(ids){
  var map={}; (pickerCache||[]).forEach(function(u){ map[u.id]=(lang==='zh'?(u.nameZh||u.nameEn):(u.nameEn||u.nameZh)); });
  return (ids||[]).map(function(id){ return map[id]||''; }).filter(Boolean);
}
function holderNames(){ return namesOfIds(holderIds()).join(lang==='zh'?'、':', '); }
function coHolderNames(){ return namesOfIds(coHolderIds()).join(lang==='zh'?'、':', '); }
/* 收集目前步驟欄位 → cur */
var PTW_DEFAULT_DAYS=7;   // PTW 預設可使用天數（含起訖日）
/** 含起訖日的天數：9/18→9/24 = 7（同樣用 UTC 避免時區/日光節約造成的誤差） */
function daysBetween(f,t){
  f=String(f||'').substring(0,10); t=String(t||'').substring(0,10);
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(f)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(t)) return '';
  var a=f.split('-'),b=t.split('-');
  var ms=Date.UTC(+b[0],+b[1]-1,+b[2])-Date.UTC(+a[0],+a[1]-1,+a[2]);
  var d=Math.round(ms/86400000)+1;
  return d>0?d:'';
}
function validDays(){ return daysBetween(cur.validFrom,cur.validTo); }
/** 起訖日期改動時即時重算「可使用天數」；
 *  只要「開始日期」被改動，結束日期一律重新對齊為 開始日 + 6（例：9/10 → 9/16，含起訖共 7 天）。
 *  之後若要縮短或延長，直接改「結束日期」即可，天數會即時重算。 */
function syncValidDays(fromStartEdit){
  var a=$('f_validFrom'),b=$('f_validTo'),o=$('f_validDays');
  if(!a||!b||!o) return;
  // 改開始日期 → 沿用目前天數重新排結束日（沒有天數就用預設 7 天）
  if(fromStartEdit&&/^\\d{4}-\\d{2}-\\d{2}$/.test(a.value)){
    var keep=Number(o.value)>0?Number(o.value):PTW_DEFAULT_DAYS;
    b.value=addDays(a.value,keep-1);
  }
  var d=daysBetween(a.value,b.value);
  o.value=d===''?'':d;
  var bad=!!(a.value&&b.value&&d==='');
  o.classList.toggle('text-danger',bad); o.classList.toggle('fw-bold',bad);
}
/** 直接輸入天數 → 由開始日期算出結束日期（天數＝含起訖日） */
function applyValidDays(){
  var a=$('f_validFrom'),b=$('f_validTo'),o=$('f_validDays');
  if(!a||!b||!o) return;
  var n=Math.floor(Number(o.value));
  if(!(n>0)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(a.value)) return;
  if(n>90) { n=90; o.value=90; }
  b.value=addDays(a.value,n-1);
  markDirty();
}
/** yyyy-mm-dd ＋ n 天。
 *  ⚠ 必須全程用 UTC 運算：new Date('2026-09-18T00:00:00') 取的是「本地」午夜，
 *  在 UTC+8（台北）toISOString() 會倒退 8 小時而少算一天（09-24 變成 09-23）。 */
function addDays(dateStr,n){
  var p=String(dateStr||'').substring(0,10).split('-');
  if(p.length!==3) return '';
  var d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));
  if(isNaN(d)) return '';
  d.setUTCDate(d.getUTCDate()+Number(n||0));
  return d.toISOString().substring(0,10);
}
/** 本地日期 yyyy-mm-dd（不可用 toISOString，時區會偏移） */
function localDate(dt){
  var d=dt||new Date(), p=function(n){ return (n<10?'0':'')+n; };
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
function collectStep(){
  document.querySelectorAll('[id^="f_"]').forEach(function(el){
    var key=el.id.substring(2);
    if(key.indexOf('CERT_')===0||key==='validDays') return;
    if(el.type==='datetime-local'){ cur[key]=el.value?el.value.replace('T',' ')+':00':''; }
    else cur[key]=el.value;
  });
  // (9) 開始日期未填 → 預設＝申請日期；結束日期未填／早於開始日 → 開始日 +6（含起訖共 7 天）
  // 註：使用者手動指定的開始／結束日期不再被覆寫（重新對齊由起日欄位的即時連動負責）
  var vFrom=String(cur.validFrom||'').substring(0,10);
  if(!vFrom&&cur.executionDate&&/^\\d{4}-\\d{2}-\\d{2}$/.test(cur.executionDate)){
    cur.validFrom=cur.executionDate; vFrom=cur.executionDate;
  }
  if(/^\\d{4}-\\d{2}-\\d{2}$/.test(vFrom)){
    var vTo=String(cur.validTo||'').substring(0,10);
    if(!vTo||vTo<vFrom) cur.validTo=addDays(vFrom,PTW_DEFAULT_DAYS-1);
  }
  ['scaffoldingRequired','gasTestRequired','gasTestInterval'].forEach(function(k){
    var sel=document.querySelector('input[name="f_'+k+'"]:checked');
    if(sel) cur[k]=sel.value;
  });
  var scf=$('c_scaffoldConfirm'); if(scf) cur._checks.scaffoldConfirm=scf.checked;
  WT_DEF.forEach(function(d){ var el=$('c_'+d[0]); if(el) cur[d[0]]=el.checked; });
  [HZ_DEF,CSS_DEF,PS_DEF,PC_DEF].forEach(function(defs){
    defs.forEach(function(d){ var el=$('c_'+d[0]); if(el) cur._checks[d[0]]=el.checked; });
  });
  // 隔離勾選任一項 → 自動判定需要 CSS 隔離（不再由申請人選是/否）
  if(CSS_DEF.some(function(d){ var el=$('c_'+d[0]); return el&&el.checked; })||
     CSS_DEF.some(function(d){ return cur._checks[d[0]]; })) cur.cssIsoRequired='Y';
  else if(document.querySelector('[id^="c_css"]')) cur.cssIsoRequired='N';
  // 輔助文件勾選改由附件自動檢核帶入
  cur._docs.docMethodStatement=attHas('MethodStatement');
  cur._docs.docJsaRa=attHas('RiskAssessment');
  var decl=$('c_paDecl'); if(decl) cur.paDeclarationAccepted=decl.checked;
  // 持有人 / 副持有人多選 → JSON 陣列
  var hldEls=document.querySelectorAll('[id^="hld_"]');
  if(hldEls.length){
    var hids=[];
    hldEls.forEach(function(el){ if(el.checked) hids.push(el.id.substring(4)); });
    cur.holderUserId=JSON.stringify(hids);
  }
  var cohEls=document.querySelectorAll('[id^="coh_"]');
  if(cohEls.length){
    var ids=[];
    cohEls.forEach(function(el){ if(el.checked) ids.push(el.id.substring(4)); });
    cur.coHolderUserId=JSON.stringify(ids);
  }
}
function saveNow(showToast,silent){
  if(!cur||!cur.editable) return Promise.resolve({ok:true,skipped:true});
  collectStep();
  if(saveTimer){ clearTimeout(saveTimer); saveTimer=null; }
  $('pfSaveState').textContent=T('pw.saving');
  var payload={ptwId:cur.id,checksJson:JSON.stringify(cur._checks),gasTestsJson:JSON.stringify(cur._gas),docChecksJson:JSON.stringify(cur._docs)};
  ['vessel','executionDate','continuationOfPermitNo','areaLocation','workDescription','toolsEquipment',
   'validFrom','validTo','scaffoldingRequired','gasTestRequired','gasTestInterval','gasTestIntervalOther','cssIsoRequired',
   'psOthers','hzOthers','cssOthers','pcOthers','holderUserId','coHolderUserId','paDeclarationAccepted']
   .forEach(function(k){ payload[k]=cur[k]===undefined?'':cur[k]; });
  WT_DEF.forEach(function(d){ payload[d[0]]=asB(cur[d[0]]); });
  return api('ptw.saveDraft',payload,{silent:!!silent}).then(function(res){
    if(res.ok){
      dirty=false;
      $('pfSaveState').textContent='✓ '+T('pw.saved')+' '+new Date().toTimeString().substring(0,5);
      updateCompletion(res.data.completion);
      if(showToast) toast(T('pw.saved'),true);
    }else{
      $('pfSaveState').textContent='⚠ '+apiMsg(res);
      toast((lang==='zh'?'⚠ 儲存失敗：':'⚠ Save failed: ')+apiMsg(res));
    }
    return res;
  });
}
/** 確保草稿已寫入伺服器（提交/證書儲存前強制） */
function ensureSaved(){
  if(!cur||!cur.editable) return Promise.resolve({ok:true});
  collectStep();
  return saveNow();
}
/* (11) 提交前逐項驗證：缺漏直接列出「第幾步・哪個欄位」，點擊跳轉並紅框標示 */
function validateClient(){
  var Z=(lang==='zh'),errs=[];
  var add=function(step,label,sel){ errs.push({step:step,label:label,sel:sel||null}); };
  if(canPickCompany()&&!cur.companyId)
    add(0,Z?'申請公司（代承商建單時必選）':'Applicant company (required when raising on behalf of a contractor)','#f_companyId');
  var req=[
    ['vessel',0,Z?'船舶/駁船':'Vessel/Barge','#f_vessel'],
    ['executionDate',0,Z?'申請日期':'Application date','#f_executionDate'],
    ['areaLocation',0,Z?'區域/工作地點':'Area/Location','#f_areaLocation'],
    ['workDescription',0,Z?'工作描述':'Work description','#f_workDescription'],
    ['toolsEquipment',0,Z?'工具和設備':'Tools & equipment','#f_toolsEquipment'],
    ['validFrom',0,Z?'開始日期':'Start date','#f_validFrom'],
    ['validTo',0,Z?'結束日期':'End date','#f_validTo'],
    ['holderUserId',3,Z?'主持有人（至少一位）':'Holder (at least one)','#hld_first']
  ];
  req.forEach(function(r){
    var v=cur[r[0]];
    if(r[0]==='holderUserId'){ if(!idListOf(v).length) add(r[1],r[2],null); return; }
    if(String(v||'').trim()==='') add(r[1],r[2],r[3]);
  });
  [['scaffoldingRequired',0,Z?'是否需要施工架':'Scaffolding required?'],
   ['gasTestRequired',2,Z?'是否需要氣體測試':'Gas test required?']]
   .forEach(function(r){ if(cur[r[0]]!=='Y'&&cur[r[0]]!=='N') add(r[1],r[2],'input[name="f_'+r[0]+'"]'); });
  if(cur.scaffoldingRequired==='Y'&&!cur._checks.scaffoldConfirm)
    add(0,Z?'施工架/高處作業安全確認未勾選':'Scaffolding / work-at-height safety confirmation not ticked','#c_scaffoldConfirm');
  if(!WT_DEF.some(function(d){ return asB(cur[d[0]]); })) add(0,Z?'至少勾選一項作業類型':'Select at least one work type','#c_'+WT_DEF[0][0]);
  if(!HZ_DEF.some(function(d){ return cur._checks[d[0]]; })) add(1,Z?'至少勾選一項危害':'Select at least one hazard','#c_'+HZ_DEF[0][0]);
  if(!PC_DEF.some(function(d){ return cur._checks[d[0]]; })) add(1,Z?'至少勾選一項預防措施':'Select at least one precaution','#c_'+PC_DEF[0][0]);
  if(cur.validFrom&&cur.validTo&&String(cur.validTo)<=String(cur.validFrom)) add(0,Z?'結束日期須晚於開始日期':'End date must be after start date','#f_validTo');
  // 證書：每個勾選作業類型都須已提交
  var codes=['HW','GW','DO','RG','CS','EI','PI'];
  WT_DEF.forEach(function(d,i){
    if(!asB(cur[d[0]])) return;
    if(codes[i]==='GW') return; // Cold Work 免證書（總部決議）
    var info=cur.certs&&cur.certs[codes[i]];
    if(!info||info.status!=='Complete') add(4,(Z?'證書未提交：':'Certificate not submitted: ')+codes[i]+'（'+d[1]+'）',null);
  });
  if(!attHas('MethodStatement')) add(5,Z?'必要附件未上傳：Method Statement':'Mandatory attachment missing: Method Statement','#attCategory');
  if(!attHas('RiskAssessment')) add(5,Z?'必要附件未上傳：JSA / Risk Assessment':'Mandatory attachment missing: JSA / Risk Assessment','#attCategory');
  // (依作業類型) 提交前必附資格文件
  [['wtDiving','DivingDocs',Z?'潛水文件（潛水員證書／潛水計畫）':'Diving documents (diver certs / dive plan)'],
   ['wtRadiography','RadiographyDocs',Z?'輻射文件（執照／射源證明）':'Radiography documents (licences / source certs)'],
   ['wtExcavation','ExcavationDocs',Z?'開挖文件（圖面／管線調查）':'Excavation documents (drawings / services survey)'],
   ['wtElectricalIso','LotoDocs',Z?'電氣隔離文件（LOTO 紀錄／掛牌）':'Electrical isolation documents (LOTO records/tags)']]
   .forEach(function(r){
     if(asB(cur[r[0]])&&!attHas(r[1])) add(5,(Z?'必要附件未上傳：':'Mandatory attachment missing: ')+r[2],'#attCategory');
   });
  if(!asB(cur.paDeclarationAccepted)) add(5,Z?'申請人聲明未勾選':'Applicant declaration not accepted','#c_paDecl');
  return errs;
}
function showValErrors(errs){
  var Z=(lang==='zh');
  window._valErrs=errs;
  $('valErrors').innerHTML='<div class="alert alert-danger py-2 small mb-2"><b>⚠️ '+
    (Z?('尚有 '+errs.length+' 項未完成，無法提交（點擊項目直接跳轉）：'):(errs.length+' item(s) missing — click to jump:'))+'</b>'+
    '<ul class="mb-0 mt-1">'+errs.map(function(e,i){
      var st=STEPS[e.step];
      return '<li><a href="#" class="fw-bold" onclick="valJump('+i+');return false">Step '+(e.step+1)+'・'+(Z?st.zh:st.en)+'</a>：'+esc(e.label)+'</li>';
    }).join('')+'</ul></div>';
  $('valErrors').scrollIntoView({behavior:'smooth',block:'center'});
}
function valJump(i){
  var e=window._valErrs[i]; if(!e) return;
  gotoStep(e.step);
  setTimeout(function(){
    if(!e.sel) return;
    var el=document.querySelector(e.sel); if(!el) return;
    var box=el.closest('.mb-2')||el.closest('.form-check')||el.closest('.d-flex')||el;
    box.scrollIntoView({behavior:'smooth',block:'center'});
    box.style.outline='3px solid #dc3545'; box.style.outlineOffset='2px'; box.style.borderRadius='6px';
    setTimeout(function(){ box.style.outline=''; },4000);
  },300);
}
/* 預覽 + 提交 */
function previewSubmit(){
  collectStep();
  $('valErrors').innerHTML='';
  var errs=validateClient();
  if(errs.length){ showValErrors(errs); return; }
  var Z=(lang==='zh');
  var wt=WT_DEF.filter(function(d){ return asB(cur[d[0]]); }).map(function(d){ return L(d[1]); });
  var hzN=HZ_DEF.filter(function(d){ return cur._checks[d[0]]; }).length;
  var pcN=PC_DEF.filter(function(d){ return cur._checks[d[0]]; }).length;
  var f=String(cur.validFrom||'').substring(0,10),t2=String(cur.validTo||'').substring(0,10);
  var dNum=daysBetween(f,t2);
  var attN=(cur._attachments||[]).length;
  var kv=function(k,v){ return '<tr><td class="k">'+k+'</td><td class="v">'+v+'</td></tr>'; };
  var chips=wt.length?wt.map(function(x){ return '<span class="uiChip">'+esc(x)+'</span>'; }).join(''):'<span class="text-muted">—</span>';
  var html=
    '<table class="uiKV mb-3">'+
      kv(Z?'作業類型 Work':chips?'Work types':'Work types',chips)+
      kv(Z?'工作區域 Location':'Location',esc(cur.areaLocation||'—'))+
      kv(Z?'有效期間 Valid':'Valid period',
        '<b style="color:#0b5a94">'+esc(f||'?')+'</b> → <b style="color:#0b5a94">'+esc(t2||'?')+'</b>'+
        (dNum?' <span class="text-muted">（'+dNum+(Z?' 天':' days')+'）</span>':''))+
      kv(Z?'船舶 Vessel':'Vessel',esc(cur.vessel||'—'))+
      kv(Z?'主持有人 Holder':'Holder(s)',
        (function(){ var n=namesOfIds(holderIds());
          return n.length?n.map(function(x){ return '<span class="uiChip" style="background:#e9f6ee;border-color:#c3e4d0;color:#1c6b39">👷 '+esc(x)+'</span>'; }).join('')
            :'<span class="text-muted">—</span>'; })())+
      kv(Z?'副持有人 Co-Holder':'Co-Holder(s)',
        (function(){ var n=namesOfIds(coHolderIds());
          return n.length?n.map(function(x){ return '<span class="uiChip">👤 '+esc(x)+'</span>'; }).join('')
            :'<span class="text-muted">—'+(Z?'（未指定）':' (none)')+'</span>'; })())+
      kv(Z?'勾選項目 Checked':'Checked items',
        '<span class="uiChip" style="background:#fdeaea;border-color:#f3c6c6;color:#a13030">'+
          (Z?'危害 Hazards ':'Hazards ')+hzN+'</span>'+
        '<span class="uiChip" style="background:#e9f6ee;border-color:#c3e4d0;color:#1c6b39">'+
          (Z?'預防措施 Precautions ':'Precautions ')+pcN+'</span>'+
        '<span class="uiChip" style="background:#f2f4f7;border-color:#dde3ea;color:#54657a">'+
          (Z?'附件 Files ':'Files ')+attN+'</span>')+
    '</table>'+
    '<div class="uiNote">⚠️ '+esc(T('pw.confirmSubmit'))+'</div>';
  // (通知) 下一關（本公司 Tier 2）審閱人選擇
  api('ptw.nextReviewers',{ptwId:cur.id}).then(function(rv){
    var users=(rv.ok&&rv.data.users)||[];
    if(users.length>1){
      html+='<div class="mt-3 text-start"><label class="form-label small fw-bold mb-1">👥 '+esc(T('rv.nextReviewer'))+'</label>'+
        '<select id="nextRevSel" class="form-select form-select-sm">'+
        '<option value="">📣 '+esc(T('rv.notifyAll'))+'</option>'+
        users.map(function(p){ return '<option value="'+esc(p.id)+'">👤 '+esc(lang==='zh'?(p.nameZh||p.nameEn):(p.nameEn||p.nameZh))+'</option>'; }).join('')+
        '</select></div>';
    }
  uiDialog({html:html,icon:'🚀',width:540,
    title:(Z?'提交送審確認':'Confirm submission'),
    sub:(cur.ptwNumber||cur.tempNumber)+' · '+(Z?'送出後進入第 2 關（承商職安衛）審核':'Goes to Step 2 — Contractor HSE review'),
    okText:(Z?'確定提交 Submit':'Submit'),okClass:'btn-success'}).then(function(ok){
    if(!ok) return;
    var revSel=document.getElementById('nextRevSel');
    var reviewerId=revSel?revSel.value:'';
    var btn=$('btnSubmitPtw'); btn.disabled=true;
    // 先儲存並「確認儲存成功」才提交；失敗即中止（避免以伺服器舊資料驗證）
    ensureSaved().then(function(sv){
      if(!sv||sv.ok===false){
        btn.disabled=false;
        toast(Z?'草稿儲存失敗，尚未提交 — 請再按一次提交':'Draft save failed — NOT submitted. Please try again.');
        return;
      }
      api('ptw.submit',{ptwId:cur.id,reviewerId:reviewerId||''}).then(function(res){
        btn.disabled=false;
        if(!res.ok){
          // 後端擋下（罕見）：同樣以逐項清單顯示
          var errs2=validateClient();
          if(errs2.length) showValErrors(errs2); else toast(apiMsg(res));
          return;
        }
        $('valErrors').innerHTML='';
        toast(T('pw.submitted'),true);
        openPtwList();
      });
    });
  });
  });
}
function withdrawPtw(){
  uiConfirm(lang==='zh'?'確定撤回/取消此 PTW？':'Withdraw this PTW?').then(function(ok){ if(!ok) return;
  api('ptw.withdraw',{ptwId:cur.id}).then(function(res){
    if(res.ok){ toast((lang==='zh'?'已取消':'Cancelled'),true); openPtwList(); } else toast(apiMsg(res));
  });});
}

/* ---------- 訓練 + 考試（§6） ---------- */
var trCourse=null, ytPlayer=null, ytTick=null, unreported={}, reporting=false, ytApiLoaded=false;

function openTraining(){
  showView('training');
  $('examArea').classList.add('d-none');
  $('trainingCard').classList.remove('d-none');
  loadTraining();
}
function loadTraining(){
  $('trInfo').textContent=T('common.loading')||'Loading…';
  api('training.getCourse',{lang:lang}).then(function(res){
    if(!res.ok){ $('trInfo').textContent=apiMsg(res); return; }
    var d=res.data;
    if(!d.course||!d.course.youtubeVideoId){ $('trInfo').textContent=T('tr.noVideo'); return; }
    trCourse=d.course;
    var mins=d.course.durationSec?Math.round(d.course.durationSec/60)+' min':'—';
    // (2) 已通過 → 顯示成績結果，不開放重考
    if(d.trainingPassed){
      var ex=d.lastExam||{};
      $('trInfo').innerHTML='<div class="p-4 text-center" style="background:linear-gradient(135deg,#e8f8ee,#f2fbf5);border:1px solid #bfe5cd;border-radius:12px">'+
        '<div style="font-size:2.6rem">🎉</div>'+
        '<h5 class="text-success mb-1">'+(lang==='zh'?'您已通過 PTW 訓練考試':'You have passed the PTW training exam')+'</h5>'+
        '<div class="mt-2">'+
        (ex.score!==undefined&&ex.score!==null?('<span class="badge bg-success me-2" style="font-size:.95rem">'+(lang==='zh'?'成績':'Score')+'：'+ex.score+' / 100</span>'):'')+
        (ex.submitAt?('<span class="badge bg-secondary me-2" style="font-size:.85rem">'+(lang==='zh'?'考試日期':'Exam date')+'：'+esc(String(ex.submitAt).substring(0,10))+'</span>'):'')+
        '<span class="badge bg-primary" style="font-size:.85rem">'+(lang==='zh'?'效期至':'Valid until')+'：'+esc(d.trainingValidUntil)+'</span></div>'+
        '<div class="small text-muted mt-3">'+(lang==='zh'
          ?'效期內無需重考；效期屆滿前系統將通知您重新受訓。課程：'
          :'No retake needed while valid; you will be notified before expiry. Course: ')+esc(d.course.title)+'</div>'+
        '<button class="btn btn-outline-primary mt-3" onclick="reviewVideos()">🎬 '+
        (lang==='zh'?'重新複習訓練影片':'Review Training Videos')+'</button></div>';
      $('playerWrap').classList.add('d-none');
      $('trPlaylist').classList.add('d-none');
      $('trProgressWrap').classList.add('d-none');
      trVideos=d.course.videos||[{id:d.course.youtubeVideoId,title:'',watchPercent:100,completed:true}];
      return;
    }
    $('trInfo').innerHTML='<b>'+esc(d.course.title)+'</b> · '+T('tr.version')+': '+esc(d.course.courseVersion)+
      ' · '+T('tr.duration')+': '+esc(mins);
    $('playerWrap').classList.remove('d-none');
    $('trProgressWrap').classList.remove('d-none');
    updateTrProgress(d.progress.watchPercent,d.progress.completed,d.examLockedUntil,d.canTakeExam);
    trVideos=d.course.videos||[{id:d.course.youtubeVideoId,title:'',watchPercent:d.progress.watchPercent,completed:d.progress.completed}];
    // 預設載入第一部未完成的影片
    curVid=trVideos[0]?trVideos[0].id:d.course.youtubeVideoId;
    for(var i=0;i<trVideos.length;i++){ if(!trVideos[i].completed){ curVid=trVideos[i].id; break; } }
    renderPlaylist();
    initYt(curVid);
  });
}
var trVideos=[],curVid=null;
function renderPlaylist(){
  var el=$('trPlaylist');
  if(!trVideos||trVideos.length<2){ el.classList.add('d-none'); el.innerHTML=''; return; }
  el.classList.remove('d-none');
  var h='<div class="d-flex flex-wrap gap-2">';
  trVideos.forEach(function(v,i){
    var active=(v.id===curVid);
    var label=v.title||((lang==='zh'?'影片 ':'Video ')+(i+1));
    h+='<button class="btn btn-sm '+(active?'btn-navy':'btn-outline-primary')+'" onclick="switchVideo(\\''+v.id+'\\')">'+
      (v.completed?'✅ ':'▶️ ')+esc(label)+' <span class="badge '+(v.completed?'bg-success':'bg-warning text-dark')+' ms-1">'+(v.watchPercent||0)+'%</span></button>';
  });
  el.innerHTML=h+'</div>';
}
function switchVideo(id){
  if(id===curVid) return;
  flushProgress();
  curVid=id;
  renderPlaylist();
  initYt(id);
}
/* 已通過者：重新複習影片（不影響通過狀態，僅播放） */
function reviewVideos(){
  if(!trVideos||!trVideos.length){ toast(T('tr.noVideo')); return; }
  curVid=trVideos[0].id;
  $('playerWrap').classList.remove('d-none');
  renderPlaylist();
  initYt(curVid);
  try{ $('playerWrap').scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){}
}
function updateTrProgress(pct,completed,lockDate,canTake){
  var bar=$('trProgressBar');
  bar.style.width=Math.max(3,pct)+'%'; bar.textContent=pct+'%';
  bar.className='progress-bar '+(completed?'bg-success':'bg-warning text-dark');
  var btn=$('btnStartExam');
  if(lockDate){
    $('trStatus').innerHTML='<span class="text-danger fw-bold">⛔ '+T('tr.locked')+' '+esc(lockDate)+'</span>';
    btn.classList.add('d-none');
  }else if(completed){
    $('trStatus').innerHTML='<span class="text-success">✅ '+T('tr.watchDone')+'</span>';
    btn.textContent=T('tr.startExam'); btn.classList.remove('d-none'); btn.disabled=false;
  }else{
    $('trStatus').innerHTML='<span class="text-muted">▶️ '+T('tr.needWatch')+'</span>';
    btn.classList.add('d-none');
  }
}
function initYt(videoId){
  if(ytPlayer){ try{ ytPlayer.loadVideoById(videoId); }catch(e){} return; }
  var make=function(){
    ytPlayer=new YT.Player('ytPlayer',{videoId:videoId,playerVars:{rel:0,modestbranding:1},
      events:{onStateChange:onYtState,onReady:function(ev){
        try{
          var dur=Math.round(ev.target.getDuration());
          var cv=(trVideos||[]).filter(function(v){ return v.id===curVid; })[0];
          if(dur>60&&(!cv||!cv.durationSec)){
            api('training.reportProgress',{courseId:trCourse.id,deltaSec:0,playerDurationSec:dur,videoId:curVid},{silent:true});
            if(cv) cv.durationSec=dur;
          }
        }catch(e){}
      }}});
  };
  if(window.YT&&window.YT.Player){ make(); return; }
  window.onYouTubeIframeAPIReady=make;
  if(!ytApiLoaded){
    ytApiLoaded=true;
    var s=document.createElement('script'); s.src='https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }
}
function onYtState(ev){
  if(ev.data===1){ // playing
    // 影片時長：每部影片開始播放時若尚未登記時長，立即回報（loadVideoById 不會再觸發 onReady）
    try{
      var cv0=(trVideos||[]).filter(function(v){ return v.id===curVid; })[0];
      var dur0=Math.round(ytPlayer.getDuration());
      if(dur0>60&&cv0&&!Number(cv0.durationSec||0)){
        api('training.reportProgress',{courseId:trCourse.id,deltaSec:0,playerDurationSec:dur0,videoId:curVid},{silent:true});
        cv0.durationSec=dur0;
      }
    }catch(e){}
    if(!ytTick) ytTick=setInterval(function(){
      // 每一秒記在「當下播放中」的影片帳上 — 兩部影片時間分開計算
      unreported[curVid]=(unreported[curVid]||0)+1;
      var tot=0,k; for(k in unreported) tot+=unreported[k];
      if(tot>=15||Object.keys(unreported).length>1) flushProgress();
    },1000);
  }else{
    stopYtTracking(false);
    if(ev.data===0) flushProgress(); // ended
  }
}
function stopYtTracking(clearAll){
  if(ytTick){ clearInterval(ytTick); ytTick=null; }
  if(clearAll!==false) flushProgress();
}
function flushProgress(){
  if(reporting||!trCourse) return;
  var ids=Object.keys(unreported).filter(function(k){ return unreported[k]>0; });
  if(!ids.length) return;
  var vid=ids[0], d=unreported[vid]; delete unreported[vid];
  reporting=true;
  // 時長僅在回報對象仍為當前影片時附帶（避免把 A 影片的時長寫到 B 影片）
  var dur=0; if(vid===curVid){ try{ dur=Math.round(ytPlayer.getDuration()); }catch(e){} }
  api('training.reportProgress',{courseId:trCourse.id,deltaSec:d,playerDurationSec:dur,videoId:vid},{silent:true}).then(function(res){
    reporting=false;
    if(Object.keys(unreported).length) flushProgress();   // 佇列中還有另一部影片的秒數 → 接著回報
    if(res.ok){
      if(res.data.videos){ trVideos=res.data.videos; renderPlaylist(); }
      updateTrProgress(res.data.watchPercent,res.data.completed,null,res.data.completed);
      // 目前影片已完成且整體未完成 → 提示切換下一部
      if(res.data.video&&trVideos.length>1&&!res.data.completed){
        var cv=trVideos.filter(function(v){ return v.id===curVid; })[0];
        if(cv&&cv.completed){
          var next=trVideos.filter(function(v){ return !v.completed; })[0];
          if(next) toast((lang==='zh'?'本部影片已完成！請繼續觀看：':'Video completed! Continue with: ')+(next.title||(lang==='zh'?'下一部影片':'the next video')),true);
        }
      }
    }
  });
}
/* ---------- 考試 ---------- */
var examData=null;
function startExam(){
  stopYtTracking();
  $('btnStartExam').disabled=true;
  api('exam.start',{lang:lang}).then(function(res){
    $('btnStartExam').disabled=false;
    if(!res.ok){ toast(apiMsg(res)); if(res.errorCode==='EXAM_LOCKED') loadTraining(); return; }
    examData=res.data;
    renderExam();
  });
}
/* 管理員：自題庫直接測試考試（不寫紀錄、不鎖定、不影響效期） */
function startPracticeExam(){
  api('exam.start',{lang:lang,practice:1}).then(function(res){
    if(!res.ok){ toast(apiMsg(res)); return; }
    examData=res.data;
    showView('training');
    renderExam();
  });
}
function renderExam(){
  try{ if(ytPlayer&&ytPlayer.pauseVideo) ytPlayer.pauseVideo(); }catch(e){}
  $('trainingCard').classList.add('d-none');
  var area=$('examArea'); area.classList.remove('d-none');
  var h='<h5>📝 '+T('ex.title')+(examData.resumed?' <span class="badge bg-info">Resumed</span>':'')+
    (examData.practice?' <span class="badge bg-warning text-dark">🧪 '+(lang==='zh'?'測試模式（不列入紀錄）':'Practice mode (not recorded)')+'</span>':'')+'</h5>'+
    '<div class="small text-muted mb-3">'+T('ex.hint')+'</div>';
  examData.questions.forEach(function(q,i){
    var qt=(lang==='zh'?q.questionZh:q.questionEn);
    h+='<div class="card-x p-3 mb-3" id="q_'+q.questionId+'"><b>Q'+(i+1)+'. '+esc(qt)+'</b>'+
       '<span class="badge bg-secondary ms-2">'+q.points+' pts</span><div class="mt-2">';
    if(q.type==='MC'){
      q.options.forEach(function(opt,j){
        var val=typeof opt==='string'?opt:JSON.stringify(opt);
        h+='<div class="form-check"><input class="form-check-input" type="radio" name="mc_'+q.questionId+'" id="mc_'+q.questionId+'_'+j+'" value="'+esc(val)+'">'+
           '<label class="form-check-label" for="mc_'+q.questionId+'_'+j+'">'+esc(val)+'</label></div>';
      });
    }else{
      if(q.options&&q.options.diagram==='ptwProcess') h+=ptwFlowDiagram();
      h+='<div class="small text-muted mb-1">'+T('ex.match')+'</div>';
      q.options.left.forEach(function(l){
        h+='<div class="row g-2 align-items-center mb-1"><div class="col-6">'+esc(l)+'</div><div class="col-6">'+
           '<select class="form-select form-select-sm" data-match="'+esc(q.questionId)+'" data-left="'+esc(l)+'">'+
           '<option value="">--</option>'+
           q.options.right.map(function(r){ return '<option value="'+esc(r)+'">'+esc(r)+'</option>'; }).join('')+
           '</select></div></div>';
      });
    }
    h+='</div></div>';
  });
  h+='<button class="btn btn-navy w-100" id="btnSubmitExam" onclick="submitExam()">'+T('ex.submit')+'</button>';
  area.innerHTML=h;
  window.scrollTo(0,0);
}
/* PTW 流程圖（配合題用：深灰角色框挖空 → ①～⑥ 待填） */
function ptwFlowDiagram(){
  var Z=(lang==='zh');
  var steps=[
    ['Prepare PTW application & supporting documents','準備 PTW 申請與輔助文件'],
    ['Confirm method statement','確認施工方法說明書'],
    ['Confirm risk assessment','確認風險評估'],
    ['Confirm all documentation & authorize issue','確認所有文件並授權核發'],
    ['Revalidation before / during / after work','作業前中後執行驗證（Revalidation）'],
    ['Confirm completion & sign-off by relevant parties','確認完工並由相關方簽認']
  ];
  var marks=['①','②','③','④','⑤','⑥'];
  var h='<div class="mb-2" style="background:linear-gradient(160deg,#0d2a40,#123a58);border-radius:12px;padding:14px">'+
    '<div class="text-center mb-2" style="color:#cfe3f5;font-weight:700;letter-spacing:.5px">🔄 PTW PROCESS FLOW '+(Z?'作業流程':'')+'</div>'+
    '<div class="d-flex flex-wrap justify-content-center align-items-stretch" style="gap:6px">';
  steps.forEach(function(s,i){
    h+='<div style="flex:1 1 150px;max-width:190px;background:#f4f8fb;border:1px solid #cfe0ef;border-radius:10px;padding:8px;display:flex;flex-direction:column">'+
      '<div style="background:#0b3a5c;color:#fff;border-radius:6px;font-size:.7rem;font-weight:700;padding:2px 8px;align-self:flex-start">STEP '+(i+1)+'</div>'+
      '<div class="small mt-1" style="line-height:1.25;flex:1"><b>'+esc(s[0])+'</b><br><span class="text-muted">'+esc(s[1])+'</span></div>'+
      '<div class="text-center mt-2" style="border:2px dashed #b8860b;background:#fffbea;border-radius:8px;padding:4px 6px;font-weight:800;color:#8a6d00">'+
        marks[i]+' <span style="letter-spacing:2px">＿＿＿</span> ❓</div>'+
      '</div>';
    if(i<steps.length-1) h+='<div class="align-self-center" style="color:#9ec5e8;font-size:1.2rem;font-weight:800">➤</div>';
  });
  h+='</div><div class="text-center small mt-2" style="color:#9db8cf">'+(Z
      ?'請在下方為 ①～⑥ 選出負責角色（Performing／Issuing…），全部答對才得 10 分'
      :'Select the responsible party for each blank ①–⑥ below — all must be correct to earn the 10 points')+'</div></div>';
  return h;
}
function collectAnswers(){
  var answers={}, missing=[];
  examData.questions.forEach(function(q,i){
    if(q.type==='MC'){
      var sel=document.querySelector('input[name="mc_'+q.questionId+'"]:checked');
      if(sel) answers[q.questionId]=sel.value; else missing.push('Q'+(i+1));
    }else{
      var map={}, all=true;
      document.querySelectorAll('select[data-match="'+q.questionId+'"]').forEach(function(s){
        if(s.value) map[s.getAttribute('data-left')]=s.value; else all=false;
      });
      answers[q.questionId]=map;
      if(!all) missing.push('Q'+(i+1));
    }
  });
  return {answers:answers,missing:missing};
}
function submitExam(){
  var c=collectAnswers();
  if(c.missing.length){ toast(T('ex.unanswered')+' '+c.missing.join(', ')); return; }
  uiConfirm('📝 '+T('ex.confirmSubmit')).then(function(ok){
    if(!ok) return;
    doSubmitExam(c);
  });
}
function doSubmitExam(c){
  var btn=$('btnSubmitExam'); btn.disabled=true;
  api('exam.submit',{attemptId:examData.attemptId,answers:c.answers}).then(function(res){
    if(!res.ok){ btn.disabled=false; toast(apiMsg(res)); return; }
    var d=res.data;
    var h='<div class="text-center p-4">'+
      (d.practice?'<div class="alert alert-warning py-2 small">🧪 '+(lang==='zh'
        ?'<b>測試模式</b> — 本次成績不列入任何紀錄，不影響鎖定與訓練效期。'
        :'<b>Practice mode</b> — this attempt is NOT recorded and does not affect locks or training validity.')+'</div>':'')+
      '<div style="font-size:3rem">'+(d.passed?'🎉':'😞')+'</div>'+
      '<h3 class="'+(d.passed?'text-success':'text-danger')+'">'+(d.passed?T('ex.passed'):T('ex.failed'))+'</h3>'+
      '<div class="fs-4 my-2">'+T('ex.score')+'：<b>'+d.score+'</b> / 100（'+(lang==='zh'?'及格':'pass')+' '+d.passScore+'）</div>'+
      (d.practice?'':(d.passed
        ?'<div class="text-success">'+T('ex.validUntil')+'：'+esc(d.trainingValidUntil||'')+'</div>'
        :'<div class="text-danger fw-bold">'+T('ex.nextDate')+' '+esc(d.nextExamDate||'')+'</div>'))+
      (d.practice?renderPracticeReview(d.results):'')+
      '<button class="btn btn-navy mt-3" onclick="'+(d.practice?'gotoAdmin()':'enter()')+'">'+
      (d.practice?(lang==='zh'?'返回題庫管理':'Back to Question Bank'):T('ex.backHome'))+'</button></div>';
    $('examArea').innerHTML=h;
    if(d.passed&&!d.practice){ api('auth.me',{}).then(function(r){ if(r.ok) sset('ptw_user',JSON.stringify(r.data.user)); }); }
  });
}
/* 測試模式：逐題對答（顯示正確答案，方便管理員核對題庫） */
function renderPracticeReview(results){
  if(!results||!results.length) return '';
  var h='<div class="text-start mt-3"><h6>'+(lang==='zh'?'逐題結果':'Per-question results')+'</h6>';
  results.forEach(function(r,i){
    var q=(examData.questions||[]).filter(function(x){ return x.questionId===r.questionId; })[0]||{};
    var qt=(lang==='zh'?q.questionZh:q.questionEn)||'';
    var corr=(typeof r.correct==='object'&&r.correct)?Object.keys(r.correct).map(function(k){ return k+' → '+r.correct[k]; }).join('、'):String(r.correct||'');
    h+='<div class="small border-bottom py-1">'+(r.isCorrect?'✅':'❌')+' <b>Q'+(i+1)+'</b>（'+r.points+(lang==='zh'?' 分':' pts')+'）'+esc(qt)+
      (r.isCorrect?'':'<br><span class="text-danger ms-3">'+(lang==='zh'?'正確答案：':'Correct: ')+esc(corr)+'</span>')+'</div>';
  });
  return h+'</div>';
}

/* ---------- init：首頁公開，點功能才登入；QR 直達 ?ptw=<id> ---------- */
switchLang(lang);
enter();
try{ if(window.PTW_VIEWS>0) $('viewCountVal').textContent=Number(window.PTW_VIEWS).toLocaleString(); }catch(e){}
if(window.PTW_OPEN_ID){
  requireLogin(function(){ openPtwFromQueue(window.PTW_OPEN_ID); });
}
// ?view=downloads（「前往下載專區」開新視窗用）→ 載入後自動捲到下載專區並高亮
if(window.PTW_GOTO==='downloads'){ setTimeout(scrollToDownloads,600); }
</script>
</body>
</html>
`;
