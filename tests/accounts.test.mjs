import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createApp } from '../server.mjs';
async function setup() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'youju-accounts-'));
  let server, base; const jars = {};
  async function start() { server = createApp({ dataDir, fetchImpl: async () => new Response(JSON.stringify({ Response: { RequestId: 'TEST-ONLY-SEARCH', Pages: [{ title: '测试来源', url: 'https://example.org/source', passage: '仅测试来源摘要' }] } })) }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port; }
  const close = async () => { if (!server.listening) return; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  async function get(route = '', as = 'a') { const r = await fetch(base + '/api/community' + route, { headers: { Cookie: jars[as] || '' } }); return { status: r.status, data: await r.json() }; }
  async function post(action, body = {}, as = 'a') { const r = await fetch(base + '/api/community/' + action, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: jars[as] || '' }, body: JSON.stringify(body) }); const cookie = r.headers.get('set-cookie'); if (cookie) jars[as] = cookie.split(';')[0]; return { status: r.status, data: await r.json(), cookie }; }
  const register = (username, as = 'a') => post('register', { username, password: 'TEST-password-' + username, nickname: '测试' + username, agreement: true }, as);
  await start(); return { dataDir, jars, get, post, register, close, restart: async () => { await close(); await start(); } };
}
test('accounts persist login, rotate sessions, recover safely and protect secrets', async () => {
  const s = await setup(); const password = 'TEST-password-alice';
  try {
    const initial = await s.get(); assert.equal(initial.data.auth.adminInitialized, false);
    assert.equal((await s.post('register', { username: 'a', password: 'short', nickname: '测试', agreement: true })).status, 400);
    const created = await s.register('alice'); assert.equal(created.status, 200); assert.deepEqual(created.data.currentUser.roles, ['member']); assert.equal(created.data.currentUser.registered, true);
    assert.ok(created.data.recoveryCode.length >= 40); const recovery = created.data.recoveryCode, id = created.data.currentUser.id;
    assert.match(created.cookie, /HttpOnly; SameSite=Strict/); assert.ok(!created.cookie.includes('Max-Age'));
    const firstCookie = s.jars.a;
    assert.equal((await s.register('alice', 'duplicate')).status, 409);
    assert.equal((await s.post('login', { username: 'alice', password: 'TEST-wrong-password' }, 'wrong')).status, 401);
    const second = await s.post('login', { username: 'ALICE', password, remember: true }, 'b'); assert.equal(second.status, 200); assert.match(second.cookie, /Max-Age=2592000/); assert.equal(second.data.currentUser.id, id); assert.notEqual(s.jars.a, s.jars.b);
    assert.equal((await s.post('profile', { nickname: '更新昵称', interests: '科学常识', roles: ['admin'], username: 'mallory' })).status, 200);
    const me = (await s.get()).data.currentUser; assert.equal(me.username, 'alice'); assert.deepEqual(me.roles, ['member']);
    await s.post('sessions'); assert.equal((await s.get('', 'b')).data.currentUser, null);
    await s.post('login', { username: 'alice', password }, 'b');
    const changed = await s.post('password', { currentPassword: password, password: 'TEST-password-new-alice' }); assert.equal(changed.status, 200); assert.notEqual(s.jars.a, firstCookie); assert.equal((await s.get('', 'b')).data.currentUser, null);
    assert.equal((await s.post('login', { username: 'alice', password }, 'b')).status, 401);
    assert.equal((await s.post('recover', { username: 'alice', recoveryCode: 'BAD-TEST-CODE', password: 'TEST-password-reset-alice' }, 'b')).status, 401);
    const recovered = await s.post('recover', { username: 'alice', recoveryCode: recovery, password: 'TEST-password-reset-alice' }, 'b'); assert.equal(recovered.status, 200); assert.notEqual(recovered.data.recoveryCode, recovery); assert.equal((await s.get()).data.currentUser, null);
    assert.equal((await s.post('recover', { username: 'alice', recoveryCode: recovery, password: 'TEST-password-reset-again' }, 'x')).status, 401);
    const newRecovery = recovered.data.recoveryCode, currentCookie = s.jars.b; await s.restart();
    assert.equal((await s.get('', 'b')).data.currentUser.id, id);
    await s.post('logout', {}, 'b'); s.jars.stolen = currentCookie; assert.equal((await s.get('', 'stolen')).data.currentUser, null);
    assert.equal((await s.post('login', { username: 'alice', password: 'TEST-password-reset-alice' }, 'b')).status, 200);
    const disk = await readFile(path.join(s.dataDir, 'community.json'), 'utf8');
    for (const secret of [password, 'TEST-password-new-alice', 'TEST-password-reset-alice', recovery, newRecovery, s.jars.b.split('=')[1]]) assert.ok(!disk.includes(secret));
    const publicJson = JSON.stringify((await s.get('', 'b')).data); for (const key of ['tokenHash', 'recoveryHash', 'password', 'salt']) assert.ok(!publicJson.includes('"' + key + '"'));
  } finally { await s.close(); }
});

