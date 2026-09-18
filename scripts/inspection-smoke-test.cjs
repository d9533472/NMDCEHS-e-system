/**
 * 查驗紀錄管理系統 — 自動回歸測試
 * 把 inspection-system-cloud_8_1.html 的整個 App 掛在 jsdom 裡真的執行一遍，
 * 逐頁逐功能驗證。所有 API 都被攔截，不會碰到 Google Sheets / Drive 的正式資料。
 *
 * 用法：
 *   cd scripts
 *   npm install          （第一次才需要，安裝 react / react-dom / jsdom / babel）
 *   node inspection-smoke-test.cjs
 *
 * 全部通過會 exit 0，有任何一項失敗 exit 1。
 */
const fs = require('fs');
const path = require('path');

let JSDOM, Babel;
try {
  ({ JSDOM } = require('jsdom'));
  Babel = require('@babel/standalone');
} catch (e) {
  console.error('\n缺少測試相依套件。請先執行：\n  cd scripts && npm install\n');
  process.exit(2);
}
/* react / react-dom 必須等 jsdom 的 window、document 掛到 global 之後才 require；
   提早載入的話 react-dom 會判定「沒有 DOM 環境」，文字輸入的 input 事件會被忽略。 */
let React, ReactDOM, act;

const HTML = path.join(__dirname, '..', 'inspection-system-cloud_8_1.html');

// ══════════════════════════════════════════════════════════
// 測試用假資料（不是正式資料，數字刻意設計成好驗算）
//   可量化預算 38,900,000 ／ 不可量化(LS) 預算 5,000,000 ／ 總預算 43,900,000
//   已查驗(階段3) 90,000 ／ 進行中(階段1-2) 900,000
//   3 張查驗表、4 筆明細
// ══════════════════════════════════════════════════════════
const B = [
  { id: 'BQ1', item_no: '6.1.1', category: '人員', category_en: 'Personal', item_name_cn: '環境保護，管理人員', item_name_en: 'Environmental Manager', unit: 'month', budget_qty: 10, unit_price: 100000, budget_total: 1000000, remarks: '', code: 'X1' },
  { id: 'BQ2', item_no: '6.1.9', category: '空氣', category_en: 'Air', item_name_cn: '環境保護，空氣污染防制，防塵網', item_name_en: 'Anti-dust net', unit: 'M2', budget_qty: 1000, unit_price: 900, budget_total: 900000, remarks: '', code: 'X2' },
  { id: 'BQ3', item_no: '6.1.18', category: '監測', category_en: 'Monitoring', item_name_cn: '環境保護，環境監測，海域水質', item_name_en: 'Marine water quality', unit: 'time-set', budget_qty: 300, unit_price: 40000, budget_total: 12000000, remarks: '', code: 'X3' },
  { id: 'BQ4', item_no: '6.1.20', category: '監測', category_en: 'Monitoring', item_name_cn: '環境保護，環境監測，水下噪音', item_name_en: 'Underwater noise', unit: 'time-set', budget_qty: 10, unit_price: 2500000, budget_total: 25000000, remarks: '', code: 'X4' },
  { id: 'BL1', item_no: '6.2.22', category: '其他', category_en: 'Others', item_name_cn: '環境保護，其他環保相關設施、人員、材料', item_name_en: 'Other', unit: 'LS', budget_qty: 1, unit_price: 5000000, budget_total: 5000000, remarks: '', code: 'X5' },
];
const P = 'NMDC-POE-BOQ-E-';
const mkIns = (id, group, bid, qty, stage, area, submit) => {
  const b = B.find(x => x.id === bid);
  return {
    id: id, group_id: group, inspection_date: '2026-08-01', budget_item_id: bid,
    item_name_snapshot: b.item_name_cn, inspected_qty: qty, unit_price_snapshot: b.unit_price,
    inspected_amount: qty * b.unit_price, note: '', attachment_ids: [], attachment_names: [],
    created_at: '2026-08-01', created_by: 'Test', updated_at: '', updated_by: '', deleted: 'FALSE',
    submit_date: submit || '', approve_date: '', stage: stage, work_area: area || '',
    folder_id: '', folder_name: ''
  };
};
const INS = [
  mkIns(P + '001', P + '001', 'BQ2', 100, 3, '通霄工區', '2026-08-10'),   // 已查驗 90,000
  mkIns(P + '002-1', P + '002', 'BQ1', 2, 1, '台中工區'),                 // 進行中 200,000
  mkIns(P + '002-2', P + '002', 'BQ3', 5, 1, '台中工區'),                 // 進行中 200,000
  mkIns(P + '003', P + '003', 'BL1', 0.1, 2, ''),                         // 進行中 500,000（LS，未填工區）
];

