import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server.mjs';
import { demoUsers } from '../public/demo-users.js';

test('demo login selects fixed identities, rotates real sessions and never grants admin or fabricates verification', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'youju-demo-api-'));
  let searches = 0, cookie = '';
  const server = createApp({ dataDir, fetchImpl: async () => { searches++; throw Error('Unexpected search'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body, overrideCookie = cookie) => {
    const response = await fetch(`${base}/api/community/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: overrideCookie }, body: JSON.stringify(body) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    return { response, data: await response.json() };
  };
  try {
    const registered = await post('register', { username: 'real_member', nickname: '真实测试成员', password: 'TEST-real-member-password', agreement: true });
    assert.equal(registered.response.status, 200); const realId = registered.data.currentUser.id, realCookie = cookie;
    const invalid = await post('demo-login', { demoId: 'real_member', roles: ['admin'] });
    assert.equal(invalid.response.status, 400);
    for (const selected of demoUsers) {
      const result = await post('demo-login', { demoId: selected.id, roles: ['admin'], username: 'real_member', personId: realId });
      assert.equal(result.response.status, 200); const u = result.data.currentUser;
      assert.equal(u.isDemo, true); assert.equal(u.username, selected.username); assert.notEqual(u.id, realId);
      assert.ok(u.roles.includes(selected.role)); assert.ok(!u.roles.includes('admin')); assert.deepEqual(u.certifications, []);
      assert.equal(result.data.auth.adminInitialized, false); assert.equal(result.data.members, 1);
      assert.match(result.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
      const adminResponse = await fetch(`${base}/api/community/admin`, { headers: { Cookie: cookie } }); assert.equal(adminResponse.status, 403);
      assert.equal((await post('profile', { nickname: '覆盖案例身份' })).response.status, 403);
    }
    const old = await (await fetch(`${base}/api/community`, { headers: { Cookie: realCookie } })).json(); assert.equal(old.currentUser, null);
    await post('logout', {});
    assert.equal((await post('register', { username: demoUsers[0].username, nickname: '预占演示', password: 'TEST-reserved-password', agreement: true })).response.status, 409);
    const first = await post('demo-login', { demoId: demoUsers[0].id }); const firstId = first.data.currentUser.id;
    const again = await post('demo-login', { demoId: demoUsers[0].id }); assert.equal(again.data.currentUser.id, firstId);
    const realLogin = await post('login', { username: 'real_member', password: 'TEST-real-member-password' });
    assert.equal(realLogin.response.status, 200); assert.equal(realLogin.data.currentUser.id, realId); assert.deepEqual(realLogin.data.currentUser.roles, ['member']);
    const disk = JSON.parse(await readFile(path.join(dataDir, 'community.json'), 'utf8'));
    assert.equal(disk.people.filter(p => p.isDemo).length, 4); assert.equal(disk.people.length, 5); assert.equal(disk.topics.length, 0);
    assert.equal(searches, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
