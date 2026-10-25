import { screenshotView, monitorsPage, comparisonView } from './features.js';
import { evidenceBoard, initWalkthrough } from './walkthrough.js';
import { initHotspots, hotspotsView, hotspotsPreview, afterHotspotRender } from './hotspots.js';
import { initCommunity, discoveryView, communityView, publicTopicView, resourcesView, sourceMedia, authView, accountView, certificationView, adminView, accountEntry, adminNavigation } from './community.js';
import { escapeHtml as e, safeLink, createCase, nextStep, mergeEvidence, statistics, reportMarkdown, cleanImportedCase, verdictNames, annotationNames, blockedTopic, createMonitor, compareMonitorResults, nextMonitorTime, cleanMonitors, localDay, searchOptions } from './core.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
const app = $('#app');
const dialog = $('#settings-dialog');
const CASES_KEY = 'youju.cases.v1';
const SETTINGS_KEY = 'youju.settings.v1';
const KEYS_KEY = 'youju.keys.v1';
const CHECKS_KEY = 'youju.contest.v1';
const MONITORS_KEY = 'youju.monitors.v1';
const defaults = { tier: 'lite', freshness: '', industry: '', site: '', count: 10, rememberKeys: false, enableAi: false, aiBaseUrl: '', aiModel: '' };
let storageIssue = false;
function load(store, key, fallback) {
  try { const value = store.getItem(key); return value ? JSON.parse(value) : fallback; } catch { storageIssue = true; return fallback; }
}
const savedSettings = load(localStorage, SETTINGS_KEY, {});
const savedCases = load(localStorage, CASES_KEY, []);
const savedKeys = load(savedSettings?.rememberKeys ? localStorage : sessionStorage, KEYS_KEY, {});
const savedChecks = load(localStorage, CHECKS_KEY, {});
const savedMonitors = load(localStorage, MONITORS_KEY, []);
const state = {
  settings: { ...defaults, ...(savedSettings && typeof savedSettings === 'object' && !Array.isArray(savedSettings) ? savedSettings : {}) },
  cases: Array.isArray(savedCases) ? savedCases.filter(c => c && typeof c.query === 'string' && Array.isArray(c.sources) && Array.isArray(c.steps)).slice(0, 50) : [],
  keys: savedKeys && typeof savedKeys === 'object' ? { search: String(savedKeys.search || ''), ai: String(savedKeys.ai || '') } : { search: '', ai: '' },
  checks: savedChecks && typeof savedChecks === 'object' ? savedChecks : {},
  monitors: cleanMonitors(savedMonitors),
  view: 'home', currentId: '', draft: '', mode: 'deep', filters: false,
  tab: 'evidence', sourceFilter: 'all', busy: false, controller: null, liveText: '',
  health: null, menu: false, historyFilter: '', pendingStart: false, toastTimer: null,
  screenshot: null, claims: [], extracting: false, pendingFile: null, extractController: null, creatingMonitorFor: '', monitorBusy: false, monitorTimer: null, batchBusy: false, batchCancelled: false
};
// An interrupted browser session cannot still be running an investigation.
for (const item of state.cases) {
  if (item.status === 'running') {
    item.status = 'cancelled';
    item.steps.forEach(s => { if (s.status === 'running') { s.status = 'cancelled'; s.error = '上次页面关闭时中断。'; } });
  }
}

const current = () => state.cases.find(c => c.id === state.currentId);
const hasSearch = () => Boolean((state.keys.search && !/^(AKID|IKID)/i.test(state.keys.search)) || state.health?.searchConfigured);
const dateText = date => {
  try { return new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; }
};
function toast(message, duration = 3800) {
  const box = $('#toast'); box.textContent = message; box.hidden = false;
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { box.hidden = true; }, duration);
}
function persist() {
  try {
    state.cases = state.cases.slice(0, 50);
    localStorage.setItem(CASES_KEY, JSON.stringify(state.cases));
    return true;
  } catch { toast('浏览器存储空间不足，请先导出档案；本页结果仍可查看。', 7000); return false; }
}
function route() {
  const value = location.hash.slice(1);
  if (value.startsWith('case/')) { state.currentId = value.slice(5); state.view = current() ? 'case' : 'history'; }
  else if (value.startsWith('topic/')) state.view = 'public-topic';
  else state.view = ['home', 'hotspots', 'history', 'bookmarks', 'monitors', 'contest', 'community', 'resources', 'login', 'register', 'recover', 'demo-users', 'account', 'certification', 'admin'].includes(value) ? value : 'home';
  state.menu = false; render();
}
function navigate(target) {
  if (location.hash === `#${target}`) route(); else location.hash = target;
}
function newCase() {
  state.draft = ''; state.tab = 'evidence'; state.sourceFilter = 'all'; navigate('home');
  setTimeout(() => $('#question')?.focus(), 0);
}
function prepareHotspotInvestigation(query) {
  state.draft = query; state.mode = 'deep';
  const focus = () => requestAnimationFrame(() => { $('#search-form')?.scrollIntoView({ block: 'center' }); $('#question')?.focus({ preventScroll: true }); });
  if (location.hash === '#home') { render(); focus(); }
  else { window.addEventListener('hashchange', focus, { once: true }); navigate('home'); }
}

