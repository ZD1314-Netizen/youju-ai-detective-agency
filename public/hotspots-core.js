import { safeLink } from './core.js';
export const HOTSPOTS_KEY = 'youju.hotspot-tracks.v1';
export function sourceSnapshot(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 50).flatMap(source => {
    const url = safeLink(source?.url); if (!url) return [];
    return [{ url, title: String(source.title || '').slice(0, 500), snippet: String(source.snippet || '').slice(0, 2200), publishedAt: String(source.publishedAt || '').slice(0, 100), pictures: (Array.isArray(source.pictures) ? source.pictures : []).slice(0, 3).filter(p => safeLink(p?.url).startsWith('https:')).map(p => ({ url: safeLink(p.url), caption: String(p.caption || '').slice(0, 200) })), videos: (Array.isArray(source.videos) ? source.videos : []).slice(0, 3).filter(v => safeLink(v?.url).startsWith('https:')).map(v => ({ url: safeLink(v.url), title: String(v.title || '来源视频').slice(0, 200) })) }];
  });
}
export function cleanTracks(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 5).flatMap(track => {
    if (typeof track?.id !== 'string' || typeof track.query !== 'string') return [];
    return [{ ...track, id: track.id.slice(0, 80), query: track.query.slice(0, 500), auto: track.auto === true, freshness: ['d1', 'd7', 'm1'].includes(track.freshness) ? track.freshness : 'd7', sources: sourceSnapshot(track.sources), checks: (Array.isArray(track.checks) ? track.checks : []).slice(0, 40).filter(c => c && Number.isFinite(Date.parse(c.checkedAt))).map(c => ({ checkedAt: c.checkedAt, requestId: String(c.requestId || '').slice(0, 200), error: String(c.error || '').slice(0, 300), results: Number(c.results) || 0, changes: sourceSnapshot(c.changes).map(s => ({ ...s, type: c.changes.find(change => change?.url === s.url)?.type === 'updated' ? 'updated' : 'new' })) })), nextRunAt: Number(track.nextRunAt) || 0 }];
  });
}
export function recordCheck(track, result, checkedAt = new Date().toISOString()) {
  const previous = new Map(track.sources.map(source => [source.url, source]));
  const sources = sourceSnapshot(result.sources);
  const changes = sources.flatMap(source => {
    const old = previous.get(source.url);
    return !old ? [{ ...source, type: 'new' }] : old.title !== source.title || old.snippet !== source.snippet ? [{ ...source, type: 'updated' }] : [];
  });
  track.checks.unshift({ checkedAt, requestId: String(result.requestId || ''), results: sources.length, changes }); track.checks = track.checks.slice(0, 40);
  // Empty searches do not erase prior evidence or turn returning items into fake discoveries.
  if (sources.length) track.sources = [...new Map([...track.sources, ...sources].map(source => [source.url, source])).values()].slice(-50);
  track.lastCheckedAt = checkedAt; track.nextRunAt = Date.parse(checkedAt) + 5 * 60000; track.lastError = '';
  return changes;
}
