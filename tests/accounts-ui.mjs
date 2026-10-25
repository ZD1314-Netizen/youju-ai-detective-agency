import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
const require = createRequire(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/qa.cjs'));
const { chromium } = require('playwright');
const out = path.resolve('.work/qa'); await mkdir(out, { recursive: true });
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'youju-account-ui-'));
let calls = 0;
const server = createApp({ feedFetchImpl: async () => new Response('', { status: 503 }), dataDir, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ Response: { RequestId: 'TEST-ACCOUNT-SEARCH', Pages: [{ title: '仅测试来源', url: 'https://example.org/source', passage: '仅测试公开资料，不构成真实查询材料。' }] } })); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const errors = [], checks = []; let browser;
const pass = label => { checks.push(label); console.log('PASS ' + label); };
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = async () => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true, reducedMotion: 'reduce' }); const page = await ctx.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept()); return { ctx, page }; };
  const a = await context(), b = await context(); const page = a.page, manager = b.page;
  async function register(page, username, nickname) {
    await page.goto(base + '/#register'); await page.waitForSelector('#auth-username');
    await page.locator('#auth-username').fill(username); await page.locator('#auth-nickname').fill(nickname); await page.locator('#auth-password').fill('TEST-password-' + username); await page.locator('#auth-confirm').fill('TEST-password-' + username); await page.locator('[name=agreement]').check(); await page.locator('#auth-form button[type=submit]').click(); await page.waitForSelector('.recovery-panel');
  }
  await page.goto(base + '/#login'); await page.waitForSelector('#auth-form'); assert.equal(calls, 0);
  await page.locator('.auth-tabs a[href="#register"]').click(); await page.waitForSelector('#auth-nickname');
  await page.locator('#auth-username').fill('alice'); await page.locator('#auth-nickname').fill('查证员甲'); await page.locator('#auth-password').fill('TEST-password-alice'); await page.locator('#auth-confirm').fill('TEST-not-the-same-password'); await page.locator('[name=agreement]').check(); await page.locator('#auth-form button[type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#account-error').hidden); assert.match(await page.locator('#account-error').innerText(), /不一致/);
  await page.locator('#auth-confirm').fill('TEST-password-alice'); await page.locator('#auth-form button[type=submit]').click(); await page.waitForSelector('.recovery-panel');
  const recovery = await page.locator('#recovery-value').innerText(); assert.ok(recovery.length >= 40);
  const download = page.waitForEvent('download'); await page.locator('[data-account=download-recovery]').click(); assert.match(await readFile(await (await download).path(), 'utf8'), /alice/);
  assert.ok(await page.locator('.profile-banner .role-member').count()); assert.equal(await page.locator('.profile-banner .role-admin').count(), 0);
  await page.locator('[data-account=ack-recovery]').click(); await page.waitForSelector('.profile-banner');
  pass('注册校验、默认普通成员、恢复码单次展示与下载、注册后登录状态正常');
  await page.locator('#profile-nickname').fill('查证员甲更新'); await page.locator('#profile-interests').fill('科学常识'); await page.locator('#profile-form button[type=submit]').click(); await page.waitForFunction(() => document.querySelector('.profile-banner h2')?.textContent.includes('更新'));
  await page.locator('.page-header [data-account=logout]').click(); await page.waitForSelector('#auth-form'); await page.locator('#auth-username').fill('alice'); await page.locator('#auth-password').fill('TEST-wrong-password'); await page.locator('#auth-form button[type=submit]').click(); await page.waitForFunction(() => !document.querySelector('#account-error').hidden); assert.match(await page.locator('#account-error').innerText(), /不正确/);
  await page.locator('#auth-password').fill('TEST-password-alice'); await page.locator('#auth-form button[type=submit]').click(); await page.waitForSelector('.profile-banner'); assert.match(await page.locator('.profile-banner').innerText(), /查证员甲更新/);
  pass('个人资料保存、退出后重新登录、错误密码提示与身份恢复正常');
  await page.goto(base + '/#certification'); await page.waitForSelector('#volunteer-form'); assert.equal(await page.locator('.identity-card').count(), 5);
  await page.locator('[name=pledge]').check(); await page.locator('#volunteer-form button[type=submit]').click(); await page.waitForSelector('.cert-success');
  const statement = '仅测试申请材料说明：我关注科学常识，希望用公开资料核对常见说法的适用条件，能够列出出处和不同解释，也会明确自己的能力范围与不确定性，不将身份作为真伪依据。';
  await page.locator('#cert-type').selectOption('contributor'); await page.locator('#cert-field').fill('科学常识'); await page.locator('#cert-statement').fill(statement); await page.locator('#cert-links').fill('https://example.org/public-work'); await page.locator('[name=consent]').check(); await page.locator('#certification-form button[type=submit]').click(); await page.waitForSelector('.application-item .status-pending');
  assert.match(await page.locator('.applications-card').innerText(), /审核中/);
  await page.goto(base + '/#admin'); await page.waitForSelector('#bootstrap-form'); assert.equal(await page.locator('.admin-application').count(), 0);
  pass('五种身份规则展示、签署约定、申请材料提交与待审核状态可用；普通账户没有管理资料');
  await register(manager, 'manager', '测试管理员'); await manager.locator('[data-account=ack-recovery]').click(); await manager.goto(base + '/#admin'); await manager.waitForSelector('#bootstrap-form');
  const code = (await readFile(path.join(dataDir, 'admin-setup-code.txt'), 'utf8')).trim();
  await manager.locator('#setup-code').fill('TEST-wrong-code'); await manager.locator('#setup-password').fill('TEST-password-manager'); await manager.locator('#bootstrap-form button[type=submit]').click(); await manager.waitForFunction(() => !document.querySelector('#account-error').hidden); assert.match(await manager.locator('#account-error').innerText(), /初始化码不正确/);
  await manager.locator('#setup-code').fill(code); await manager.locator('#bootstrap-form button[type=submit]').click(); await manager.waitForSelector('.admin-review-form');
  await manager.locator('.account-switcher summary').click(); await manager.locator('[data-account=switch-member]').click(); await manager.waitForSelector('.community-hero'); await manager.locator('.account-switcher summary').click(); await manager.locator('[data-account=switch-admin]').click(); await manager.waitForSelector('.admin-review-form'); assert.equal(new URL(manager.url()).hash, '#admin');
  assert.match(await manager.locator('.admin-application').first().innerText(), /查证员甲更新/); assert.ok(await manager.locator('.application-links a').first().getAttribute('href'));
  await manager.locator('.admin-review-form select').selectOption('approved'); await manager.locator('.admin-review-form textarea').fill('仅测试：已核对申请人的公开材料，核验范围限于科学常识贡献。'); await manager.locator('.admin-review-form button[type=submit]').click(); await manager.waitForSelector('.status-approved');
  await page.goto(base + '/#certification'); await page.reload(); await page.waitForSelector('.status-approved');
  await page.goto(base + '/#account'); await page.waitForSelector('.profile-banner .role-contributor');
  pass('一次性本机初始化、防错误初始化码、跨账户审核通过与认证身份显示正常');
  await manager.locator('.admin-review-form textarea').fill('仅测试：公开材料发生变化，暂撤销社区核验，保留原贡献。'); await manager.locator('.admin-review-form button[type=submit]').click(); await manager.waitForSelector('.status-revoked');
  await page.reload(); await page.waitForSelector('.profile-banner'); assert.equal(await page.locator('.profile-banner .role-contributor').count(), 0);
  await page.goto(base + '/#certification'); await page.waitForSelector('.status-revoked');
  await page.locator('#cert-type').selectOption('reviewer'); await page.locator('#cert-field').fill('公开资料查证'); await page.locator('#cert-statement').fill(statement); await page.locator('#cert-links').fill('https://example.org/new-work'); await page.locator('[name=consent]').check(); await page.locator('#certification-form button[type=submit]').click(); await page.waitForSelector('.status-pending'); await page.locator('[data-account=withdraw-application]').click(); await page.waitForSelector('.status-withdrawn');
  pass('认证撤销会移除身份标识并保留说明，待审申请可以撤回');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['account', 'certification', 'admin']) { await page.goto(base + '/#' + route); await page.waitForTimeout(100); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route + ' overflow ' + width); await page.screenshot({ path: path.join(out, 'v4-' + route + '-' + width + '.png'), fullPage: true }); }
    const guestContext = await context(); await guestContext.page.setViewportSize({ width, height: 1000 });
    for (const route of ['login', 'register', 'recover']) { await guestContext.page.goto(base + '/#' + route); await guestContext.page.waitForSelector('#auth-form'); assert.ok(await guestContext.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route + ' overflow ' + width); await guestContext.page.screenshot({ path: path.join(out, 'v4-' + route + '-' + width + '.png'), fullPage: true }); } await guestContext.ctx.close();
  }
  pass('1440、390、320 宽度下登录、注册、恢复、个人中心、认证、管理权限页无横向溢出');
  await page.setViewportSize({ width: 1440, height: 1050 }); await page.goto(base + '/#account'); await page.locator('#current-password').fill('TEST-password-alice'); await page.locator('#new-password').fill('TEST-password-alice-new'); await page.locator('#new-confirm').fill('TEST-password-alice-new'); await page.locator('#password-form button[type=submit]').click(); await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('密码已更新'));
  await page.locator('.page-header [data-account=logout]').click(); await page.waitForSelector('#auth-form'); await page.goto(base + '/#recover'); await page.locator('#auth-username').fill('alice'); await page.locator('#auth-recovery').fill(recovery); await page.locator('#auth-password').fill('TEST-password-alice-reset'); await page.locator('#auth-confirm').fill('TEST-password-alice-reset'); await page.locator('#auth-form button[type=submit]').click(); await page.waitForSelector('.recovery-panel'); assert.notEqual(await page.locator('#recovery-value').innerText(), recovery);
  await page.locator('[data-account=ack-recovery]').click(); await page.waitForSelector('.profile-banner'); assert.match(await page.locator('.profile-banner').innerText(), /查证员甲更新/);
  assert.equal(calls, 0); assert.deepEqual(errors, []);
  pass('修改密码、恢复码找回和新恢复码轮换可用；账户流程不消耗搜索且无页面脚本错误');
  await writeFile(path.join(out, 'accounts-ui-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), upstream: 'no live requests or real accounts', checks, errors }, null, 2));
  console.log('Account UI checks passed: ' + checks.length);
} finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
