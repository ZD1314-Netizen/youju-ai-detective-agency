import { escapeHtml as e, safeLink } from './core.js';
import { initAccounts, accountEntry, roleBadges, loginFor } from './account.js';
export { authView, accountView, certificationView, adminView, accountEntry, adminNavigation } from './account.js';
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
const when = date => new Date(date).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const labels = { supports: '证据倾向支持', challenges: '证据倾向质疑', unknown: '证据仍不足' };
const categories = ['生活求证', '科学常识', '出行规则', '数码产品', '文化作品'];
const art = category => category === '出行规则' ? 'travel' : category === '数码产品' ? 'digital' : category === '文化作品' ? 'culture' : 'science';
const examples = [
  { category: '生活求证', title: '瓶底的数字，真的代表使用次数吗？', query: '塑料瓶底部数字是否表示重复使用次数？请查材料编号的原始说明与使用条件。', desc: '把广为流传的说法，追到它的原始出处。', art: 'science' },
  { category: '出行规则', title: '每逢周一闭馆，节假日也一样吗？', query: '故宫博物院周一闭馆的规则是什么？法定节假日和特殊安排有哪些例外？', desc: '核对日期、公告与例外，再安排出行。', art: 'travel' },
  { category: '数码产品', title: '充电器插着不用，也会耗电吗？', query: '充电器不连接手机但接通插座时是否耗电？请查待机功耗测量与适用条件。', desc: '找到测量依据，区分事实、条件和传言。', art: 'digital' }
];
const resources = [
  { name: '中国互联网联合辟谣平台', domain: 'piyao.org.cn', url: 'https://www.piyao.org.cn/', category: '公开辟谣', desc: '查公开辟谣材料，核对原始报道与发布时间。', art: 'science' },
  { name: '国家标准全文公开系统', domain: 'openstd.samr.gov.cn', url: 'https://openstd.samr.gov.cn/', category: '标准原文', desc: '找标准编号、适用范围与现行版本。', art: 'digital' },
  { name: '中国科普博览', domain: 'kepu.net.cn', url: 'https://www.kepu.net.cn/', category: '科学资料', desc: '沿科学概念、研究条件和原始材料追查。', art: 'science' },
  { name: '故宫博物院', domain: 'dpm.org.cn', url: 'https://www.dpm.org.cn/', category: '文旅公告', desc: '以官网公告核对开放、预约与特殊安排。', art: 'travel' },
  { name: '国家药品监督管理局', domain: 'nmpa.gov.cn', url: 'https://www.nmpa.gov.cn/', category: '产品公告', desc: '查产品监管公告与公开说明，不替代个人医疗建议。', art: 'digital' },
  { name: '世界卫生组织', domain: 'who.int', url: 'https://www.who.int/zh', category: '健康资料', desc: '核对公开健康指南的原文、日期与适用人群。', art: 'science' }
];
let hooks, app, modal, data = { topics: [], members: 0, currentUser: null }, loaded = false, error = '', busy = false, filter = '全部', keyword = '';
let controller;
const topic = id => data.topics.find(t => t.id === id);
const currentTopic = () => topic(location.hash.slice(7));
const portrait = (name = '?') => `<span class="member-avatar">${e(name.slice(0, 1))}</span>`;
function banner() { return '<p class="community-scope">本机共享空间 · 同一服务的不同浏览器可参与；当前未公开到互联网。社区身份表示职责和材料核验范围，不是官方或职业资质认证。</p>'; }
export function discoveryView() {
  return `<section class="discovery-section"><div class="section-heading"><div><div class="eyebrow">EVERYDAY MYSTERIES</div><h2><span class="section-index">02 /</span> 日常里的悬而未决</h2></div><a href="#community" class="text-button">去查证广场看看 ${icon('arrow')}</a></div><div class="discovery-grid">${examples.map((card, i) => `<button class="discovery-card" data-community="example" data-index="${i}"><div class="discovery-image"><img src="/art/${card.art}.svg" alt="${e(card.category)}主题插画"><span class="case-card-number">CASE / 00${i + 1}</span><span class="image-caption">主题插画</span></div><div class="discovery-copy"><span class="subtle-badge">${card.category} · 待查问题</span><h3>${card.title}</h3><p>${card.desc}</p><span class="discovery-link">追查这个问题 <span>${icon('arrow-up-right')}</span></span></div></button>`).join('')}</div><div class="community-callout"><div class="callout-symbol">${icon('link')}</div><div><span class="callout-kicker">一个人的疑问，可以一起查。</span><h3>带着来源，加入这场讨论。</h3><p>发起议题、补查证据，让不同意见在同一份证据前对话。</p></div><a class="secondary-button" href="#community">进入查证广场 ${icon('arrow')}</a><button class="text-button" data-community="join">${data.currentUser ? '我的社区身份' : '申请志愿评判官'} ${icon('arrow-up-right')}</button></div></section>`;
}
export function communityView() {
  const items = data.topics.filter(t => (filter === '全部' || t.category === filter) && t.query.toLowerCase().includes(keyword.toLowerCase()));
  return `<div class="community-hero"><div><div class="eyebrow">FOLLOW SOURCES, THINK TOGETHER</div><h1>大家一起查，<br>让事实有据可循。</h1><p>公开问题交给元宝搜索；支持、质疑与不确定，都带上来源。</p><div class="community-hero-actions"><button class="primary-button" data-community="new-topic">${icon('plus')}发起查证议题</button><button class="secondary-button" data-community="join">${data.currentUser ? e(data.currentUser.nickname) + ' · 社区身份' : '登录 / 申请社区身份'}</button></div></div><img src="/art/science.svg" alt="查证资料与放大镜主题插画"></div>${banner()}<div class="community-stats"><span><strong>${data.topics.length}</strong> 已有议题</span><span><strong>${data.members}</strong> 社区参与者</span><span><strong>${data.topics.reduce((n, t) => n + t.reviews.length, 0)}</strong> 条带来源评议</span><a href="#resources">公开资料入口 ${icon('arrow-up-right')}</a></div><div class="community-tools"><div class="topic-filters">${['全部', ...categories].map(c => `<button data-community="filter" data-filter="${c}" class="${filter === c ? 'active' : ''}" aria-pressed="${filter === c}">${c}</button>`).join('')}</div><button class="text-button" data-community="refresh" ${busy ? 'disabled' : ''}>${busy ? '读取中' : '刷新议题'}</button></div><label class="sr-only" for="community-search">搜索议题</label><input class="history-search" id="community-search" placeholder="搜索大家正在核查的问题" value="${e(keyword)}">${error ? `<div class="error-message">${e(error)}</div>` : ''}<div id="topic-results">${topicList(items)}</div>`;
}
function topicList(items) {
  if (!loaded && !error) return '<div class="empty-state">正在读取共享议题…</div>';
  return items.length ? `<div class="topic-grid">${items.map(t => `<a class="topic-card" href="#topic/${e(t.id)}"><div class="topic-cover"><img src="/art/${art(t.category)}.svg" alt="${e(t.category)}主题插画" loading="lazy"><span class="image-caption">主题插画 · 非事件证据</span><span class="topic-category">${e(t.category)}</span></div><div class="topic-body"><h2>${e(t.query)}</h2><p class="topic-evidence">${t.sources.length} 条检索来源 · ${t.searches.length} 次元宝搜索</p><div class="topic-state">${reviewState(t)}</div><div class="topic-bottom">${portrait(t.creator?.nickname)}<span>${e(t.creator?.nickname || '参与者')}</span><small>${when(t.updatedAt)}</small></div></div></a>`).join('')}</div>` : `<div class="empty-state">${icon('search')}<h3>${data.topics.length ? '没有匹配的议题' : '第一项查证，由一个好问题开始'}</h3><p>发布前先用元宝搜索找到来源，再邀请大家带着证据参与。目前没有预置的热点、评议或参与人数。</p><button class="primary-button" data-community="new-topic">发起第一项查证 ${icon('arrow')}</button></div>`;
}
function reviewState(t) {
    const current = t.reviews.filter(r => r.revision === t.revision);
  if (!current.length) return '待大家查证 · 尚无当前证据版本的评议';
  const support = current.filter(r => r.stance === 'supports').length, challenge = current.filter(r => r.stance === 'challenges').length;
  return support && challenge ? '存在不同意见 · 请对照证据' : '已有人提供意见 · 等待更多来源核对';
}
export function publicTopicView() {
  const t = currentTopic();
  if (!t) return `<div class="empty-state"><h3>${loaded ? '没有找到这项议题' : '正在读取议题'}</h3><a class="secondary-button" href="#community">返回查证广场</a></div>`;
  const mine = t.reviews.find(r => r.personId === data.currentUser?.id);
  const canReview = data.currentUser?.registered && data.currentUser.roles.includes('volunteer');
  return `<a class="text-button" href="#community">${icon('arrow')}返回查证广场</a><div class="public-topic-heading"><span class="subtle-badge">${e(t.category)}</span><span class="subtle-badge amber">公共评议 · 事实尚待核对</span><h1>${e(t.query)}</h1><p>${e(t.creator?.nickname || '参与者')} 发起 · ${when(t.createdAt)} · 证据版本 ${t.revision}</p></div>${banner()}<div class="public-topic-actions"><button class="primary-button" data-community="search-topic" data-topic="${t.id}">${icon('search')}补查公开来源 · 1 次搜索</button><button class="secondary-button" data-community="export-topic" data-topic="${t.id}">${icon('download')}导出查证报告</button><button class="text-button" data-community="report" data-topic="${t.id}">提出异议</button><button class="text-button" data-community="refresh">刷新</button></div>${t.reportCount ? `<p class="community-disclaimer">本议题有 ${t.reportCount} 条异议登记，尚未核验处理。</p>` : ''}<div class="public-topic-layout"><section><div class="section-heading"><h2>先看来源，再谈判断</h2><span class="field-help">${t.sources.length} 条证据 · 可点击回到原文</span></div><div class="public-sources">${t.sources.map(s => publicSource(s)).join('')}</div><details class="monitor-log"><summary>检索记录 · ${t.searches.length} 次</summary>${t.searches.map(s => `<div><span>${e(s.query)}</span><small>${e(s.site || '全网')} · ${when(s.searchedAt)} · 请求 ${e(s.requestId || '未返回编号')}</small></div>`).join('')}</details></section><aside class="public-reviews"><section class="panel"><div class="panel-heading"><h2>${icon('link')}公众评议</h2><span class="subtle-badge">${t.reviews.length} 条</span></div><div class="review-counts">${Object.entries(labels).map(([value, label]) => `<div><strong>${t.reviews.filter(r => r.stance === value && r.revision === t.revision).length}</strong><span>${label}</span></div>`).join('')}</div><p class="community-disclaimer">这里只展示当前证据版本的意见分布。人数、点赞或多数意见都不代表事实真伪；社区材料核验不等于官方专业资质，仍须核对原文。</p></section>${t.reviews.map(r => reviewCard(r, t)).join('')}<section class="panel review-editor"><h2>${mine ? '更新你的查证意见' : '留下有来源的评议'}</h2>${canReview ? `<form id="review-form" data-topic="${t.id}"><label class="field-label" for="review-stance">你的判断</label><select id="review-stance" name="stance">${Object.entries(labels).map(([v, label]) => `<option value="${v}" ${(mine?.stance || 'unknown') === v ? 'selected' : ''}>${label}</option>`).join('')}</select><fieldset><legend>引用本议题来源（至少一条）</legend>${t.sources.map(s => `<label class="review-source-choice"><input type="checkbox" name="sourceIds" value="${e(s.id)}" ${mine?.sourceIds.includes(s.id) ? 'checked' : ''}><span>${e(s.id)} · ${e(s.title)}</span><a href="${e(safeLink(s.url))}" target="_blank" rel="noopener noreferrer" aria-label="打开来源 ${e(s.id)}">${icon('arrow-up-right')}</a></label>`).join('')}</fieldset><label class="field-label" for="review-reason">理由、证据条件与仍不确定的部分</label><textarea id="review-reason" name="reason" minlength="25" maxlength="1800" required placeholder="请至少写 25 字，指出来源如何支持或质疑说法；证据不足时请明确说明。">${e(mine?.reason || '')}</textarea><button class="primary-button" type="submit" ${busy ? 'disabled' : ''}>${mine ? '更新评议' : '提交评议'}</button>${mine ? `<button type="button" class="text-button" data-community="withdraw" data-topic="${t.id}">撤回我的评议</button>` : ''}</form>` : `<p>登录账户后，在认证中心完成志愿评判官查证约定，再引用来源参与评议。</p><button class="secondary-button" data-community="join">申请志愿评判官 ${icon('arrow')}</button>`}</section></aside></div>`;
}
function publicSource(s) {
  return `<article class="public-source" id="public-source-${e(s.id)}"><div><span class="source-number">${e(s.id)}</span><span class="source-domain">${e(s.site || s.domain)}</span></div><h3><a href="${e(safeLink(s.url))}" target="_blank" rel="noopener noreferrer">${e(s.title)} ${icon('arrow-up-right')}</a></h3><p>${e(s.snippet || '没有提供摘要，请打开原文。')}</p>${sourceMedia(s)}<small>页面标注时间：${e(s.publishedAt || '未提供')} · 搜索摘要需回到原文核对</small></article>`;
}
function reviewCard(r, t) {
  return `<article class="review-card"><div class="review-author">${portrait(r.author?.nickname)}<div><strong>${e(r.author?.nickname || '参与者')}</strong><small>社区身份 · 非官方资质认证</small></div><span class="review-date">${when(r.updatedAt)}</span></div><span class="subtle-badge ${r.stance === 'unknown' ? 'amber' : ''}">${labels[r.stance]}</span>${r.revision !== t.revision ? '<span class="subtle-badge amber">新增证据后待复核</span>' : ''}<div class="role-badges">${roleBadges(r.author)}</div><p>${e(r.reason)}</p><div class="review-citations">${r.sourceIds.map(id => `<a class="citation" href="#public-source-${e(id)}" data-community="citation" data-source="${e(id)}">${e(id)}</a>`).join('')}<small>证据版本 ${r.revision}${r.history?.length ? ` · 修改 ${r.history.length} 次` : ''}</small></div>${r.history?.length ? `<details><summary>查看最近修改记录</summary>${r.history.map(h => `<p>${e(labels[h.stance] || '')} · ${e(h.reason)}<small>${when(h.updatedAt)}</small></p>`).join('')}</details>` : ''}</article>`;
}
export function resourcesView() {
  return `<div class="page-header"><div><div class="eyebrow">GO BACK TO THE ORIGINAL</div><h1>公开资料，直达出处。</h1><p>从常用公开平台找线索，再用元宝搜索核对问题。</p></div></div><div class="resource-note">以下为常用公开资料网站的快捷入口与站内检索，不是合作接口、官方认证或可信度评分。具体说法仍须核对原文、时间与适用范围。</div><div class="resource-grid">${resources.map((r, i) => `<article class="resource-card"><img src="/art/${r.art}.svg" alt="${r.category}主题插画" loading="lazy"><div><span class="subtle-badge">${r.category}</span><h2>${r.name}</h2><p>${r.desc}</p><span class="resource-domain">${r.domain}</span><div><a class="text-button" href="${r.url}" target="_blank" rel="noopener noreferrer">访问网站 ${icon('arrow-up-right')}</a><button class="secondary-button" data-community="resource-search" data-index="${i}">用元宝搜此站</button></div></div></article>`).join('')}</div>`;
}
export function sourceMedia(source) {
  const images = (source.pictures || []).filter(p => safeLink(p.url).startsWith('https:')).slice(0, 3);
  return images.length ? `<details class="source-media"><summary>来源配图 · ${images.length} 张</summary><p>图片由搜索来源提供，配图不证明说法为真。加载会向原图片网站请求图片。</p><button class="text-button" data-community="load-images">加载来源配图</button><div class="source-gallery">${images.map(p => `<figure><img data-src="${e(safeLink(p.url))}" alt="${e(p.caption || '来源配图')}" loading="lazy" referrerpolicy="no-referrer"><figcaption>${e(p.caption || '来源配图')}<a href="${e(safeLink(p.url))}" target="_blank" rel="noopener noreferrer">打开原图</a></figcaption></figure>`).join('')}</div></details>` : '';
}
function showModal(title, content) { modal.setAttribute('aria-label', title); modal.innerHTML = `<div class="dialog-header"><h2>${title}</h2><button class="icon-button" data-community="close" aria-label="关闭">${icon('close')}</button></div><div class="dialog-body">${content}<p class="form-error" id="community-form-error" hidden></p></div>`; modal.showModal(); }
function join() { if (!data.currentUser?.registered) loginFor('certification'); else hooks.navigate('certification'); }
function newTopic() {
  if (!data.currentUser?.registered) { hooks.toast('请先登录账户，再发起查证。'); loginFor('community'); return; }
  showModal('发起一个公开查证议题', `<form id="topic-form"><p class="dialog-intro">适合生活传言、科学常识、出行规则等公开问题。先用元宝搜索找到来源，再建立议题邀请大家评议。</p><div class="form-field"><label for="topic-category">问题分类</label><select id="topic-category" name="category">${categories.map(c => `<option>${c}</option>`).join('')}</select></div><div class="form-field"><label for="topic-query">具体说法或待核查问题</label><textarea id="topic-query" name="query" minlength="5" maxlength="500" required placeholder="说明想核查的说法、时间或适用条件，避开个人相关消息。"></textarea></div><label class="checkbox-row"><input type="checkbox" name="publicConsent" required>问题、搜索结果和我的昵称将进入本机共享广场。</label><p class="field-help">发布会发起 1 次元宝搜索；没有可引用来源时不会建立议题。使用你已配置的服务版本与密钥，搜索范围为全网。</p><div class="dialog-actions"><button class="text-button" type="button" data-community="close">取消</button><button class="primary-button" type="submit">搜索来源并建立议题</button></div></form>`);
}
async function refresh(quiet = false) {
  if (busy) { if (!quiet) hooks.toast('请先等待正在进行的共享操作完成。'); return; }
  try { const response = await fetch('/api/community'); const result = await response.json(); if (!response.ok) throw Error(result.error); data = result; loaded = true; error = ''; if (!quiet && ['community', 'public-topic', 'resources', 'login', 'register', 'recover', 'account', 'certification', 'admin'].includes(hooks.state().view)) hooks.render(); }
  catch (err) { error = err.message || '暂时无法读取共享资料。'; loaded = true; if (!quiet) hooks.render(); }
}
async function mutate(route, body) {
  if (busy) throw Error('还有一个共享操作在进行，请稍后。');
  busy = true; controller = new AbortController();
  const status = document.createElement('p'); status.className = 'community-working'; status.setAttribute('role', 'status'); status.textContent = ['topics', 'search'].includes(route) ? '正在向元宝搜索查找公开来源，请稍候…' : '正在保存到共享空间…'; (modal.open ? modal.querySelector('.dialog-body') : document.querySelector('#main')).append(status);
  document.querySelectorAll('#community-dialog button[type=submit], #review-form button[type=submit]').forEach(b => { b.disabled = true; });
  try { data = await hooks.api('/api/community/' + route, body, controller.signal); loaded = true; error = ''; }
  finally { status.remove(); busy = false; controller = null; document.querySelectorAll('#community-dialog button[type=submit], #review-form button[type=submit]').forEach(b => { b.disabled = false; }); }
}
function searchKey() {
  if (!hooks.hasSearch()) { if (modal.open) modal.close(); hooks.toast('请先连接元宝搜索，再发布或补查。'); hooks.openSettings(); return false; }
  if (hooks.state().busy || hooks.state().monitorBusy) { hooks.toast('请先等待正在进行的调查结束。'); return false; }
  return true;
}
function exportTopic(t) {
  const rows = ['# 有据 · 公众查证报告', '', '问题：' + t.query, '类型：' + t.category, '证据版本：' + t.revision, '', '本机共享空间的参与记录，不是认证结论。意见人数不代表真伪。', '', '## 搜索证据', ...t.sources.flatMap(s => ['', '### ' + s.id + ' ' + s.title, s.url, s.snippet || '', '页面标注时间：' + (s.publishedAt || '未提供')]), '', '## 公众评议', ...t.reviews.flatMap(r => ['', (r.author?.nickname || '参与者') + '（社区身份不等于官方专业资质） · ' + labels[r.stance] + ' · 证据版本 ' + r.revision, r.reason, '引用：' + r.sourceIds.join('、')]), '', '## 检索轨迹', ...t.searches.flatMap(s => [s.query, '请求编号：' + s.requestId + ' · ' + s.searchedAt])];
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = '有据公众查证报告.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function initCommunity(options) {
  hooks = options; app = document.querySelector('#app'); modal = document.createElement('dialog'); modal.id = 'community-dialog'; modal.className = 'dialog'; document.body.append(modal);
  initAccounts({ data: () => data, setData: result => { data = result; }, api: hooks.api, render: hooks.render, navigate: hooks.navigate, toast: hooks.toast, refresh });
  refresh().then(() => { if (hooks.state().view === 'home' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !modal.open) hooks.render(); });
  document.addEventListener('input', event => { if (event.target.id === 'community-search') { keyword = event.target.value; document.querySelector('#topic-results').innerHTML = topicList(data.topics.filter(t => (filter === '全部' || t.category === filter) && t.query.toLowerCase().includes(keyword.toLowerCase()))); } });
  document.addEventListener('submit', async event => {
    if (!['member-form', 'topic-form', 'review-form', 'report-form'].includes(event.target.id)) return;
    event.preventDefault(); const form = event.target, values = new FormData(form);
    try {
      if (form.id === 'member-form') await mutate('profile', { nickname: values.get('nickname'), interests: values.get('interests'), pledge: values.get('pledge') === 'on' });
      if (form.id === 'topic-form') { if (!searchKey()) return; if (values.get('publicConsent') !== 'on') throw Error('请确认进入共享广场。'); await mutate('topics', { query: values.get('query'), category: values.get('category'), tier: hooks.state().settings.tier, apiKey: hooks.state().keys.search }); }
      if (form.id === 'review-form') { const t = topic(form.dataset.topic); await mutate('reviews', { topicId: t.id, revision: t.revision, stance: values.get('stance'), reason: values.get('reason'), sourceIds: values.getAll('sourceIds') }); }
      if (form.id === 'report-form') await mutate('report', { topicId: form.dataset.topic, reason: values.get('reason') });
      if (modal.open) modal.close();
      if (form.id === 'topic-form' && data.topicId) hooks.navigate('topic/' + data.topicId); else hooks.render();
      hooks.toast(form.id === 'report-form' ? '异议已登记；尚未经过人工核验。' : form.id === 'member-form' ? '志愿身份已保存，欢迎带着证据参与。' : '已保存，可在共享议题中查看。');
    } catch (err) { const message = modal.open ? modal.querySelector('#community-form-error') : null; if (message) { message.hidden = false; message.textContent = err.message; } else hooks.toast(err.message, 6500); }
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-community]'); if (!button) return;
    try {
      switch (button.dataset.community) {
        case 'join': join(); break;
        case 'new-topic': newTopic(); break;
        case 'close': if (busy) { hooks.toast('请求仍在进行，已发出的搜索可能计入用量。'); controller?.abort(); } modal.close(); break;
        case 'refresh': await refresh(); break;
        case 'filter': filter = button.dataset.filter; hooks.render(); break;
        case 'example': { const card = examples[Number(button.dataset.index)]; hooks.state().draft = card.query; hooks.navigate('home'); hooks.render(); document.querySelector('#question')?.focus(); break; }
        case 'resource-search': { const resource = resources[Number(button.dataset.index)]; hooks.state().settings.site = resource.domain; hooks.state().filters = true; hooks.state().draft = ''; hooks.navigate('home'); hooks.toast('已限定 ' + resource.domain + '，输入问题后再搜索。'); break; }
        case 'load-images': { const media = button.closest('.source-media'); media.querySelectorAll('img[data-src]').forEach(img => { img.src = img.dataset.src; img.addEventListener('error', () => { img.hidden = true; const note = document.createElement('span'); note.className = 'image-unavailable'; note.textContent = '图片未能加载，可打开原图或来源页面'; img.after(note); }, { once: true }); }); button.remove(); break; }
        case 'citation': event.preventDefault(); document.querySelector('#public-source-' + CSS.escape(button.dataset.source))?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
        case 'search-topic': { if (!data.currentUser?.registered) { loginFor(location.hash.slice(1)); break; } if (!searchKey()) break; const t = topic(button.dataset.topic); if (!confirm('将用元宝搜索补查此议题，发起 1 次请求，结果进入共享议题。继续吗？')) break; await mutate('search', { topicId: t.id, query: t.query, tier: hooks.state().settings.tier, apiKey: hooks.state().keys.search }); hooks.render(); hooks.toast(data.evidenceChanged ? '已补查到变化的证据，旧评议标记为待复核。' : '本次未发现来源内容变化，保留原证据版本与评议。'); break; }
        case 'withdraw': if (confirm('撤回你的评议？之后仍可重新提交。')) { await mutate('withdraw', { topicId: button.dataset.topic }); hooks.render(); } break;
        case 'report': if (!data.currentUser?.registered) { loginFor(location.hash.slice(1)); break; } showModal('登记议题异议', `<form id="report-form" data-topic="${e(button.dataset.topic)}"><p class="dialog-intro">说明来源失效、断章取义或范围不合适等问题。异议只登记为待核验，不会自动认定真假或声称已完成审核。</p><div class="form-field"><label for="report-reason">问题说明</label><textarea id="report-reason" name="reason" minlength="8" maxlength="500" required></textarea></div><button class="primary-button" type="submit">登记异议</button></form>`); break;
        case 'logout': await mutate('logout', {}); modal.close(); hooks.navigate('login'); hooks.render(); break;
        case 'export-topic': exportTopic(topic(button.dataset.topic)); break;
      }
    } catch (err) { hooks.toast(err.message, 6500); }
  });
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  modal.addEventListener('cancel', event => { if (busy) { event.preventDefault(); hooks.toast('正在保存或检索，请稍后或点击关闭来停止等待。'); } });
}
