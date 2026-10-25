import { escapeHtml as e, safeLink } from './core.js';
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚无记录';

export function screenshotView(state) {
  if (!state.screenshot && !state.extracting && !state.claims.length) return '';
  const selected = state.claims.filter(c => c.selected && c.query.trim()).length;
  return `<section class="claim-panel" aria-live="polite">
    <div class="section-heading"><div><h2>从截图，追到原文</h2><p>${e(state.screenshot?.name || '提取图片中的说法')}</p></div><button class="icon-button" data-action="clear-screenshot" aria-label="清除截图">${icon('close')}</button></div>
    ${state.screenshot ? `<div class="claim-image-wrap"><img src="${e(state.screenshot.preview)}" alt="待检查的截图"><div><strong>先确认说法，再搜索证据</strong><p>图片发送至你配置的图像模型。识别出的文字可能有误，请核对原句、时间和条件。</p><p>只将你勾选的问题交给元宝搜索，每批最多 3 条。截图不会写进档案。</p></div></div>` : ''}
    ${state.extracting ? '<div class="run-status"><span class="spinner"></span>正在识别图片中的说法…</div>' : ''}
    ${state.claims.map((claim, i) => `<div class="claim-choice"><label class="claim-original"><input type="checkbox" data-claim="${i}" ${claim.selected ? 'checked' : ''}><span><strong>“${e(claim.quote)}”</strong>${claim.context ? `<small>${e(claim.context)}</small>` : ''}</span></label><label class="field-label" for="claim-query-${i}">要核查的问题 · 可以修改</label><textarea id="claim-query-${i}" data-claim-query="${i}" maxlength="500" aria-label="编辑第 ${i + 1} 条搜索问题">${e(claim.query)}</textarea></div>`).join('')}
    ${state.claimUncertainties?.length ? `<div class="unknown-note">${icon('info')}<span>${state.claimUncertainties.map(e).join('；')}</span></div>` : ''}
    ${state.claims.length ? `<div class="claim-actions"><span>已选 ${selected} 条 · 最多 ${selected * (state.mode === 'deep' ? 3 : 1)} 次搜索</span><button class="primary-button" data-action="search-claims" ${state.busy || !selected || selected > 3 ? 'disabled' : ''}>搜索所选说法${icon('arrow')}</button></div>` : ''}
  </section>`;
}

export function monitorsPage(state) {
  const active = state.monitors.filter(m => m.status === 'active').length;
  return `<div class="page-header"><div><div class="eyebrow">FOLLOW WHAT CHANGES</div><h1>有变化，再告诉你。</h1><p>让一次调查成为持续关注，保留每次变化的来处。</p></div><div class="monitor-status"><i class="status-dot"></i>${state.monitorBusy ? '正在检查' : `${active} 项每日盯梢`}</div></div>
    <div class="monitor-notice">${icon('info')}<span>电脑在线且页面保持打开时，每天按本机时间检查一次；休眠或浏览器节流可能延后，恢复后最多补查当天一次。每次额外使用 1 次元宝搜索，最多运行 30 天。仅新来源、标题或摘要变化会提醒，变化本身不代表事实得到证实。</span></div>
    <p class="field-help monitor-help">检查沿用创建时的搜索版本与范围；默认仅在当前浏览器会话保留密钥，重新打开浏览器后可能需要重新连接搜索。备份调查档案不包含盯梢记录。</p>
    ${state.monitors.length ? `<div class="monitor-list">${state.monitors.map(m => monitorView(m, state.monitorBusy)).join('')}</div>` : `<div class="empty-state">${icon('clock')}<h3>把值得关注的问题留下来</h3><p>完成一次查询后，在调查档案点击“开启每日盯梢”。<br>适合持续关注开放时间、活动规则、产品公告等公开信息。</p><a class="secondary-button" href="#history">选择一份调查 ${icon('arrow')}</a></div>`}`;
}

