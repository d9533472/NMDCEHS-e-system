// ═══════════════════════════════════════════════════════════════════
// 匯入 2023 年「職安人員薪資調查」舊回覆
// 來源：https://docs.google.com/spreadsheets/d/1uMKXi6EH9KrvodOFwtaOFCfPDQu4VjK4TMg_W9avV7Q
//
// 【重要】舊調查問的是「111 年度（2022）」的收入，本系統問的是「2025 年度」。
//   匯入的每一筆都會在 source 欄標記 '2023調查匯入'，可隨時用
//   adminClearImported() 整批移除，或在報告中單獨排除。
// ═══════════════════════════════════════════════════════════════════

const LEGACY_SHEET_ID = '1uMKXi6EH9KrvodOFwtaOFCfPDQu4VjK4TMg_W9avV7Q';
// LEGACY_TAG 宣告在 程式碼.js（後台統計也要用它分開新舊資料）

// 舊欄位索引（0-based，對應 A~S）
const L = {
  ts: 0, edu: 1, oshLic: 2, otherLic: 3, skills: 4, lang: 5,
  yrsCon: 6, yrsPlant: 7, cat: 8, city: 9, contents: 10, ot: 11,
  otherMs: 12, monthly: 13, bonus: 14, annual: 15, prev: 16, sugg: 17, age: 18
};

// 年資級距 → 代表值（年）
const LEGACY_YRS = { '無': 0, '1年以下': 0.5, '1-3年': 2, '3-5年': 4, '5-10年': 7.5, '10年以上': 12 };

const LEGACY_OSH = {
  '甲級安全管理師': '甲級職業安全管理師',
  '甲級衛生管理師': '甲級職業衛生管理師',
  '乙級安全衛生管理員': '乙級職業安全衛生管理員',
  '甲種業務主管': '甲種職業安全衛生業務主管',
  '乙種業務主管': '乙種職業安全衛生業務主管',
  '丙種業務主管': '丙種職業安全衛生業務主管',
  '丁種業務主管': '丁種職業安全衛生業務主管'
};

const LEGACY_OTHER_LIC = {
  '環境(空類)證照': '環境專責-空汙類',
  '環境(水類)證照': '環境專責-水汙類',
  '環境(廢類)證照': '環境專責-廢棄物類',
  '環境(毒類)證照': '環境專責-毒化物類'
};

const LEGACY_SKILL = {
  'ISO45001職業安全衛生管理系統': 'ISO 45001 職業安全衛生管理系統',
  'ISO14001環境管理系統': 'ISO 14001 環境管理系統',
  'ISO50001能源管理系統': 'ISO 50001 能源管理系統',
  'ISO14064-1溫室氣體盤查': 'ISO 14064-1 溫室氣體盤查',
  'ISO14067碳足跡': 'ISO 14067 碳足跡',
  'ISO14046水足跡': 'ISO 14046 水足跡',
  'ISO9001': 'ISO 9001 品質管理系統',
  '電腦繪圖與視圖': '電腦繪圖（AutoCAD／SketchUp）'
};

const LEGACY_CONTENT = {
  '環保-空類': '環保-空汙類',
  '環保-水類': '環保-水汙類',
  '環保-廢類': '環保-廢棄物類',
  '環保-毒類': '環保-毒化物類',
  'ESG': 'ESG 永續報告書'
};

const LEGACY_CAT = {
  '營造業': '營造業', '廠工安': '廠工安', '外商': '外商', '國營': '國營',
  '科技業': '廠工安', '製造業': '傳產', '公職人員': '國營',
  '服務業': '其他：服務業', '航運業': '其他：航運業',
  '離岸風電相關產業': '其他：離岸風電'
};


