import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';

async function withServer(run, fetchImpl) {
  const server = createApp({ fetchImpl: fetchImpl || (async () => new Response(JSON.stringify({ Response: { Pages: [], RequestId: 'mock-empty' } }))) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('serves the real UI with restrictive headers and identifies the app', () => withServer(async base => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /有据/);
  assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.app, 'youju-detective');
  assert.equal(typeof health.searchConfigured, 'boolean');
  assert.match(health.installationId, /^[a-f0-9]{16}$/);
  assert.equal(Object.hasOwn(health, 'apiKey'), false);
}));

test('never serves environment, source, archive or original project files', () => withServer(async base => {
  for (const target of ['/.env', '/server.mjs', '/lib/search.mjs', '/package.json', '/.work/service.json', '/网址.txt', '/%2e%2e/server.mjs']) assert.equal((await fetch(base + target)).status, 404, target);
}));

test('rejects foreign Origin, Host, content type and malformed JSON', () => withServer(async base => {
  const post = (headers, body = '{}') => fetch(base + '/api/search', { method: 'POST', headers, body });
  assert.equal((await post({ Origin: 'https://evil.example', 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post({ Origin: base, 'Content-Type': 'text/plain' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(base, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await post({ Origin: base, 'Content-Type': 'application/json' }, 'not-json')).status, 400);
  assert.equal((await post({ Origin: base, 'Content-Type': 'application/json' }, '[]')).status, 400);
}));

test('search endpoint propagates normalized sources without credentials', () => withServer(async base => {
  const response = await fetch(base + '/api/search', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '测试', apiKey: 'TEST-ONLY-FAKE-KEY', tier: 'lite' }) });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(text).requestId, 'mock-empty');
  assert.ok(!text.includes('TEST-ONLY-FAKE-KEY'));
}));

test('upstream authentication error keeps actionable code and request ID', () => withServer(async base => {
  const response = await fetch(base + '/api/search', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'q', apiKey: 'TEST-ONLY' }) });
  const data = await response.json();
  assert.equal(response.status, 502);
  assert.equal(data.requestId, 'mock-failed');
  assert.equal(data.code, 'AuthFailure.InvalidCredential');
}, async () => new Response(JSON.stringify({ Response: { Error: { Code: 'AuthFailure.InvalidCredential' }, RequestId: 'mock-failed' } }))));
