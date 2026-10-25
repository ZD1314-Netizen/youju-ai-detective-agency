import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { demoUsers } from '../public/demo-users.js';
const require = createRequire(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/qa.cjs'));
const { chromium } = require('playwright');
let calls = 0;
const server = createApp({ feedFetchImpl: async () => new Response('', { status: 503 }), dataDir: await mkdtemp(path.join(os.tmpdir(), 'youju-demo-ui-')), fetchImpl: async () => { calls++; throw Error('Unexpected search'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`, out = path.resolve('.work/qa'); await mkdir(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
  await page.goto(`${base}/#login`); await page.waitForLoadState('networkidle');
  await page.locator('.auth-tabs a[href="#demo-users"]').click(); await page.waitForSelector('.demo-user-card');
  assert.equal(await page.locator('.demo-user-card').count(), 4);
  assert.equal(await page.locator('.demo-users-list input').count(), 0);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1050 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width}`);
    await page.screenshot({ path: path.join(out, `demo-users-${width}.png`), fullPage: true });
  }
  console.log('PASS 登录/注册旁的案例入口与四个角色卡片；桌面和手机无溢出');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => localStorage.setItem('youju.cases.v1', '[]'));
  for (const selected of demoUsers) {
    await page.goto(`${base}/#demo-users`); await page.waitForSelector('.demo-user-card');
    await page.locator(`[data-demo-id="${selected.id}"]`).click();
    await page.waitForURL('**/#community'); await page.waitForLoadState('networkidle');
    assert.match(await page.locator('.account-switcher summary').innerText(), new RegExp(selected.nickname));
    await page.reload(); await page.waitForLoadState('networkidle');
    assert.match(await page.locator('.account-switcher summary').innerText(), new RegExp(selected.nickname));
    await page.goto(`${base}/#account`); await page.waitForSelector('.profile-banner');
    assert.equal(await page.locator('.profile-banner .role-demo').count(), 1);
    assert.equal(await page.locator('.profile-banner .role-admin').count(), 0);
    assert.equal(await page.locator('#profile-form, #password-form').count(), 0);
  }
  console.log('PASS 四个案例用户一键登录、身份切换、刷新保留及专用个人中心');
  await page.locator('.page-header [data-account=logout]').click(); await page.waitForURL('**/#login');
  assert.equal(await page.locator('#auth-form').count(), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('youju.cases.v1')), '[]');
  assert.equal(calls, 0); assert.deepEqual(errors, []);
  console.log('PASS 退出恢复密码登录；私人档案未变，零搜索调用且无脚本错误');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