// ══════════════════════════════════
// 後台用：匯入舊資料
//   count 留空／0／'all' → 全量匯入（預設）
//   count 為正整數       → 只隨機抽樣這麼多筆
// 兩種模式都會跳過「已經匯入過」的列，重複按不會灌出一堆分身
// ══════════════════════════════════
function adminImportLegacy(pw, count) {
  _auth(pw);
  const parsed = _legacyParseAll();
  if (!parsed.usable.length) {
    return { ok: false, error: '來源試算表沒有可用的資料（可能是沒有讀取權限）' };
  }

  // 已匯入的指紋：時間戳記＋月薪＋年收入。來源沒有時間戳記的少數列退而用薪資比對。
  const seen = {}, seenLoose = {};
  _readResponses().forEach(function (r) {
    if (String(r.source) !== LEGACY_TAG) return;
    seen[_legacyKey(r.timestamp, r.monthly_salary, r.annual_total)] = true;
    seenLoose[_legacyKey(null, r.monthly_salary, r.annual_total)] = true;
  });

  let dup = 0;
  const pending = parsed.usable.filter(function (p) {
    const k = p.ts ? _legacyKey(p.ts, p.payload.monthly_salary, p.payload.annual_total)
                   : _legacyKey(null, p.payload.monthly_salary, p.payload.annual_total);
    const hit = p.ts ? seen[k] : seenLoose[k];
    if (hit) { dup++; return false; }
    // 來源自己若有一模一樣的兩列，也只收第一筆
    if (p.ts) seen[k] = true; else seenLoose[k] = true;
    return true;
  });

  const wantAll = (count === '' || count === null || count === undefined ||
    String(count).toLowerCase() === 'all' || !(Number(count) > 0));
  let picked;
  if (wantAll) {
    picked = pending;
  } else {
    const pool = pending.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    picked = pool.slice(0, Math.min(Math.floor(Number(count)), pool.length));
  }

  if (!picked.length) {
    const s0 = adminSummary(pw);
    s0.message = '沒有新資料可匯入：來源共 ' + parsed.total + ' 筆，可解析 ' +
      parsed.usable.length + ' 筆，其中 ' + dup + ' 筆先前已經匯入過了。';
    return s0;
  }

  const sh = _ss().getSheetByName(SHEET_RESP);
  const out = picked.map(function (p) {
    const row = _buildRow(p.payload);
    row.timestamp = p.ts || new Date();
    row.source = LEGACY_TAG;
    row.joined_draw = '';
    return RESP_HEADERS.map(function (h) { return row[h] === undefined ? '' : row[h]; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, RESP_HEADERS.length).setValues(out);

  CacheService.getScriptCache().remove(CACHE_KEY);
  _log('admin_import', '匯入 ' + out.length + ' 筆 ' + LEGACY_TAG +
    (wantAll ? '（全量）' : '（抽樣）'));

  const s = adminSummary(pw);
  s.message = '已從 2023 年調查' + (wantAll ? '<b>全量</b>' : '隨機抽樣') + '匯入 <b>' +
    out.length + '</b> 筆。來源共 ' + parsed.total + ' 筆，可解析 ' + parsed.usable.length +
    ' 筆，略過 ' + parsed.skipped + ' 筆無法解析' +
    (dup ? '、' + dup + ' 筆先前已匯入' : '') +
    '。這些資料的 source 欄標記為「' + LEGACY_TAG + '」，可隨時整批移除。';
  return s;
}

// 匯入前先看清楚：來源有幾筆、可解析幾筆、已經進來幾筆、還差幾筆
function adminLegacyScan(pw) {
  _auth(pw);
  const parsed = _legacyParseAll();
  const seen = {}, seenLoose = {};
  let imported = 0;
  _readResponses().forEach(function (r) {
    if (String(r.source) !== LEGACY_TAG) return;
    imported++;
    seen[_legacyKey(r.timestamp, r.monthly_salary, r.annual_total)] = true;
    seenLoose[_legacyKey(null, r.monthly_salary, r.annual_total)] = true;
  });
  let pending = 0;
  parsed.usable.forEach(function (p) {
    const hit = p.ts
      ? seen[_legacyKey(p.ts, p.payload.monthly_salary, p.payload.annual_total)]
      : seenLoose[_legacyKey(null, p.payload.monthly_salary, p.payload.annual_total)];
    if (!hit) pending++;
  });
  return {
    ok: true, total: parsed.total, usable: parsed.usable.length,
    skipped: parsed.skipped, imported: imported, pending: pending,
    error: parsed.error || ''
  };
}

function _legacyKey(ts, monthly, annual) {
  const t = (ts instanceof Date) ? Math.floor(ts.getTime() / 1000) : '';
  return t + '|' + Number(monthly || 0) + '|' + Number(annual || 0);
}

// 後台用：移除所有匯入的舊資料
function adminClearImported(pw) {
  _auth(pw);
  const sh = _ss().getSheetByName(SHEET_RESP);
  const last = sh.getLastRow();
  if (last < 2) return _withMsg(pw, '沒有資料');
  const idx = RESP_HEADERS.indexOf('source') + 1;
  const col = sh.getRange(2, idx, last - 1, 1).getValues();
  let removed = 0;
  for (let i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]).trim() === LEGACY_TAG) { sh.deleteRow(i + 2); removed++; }
  }
  CacheService.getScriptCache().remove(CACHE_KEY);
  _log('admin_clear_imported', '移除 ' + removed + ' 筆');
  return _withMsg(pw, '已移除 ' + removed + ' 筆「' + LEGACY_TAG + '」資料');
}

