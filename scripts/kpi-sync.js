// 用無頭 Chrome 開啟改善單系統儀表板，讓頁面自己執行「自動同步 KPI 總結圖到週報」，
// 等到主控台出現「KPI 總結圖已自動同步」才算成功。
// 由 .github/workflows/kpi-sync.yml 於每週一 08:50（台北）執行；本機也可測：
//   set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe && node scripts/kpi-sync.js
const puppeteer = require('puppeteer-core');

const PAGE_URL = 'https://d9533472.github.io/NMDCEHS-e-system/tpc-pipeline-improvement-system_30.html';
const ESYSTEM_GAS = 'AKfycbyT6kFs6nCt6YCHyQjdbMxgErkOHNxwcIuncju0UkzBq4TvGOIigINusItj9bvcUbRrcw';
const TIMEOUT_MS = 150000;

(async () => {
  const t0 = Date.now();
  const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=zh-TW', '--font-render-hinting=none'],
  });
  let ok = false, failReason = '';
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' });

    const done = new Promise((resolve) => {
      page.on('console', (msg) => {
        const text = msg.text();
        if (/KPI|週報|匯出/.test(text)) log('console: ' + text);
        if (text.includes('KPI 總結圖已自動同步')) { ok = true; resolve(); }
        if (text.includes('週報同步失敗')) { failReason = text; resolve(); }
      });
      page.on('response', (res) => {
        const req = res.request();
        if (req.method() === 'POST' && res.url().includes(ESYSTEM_GAS)) log(`POST → E-System GAS：HTTP ${res.status()}`);
      });
      page.on('pageerror', (e) => log('pageerror: ' + e.message));
    });

    log('開啟 ' + PAGE_URL);
    await page.goto(PAGE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    log('頁面載入完成，等待自動同步…');
    await Promise.race([done, new Promise((r) => setTimeout(r, TIMEOUT_MS))]);
    if (!ok && !failReason) failReason = `等待 ${TIMEOUT_MS / 1000} 秒仍未看到同步完成訊息`;
  } catch (e) {
    failReason = e.message;
  } finally {
    await browser.close();
  }
  if (ok) { log('✅ KPI 總結圖已同步到週報'); process.exit(0); }
  console.error('❌ 同步失敗：' + failReason);
  process.exit(1);
})();
