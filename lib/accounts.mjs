import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppError, plainText, safeUrl } from './search.mjs';
import { blockedTopic } from '../public/core.js';
import { demoUsers } from '../public/demo-users.js';
const scrypt = promisify(scryptCallback);
const stamp = () => new Date().toISOString();
const digest = value => createHash('sha256').update(String(value || '')).digest('hex');
const clean = (value, limit) => plainText(typeof value === 'string' ? value : '', limit);
export const roleLabels = { member: '社区成员', volunteer: '志愿评判官', reviewer: '社区评审员', contributor: '领域贡献者', admin: '社区管理员' };
export function publicProfile(person) {
  if (!person) return null;
  const roles = Array.isArray(person.roles) ? person.roles.filter(r => Object.hasOwn(roleLabels, r)) : ['member', 'volunteer'];
  return { id: person.id, nickname: person.nickname, interests: person.interests || '', joinedAt: person.joinedAt, roles, role: roles.includes('admin') ? 'admin' : roles.includes('contributor') ? 'contributor' : roles.includes('reviewer') ? 'reviewer' : roles.includes('volunteer') ? 'volunteer' : 'member', registered: Boolean(person.username), isDemo: Boolean(person.isDemo), certifications: (person.certifications || []).filter(c => !c.revokedAt).map(c => ({ id: c.id, type: c.type, field: c.field, approvedAt: c.approvedAt, scope: '社区材料核验，非官方或职业资质认证' })), qualification: '身份表示社区职责，不保证意见正确；专业资质未作官方认证' };
}
function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128 || !/[^\s]/.test(value)) throw new AppError('密码请使用 10～128 位字符，建议使用一段不易猜到的短语。');
  return value;
}
async function encodePassword(value) { const salt = randomBytes(16).toString('hex'); const key = await scrypt(value, salt, 64); return { salt, hash: key.toString('hex') }; }
async function matches(value, stored) {
  const safeValue = typeof value === 'string' && value.length <= 128 ? value : '';
  const key = await scrypt(safeValue, stored?.salt || 'youju-dummy-auth-salt', 64);
  const expected = stored?.hash && /^[0-9a-f]{128}$/.test(stored.hash) ? Buffer.from(stored.hash, 'hex') : Buffer.alloc(64);
  return timingSafeEqual(key, expected) && Boolean(stored?.hash);
}
function profileValues(body) {
  const nickname = clean(body.nickname, 24), interests = clean(body.interests, 120);
  if (nickname.length < 2) throw new AppError('公开昵称请填写 2～24 字。');
  if (blockedTopic(nickname + interests) || /https?:|@|1[3-9][0-9]{9}|[0-9]{15,18}/i.test(nickname + interests)) throw new AppError('昵称和关注领域请避免个人隐私、联系方式或时政内容。');
  return { nickname, interests };
}
export function createAccountService({ read, change, dataDir }) {
  const setupFile = path.join(dataDir, 'admin-setup-code.txt');
  const attempts = new Map(); let setupPromise;
  function throttle(key) {
    const at = Date.now(), old = attempts.get(key);
    if (old && old.until > at && old.count >= (key.endsWith('-all') ? 80 : 8)) throw new AppError('此操作尝试过于频繁，请 15 分钟后再试。', 429, 'AuthRateLimited');
    attempts.set(key, old && old.until > at ? { ...old, count: old.count + 1 } : { count: 1, until: at + 15 * 60000 });
    if (attempts.size > 2000) for (const [id, record] of attempts) if (record.until <= at) attempts.delete(id);
  }
  const resolve = (db, token) => {
    if (!token) return null;
    const session = (db.sessions || []).find(s => s.tokenHash === digest(token) && Date.parse(s.expiresAt) > Date.now());
    if (session) return db.people.find(p => p.id === session.personId) || null;
    return db.people.find(p => !p.username && p.tokenHash === digest(token)) || null;
  };
  const requirePerson = (db, token, registered = true) => { const person = resolve(db, token); if (!person || registered && !person.username) throw new AppError(person ? '请先把旧昵称绑定为账户，再使用此功能。' : '请先登录账户，再参与社区。', 401, 'LoginRequired'); return person; };
  const requireAdmin = (db, token) => { const person = requirePerson(db, token); if (!person.roles?.includes('admin')) throw new AppError('此功能仅向社区管理员开放。', 403, 'AdminRequired'); return person; };
  const sessionFor = (db, person, token, remember = false) => {
    db.sessions = (db.sessions || []).filter(s => s.personId !== person.id || s.tokenHash !== digest(token)).filter(s => Date.parse(s.expiresAt) > Date.now());
    const fresh = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + (remember ? 30 * 86400000 : 12 * 3600000)).toISOString();
    const personal = db.sessions.filter(s => s.personId === person.id);
    if (personal.length >= 10) { const ids = new Set(personal.slice(0, personal.length - 9).map(s => s.id)); db.sessions = db.sessions.filter(s => !ids.has(s.id)); }
    db.sessions.push({ id: randomUUID(), personId: person.id, tokenHash: digest(fresh), createdAt: stamp(), expiresAt });
    return { token: fresh, maxAge: remember ? 30 * 86400 : null };
  };
  const audit = (db, actorId, action, targetId, reason) => { db.audit ||= []; db.audit.unshift({ id: randomUUID(), actorId, action, targetId, reason, createdAt: stamp() }); db.audit = db.audit.slice(0, 1000); };
  async function ensureSetup() {
    const db = await read(); if (db.adminInitialized || db.people.some(p => p.roles?.includes('admin'))) return;
    if (!setupPromise) setupPromise = (async () => {
      await mkdir(dataDir, { recursive: true });
      try { await writeFile(setupFile, randomBytes(24).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    })().catch(e => { setupPromise = null; throw e; });
    await setupPromise;
  }
  function summary(db, token) {
    const person = resolve(db, token);
    return { auth: { adminInitialized: Boolean(db.adminInitialized || db.people.some(p => p.roles?.includes('admin'))), canClaimLegacy: Boolean(person && !person.username) }, currentUser: person ? { ...publicProfile(person), username: person.username || '', applications: (db.applications || []).filter(a => a.personId === person.id), sessionCount: (db.sessions || []).filter(s => s.personId === person.id && Date.parse(s.expiresAt) > Date.now()).length } : null };
  }
  async function adminData(token) {
    const db = await read(); requireAdmin(db, token);
    return { applications: (db.applications || []).map(a => ({ ...a, applicant: publicProfile(db.people.find(p => p.id === a.personId)), reviewer: publicProfile(db.people.find(p => p.id === a.reviewedBy)) })), reports: (db.reports || []).map(r => ({ ...r, topicQuery: db.topics.find(t => t.id === r.topicId)?.query || '议题不存在', reporter: publicProfile(db.people.find(p => p.id === r.personId)) })), audit: (db.audit || []).slice(0, 100).map(a => ({ ...a, actor: publicProfile(db.people.find(p => p.id === a.actorId)) })) };
  }
  async function action(route, body, token) {
    const db = await read();
    if (route === 'demo-login') {
      throttle('demo-login-all');
      const selected = demoUsers.find(entry => entry.id === body.demoId);
      if (!selected) throw new AppError('请选择列表中的案例用户。', 400, 'InvalidDemoUser');
      const existing = db.people.find(entry => entry.username === selected.username);
      if (existing && (existing.isDemo !== true || existing.demoId !== selected.id)) throw new AppError('案例用户名已被占用，请联系本机维护者。', 409, 'DemoConflict');
      const encoded = existing ? null : await encodePassword(randomBytes(32).toString('hex'));
      return change(draft => {
        let person = draft.people.find(entry => entry.username === selected.username);
        if (person && (person.isDemo !== true || person.demoId !== selected.id)) throw new AppError('案例用户名已被占用。', 409, 'DemoConflict');
        if (!person) {
          if (draft.people.length >= 1000) throw new AppError('本机社区账户数量已达上限。', 409);
          person = { id: randomUUID(), username: selected.username, nickname: selected.nickname, interests: selected.field, joinedAt: stamp(), roles: [...new Set(['member', ...(selected.role === 'member' ? [] : ['volunteer', selected.role])])], certifications: [], password: encoded, recoveryHash: digest(randomBytes(32).toString('hex')), isDemo: true, demoId: selected.id };
          draft.people.push(person);
        }
        // Fixed demo roles never inherit privileges from the request or an old session.
        person.roles = [...new Set(['member', ...(selected.role === 'member' ? [] : ['volunteer', selected.role])])];
        draft.sessions = (draft.sessions || []).filter(s => s.tokenHash !== digest(token));
        return sessionFor(draft, person, '', false);
      });
    }
    if (route === 'register' || route === 'claim') {
      throttle('register-all');
      const username = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]{2,31}$/.test(username)) throw new AppError('用户名使用 3～32 位小写英文字母、数字或下划线，以字母开头。');
      if (demoUsers.some(entry => entry.username === username)) throw new AppError('此用户名为案例演示保留，请使用其他用户名。', 409, 'ReservedUsername');
      const values = profileValues(body);
      if (body.agreement !== true) throw new AppError('请同意社区约定后注册。');
      if (db.people.some(p => p.username === username)) throw new AppError('这个用户名已被使用，请换一个。', 409, 'UsernameTaken');
      const legacy = route === 'claim' ? requirePerson(db, token, false) : null;
      if (legacy?.username) throw new AppError('这个身份已经绑定账户。', 409);
      if (!legacy && resolve(db, token)?.username) throw new AppError('请先退出当前账户，再注册新账户。', 409);
      const encoded = await encodePassword(password(body.password));
      const recovery = randomBytes(24).toString('hex');
      const result = await change(draft => {
        if (draft.people.some(p => p.username === username)) throw new AppError('这个用户名已被使用，请换一个。', 409, 'UsernameTaken');
        let person = legacy ? draft.people.find(p => p.id === legacy.id && !p.username && p.tokenHash === digest(token)) : null;
        if (legacy && !person) throw new AppError('旧身份状态已变化，请刷新后重试。', 409);
        if (!person) { if (draft.people.length >= 1000) throw new AppError('本机社区账户数量已达上限。', 409); person = { id: randomUUID(), joinedAt: stamp(), roles: ['member'] }; draft.people.push(person); }
        Object.assign(person, values, { username, password: encoded, recoveryHash: digest(recovery), agreementAt: stamp() }); delete person.tokenHash;
        return sessionFor(draft, person, token, body.remember === true);
      });
      return { ...result, recoveryCode: recovery };
    }
    if (route === 'login') {
      const username = String(body.username || '').trim().toLowerCase(); throttle('login-all'); throttle('login:' + username);
      const person = db.people.find(p => p.username === username);
      if (!await matches(body.password, person?.password)) throw new AppError('用户名或密码不正确。', 401, 'InvalidCredentials');
      const result = await change(draft => { const current = draft.people.find(p => p.id === person.id); if (current.password.hash !== person.password.hash) throw new AppError('账户状态已变化，请重新登录。', 409); return sessionFor(draft, current, token, body.remember === true); });
      attempts.delete('login:' + username); return result;
    }
    if (route === 'recover') {
      const username = String(body.username || '').trim().toLowerCase(); throttle('recover-all'); throttle('recover:' + username);
      const person = db.people.find(p => p.username === username);
      if (!person || !body.recoveryCode || person.recoveryHash !== digest(String(body.recoveryCode).trim())) throw new AppError('用户名或恢复码不正确。', 401, 'InvalidRecovery');
      const encoded = await encodePassword(password(body.password)), recovery = randomBytes(24).toString('hex');
      const result = await change(draft => {
        const current = draft.people.find(p => p.id === person.id);
        if (current.recoveryHash !== person.recoveryHash) throw new AppError('恢复码已失效，请使用最新恢复码。', 409);
        current.password = encoded; current.recoveryHash = digest(recovery); draft.sessions = (draft.sessions || []).filter(s => s.personId !== person.id);
        return sessionFor(draft, current, '', false);
      });
      return { ...result, recoveryCode: recovery };
    }
    if (route === 'logout') { await change(draft => { draft.sessions = (draft.sessions || []).filter(s => s.tokenHash !== digest(token)); const legacy = resolve(draft, token); if (legacy && !legacy.username) legacy.tokenHash = digest(randomBytes(32).toString('hex')); }); return { token: '', maxAge: 0 }; }
    const person = requirePerson(db, token);
    if (person.isDemo && ['profile', 'password', 'admin-bootstrap'].includes(route)) throw new AppError('案例用户使用固定演示资料；请注册自己的账户来管理个人资料与密码。', 403, 'DemoAccountFixed');
    if (route === 'profile') { const values = profileValues(body); await change(draft => Object.assign(draft.people.find(p => p.id === person.id), values)); return {}; }
    if (route === 'password') {
      throttle('password:' + person.id);
      if (!await matches(body.currentPassword, person.password)) throw new AppError('当前密码不正确。', 401);
      const encoded = await encodePassword(password(body.password));
      return change(draft => { const current = draft.people.find(p => p.id === person.id); if (current.password.hash !== person.password.hash) throw new AppError('密码状态已变化，请重新登录。', 409); current.password = encoded; draft.sessions = draft.sessions.filter(s => s.personId !== person.id); return sessionFor(draft, current, '', false); });
    }
    if (route === 'sessions') {
      await change(draft => { draft.sessions = draft.sessions.filter(s => s.personId !== person.id || s.tokenHash === digest(token)); }); return {};
    }
    if (route === 'volunteer') {
      if (body.pledge !== true) throw new AppError('请先同意引用来源、披露不确定性和回避个人消息的查证约定。');
      await change(draft => { const current = draft.people.find(p => p.id === person.id); current.roles = [...new Set([...current.roles, 'volunteer'])]; current.pledgeAt = stamp(); }); return {};
    }
    if (route === 'apply') {
      if (!['reviewer', 'contributor'].includes(body.type)) throw new AppError('请选择可申请的社区身份。');
      if (!person.roles.includes('volunteer')) throw new AppError('请先完成志愿评判官查证约定，再申请材料核验。', 403, 'VolunteerRequired');
      const field = clean(body.field, 80), statement = clean(body.statement, 2000);
      const rawLinks = Array.isArray(body.links) ? body.links : [];
      if (!rawLinks.length || rawLinks.length > 5 || rawLinks.some(value => typeof value !== 'string' || value.length > 2000 || !safeUrl(value).startsWith('https:'))) throw new AppError('请提供 1～5 个有效的 HTTPS 公开材料链接，每个不超过 2000 字符。');
      const links = [...new Set(rawLinks.map(safeUrl))];
      if (field.length < 2 || statement.length < 50 || !links.length || body.consent !== true) throw new AppError('请填写关注领域、至少 50 字的申请说明和 1～5 个 HTTPS 公开材料链接，并同意社区核验。');
      if (blockedTopic(field + statement)) throw new AppError('申请材料请围绕公开查证能力，避免时政和个人隐私内容。');
      await change(draft => {
        draft.applications ||= [];
        if (draft.applications.some(a => a.personId === person.id && a.type === body.type && ['pending', 'approved'].includes(a.status))) throw new AppError('该身份已有待审核或有效申请，请先查看当前状态。', 409);
        if (draft.applications.length >= 1000) throw new AppError('认证申请数量已达本机上限。', 409);
        draft.applications.unshift({ id: randomUUID(), personId: person.id, type: body.type, field, statement, links, status: 'pending', createdAt: stamp(), updatedAt: stamp(), reason: '' });
      }); return {};
    }
    if (route === 'withdraw-application') {
      await change(draft => { const application = draft.applications?.find(a => a.id === body.applicationId && a.personId === person.id); if (!application || application.status !== 'pending') throw new AppError('只有自己的待审核申请可以撤回。', 409); application.status = 'withdrawn'; application.updatedAt = stamp(); }); return {};
    }
    if (route === 'admin-bootstrap') {
      throttle('bootstrap-all');
      await ensureSetup();
      if (db.adminInitialized || db.people.some(p => p.roles?.includes('admin'))) throw new AppError('管理员已经初始化，请使用现有管理员账户。', 409);
      if (!await matches(body.password, person.password)) throw new AppError('当前账户密码不正确。', 401);
      let code; try { code = (await readFile(setupFile, 'utf8')).trim(); } catch { throw new AppError('本机初始化文件不可读取，请检查服务数据目录。', 503); }
      if (digest(String(body.code || '').trim()) !== digest(code)) throw new AppError('本机管理员初始化码不正确。', 403);
      await change(draft => { requirePerson(draft, token); if (draft.adminInitialized || draft.people.some(p => p.roles?.includes('admin'))) throw new AppError('管理员已初始化。', 409); draft.people.find(p => p.id === person.id).roles.push('admin'); draft.adminInitialized = true; audit(draft, person.id, 'admin-initialized', person.id, '持有本机一次性初始化码'); });
      await unlink(setupFile).catch(() => {}); return {};
    }
    if (route === 'review-application' || route === 'revoke-certification') {
      requireAdmin(db, token);
      const reason = clean(body.reason, 1000); if (reason.length < 12) throw new AppError('请填写至少 12 字的审核或撤销理由。');
      if (route === 'review-application' && !['approved', 'rejected'].includes(body.decision)) throw new AppError('请选择通过或退回申请。');
      await change(draft => {
        requireAdmin(draft, token);
        const application = draft.applications?.find(a => a.id === body.applicationId);
        if (!application) throw new AppError('没有找到申请。', 404);
        if (application.personId === person.id) throw new AppError('管理员不能审核或撤销自己的认证，请由其他管理员处理。', 403, 'SelfReviewForbidden');
        const target = draft.people.find(p => p.id === application.personId);
        if (route === 'review-application') {
          if (application.status !== 'pending') throw new AppError('申请已处理，请刷新后查看。', 409);
          application.status = body.decision;
          if (body.decision === 'approved') { target.roles = [...new Set([...target.roles, application.type])]; target.certifications ||= []; target.certifications.push({ id: application.id, type: application.type, field: application.field, approvedAt: stamp(), approvedBy: person.id }); }
        } else {
          if (application.status !== 'approved') throw new AppError('只有有效认证可以撤销。', 409);
          application.status = 'revoked'; const certification = target.certifications?.find(c => c.id === application.id); if (certification) certification.revokedAt = stamp();
          target.roles = target.roles.filter(r => r !== application.type);
        }
        Object.assign(application, { reason, reviewedBy: person.id, updatedAt: stamp() }); audit(draft, person.id, route + ':' + application.status, application.id, reason);
      }); return {};
    }
    if (route === 'resolve-report') {
      requireAdmin(db, token);
      const reason = clean(body.reason, 1000); if (reason.length < 12 || !['resolved', 'dismissed'].includes(body.decision)) throw new AppError('请选择处理结果并填写至少 12 字的依据。');
      await change(draft => { requireAdmin(draft, token); const report = draft.reports.find(r => r.id === body.reportId); if (!report || report.status !== 'unreviewed') throw new AppError('异议不存在或已经处理。', 409); Object.assign(report, { status: body.decision, resolution: reason, reviewedBy: person.id, reviewedAt: stamp() }); audit(draft, person.id, 'report:' + body.decision, report.id, reason); }); return {};
    }
    if (route === 'grant-admin') {
      requireAdmin(db, token); throttle('grant:' + person.id);
      if (!await matches(body.password, person.password)) throw new AppError('当前管理员密码不正确。', 401);
      const username = String(body.username || '').trim().toLowerCase(), reason = clean(body.reason, 1000);
      if (reason.length < 12) throw new AppError('请填写至少 12 字的授权职责和理由。');
      await change(draft => {
        requireAdmin(draft, token); const target = draft.people.find(p => p.username === username);
        if (!target) throw new AppError('没有找到该注册账户。', 404);
        if (target.isDemo) throw new AppError('案例用户不能获得管理员权限。', 403, 'DemoAdminDenied');
        if (target.roles.includes('admin')) throw new AppError('该账户已经拥有管理权限。', 409);
        target.roles.push('admin'); audit(draft, person.id, 'grant-admin', target.id, reason);
      }); return {};
    }
    throw new AppError('没有这个账户操作。', 404);
  }
  return { resolve, requirePerson, requireAdmin, summary, action, adminData, ensureSetup };
}