function _withMsg(pw, msg) {
  const s = adminSummary(pw);
  s.message = msg;
  return s;
}


// ══════════════════════════════════
// 解析來源試算表
// ══════════════════════════════════
function _legacyParseAll() {
  let src;
  try {
    // 用表頭找正確的分頁，不要假設是第一個（網址上的 gid 不一定指向它）
    const sheets = SpreadsheetApp.openById(LEGACY_SHEET_ID).getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i];
      if (sh.getLastRow() < 2 || sh.getLastColumn() < 16) continue;
      const head = sh.getRange(1, 1, 1, Math.min(19, sh.getLastColumn())).getValues()[0].join('｜');
      if (head.indexOf('時間戳記') >= 0 && head.indexOf('月全薪') >= 0) { src = sh; break; }
    }
    if (!src) src = sheets[0];
  } catch (err) {
    return { total: 0, usable: [], skipped: 0, error: String(err) };
  }
  const last = src.getLastRow();
  if (last < 2) return { total: 0, usable: [], skipped: 0 };
  const values = src.getRange(2, 1, last - 1, 19).getValues();

  const usable = [];
  let skipped = 0;
  values.forEach(function (v) {
    const p = _legacyMapRow(v);
    if (p) usable.push(p); else skipped++;
  });
  return { total: values.length, usable: usable, skipped: skipped };
}

