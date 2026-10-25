// Verify the actual browser handoff and isolation of the illustrative walkthrough.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createApp } from '../server.mjs';

const require = createRequire(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/qa.cjs'));
const { chromium } = require('playwright');
let searches = 0;
const server = createApp({ feedFetchImpl: async () => new Response('', { status: 503 }), dataDir: await mkdtemp(path.join(os.tmpdir(), 'youju-walkthrough-')), fetchImpl: async () => { searches++; throw Error('Walkthrough must never search.'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const out = path.resolve('.work/qa'); await mkdir(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [], external = [];
  await context.route('https://**/*', route => { external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  page.on('request', request => { if (request.method() === 'POST') requests.push(request.url()); });
  await page.goto(base); await page.waitForLoadState('networkidle');
  const originalCases = await page.evaluate(() => localStorage.getItem('youju.cases.v1'));
  await page.locator('#question').fill('我尚未提交的疑问');
  await page.locator('.demo-trigger').click();
  await page.locator('#walkthrough-dialog').waitFor({ state: 'visible' });
  assert.match(await page.locator('.demo-notice').innerText(), /未调用搜索服务/);
  await page.locator('[data-demo=next]').click();
  assert.match(await page.locator('.demo-stage').innerText(), /尚未检索/);
  assert.equal(await page.locator('.demo-source a').getAttribute('href'), 'https://www.dpm.org.cn/');
  await page.screenshot({ path: path.join(out, 'redesign-demo-desktop.png') });
  await page.locator('#demo-tab-1').press('ArrowRight');
  assert.equal(await page.locator('#demo-tab-2').getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('.demo-stage').innerText(), /暂不下结论/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#question').inputValue(), '我尚未提交的疑问');
  assert.equal(await page.locator('.demo-trigger').evaluate(el => el === document.activeElement), true);
  console.log('PASS 演示三步切换、键盘、Esc 关闭与焦点恢复；原问题不丢失');
  await page.locator('.evidence-board').click();
  await page.locator('#demo-tab-2').click(); await page.locator('[data-demo=try]').click();
  await page.waitForFunction(() => !document.querySelector('#walkthrough-dialog').open);
  assert.match(await page.locator('#question').inputValue(), /法定节假日/);
  assert.equal(await page.locator('[data-mode=deep]').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('#question') === document.activeElement);
  assert.equal(await page.evaluate(() => localStorage.getItem('youju.cases.v1')), originalCases);
  assert.equal(requests.length, 0); assert.equal(searches, 0); assert.equal(external.length, 0);
  console.log('PASS 示例问题带回输入框与三轮模式；没有自动搜索、造档案或外部请求');
  for (const width of [1920, 1440, 1024, 768, 720, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Home overflow ${width}`);
    if (width <= 720) assert.ok(await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().right <= 0), `Hidden sidebar ${width}`);
    await page.screenshot({ path: path.join(out, `redesign-home-${width}.png`), fullPage: true });
    await page.locator('.demo-trigger').click();
    for (const step of [0, 1, 2]) {
      await page.locator(`#demo-tab-${step}`).click();
      assert.ok(await page.locator('#walkthrough-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Dialog overflow ${width}/${step}`);
      await page.locator('.walkthrough-footer').scrollIntoViewIfNeeded();
      if (width === 390 && step === 2) await page.screenshot({ path: path.join(out, 'redesign-demo-mobile.png') });
    }
    await page.keyboard.press('Escape');
  }
  console.log('PASS 1920/1440/1024/768/720/390/320px 首页与三步弹窗均无横向溢出');
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const route of ['community', 'resources', 'history', 'bookmarks', 'monitors', 'login', 'register', 'certification', 'contest']) {
    await page.goto(`${base}/#${route}`); await page.waitForLoadState('networkidle');
    assert.ok(await page.locator('main h1:visible').count() >= 1, route);
  }
  assert.deepEqual(errors, []);
  console.log('PASS 原有九个页面均正常渲染；浏览器无脚本错误');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
