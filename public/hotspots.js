import { escapeHtml as e, safeLink, blockedTopic } from './core.js';
import { HOTSPOTS_KEY, cleanTracks, recordCheck } from './hotspots-core.js';
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
const date = (value, short = false) => value && Number.isFinite(typeof value === 'number' ? value : Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', ...(short ? {} : { year: 'numeric', month: '2-digit', day: '2-digit' }), hour: '2-digit', minute: '2-digit', hour12: false }) : String(value || '未提供时间');
let hooks, feed = { items: [], sources: [], checks: [] }, feedLoading = false, feedLoaded = false, feedError = '', lastFeedAttempt = 0;
let query = '', freshness = 'd7', category = '全部', display = 'feed', selected = '', result = null, busy = false, queryError = '', timer;
let tracks = readTracks();
function readTracks() { try { return cleanTracks(JSON.parse(localStorage.getItem(HOTSPOTS_KEY) || '[]')); } catch { return []; } }
function saveTracks() { try { localStorage.setItem(HOTSPOTS_KEY, JSON.stringify(tracks)); return true; } catch { hooks?.toast('热点追踪记录保存失败，请先释放浏览器空间。'); return false; } }
const current = () => tracks.find(track => track.id === selected) || (result?.id === selected ? result : null);
const link = (url, title, cls = '') => safeLink(url) ? `<a class="${cls}" href="${e(safeLink(url))}" target="_blank" rel="noopener noreferrer">${title}${icon('arrow-up-right')}</a>` : '';
const videoSearch = text => link(`https://search.bilibili.com/all?keyword=${encodeURIComponent(text.slice(0, 150))}`, `${icon('play')}去 B站搜相关视频`, 'hot-video-search');
function media(item, large = false) {
  const image = (item.pictures || []).find(p => safeLink(p.url).startsWith('https:'));
  return `<div class="hot-media ${image ? 'has-image' : 'no-image'} ${large ? 'large' : ''}">${image ? `<a href="${e(safeLink(item.url))}" target="_blank" rel="noopener noreferrer"><img src="${e(safeLink(image.url))}" alt="${e(image.caption || item.title)}" loading="lazy" referrerpolicy="no-referrer"></a><span class="hot-image-credit">来源配图 · ${e(item.source || new URL(safeLink(item.url)).hostname)}</span>` : ''}<div class="hot-image-fallback">${icon(item.category === '科学探索' ? 'spark' : 'globe')}<span>${e(item.source || '来源资料')}</span><small>${image ? '源站图片暂时无法加载，请查看原文' : '来源未提供封面'}</small></div></div>`;
}
function videos(item) { return `${(item.videos || []).filter(v => safeLink(v.url).startsWith('https:')).slice(0, 2).map(v => link(v.url, `${icon('play')}${e(v.title || '打开视频来源')}`, 'hot-direct-video')).join('')}${videoSearch(item.title || query)}`; }
function feedCard(item, index) {
  return `<article class="hot-news-card">${media(item)}<div class="hot-news-body"><div class="hot-news-meta"><span>${e(item.category)}</span><time datetime="${e(item.publishedAt)}">${e(date(item.publishedAt || item.dateLabel))}</time></div><h3>${link(item.url, e(item.title))}</h3><p>${e(item.snippet || '来源未提供摘要，请打开原文查看。')}</p><div class="hot-news-source"><span><i>${String(index + 1).padStart(2, '0')}</i>${e(item.source)}</span>${link(item.url, '原文')}</div><div class="hot-news-actions"><button data-hot="query" data-item="${e(item.id)}">${icon('search')}查相关进展 · 1 次搜索</button>${videos(item)}</div></div></article>`;
}
export function hotspotsPreview() {
  return `<section class="hotspot-preview" aria-labelledby="home-hotspots-title"><div class="section-heading"><div><div class="eyebrow">WHAT'S HAPPENING NOW</div><h2 id="home-hotspots-title">此刻，有什么值得追问？ <span class="hot-live-pill"><i></i>热点快讯</span></h2></div><a class="text-button" href="#hotspots">进入热点追踪 ${icon('arrow')}</a></div><div id="hotspot-preview-inner">${previewBody()}</div></section>`;
}
function previewBody() {
  const list = feed.items.slice(0, 3);
  return `<p class="hot-preview-note">科技数码与科学探索 · 按来源发布时间更新${feed.refreshedAt ? ` · 上次获取 ${e(date(feed.refreshedAt, true))}` : ''}</p>${list.length ? `<div class="hot-preview-grid">${list.map(item => `<article><div class="hot-preview-media">${media(item)}</div><div class="hot-preview-copy"><span>${e(item.source)} · ${e(date(item.publishedAt || item.dateLabel))}</span><h3>${link(item.url, e(item.title))}</h3><a class="text-button" href="#hotspots">查看快讯与追踪时间线 ${icon('arrow')}</a></div></article>`).join('')}</div>` : `<a class="hot-preview-empty" href="#hotspots">${icon('globe')} ${feedLoading ? '正在连接实时资讯源…' : feedError ? '资讯源暂时不可用，进入热点追踪重试' : '查看实时快讯、图文与话题时间线'} ${icon('arrow')}</a>`}`;
}
export function hotspotsView() { return `<div id="hotspot-content">${pageBody()}</div>`; }
function pageBody() {
  const active = current(), items = feed.items.filter(item => category === '全部' || item.category === category);
  const successful = feed.sources.filter(source => source.ok).length;
  return `<div class="hot-page-header"><div><div class="eyebrow">FOLLOW THE STORY, KEEP THE TIMELINE</div><h1>热点有变化，<br>沿着时间追下去。</h1><p>看最新图文，查事件进展，把每次新增的依据留在时间线上。</p></div><div class="hot-live-mark"><i></i><span>热点追踪<small>LIVE / 更新以源站为准</small></span></div></div>
  <section class="hot-search-panel"><form id="hotspot-search-form"><label for="hotspot-query">${icon('search')}查询你关心的热点</label><div class="hot-search-row"><input id="hotspot-query" maxlength="500" required value="${e(query)}" placeholder="输入科技、数码或科学话题，追查最新进展…"><select id="hotspot-freshness" aria-label="热点查询时间范围">${[['d1', '近 24 小时'], ['d7', '近 7 天'], ['m1', '近 1 个月']].map(([v, t]) => `<option value="${v}" ${v === freshness ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="primary-button" type="submit" ${busy ? 'disabled' : ''}>${busy ? '查询中…' : '查询进展'}${icon('arrow')}</button></div><p>每次查询调用 1 次元宝搜索；“关注话题”可保留后续查询时间线。时间均为北京时间。</p></form>${queryError ? `<p class="error-message" role="alert">${e(queryError)}</p>` : ''}</section>
  <div class="hot-main-tabs"><div role="group" aria-label="热点视图"><button data-hot="view" data-view="feed" class="${display === 'feed' ? 'active' : ''}">热点快讯 <span>${feed.items.length}</span></button><button data-hot="view" data-view="tracks" class="${display === 'tracks' ? 'active' : ''}">我的追踪 <span>${tracks.length}</span></button></div><span>${busy ? '<i class="spinner"></i> 正在查找新来源' : '图文 · 视频入口 · 时间线'}</span></div>
  ${active ? trackPanel(active) : ''}
  ${display === 'tracks' ? `<section class="hot-track-list"><div class="section-heading"><h2>持续关注的话题</h2><span>${tracks.filter(track => track.auto).length} 项自动检查中</span></div>${tracks.length ? tracks.map(track => `<button class="hot-track-item ${selected === track.id ? 'selected' : ''}" data-hot="select" data-track="${e(track.id)}"><span>${icon('clock')}</span><div><h3>${e(track.query)}</h3><p>最近检查 ${e(date(track.lastCheckedAt))} · ${track.checks.length} 次记录 · ${track.auto ? '每 5 分钟检查' : '手动更新'}</p></div>${icon('arrow')}</button>`).join('') : `<div class="empty-state">${icon('bookmark')}<h3>把值得关注的热点留下来</h3><p>查询一个话题后，点击“关注话题”，保留今后的来源变化和查询节点。</p></div>`}</section>` : `<div class="hot-feed-heading"><div class="hot-category-tabs">${['全部', '科技数码', '科学探索'].map(label => `<button data-hot="category" data-category="${label}" aria-pressed="${category === label}" class="${category === label ? 'active' : ''}">${label}</button>`).join('')}</div><button class="secondary-button" data-hot="refresh-feed" ${feedLoading ? 'disabled' : ''}>${icon('clock')}${feedLoading ? '更新中…' : '刷新快讯'}</button></div>
  <div class="hot-feed-state"><span><i class="status-dot"></i>${feed.refreshedAt ? `上次成功获取 ${e(date(feed.refreshedAt))}` : '正在等待实时资讯'}${feedLoading ? ' · 获取中' : ''}</span><span>来源可用 ${successful}/${feed.sources.length || 2} · 每 2 分钟检查</span></div>${feed.sources.some(source => !source.ok) ? `<p class="hot-offline-note">${feed.sources.filter(source => !source.ok).map(source => `${e(source.name)}：${e(source.error)}`).join('；')}。已有条目保留原时间，不代表最新状态。</p>` : ''}${feedError ? `<p class="hot-offline-note">${e(feedError)}</p>` : ''}
  ${items.length ? `<div class="hot-feed-grid">${items.map(feedCard).join('')}</div>` : `<div class="empty-state">${feedLoading ? '<span class="spinner"></span>' : icon('globe')}<h3>${feedLoading ? '正在连接实时资讯源' : '暂时没有可展示的快讯'}</h3><p>可以稍后刷新，或在上方用元宝搜索查询你关心的话题。</p></div>`}
  <section class="hot-fetch-history"><details><summary>资讯更新记录 · 最近 ${feed.checks.length} 次</summary>${feed.checks.slice(0, 10).map(check => `<div><time>${e(date(check.checkedAt))}</time><span>${check.successful || 0} 个来源成功 · ${check.count || 0} 条快讯 · 新增 ${check.added || 0} / 更新 ${check.changed || 0}</span></div>`).join('') || '<p>首次获取成功后，将保留每次检查的时间节点。</p>'}</details></section>`}
  <div class="hot-bottom-note"><strong>每一条动态，都能回到来源。</strong><p>快讯来自 ${feed.sources.length ? feed.sources.map(source => link(source.homepage, e(source.name))).join('、') : 'IT之家、NASA'} 的公开订阅，不是全网热度排行。发布时间由源站提供，获取时间记录本工具实际检查节点；信息变化不等于已证实事实。页面打开且可见时才自动更新，休眠可能延迟。</p></div>`;
}
function trackPanel(track) {
  const saved = tracks.some(t => t.id === track.id);
  return `<section class="hot-investigation"><div class="hot-track-heading"><div><span class="eyebrow">${saved ? 'FOLLOWING THIS STORY' : 'SEARCH RESULTS / 本次查询'}</span><h2>${e(track.query)}</h2><p>${track.sources.length} 条保留来源 · 上次检查 ${e(date(track.lastCheckedAt))}</p></div><button class="icon-button" data-hot="close-result" aria-label="收起话题结果">${icon('close')}</button></div><div class="hot-track-toolbar">${saved ? `<button class="secondary-button" data-hot="refresh-track" data-track="${e(track.id)}" ${busy ? 'disabled' : ''}>${icon('search')}立即检查 · 1 次搜索</button><button class="secondary-button ${track.auto ? 'enabled' : ''}" data-hot="toggle-auto" data-track="${e(track.id)}" aria-pressed="${track.auto}">${icon('clock')}${track.auto ? '暂停自动检查' : '开启每 5 分钟检查'}</button>` : `<button class="primary-button" data-hot="follow">${icon('bookmark')}关注话题</button>`}<button class="text-button" data-hot="investigate">三轮深入调查 ${icon('arrow')}</button>${videoSearch(track.query)}</div>${track.auto ? `<p class="hot-auto-note">自动检查中 · 下次计划 ${e(date(track.nextRunAt))}；页面保持打开且可见时，每 5 分钟额外使用 1 次搜索，离开热点页即暂停执行。</p>` : ''}${track.lastError ? `<p class="error-message">${e(track.lastError)}</p>` : ''}<div class="hot-results-layout"><div class="hot-related-sources"><div class="section-heading"><h3>检索来源与图文</h3><span>先核对原文，再作判断</span></div>${track.sources.slice(0, 10).map(source => `<article class="hot-related-source">${source.pictures.length ? media(source) : ''}<div><span class="hot-source-domain">${e(new URL(source.url).hostname)}</span><h3>${link(source.url, e(source.title))}</h3><p>${e(source.snippet || '来源未提供摘要。')}</p><small>来源标注发布时间：${e(date(source.publishedAt))}</small><div class="hot-related-links">${link(source.url, '打开原文')}${videos(source)}</div></div></article>`).join('') || '<p class="hot-empty-text">本次没有检索到来源。可以扩大时间范围后再查；这不代表事件没有进展。</p>'}</div><aside class="hot-timeline"><h3>${icon('clock')}追踪时间线</h3><p>按实际查询节点记录，非事件发生时间</p>${track.checks.length ? track.checks.slice(0, 15).map(check => `<article class="hot-time-node"><time>${e(date(check.checkedAt))}</time><h4>${check.error ? '查询未完成' : check.changes.length ? `发现 ${check.changes.length} 条新增 / 更新` : '未发现来源变化'}</h4><small>${check.error ? e(check.error) : `${check.results} 条本次结果`}</small>${check.changes.slice(0, 3).map(change => `<a href="${e(safeLink(change.url))}" target="_blank" rel="noopener noreferrer"><b>${change.type === 'updated' ? '更新' : '新增'}</b>${e(change.title)}</a>`).join('')}${check.changes.length > 3 ? `<small>另 ${check.changes.length - 3} 条变化，可在来源列表核对</small>` : ''}<details><summary>本次检索编号</summary><code>${e(check.requestId || '未返回请求编号')}</code></details></article>`).join('') : '<p>查询后会出现第一个时间节点。</p>'}${saved ? `<button class="text-button" data-hot="unfollow" data-track="${e(track.id)}">取消关注（保留当前查询结果）</button>` : ''}</aside></div><details class="hot-publication-timeline"><summary>按来源发布时间查看线索（${track.sources.filter(source => source.publishedAt).length} 条带时间）</summary>${track.sources.filter(source => source.publishedAt).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).slice(0, 25).map(source => `<div><time>${e(date(source.publishedAt))}</time>${link(source.url, e(source.title))}</div>`).join('') || '<p>来源未提供可用发布时间；请打开原文核对，不能用抓取时间替代。</p>'}</details></section>`;
}
function paint() {
  const focus = document.activeElement?.id === 'hotspot-query', position = focus ? document.activeElement.selectionStart : 0;
  const node = document.querySelector('#hotspot-content'); if (node) node.innerHTML = pageBody();
  const preview = document.querySelector('#hotspot-preview-inner'); if (preview) preview.innerHTML = previewBody();
  if (focus) { const input = document.querySelector('#hotspot-query'); input?.focus({ preventScroll: true }); input?.setSelectionRange(position, position); }
}
async function loadFeed() {
  if (feedLoading) return;
  feedLoading = true; lastFeedAttempt = Date.now(); paint();
  try { const response = await fetch('/api/hotspots'); const value = await response.json(); if (!response.ok || !Array.isArray(value.items)) throw Error('实时资讯源暂时无法连接，请稍后刷新。'); feed = value; feedLoaded = true; feedError = ''; }
  catch (error) { feedError = error.message || '实时资讯获取失败，已保留上次记录。'; }
  finally { feedLoading = false; paint(); }
}
async function searchTopic(track = null, automatic = false) {
  if (!hooks || busy || hooks.state().busy || hooks.state().monitorBusy || hooks.state().batchBusy) { if (!automatic) hooks?.toast('请等待当前查询完成。'); return; }
  if (!hooks.hasSearch()) { if (!automatic) { hooks.toast('请先连接元宝搜索，保存后再点击“查询进展”。'); hooks.openSettings(); } return; }
  const question = (track?.query || query).trim();
  if (!question || blockedTopic(question)) { if (!automatic) { queryError = question ? '请查询公开的科技、数码或科学话题。' : '先填写一个想追踪的话题。'; paint(); } return; }
  const execute = async () => {
    if (track && tracks.some(t => t.id === track.id)) {
      tracks = readTracks(); track = tracks.find(t => t.id === track.id);
      if (!track || automatic && (!track.auto || track.nextRunAt > Date.now())) return;
    }
    busy = true; queryError = '';
    if (!track) track = { id: crypto.randomUUID(), query: question, freshness, sources: [], checks: [], auto: false, nextRunAt: 0 };
    if (!automatic) { selected = track.id; result = track; }
    track.nextRunAt = Date.now() + 5 * 60000;
    if (tracks.some(t => t.id === track.id)) saveTracks(); paint();
    const persistResult = (forcePause = false) => {
      const latest = readTracks(), stored = latest.find(item => item.id === track.id);
      if (!stored) { tracks = latest; return; }
      // A pause or removal in another tab must not be undone by a late response.
      track.auto = forcePause ? false : stored.auto;
      track.nextRunAt = Math.max(track.nextRunAt, stored.nextRunAt);
      tracks = latest.map(item => item.id === track.id ? track : item); saveTracks();
    };
    try {
      const state = hooks.state();
      const response = await hooks.api('/api/search', { query: question, freshness: track.freshness, tier: state.settings.tier, count: 20, apiKey: state.keys.search });
      const changes = recordCheck(track, response);
      persistResult();
      if (!automatic) hooks.toast(`检索完成：${response.sources.length} 条来源，${changes.length} 条新增或变化。`);
    } catch (error) {
      track.lastError = error.message; track.checks.unshift({ checkedAt: new Date().toISOString(), requestId: error.requestId || '', results: 0, changes: [], error: error.message }); track.checks = track.checks.slice(0, 40);
      const forcePause = /Auth|Key|Quota|Limit|Unauthorized/i.test(error.code || '');
      if (forcePause) track.auto = false;
      persistResult(forcePause); queryError = error.message;
    } finally { busy = false; paint(); }
  };
  if (navigator.locks) await navigator.locks.request('youju-hotspot-query', { ifAvailable: true }, async lock => { if (lock) await execute(); else if (!automatic) hooks.toast('另一个页面正在查询热点，请稍后再试。'); });
  else if (!automatic) await execute();
}
export function afterHotspotRender() { if (hooks && ['home', 'hotspots'].includes(hooks.state().view) && !feedLoading && (!feedLoaded && !lastFeedAttempt || Date.now() - lastFeedAttempt > 120000)) queueMicrotask(loadFeed); }
export function initHotspots(options) {
  hooks = options; afterHotspotRender();
  document.addEventListener('input', event => { if (event.target.id === 'hotspot-query') query = event.target.value; });
  document.addEventListener('change', event => { if (event.target.id === 'hotspot-freshness') freshness = event.target.value; });
  document.addEventListener('submit', event => { if (event.target.id === 'hotspot-search-form') { event.preventDefault(); query = document.querySelector('#hotspot-query').value; searchTopic(tracks.find(t => t.query === query.trim() && t.freshness === freshness) || null); } });
  document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement && event.target.closest('.hot-media')) event.target.closest('.hot-media').classList.add('image-failed'); }, true);
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-hot]'); if (!button) return;
    const action = button.dataset.hot, track = tracks.find(t => t.id === button.dataset.track);
    if (action === 'refresh-feed') loadFeed();
    if (action === 'view') { display = button.dataset.view; paint(); }
    if (action === 'category') { category = button.dataset.category; paint(); }
    if (action === 'query') { const item = feed.items.find(item => item.id === button.dataset.item); if (item) { query = item.title; await searchTopic(); document.querySelector('.hot-investigation')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }
    if (action === 'close-result') { selected = ''; paint(); }
    if (action === 'select' && track) { selected = track.id; query = track.query; freshness = track.freshness; paint(); document.querySelector('.hot-investigation')?.scrollIntoView({ block: 'start' }); }
    if (action === 'follow' && result) { tracks = readTracks(); if (tracks.length >= 5) { hooks.toast('最多关注 5 个热点，请先取消不再需要的关注。'); return; } if (!tracks.some(t => t.id === result.id)) tracks.unshift(result); saveTracks(); paint(); hooks.toast('已关注话题。时间线已保存，可按需开启自动检查。'); }
    if (action === 'refresh-track' && track) await searchTopic(track);
    if (action === 'toggle-auto' && track) { if (!track.auto && !navigator.locks) { hooks.toast('请使用新版 Edge 或 Chrome 开启自动追踪。'); return; } if (!track.auto && !hooks.hasSearch()) { hooks.openSettings(); return; } track.auto = !track.auto; track.nextRunAt = Date.now() + 5 * 60000; saveTracks(); paint(); }
    if (action === 'unfollow' && track) { result = structuredClone(track); result.auto = false; tracks = tracks.filter(t => t.id !== track.id); saveTracks(); paint(); }
    if (action === 'investigate' && current()) hooks.investigate(current().query);
  });
  const tick = () => {
    clearTimeout(timer); timer = setTimeout(tick, 15000);
    if (document.hidden || !['home', 'hotspots'].includes(hooks.state().view)) return;
    if (Date.now() - lastFeedAttempt >= 120000) loadFeed();
    if (hooks.state().view === 'hotspots' && !busy) { tracks = readTracks(); const due = tracks.find(t => t.auto && t.nextRunAt <= Date.now()); if (due) searchTopic(due, true); }
  };
  timer = setTimeout(tick, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('storage', event => { if (event.key === HOTSPOTS_KEY && !busy) { tracks = readTracks(); paint(); } });
}