function monitorView(m, busy) {
  const unread = m.alerts.filter(a => !a.read).length;
  const button = (action, title, cls = 'text-button') => `<button class="${cls}" data-action="monitor-${action}" data-monitor="${e(m.id)}" ${busy ? 'disabled' : ''}>${title}</button>`;
  return `<article class="monitor-card" data-monitor-card="${e(m.id)}"><div class="monitor-card-head"><div><span class="subtle-badge ${m.status === 'active' ? 'green' : 'amber'}">${m.status === 'active' ? '每日检查中' : m.status === 'paused' ? '已暂停' : '已结束'}</span><h2>${e(m.query)}</h2></div><div class="monitor-time">${e(m.time)}<small>每天 · 本机时间</small></div></div>
    <div class="monitor-summary"><span>上次检查 <b>${e(date(m.lastCheckedAt))}</b></span><span>下次检查 <b>${m.status === 'active' ? e(date(m.nextRunAt)) : '未排期'}</b></span><span>自动结束 <b>${e(m.endDate || '未设置')}</b></span><span>累计发起 <b>${Number(m.attempted) || m.checks.length} 次</b></span></div>
    ${unread ? `<div class="monitor-alert-banner">${icon('spark')}发现 ${unread} 次未读变化</div>` : ''}
    ${m.lastError ? `<div class="error-message">最近检查失败：${e(m.lastError)}</div>` : ''}
    ${m.alerts.slice(0, 5).map(a => `<details class="monitor-alert" data-alert="${e(a.id)}"><summary>${a.changes.length} 条来源变化 · ${e(date(a.createdAt))}</summary><p class="field-help">请求编号 ${e(a.requestId || '未返回')}</p>${a.changes.map(c => `<div class="monitor-change"><strong>${c.type === 'new' ? '新来源' : '标题或摘要变化'} · ${e(c.title)}</strong>${c.previousTitle && c.previousTitle !== c.title ? `<small>上次标题：${e(c.previousTitle)}</small>` : ''}<p>${e(c.snippet || '搜索服务未提供摘要。')}</p>${c.previousSnippet ? `<small>上次摘要：${e(c.previousSnippet)}</small>` : ''}<a href="${e(safeLink(c.url))}" target="_blank" rel="noopener noreferrer">打开来源 ${icon('arrow-up-right')}</a></div>`).join('')}</details>`).join('')}
    ${m.checks.length ? `<details class="monitor-log"><summary>检查记录 · 最近 ${m.checks.length} 次</summary>${m.checks.map(c => `<div><span>${e(date(c.checkedAt))} · ${c.error ? '未完成' : `${Number(c.results) || 0} 条结果 / ${Number(c.changes) || 0} 条变化`}</span><small>${e(c.error || '检查完成')} · 请求 ${e(c.requestId || '未返回编号')}</small></div>`).join('')}</details>` : ''}
    <div class="monitor-actions">${m.status === 'active' ? button('pause', '暂停盯梢', 'secondary-button') : m.status === 'paused' ? button('resume', '恢复每日检查', 'secondary-button') : ''}${m.status !== 'ended' ? button('check', '现在检查 · 1 次搜索') + button('end', '结束盯梢') : ''}${button('delete', '删除')}<a class="text-button" href="#case/${e(m.caseId)}">原调查 ${icon('arrow')}</a></div></article>`;
}

export function comparisonView(item) {
  return `<section class="panel comparison-panel"><div class="panel-heading"><h2>${icon('link')}把不同线索摆在一起</h2><span class="subtle-badge">人工标记</span></div><p class="comparison-intro">在证据清单中标记“支持”“质疑”或“背景”，再对照原文的时间、条件和出处。这里按你的标记整理，不自动判真伪。</p><div class="comparison-grid">${[['supports', '支持线索'], ['challenges', '质疑线索'], ['context', '背景资料']].map(([type, label]) => { const sources = item.sources.filter(s => s.annotation === type); return `<div class="comparison-column ${type}"><h3>${label}<span>${sources.length}</span></h3>${sources.length ? sources.map(s => `<article><button class="citation" data-action="citation" data-source="${e(s.id)}">${e(s.id)}</button><strong>${e(s.title)}</strong><p>${e(s.snippet || '请打开原文查看。')}</p><a href="${e(safeLink(s.url))}" target="_blank" rel="noopener noreferrer">打开原文 ${icon('arrow-up-right')}</a></article>`).join('') : '<p class="comparison-empty">还没有标记这类线索</p>'}</div>`; }).join('')}</div></section>`;
}
