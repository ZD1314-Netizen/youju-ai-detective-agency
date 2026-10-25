import test from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_URL, runSearch, searchParams, normalizeResponse, safeUrl, plainText } from '../lib/search.mjs';
import { validateFindings, summarize } from '../lib/ai.mjs';

const fixture = { Response: { Pages: [JSON.stringify({ title: '<b>测试材料</b>', url: 'https://example.org/source?utm_source=test', passage: '摘要 &amp; 条件', content: '更多文字', site: '测试网站', date: '2026-10-25', score: 0.8 })], RequestId: 'mock-request-1', Version: 'test' } };
const respond = data => new Response(JSON.stringify(data), { status: 200 });

test('normalizes official Pages JSON strings and retains request evidence', () => {
  const result = normalizeResponse(fixture);
  assert.equal(result.requestId, 'mock-request-1');
  assert.equal(result.sources[0].title, '测试材料');
  assert.equal(result.sources[0].snippet, '摘要 & 条件');
  assert.equal(result.sources[0].canonical, 'https://example.org/source');
  assert.equal(result.sources[0].publishedAt, '2026-10-25');
  assert.equal(result.sources[0].relevance, 0.8);
});

test('filters unsafe URLs and malformed items; deduplicates tracking URLs', () => {
  const result = normalizeResponse({ Response: { Pages: [
    { url: 'javascript:alert(1)' }, { url: 'https://user:password@example.org/' }, 'not json', null,
    { url: 'https://example.org/source?utm_campaign=1#top', title: 'one' },
    { url: 'https://example.org/source?spm=abc', title: 'duplicate' },
    { url: 'https://example.net/source', title: 'two' }
  ] } });
  assert.equal(result.sources.length, 2);
  assert.equal(result.skipped, 4);
  assert.equal(safeUrl('data:text/html,test'), '');
  assert.equal(plainText('<script>secret()</script><p>材料</p>'), '材料');
});

test('lite parameters omit standard-only fields', () => {
  assert.deepEqual(searchParams({ query: '查询', tier: 'lite', count: 50, industry: 'news', freshness: 'd7', site: 'example.org' }), { Query: '查询', Freshness: 'd7', Site: 'example.org' });
});

test('standard parameters use official casing and support exclusion', () => {
  assert.deepEqual(searchParams({ query: '查询', tier: 'standard', count: 20, industry: 'acad', site: 'exclude:example.org|example.net' }), { Query: '查询', Cnt: 20, Industry: 'acad', Site: 'exclude:example.org|example.net' });
});

test('rejects invalid bounds, domains and search options', () => {
  for (const input of [{ query: '' }, { query: '问'.repeat(501) }, { query: 'q', count: 7 }, { query: 'q', freshness: 'd999' }, { query: 'q', site: 'https://example.org/' }, { query: 'q', industry: 'invalid' }]) assert.throws(() => searchParams(input));
});

test('SearchPro transport uses service key Bearer auth and exact endpoint', async () => {
  let captured;
  const result = await runSearch({ query: '测试查询', apiKey: 'TEST-ONLY-FAKE-SERVICE-KEY', tier: 'lite' }, { fetchImpl: async (url, options) => { captured = { url, options }; return respond(fixture); } });
  assert.equal(captured.url, SEARCH_URL);
  assert.equal(captured.options.headers.Authorization, 'Bearer TEST-ONLY-FAKE-SERVICE-KEY');
  assert.equal(captured.options.redirect, 'error');
  assert.deepEqual(JSON.parse(captured.options.body), { Query: '测试查询' });
  assert.equal(result.provider, '元宝搜索');
  assert.equal(result.calls, 1);
});

test('rejects SecretId locally without sending a request', async () => {
  let calls = 0;
  await assert.rejects(runSearch({ query: 'q', apiKey: 'AKID-TEST-ONLY-NOT-A-REAL-KEY' }, { fetchImpl: async () => { calls++; } }), error => error.code === 'WrongKeyType');
  assert.equal(calls, 0);
});

