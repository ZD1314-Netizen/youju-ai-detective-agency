import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeLink, createCase, nextStep, mergeEvidence, statistics, reportMarkdown, cleanImportedCase } from '../public/core.js';

const source = { url: 'https://example.org/evidence', canonical: 'https://example.org/evidence', title: '测试原文', domain: 'example.org', snippet: '测试摘要', site: '测试站点' };

test('deep investigation adapts the third round to previously encountered domains', () => {
  const item = createCase('测试问题', 'deep');
  mergeEvidence(item, { sources: [source, { ...source, url: 'https://example.net/a', canonical: 'https://example.net/a', domain: 'example.net' }] }, 1);
  assert.equal(nextStep(item, 0).query, '测试问题');
  assert.match(nextStep(item, 1).query, /原始资料/);
  assert.equal(nextStep(item, 2).site, 'exclude:example.org|example.net');
  assert.equal(nextStep(item, 2, { site: 'museum.example.org' }).site, 'museum.example.org');
  assert.ok(Buffer.byteLength(nextStep(createCase('查'.repeat(500), 'deep'), 1).query) <= 1500);
});

test('merged evidence keeps round provenance, annotations and richer content', () => {
  const item = createCase('q', 'deep');
  mergeEvidence(item, { sources: [source] }, 1);
  item.sources[0].annotation = 'supports';
  mergeEvidence(item, { sources: [{ ...source, content: 'more content' }, { url: 'javascript:alert(1)' }] }, 2);
  assert.equal(item.sources.length, 1);
  assert.deepEqual(item.sources[0].rounds, [1, 2]);
  assert.equal(item.sources[0].annotation, 'supports');
  assert.equal(item.sources[0].content, 'more content');
  assert.equal(statistics(item).reviewed, 1);
});

test('follow-up words adapt to rules, claims and remembered plots', () => {
  assert.match(nextStep(createCase('故宫开放和闭馆规则', 'deep'), 1).query, /适用日期/);
  assert.match(nextStep(createCase('塑料瓶数字代表重复使用次数是真的吗', 'deep'), 2).query, /研究局限/);
  assert.match(nextStep(createCase('找一部动画电影，只记得剧情', 'deep'), 1).query, /片名/);
  assert.ok(Buffer.byteLength(nextStep(createCase('😀'.repeat(500), 'deep'), 1).query) <= 1500);
});

test('HTML and unsafe links cannot execute as evidence', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///C:/secret', 'https://a:b@example.org/']) assert.equal(safeLink(url), '');
});

test('report contains actual provenance, uncertainty and manual conclusion', () => {
  const item = createCase('测试问题', 'deep');
  mergeEvidence(item, { sources: [source] }, 1);
  item.status = 'cancelled'; item.verdict = 'unknown'; item.notes = '测试人工结论';
  item.steps = [{ title: '第一轮', query: '测试问题', status: 'done', requestId: 'mock-123', count: 1 }];
  const report = reportMarkdown(item);
  for (const text of ['测试人工结论', '暂不能确认', 'https://example.org/evidence', 'mock-123', '已停止，含部分结果', '搜索摘要摘录']) assert.ok(report.includes(text));
});

test('backup import sanitizes content and remains excluded from live queries', () => {
  const item = createCase('q', 'quick');
  item.sources = [{ ...source, id: 'S8' }, null, { url: 'javascript:bad' }];
  item.steps = [null, { status: 'done', requestId: 'test' }];
  item.ai = { findings: [{ text: '保留归纳', sourceIds: ['S8'] }, { text: '假引用', sourceIds: ['S99'] }], uncertainties: ['限制'] };
  const imported = cleanImportedCase(item);
  assert.notEqual(imported.id, item.id);
  assert.equal(imported.imported, true);
  assert.equal(imported.status, 'cancelled');
  assert.equal(imported.sources.length, 1);
  assert.deepEqual(imported.ai.findings, [{ text: '保留归纳', sourceIds: ['S1'] }]);
  assert.equal(cleanImportedCase({ query: 'q' }), null);
});