function shell(content) {
  const names = { home: '调查工作台', hotspots: '热点追踪', history: '我的调查', bookmarks: '证据收藏', monitors: '持续盯梢', contest: '参赛准备', case: '调查档案', community: '查证广场', resources: '公开资料入口', 'public-topic': '公众查证议题', login: '登录', register: '注册账户', recover: '找回账户', 'demo-users': '案例用户', account: '个人中心', certification: '社区认证', admin: '社区管理' };
  const savedCount = state.cases.reduce((n, c) => n + c.sources.filter(s => s.favorite).length, 0);
  return `<div class="app-shell">
    <button class="mobile-backdrop ${state.menu ? 'visible' : ''}" data-action="menu-close" aria-label="关闭导航"></button>
    <aside class="sidebar ${state.menu ? 'open' : ''}" aria-label="主导航">
      <a class="brand" href="#home" aria-label="有据首页"><div class="brand-mark">${icon('search')}</div><div><div class="brand-name">有据</div><div class="brand-small">AI DETECTIVE CLUB</div></div></a>
      <button class="new-case" data-action="new">${icon('plus')} 发起新调查</button>
      <div class="side-label">调查室 / INVESTIGATE</div>
      <nav class="nav-list">${[
        ['home', 'search', '调查工作台', ''], ['hotspots', 'spark', '热点追踪', 'LIVE'], ['history', 'folder', '我的调查', state.cases.length || ''], ['bookmarks', 'bookmark', '证据收藏', savedCount || ''], ['monitors', 'clock', '持续盯梢', state.monitors.filter(m => m.status === 'active').length || ''],
        ['community', 'link', '查证广场', ''], ['resources', 'globe', '公开资料入口', ''], ['certification', 'check-circle', '社区认证', ''], ['account', 'folder', '个人中心', ''], ['contest', 'flag', '参赛准备', '']
      ].map(([view, name, label, count], index) => `${index === 5 ? '<div class="side-label nav-group-label">共同查证 / COMMUNITY</div>' : index === 8 ? '<div class="nav-separator"></div>' : ''}<a class="nav-item ${state.view === view || view === 'history' && state.view === 'case' ? 'active' : ''}" href="#${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(name)}<span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</a>`).join('')}${adminNavigation()}</nav>
      <div class="side-note"><div class="field-note"><span class="note-index">THE DETECTIVE'S RULE</span><p>好的判断，<br>经得起追问。</p><span>从哪里来？还有什么例外？</span></div>
      <div class="side-bottom"><span><i class="status-dot"></i>本地工作台</span><button data-action="settings">${icon('settings')}设置</button></div></div>
    </aside>
    <div class="main-wrap"><header class="topbar"><div class="breadcrumbs"><button class="menu-button" data-action="menu" aria-label="打开导航" aria-expanded="${state.menu}">${icon('menu')}</button><span>有据侦探社</span>${icon('chevron')}<strong>${names[state.view]}</strong></div>
      <div class="topbar-right">${accountEntry()}<span class="edition">1024 · WAYTOAGI</span><button class="connect-btn ${hasSearch() ? 'connected' : ''}" data-action="settings"><span class="connect-dot"></span>${hasSearch() ? '搜索已配置' : '连接元宝搜索'}${icon('chevron')}</button></div></header>
    <main id="main" class="workspace ${state.view === 'home' ? 'home-workspace' : ''}">${content}<footer class="workspace-footer"><strong>有据 YOUJU / AI DETECTIVE CLUB</strong><span>${icon('globe')}元宝搜索驱动 · 每一个判断，有据可循</span></footer></main></div></div>`;
}

function homeView() {
  return `<div class="desk-heading"><span><i class="status-dot"></i>有据 · 你的公开信息调查室</span><span>SEARCH. VERIFY. TRACE.</span></div>
    <section class="hero"><div class="hero-editorial"><div class="eyebrow">别让「听说」成为结论</div><h1>先别急着相信。<br>让<span>证据先开口。</span><i class="headline-period"></i></h1><p class="hero-copy">把一个疑问，查成一份有出处的答案。<br>元宝搜索追线索，你来判断，证据留在档案里。</p><div class="hero-bottom"><button class="demo-trigger" data-demo="open">${icon('play')}看一遍追查过程<span>无需连接 · 交互演示</span></button><span class="hero-signature">FOLLOW THE<br>EVIDENCE ↗</span></div></div>${evidenceBoard()}</section>
    <section class="investigate-section" aria-labelledby="new-investigation-title"><div class="entry-heading"><h2 id="new-investigation-title"><span>01 /</span> 写下你的第一个疑问</h2><span>一条传言，也值得认真查一查。</span></div>
    <form id="search-form" class="query-card"><div class="query-top"><label class="query-label" for="question">${icon('search')}今天，有什么想查清楚？</label><span class="private-label">${icon('folder')}本机保存 · 随时导出</span></div>
      <textarea id="question" name="question" maxlength="500" rows="2" required placeholder="例如：故宫每周一都闭馆，法定节假日也一样吗？">${e(state.draft)}</textarea>
      <div class="query-footer"><div class="mode-control" role="group" aria-label="调查方式">${[['quick', 'search', '快速查询', '1 次搜索'], ['deep', 'spark', '三轮追查', '3 次搜索']].map(([mode, name, label, calls]) => `<button type="button" class="mode-button ${state.mode === mode ? 'active' : ''}" data-action="mode" data-mode="${mode}" aria-pressed="${state.mode === mode}">${icon(name)}${label}<small>${calls}</small></button>`).join('')}</div>
      <div class="query-actions"><button type="button" class="filter-trigger screenshot-action" data-action="screenshot" aria-label="从截图识别说法">${icon('image')}<span>截图查证</span></button><button type="button" class="filter-trigger" data-action="filters" aria-expanded="${state.filters}" aria-controls="advanced-filters" aria-label="搜索范围">搜索范围 ${icon('settings')}</button><button class="primary-button" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '调查进行中' : '开始调查'}${icon('arrow')}</button></div></div>
      <div class="advanced-filters" id="advanced-filters" ${state.filters ? '' : 'hidden'}><div class="form-field"><label for="freshness">时间范围</label><select id="freshness" name="freshness">${[['', '不限时间'], ['d1', '最近一天'], ['d7', '最近一周'], ['m1', '最近一个月'], ['y1', '最近一年']].map(([v, t]) => `<option value="${v}" ${state.settings.freshness === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div class="form-field"><label for="industry">搜索领域</label><select id="industry" name="industry" ${state.settings.tier === 'lite' ? 'disabled' : ''}>${[['', '全领域'], ['gov', '政务资料'], ['news', '新闻资讯'], ['acad', '学术资料'], ['finance', '财经资料']].map(([v, t]) => `<option value="${v}" ${state.settings.industry === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div class="form-field"><label for="site">指定站点 可留空</label><input id="site" name="site" placeholder="例如 dpm.org.cn" value="${e(state.settings.site)}"></div></div>
    </form>
    <div class="query-footnote"><p class="scope-note">查公开信息，留可复核的证据。不处理时政和个人相关消息。</p><span>Ctrl / ⌘ + Enter 发起调查</span></div></section>
    ${screenshotPanel()}
    <input id="screenshot-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
    ${state.busy ? `<div class="run-status"><span class="spinner"></span>已有一份调查正在进行。<button class="text-button stop-action" data-action="open-running">查看进展 ${icon('arrow')}</button></div>` : ''}
    ${hotspotsPreview()}
    ${discoveryView()}
    <section class="method-strip"><div class="method-intro"><div class="eyebrow">THE WAY WE INVESTIGATE</div><h3>答案之外，把依据也带回来。</h3><p>不以搜索排名代替可信度，不以多数意见代替事实。</p></div><div class="method-steps"><div class="method-step"><span>01</span><div><b>循线追查</b><small>按问题补查条件与例外</small></div></div><div class="method-step"><span>02</span><div><b>交叉核对</b><small>对照支持、质疑与背景</small></div></div><div class="method-step"><span>03</span><div><b>留下档案</b><small>结论、来源、过程一起导出</small></div></div></div></section>
    ${state.cases.length ? `<section class="scenarios"><div class="section-heading"><h2>最近的调查</h2><a class="text-button" href="#history">全部档案${icon('arrow')}</a></div>${historyCards(state.cases.slice(0, 2))}</section>` : ''}`;
}

function screenshotPanel() { return screenshotView(state); }
function monitorsView() { return monitorsPage(state); }

function monitorDialog(monitor) {
  dialog.setAttribute('aria-labelledby', 'monitor-title');
  const maxDate = new Date(Date.now() + 29 * 86400000);
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = localDate(new Date());
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  const lastDate = localDate(maxDate);
  dialog.className = 'dialog';
  dialog.innerHTML = `<div class="dialog-header"><h2 id="monitor-title">设置每日盯梢</h2><button class="icon-button" data-dialog="close" aria-label="关闭设置">${icon('close')}</button></div><form id="monitor-form"><div class="dialog-body"><p class="dialog-intro">每天搜索一次“${e(monitor.query)}”，与上次来源摘要对比；仅新来源或摘要变化会生成提醒。盯梢最多运行 30 天。</p><div class="form-field"><label for="monitor-time">每天检查时间（本机时间）</label><input id="monitor-time" name="time" type="time" value="09:00" required></div><div class="form-field"><label for="monitor-end-date">自动结束日期</label><input id="monitor-end-date" name="endDate" type="date" value="${tomorrow}" min="${today}" max="${lastDate}" required></div><label class="checkbox-row"><input type="checkbox" name="notification" checked>允许浏览器系统通知</label><div class="monitor-notice">预计每天占用 1 次搜索；运行 N 天约占用 N 次。盯梢只在浏览器页面打开、电脑在线时执行，且会自动结束。错过的日程不会开机后补发一串查询。</div><div class="dialog-actions"><button class="text-button" data-dialog="close" type="button">取消</button><button class="primary-button" type="submit">开始每日盯梢${icon('clock')}</button></div></div></form>`;
  dialog.showModal();
}

function persistMonitors() {
  try { localStorage.setItem(MONITORS_KEY, JSON.stringify(state.monitors.slice(0, 30))); return true; }
  catch { toast('浏览器空间不足，请先备份或删掉旧档案。', 6000); return false; }
}

function notifyMonitorChange(monitor, changes) {
  const message = `有据盯梢发现 ${changes.length} 条变化：${monitor.query}`;
  toast(message, 8000);
  if (monitor.notification && 'Notification' in window && Notification.permission === 'granted') {
    try {
    const notice = new Notification('有据 · 发现新线索', { body: message, tag: `youju-${monitor.id}` });
    notice.onclick = () => { window.focus(); navigate('monitors'); notice.close(); };
    } catch { /* The on-page alert remains available when OS notices are blocked. */ }
  }
}

async function runMonitor(monitor, { manual = false } = {}) {
  if (state.monitorBusy || state.busy || state.batchBusy) { if (manual) toast('请等待当前调查结束。'); return; }
  if (!hasSearch()) { if (manual) { toast('请先连接元宝搜索。'); openSettings(); } return; }
  // The browser lock serializes writes and scheduled requests across open tabs.
  if (!navigator.locks) { if (manual) toast('请使用新版 Edge 或 Chrome 运行每日盯梢。'); return; }
  state.monitorBusy = true;
  if (state.view === 'monitors') render();
  try { await navigator.locks.request('youju-monitor-run', { ifAvailable: true }, async lock => {
    if (!lock) { if (manual) toast('另一个有据页面正在检查，请稍后再试。'); return; }
    state.monitors = cleanMonitors(load(localStorage, MONITORS_KEY, []));
    monitor = state.monitors.find(m => m.id === monitor.id);
    if (!monitor || monitor.status === 'ended' || !manual && monitor.status !== 'active') return;
    if (!manual && Date.now() < Date.parse(monitor.nextRunAt)) return;
    if (!monitor.endDate || localDay() > monitor.endDate) { monitor.status = 'ended'; persistMonitors(); return; }
    if (blockedTopic(monitor.query)) { monitor.status = 'paused'; monitor.lastError = '此主题不在作品的公开查证范围内。'; persistMonitors(); return; }
    if (!manual && monitor.lastAttemptAt && localDay(new Date(monitor.lastAttemptAt)) === localDay()) {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, -1);
      monitor.nextRunAt = nextMonitorTime(monitor.time, tomorrow); persistMonitors(); return;
    }
    monitor.lastAttemptAt = new Date().toISOString();
    monitor.nextRunAt = nextMonitorTime(monitor.time);
    monitor.attempted = (monitor.attempted || 0) + 1;
    if (!persistMonitors()) return;
    const checkedAt = monitor.lastAttemptAt;
    try {
      const result = await api('/api/search', { query: monitor.query, ...searchOptions(monitor.options), apiKey: state.keys.search });
      const changes = compareMonitorResults(monitor, result.sources, result.requestId, checkedAt);
      monitor.lastRequestId = result.requestId || '';
      if (changes.length) notifyMonitorChange(monitor, changes);
      else if (manual) toast(result.sources.length ? '本次检查没有发现新的来源或摘要变化。' : '本次没有搜索结果，已保留上次基准。');
    } catch (error) {
      monitor.lastError = error.message;
      monitor.checks.unshift({ checkedAt, requestId: error.requestId || '', error: error.message, results: 0, changes: 0 });
      monitor.checks = monitor.checks.slice(0, 30);
      if (/Auth|Key|Unauthorized|Forbidden|Credit|Quota|Limit/i.test(error.code || '')) monitor.status = 'paused';
      toast(`每日盯梢检查失败：${error.message}`, 7000);
    } finally { persistMonitors(); }
  }); } finally { state.monitorBusy = false; if (state.view === 'monitors') render(); }
}

function scheduleMonitors() {
  clearTimeout(state.monitorTimer);
  state.monitorTimer = setTimeout(scheduleMonitors, 30000);
  if (state.busy || state.monitorBusy || state.batchBusy || !hasSearch() || !navigator.locks) return;
  const now = new Date();
  const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const due = state.monitors.filter(monitor => monitor.status === 'active' && monitor.nextRunAt && Date.now() >= Date.parse(monitor.nextRunAt) && (!monitor.endDate || localDay(now) <= monitor.endDate));
  const expired = state.monitors.filter(monitor => monitor.status === 'active' && monitor.endDate && localDay(now) > monitor.endDate);
  if (expired.length) {
    navigator.locks.request('youju-monitor-run', { ifAvailable: true }, lock => {
      if (!lock) return;
      state.monitors = cleanMonitors(load(localStorage, MONITORS_KEY, []));
      state.monitors.filter(m => m.status === 'active' && m.endDate && localDay(now) > m.endDate).forEach(m => { m.status = 'ended'; });
      persistMonitors(); if (state.view === 'monitors') render();
    });
    return;
  }
  if (due.length) runMonitor(due[0]);
}

async function startScreenshotReview(file) {
  const mime = { 'image/jpeg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp' }[file.type];
  if (!mime || file.size > 4_000_000) { toast('请选择不超过 4 MB 的 PNG、JPEG 或 WebP 图片。'); return; }
  if (!state.settings.enableAi || !state.settings.aiBaseUrl || !state.settings.aiModel) {
    state.pendingFile = file;
    toast('截图识别需要先配置支持图片输入的 AI 模型。');
    openSettings();
    setTimeout(() => { const section = $('.ai-settings'); if (section) { section.open = true; section.scrollIntoView({ block: 'center' }); } }, 100);
    return;
  }
  clearScreenshot();
  state.pendingFile = null;
  const controller = new AbortController(); state.extractController = controller;
  state.screenshot = { name: file.name, preview: URL.createObjectURL(file) };
  state.claims = []; state.claimUncertainties = []; state.extracting = true; render();
  try {
    const imageBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('无法读取这张图片。')); reader.readAsDataURL(file); });
    if (controller.signal.aborted) return;
    const result = await api('/api/extract-claims', { imageMime: mime, imageBase64, ai: { baseUrl: state.settings.aiBaseUrl, model: state.settings.aiModel, apiKey: state.keys.ai } }, controller.signal);
    if (controller.signal.aborted) return;
    state.claims = result.claims.map((claim, index) => ({ ...claim, selected: index < 3 }));
    state.claimUncertainties = result.uncertainties || [];
    if (!state.claims.length) toast('没有识别出适合核查的清晰说法。');
  } catch (error) { if (!controller.signal.aborted) { state.claimUncertainties = [error.message]; toast(error.message, 7000); } }
  finally { if (state.extractController === controller) { state.extracting = false; state.extractController = null; render(); } }
}

function clearScreenshot() {
  state.extractController?.abort(); state.extractController = null; state.pendingFile = null;
  if (state.screenshot?.preview) URL.revokeObjectURL(state.screenshot.preview);
  state.screenshot = null; state.claims = []; state.claimUncertainties = []; state.extracting = false;
  const fileInput = $('#screenshot-file'); if (fileInput) fileInput.value = '';
  render();
}

function sourceCard(s, item) {
  const url = safeLink(s.url);
  if (!url) return '';
  return `<article class="source-card" id="source-${e(s.id)}" data-source="${e(s.id)}" data-case="${e(item.id)}"><div class="source-top"><span class="source-favicon">${e((s.site || s.domain || '?').charAt(0).toUpperCase())}</span><span class="source-domain">${e(s.site || s.domain)}</span>${/\.(gov\.cn|edu\.cn|ac\.cn)$/.test(s.domain) ? '<span class="subtle-badge">机构域名</span>' : ''}<span class="source-number">${e(s.id)}</span></div>
    <h3><a href="${e(url)}" target="_blank" rel="noopener noreferrer" data-action="visit" data-source="${e(s.id)}" data-case="${e(item.id)}">${e(s.title)}</a></h3>
    <p class="source-snippet">${e(s.snippet || '服务未提供摘要，请打开原文查看。')}</p>
    ${sourceMedia(s)}
    <div class="source-date">页面标注时间：${e(s.publishedAt || '未提供')} · 第 ${(s.rounds || []).map(e).join('、')} 轮检索</div>
    ${s.content && s.content !== s.snippet ? `<details class="source-content"><summary>展开服务返回的更多文字</summary><p>${e(s.content)}</p></details>` : ''}
    <div class="source-bottom"><a href="${e(url)}" target="_blank" rel="noopener noreferrer" data-action="visit" data-source="${e(s.id)}" data-case="${e(item.id)}">${s.openedAt ? '再次打开原文' : '查看原文'}${icon('arrow-up-right')}</a><div class="source-options"><select data-annotation="${e(s.id)}" data-case="${e(item.id)}" aria-label="${e(s.id)} 人工标记">${Object.entries(annotationNames).map(([v, t]) => `<option value="${v}" ${s.annotation === v ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="icon-button ${s.favorite ? 'saved' : ''}" data-action="favorite" data-source="${e(s.id)}" data-case="${e(item.id)}" aria-label="${s.favorite ? '取消收藏' : '收藏'} ${e(s.id)}" aria-pressed="${s.favorite}">${icon('bookmark')}</button></div></div></article>`;
}

function summaryPanel(item) {
  const ai = item.ai;
  const findings = ai?.findings || item.sources.filter(s => s.snippet).slice(0, 3).map(s => ({ text: s.snippet.slice(0, 230) + (s.snippet.length > 230 ? '…' : ''), sourceIds: [s.id] }));
  return `<section class="panel"><div class="panel-heading"><h2>${icon(ai ? 'spark' : 'file')}${ai ? 'AI 证据归纳' : '目前找到的线索'}</h2><span class="subtle-badge ${item.verdict === 'pending' ? 'amber' : ''}">${e(verdictNames[item.verdict] || verdictNames.pending)}</span></div><div class="summary-content"><p class="summary-intro">${ai ? '以下内容由你配置的 AI 根据检索摘要整理。请沿引用回到原文复核。' : item.sources.length ? '以下是搜索结果中的摘要摘录。可以沿引用查看来源，再记录你的判断。' : state.busy ? '正在寻找证据。拿到结果后，线索会出现在这里。' : '没有找到可引用的证据，暂时无法回答这个问题。可以调整搜索词或扩大时间范围。'}</p><div class="findings">${findings.map((f, i) => `<p class="finding"><span class="finding-index">0${i + 1}</span>${e(f.text)}${f.sourceIds.map(id => `<button class="citation" data-action="citation" data-source="${e(id)}" aria-label="跳到来源 ${e(id)}">${e(id)}</button>`).join('')}</p>`).join('')}</div></div><div class="unknown-note">${icon('info')}<span>${ai?.uncertainties?.length ? ai.uncertainties.map(e).join('；') : '摘要可能省略上下文；多个网页也可能转述同一材料。检索相关度不等于可信度。'}</span></div></section>`;
}

function asidePanel(item) {
  const stats = statistics(item);
  return `<aside class="investigation-aside"><section class="panel"><div class="panel-heading"><h2>${icon('search')}调查进程</h2><span class="subtle-badge">${item.mode === 'deep' ? '三轮' : '一轮'}</span></div><div class="aside-body"><div class="timeline">${item.steps.map((s, i) => `<div class="timeline-step ${s.status}"><span class="timeline-dot"></span><div class="timeline-title">${i + 1}. ${e(s.title)}</div><div class="timeline-detail">${s.status === 'done' ? `找到 ${s.count} 条结果` : s.status === 'running' ? '正在检索…' : s.status === 'failed' ? '本轮未完成' : '已停止'}</div></div>`).join('')}</div></div></section><section class="panel"><div class="panel-heading"><h2>${icon('folder')}这份档案</h2></div><div class="aside-body"><div class="stat-pair"><span>去重后的来源</span><strong>${stats.sources} 条</strong></div><div class="stat-pair"><span>涉及网站域名</span><strong>${stats.domains} 个</strong></div><div class="stat-pair"><span>已打开的来源</span><strong>${stats.opened} 条</strong></div><div class="stat-pair"><span>人工标记</span><strong>${stats.reviewed} 条</strong></div><div class="stat-pair"><span>本次已发起搜索</span><strong>${item.attempted || item.steps.length} 次</strong></div></div></section><p class="aside-note">${icon('info')}调用次数由本工作台记录，实际扣费与免费额度以腾讯云控制台为准。域名不同也不一定是独立信源。</p></aside>`;
}

function notesPanel(item) {
  return `<section class="panel"><div class="panel-heading"><h2>${icon('file')}把你的判断写进档案</h2><span class="subtle-badge">人工判断</span></div><div class="notes-area"><p>打开原文，核对时间、条件和不同说法后再下结论。资料不足时，可以选择“暂不能确认”。</p><div class="field-label">当前判断</div><div class="verdict-options">${Object.entries(verdictNames).map(([v, t]) => `<button class="verdict-option ${item.verdict === v ? 'active' : ''}" data-action="verdict" data-verdict="${v}" aria-pressed="${item.verdict === v}">${t}</button>`).join('')}</div><label class="field-label" for="case-notes">结论与需要进一步追查的问题</label><textarea id="case-notes" maxlength="10000" placeholder="例如：原文明确写了适用条件……依据见 S1。S2 只引用了部分文字，仍需要核对……">${e(item.notes)}</textarea><div class="notes-saved" id="notes-saved">输入后自动保存在本机，导出报告时一起带走。</div></div></section>`;
}

function tracePanel(item) {
  return `<section class="panel"><div class="panel-heading"><h2>${icon('clock')}实际检索轨迹</h2><span class="subtle-badge">元宝搜索</span></div><div class="trace-list">${item.steps.map((s, i) => `<article class="trace-item"><h3>第 ${i + 1} 轮 · ${e(s.title)}</h3><p>检索词：${e(s.query)}</p><p>范围：${e(s.site || '全网')} · ${s.status === 'done' ? `完成，返回 ${s.count} 条可用结果` : s.status === 'failed' ? '未完成' : s.status === 'running' ? '查询中' : '已停止'}</p><p>${e(s.description || '')}</p><code>Request ID: ${e(s.requestId || '尚未获得')}</code>${s.error ? `<p>${e(s.error)}</p>` : ''}</article>`).join('')}</div></section>`;
}

function caseView() {
  const item = current(); if (!item) return historyView();
  const filtered = item.sources.filter(s => state.sourceFilter !== 'saved' || s.favorite);
  const isRunning = state.busy && item.id === state.runningId;
  const lastError = [...item.steps].reverse().find(s => s.error);
  return `<div class="case-heading"><div class="case-kicker">CASE FILE / ${e(item.id.slice(0, 8).toUpperCase())}${item.imported ? '<span class="subtle-badge amber">导入档案</span>' : ''}</div><h1>${e(item.query)}</h1><div class="case-subtitle"><span>${dateText(item.createdAt)}</span><span>${item.mode === 'deep' ? '三轮追查' : '快速查询'}</span><span>${item.status === 'complete' ? '已完成检索' : item.status === 'running' ? '调查进行中' : item.status === 'cancelled' ? '已停止 · 保留已有结果' : '未完成 · 保留已有结果'}</span></div></div>
    <div class="case-toolbar"><button class="secondary-button" data-action="export-md">${icon('download')}导出调查报告</button><button class="secondary-button" data-action="copy-report">${icon('copy')}复制报告</button><button class="secondary-button" data-action="export-case">${icon('folder')}保存档案</button><button class="secondary-button" data-action="print">${icon('print')}打印 / 存 PDF</button>${!isRunning && !item.imported && !state.monitors.some(monitor => monitor.caseId === item.id && monitor.status !== 'ended') ? `<button class="secondary-button" data-action="monitor-create" data-case="${e(item.id)}">${icon('clock')}开启每日盯梢</button>` : ''}${!isRunning ? `<button class="text-button" data-action="requery">重新调查 ${icon('arrow')}</button>` : ''}</div>
    ${isRunning ? `<div class="run-status" role="status" aria-live="polite"><span class="spinner"></span><span>${e(state.liveText)}</span><button class="text-button stop-action" data-action="stop">${icon('stop')}停止</button></div>` : ''}
    ${lastError ? `<div class="error-message" role="alert">${e(lastError.error)}${lastError.requestId ? ` 请求 ID：${e(lastError.requestId)}` : ''} ${!hasSearch() ? '<button class="text-button" data-action="settings">配置搜索</button>' : ''}</div>` : ''}
    ${item.aiError ? `<div class="error-message">${e(item.aiError)}</div>` : ''}
    <div class="result-grid"><div class="result-main">${summaryPanel(item)}<div class="print-only">人工判断：${e(verdictNames[item.verdict])}\n${e(item.notes || '尚未填写结论。')}</div>
      <div class="result-tabs" role="tablist" aria-label="调查内容">${[['evidence', `证据清单 ${item.sources.length}`], ['compare', '来源对照'], ['report', '调查结论'], ['trace', '检索轨迹']].map(([t, title]) => `<button class="result-tab ${state.tab === t ? 'active' : ''}" data-action="tab" data-tab="${t}" role="tab" id="tab-${t}" aria-selected="${state.tab === t}" aria-controls="view-panel">${title}</button>`).join('')}</div>
      <div id="view-panel" role="tabpanel" aria-labelledby="tab-${state.tab}">${state.tab === 'compare' ? comparisonView(item) : state.tab === 'report' ? notesPanel(item) : state.tab === 'trace' ? tracePanel(item) : `<div class="source-tools"><div class="source-filter"><button data-action="source-filter" data-filter="all" class="${state.sourceFilter === 'all' ? 'active' : ''}" aria-pressed="${state.sourceFilter === 'all'}">全部来源</button><button data-action="source-filter" data-filter="saved" class="${state.sourceFilter === 'saved' ? 'active' : ''}" aria-pressed="${state.sourceFilter === 'saved'}">已收藏</button></div><span>按检索顺序排列 · 自动去重</span></div><div class="source-list">${filtered.length ? filtered.map(s => sourceCard(s, item)).join('') : emptyPanel(isRunning ? 'search' : 'folder', isRunning ? '正在追查线索' : state.sourceFilter === 'saved' ? '还没有收藏这份档案的来源' : '暂时没有找到证据', isRunning ? '每一轮完成后，真实结果会出现在这里。' : state.sourceFilter === 'saved' ? '点击来源右下角的书签，即可收藏。' : '可以修改问题、放宽时间或检查站点范围后再查。')}</div>`}</div>
    </div>${asidePanel(item)}</div>`;
}

function emptyPanel(name, title, message, action = false) {
  return `<div class="empty-state">${icon(name)}<h3>${title}</h3><p>${message}</p>${action ? `<button class="primary-button" data-action="new">开始第一份调查${icon('arrow')}</button>` : ''}</div>`;
}
function historyCards(items) {
  return `<div class="history-list">${items.map(item => `<article class="history-card"><a class="history-open" href="#case/${e(item.id)}"><div class="history-icon">${icon('file')}</div><div><h3>${e(item.query)}</h3><p>${dateText(item.createdAt)} · ${item.sources.length} 条来源 · ${item.mode === 'deep' ? '三轮追查' : '快速查询'}${item.imported ? ' · 导入' : ''}</p></div></a><span class="history-status">${e(verdictNames[item.verdict] || verdictNames.pending)}</span><button class="icon-button" data-action="delete-case" data-case="${e(item.id)}" aria-label="删除调查 ${e(item.query)}">${icon('trash')}</button></article>`).join('')}</div>`;
}
function historyView() {
  const filtered = state.cases.filter(c => c.query.toLowerCase().includes(state.historyFilter.toLowerCase()));
  return `<div class="page-header"><div><div class="eyebrow">YOUR CASE FILES</div><h1>我的调查</h1><p>问题、线索和判断，留在自己的档案里。</p></div><div class="page-actions"><button class="secondary-button" data-action="import">${icon('upload')}导入档案</button><button class="secondary-button" data-action="export-all">${icon('download')}备份全部</button></div></div>${state.cases.length ? `<label class="field-label" for="history-search">搜索调查</label><input id="history-search" class="history-search" placeholder="按问题查找……" value="${e(state.historyFilter)}"><div id="history-results">${filtered.length ? historyCards(filtered) : emptyPanel('search', '没有匹配的调查', '换一个关键词试试。')}</div>` : emptyPanel('folder', '第一份调查，从一个问题开始', '搜索完成后，过程、原始摘要和来源会自动保存在这里。', true)}`;
}
function bookmarksView() {
  const items = state.cases.filter(c => c.sources.some(s => s.favorite));
  return `<div class="page-header"><div><div class="eyebrow">SAVED EVIDENCE</div><h1>证据收藏</h1><p>值得再读一遍的来源，随时回到原文。</p></div></div>${items.length ? items.map(item => `<section class="bookmark-group"><div class="section-heading"><h2>${e(item.query)}</h2><a href="#case/${e(item.id)}" class="text-button">查看档案 ${icon('arrow')}</a></div><div class="bookmark-grid">${item.sources.filter(s => s.favorite).map(s => sourceCard(s, item)).join('')}</div></section>`).join('') : emptyPanel('bookmark', '有价值的线索，留个书签', '在调查结果里点击书签，即可把来源保存在这里。', false)}`;
}
function realCases() {
  const unique = new Set();
  return state.cases.filter(c => {
    const key = c.query.replace(/\s/g, '');
    if (c.imported || c.status !== 'complete' || !c.sources.length || !c.steps.some(s => s.status === 'done' && s.requestId) || unique.has(key)) return false;
    unique.add(key); return true;
  });
}
function contestView() {
  const ready = realCases();
  const deadline = new Date('2026-10-25T16:05:00+08:00');
  const shareDeadline = new Date('2026-10-25T23:59:00+08:00');
  const now = new Date();
  const deadlineStatus = now <= deadline ? '作品提交开放中' : now <= shareDeadline ? '作品提交已截止' : '本届截止时间已过';
  const shareStatus = now <= shareDeadline ? '分享链接仍可补填至 23:59' : '分享链接补填时间已过';
  return `<div class="page-header"><div><div class="eyebrow">1024 · WAYTOAGI</div><h1>让作品，带着证据出场。</h1><p>把赛道要求，变成逐项可以完成的准备。</p></div><button class="secondary-button" data-action="export-entry">${icon('download')}导出作品介绍</button></div>
  <div class="contest-intro"><section class="contest-card"><span class="subtle-badge amber">${deadlineStatus}</span><div class="deadline">10 月 25 日<small>16:05</small></div><p>${shareStatus}。<br>作品提交与分享链接分别截止，请以提交页为准。</p></section><section class="contest-card"><h2>3 次真实查询</h2><p>不同问题，查询完成，带有可打开的来源。导入档案不计入这里。</p><div class="contest-progress"><span>本机已完成记录</span><strong>${Math.min(ready.length, 3)} / 3</strong></div><progress max="3" value="${Math.min(ready.length, 3)}" aria-label="真实查询完成数量"></progress></section></div>
  ${ready.length ? `<div class="section-heading"><h2>可用于录屏的调查</h2><a class="text-button" href="#history">全部档案 ${icon('arrow')}</a></div>${historyCards(ready.slice(0, 3))}` : ''}
  <section class="contest-card scenarios"><h2>提交前，逐项核对</h2><div class="checklist">${[
    ['open', '作品能打开，元宝搜索是核心能力', '用自己的 Key 实测，检查打开到查询的完整过程。'],
    ['proof', '3 份真实查询截图或录屏', '每份包含问题、结果和点得开的来源；本页计数不能替代录屏。'],
    ['advanced', '附上三轮追查演示', '展示检索轨迹、去重来源、人工判断和导出的报告。'],
    ['submit', `${now > deadline ? '已过期：' : ''}10 月 25 日 16:05 提交作品`, '作品名、一句话介绍、作品链接或文件、使用工具。'],
    ['social', '在小红书或视频号公开分享', '#元宝搜索 #WaytoAGI #AI切磋大会 #1024超能Coding周末'],
    ['share', `${now > shareDeadline ? '已过期：' : ''}10 月 25 日 23:59 前补填分享链接`, '参评侦探赛道前三与 10 名优秀奖需要分享；其他奖项按活动规则。']
  ].map(([key, title, sub]) => `<label><input type="checkbox" data-check="${key}" ${state.checks[key] ? 'checked' : ''}><span>${title}<small>${sub}</small></span></label>`).join('')}</div><div class="contest-links"><a href="https://1024.waytoagi.com/tracks/detective" target="_blank" rel="noopener noreferrer">官方赛道${icon('arrow-up-right')}</a><a href="https://waytoagi.feishu.cn/wiki/Ht49w6i3kipT0Vk61H3cmUxtnJg" target="_blank" rel="noopener noreferrer">活动说明${icon('arrow-up-right')}</a><a href="https://console.cloud.tencent.com/wsapi/activity" target="_blank" rel="noopener noreferrer">领取搜索额度${icon('arrow-up-right')}</a></div></section>`;
}

function render() {
  const views = { home: homeView, hotspots: hotspotsView, history: historyView, case: caseView, bookmarks: bookmarksView, monitors: monitorsView, contest: contestView, community: communityView, resources: resourcesView, 'public-topic': publicTopicView, login: () => authView('login'), register: () => authView('register'), recover: () => authView('recover'), 'demo-users': () => authView('demo-users'), account: accountView, certification: certificationView, admin: adminView };
  app.innerHTML = shell((views[state.view] || homeView)());
  afterHotspotRender();
  if (state.view === 'case' && current()?.origin?.type === 'screenshot') {
    const origin = current().origin, note = document.createElement('div');
    note.className = 'origin-note';
    note.textContent = `来自截图 · ${origin.screenshotName || '未命名截图'} ｜ 确认的原句：${origin.quote} ${origin.context || ''}`;
    $('.case-heading').after(note);
  }
}

function openSettings(pending = false) {
  dialog.setAttribute('aria-labelledby', 'settings-title');
  state.pendingStart = pending;
  dialog.className = 'dialog';
  dialog.innerHTML = `<div class="dialog-header"><h2 id="settings-title">连接你的搜索能力</h2><button class="icon-button" data-dialog="close" aria-label="关闭设置">${icon('close')}</button></div><form id="settings-form"><div class="dialog-body"><p class="dialog-intro">把一个问题交给元宝搜索，带着真实来源回来。密钥通过本机服务发送给对应接口，不写入调查报告。</p><div class="form-field"><label for="search-key">元宝搜索服务 API Key</label><div class="input-with-button"><input id="search-key" name="searchKey" type="password" autocomplete="off" spellcheck="false" value="${e(state.keys.search)}" placeholder="粘贴服务 API KEY，不是 AKID 开头的 SecretId"><button type="button" class="icon-button" data-dialog="reveal" aria-label="显示或隐藏搜索密钥">${icon('eye')}</button></div><p class="field-help">腾讯云元宝搜索控制台 → 概览 → 服务 API KEY → 创建 API KEY。<a href="https://console.cloud.tencent.com/wsapi" target="_blank" rel="noopener noreferrer">打开控制台</a></p></div><div class="form-field"><label for="search-tier">已开通的服务版本</label><select id="search-tier" name="tier"><option value="lite" ${state.settings.tier === 'lite' ? 'selected' : ''}>极速版 · 仅使用支持的基础参数</option><option value="standard" ${state.settings.tier !== 'lite' ? 'selected' : ''}>标准版 · 可指定领域和结果数量</option></select></div><label class="checkbox-row"><input type="checkbox" name="remember" ${state.settings.rememberKeys ? 'checked' : ''}>在这个浏览器记住密钥</label><p class="field-help">未勾选时仅保留在当前浏览器会话。保存设置不会发起搜索。</p><div id="settings-error" class="form-error" role="alert" hidden></div><details class="ai-settings" ${state.settings.enableAi ? 'open' : ''}><summary>AI 证据归纳与截图识别 选填</summary><p class="field-help">不配置也能搜索、追查和导出。开启后归纳会发送问题与检索摘要；截图识别另发送你选择的图片，需要支持图片输入的模型。由该服务独立计费。</p><label class="checkbox-row"><input type="checkbox" name="enableAi" ${state.settings.enableAi ? 'checked' : ''}>每次检索后自动整理带引用的发现</label><div class="form-field"><label for="ai-base">兼容接口地址</label><input id="ai-base" name="aiBaseUrl" type="url" value="${e(state.settings.aiBaseUrl)}" placeholder="https://你的服务域名/v1"><p class="field-help">填写至 /v1，工作台会调用 /chat/completions；也支持本机模型。</p></div><div class="form-field"><label for="ai-model">模型名称</label><input id="ai-model" name="aiModel" value="${e(state.settings.aiModel)}" placeholder="填写你开通的模型名称"></div><div class="form-field"><label for="ai-key">AI API Key</label><input id="ai-key" name="aiKey" type="password" autocomplete="off" value="${e(state.keys.ai)}" placeholder="远程服务密钥；本机免密服务可留空"></div></details><div class="dialog-actions"><button class="text-button" data-dialog="clear" type="button">清除已保存密钥</button><button class="primary-button" type="submit">${pending ? '保存并开始调查' : '保存配置'}${icon('check')}</button></div></div></form>`;
  dialog.showModal();
}

async function saveSettings(form) {
  const data = new FormData(form);
  const key = String(data.get('searchKey') || '').trim();
  const error = $('#settings-error');
  const fail = message => { error.textContent = message; error.hidden = false; };
  if (/^(AKID|IKID)/i.test(key)) { fail('这看起来是腾讯云 SecretId。请换成元宝搜索“服务 API KEY”；不要填写 SecretKey。'); return; }
  if (state.pendingStart && !key && !state.health?.searchConfigured) { fail('本次真实查询需要元宝搜索服务 API Key。'); return; }
  const enableAi = data.get('enableAi') === 'on';
  const base = String(data.get('aiBaseUrl') || '').trim();
  if (enableAi && (!base || !data.get('aiModel'))) { fail('启用 AI 归纳时，请填写接口地址和模型名称。'); return; }
  if (enableAi) {
    try { const url = new URL(base); if (!['https:', 'http:'].includes(url.protocol)) throw Error(); } catch { fail('请填写有效的完整 AI 接口地址。'); return; }
  }
  state.settings = { ...state.settings, tier: data.get('tier'), rememberKeys: data.get('remember') === 'on', enableAi, aiBaseUrl: base, aiModel: String(data.get('aiModel') || '').trim() };
  state.keys = { search: key, ai: String(data.get('aiKey') || '').trim() };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    localStorage.removeItem(KEYS_KEY); sessionStorage.removeItem(KEYS_KEY);
    (state.settings.rememberKeys ? localStorage : sessionStorage).setItem(KEYS_KEY, JSON.stringify(state.keys));
  } catch { toast('密钥仅保留在当前页面，浏览器拒绝了存储。', 6000); }
  const pending = state.pendingStart; state.pendingStart = false;
  const pendingFile = state.pendingFile; state.pendingFile = null;
  dialog.close(); render(); toast('配置已保存。');
  if (pending) await investigate();
  else if (enableAi && pendingFile) await startScreenshotReview(pendingFile);
  scheduleMonitors();
}

async function api(path, body, signal) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || '请求未完成。'); error.code = data.code; error.requestId = data.requestId; throw error; }
  return data;
}

