import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFeed, feeds, createHotspotService } from '../lib/hotspots.mjs';
import { cleanTracks, recordCheck } from '../public/hotspots-core.js';
import { normalizeResponse } from '../lib/search.mjs';

const rss = (revision = 0) => `<rss><channel><item><title>测试芯片新进展 ${revision}</title><link>https://example.org/story</link><pubDate>Sun, 25 Oct 2026 04:00:00 GMT</pubDate><description><![CDATA[<p>测试公开消息</p><img src="https://example.org/picture.png" alt="测试配图"><a href="https://www.bilibili.com/video/BVTEST">视频</a><script>attack()</script>]]></description></item><item><title>未标注日期的资料</title><link>https://example.org/undated</link><description>&lt;p&gt;未标注日期&lt;/p&gt;&lt;img src="javascript:attack()"&gt;</description></item><item><title>选举时政消息</title><link>https://example.org/blocked</link></item></channel></rss>`;
test('hotspot RSS parses actual publication dates, images and linked videos without rendering XML or scripts', () => {
  const items = parseFeed(rss(), feeds[0]);
  assert.equal(items.length, 2); assert.equal(items[0].publishedAt, '2026-10-25T04:00:00.000Z');
  assert.equal(items[0].pictures.length, 1); assert.equal(items[0].videos[0].url, 'https://www.bilibili.com/video/BVTEST');
  assert.ok(!items[0].snippet.includes('attack')); assert.equal(items[1].publishedAt, ''); assert.equal(items[1].pictures.length, 0);
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss></rss>', feeds[0]));
  assert.throws(() => parseFeed('{"not":"rss"}', feeds[0]));
});
test('hotspot feed deduplicates concurrent refreshes, caches across restart and retains original timestamps on outage', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'youju-hotspot-cache-'));
  let time = Date.parse('2026-10-25T06:00:00Z'), requests = 0, outage = false, revision = 0;
  const fetchImpl = async () => { requests++; if (outage) throw Error('offline'); return new Response(rss(revision)); };
  const service = createHotspotService({ dataDir, fetchImpl, now: () => time });
  const values = await Promise.all([service.getSnapshot(), service.getSnapshot(), service.getSnapshot()]);
  assert.equal(requests, 2); assert.equal(values[0].sources.filter(s => s.ok).length, 2);
  const originalTime = values[0].refreshedAt; assert.equal(values[0].items[0].publishedAt, '2026-10-25T04:00:00.000Z');
  const restarted = createHotspotService({ dataDir, fetchImpl, now: () => time });
  assert.equal((await restarted.getSnapshot()).cached, true); assert.equal(requests, 2);
  time += 120000; revision++;
  const changed = await service.getSnapshot(); assert.ok(changed.checks[0].changed > 0); assert.equal(changed.items[0].firstSeenAt, originalTime);
  const lastSuccess = changed.refreshedAt; time += 120000; outage = true;
  const failed = await service.getSnapshot(); assert.equal(failed.refreshedAt, lastSuccess); assert.equal(failed.sources.filter(s => s.ok).length, 0);
  assert.ok(failed.items.length > 0); assert.equal(failed.checks[0].successful, 0); assert.equal(failed.checks[0].added, 0);
});
test('tracked topic timeline distinguishes new/changed/no-result/returning evidence and cleans unsafe stored media', () => {
  const track = { id: 'topic', query: '测试话题', sources: [], checks: [], freshness: 'd7' };
  const source = { url: 'https://example.org/story', title: '初始标题', snippet: '旧摘要', publishedAt: '' };
  assert.equal(recordCheck(track, { sources: [source], requestId: 'R1' }, '2026-10-25T06:00:00Z')[0].type, 'new');
  assert.equal(recordCheck(track, { sources: [{ ...source, snippet: '新摘要' }], requestId: 'R2' }, '2026-10-25T06:05:00Z')[0].type, 'updated');
  assert.equal(track.sources[0].snippet, '新摘要');
  assert.equal(recordCheck(track, { sources: [{ ...source, snippet: '新摘要' }], requestId: 'R3' }, '2026-10-25T06:10:00Z').length, 0);
  recordCheck(track, { sources: [], requestId: 'R4' }, '2026-10-25T06:15:00Z'); assert.equal(track.sources.length, 1);
  assert.equal(recordCheck(track, { sources: [{ ...source, snippet: '新摘要' }], requestId: 'R5' }, '2026-10-25T06:20:00Z').length, 0);
  const clean = cleanTracks([{ ...track, auto: 'true', sources: [{ ...source, pictures: [{ url: 'javascript:attack()' }], videos: [{ url: 'data:text/html,bad' }] }] }]);
  assert.equal(clean[0].auto, false); assert.deepEqual(clean[0].sources[0].pictures, []); assert.deepEqual(clean[0].sources[0].videos, []);
  assert.equal(clean[0].checks.length, 5); assert.equal(clean[0].sources[0].publishedAt, '');
  const damaged = cleanTracks([{ ...track, checks: [{ checkedAt: '2026-10-25T06:00:00Z', changes: [null, { ...source, type: 'updated' }] }] }]);
  assert.equal(damaged[0].checks[0].changes[0].type, 'updated');
});
test('video results preserve real video URLs and discard unsafe provider media', () => {
  const result = normalizeResponse({ Response: { Pages: [{ url: 'https://www.bilibili.com/video/BVTEST', title: '测试视频', videos: [{ url: 'javascript:attack()' }, { url: 'https://example.org/movie.mp4', title: '视频原文' }] }] } });
  assert.equal(result.sources[0].videos.length, 2); assert.ok(result.sources[0].videos.every(v => v.url.startsWith('https:')));
});
