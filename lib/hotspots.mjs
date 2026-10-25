import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { plainText, safeUrl } from './search.mjs';
import { blockedTopic } from '../public/core.js';

export const feeds = [
  { id: 'ithome', name: 'IT之家', category: '科技数码', url: 'https://www.ithome.com/rss/', homepage: 'https://www.ithome.com/' },
  { id: 'nasa', name: 'NASA', category: '科学探索', url: 'https://www.nasa.gov/feed/', homepage: 'https://www.nasa.gov/' }
];
const videoHost = /(^|\.)(bilibili\.com|b23\.tv|youtube\.com|youtu\.be|v\.qq\.com|douyin\.com|ixigua\.com)$/i;
export function decodeXml(value = '') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => { const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
const tag = (xml, name) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim();
const attr = (html, name) => decodeXml(html.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '');
const publicUrl = (value, base) => {
  if (!value) return '';
  try { const url = new URL(value, base); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};
export function parseFeed(xml, feed) {
  if (typeof xml !== 'string' || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<rss\b|<feed\b/i.test(xml)) throw Error('资讯源未返回有效订阅内容');
  const items = [], seen = new Set();
  for (const match of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const raw = match[2], html = tag(raw, 'content:encoded') || tag(raw, 'description') || tag(raw, 'summary');
    const url = publicUrl(tag(raw, 'link') || attr(raw.match(/<link\b[^>]*>/i)?.[0] || '', 'href'), feed.homepage);
    const title = plainText(tag(raw, 'title'), 350);
    if (!url || !title || blockedTopic(title) || seen.has(url)) continue;
    if (/(选举|政党|竞选|政要|总统|首相|军事|战争|私生活|绯闻)/i.test(title)) continue;
    seen.add(url);
    const rawDate = tag(raw, 'pubDate') || tag(raw, 'published') || tag(raw, 'updated');
    const publishedAt = rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : '';
    const pictures = [], videos = [];
    const addPicture = (value, caption = '') => { const image = publicUrl(value, url); if (image && !pictures.some(p => p.url === image) && pictures.length < 3) pictures.push({ url: image, caption: plainText(caption, 150) || '来源配图 · 请回到原文查看图注' }); };
    for (const image of html.matchAll(/<img\b[^>]*>/gi)) addPicture(attr(image[0], 'src') || attr(image[0], 'data-src'), attr(image[0], 'alt'));
    for (const media of raw.matchAll(/<(?:media:thumbnail|media:content|enclosure)\b[^>]*>/gi)) {
      const mediaUrl = publicUrl(attr(media[0], 'url'), url);
      if (/image|thumbnail/i.test(media[0]) || /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(mediaUrl)) addPicture(mediaUrl);
      if (mediaUrl && /video|\.mp4(?:\?|$)/i.test(media[0])) videos.push({ url: mediaUrl, title: '来源视频' });
    }
    for (const anchor of html.matchAll(/<a\b[^>]*>/gi)) {
      const link = publicUrl(attr(anchor[0], 'href'), url);
      if (link && videoHost.test(new URL(link).hostname) && !videos.some(v => v.url === link)) videos.push({ url: link, title: '原文中的视频链接' });
    }
    if (videoHost.test(new URL(url).hostname)) videos.unshift({ url, title: '打开视频来源' });
    items.push({ id: createHash('sha256').update(url).digest('hex').slice(0, 20), url, title, snippet: plainText(html, 220), source: feed.name, feedId: feed.id, category: feed.category, publishedAt, dateLabel: plainText(rawDate, 100), pictures, videos: videos.slice(0, 3) });
    if (items.length >= 35) break;
  }
  return items;
}

export function createHotspotService({ dataDir, fetchImpl = fetch, now = () => Date.now() }) {
  const file = path.join(dataDir, 'hotspots.json');
  let snapshot = { items: [], checks: [], sources: [], refreshedAt: '', checkedAt: '' }, loaded = false, loading, inflight;
  const stamp = () => new Date(now()).toISOString();
  async function load() {
    if (loaded) return;
    loading ||= (async () => {
      try { const old = JSON.parse(await readFile(file, 'utf8')); if (old.version === 1 && Array.isArray(old.items) && Array.isArray(old.checks)) snapshot = { ...snapshot, ...old }; } catch { /* A fresh feed remains available if its disposable cache cannot be read. */ }
      loaded = true;
    })();
    await loading;
  }
  async function update() {
    const checkedAt = stamp(), old = new Map(snapshot.items.map(item => [item.url, item]));
    const results = await Promise.all(feeds.map(async feed => {
      try {
        const response = await fetchImpl(feed.url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Youju/4.2 (local RSS reader)' }, signal: AbortSignal.timeout(12000), redirect: 'error' });
        if (!response.ok) throw Error(`源站 HTTP ${response.status}`);
        const items = parseFeed(await response.text(), feed);
        if (!items.length) throw Error('资讯源当前未提供可展示条目');
        return { feed, items, ok: true };
      } catch (error) { return { feed, items: snapshot.items.filter(item => item.feedId === feed.id), ok: false, error: error.name === 'TimeoutError' ? '连接超时' : '资讯源暂时不可用' }; }
    }));
    let added = 0, changed = 0;
    const items = results.flatMap(result => result.items.map(item => {
      const previous = old.get(item.url);
      if (result.ok && !previous) added++;
      if (result.ok && previous && (previous.title !== item.title || previous.snippet !== item.snippet)) changed++;
      return { ...item, firstSeenAt: previous?.firstSeenAt || checkedAt, lastSeenAt: result.ok ? checkedAt : previous?.lastSeenAt || '', updatedAt: !previous || previous.title !== item.title || previous.snippet !== item.snippet ? checkedAt : previous.updatedAt || previous.firstSeenAt };
    })).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).slice(0, 60);
    const sources = results.map(({ feed, ok, error }) => ({ ...feed, ok, error: error || '', lastSuccessAt: ok ? checkedAt : snapshot.sources.find(s => s.id === feed.id)?.lastSuccessAt || '' }));
    snapshot = { version: 1, items, sources, checkedAt, refreshedAt: results.some(r => r.ok) ? checkedAt : snapshot.refreshedAt, checks: [{ id: randomUUID(), checkedAt, added, changed, count: items.length, successful: results.filter(r => r.ok).length }, ...snapshot.checks].slice(0, 48) };
    try { await mkdir(dataDir, { recursive: true }); const temp = file + '.' + randomUUID() + '.tmp'; await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 }); await rename(temp, file); } catch { /* The live response still works when this noncritical cache cannot be saved. */ }
    return snapshot;
  }
  async function getSnapshot() {
    await load();
    if (snapshot.checkedAt && now() - Date.parse(snapshot.checkedAt) < 90000) return { ...snapshot, cached: true };
    if (!inflight) inflight = update().finally(() => { inflight = null; });
    return { ...await inflight, cached: false };
  }
  return { getSnapshot };
}
