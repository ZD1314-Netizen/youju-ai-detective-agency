export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function safeLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function createCase(query, mode, origin = null) {
  return {
    id: globalThis.crypto.randomUUID(), query: String(query).trim(), mode,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    status: 'running', sources: [], steps: [], verdict: 'pending', notes: '', ai: null, attempted: 0, origin
  };
}

export function blockedTopic(query) {
  const text = String(query ?? '');
  if (/(政治|时政|选举|政党|竞选|总统选举|市长选举|政要|政治人物)/i.test(text)) return '政治或时政';
  if (/(个人隐私|个人消息|私生活|住址|家庭住址|手机号|手机号码|身份证号|身份证号码|行踪|定位记录|私聊|聊天记录|通讯录|个人行程|私人照片|未经同意.*个人)/i.test(text)) return '涉及个人隐私';
  return '';
}

export function nextMonitorTime(time, from = new Date()) {
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) throw new Error('请选择有效的本机提醒时间。');
  const [hours, minutes] = time.split(':').map(Number);
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function monitorSources(sources) {
  const unique = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || !safeLink(source.url)) continue;
    const url = safeLink(source.canonical) || safeLink(source.url);
    unique.set(url, { url, title: String(source.title || '').slice(0, 500), snippet: String(source.snippet || '').slice(0, 1800) });
    if (unique.size >= 50) break;
  }
  return [...unique.values()];
}

export function cleanMonitors(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 30).flatMap(item => {
    if (!item || typeof item.id !== 'string' || typeof item.query !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.time) || !['active', 'paused', 'ended'].includes(item.status)) return [];
    const monitor = { ...item, query: item.query.slice(0, 1500), baseline: monitorSources(item.baseline), notification: item.notification === true, options: searchOptions(item.options), checks: (Array.isArray(item.checks) ? item.checks : []).filter(c => c && typeof c === 'object').slice(0, 30), alerts: [] };
    monitor.alerts = (Array.isArray(item.alerts) ? item.alerts : []).filter(a => a && Array.isArray(a.changes)).slice(0, 30).map(a => ({ ...a, changes: a.changes.filter(c => c && safeLink(c.url)).slice(0, 50) }));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.endDate || '') || !Number.isFinite(Date.parse(item.endDate)) || !Number.isFinite(Date.parse(item.nextRunAt))) monitor.status = 'paused';
    return [monitor];
  });
}

export function searchOptions(settings = {}) {
  return { tier: settings?.tier === 'standard' ? 'standard' : 'lite', site: String(settings?.site || '').slice(0, 300), freshness: String(settings?.freshness || '').slice(0, 10), industry: String(settings?.industry || '').slice(0, 30), count: Math.max(1, Math.min(50, Number(settings?.count) || 10)) };
}

export function createMonitor(query, sources, time = '09:00', caseId = '') {
  if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) throw new Error('请选择有效的本机提醒时间。');
  const baseline = monitorSources(sources);
  return { id: globalThis.crypto.randomUUID(), query: String(query).trim(), caseId, time, createdAt: new Date().toISOString(), lastCheckedAt: '', nextRunAt: nextMonitorTime(time), status: 'active', baseline, checks: [], alerts: [], lastError: '' };
}

export function compareMonitorResults(monitor, sources, requestId = '', checkedAt = new Date().toISOString()) {
  const previous = new Map((monitor.baseline || []).map(source => [source.url, source]));
  const current = monitorSources(sources);
  const changes = current.flatMap(source => {
    const old = previous.get(source.url);
    if (!old) return [{ type: 'new', ...source }];
    return old.title !== source.title || old.snippet !== source.snippet ? [{ type: 'updated', ...source, previousTitle: old.title, previousSnippet: old.snippet }] : [];
  });
  monitor.lastCheckedAt = checkedAt;
  monitor.nextRunAt = nextMonitorTime(monitor.time, new Date(checkedAt));
  monitor.lastError = '';
  monitor.checks.unshift({ checkedAt, requestId: String(requestId || '').slice(0, 200), results: current.length, changes: changes.length });
  monitor.checks = monitor.checks.slice(0, 30);
  if (current.length) monitor.baseline = current;
  if (changes.length) {
    monitor.alerts.unshift({ id: globalThis.crypto.randomUUID(), createdAt: checkedAt, requestId: String(requestId || '').slice(0, 200), changes, read: false });
    monitor.alerts = monitor.alerts.slice(0, 30);
  }
  return changes;
}