// 依假資料算出「應該顯示什麼」，避免把數字寫死
const nf = new Intl.NumberFormat('zh-TW');
const money = n => nf.format(Math.round(n));
const pct = n => (n * 100).toFixed(1) + '%';
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const isLS = b => String(b.unit).toUpperCase() === 'LS' || String(b.item_no).startsWith('6.2');
const EXP = (() => {
  const amt = i => i.inspected_amount;
  const okIns = INS.filter(i => i.stage >= 3);
  const totalBudget = sum(B, b => b.budget_total);
  const done = sum(okIns, amt);
  const wip = sum(INS.filter(i => i.stage < 3), amt);
  const qB = sum(B.filter(b => !isLS(b)), b => b.budget_total);
  const lB = sum(B.filter(b => isLS(b)), b => b.budget_total);
  const qDone = sum(okIns.filter(i => !isLS(B.find(b => b.id === i.budget_item_id))), amt);
  const lDone = sum(okIns.filter(i => isLS(B.find(b => b.id === i.budget_item_id))), amt);
  const forms = [...new Set(INS.map(i => i.group_id))];
  return {
    totalBudget, done, wip, remaining: totalBudget - done - wip,
    qRatio: qDone / qB, lRatio: lDone / lB,
    forms: forms.length, rows: INS.length,
    stageCounts: [1, 2, 3].map(s => forms.filter(g => Math.min(...INS.filter(i => i.group_id === g).map(i => i.stage)) === s).length),
    monitorItems: B.filter(b => b.category === '監測').length,
  };
})();

// 後端 getSummary 會回的格式（統計由前端自己算，這裡只要提供原始資料）
const summary = {
  budgetItems: B.map(b => ({ ...b, total_qty: 0, inspected_qty: 0, inspected_amt: 0, remaining_qty: 0, remaining_amt: 0, ratio: 0 })),
  inspections: INS,
  totals: { totalBudget: EXP.totalBudget, totalRecords: INS.length, stageCounts: EXP.stageCounts },
  drive_folder_id: 'FAKE_ROOT',
  timestamp: '2026-09-17T00:00:00Z'
};

// ══════════════════════════════════════════════════════════
const pass = [], fail = [];
const ok = (m, d) => { pass.push(m); console.log('  PASS  ' + m + (d ? '  (' + d + ')' : '')); };
const bad = (m, d) => { fail.push(m + (d ? ' — ' + d : '')); console.log('  FAIL  ' + m + (d ? '  (' + d + ')' : '')); };
const check = (c, m, d) => c ? ok(m, d) : bad(m, d);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
// 注意：Node 24 的 global.navigator 只有 getter，要用 defineProperty 覆蓋
const globals = {
  window, document: window.document, navigator: window.navigator, self: window,
  HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
  Event: window.Event, MouseEvent: window.MouseEvent, getComputedStyle: window.getComputedStyle,
  requestAnimationFrame: cb => setTimeout(cb, 0), cancelAnimationFrame: id => clearTimeout(id),
  localStorage: window.localStorage, Blob: window.Blob, FileReader: window.FileReader,
  IS_REACT_ACT_ENVIRONMENT: true,
};
for (const k of Object.keys(globals)) {
  try { Object.defineProperty(global, k, { value: globals[k], writable: true, configurable: true }); }
  catch (e) { /* 覆蓋不了就沿用原生的 */ }
}
window.URL.createObjectURL = () => 'blob:fake';

// ← 環境就緒後才載入 React
try {
  React = require('react');
  ReactDOM = require('react-dom');
  act = React.act || require('react-dom/test-utils').act;   // React 18.3+ 用 React.act
} catch (e) {
  console.error('\n缺少測試相依套件。請先執行：\n  cd scripts && npm install\n');
  process.exit(2);
}

