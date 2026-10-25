import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runSearch, AppError, plainText } from './search.mjs';
import { blockedTopic } from '../public/core.js';
import { createAccountService, publicProfile } from './accounts.mjs';

const categories = new Set(['生活求证', '科学常识', '出行规则', '数码产品', '文化作品']);
const stances = new Set(['supports', 'challenges', 'unknown']);
const now = () => new Date().toISOString();
const text = (value, max) => plainText(typeof value === 'string' ? value : '', max);

function requireTopic(title) {
  if (title.length < 5 || Buffer.byteLength(title) > 1500) throw new AppError('请写下 5～500 字的具体、公开可核查的问题。');
  const blocked = blockedTopic(title);
  if (blocked) throw new AppError(`本作品不处理${blocked}类问题。`, 400, 'TopicNotSupported');
}

export function createCommunityService({ dataDir, fetchImpl } = {}) {
  let data, loading, tail = Promise.resolve();
  const file = path.join(dataDir, 'community.json');
  async function read() {
    await tail;
    if (!data) {
      if (!loading) loading = (async () => {
      try {
        const loaded = JSON.parse(await readFile(file, 'utf8'));
        if (![1, 2].includes(loaded.version) || !Array.isArray(loaded.people) || !Array.isArray(loaded.topics)) throw Error('invalid store');
        loaded.version = 2; loaded.sessions ||= []; loaded.applications ||= []; loaded.audit ||= []; loaded.reports ||= [];
        for (const person of loaded.people) { person.roles ||= ['member', 'volunteer']; person.certifications ||= []; }
        data = loaded;
      } catch (error) {
        if (error.code !== 'ENOENT') throw new AppError('共享资料读取失败，请保留数据文件并检查备份。', 503, 'CommunityStoreError');
        data = { version: 2, people: [], topics: [], reports: [], sessions: [], applications: [], audit: [], adminInitialized: false };
      }
      })().catch(error => { loading = null; throw error; });
      await loading;
    }
    return data;
  }
  async function change(fn) {
    await read();
    const job = tail.then(async () => {
      const draft = structuredClone(data), result = fn(draft);
      await mkdir(dataDir, { recursive: true });
      const temp = file + '.' + randomUUID() + '.tmp';
      await writeFile(temp, JSON.stringify(draft), { mode: 0o600 });
      await rename(temp, file);
      data = draft; return result;
    });
    tail = job.catch(() => {});
    return job;
  }
  const accounts = createAccountService({ read, change, dataDir });
  const requirePerson = accounts.requirePerson;
  const findTopic = (db, id) => { const topic = db.topics.find(t => t.id === id); if (!topic) throw new AppError('没有找到这项查证。', 404, 'TopicNotFound'); return topic; };
  function publishTopic(topic, db) {
    const reviewViews = topic.reviews.filter(r => !r.withdrawn).map(review => ({ ...review, author: publicProfile(db.people.find(p => p.id === review.personId)) }));
    return { ...topic, reviews: reviewViews, creator: publicProfile(db.people.find(p => p.id === topic.personId)), reportCount: db.reports.filter(r => r.topicId === topic.id && r.status === 'unreviewed').length, resolvedReportCount: db.reports.filter(r => r.topicId === topic.id && r.status !== 'unreviewed').length };
  }
  async function snapshot(token) {
    await accounts.ensureSetup();
    const db = await read();
    return { scope: 'local-shared', ...accounts.summary(db, token), topics: db.topics.map(t => publishTopic(t, db)), members: db.people.filter(person => !person.isDemo).length, updatedAt: now() };
  }
  async function action(route, body, token, signal) {
    if (['demo-login', 'register', 'claim', 'login', 'recover', 'logout', 'profile', 'password', 'sessions', 'volunteer', 'apply', 'withdraw-application', 'admin-bootstrap', 'review-application', 'revoke-certification', 'resolve-report', 'grant-admin'].includes(route)) {
      const result = await accounts.action(route, body, token);
      return { ...result, data: { ...(await snapshot(Object.hasOwn(result, 'token') ? result.token : token)), ...(result.recoveryCode ? { recoveryCode: result.recoveryCode } : {}) } };
    }
    const db = await read(), person = requirePerson(db, token);
    if (route === 'topics' || route === 'search') {
      const question = text(body.query, 1500); requireTopic(question);
      if (route === 'topics' && !categories.has(body.category)) throw new AppError('请选择查证分类。');
      const existing = route === 'search' ? findTopic(db, body.topicId) : null;
      if (!existing && db.topics.some(t => t.query.replace(/\s/g, '') === question.replace(/\s/g, ''))) throw new AppError('这个问题已有议题，请打开原议题补充检索。', 409, 'DuplicateTopic');
      if (!existing && db.topics.length >= 100) throw new AppError('本机查证广场最多保存 100 项议题，请先导出已有议题。', 409);
      if (existing?.searches.length >= 30) throw new AppError('该议题已达到 30 次检索记录上限。', 409);
      const result = await runSearch({ query: question, tier: body.tier === 'standard' ? 'standard' : 'lite', site: body.site || '', freshness: body.freshness || '', count: 10, apiKey: body.apiKey }, { fetchImpl, signal });
      if (!result.sources.length && !existing) throw new AppError('这次没有检索到可引用来源，暂不建立公共议题。可以换一种问法后重试；已经发出的请求可能计入用量。', 422, 'NoEvidence', result.requestId);
      let topicId, evidenceChanged = false;
      await change(draft => {
        let topic;
        if (existing) topic = findTopic(draft, existing.id);
        else {
          if (draft.topics.some(t => t.query.replace(/\s/g, '') === question.replace(/\s/g, ''))) throw new AppError('另一个参与者刚刚建立了此议题，请刷新查看。', 409);
          if (draft.topics.length >= 100) throw new AppError('共享议题数量已满。', 409);
          topic = { id: randomUUID(), query: question, category: body.category, personId: person.id, createdAt: now(), updatedAt: now(), revision: 0, sources: [], searches: [], reviews: [] };
          draft.topics.unshift(topic);
        }
        if (topic.searches.length >= 30) throw new AppError('该议题的检索记录已满。', 409);
        const known = new Map(topic.sources.map(s => [s.canonical || s.url, s]));
        for (const source of result.sources) {
          const old = known.get(source.canonical || source.url);
          if (old) {
            old.searchIds = [...new Set([...(old.searchIds || []), result.requestId])];
            if (old.snippet !== source.snippet || old.title !== source.title || old.publishedAt !== source.publishedAt || JSON.stringify(old.pictures || []) !== JSON.stringify(source.pictures || [])) {
              evidenceChanged = true; old.previousSnippet = old.snippet; old.previousTitle = old.title;
              Object.assign(old, source, { id: old.id, searchIds: old.searchIds, updatedAt: result.searchedAt });
            }
          } else if (topic.sources.length < 150) {
            evidenceChanged = true;
            const next = { ...source, id: 'S' + (topic.sources.length + 1), searchIds: [result.requestId], addedAt: result.searchedAt };
            topic.sources.push(next); known.set(next.canonical || next.url, next);
          }
        }
        if (evidenceChanged) topic.revision++; topic.updatedAt = now();
        topic.searches.push({ query: question, requestId: result.requestId, searchedAt: result.searchedAt, count: result.sources.length, personId: person.id, site: body.site || '', tier: body.tier === 'standard' ? 'standard' : 'lite' });
        topicId = topic.id;
      });
      return { data: { ...(await snapshot(token)), topicId, searchRequestId: result.requestId, evidenceChanged } };
    }
    if (route === 'reviews') {
      if (!person.roles.includes('volunteer')) throw new AppError('请先在认证中心完成志愿评判官查证约定，再提交公众评议。', 403, 'VolunteerRequired');
      const reason = text(body.reason, 1800);
      if (reason.length < 25 || !stances.has(body.stance)) throw new AppError('请写至少 25 字的查证理由，并选择评议意见。');
      if (blockedTopic(reason)) throw new AppError('请只讨论公开信息与证据，不发布个人相关消息或时政内容。');
      await change(draft => {
        const topic = findTopic(draft, body.topicId);
        if (Number(body.revision) !== topic.revision) throw new AppError('来源刚有更新，请刷新议题、核对新增证据后再提交。', 409, 'EvidenceChanged');
        const ids = [...new Set(Array.isArray(body.sourceIds) ? body.sourceIds : [])].filter(id => topic.sources.some(s => s.id === id));
        if (!ids.length) throw new AppError('每条评议至少引用本议题中的一个搜索来源。');
        let review = topic.reviews.find(r => r.personId === person.id);
        const previous = review ? { stance: review.stance, reason: review.reason, sourceIds: review.sourceIds, updatedAt: review.updatedAt, revision: review.revision, withdrawn: review.withdrawn } : null;
        if (!review) { if (topic.reviews.length >= 200) throw new AppError('该议题的评议数量已满。', 409); review = { id: randomUUID(), personId: person.id, createdAt: now(), history: [] }; topic.reviews.push(review); }
        if (previous) review.history = [previous, ...review.history].slice(0, 5);
        Object.assign(review, { stance: body.stance, reason, sourceIds: ids, revision: topic.revision, updatedAt: now(), withdrawn: false });
        topic.updatedAt = now();
      });
      return { data: await snapshot(token) };
    }
    if (route === 'withdraw') {
      await change(draft => { const topic = findTopic(draft, body.topicId), review = topic.reviews.find(r => r.personId === person.id); if (!review) throw new AppError('没有可撤回的评议。'); review.withdrawn = true; review.updatedAt = now(); });
      return { data: await snapshot(token) };
    }
    if (route === 'report') {
      const reason = text(body.reason, 500);
      if (reason.length < 8) throw new AppError('请写至少 8 字的问题说明。');
      if (blockedTopic(reason)) throw new AppError('请围绕来源问题登记异议，避免发布个人隐私与时政内容。');
      await change(draft => {
        const topic = findTopic(draft, body.topicId);
        if (draft.reports.some(r => r.topicId === topic.id && r.personId === person.id)) throw new AppError('你已为该议题提交过异议。', 409);
        draft.reports.push({ id: randomUUID(), topicId: topic.id, personId: person.id, reason, createdAt: now(), status: 'unreviewed' });
        draft.reports = draft.reports.slice(-1000);
      });
      return { data: await snapshot(token) };
    }
    throw new AppError('没有这个共享操作。', 404);
  }
  return { snapshot, action, adminData: accounts.adminData, ensureSetup: accounts.ensureSetup };
}