export function nextStep(item, index, options = {}) {
  // Leave room for follow-up terms within the upstream UTF-8 query limit.
  let followupBase = '';
  for (const char of item.query) { if (new TextEncoder().encode(followupBase + char).length > 1300) break; followupBase += char; }
  if (index === 0) return { title: '寻找第一手线索', query: item.query, site: options.site || '', description: '先查问题本身，保留原始搜索摘要。' };
  const memory = /剧情|电影|片名|出品方|动画|电视剧|找一部/.test(item.query);
  const rules = /规则|开放|闭馆|预约|门票|营业|截止|办理|公告|政策|资格|退票/.test(item.query);
  const claim = /真假|真的|传言|谣言|靠谱吗|是真的吗|耗电|塑料瓶|重复使用/.test(item.query);
  const focus = memory ? ['核对剧情与作品信息', '原始资料 官方简介 剧情 片名 出品方', '同名作品 相似剧情 区别', '核对作品原始简介与出品资料，避免只按相似剧情猜片名。']
    : rules ? ['核对公告、日期与例外', '原始资料 官方公告 适用日期 预约 例外', '节假日 特殊安排 最新公告', '把开放规则、适用时间和特殊安排分别核对。']
      : claim ? ['追查原句的依据与条件', '原始资料 原始出处 研究 实验 适用条件', '反例 辟谣 适用条件 研究局限', '补查主张的出处、研究条件与限制，不把转述次数当作证据。']
        : ['补查依据与适用条件', '原始资料 官方说明 适用条件', '反例 争议 补充说明', '补查规则、背景与例外，避免只看一句话。'];
  if (index === 1) return { title: focus[0], query: `${followupBase} ${focus[1]}`, site: options.site || '', description: focus[3] };
  // Pick actual domains encountered in prior rounds, not a hard-coded exclusion.
  const domains = [...new Set(item.sources.map(s => s.domain).filter(d => /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(d)))].slice(0, 3);
  return {
    title: '换来源交叉检索', query: `${followupBase} ${focus[2]}`,
    site: options.site || (domains.length ? `exclude:${domains.join('|')}` : ''),
    description: options.site ? '在指定站点内进一步查找不同解释。' : domains.length ? `排除前两轮中的 ${domains.join('、')}，寻找其他来源。` : '寻找其他解释与相反线索。'
  };
}

export function mergeEvidence(item, result, round) {
  const existing = new Map(item.sources.map(s => [s.canonical || s.url, s]));
  for (const source of result.sources || []) {
    if (!safeLink(source.url)) continue;
    const key = source.canonical || source.url;
    const old = existing.get(key);
    if (old) {
      old.rounds = [...new Set([...(old.rounds || []), round])];
      if ((source.content?.length || 0) > (old.content?.length || 0)) old.content = source.content;
      if (!old.pictures?.length && source.pictures?.length) old.pictures = source.pictures;
    } else {
      const next = { ...source, id: `S${item.sources.length + 1}`, rounds: [round], annotation: 'unreviewed', favorite: false, openedAt: '' };
      item.sources.push(next); existing.set(key, next);
    }
  }
  item.updatedAt = new Date().toISOString();
}

export const verdictNames = { pending: '尚待核对', supported: '证据支持', mixed: '存在分歧', unknown: '暂不能确认' };
export const annotationNames = { unreviewed: '待判断', supports: '支持线索', challenges: '质疑线索', context: '背景资料' };

export function statistics(item) {
  return {
    sources: item.sources.length,
    domains: new Set(item.sources.map(s => s.domain)).size,
    calls: item.steps.filter(s => s.status === 'done').length,
    opened: item.sources.filter(s => s.openedAt).length,
    reviewed: item.sources.filter(s => s.annotation !== 'unreviewed').length,
    saved: item.sources.filter(s => s.favorite).length
  };
}

