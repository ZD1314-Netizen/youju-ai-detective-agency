// Isolated UI checks. All upstream responses are test fixtures; no live API calls.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server.mjs';

const runtimeModules = process.env.PLAYWRIGHT_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const require = createRequire(path.join(runtimeModules, 'youju-tests.cjs'));
const { chromium } = require('playwright');
const outputDir = path.resolve('.work/qa');
await mkdir(outputDir, { recursive: true });
let scenario = 'normal';
const calls = [];
const testKey = 'TEST-ONLY-NOT-A-REAL-SERVICE-KEY';
const testPage = (title, url, passage) => JSON.stringify({ title, url, passage, site: new URL(url).hostname, date: '2026-10-25', score: 0.7 });
const fixtures = [
  [testPage('仅测试 · 原始资料 A', 'https://docs.example.com/source?utm_source=qa', '测试摘要 A，不能作为参赛事实证据。'), testPage('仅测试 · 规则说明 B', 'https://example.net/rule', '<b>测试摘要 B</b>')],
  [testPage('仅测试 · A 的重复链接', 'https://docs.example.com/source?utm_campaign=qa', '重复摘要'), testPage('<img src=x onerror="window.xssTriggered=true">仅测试 C', 'https://research.example.org/paper', '测试摘要 C <script>window.xssTriggered=true</script>')],
  [testPage('仅测试 · 不同来源 D', 'https://other.example.org/report', '这是测试数据，用于验证第三轮与报告。')]
];
const server = createApp({ feedFetchImpl: async () => new Response('', { status: 503 }), dataDir: await mkdtemp(path.join(os.tmpdir(), 'youju-isolated-ui-')),
  fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    if (scenario === 'stall') {
      await new Promise((resolve, reject) => {
        if (options.signal.aborted) return reject(options.signal.reason);
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    if (scenario === 'fail') return new Response(JSON.stringify({ Response: { Error: { Code: 'AuthFailure.InvalidCredential' }, RequestId: 'TEST-MOCK-FAILED' } }));
    await delay(90);
    return new Response(JSON.stringify({ Response: { Pages: fixtures[(calls.length - 1) % 3], RequestId: `TEST-MOCK-${calls.length}`, Version: 'test-fixture' } }));
  },
  aiFetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings: [{ text: '仅测试 AI 引用显示', sourceIds: ['S1'] }], uncertainties: ['仅测试数据'], status: 'unknown' }) } }] }))
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
function checked(label) { checks.push(label); console.log(`PASS ${label}`); }
try {
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const externalRequests = [];
  await context.route('https://**/*', async route => { externalRequests.push(route.request().url()); await route.fulfill({ contentType: 'text/html', body: '<html><body>Isolated test source page. No real web request.</body></html>' }); });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base);
  await page.waitForSelector('#question');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(outputDir, 'home-desktop.png'), fullPage: true });
  assert.equal(calls.length, 0);
  assert.equal(externalRequests.length, 0);
  assert.match(await page.title(), /有据/);
  checked('首页正常显示，没有自动搜索或外部网络请求');

  await page.locator('.connect-btn').click();
  await page.locator('#search-key').fill('AKID-TEST-ONLY-INVALID-SECRETID');
  await page.locator('#settings-form button[type=submit]').click();
  assert.match(await page.locator('#settings-error').innerText(), /SecretId/);
  assert.equal(calls.length, 0);
  await page.locator('#search-key').fill(testKey);
  await page.locator('#settings-form button[type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
  assert.equal(await page.evaluate(() => localStorage.getItem('youju.keys.v1')), null);
  assert.ok((await page.evaluate(() => sessionStorage.getItem('youju.keys.v1'))).includes(testKey));
  checked('设置拒绝 SecretId，服务密钥默认只保留在当前会话');

  await page.locator('#question').fill('仅测试问题：三轮搜索与证据去重');
  await page.locator('#search-form button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('.case-subtitle')?.textContent.includes('已完成检索'));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].Site, 'exclude:docs.example.com|example.net|research.example.org');
  assert.equal(await page.locator('.source-card').count(), 4);
  assert.equal(await page.evaluate(() => window.xssTriggered || false), false);
  assert.equal(await page.locator('.source-card img, .source-card script').count(), 0);
  await page.screenshot({ path: path.join(outputDir, 'results-test-fixture.png'), fullPage: true });
  checked('三轮搜索真实执行分步流程，第三轮调整域名范围，跨轮去重并拦截脚本内容');

  await page.locator('[data-annotation="S1"]').selectOption('supports');
  await page.locator('[data-action=favorite][data-source=S1]').click();
  const popupPromise = context.waitForEvent('page');
  await page.locator('#source-S1 .source-bottom a').click();
  const popup = await popupPromise; await popup.waitForLoadState();
  assert.match(popup.url(), /^https:\/\/docs\.example\.com\/source/);
  await popup.close();
  await page.locator('[data-action=tab][data-tab=report]').click();
  await page.locator('[data-verdict=unknown]').click();
  await page.locator('#case-notes').fill('仅测试人工结论：证据仍不足，需要核对原文。');
  const caseHash = new URL(page.url()).hash;
  await page.reload();
  await page.locator('[data-action=tab][data-tab=report]').click();
  assert.match(await page.locator('#case-notes').inputValue(), /仅测试人工结论/);
  checked('来源可打开，收藏、人工标记与结论能在刷新后恢复');

  const reportPromise = page.waitForEvent('download');
  await page.locator('[data-action=export-md]').click();
  const reportFile = await reportPromise;
  const report = await readFile(await reportFile.path(), 'utf8');
  assert.match(report, /仅测试人工结论/);
  assert.match(report, /TEST-MOCK-3/);
  assert.ok(!report.includes(testKey));
  const archivePromise = page.waitForEvent('download');
  await page.locator('[data-action=export-case]').click();
  const archiveFile = await archivePromise;
  const archivePath = await archiveFile.path();
  const archiveBody = await readFile(archivePath, 'utf8');
  assert.ok(!archiveBody.includes(testKey));
  await page.locator('a[href="#contest"]').click();
  assert.match(await page.locator('.contest-progress strong').innerText(), /1 \/ 3/);
  await page.locator('#import-file').setInputFiles({ name: 'test-archive.json', mimeType: 'application/json', buffer: Buffer.from(archiveBody) });
  await page.waitForSelector('.history-card');
  assert.equal(await page.locator('.history-card').count(), 2);
  await page.locator('a[href="#contest"]').click();
  assert.match(await page.locator('.contest-progress strong').innerText(), /1 \/ 3/);
  await page.locator('a[href="#bookmarks"]').click();
  assert.equal(await page.locator('.source-card').count(), 2);
  checked('报告与档案可导出/导入且不含密钥；导入档案不增加本机查询计数');

  await page.locator('[data-action=new]').click();
  await page.locator('#question').fill('仅测试取消调查');
  scenario = 'stall';
  const oldCalls = calls.length;
  await page.locator('#search-form button[type=submit]').click();
  await page.waitForSelector('[data-action=stop]');
  await page.waitForFunction(() => document.querySelector('.run-status')?.textContent.includes('第 1'));
  // Allow the local request to reach the test server before cancellation.
  for (let i = 0; i < 30 && calls.length === oldCalls; i++) await delay(20);
  await page.locator('[data-action=stop]').click();
  await page.waitForFunction(() => document.querySelector('.case-subtitle')?.textContent.includes('已停止'));
  assert.equal(calls.length, oldCalls + 1);
  checked('可以停止正在等待的查询，状态和已发出调用提示正确');

  scenario = 'fail';
  await page.locator('[data-action=new]').click();
  await page.locator('#question').fill('仅测试错误提示');
  await page.locator('[data-action=mode][data-mode=quick]').click();
  await page.locator('#search-form button[type=submit]').click();
  await page.waitForSelector('.error-message');
  assert.match(await page.locator('.error-message').innerText(), /服务 API KEY/);
  assert.match(await page.locator('.error-message').innerText(), /TEST-MOCK-FAILED/);
  checked('服务鉴权错误显示可操作提示及请求编号');

  // Expected server errors from the deliberately failed request are not UI bugs.
  const unexpectedErrors = errors.filter(message => !message.includes('Failed to load resource: the server responded with a status of 502'));
  assert.deepEqual(unexpectedErrors, []);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + '/#home');
    await page.waitForSelector('#question');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `home overflow ${width}`);
    await page.screenshot({ path: path.join(outputDir, `home-${width}.png`), fullPage: true });
    await page.locator('.menu-button').click();
    await page.locator('.sidebar a[href="#contest"]').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `contest overflow ${width}`);
    await page.locator('.connect-btn').click();
    assert.ok(await page.evaluate(() => document.querySelector('dialog').getBoundingClientRect().right <= innerWidth), `settings overflow ${width}`);
    await page.keyboard.press('Escape');
    await page.goto(base + '/' + caseHash);
    await page.waitForSelector('.source-card');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `results overflow ${width}`);
    await page.screenshot({ path: path.join(outputDir, `results-test-${width}.png`), fullPage: true });
    checked(`${width}px 手机宽度：首页、导航、设置、结果与清单没有横向溢出`);
  }
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(outputDir, 'report-test-print.pdf'), format: 'A4', printBackground: true });
  checked('报告打印可生成 PDF');

  // Optional AI path uses an isolated fake model transport as well.
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.connect-btn').click();
  await page.locator('.ai-settings summary').click();
  await page.locator('[name=enableAi]').check();
  await page.locator('#ai-base').fill('https://ai.example.org/v1');
  await page.locator('#ai-model').fill('TEST-MODEL');
  await page.locator('#settings-form button[type=submit]').click();
  scenario = 'normal';
  await page.locator('[data-action=new]').click();
  await page.locator('#question').fill('仅测试可选 AI 归纳');
  await page.locator('#search-form button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('.case-subtitle')?.textContent.includes('已完成检索'));
  assert.ok((await page.locator('.summary-content').innerText()).includes('仅测试 AI 引用显示'));
  await page.locator('.citation').first().click();
  assert.equal(await page.locator('#source-S1.flash').count(), 1);
  checked('可选 AI 归纳与来源引用跳转可用');
  await writeFile(path.join(outputDir, 'ui-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), upstream: 'mock only; no live Yuanbao requests', checks, errors: unexpectedErrors }, null, 2));
  console.log(`UI checks passed: ${checks.length}`);
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