test('missing service key produces actionable local error', async () => {
  const original = process.env.TENCENTCLOUD_WSA_APIKEY;
  delete process.env.TENCENTCLOUD_WSA_APIKEY;
  try { await assert.rejects(runSearch({ query: 'q' }), error => error.code === 'MissingKey'); }
  finally { if (original !== undefined) process.env.TENCENTCLOUD_WSA_APIKEY = original; }
});

test('preserves upstream error code and request ID without exposing payload', async () => {
  await assert.rejects(runSearch({ query: 'q', apiKey: 'TEST-ONLY' }, { fetchImpl: async () => respond({ Response: { Error: { Code: 'AuthFailure.InvalidCredential', Message: 'upstream details must not echo' }, RequestId: 'failed-42' } }) }), error => error.code === 'AuthFailure.InvalidCredential' && error.requestId === 'failed-42' && !error.message.includes('upstream details'));
});

test('handles empty, malformed, HTTP and network responses', async () => {
  assert.deepEqual(normalizeResponse({ Response: { Pages: [] } }).sources, []);
  assert.throws(() => normalizeResponse({ Response: {} }), error => error.code === 'BadResponse');
  const input = { query: 'q', apiKey: 'TEST-ONLY' };
  await assert.rejects(runSearch(input, { fetchImpl: async () => new Response('<html>Unavailable</html>', { status: 503 }) }), error => error.code === 'BadResponse');
  await assert.rejects(runSearch(input, { fetchImpl: async () => new Response('{}', { status: 401 }) }), error => error.status === 401);
  await assert.rejects(runSearch(input, { fetchImpl: async () => { throw Error('network'); } }), error => error.code === 'NetworkError');
});

test('cancellation remains distinguishable from a failed search', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runSearch({ query: 'q', apiKey: 'TEST-ONLY' }, { signal: controller.signal, fetchImpl: async (_url, options) => { options.signal.throwIfAborted(); } }), error => error.code === 'Cancelled');
});

test('AI rejects invented citations and malformed findings', () => {
  const result = validateFindings({ status: 'supported', findings: [null, { text: 'no citation', sourceIds: ['S99'] }, { text: 'valid', sourceIds: ['S1', 'S1', 'S99'] }] }, [{ id: 'S1' }]);
  assert.deepEqual(result.findings, [{ text: 'valid', sourceIds: ['S1'] }]);
  assert.equal(validateFindings({ status: 'supported', findings: [] }, []).status, 'unknown');
});

test('optional AI uses supplied excerpts and validates cited IDs', async () => {
  let sent;
  const result = await summarize({ query: 'question', sources: [{ id: 'S1', title: 'title', snippet: 'evidence' }], ai: { baseUrl: 'https://example.org/v1', model: 'test-model' } }, { fetchImpl: async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return respond({ choices: [{ message: { content: JSON.stringify({ status: 'mixed', findings: [{ text: '据摘要', sourceIds: ['S1'] }], uncertainties: ['仍需原文'] }) } }] }); } });
  assert.equal(sent.url, 'https://example.org/v1/chat/completions');
  assert.match(sent.body.messages[1].content, /evidence/);
  assert.deepEqual(result.findings[0].sourceIds, ['S1']);
});

test('optional AI failures do not become fabricated findings', async () => {
  const input = { query: 'question', sources: [{ id: 'S1' }], ai: { baseUrl: 'https://example.org/v1', model: 'test' } };
  await assert.rejects(summarize(input, { fetchImpl: async () => respond({ choices: [{ message: { content: '{"findings":[{"text":"invented","sourceIds":["S88"]}]}' } }] }) }), error => error.code === 'AICitationError');
  await assert.rejects(summarize({ ...input, ai: { ...input.ai, baseUrl: 'http://remote.example/v1' } }), /HTTPS/);
});