const calls = [];
let nextNo = 16;
const json = o => ({ ok: true, status: 200, json: async () => o });
const baseFetch = async (url, opt) => {
  const u = String(url);
  if (opt && opt.method === 'POST') {
    const body = JSON.parse(opt.body);
    calls.push({ kind: 'POST', action: body.action, data: body.data, want: !!body.want_summary });
    if (body.action === 'addInspection') return json({ success: true, inspection_id: P + '0' + (nextNo++), folder_id: 'FAKEFOLDER', item_count: (body.data.items || []).length, snapshot: '2026-09-18_1000-00_addInspection.json' });
    if (body.action === 'updateInspection') return json({ success: true, inspection_id: body.data.inspection_id, folder_id: 'FAKEFOLDER', snapshot: '2026-09-18_1000-01_updateInspection.json' });
    if (body.action === 'deleteInspection') return json({ success: true, deleted: 1, snapshot: '2026-09-18_1000-02_deleteInspection.json' });
    if (body.action === 'createSnapshot') return json({ success: true, snapshot: '2026-09-18_1000-03_manual.json', url: 'https://drive.google.com/x', message: '快照已建立：2026-09-18_1000-03_manual.json' });
    return json({ success: true, message: 'ok' });
  }
  const sp = new URL(u).searchParams;
  const action = sp.get('action');
  calls.push({ kind: 'GET', action, fresh: sp.get('fresh') === '1' });
  if (action === 'getSummary') return json(JSON.parse(JSON.stringify(summary)));
  if (action === 'getNextNumber') return json({ next_number: 16, formatted: P + '016' });
  if (action === 'getLogs') return json([{ id: 'LOG-1', action: 'CREATE', target: 'inspection', detail: '測試日誌', timestamp: '2026-09-17T00:00:00Z', action_by: 'Admin' }]);
  if (action === 'listSnapshots') return json({ folder_id: 'SNAPDIR', folder_url: 'https://drive.google.com/snap', count: 2, files: [
    { id: 's1', name: '2026-09-18_1000-01_updateInspection_' + P + '002.json', size: 41000, created: '2026-09-18T02:00:01Z', url: 'https://drive.google.com/s1' },
    { id: 's2', name: '2026-09-18_1000-00_addInspection_' + P + '016.json', size: 40500, created: '2026-09-18T02:00:00Z', url: 'https://drive.google.com/s2' }] });
  return json({});
};
global.fetch = baseFetch;

const html = fs.readFileSync(HTML, 'utf8');
const src = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1];
let code;
try { code = Babel.transform(src, { presets: ['react'] }).code; }
catch (e) { bad('JSX 編譯', e.message); finish(); }

const errors = [];
const origError = console.error;
console.error = (...a) => {
  const m = a.map(String).join(' ');
  if (!/ReactDOM.render is no longer supported|not wrapped in act|ReactDOMTestUtils.act is deprecated|unmountComponentAtNode is deprecated|Not implemented: navigation/.test(m)) errors.push(m);
};

const alerts = [], confirms = [];
global.alert = m => alerts.push(String(m));
global.confirm = m => { confirms.push(String(m)); return true; };
window.alert = global.alert; window.confirm = global.confirm;
const XLSXStub = { read: () => ({ SheetNames: ['預算項目表'], Sheets: { '預算項目表': {} } }), utils: { sheet_to_json: () => [{ budget_item_id: 'BQ1', item_no: '6.1.1', budget_qty: 99 }] } };

const run = () => new Function('React', 'ReactDOM', 'XLSX', 'window', 'document', 'alert', 'confirm', 'localStorage', 'fetch', 'Blob', 'FileReader', 'URL', 'setTimeout', code)
  (React, ReactDOM, XLSXStub, window, document, global.alert, global.confirm, global.localStorage, (...a) => global.fetch(...a), global.Blob, global.FileReader, window.URL, setTimeout);

const txt = () => document.getElementById('root').textContent;
const all = sel => Array.from(document.querySelectorAll(sel));
const findByText = (t, sel) => all(sel || 'div,button,span,a,td,th,h1,h3,h4,label')
  .filter(e => (e.textContent || '').trim() === t || (t instanceof RegExp && t.test((e.textContent || '').trim())))
  .sort((a, b) => a.textContent.length - b.textContent.length)[0];