async function investigate(queryOverride = '', origin = null) {
  if (state.busy) { toast('已有调查在进行，可以先查看进展。'); return; }
  const question = String(queryOverride || state.draft).trim();
  if (!question) { $('#question')?.focus(); toast('先写下一个具体的问题。'); return; }
  const blocked = blockedTopic(question);
  if (blocked) { toast(`本作品不处理${blocked}类问题。请改查公开规则、产品和非个人信息。`, 6500); return; }
  if (!hasSearch()) { openSettings(true); return; }
  const options = { ...state.settings };
  if (options.site && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(options.site)) { toast('指定站点只填写域名，例如 dpm.org.cn。'); return; }
  const item = createCase(question, state.mode, origin);
  item.searchOptions = searchOptions(options);
  const controller = new AbortController();
  state.busy = true; state.controller = controller; state.runningId = item.id; state.currentId = item.id;
  state.tab = 'evidence'; state.sourceFilter = 'all'; state.liveText = '正在连接元宝搜索…';
  state.cases.unshift(item); persist(); navigate(`case/${item.id}`);
  const total = item.mode === 'deep' ? 3 : 1;
  let failure = false;
  try {
    for (let index = 0; index < total; index++) {
      if (controller.signal.aborted) break;
      const step = { ...nextStep(item, index, options), status: 'running', count: 0, requestId: '', startedAt: new Date().toISOString() };
      item.steps.push(step); item.attempted++;
      state.liveText = `第 ${index + 1} / ${total} 轮 · ${step.title}`; persist(); render();
      try {
        const result = await api('/api/search', { query: step.query, site: step.site, tier: options.tier, freshness: options.freshness, industry: options.industry, count: options.count, apiKey: state.keys.search }, controller.signal);
        if (controller.signal.aborted) { step.status = 'cancelled'; break; }
        step.status = 'done'; step.count = result.sources.length; step.requestId = result.requestId;
        step.completedAt = result.searchedAt; step.version = result.version; step.skipped = result.skipped;
        mergeEvidence(item, result, index + 1); persist(); render();
      } catch (error) {
        step.status = controller.signal.aborted ? 'cancelled' : 'failed';
        step.error = controller.signal.aborted ? '本轮已停止。已发出的搜索可能已经计入服务用量。' : error.message;
        step.requestId = error.requestId || '';
        failure = !controller.signal.aborted; break;
      }
    }
    if (!controller.signal.aborted && !failure && options.enableAi && item.sources.length) {
      state.liveText = '正在根据搜索摘要整理带引用的发现…'; render();
      try {
        item.ai = await api('/api/summarize', { query: item.query, sources: item.sources, ai: { baseUrl: options.aiBaseUrl, model: options.aiModel, apiKey: state.keys.ai } }, controller.signal);
      } catch (error) { if (!controller.signal.aborted) item.aiError = error.message; }
    }
  } finally {
    item.status = controller.signal.aborted ? 'cancelled' : failure ? 'failed' : 'complete';
    item.updatedAt = new Date().toISOString(); state.busy = false; state.controller = null; state.liveText = '';
    persist(); render();
    toast(item.status === 'complete' ? `调查已保存，找到 ${item.sources.length} 条来源。` : item.status === 'cancelled' ? '调查已停止，已有结果已经保留。' : '本次调查未完成，请查看具体原因。', 5000);
    scheduleMonitors();
  }
  return item;
}

