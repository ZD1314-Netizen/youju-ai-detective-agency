import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { normalizeResponse } from '../lib/search.mjs';

test('official pictures survive normalization; only HTTPS source images are accepted', () => {
  const result = normalizeResponse({ Response: { Pages: [{ title: '测试', url: 'https://example.org/a', pics: [{ origin_url: 'https://images.example.org/photo.png', caption: '<b>图注</b>' }, { origin_url: 'javascript:alert(1)' }, null, { origin_url: 'http://example.org/unsafe.png' }] }] } });
  assert.deepEqual(result.sources[0].pictures, [{ url: 'https://images.example.org/photo.png', caption: '图注' }]);
});

test('shared topics require real search sources and cited opinions; identity, revision and persistence work', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'youju-community-'));
  let calls = 0, empty = false, contentVersion = 1;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ Response: { Pages: empty ? [] : [{ title: '仅测试公开材料', url: 'https://example.org/source', passage: '仅测试摘要 ' + contentVersion, pics: [{ origin_url: 'https://images.example.org/a.png', caption: '测试配图' }] }], RequestId: 'TEST-COMMUNITY-' + calls } })); };
  let server = createApp({ dataDir, fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let base = 'http://127.0.0.1:' + server.address().port;
  const jars = { alice: '', bob: '' };
  async function post(action, body, person = 'alice') {
    const response = await fetch(base + '/api/community/' + action, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(jars[person] ? { Cookie: jars[person] } : {}) }, body: JSON.stringify(body) });
    if (response.headers.get('set-cookie')) { assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); jars[person] = response.headers.get('set-cookie').split(';')[0]; }
    return { status: response.status, data: await response.json() };
  }
  const get = person => fetch(base + '/api/community', { headers: { Cookie: jars[person] || '' } }).then(r => r.json());
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  try {
    assert.equal((await get('alice')).topics.length, 0);
    assert.equal((await post('topics', { query: '仅测试公开问题', category: '生活求证' })).status, 401); assert.equal(calls, 0);
    assert.equal((await post('profile', { nickname: '甲方侦探', pledge: false })).status, 401);
    const profile = await post('register', { username: 'alice', password: 'TEST-only-password-alice', nickname: '甲方侦探', interests: '科学常识', agreement: true });
    assert.equal(profile.status, 200); assert.equal(profile.data.currentUser.role, 'member');
    await post('volunteer', { pledge: true });
    await post('register', { username: 'bob', password: 'TEST-only-password-bob', nickname: '乙方侦探', interests: '出行规则', agreement: true }, 'bob');
    await post('volunteer', { pledge: true }, 'bob');
    assert.equal((await get('alice')).members, 2); assert.notEqual(jars.alice, jars.bob);
    const missing = await post('topics', { query: '仅测试公开问题', category: '生活求证', apiKey: 'AKID-TEST-INVALID' }); assert.equal(missing.status, 400); assert.equal(calls, 0);
    const created = await post('topics', { query: '仅测试公开问题的原始依据', category: '生活求证', apiKey: 'TEST-ONLY-SEARCH-KEY', tier: 'standard' });
    assert.equal(created.status, 200); assert.equal(calls, 1); const id = created.data.topicId;
    assert.equal(created.data.topics[0].sources[0].pictures.length, 1);
    assert.equal((await get('bob')).topics[0].id, id);
    const reason = '仅测试评议：依据所引用的公开材料，但摘要没有给出完整适用条件，因此仍需打开原文进一步核对。';
    assert.equal((await post('reviews', { topicId: id, revision: 1, stance: 'unknown', reason, sourceIds: ['S999'] })).status, 400);
    const one = await post('reviews', { topicId: id, revision: 1, stance: 'unknown', reason, sourceIds: ['S1'] });
    assert.equal(one.status, 200); const aliceId = one.data.currentUser.id;
    const two = await post('reviews', { topicId: id, revision: 1, stance: 'challenges', reason: reason + '这里有不同理解。', sourceIds: ['S1'], personId: aliceId }, 'bob');
    assert.equal(two.data.topics[0].reviews.length, 2); assert.equal(two.data.topics[0].reviews[1].personId, two.data.currentUser.id);
    const changed = await post('reviews', { topicId: id, revision: 1, stance: 'supports', reason: reason + '修改意见。', sourceIds: ['S1'] });
    assert.equal(changed.data.topics[0].reviews.length, 2); assert.equal(changed.data.topics[0].reviews[0].history.length, 1);
    const repeated = await post('search', { topicId: id, query: '仅测试公开问题的原始依据', apiKey: 'TEST-ONLY-SEARCH-KEY', tier: 'lite' });
    assert.equal(repeated.data.evidenceChanged, false); assert.equal(repeated.data.topics[0].revision, 1);
    contentVersion = 2;
    const searched = await post('search', { topicId: id, query: '仅测试公开问题的原始依据', apiKey: 'TEST-ONLY-SEARCH-KEY', tier: 'lite' });
    assert.equal(searched.data.topics[0].revision, 2); assert.equal(searched.data.topics[0].reviews[0].revision, 1);
    assert.equal((await post('reviews', { topicId: id, revision: 1, stance: 'unknown', reason, sourceIds: ['S1'] })).status, 409);
    assert.equal((await post('withdraw', { topicId: id })).data.topics[0].reviews.length, 1);
    assert.equal((await post('report', { topicId: id, reason: '仅测试：需要再次核对来源的适用条件' })).data.topics[0].reportCount, 1);
    assert.equal((await post('report', { topicId: id, reason: '同一参与者不可重复登记同一异议' })).status, 409);
    const beforeDuplicate = calls; assert.equal((await post('topics', { query: '仅测试公开问题的原始依据', category: '生活求证', apiKey: 'TEST-ONLY' })).status, 409); assert.equal(calls, beforeDuplicate);
    empty = true; const noSources = await post('topics', { query: '仅测试没有来源的公开问题', category: '生活求证', apiKey: 'TEST-ONLY' }); assert.equal(noSources.status, 422); assert.equal((await get('alice')).topics.length, 1);
    const store = await readFile(path.join(dataDir, 'community.json'), 'utf8'); assert.ok(!store.includes('TEST-ONLY-SEARCH-KEY')); assert.ok(!store.includes(jars.alice.split('=')[1]));
    const publicData = JSON.stringify(await get('alice')); assert.ok(!publicData.includes('tokenHash')); assert.ok(!publicData.includes('pledgeAt'));
    assert.equal((await fetch(base + '/.youju-data/community.json')).status, 404);
    await close(); server = createApp({ dataDir, fetchImpl }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await get('alice')).currentUser.nickname, '甲方侦探'); assert.equal((await get('bob')).topics.length, 1);
    await post('logout', {}); assert.equal((await get('alice')).currentUser, null);
  } finally { await close(); }
});