test('certification requires administrator decisions, blocks self-review and retains an audit', async () => {
  const s = await setup();
  try {
    await s.get(); await s.register('applicant'); await s.register('administrator', 'admin');
    assert.equal((await s.get('/admin')).status, 403);
    const topicForMember = await s.post('topics', { query: '仅测试公开资料查证主题', category: '生活求证', tier: 'lite', apiKey: 'TEST-ONLY-SEARCH' });
    assert.equal(topicForMember.status, 200);
    assert.equal((await s.post('reviews', { topicId: topicForMember.data.topicId, revision: 1, stance: 'unknown', sourceIds: ['S1'], reason: '仅测试：普通成员没有签署查证约定之前，不能绕过页面直接提交评议。' })).status, 403);
    assert.equal((await s.post('volunteer', { pledge: false })).status, 400);
    const apply = { type: 'contributor', field: '科学常识', statement: '仅测试申请说明：我会引用公开资料核对科学常识，区分研究条件和结论边界，不将搜索排名视作事实准确率，也愿意在新增证据出现后更新自己的意见。', links: ['https://example.org/public-work'], consent: true };
    assert.equal((await s.post('apply', apply)).status, 403); await s.post('volunteer', { pledge: true });
    const created = await s.post('apply', apply); assert.equal(created.status, 200); const applicationId = created.data.currentUser.applications[0].id;
    assert.equal((await s.post('apply', apply)).status, 409);
    const stranger = (await s.get('', 'admin')).data; assert.ok(!JSON.stringify(stranger).includes(apply.statement));
    assert.equal((await s.post('review-application', { applicationId, decision: 'approved', reason: '仅测试：材料可以核对，范围限于科学常识' })).status, 403);
    assert.equal((await s.post('admin-bootstrap', { code: 'WRONG', password: 'TEST-password-administrator' }, 'admin')).status, 403);
    const code = (await readFile(path.join(s.dataDir, 'admin-setup-code.txt'), 'utf8')).trim();
    const bootstrap = await s.post('admin-bootstrap', { code, password: 'TEST-password-administrator' }, 'admin'); assert.equal(bootstrap.status, 200); assert.ok(bootstrap.data.currentUser.roles.includes('admin'));
    await assert.rejects(readFile(path.join(s.dataDir, 'admin-setup-code.txt')));
    assert.equal((await s.post('admin-bootstrap', { code, password: 'TEST-password-applicant' })).status, 409);
    const list = await s.get('/admin', 'admin'); assert.equal(list.status, 200); assert.equal(list.data.applications[0].statement, apply.statement);
    assert.equal((await s.post('review-application', { applicationId, decision: 'approved', reason: '太短' }, 'admin')).status, 400);
    const approved = await s.post('review-application', { applicationId, decision: 'approved', reason: '仅测试：公开材料可核查，通过范围限于科学常识' }, 'admin'); assert.equal(approved.status, 200);
    const applicant = (await s.get()).data.currentUser; assert.ok(applicant.roles.includes('contributor')); assert.equal(applicant.certifications[0].field, '科学常识');
    await s.post('volunteer', { pledge: true }, 'admin'); const selfApply = await s.post('apply', { ...apply, type: 'reviewer' }, 'admin');
    assert.equal((await s.post('review-application', { applicationId: selfApply.data.currentUser.applications[0].id, decision: 'approved', reason: '仅测试：自己的申请必须禁止自我审核' }, 'admin')).status, 403);
    const revoked = await s.post('revoke-certification', { applicationId, reason: '仅测试：公开材料发生变化，撤销后需要重新核验' }, 'admin'); assert.equal(revoked.status, 200); assert.ok(!(await s.get()).data.currentUser.roles.includes('contributor'));
    assert.equal((await s.post('grant-admin', { username: 'applicant', reason: '仅测试：授权其共同处理社区审核与异议记录', password: 'WRONG' }, 'admin')).status, 401);
    assert.equal((await s.post('grant-admin', { username: 'applicant', reason: '仅测试：授权其共同处理社区审核与异议记录', password: 'TEST-password-administrator' }, 'admin')).status, 200);
    assert.equal((await s.get('/admin')).status, 200);
    const topic = await s.post('topics', { query: '仅测试公开生活资料原文问题', category: '生活求证', tier: 'lite', apiKey: 'TEST-ONLY-SEARCH' });
    assert.equal((await s.post('report', { topicId: topic.data.topicId, reason: '仅测试：需要核对公开资料的完整适用范围' })).status, 200);
    const reports = await s.get('/admin', 'admin'); const reportId = reports.data.reports[0].id;
    assert.equal((await s.post('resolve-report', { reportId, decision: 'resolved', reason: '仅测试：已经核对公开材料，记录所需补充说明' }, 'admin')).status, 200);
    const after = await s.get('/admin', 'admin'); assert.equal(after.data.reports[0].status, 'resolved'); assert.ok(after.data.audit.length >= 5);
    await s.restart(); assert.ok((await s.get()).data.currentUser.roles.includes('admin'));
  } finally { await s.close(); }
});

