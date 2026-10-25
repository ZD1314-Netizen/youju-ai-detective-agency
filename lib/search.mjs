import { blockedTopic } from '../public/core.js';
export const SEARCH_URL = 'https://api.wsa.cloud.tencent.com/SearchPro';

export class AppError extends Error {
  constructor(message, status = 400, code = 'InvalidInput', requestId = '') {
    super(message);
    Object.assign(this, { status, code, requestId });
  }
}

export function plainText(value, limit = 12000) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim().slice(0, limit);
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

export function searchParams(input) {
  const query = String(input.query ?? '').trim();
  if (!query || Buffer.byteLength(query, 'utf8') > 1500) {
    throw new AppError('请输入问题，长度不超过约 500 个汉字。');
  }
  const blocked = blockedTopic(query);
  if (blocked) throw new AppError(`本作品不处理${blocked}类问题，请改查公开规则、产品或非个人资料。`, 400, 'TopicNotSupported');
  const params = { Query: query };
  if (input.freshness) {
    if (!/^(d([1-9]|[12]\d|30)|m([1-9]|1[0-2])|y[1-5])$/.test(input.freshness)) {
      throw new AppError('时间范围格式不正确。');
    }
    params.Freshness = input.freshness;
  }
  if (input.site) {
    const site = String(input.site).trim().toLowerCase();
    const domains = site.replace(/^exclude:/, '').split('|');
    if (domains.length > (site.startsWith('exclude:') ? 5 : 1) ||
        domains.some(domain => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))) {
      throw new AppError('站点请填写域名，例如 museum.org.cn。');
    }
    params.Site = site;
  }
  // The lite tier does not accept Cnt, Mode or Industry.
  if (input.tier !== 'lite') {
    if (input.count && ![10, 20, 30, 40, 50].includes(Number(input.count))) {
      throw new AppError('搜索结果数量应为 10、20、30、40 或 50。');
    }
    params.Cnt = Number(input.count) || 10;
    if (input.industry) {
      if (!['gov', 'news', 'acad', 'finance'].includes(input.industry)) throw new AppError('不支持的搜索领域。');
      params.Industry = input.industry;
    }
  }
  return params;
}