function download(name, content, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function fileName(item, extension) { return `有据_${item.query.slice(0, 28).replace(/[<>:"/\\|?*\r\n]/g, '_')}.${extension}`; }
function archive(cases) { return JSON.stringify({ app: 'youju-detective', version: 1, exportedAt: new Date().toISOString(), cases }, null, 2); }
const entryText = "# 有据 AI 侦探社 v4.2\n\n公开问题交给元宝搜索，带着来源回来，让社区带着证据参与。\n\n支持实时图文快讯、热点查询与追踪时间线、按问题类型三轮追查、来源对照、来源配图、截图查证、每日盯梢、公开资料入口与共享议题。热点可打开原文、来源视频或明确标注的视频搜索入口。\n\n账户与身份：注册、登录、恢复码找回、个人资料、密码与会话管理；普通成员、志愿评判官、社区评审员、领域贡献者、社区管理员。社区核验有申请、审核、理由、撤销和记录。管理员不能自审，身份不等于官方专业资质。\n\n元宝搜索必须配置有效服务 API Key；共享议题先搜索再创建，评议至少引用一个来源。截图识别另需图像模型，盯梢需要电脑在线和页面打开。\n\n当前是本机运行的共享服务，未公开部署，测试不能替代三次真实查询材料。\n\n#元宝搜索 #WaytoAGI #AI切磋大会 #1024超能Coding周末\n";

app.addEventListener('submit', event => {
  if (event.target.id === 'search-form') { event.preventDefault(); state.draft = $('#question').value; investigate(); return; }
});
async function saveMonitor(form) {
  if (!navigator.locks) { toast('请使用新版 Edge 或 Chrome 运行每日盯梢。'); return; }
  await navigator.locks.request('youju-monitor-run', async () => {
  state.monitors = cleanMonitors(load(localStorage, MONITORS_KEY, []));
  if (state.monitors.filter(m => m.status === 'active').length >= 5) { toast('最多同时运行 5 项每日盯梢。'); return; }
  const sourceCase = state.cases.find(item => item.id === state.creatingMonitorFor);
  if (state.monitors.some(m => m.caseId === sourceCase?.id && m.status !== 'ended')) { toast('这份调查已经开启盯梢。'); return; }
  if (!sourceCase || !sourceCase.sources.length) { toast('原调查没有可用来源，暂时无法建立盯梢。'); dialog.close(); return; }
  const data = new FormData(form);
  const endDate = String(data.get('endDate') || ''), time = String(data.get('time') || '');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(endDate + 'T23:59:59');
  if (!Number.isFinite(end.getTime()) || end < today || endDate > localDay(new Date(Date.now() + 29 * 86400000))) { toast('结束日期应在今天到 30 天内。'); return; }
  let created;
  try { created = createMonitor(sourceCase.query, sourceCase.sources, time, sourceCase.id); }
  catch (error) { toast(error.message); return; }
  created.endDate = endDate; created.notification = data.get('notification') === 'on'; created.nextRunAt = nextMonitorTime(time);
  created.options = searchOptions(sourceCase.searchOptions || state.settings);
  // Use round-one results as the baseline for the same query and scope.
  created.baseline = createMonitor(sourceCase.query, sourceCase.sources.filter(s => s.rounds?.includes(1)), time).baseline;
  if (localDay(new Date(created.nextRunAt)) > endDate) { toast('所选结束日期内已没有检查时间，请选更晚的日期。'); return; }
  state.monitors.unshift(created);
  if (!persistMonitors()) { state.monitors.shift(); return; }
  dialog.close(); state.creatingMonitorFor = '';
  if (created.notification && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  navigate('monitors'); toast('每日盯梢已创建。下一次检查按你选择的本机时间运行。'); scheduleMonitors();
  });
}
app.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'question') state.draft = target.value;
  if (target.id === 'case-notes') {
    const item = current(); if (item) { item.notes = target.value; item.updatedAt = new Date().toISOString(); const ok = persist(); $('#notes-saved').textContent = ok ? '已自动保存在本机。' : '存储空间不足，请导出报告保存这次修改。'; }
  }
  if (target.id === 'history-search') {
    state.historyFilter = target.value;
    const filtered = state.cases.filter(c => c.query.toLowerCase().includes(target.value.toLowerCase()));
    $('#history-results').innerHTML = filtered.length ? historyCards(filtered) : emptyPanel('search', '没有匹配的调查', '换一个关键词试试。');
  }
  if (target.dataset.claimQuery !== undefined) { const claim = state.claims[Number(target.dataset.claimQuery)]; if (claim) claim.query = target.value; }
});
app.addEventListener('change', event => {
  const target = event.target;
  if (['freshness', 'industry', 'site'].includes(target.id)) state.settings[target.id] = target.value.trim();
  if (target.id === 'screenshot-file' && target.files?.[0]) startScreenshotReview(target.files[0]);
  if (target.dataset.claim !== undefined) { const claim = state.claims[Number(target.dataset.claim)]; if (claim) { claim.selected = target.checked; render(); } }
  if (target.dataset.annotation) {
    const item = state.cases.find(c => c.id === target.dataset.case);
    const source = item?.sources.find(s => s.id === target.dataset.annotation);
    if (source && Object.hasOwn(annotationNames, target.value)) { source.annotation = target.value; persist(); render(); toast('人工标记已保存。'); }
  }
  if (target.dataset.check) {
    state.checks[target.dataset.check] = target.checked;
    try { localStorage.setItem(CHECKS_KEY, JSON.stringify(state.checks)); } catch { toast('浏览器没有保存清单，请检查存储空间。'); }
  }
});
app.addEventListener('toggle', async event => {
  const detail = event.target.closest('details[data-alert]');
  if (!detail || !detail.open) return;
  if (!navigator.locks) return;
  await navigator.locks.request('youju-monitor-run', () => {
  state.monitors = cleanMonitors(load(localStorage, MONITORS_KEY, []));
  const monitor = state.monitors.find(item => item.alerts.some(alert => alert.id === detail.dataset.alert));
  const alert = monitor?.alerts.find(item => item.id === detail.dataset.alert);
  if (alert && !alert.read) { alert.read = true; persistMonitors(); const banner = detail.closest('.monitor-card')?.querySelector('.monitor-alert-banner'); if (banner) { const remaining = monitor.alerts.filter(a => !a.read).length; if (remaining) banner.textContent = `发现 ${remaining} 次未读变化`; else banner.remove(); } }
  });
}, true);
app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  const item = current();
  const sourceItem = state.cases.find(c => c.id === button.dataset.case) || item;
  const source = sourceItem?.sources.find(s => s.id === button.dataset.source);
  switch (action) {
    case 'new': newCase(); break;
    case 'menu': state.menu = !state.menu; render(); break;
    case 'menu-close': state.menu = false; render(); break;
    case 'settings': openSettings(); break;
    case 'mode': state.mode = button.dataset.mode; render(); break;
    case 'filters': state.filters = !state.filters; render(); break;
    case 'screenshot': $('#screenshot-file').click(); break;
    case 'clear-screenshot': clearScreenshot(); break;
    case 'search-claims': {
      if (state.busy || state.batchBusy) break;
      const selected = state.claims.filter(claim => claim.selected && claim.query.trim());
      if (!selected.length) { toast('请选择至少一条清晰说法。'); break; }
      if (selected.length > 3) { toast('每批最多核查 3 条说法，请减少勾选。'); break; }
      if (!hasSearch()) { toast('先连接元宝搜索，再确认所选说法。'); openSettings(); break; }
      const blocked = selected.map(claim => blockedTopic(claim.query)).find(Boolean);
      if (blocked) { toast('本作品不处理' + blocked + '类问题，请取消该项或重新编辑搜索词。'); break; }
      const total = selected.length * (state.mode === 'deep' ? 3 : 1);
      if (!confirm('将对 ' + selected.length + ' 条截图说法执行最多 ' + total + ' 次元宝搜索请求，是否继续？')) break;
      const screenshotName = state.screenshot?.name || '';
      const work = selected.map(claim => ({ ...claim })); clearScreenshot();
      state.batchBusy = true; state.batchCancelled = false;
      try { for (const claim of work) {
        if (state.batchCancelled) break;
        const completed = await investigate(claim.query.trim(), { type: 'screenshot', quote: claim.quote, context: claim.context, screenshotName });
        if (!completed || completed.status !== 'complete') break;
      } } finally { state.batchBusy = false; scheduleMonitors(); }
      break;
    }
    case 'monitor-create': {
      const candidate = state.cases.find(c => c.id === button.dataset.case);
      if (!candidate?.sources.length || candidate.imported || !candidate.steps.some(s => s.status === 'done' && s.requestId)) { toast('只有包含真实搜索来源的调查可以开启每日盯梢。'); break; }
      if (state.monitors.filter(monitor => monitor.status === 'active').length >= 5) { toast('最多同时运行 5 项每日盯梢。'); break; }
      state.creatingMonitorFor = candidate.id; monitorDialog(candidate); break;
    }
    case 'monitor-pause': case 'monitor-resume': case 'monitor-end': case 'monitor-delete': {
      if (state.monitorBusy) { toast('请等待本次检查结束。'); break; }
      if (!navigator.locks) { toast('请使用新版 Edge 或 Chrome。'); break; }
      await navigator.locks.request('youju-monitor-run', async () => {
      state.monitors = cleanMonitors(load(localStorage, MONITORS_KEY, []));
      const monitor = state.monitors.find(entry => entry.id === button.dataset.monitor);
      if (!monitor) return;
      if (action === 'monitor-pause') monitor.status = 'paused';
      if (action === 'monitor-resume') {
        if (state.monitors.filter(m => m.status === 'active').length >= 5) { toast('最多同时运行 5 项每日盯梢。'); return; }
        if (!monitor.endDate || localDay(new Date(nextMonitorTime(monitor.time))) > monitor.endDate) { toast('该计划已到结束日期，请从调查档案重新建立盯梢。'); return; }
        monitor.status = 'active'; monitor.nextRunAt = nextMonitorTime(monitor.time); monitor.lastError = '';
      }
      if (action === 'monitor-end') monitor.status = 'ended';
      if (action === 'monitor-delete') { if (!confirm('删除这项盯梢及其变化记录？原调查档案会保留。')) return; state.monitors = state.monitors.filter(entry => entry.id !== monitor.id); }
      persistMonitors(); render(); scheduleMonitors();
      }); break;
    }
    case 'monitor-check': { const monitor = state.monitors.find(entry => entry.id === button.dataset.monitor); if (monitor) await runMonitor(monitor, { manual: true }); break; }
    case 'example': state.draft = button.dataset.query; render(); $('#question')?.focus(); break;
    case 'open-running': navigate(`case/${state.runningId}`); break;
    case 'stop': state.batchCancelled = true; state.controller?.abort(); break;
    case 'tab': state.tab = button.dataset.tab; render(); break;
    case 'source-filter': state.sourceFilter = button.dataset.filter; render(); break;
    case 'visit': if (source) { source.openedAt = new Date().toISOString(); persist(); } break;
    case 'favorite': if (source) { source.favorite = !source.favorite; persist(); render(); toast(source.favorite ? '已收藏这条来源。' : '已取消收藏。'); } break;
    case 'verdict': if (item && Object.hasOwn(verdictNames, button.dataset.verdict)) { item.verdict = button.dataset.verdict; persist(); render(); } break;
    case 'citation': {
      state.tab = 'evidence'; state.sourceFilter = 'all'; render();
      const card = document.getElementById(`source-${button.dataset.source}`);
      if (card) { card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1500); }
      break;
    }
    case 'requery': if (item) { state.draft = item.query; state.mode = item.mode; navigate('home'); } break;
    case 'export-md': if (item) { download(fileName(item, 'md'), reportMarkdown(item)); toast('调查报告已导出，包含来源与检索轨迹。'); } break;
    case 'copy-report': if (item) {
      try { await navigator.clipboard.writeText(reportMarkdown(item)); toast('报告已复制。'); }
      catch { download(fileName(item, 'md'), reportMarkdown(item)); toast('浏览器未允许复制，已改为下载报告。'); }
      break;
    }
    case 'export-case': if (item) download(fileName(item, 'json'), archive([item]), 'application/json'); break;
    case 'export-all': download('有据调查档案备份.json', archive(state.cases), 'application/json'); break;
    case 'export-entry': download('有据作品介绍.md', entryText); break;
    case 'import': $('#import-file').click(); break;
    case 'print': if (item) { state.tab = 'evidence'; state.sourceFilter = 'all'; render(); window.print(); } break;
    case 'delete-case': {
      const target = state.cases.find(c => c.id === button.dataset.case);
      if (!target) break;
      if (state.busy && target.id === state.runningId) { toast('请先停止正在进行的调查。'); break; }
      if (confirm('删除这份本机调查档案？需要保留时，请先导出备份。')) { state.cases = state.cases.filter(c => c.id !== target.id); persist(); render(); }
      break;
    }
  }
});
dialog.addEventListener('submit', event => { event.preventDefault(); if (event.target.id === 'monitor-form') saveMonitor(event.target); else if (event.target.id === 'settings-form') saveSettings(event.target); });
dialog.addEventListener('click', event => {
  const button = event.target.closest('[data-dialog]');
  if (!button) return;
  if (button.dataset.dialog === 'close') { state.pendingStart = false; state.creatingMonitorFor = ''; state.pendingFile = null; dialog.close(); }
  if (button.dataset.dialog === 'reveal') { const input = $('#search-key'); input.type = input.type === 'password' ? 'text' : 'password'; }
  if (button.dataset.dialog === 'clear') {
    state.keys = { search: '', ai: '' };
    try { localStorage.removeItem(KEYS_KEY); sessionStorage.removeItem(KEYS_KEY); } catch {}
    $('#search-key').value = ''; $('#ai-key').value = ''; toast('已清除浏览器保存的密钥。');
  }
});
dialog.addEventListener('cancel', () => { state.pendingStart = false; state.pendingFile = null; });
dialog.addEventListener('close', () => { state.pendingStart = false; render(); });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && $('#question') && !dialog.open) { event.preventDefault(); state.draft = $('#question').value; investigate(); }
  if (event.key === 'Escape' && state.menu) { state.menu = false; render(); }
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw Error('档案文件超过 8 MB，请拆分后导入。');
    const data = JSON.parse(await file.text());
    if (data.app !== 'youju-detective' || data.version !== 1 || !Array.isArray(data.cases)) throw Error('这不是有据导出的调查档案。');
    const imported = data.cases.slice(0, 50).map(cleanImportedCase).filter(Boolean);
    if (!imported.length) throw Error('文件里没有有效调查。');
    state.cases = [...state.cases.filter(c => state.busy && c.id === state.runningId), ...imported, ...state.cases.filter(c => !state.busy || c.id !== state.runningId)].slice(0, 50);
    persist(); navigate('history'); render(); toast(`已导入 ${imported.length} 份档案。导入档案不计为本机真实查询。`);
  } catch (error) { toast(error instanceof SyntaxError ? '文件内容不是有效 JSON。' : error.message, 6000); }
  event.target.value = '';
});
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
window.addEventListener('beforeunload', event => { if (state.busy) { event.preventDefault(); event.returnValue = ''; } });
route();
initWalkthrough(query => { state.draft = query; state.mode = 'deep'; render(); requestAnimationFrame(() => { $('#search-form')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); $('#question')?.focus({ preventScroll: true }); }); });
initCommunity({ state: () => state, render, toast, navigate, api, hasSearch, openSettings });
initHotspots({ state: () => state, toast, api, hasSearch, openSettings, investigate: prepareHotspotInvestigation });
fetch('/api/health').then(r => r.json()).then(data => { state.health = data; if (!dialog.open && !state.busy && document.activeElement?.tagName !== 'TEXTAREA') render(); }).catch(() => toast('本机服务没有连接，请使用“打开有据”启动工作台。', 7000));
if (storageIssue) toast('部分浏览器记录无法读取，已打开空白工作台；可重新导入备份。', 6500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleMonitors(); });
window.addEventListener('focus', scheduleMonitors);
setTimeout(scheduleMonitors, 1000);

window.addEventListener('storage', event => { if (event.key === MONITORS_KEY && !state.monitorBusy) { state.monitors = cleanMonitors(load(localStorage, MONITORS_KEY, [])); if (state.view === 'monitors') render(); scheduleMonitors(); } });