const click = async el => { if (!el) throw new Error('找不到元素'); await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const setVal = async (el, v) => {
  if (!el) throw new Error('找不到輸入欄位');
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : (el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype);
  // 先讓 React 的 value tracker 失效，否則受控元件可能忽略這次變更
  if (el._valueTracker) el._valueTracker.setValue(' force');
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  await act(async () => { el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); });
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isItemSel = s => Array.from(s.options).some(o => /選擇預算項目/.test(o.textContent));
const flat = () => txt().replace(/\s+/g, ' ');

function finish() {
  console.error = origError;
  console.log('\n════════ 結果 ════════');
  console.log('PASS ' + pass.length + ' / FAIL ' + fail.length);
  if (errors.length) { console.log('\n執行期錯誤 ' + errors.length + ' 筆：'); errors.slice(0, 8).forEach(e => console.log('  ! ' + e.slice(0, 300))); }
  if (fail.length) { console.log('\n失敗項目：'); fail.forEach(f => console.log('  - ' + f)); }
  else if (!errors.length) console.log('\n全部功能正常 ✓');
  process.exit(fail.length || errors.length ? 1 : 0);
}

(async () => {
  console.log('\n── 啟動與載入 ──');
  await act(async () => { run(); });
  await act(async () => { await sleep(60); });
  check(/Dashboard/.test(txt()), '首次載入完成');
  check(calls.some(c => c.action === 'getSummary'), '開頁自動呼叫 getSummary');

  console.log('\n── Dashboard ──');
  check(flat().includes(money(EXP.done)), '已查驗金額正確', 'NT$ ' + money(EXP.done));
  check(flat().includes(money(EXP.totalBudget)), '總預算正確', 'NT$ ' + money(EXP.totalBudget));
  check(flat().includes(money(EXP.wip)), '進行中金額正確', 'NT$ ' + money(EXP.wip));
  check(flat().includes(money(EXP.remaining)), '未查驗金額正確', 'NT$ ' + money(EXP.remaining));
  check(flat().includes(pct(EXP.qRatio)), '可量化項目達成率', pct(EXP.qRatio));
  check(flat().includes(pct(EXP.lRatio)), '不可量化項目請款比例', pct(EXP.lRatio));
  check(all('svg circle').length >= 4, '兩個圓弧儀表有渲染');
  check(/10%/.test(txt()) && /100%/.test(txt()), '里程碑標記');
  check(flat().includes(EXP.stageCounts[2] + ''), '階段統計晶片');
  check(!/查驗階段 Pipeline/.test(txt()), 'Pipeline 卡片已移除');
  check(!/類別預算 vs 已查驗/.test(txt()), '類別長條圖已移除');
  check(!/未查驗金額最高 Top 8/.test(txt()), 'Top 8 已移除');
  check(/各項目查驗狀態總覽/.test(txt()), '各項目狀態總覽保留');
  check(all('table tbody tr').length === B.length, '總覽表列數 = 預算項目數', B.length + ' 列');
  check(flat().includes(EXP.forms + ' / ' + EXP.forms) || flat().includes(EXP.stageCounts[2] + ' / ' + EXP.forms), '查驗表計數', EXP.stageCounts[2] + '/' + EXP.forms);

  console.log('\n── 側欄 ──');
  const navs = all('.navi').map(e => e.textContent.trim());
  check(navs.length === 6, '側欄 6 個項目', navs.join(' / '));
  check(/備註/.test(navs[navs.length - 1]), '備註在最下面');

  console.log('\n── 查驗總表 ──');
  await click(findByText(/^📋\s*查驗總表$/, '.navi'));
  check(/查驗總表/.test(txt()), '頁面切換');
  check(all('table.tbl-wide').length === 1, '寬表格樣式（避免欄位擠壓）');
  check(all('table.tbl-wide tbody tr').length === B.length, '列數正確');
  const searchBox = all('input[placeholder*="搜尋項次"]')[0];
  await setVal(searchBox, '防塵網');
  check(all('table.tbl-wide tbody tr').length === 1, '搜尋過濾', '防塵網 → 1 列');
  await setVal(searchBox, '');
  const catSel = all('select')[0];
  await setVal(catSel, '監測');
  check(all('table.tbl-wide tbody tr').length === EXP.monitorItems, '類別篩選', '監測 → ' + EXP.monitorItems + ' 列');
  await setVal(catSel, '');

  console.log('\n── 項目明細彈窗 ──');
  await click(all('table.tbl-wide tbody tr td button')[0]);
  check(/歷次查驗/.test(txt()), '明細彈窗開啟');
  check(/預算數量/.test(txt()) && /已查驗（已提交台電）/.test(txt()), '明細 KPI');
  await click(findByText('✕', 'button'));
  check(!/歷次查驗/.test(txt()), '彈窗可關閉');

  console.log('\n── 查驗紀錄（查驗表分組） ──');
  await click(findByText(/^📝\s*查驗紀錄$/, '.navi'));
  const cards = () => all('.card').filter(c => new RegExp(P).test(c.textContent));
  check(cards().length === EXP.forms, '查驗表張數', EXP.forms + ' 張／明細 ' + EXP.rows + ' 筆');
  check(/張查驗表/.test(txt()), '底部統計列');
  const multi = cards().find(c => /2 個項目/.test(c.textContent));
  check(!!multi, '多項目查驗表顯示「2 個項目」');
  await click(multi.firstElementChild);
  check(/明細編號/.test(txt()), '展開明細表格');
  check(/本表合計/.test(txt()), '明細有本表合計');
  check(all('tbody tr').filter(r => /-1$|-2$/.test((r.querySelector('td') || {}).textContent || '')).length >= 2, '明細編號為「表編號-序號」');
  await click(cards().find(c => /2 個項目/.test(c.textContent)).firstElementChild);
  check(!/明細編號/.test(txt()), '可再收合');

  console.log('\n── 登入 / 權限 ──');
  check(!findByText('＋ 新增查驗表', 'button'), '未登入看不到新增按鈕');
  await click(all('[title="點擊登入管理"]')[0] || findByText('🔐', 'div'));
  check(/管理員/.test(txt()), '登入成功');
  check(!!findByText('＋ 新增查驗表', 'button'), '登入後出現新增按鈕');

  console.log('\n── 新增查驗表（多項目） ──');
  await click(findByText('＋ 新增查驗表', 'button'));
  check(/新增查驗表/.test(txt()), '新增彈窗開啟');
  check(calls.some(c => c.action === 'getNextNumber'), '自動取號');
  const areaSel = all('select').find(s => Array.from(s.options).some(o => /請選擇工區/.test(o.textContent)));
  check(['台中工區', '通霄工區', '離岸作業', '專案'].every(w => areaSel.textContent.includes(w)), '工區選項正確');
  await setVal(areaSel, '通霄工區');
  let sels = all('select').filter(isItemSel);
  check(sels.length === 1, '預設 1 個項目列');
  await setVal(sels[0], 'BQ3');
  await setVal(all('input[type=number]')[0], '12');
  check(flat().includes(money(12 * 40000)), '第 1 項金額計算', '12 × 40,000');
  await click(findByText('＋ 新增項目', 'button'));
  sels = all('select').filter(isItemSel);
  check(sels.length === 2, '可新增第 2 個項目列');
  await setVal(sels.find(s => s.value === ''), 'BQ4');
  await setVal(all('input[type=number]')[1], '2');
  check(flat().includes(money(12 * 40000 + 2 * 2500000)), '本張查驗表合計', money(12 * 40000 + 2 * 2500000));
  check(flat().includes(P + '016 通霄工區 海域水質 等2項'), '資料夾名稱（多項目）');
  await click(findByText('3. 已提交台電', 'button'));
  check(all('input[type=date]').some(d => d.value && d.value.length === 10), '選階段3自動帶入提交日期');
  await click(findByText('2. POE查驗完成', 'button'));
  await click(findByText('＋ 新增項目', 'button'));
  await setVal(all('select').filter(isItemSel).find(s => s.value === ''), 'BQ3');
  await click(findByText(/新增並儲存至雲端/, 'button'));
  check(alerts.some(a => /重複/.test(a)), '重複項目被擋下');
  const xs = all('button').filter(b => b.textContent === '✕');
  await click(xs[xs.length - 1]);
  await setVal(all('input[type=number]')[0], '99999');
  await click(findByText(/新增並儲存至雲端/, 'button'));
  check(alerts.some(a => /超過剩餘量/.test(a)), '超過剩餘量被擋下');
  await setVal(all('input[type=number]')[0], '12');
  const n0 = calls.length;
  await click(findByText(/新增並儲存至雲端/, 'button'));
  await act(async () => { await sleep(80); });
  const add = calls.slice(n0).find(c => c.action === 'addInspection');
  check(!!add, '送出 addInspection');
  if (add) {
    check(add.data.items.length === 2, 'payload 帶 2 筆明細', add.data.items.map(i => i.budget_item_id + ':' + i.inspected_qty).join(','));
    check(add.data.work_area === '通霄工區', 'payload 帶工區');
    check(add.data.stage === 2, 'payload 帶階段');
    check(Array.isArray(add.data.attachments) && add.data.attachments.length === 0, '附件與紀錄分離（先建紀錄再上傳）');
    check(add.want === true, '要求後端附帶最新統計');
  }

  console.log('\n── 編輯查驗表 ──');
  await click(findByText('編輯', 'button'));
  check(/編輯查驗表/.test(txt()), '編輯彈窗開啟');
  check(all('input[type=number]').length >= 1, '帶入既有明細');
  const n1 = calls.length;
  await click(findByText(/^☁ 儲存至雲端$/, 'button'));
  check(alerts.some(a => /請選擇工區/.test(a)), '未填工區時擋住存檔（必填驗證）');
  await setVal(all('select').find(s => Array.from(s.options).some(o => /請選擇工區/.test(o.textContent))), '離岸作業');
  await click(findByText(/^☁ 儲存至雲端$/, 'button'));
  await act(async () => { await sleep(120); });
  const upd = calls.slice(n1).find(c => c.action === 'updateInspection');
  check(!!upd, '送出 updateInspection');
  if (upd) {
    check(String(upd.data.inspection_id).startsWith(P), '以查驗表編號更新', upd.data.inspection_id);
    check(upd.data.items.length >= 1 && upd.data.items.every(i => i.row_id), '既有明細帶 row_id（不會重建）');
    check(upd.data.work_area === '離岸作業', '可補上工區');
  }

  console.log('\n── 階段推進 / 刪除 ──');
  const n2 = calls.length;
  await click(all('div').filter(d => /點擊推進到下一階段/.test(d.getAttribute('title') || ''))[0]);
  await act(async () => { await sleep(60); });
  const st = calls.slice(n2).find(c => c.action === 'updateInspection');
  check(!!st && st.data.stage >= 2, '點階段可推進', st ? 'stage→' + st.data.stage : '');
  const n3 = calls.length;
  await click(findByText('刪除', 'button'));
  await act(async () => { await sleep(60); });
  check(!!calls.slice(n3).find(c => c.action === 'deleteInspection'), '刪除送出 deleteInspection');
  check(confirms.some(c => /整張查驗表/.test(c)), '刪除前有確認提示');
  check(/已留快照/.test(txt()), '存檔／刪除後提示已留快照');

  console.log('\n── CSV 匯出 ──');
  let blob = null;
  window.URL.createObjectURL = b => { blob = b; return 'blob:fake'; };
  await click(findByText('📥 CSV', 'button'));
  check(!!blob, 'CSV 產生成功');
  if (blob) {
    const csvText = typeof blob.text === 'function' ? await blob.text()
      : await new Promise(r => { const fr = new window.FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsText(blob); });
    const lines = csvText.trim().split('\n');
    check(['查驗表編號', '明細編號', '工區', '計入已查驗'].every(h => lines[0].includes(h)), 'CSV 欄位完整');
    check(lines.length === EXP.rows + 1, 'CSV 列數 = 明細數', EXP.rows + ' 筆');
  }

  console.log('\n── 操作日誌 / 設定 ──');
  await click(findByText(/^📜\s*操作日誌$/, '.navi'));
  await act(async () => { await sleep(60); });
  check(/測試日誌/.test(txt()), '日誌載入');
  await click(findByText(/^⚙️\s*設定$/, '.navi'));
  const stx = txt();
  check(/雲端連線/.test(stx), '雲端連線區塊');
  check(/Google Drive 附件/.test(stx), 'Drive 區塊');
  check(/查驗編號 工區 項目/.test(stx), '資料夾命名規則說明');
  check(/匯入\/更新預算項目/.test(stx), 'Excel 匯入區塊');
  const VER = (html.match(/const VER='([^']+)'/) || [])[1];
  check(stx.includes('v' + VER), '版本號顯示', 'v' + VER);

  console.log('\n── 資料快照 ──');
  check(/資料快照（自動備份）/.test(stx), '設定頁有資料快照區塊');
  check(/before/.test(stx) && /還原/.test(stx), '說明提到 before 欄位可還原');
  const n5 = calls.length;
  await click(findByText(/載入清單/, 'button'));
  await act(async () => { await sleep(60); });
  check(calls.slice(n5).some(c => c.action === 'listSnapshots'), '載入快照清單');
  check(/updateInspection/.test(txt()) && /addInspection/.test(txt()), '快照檔名列出');
  check(/共 2 份快照/.test(flat()), '顯示快照總數');
  check(all('a').some(a => /開啟快照資料夾/.test(a.textContent)), '有開啟資料夾連結');
  const n6 = calls.length;
  await click(findByText(/立即建立快照/, 'button'));
  await act(async () => { await sleep(80); });
  check(calls.slice(n6).some(c => c.action === 'createSnapshot'), '可手動建立快照');
  check(calls.slice(n6).filter(c => c.action === 'listSnapshots').length >= 1, '建立後自動重新載入清單');

  console.log('\n── 備註（localStorage） ──');
  await click(findByText(/^📒\s*備註$/, '.navi'));
  await click(findByText('＋ 新增備註', 'button'));
  check(!!all('textarea')[0], '新增備註');
  await setVal(all('textarea')[0], '測試備註內容');
  check(/測試備註內容/.test(localStorage.getItem('nmdc_insp_notes') || ''), '寫入 localStorage');
  await click(all('button').filter(b => /📍|📌/.test(b.textContent))[0]);
  check(/"pinned":true/.test(localStorage.getItem('nmdc_insp_notes') || ''), '置頂功能');
  await click(all('button').filter(b => b.textContent === '🗑')[0]);
  check(!/測試備註內容/.test(localStorage.getItem('nmdc_insp_notes') || ''), '刪除備註');

  console.log('\n── 效能機制 ──');
  await click(findByText(/^📊\s*Dashboard$/, '.navi'));
  const n4 = calls.length;
  await click(findByText(/從雲端同步/, 'button'));
  await act(async () => { await sleep(60); });
  check(calls.slice(n4).some(c => c.action === 'getSummary'), '手動同步有效');
  check(calls.filter(c => c.kind === 'GET' && c.action === 'getSummary' && c.fresh).length >= 1, '手動同步帶 fresh=1（略過後端快取）');
  check(!/cdn\.sheetjs\.com/.test(html.split('text/babel')[0]), 'xlsx 改為延遲載入（開頁不下載）');
  check(typeof window.XLSX === 'undefined', '啟動時未載入 xlsx');
  const cached = JSON.parse(localStorage.getItem('nmdc_insp_cache_v1') || 'null');
  check(!!cached && cached.data.budgetItems.length === B.length, '同步後寫入本機快取');
  check(calls.filter(c => c.kind === 'POST' && c.want).length >= 3, '寫入時要求附帶統計（省一次往返）');

  console.log('\n── 快取優先渲染（模擬重新開頁） ──');
  let release; const held = new Promise(r => { release = r; });
  global.fetch = async (url, opt) => {
    if (!opt && /getSummary/.test(String(url))) { await held; return json(JSON.parse(JSON.stringify(summary))); }
    return baseFetch(url, opt);
  };
  ReactDOM.unmountComponentAtNode(document.getElementById('root'));
  await act(async () => { run(); });
  await act(async () => { await sleep(30); });
  check(flat().includes(money(EXP.done)), '雲端還沒回應就先用快取渲染（不再等 3 秒空白）');
  release();
  await act(async () => { await sleep(50); });
  check(flat().includes(money(EXP.done)), '雲端資料回來後畫面正常');
  global.fetch = baseFetch;

  finish();
})().catch(e => { bad('測試中斷', (e.stack || String(e)).split('\n').slice(0, 3).join(' | ')); finish(); });