test('legacy identity binds an account without changing contribution ownership', async () => {
  const s = await setup();
  try {
    const token = 'TEST-LEGACY-TOKEN', personId = 'legacy-person'; await s.close();
    await writeFile(path.join(s.dataDir, 'community.json'), JSON.stringify({ version: 1, people: [{ id: personId, nickname: '旧昵称', interests: '', joinedAt: new Date().toISOString(), tokenHash: createHash('sha256').update(token).digest('hex') }], topics: [], reports: [] }));
    await s.restart(); s.jars.a = 'youju_member=' + token;
    assert.equal((await s.get()).data.auth.canClaimLegacy, true);
    const claimed = await s.post('claim', { username: 'legacy', nickname: '旧昵称', password: 'TEST-password-legacy', agreement: true });
    assert.equal(claimed.status, 200); assert.equal(claimed.data.currentUser.id, personId); assert.ok(claimed.data.currentUser.roles.includes('volunteer'));
    s.jars.old = 'youju_member=' + token; assert.equal((await s.get('', 'old')).data.currentUser, null);
  } finally { await s.close(); }
});

test('repeated failed logins are bounded and privileged materials stay private', async () => {
  const s = await setup();
  try {
    await s.register('testuser');
    for (let i = 0; i < 8; i++) assert.equal((await s.post('login', { username: 'testuser', password: 'TEST-wrong-pass' }, 'bad')).status, 401);
    assert.equal((await s.post('login', { username: 'testuser', password: 'TEST-password-testuser' }, 'bad')).status, 429);
    assert.equal((await s.get('/admin', 'bad')).status, 401);
  } finally { await s.close(); }
});