function _legacyMapRow(v) {
  const monthly = _legacyNum(v[L.monthly]);
  const annual = _legacyNum(v[L.annual]);
  // 薪資解析不出來或明顯不合理的直接略過，不要汙染統計
  if (!(monthly >= OUTLIER.monthlyMin && monthly <= OUTLIER.monthlyMax)) return null;
  if (!(annual >= OUTLIER.annualMin && annual <= OUTLIER.annualMax)) return null;
  if (annual < monthly * 6) return null;

  let bonus = _legacyNum(v[L.bonus]);
  if (isNaN(bonus) || bonus < 0 || bonus > annual) bonus = 0;

  const yc = LEGACY_YRS[String(v[L.yrsCon]).trim()];
  const yp = LEGACY_YRS[String(v[L.yrsPlant]).trim()];
  const yrsCon = (yc === undefined) ? 0 : yc;
  const yrsPlant = (yp === undefined) ? 0 : yp;
  if (yrsCon + yrsPlant <= 0) return null;   // 年資是分組主軸，沒有就不收

  const city = _legacyCity(v[L.city]);
  if (!city) return null;

  const eduText = String(v[L.edu] || '');
  const age = _legacyNum(v[L.age]);

  return {
    ts: (v[L.ts] instanceof Date) ? v[L.ts] : null,
    payload: {
      age: (age >= 16 && age <= 80) ? age : '',
      gender: '',
      education: _legacyEdu(eduText),
      major_field: _legacyMajor(eduText),
      osh_licenses: _legacyList(v[L.oshLic], LEGACY_OSH),
      other_licenses: _legacyList(v[L.otherLic], LEGACY_OTHER_LIC),
      skills: _legacyList(v[L.skills], LEGACY_SKILL),
      lang_points: _legacyLang(v[L.lang]),
      lang_test: '',
      lang_score_raw: String(v[L.lang] || '').slice(0, 60),
      yrs_construction: yrsCon,
      yrs_plant: yrsPlant,
      yrs_other: 0,
      yrs_total: yrsCon + yrsPlant,
      job_category: _legacyCat(v[L.cat]),
      industry_sub: '',
      job_title: '',
      is_dedicated: /職安專責/.test(String(v[L.contents] || '')) ? '是' : '',
      subordinates: '',
      company_size: '',
      work_city: city,
      job_contents: _legacyList(v[L.contents], LEGACY_CONTENT),
      shift_type: '',
      ot_mode: '每月',
      ot_hours_input: _legacyOt(v[L.ot]),
      ot_workdays: '',
      ot_pay_type: '',
      monthly_salary: monthly,
      annual_bonus: bonus,
      annual_total: annual,
      raise_last_year: '',
      benefits: [],
      annual_leave_days: '',
      prev_job: '',
      salary_change: _legacyChange(v[L.prev]),
      salary_change_pct: String(v[L.prev] || '').slice(0, 100),
      satisfaction: '',
      job_seeking: '',
      suggestion: String(v[L.sugg] || '').slice(0, 500),
      source: LEGACY_TAG
    }
  };
}

// 「70萬」「1,899,000」「40000-41000」「38000（新人起薪）」都要能解析
function _legacyNum(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return NaN;
  if (/^(無|０|暫無資料|還沒拿到|不知道|N\/A)$/i.test(s)) return 0;
  const wan = s.match(/([\d.]+)\s*萬/);
  if (wan) return Math.round(parseFloat(wan[1]) * 10000);
  const m = s.replace(/[,，\s]/g, '').match(/\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : NaN;
}

function _legacyEdu(t) {
  if (/博士/.test(t)) return '博士';
  if (/碩士|研究所|碩|所$|所\s/.test(t)) return '碩士';
  if (/二專|五專|專科/.test(t)) return '專科（二專／五專）';
  if (/二技|四技|技術學院|科技大學/.test(t)) return '四技二專';
  if (/高中|高職/.test(t)) return '高中職';
  if (/大學|學士|大$|系/.test(t)) return '大學';
  return '大學';
}

function _legacyMajor(t) {
  if (/職安|環安|工安|公衛|衛生|安全/.test(t)) return '職業安全衛生相關';
  if (/環工|環境|環保/.test(t)) return '環境工程／環境管理相關';
  if (/消防|防災/.test(t)) return '消防／防災相關';
  if (/企管|財金|法律|社會|國際事務|英語|外文|農經|商/.test(t)) return '商管／文法科系';
  if (/工業工程|化學|化工|機械|電子|電機|資工|農業|食品|工管|IE|材料|土木/.test(t)) return '其他理工科系';
  return '';
}

function _legacyList(raw, map) {
  const s = String(raw || '').trim();
  if (!s || s === '無' || s === '未使用其他證照') return [];
  return s.split(/[,，]/).map(function (x) {
    const k = x.trim();
    if (!k || k === '無') return '';
    return map[k] || k;
  }).filter(Boolean);
}

// 語言能力 → 0~5 分
function _legacyLang(raw) {
  const s = String(raw || '').trim();
  if (!s) return 0;
  if (/^(無|0|０|沒有)$/.test(s) || /無參加|不會|幼稚園|差強人意/.test(s)) return 0;

  let m = s.match(/(?:多益|TOEIC)\D{0,4}(\d{3,4})/i) ;
  if (!m) m = s.match(/^(\d{3,4})$/);           // 只填數字，視為多益
  if (m) return _bandToeic(Number(m[1]));

  m = s.match(/(?:托福|TOEFL)\D{0,4}(\d{2,3})/i);
  if (m) {
    const v = Number(m[1]);
    if (v >= 110) return 5; if (v >= 95) return 4; if (v >= 72) return 3; if (v >= 42) return 2;
    return 1;
  }
  m = s.match(/(?:雅思|IELTS)\D{0,4}(\d(?:\.\d)?)/i);
  if (m) {
    const v = parseFloat(m[1]);
    if (v >= 8) return 5; if (v >= 7) return 4; if (v >= 5.5) return 3; if (v >= 4) return 2;
    return 1;
  }
  m = s.match(/N\s*([1-5])/i);                   // JLPT
  if (m) { return { '1': 4, '2': 3, '3': 2, '4': 1, '5': 1 }[m[1]] || 1; }

  if (/優級/.test(s)) return 5;
  if (/高級/.test(s)) return 4;
  if (/中高級/.test(s)) return 3;
  if (/中級/.test(s)) return 2;
  if (/初級/.test(s)) return 1;
  return 0;   // 「國台語」「日常溝通」這類描述不算檢定成績
}

function _bandToeic(v) {
  if (v >= 945) return 5;
  if (v >= 860) return 4;
  if (v >= 730) return 3;
  if (v >= 550) return 2;
  if (v >= 350) return 1;
  return 0;
}

// 舊表這題是自由文字，只接受「看得懂」的寫法，
// 像「6週上班2週休息,上班為10小時/天」這種描述一律放棄，不要亂猜
function _legacyOt(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/不需加班|從不加班|無任何加班|^無$|^0$/.test(s)) return 0;
  if (s.length > 12) return '';
  const m = s.match(/^\D{0,4}(\d+(\.\d+)?)\s*(小時|hr|h|H)?\s*(左右|以內|以下)?$/);
  if (!m) return '';
  const v = parseFloat(m[1]);
  return (v >= 0 && v <= OUTLIER.otMax) ? v : '';
}

