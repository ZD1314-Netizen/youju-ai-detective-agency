import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor, compareMonitorResults, nextMonitorTime, cleanMonitors, cleanImportedCase, createCase, reportMarkdown, blockedTopic } from '../public/core.js';
import { extractClaims, validateClaims } from '../lib/ai.mjs';
import { createApp } from '../server.mjs';
import { searchParams } from '../lib/search.mjs';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zYQAAAAASUVORK5CYII=';
const ai = { baseUrl: 'https://vision.example.org/v1', model: 'TEST-VISION', apiKey: 'TEST-ONLY-NOT-A-REAL-KEY' };
const source = (id, snippet = '旧摘要') => ({ url: `https://example.org/${id}`, title: `测试 ${id}`, snippet });

test('screenshot extraction transports an image and does not decide truth or search', async () => {
  let calls = 0;
  const result = await extractClaims({ imageMime: 'image/png', imageBase64: png, ai }, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://vision.example.org/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.messages[1].content[1].image_url.url, `data:image/png;base64,${png}`);
    assert.match(body.messages[0].content, /不.*真伪/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ claims: [{ quote: '仅测试原句', query: '仅测试问题', context: '仅测试时间' }], uncertainties: ['日期模糊'] }) } }] }));
  } });
  assert.equal(calls, 1); assert.equal(result.claims[0].quote, '仅测试原句'); assert.equal(result.uncertainties[0], '日期模糊');
});

test('invalid images are rejected before transport; malformed claims remain unknown', async () => {
  const options = { fetchImpl: () => { throw Error('must not call'); } };
  for (const image of [{ imageMime: 'image/jpeg', imageBase64: png }, { imageMime: 'image/png', imageBase64: 'abcd?' }, { imageMime: 'image/svg+xml', imageBase64: png }, { imageMime: 'image/png', imageBase64: 'A'.repeat(5_400_004) }]) await assert.rejects(extractClaims({ ...image, ai }, options), /截图|图片/);
  assert.deepEqual(validateClaims({ claims: [null, {}, { quote: '仅测试' }] }), { claims: [], uncertainties: [] });
  assert.equal(validateClaims({ claims: Array(12).fill({ quote: '<b>测试</b>', query: '问题' }) }).claims.length, 8);
});

test('monitor compares new and updated sources but ignores ordering, duplicates and missing results', () => {
  const monitor = createMonitor('测试问题', [source('a'), source('b')]);
  assert.equal(compareMonitorResults(monitor, [source('b'), source('a'), source('a')], 'TEST-1').length, 0);
  const changes = compareMonitorResults(monitor, [source('a', '新摘要'), source('c')], 'TEST-2');
  assert.deepEqual(changes.map(c => c.type), ['updated', 'new']);
  assert.equal(changes[0].previousSnippet, '旧摘要');
  const baseline = structuredClone(monitor.baseline);
  assert.equal(compareMonitorResults(monitor, [], 'TEST-3').length, 0);
  assert.deepEqual(monitor.baseline, baseline); assert.equal(monitor.alerts.length, 1);
  for (let i = 0; i < 40; i++) compareMonitorResults(monitor, [source('a', String(i))], 'TEST');
  assert.equal(monitor.alerts.length, 30); assert.equal(monitor.checks.length, 30);
});

test('monitor schedule uses local wall time and validates storage without crashing', () => {
  const before = new Date(2026, 9, 25, 8, 0);
  const next = new Date(nextMonitorTime('09:00', before));
  assert.equal(next.getHours(), 9); assert.equal(next.getDate(), 25);
  assert.equal(new Date(nextMonitorTime('09:00', next)).getDate(), 26);
  assert.throws(() => nextMonitorTime('25:00'));
  assert.deepEqual(cleanMonitors([null, {}, { query: 'bad', status: 'active' }]), []);
  const monitor = createMonitor('test', [source('a')]);
  const cleaned = cleanMonitors([{ ...monitor, checks: null, alerts: [null], baseline: [null], endDate: '' }])[0];
  assert.equal(cleaned.status, 'paused'); assert.deepEqual(cleaned.alerts, []);
});

test('confirmed screenshot origin survives report and archive import', () => {
  const item = createCase('测试问题', 'quick', { type: 'screenshot', quote: '截图原句', screenshotName: '测试.png', context: '模糊日期' });
  item.status = 'complete';
  assert.match(reportMarkdown(item), /截图原句/);
  const imported = cleanImportedCase(item); assert.equal(imported.origin.quote, '截图原句'); assert.equal(imported.imported, true);
  assert.ok(blockedTopic('查询某人的家庭住址')); assert.equal(blockedTopic('故宫闭馆规则'), '');
  assert.throws(() => searchParams({ query: '查询某人的家庭住址', tier: 'lite' }), /不处理/);
});

test('screenshot HTTP route reaches configured model and serves blob preview policy', async () => {
  const server = createApp({ aiFetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ claims: [{ quote: '测试', query: '核查测试' }] }) } }] })) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/api/extract-claims', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ imageMime: 'image/png', imageBase64: png, ai }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).claims[0].query, '核查测试');
    assert.match((await fetch(base)).headers.get('content-security-policy'), /blob:/);
    assert.equal((await fetch(base + '/features.js')).status, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
