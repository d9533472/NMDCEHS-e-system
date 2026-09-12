/**
 * ============================================================
 *  Offshore PTW — 「執行中 Active」定義修正補丁（2026-09-12）
 * ============================================================
 *  新定義：
 *    執行中 Active      = status 為 Active/Extended，且「現在時間」落在 validFrom ~ validTo 之間
 *    已核發待生效 Issued = status 為 Active/Extended，但 validFrom 還沒到（例：今天 9/12，PTW 9/16 才開始）
 *    逾期未關 Overdue    = 維持原邏輯（validTo 已過且未關閉）
 *
 *  只改「顯示／統計」邏輯，不改狀態機：資料庫 status 仍為 Active。
 *  影響範圍：首頁看板「執行中 PTW」、KPI 方塊（新增一顆「已核發待生效」）、PTW 清單篩選。
 *
 *  套用方式：依 PATCH 1 → 5 順序，在 GAS 那份 all-in-one 檔案中「找到舊程式碼 → 整段換成新程式碼」，
 *  存檔後「部署 → 管理部署 → 編輯 → 新版本」即可。
 * ============================================================
 */

/* ============================== PATCH 1：Utils.gs 新增共用判斷 ==============================
 * 位置：Utils.gs 區段，貼在 `function asBool_(v) {...}` 的下一行。
 * （新增，不取代任何東西）
 */
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


/* ============================== PATCH 2：DashboardService.dashboard() 的 KPI ==============================
 * 找到（在 DashboardService 內）：
 *
 *      approved: c(function (p) { return p.status === S.APPROVED; }),
 *      active: c(function (p) { return p.status === S.ACTIVE || p.status === S.EXTENDED; }),
 *      expiringSoon: c(function (p) {
 *
 * 換成下面三行（active 改為時間判斷，並新增 issuedPending）：
 */
//      approved: c(function (p) { return p.status === S.APPROVED; }),
//      active: c(function (p) { return ptwTimeState_(p, nowStr) === 'active'; }),
//      issuedPending: c(function (p) { return ptwTimeState_(p, nowStr) === 'notStarted'; }),
//      expiringSoon: c(function (p) {


/* ============================== PATCH 3：DashboardService.board() 的執行中清單 ==============================
 * 找到：
 *
 *    // 執行中：狀態 Active/Extended 且「未逾期」；已逾期者只出現在 Overdue 清單（不重複顯示）
 *    var active = all.filter(function (p) {
 *      return (p.status === S.ACTIVE || p.status === S.EXTENDED) &&
 *        !(p.validTo && p.validTo < nowStr);
 *    }).map(row).slice(0, 12);
 *
 * 換成：
 */
//    // 執行中：狀態 Active/Extended 且「現在」落在有效期間內；
//    // 已核發但尚未到開工日（validFrom > now）的不列在首頁看板（只在 PTW 清單／KPI「已核發待生效」看得到）；
//    // 已逾期者只出現在 Overdue 清單（不重複顯示）
//    var active = all.filter(function (p) {
//      return ptwTimeState_(p, nowStr) === 'active';
//    }).map(row).slice(0, 12);


/* ============================== PATCH 4：PTWService.list() 的狀態篩選 ==============================
 * 找到：
 *
 *      } else if (f.status === '_active') {
 *        rows = rows.filter(function (p) { return p.status === CFG.STATUS.ACTIVE || p.status === CFG.STATUS.EXTENDED; });
 *      } else if (f.status === '_expiringSoon') {
 *
 * 換成：
 */
//      } else if (f.status === '_active') {
//        var nowA = fmtDateTime_();
//        rows = rows.filter(function (p) { return ptwTimeState_(p, nowA) === 'active'; });
//      } else if (f.status === '_issuedPending') {
//        var nowI = fmtDateTime_();
//        rows = rows.filter(function (p) { return ptwTimeState_(p, nowI) === 'notStarted'; });
//      } else if (f.status === '_expiringSoon') {


/* ============================== PATCH 5：前端 INDEX_HTML_（同一檔案最下方的 HTML 字串） ==============================
 * 5-a  KPI 方塊：新增「已核發待生效」，放在「執行中」旁邊
 *      找到：
 *        ['total','#0b3a5c'],['draft','#6c757d'],['pending','#f0a500'],['approved','#1e7e34'],['active','#146c43'],
 *      換成：
 *        ['total','#0b3a5c'],['draft','#6c757d'],['pending','#f0a500'],['approved','#1e7e34'],['active','#146c43'],['issuedPending','#0b6bcb'],
 *
 * 5-b  KPI 點擊 → 清單篩選對照
 *      找到：
 *        var KPI_FILTER={total:'',draft:'Draft',pending:'_pending',approved:'Approved',active:'_active',
 *      換成：
 *        var KPI_FILTER={total:'',draft:'Draft',pending:'_pending',approved:'Approved',active:'_active',issuedPending:'_issuedPending',
 *
 * 5-c  i18n 文字
 *      找到：
 *        'kpi.active':{en:'Active',zh:'執行中'},
 *      換成：
 *        'kpi.active':{en:'Active (In Progress)',zh:'執行中'},
 *        'kpi.issuedPending':{en:'Issued (Not Started)',zh:'已核發待生效'},
 *
 * 5-d  PTW 清單的狀態下拉
 *      找到：
 *        <option value="_active" data-l>Active 執行中</option>
 *      換成：
 *        <option value="_active" data-l>Active 執行中</option>
 *        <option value="_issuedPending" data-l>Issued 已核發待生效</option>
 */
