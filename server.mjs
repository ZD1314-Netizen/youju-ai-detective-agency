import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runSearch, AppError } from './lib/search.mjs';
import { summarize, extractClaims } from './lib/ai.mjs';
import { createCommunityService } from './lib/community.mjs';
import { createHotspotService } from './lib/hotspots.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const installationId = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const publicFiles = new Set(['/index.html', '/styles.css', '/atelier.css', '/walkthrough.js', '/app.js', '/core.js', '/features.js', '/community.js', '/community.css', '/account.js', '/demo-users.js', '/demo-users.css', '/hotspots.js', '/hotspots-core.js', '/hotspots.css', '/account.css', '/icons.svg', '/favicon.svg', '/art/science.svg', '/art/travel.svg', '/art/digital.svg', '/art/culture.svg']);

export function createApp(options = {}) {
  let active = 0;
  const hotspots = createHotspotService({ dataDir: options.dataDir || path.join(root, '.youju-data'), fetchImpl: options.feedFetchImpl || fetch });
  const community = createCommunityService({ dataDir: options.dataDir || path.join(root, '.youju-data'), fetchImpl: options.fetchImpl });
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const host = req.headers.host || '';
    const address = server.address();
    const port = typeof address === 'object' ? address?.port : null;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    if (!allowedHosts.includes(host)) { json(403, { error: '请从本机地址打开工作台。' }); return; }
    let url;
    try { url = new URL(req.url, `http://${host}`); } catch { json(400, { error: '地址无效。' }); return; }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(200, { app: 'youju-detective', version: '4.2.1', installationId, searchConfigured: Boolean(process.env.TENCENTCLOUD_WSA_APIKEY), pid: process.pid }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/hotspots') {
      try { json(200, await hotspots.getSnapshot()); }
      catch { json(503, { error: '实时资讯暂时无法读取，请稍后刷新。' }); }
      return;
    }
    const token = String(req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('youju_member='))?.slice(13) || '';
    if (req.method === 'GET' && url.pathname === '/api/community') {
      try { json(200, await community.snapshot(token)); }
      catch (error) { json(error.status || 500, { error: error instanceof AppError ? error.message : '共享资料暂时无法读取。' }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/community/admin') {
      try { json(200, await community.adminData(token)); }
      catch (error) { json(error.status || 500, { error: error instanceof AppError ? error.message : '审核资料读取失败。' }); }
      return;
    }
    const communityAction = /^\/api\/community\/(demo-login|register|claim|login|recover|profile|logout|password|sessions|volunteer|apply|withdraw-application|admin-bootstrap|review-application|revoke-certification|resolve-report|grant-admin|topics|search|reviews|withdraw|report)$/.exec(url.pathname)?.[1];
    if (req.method === 'POST' && (['/api/search', '/api/summarize', '/api/extract-claims'].includes(url.pathname) || communityAction)) {
      if (req.headers.origin !== `http://${host}` || !req.headers['content-type']?.startsWith('application/json')) {
        json(403, { error: '请求来源无效，请刷新工作台后重试。' }); return;
      }
      if (active >= 3) { json(429, { error: '已有查询在进行，请稍后再试。' }); return; }
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      active++;
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > (url.pathname === '/api/extract-claims' ? 5_500_000 : 180000)) throw new AppError('请求内容过大，请减少证据数量。', 413, 'TooLarge');
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('请求格式不正确。'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('请求格式不正确。');
        const result = communityAction
          ? await community.action(communityAction, body, token, controller.signal)
          : url.pathname === '/api/search'
          ? await runSearch(body, { fetchImpl: options.fetchImpl, signal: controller.signal })
          : url.pathname === '/api/extract-claims'
            ? await extractClaims(body, { fetchImpl: options.aiFetchImpl || options.fetchImpl, signal: controller.signal })
            : await summarize(body, { fetchImpl: options.aiFetchImpl || options.fetchImpl, signal: controller.signal });
        if (communityAction && Object.hasOwn(result, 'token')) res.setHeader('Set-Cookie', `youju_member=${result.token}; HttpOnly; SameSite=Strict; Path=/${result.maxAge === null ? '' : '; Max-Age=' + (result.maxAge ?? 0)}`);
        if (!res.destroyed) json(200, communityAction ? result.data : result);
      } catch (error) {
        if (!res.destroyed) json(error instanceof AppError ? error.status : 500, {
          error: error instanceof AppError ? error.message : '工作台没有完成本次请求，请重试。',
          code: error instanceof AppError ? error.code : 'InternalError',
          requestId: error instanceof AppError ? error.requestId : ''
        });
      } finally { active--; }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { json(405, { error: '不支持的请求方式。' }); return; }
    const name = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!publicFiles.has(name)) { json(404, { error: '页面不存在。' }); return; }
    try {
      const content = await readFile(path.join(root, 'public', name.slice(1)));
      res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { json(404, { error: '页面文件不存在。' }); }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--port');
  const port = Number(flag >= 0 ? process.argv[flag + 1] : process.env.PORT || 4318);
  const server = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`有据 AI 侦探社已启动：http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已被占用，请更换 --port。' : '工作台启动失败。'); process.exitCode = 1; });
}