export function reportMarkdown(item) {
  const stats = statistics(item);
  const date = new Date(item.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const lines = [
    `# 有据调查报告`, '', `**问题**：${item.query}`, '',
    `调查时间：${date}（北京时间）`, `检索服务：元宝搜索`,
    `调查方式：${item.mode === 'deep' ? '三轮追查' : '快速检索'}`,
    `状态：${item.status === 'complete' ? '已完成检索' : item.status === 'cancelled' ? '已停止，含部分结果' : item.status === 'failed' ? '未完成' : '含部分结果'}`,
    `搜索成功 ${stats.calls} 轮，证据 ${stats.sources} 条，涉及 ${stats.domains} 个域名。域名数量不等于独立信源数量。`, '',
    '## 调查结论', '', `人工判断：${verdictNames[item.verdict] || verdictNames.pending}`, '',
    item.notes || '尚未填写人工结论；现有搜索结果只能作为核对线索。', '',
    item.ai ? '## AI 证据归纳' : '## 搜索摘要摘录', ''
  ];
  if (item.origin?.type === 'screenshot') lines.splice(4, 0, `线索来自截图：${item.origin.screenshotName || '未命名截图'}`, `图片中的原句（识别后由用户确认）：${item.origin.quote}`, `可见背景：${item.origin.context || '未提供'}`, '仅保留确认后的文字，截图本身不包含在档案中。', '');
  const findings = item.ai?.findings || item.sources.filter(s => s.snippet).slice(0, 4).map(s => ({ text: s.snippet.slice(0, 500), sourceIds: [s.id] }));
  for (const finding of findings) lines.push(`- ${finding.text} ${finding.sourceIds.map(id => `[${id}]`).join(' ')}`, '');
  if (!findings.length) lines.push('未获得可用摘要，暂不能确认。', '');
  lines.push('## 尚未确认', '');
  for (const note of (item.ai?.uncertainties?.length ? item.ai.uncertainties : [
    '搜索摘要可能省略上下文，需要打开原文核对条件、时间和完整表述。',
    '不同网站可能转述同一材料，多个域名不代表已经交叉验证。'
  ])) lines.push(`- ${note}`);
  lines.push('', '## 证据目录', '');
  for (const s of item.sources) {
    lines.push(`### [${s.id}] ${s.title}`, '', `来源：${s.site || s.domain}`, `原文：${s.url}`,
      `页面标注时间：${s.publishedAt || '未提供'}`, `出现轮次：${(s.rounds || []).join('、')}`,
      `人工标记：${annotationNames[s.annotation] || annotationNames.unreviewed}`, '',
      `> ${(s.snippet || '搜索服务未提供摘要。').replace(/\n/g, '\n> ')}`, '');
  }
  lines.push('## 检索轨迹', '');
  item.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title} — ${s.status === 'done' ? '完成' : s.status === 'cancelled' ? '已停止' : s.status === 'failed' ? '失败' : '未完成'}`,
      `   - 搜索词：${s.query}`, `   - 站点范围：${s.site || '全网'}`,
      `   - 请求 ID：${s.requestId || '未获得'}`, `   - 结果数：${s.count ?? 0}`);
    if (s.error) lines.push(`   - 说明：${s.error}`);
  });
  lines.push('', '---', '由有据 AI 侦探社整理。报告保留检索记录与来源链接；搜索摘要、AI 归纳和人工判断分别列出。相关度不是可信度，不把检索完成当作事实已确认。');
  return lines.join('\n');
}

export function cleanImportedCase(raw) {
  if (!raw || typeof raw.query !== 'string' || raw.query.length > 1500 || !Array.isArray(raw.sources) || !Array.isArray(raw.steps)) return null;
  const item = createCase(raw.query, raw.mode === 'deep' ? 'deep' : 'quick');
  const importedIds = new Map();
  item.createdAt = Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : item.createdAt;
  item.status = ['complete', 'cancelled', 'failed'].includes(raw.status) ? raw.status : 'cancelled';
  item.notes = String(raw.notes || '').slice(0, 10000);
  item.verdict = Object.hasOwn(verdictNames, raw.verdict) ? raw.verdict : 'pending';
  item.imported = true;
  if (raw.origin?.type === 'screenshot') item.origin = { type: 'screenshot', screenshotName: String(raw.origin.screenshotName || '').slice(0, 250), quote: String(raw.origin.quote || '').slice(0, 500), context: String(raw.origin.context || '').slice(0, 350) };
  item.searchOptions = searchOptions(raw.searchOptions);
  item.sources = raw.sources.slice(0, 150).flatMap((s, i) => {
    if (!s || typeof s !== 'object') return [];
    const url = safeLink(s.url);
    if (!url) return [];
    importedIds.set(String(s.id || `S${i + 1}`), `S${i + 1}`);
    const pictures = (Array.isArray(s.pictures) ? s.pictures : []).slice(0, 4).filter(p => p && safeLink(p.url).startsWith('https:')).map(p => ({ url: safeLink(p.url), caption: String(p.caption || '').slice(0, 200) }));
    return [{ id: `S${i + 1}`, url, canonical: url, title: String(s.title || '').slice(0, 500), snippet: String(s.snippet || '').slice(0, 2200), content: String(s.content || '').slice(0, 6500), site: String(s.site || '').slice(0, 150), domain: new URL(url).hostname.replace(/^www\./, ''), publishedAt: String(s.publishedAt || '').slice(0, 100), pictures, annotation: Object.hasOwn(annotationNames, s.annotation) ? s.annotation : 'unreviewed', favorite: Boolean(s.favorite), rounds: Array.isArray(s.rounds) ? s.rounds.filter(n => Number.isInteger(n) && n > 0 && n < 10) : [], openedAt: '' }];
  });
  item.steps = raw.steps.slice(0, 6).filter(s => s && typeof s === 'object').map(s => ({ title: String(s.title || '').slice(0, 150), query: String(s.query || '').slice(0, 1500), site: String(s.site || '').slice(0, 300), status: ['done', 'failed', 'cancelled'].includes(s.status) ? s.status : 'cancelled', requestId: String(s.requestId || '').slice(0, 200), count: Number.isInteger(s.count) ? Math.max(0, s.count) : 0, error: String(s.error || '').slice(0, 1000), description: String(s.description || '').slice(0, 1000) }));
  if (raw.ai && Array.isArray(raw.ai.findings)) {
    const findings = raw.ai.findings.slice(0, 6).flatMap(f => {
      if (!f || typeof f.text !== 'string') return [];
      const sourceIds = [...new Set((Array.isArray(f.sourceIds) ? f.sourceIds : []).map(id => importedIds.get(String(id))).filter(Boolean))];
      return sourceIds.length ? [{ text: f.text.slice(0, 1000), sourceIds }] : [];
    });
    if (findings.length) item.ai = { findings, status: 'unknown', uncertainties: (Array.isArray(raw.ai.uncertainties) ? raw.ai.uncertainties : []).slice(0, 5).map(s => String(s).slice(0, 500)) };
  }
  // Imported material is a separate archive and never counts as a live contest query.
  return item;
}