export function normalizeResponse(data) {
  const response = data?.Response ?? data;
  if (!response || typeof response !== 'object') throw new AppError('搜索服务返回了无法识别的内容。', 502, 'BadResponse');
  if (response.Error) {
    const code = String(response.Error.Code ?? 'UpstreamError');
    const hints = [
      ['Unauthorized', '服务 API Key 未通过验证，请检查是否填错、过期或被删除。'],
      ['AuthFailure', '服务 API Key 未通过验证，请使用元宝搜索控制台里的“服务 API KEY”。'],
      ['ResourceNotFound', '元宝搜索尚未开通，或开通后还未生效。'],
      ['ResourceUnavailable', '元宝搜索服务不可用，请检查腾讯云账户和服务状态。'],
      ['RequestLimitExceeded', '搜索太频繁或已达调用限制，请稍后再试并查看控制台。'],
      ['LimitExceeded', '搜索次数已达限制，请查看腾讯云控制台。'],
      ['InvalidParameter', '搜索参数未被服务接受，请核对极速版或标准版设置。']
    ];
    const hint = hints.find(([prefix]) => code.startsWith(prefix))?.[1];
    throw new AppError(hint || '元宝搜索暂时没有完成请求，请稍后重试。', code.includes('Unauthorized') ? 401 : 502, code, response.RequestId);
  }
  if (!Array.isArray(response.Pages)) throw new AppError('元宝搜索响应缺少 Pages，暂时无法整理证据。', 502, 'BadResponse', response.RequestId);
  const sources = [];
  const seen = new Set();
  let skipped = 0;
  for (const raw of response.Pages.slice(0, 50)) {
    let item;
    try { item = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { skipped++; continue; }
    if (!item || typeof item !== 'object') { skipped++; continue; }
    const url = safeUrl(item.url ?? item.Url);
    if (!url) { skipped++; continue; }
    const canonical = new URL(url); canonical.hash = '';
    for (const name of [...canonical.searchParams.keys()]) {
      if (/^(utm_|spm$|from$)/i.test(name)) canonical.searchParams.delete(name);
    }
    if (seen.has(canonical.href)) continue;
    seen.add(canonical.href);
    sources.push({
      url, canonical: canonical.href,
      title: plainText(item.title ?? item.Title, 500) || new URL(url).hostname,
      snippet: plainText(item.passage ?? item.summary ?? item.content, 2200),
      content: plainText(item.content, 6500),
      site: plainText(item.site, 150) || new URL(url).hostname,
      domain: new URL(url).hostname.replace(/^www\./, ''),
      publishedAt: plainText(item.date, 100),
      videos: [...(Array.isArray(item.videos) ? item.videos : []), ...(item.video_url ? [{ url: item.video_url }] : []), ...(/(^|\.)(bilibili\.com|b23\.tv|youtube\.com|youtu\.be|v\.qq\.com|douyin\.com|ixigua\.com)$/.test(new URL(url).hostname) ? [{ url, title: '视频来源' }] : [])].slice(0, 4).flatMap(video => { const link = safeUrl(typeof video === 'string' ? video : video?.url); return link.startsWith('https:') ? [{ url: link, title: plainText(video?.title, 200) || '来源视频' }] : []; }),
      pictures: (Array.isArray(item.pics) ? item.pics : []).slice(0, 4).flatMap(picture => {
        const image = safeUrl(picture?.origin_url);
        return image.startsWith('https:') ? [{ url: image, caption: plainText(picture.caption, 200) }] : [];
      }),
      // A ranking score is relevance, never a probability of truth.
      relevance: Number.isFinite(Number(item.score)) ? Number(item.score) : null
    });
  }
  return {
    sources, requestId: plainText(response.RequestId, 200),
    version: plainText(response.Version, 30), message: plainText(response.Msg, 300),
    skipped, received: response.Pages.length
  };
}

export async function runSearch(input, { fetchImpl = fetch, signal } = {}) {
  const apiKey = String(input.apiKey || process.env.TENCENTCLOUD_WSA_APIKEY || '').trim();
  if (!apiKey) throw new AppError('请先在“连接搜索”里填写元宝搜索服务 API Key。', 401, 'MissingKey');
  if (/^(AKID|IKID)/i.test(apiKey)) throw new AppError('这看起来是腾讯云 SecretId。请在元宝搜索控制台的“概览 → 服务 API KEY”里创建服务密钥。', 400, 'WrongKeyType');
  if (apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new AppError('API Key 格式不正确。');
  const params = searchParams(input);
  const timeout = AbortSignal.timeout(45000);
  let response;
  try {
    response = await fetchImpl(SEARCH_URL, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(params),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
  } catch (error) {
    if (signal?.aborted) throw new AppError('本次查询已停止。', 499, 'Cancelled');
    if (timeout.aborted) throw new AppError('搜索响应超过 45 秒，请稍后重试。', 504, 'Timeout');
    throw new AppError('暂时连接不到元宝搜索，请检查网络后重试。', 502, 'NetworkError');
  }
  const text = await response.text();
  if (text.length > 6_000_000) throw new AppError('搜索响应过大，请减少结果数量。', 502, 'BadResponse');
  let data;
  try { data = JSON.parse(text); } catch {
    throw new AppError(`搜索服务没有返回 JSON（HTTP ${response.status}）。`, 502, 'BadResponse');
  }
  if (data?.Response?.Error || data?.Error) return normalizeResponse(data);
  if (!response.ok) throw new AppError(`搜索服务请求失败（HTTP ${response.status}），请检查服务和密钥。`, response.status === 401 ? 401 : 502, 'UpstreamError');
  return { ...normalizeResponse(data), query: params.Query, searchedAt: new Date().toISOString(), provider: '元宝搜索', calls: 1 };
}