function _legacyCat(raw) {
  const first = String(raw || '').split(/[,，]/)[0].trim();
  if (!first) return '其他';
  return LEGACY_CAT[first] || ('其他：' + first);
}

function _legacyCity(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/台/g, '臺').split(/[-－（(]/)[0].trim();
  if (/^臺中港$/.test(s)) s = '臺中市';
  if (REGION_MAP[s]) return s;
  // 「臺中」「新竹」「新北」這類沒帶市縣的補上
  const guess = ['市', '縣'];
  for (let i = 0; i < guess.length; i++) {
    if (REGION_MAP[s + guess[i]]) return s + guess[i];
  }
  return '';
}

function _legacyChange(raw) {
  const s = String(raw || '');
  if (!s) return '';
  if (/差不多|持平/.test(s)) return '持平';
  if (/上升|提升|升/.test(s)) return '略為上升';
  if (/下降|略降|降|少約/.test(s)) return '略為下降';
  return '';
}


// ══════════════════════════════════
// 不寫入、只看對應結果（在編輯器執行，確認對應正確再匯入）
// ══════════════════════════════════
function previewLegacyImport() {
  const r = _legacyParseAll();
  const lines = ['來源共 ' + r.total + ' 筆｜可用 ' + r.usable.length + ' 筆｜略過 ' + r.skipped + ' 筆', ''];
  r.usable.slice(0, 12).forEach(function (p, i) {
    const d = p.payload;
    lines.push((i + 1) + '. ' + d.education + '／' + (d.major_field || '科系未分類') +
      '／年資 ' + d.yrs_total + '／' + d.job_category + '／' + d.work_city +
      '／月薪 ' + d.monthly_salary + '／年收 ' + d.annual_total +
      '／語言 ' + d.lang_points + ' 分／加班 ' + d.ot_hours_input);
  });
  const text = lines.join('\n');
  Logger.log(text);
  return text;
}
