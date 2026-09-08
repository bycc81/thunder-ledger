import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPool } from './db/client.js';

type Claims = { sub?: string; username?: string; role?: string; sessionVersion?: number };
export type AccessRequest = FastifyRequest & { access?: { id: string; username: string; superAdmin: boolean } };
type Req = AccessRequest;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isDatabaseUser(access: Req['access']): boolean { return Boolean(access?.id && UUID_RE.test(access.id)); }
function rejectLegacyAccount(request: Req, reply: FastifyReply): boolean {
  if (isDatabaseUser(request.access)) return false;
  void reply.code(403).send({ code: 'DATABASE_ACCOUNT_REQUIRED', message: '请使用已注册的数据库用户账号' });
  return true;
}

export async function auth(request: Req, reply: FastifyReply): Promise<boolean> {
  try {
    await request.jwtVerify(); const c = request.user as Claims; if (!c.sub) throw new Error('missing subject');
    if (UUID_RE.test(c.sub)) { const row = (await getPool().query('SELECT username,status,session_version FROM users WHERE id=$1', [c.sub])).rows[0]; if (!row || row.status !== 'active' || c.sessionVersion !== row.session_version) throw new Error('inactive user'); request.access = { id: c.sub, username: row.username, superAdmin: row.username === (process.env.ADMIN_USERNAME ?? 'admin') }; }
    else if (c.sub === (process.env.ADMIN_USERNAME ?? 'admin') && c.role === 'admin') {
      const name = process.env.ADMIN_USERNAME ?? 'admin'; const hash = process.env.ADMIN_PASSWORD_HASH;
      if (!hash || hash.includes('replace-with-a-bcrypt-hash')) throw new Error('admin password is not configured');
      let row: { id: string; status: string; session_version: number } | undefined;
      try {
        const pool = getPool();
        row = (await pool.query('SELECT id,status,session_version FROM users WHERE username=$1', [name])).rows[0] as typeof row;
        if (!row) {
          await pool.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3) ON CONFLICT (username) DO NOTHING', [randomUUID(), name, hash]);
          row = (await pool.query('SELECT id,status,session_version FROM users WHERE username=$1', [name])).rows[0] as typeof row;
        }
      } catch {
        // 数据库不可用时只保留启动管理员的临时兼容，业务接口仍会因数据库不可用而失败。
        request.access = { id: c.sub, username: name, superAdmin: true };
        return true;
      }
      if (!row || row.status !== 'active' || c.sessionVersion !== row.session_version) throw new Error('inactive admin');
      request.access = { id: row.id, username: name, superAdmin: true };
    }
    else throw new Error('legacy session is not supported');
    return true;
  }
  catch { await reply.code(401).send({ code: 'UNAUTHORIZED', message: '请先登录' }); return false; }
}
async function role(userId: string, workspaceId: string): Promise<string | null> {
  if (!UUID_RE.test(userId) || !UUID_RE.test(workspaceId)) return null;
  const r = await getPool().query('SELECT wm.role FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id AND w.deleted_at IS NULL WHERE wm.workspace_id=$1 AND wm.user_id=$2', [workspaceId, userId]); return r.rows[0]?.role ?? null;
}
export async function accessRole(request: Req, workspaceId: string): Promise<string | null> { return request.access?.superAdmin ? 'owner' : role(request.access?.id ?? '', workspaceId); }
export async function audit(workspaceId: string | null, actor: string | null, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  await getPool().query('INSERT INTO audit_logs(id,workspace_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), workspaceId, actor, action, entityType, entityId, JSON.stringify(metadata)]);
}
function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
function validUsername(value: unknown): value is string { return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 120; }
function validPassword(value: unknown): value is string { return typeof value === 'string' && value.trim().length >= 8 && value.trim().length <= 64; }
function isSystemAdminUsername(username: string): boolean { return username === (process.env.ADMIN_USERNAME ?? 'admin'); }
async function createUserWithPersonalWorkspace(username: string, password: string) {
  const pool = getPool(); const client = await pool.connect(); const id = randomUUID(); const personalId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [id, username, await bcrypt.hash(password, 12)]);
    await client.query('INSERT INTO workspaces(id,name,kind,created_by) VALUES($1,$2,$3,$4)', [personalId, `${username} 的个人空间`, 'personal', id]);
    await client.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [personalId, id, 'owner']);
    await client.query('COMMIT');
    return { id, personalId };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
function canManage(r: string | null) { return r === 'owner' || r === 'admin'; }
export function canEditWorkspace(r: string | null) { return r === 'owner' || r === 'admin' || r === 'editor'; }
export type BatchContext = { workspaceId: string; batchRole: string | null; workspaceRole: string | null };
export async function batchContext(request: Req, batchId: string): Promise<BatchContext | null> {
  const row = (await getPool().query('SELECT workspace_id FROM collaboration_batches WHERE id=$1 AND deleted_at IS NULL', [batchId])).rows[0] as { workspace_id: string } | undefined;
  if (!row || !request.access) return null;
  const workspaceRole = await accessRole(request, row.workspace_id);
  if (!workspaceRole) return null;
  if (request.access.superAdmin || canManage(workspaceRole)) return { workspaceId: row.workspace_id, batchRole: 'owner', workspaceRole };
  const member = (await getPool().query('SELECT role FROM batch_members WHERE batch_id=$1 AND user_id=$2', [batchId, request.access.id])).rows[0] as { role: string } | undefined;
  return { workspaceId: row.workspace_id, batchRole: member?.role ?? null, workspaceRole };
}
export function canReadBatch(context: BatchContext | null) { return Boolean(context?.batchRole); }
export function canEditBatch(context: BatchContext | null) { return Boolean(context && (context.batchRole === 'owner' || context.batchRole === 'editor')); }
function canManageBatch(context: Awaited<ReturnType<typeof batchContext>>) { return Boolean(context && context.batchRole === 'owner'); }

export async function registerAccessRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { token?: string } }>('/api/auth/register/preview', async (request, reply) => {
    const token = request.body?.token;
    if (!token) return reply.code(400).send({ code: 'INVITATION_INVALID', message: '邀请链接无效或已过期' });
    const invite = (await getPool().query('SELECT email_or_username FROM invitations WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()', [hashToken(token)])).rows[0] as { email_or_username: string } | undefined;
    if (!invite) return reply.code(400).send({ code: 'INVITATION_INVALID', message: '邀请链接无效或已过期' });
    return { username: invite.email_or_username };
  });
  app.post<{ Body: { token?: string; username?: string; password?: string } }>('/api/auth/register', async (request, reply) => {
    const { token, username, password } = request.body ?? {};
    if (!token || !validUsername(username) || !validPassword(password)) return reply.code(400).send({ code: 'INVALID_REGISTRATION', message: '注册信息无效' });
    const normalizedUsername = username.trim();
    const pool = getPool(); const invite = (await pool.query('SELECT * FROM invitations WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()', [hashToken(token)])).rows[0];
    if (!invite) return reply.code(400).send({ code: 'INVITATION_INVALID', message: '邀请无效或已过期' });
    if (invite.email_or_username !== normalizedUsername) return reply.code(400).send({ code: 'INVITATION_TARGET_MISMATCH', message: '邀请对象不匹配' });
    const client = await pool.connect(); const id = randomUUID();
    try { await client.query('BEGIN'); await client.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [id, normalizedUsername, await bcrypt.hash(password.trim(), 12)]); const personalId = randomUUID(); await client.query('INSERT INTO workspaces(id,name,kind,created_by) VALUES($1,$2,$3,$4)', [personalId, `${normalizedUsername} 的个人空间`, 'personal', id]); await client.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [personalId, id, 'owner']); await client.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [invite.workspace_id, id, invite.role]); await client.query('UPDATE invitations SET consumed_at=now() WHERE id=$1', [invite.id]); await client.query('COMMIT'); await audit(invite.workspace_id, id, 'account.register', 'invitation', invite.id); return { userId: id, personalWorkspaceId: personalId }; }
    catch (error: unknown) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ code: 'USERNAME_EXISTS', message: '该用户名已注册，请使用“加入已有账号”' });
      }
      throw error;
    } finally { client.release(); }
  });

  app.post<{ Body: { username?: string; password?: string; captchaId?: string; captchaCode?: string } }>('/api/auth/db-login', async (request, reply) => {
    const { username, password } = request.body ?? {}; const row = (await getPool().query('SELECT id,username,password_hash,status,session_version FROM users WHERE username=$1', [username ?? ''])).rows[0];
    if (!row || row.status !== 'active' || !password || !(await bcrypt.compare(password, row.password_hash))) return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    return { accessToken: await app.jwt.sign({ sub: row.id, username: row.username, sessionVersion: row.session_version }, { expiresIn: '8h' }) };
  });

  app.post<{ Body: { currentPassword?: string; password?: string } }>('/api/auth/password', async (request, reply) => {
    const r = request as Req; if (!(await auth(r, reply))) return;
    const { currentPassword, password } = request.body ?? {};
    if (!validPassword(password)) return reply.code(400).send({ code: 'PASSWORD_INVALID', message: '密码需要为 8–64 位' });
    const row = (await getPool().query('SELECT password_hash,session_version FROM users WHERE id=$1', [r.access!.id])).rows[0] as { password_hash: string; session_version: number } | undefined;
    if (!row || !currentPassword || !(await bcrypt.compare(currentPassword, row.password_hash))) return reply.code(400).send({ code: 'CURRENT_PASSWORD_INVALID', message: '当前密码不正确' });
    const sessionVersion = row.session_version + 1;
    await getPool().query('UPDATE users SET password_hash=$2,session_version=$3 WHERE id=$1', [r.access!.id, await bcrypt.hash(password.trim(), 12), sessionVersion]);
    await audit(null, r.access!.id, 'account.password.change', 'user', r.access!.id);
    return { accessToken: await app.jwt.sign({ sub: r.access!.id, username: r.access!.username, sessionVersion }, { expiresIn: '8h' }) };
  });

  app.get('/api/admin/accounts', async (request, reply) => {
    const r = request as Req; if (!(await auth(r, reply))) return; if (!r.access!.superAdmin) return reply.code(403).send({ code: 'FORBIDDEN' });
    const systemUsername = process.env.ADMIN_USERNAME ?? 'admin';
    return (await getPool().query('SELECT id,username,status,created_at AS "createdAt",username=$1 AS "isSystemAdmin" FROM users ORDER BY created_at DESC', [systemUsername])).rows;
  });
  app.post<{ Body: { username?: string; password?: string } }>('/api/admin/accounts', async (request, reply) => {
    const r = request as Req; if (!(await auth(r, reply))) return; if (!r.access!.superAdmin) return reply.code(403).send({ code: 'FORBIDDEN' });
    const { username, password } = request.body ?? {}; if (!validUsername(username) || !validPassword(password) || isSystemAdminUsername(username.trim())) return reply.code(400).send({ code: 'INVALID_ACCOUNT', message: '用户名或密码不符合要求' });
    try { const account = await createUserWithPersonalWorkspace(username.trim(), password.trim()); await audit(null, r.access!.id, 'account.create', 'user', account.id); return { id: account.id, username: username.trim() }; }
    catch (error: unknown) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ code: 'USERNAME_EXISTS', message: '用户名已存在' }); throw error; }
  });
  app.patch<{ Params: { id: string }; Body: { status?: string } }>('/api/admin/accounts/:id/status', async (request, reply) => {
    const r = request as Req; if (!(await auth(r, reply))) return; if (!r.access!.superAdmin) return reply.code(403).send({ code: 'FORBIDDEN' });
    const status = request.body?.status; if (!['active', 'disabled'].includes(status ?? '')) return reply.code(400).send({ code: 'INVALID_STATUS' });
    const account = (await getPool().query('SELECT username,status FROM users WHERE id=$1', [request.params.id])).rows[0] as { username: string; status: string } | undefined;
    if (!account) return reply.code(404).send({ code: 'ACCOUNT_NOT_FOUND' }); if (request.params.id === r.access!.id || isSystemAdminUsername(account.username)) return reply.code(400).send({ code: 'ACCOUNT_PROTECTED', message: '不能操作系统管理员账号' });
    await getPool().query('UPDATE users SET status=$2,session_version=session_version+1 WHERE id=$1', [request.params.id, status]); await audit(null, r.access!.id, 'account.status.update', 'user', request.params.id, { status }); return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { password?: string } }>('/api/admin/accounts/:id/password-reset', async (request, reply) => {
    const r = request as Req; if (!(await auth(r, reply))) return; if (!r.access!.superAdmin) return reply.code(403).send({ code: 'FORBIDDEN' }); const password = request.body?.password;
    if (!validPassword(password)) return reply.code(400).send({ code: 'PASSWORD_INVALID', message: '密码需要为 8–64 位' }); const account = (await getPool().query('SELECT username FROM users WHERE id=$1', [request.params.id])).rows[0] as { username: string } | undefined;
    if (!account) return reply.code(404).send({ code: 'ACCOUNT_NOT_FOUND' }); if (isSystemAdminUsername(account.username)) return reply.code(400).send({ code: 'ACCOUNT_PROTECTED', message: '不能操作系统管理员账号' });
    await getPool().query('UPDATE users SET password_hash=$2,session_version=session_version+1 WHERE id=$1', [request.params.id, await bcrypt.hash(password.trim(), 12)]); await audit(null, r.access!.id, 'account.password.reset', 'user', request.params.id); return { ok: true };
  });

  app.get('/api/workspaces', async (request, reply) => { const r = request as Req; if (!(await auth(r, reply))) return; if (r.access!.superAdmin) return (await getPool().query("SELECT w.id,w.name,w.kind,'owner' AS role FROM workspaces w WHERE w.deleted_at IS NULL ORDER BY w.name")).rows; if (rejectLegacyAccount(r, reply)) return; return (await getPool().query('SELECT w.id,w.name,w.kind,wm.role FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE wm.user_id=$1 AND w.deleted_at IS NULL ORDER BY w.name', [r.access!.id])).rows; });
  app.post<{ Body: { name?: string; kind?: 'personal'|'collaborative' } }>('/api/workspaces', async (request, reply) => { const r=request as Req; if (!(await auth(r,reply))) return; if (rejectLegacyAccount(r, reply)) return; const name=request.body?.name?.trim(); if(!name) return reply.code(400).send({code:'INVALID_WORKSPACE'}); const id=randomUUID(); await getPool().query('INSERT INTO workspaces(id,name,kind,created_by) VALUES($1,$2,$3,$4)',[id,name,request.body?.kind==='collaborative'?'collaborative':'personal',r.access!.id]); await getPool().query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)',[id,r.access!.id,'owner']); await audit(id,r.access!.id,'workspace.create','workspace',id); return {id,name}; });

  app.post<{ Params:{id:string}; Body:{username?:string; role?:string} }>('/api/workspaces/:id/invitations', async (request, reply) => { const r=request as Req; if(!(await auth(r,reply))) return; const rid=await accessRole(r,request.params.id); if(!canManage(rid)) return reply.code(403).send({code:'FORBIDDEN'}); const rawUsername=request.body?.username; const inviteRole=request.body?.role; if(!validUsername(rawUsername) || !['admin','editor','viewer'].includes(inviteRole??'')) return reply.code(400).send({code:'INVALID_INVITATION',message:'请填写用户名并选择角色'}); const username=rawUsername.trim(); if ((await getPool().query('SELECT 1 FROM users WHERE username=$1',[username])).rowCount) return reply.code(409).send({code:'USERNAME_EXISTS',message:'该用户名已注册，请使用“加入已有账号”'}); const token=randomBytes(32).toString('hex'); const id=randomUUID(); await getPool().query('INSERT INTO invitations(id,workspace_id,email_or_username,role,token_hash,expires_at,invited_by) VALUES($1,$2,$3,$4,$5,now()+interval \'7 days\',$6)',[id,request.params.id,username,inviteRole,hashToken(token),r.access!.id]); await audit(request.params.id,r.access!.id,'invitation.create','invitation',id,{role:inviteRole}); return {id,token,expiresIn:604800}; });
  app.post<{ Params:{id:string}; Body:{username?:string; role?:string} }>('/api/workspaces/:id/members/by-username', async (request, reply) => { const r=request as Req; if(!(await auth(r,reply))) return; const rid=await accessRole(r,request.params.id); if(!canManage(rid)) return reply.code(403).send({code:'FORBIDDEN'}); const rawUsername=request.body?.username; const memberRole=request.body?.role; if(!validUsername(rawUsername) || !['admin','editor','viewer'].includes(memberRole??'')) return reply.code(400).send({code:'INVALID_MEMBER',message:'请填写已注册用户名并选择角色'}); const user=(await getPool().query("SELECT id FROM users WHERE username=$1 AND status='active'",[rawUsername.trim()])).rows[0] as {id:string}|undefined; if(!user)return reply.code(404).send({code:'ACCOUNT_NOT_FOUND',message:'未找到可加入的已注册账号'}); const existing=await role(user.id,request.params.id); if(existing)return reply.code(409).send({code:'ALREADY_MEMBER',message:'该账号已是当前工作区成员'}); await getPool().query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)',[request.params.id,user.id,memberRole]); await audit(request.params.id,r.access!.id,'member.add.existing','workspace_member',user.id,{role:memberRole}); return {ok:true}; });
  app.patch<{ Params:{id:string; userId:string}; Body:{role?:string} }>('/api/workspaces/:id/members/:userId', async (request, reply) => { const r=request as Req; if(!(await auth(r,reply))) return; const rid=await accessRole(r,request.params.id); if(!canManage(rid)) return reply.code(403).send({code:'FORBIDDEN'}); if(!['admin','editor','viewer'].includes(request.body?.role??'')) return reply.code(400).send({code:'INVALID_ROLE'}); const target=await role(request.params.userId,request.params.id); if(target==='owner' || !target) return reply.code(400).send({code:'OWNER_PROTECTED'}); await getPool().query('UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2',[request.params.id,request.params.userId,request.body!.role]); await audit(request.params.id,r.access!.id,'member.role.update','workspace_member',request.params.userId,{role:request.body!.role}); return {ok:true}; });
  app.delete<{ Params:{id:string; userId:string} }>('/api/workspaces/:id/members/:userId', async (request, reply) => { const r=request as Req; if(!(await auth(r,reply))) return; const rid=await accessRole(r,request.params.id); const self = r.access?.id === request.params.userId; if(!self && !canManage(rid)) return reply.code(403).send({code:'FORBIDDEN'}); const target=await role(request.params.userId,request.params.id); if(target==='owner' || !target) return reply.code(400).send({code:'OWNER_PROTECTED'}); await getPool().query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',[request.params.id,request.params.userId]); await audit(request.params.id,r.access!.id,'member.remove','workspace_member',request.params.userId); return {ok:true}; });
  app.get<{ Params:{id:string} }>('/api/workspaces/:id/members', async (request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return; if(!await accessRole(r,request.params.id))return reply.code(403).send({code:'FORBIDDEN'}); return (await getPool().query("SELECT u.id,u.username,wm.role, (SELECT i.created_at FROM invitations i WHERE i.workspace_id=wm.workspace_id AND i.email_or_username=u.username ORDER BY i.created_at DESC LIMIT 1) AS invited_at FROM users u JOIN workspace_members wm ON wm.user_id=u.id WHERE wm.workspace_id=$1 ORDER BY wm.created_at",[request.params.id])).rows;});

  app.post<{ Body:{workspaceId?:string; name?:string} }>('/api/batches', async (request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const ws=request.body?.workspaceId;const rr=await accessRole(r,ws??'');if(!canManage(rr) && rr!=='editor' && !r.access!.superAdmin)return reply.code(403).send({code:'FORBIDDEN'});if(!ws||!request.body?.name?.trim())return reply.code(400).send({code:'INVALID_BATCH'});const id=randomUUID();await getPool().query('INSERT INTO collaboration_batches(id,workspace_id,name,created_by) VALUES($1,$2,$3,$4)',[id,ws,request.body.name.trim(),r.access!.id]);await getPool().query('INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,$3)',[id,r.access!.id,'owner']);await audit(ws,r.access!.id,'batch.create','batch',id);return {id,name:request.body.name.trim(),role:'owner'};});
  app.get<{ Querystring: { workspaceId?: string } }>('/api/batches', async (request,reply)=>{
    const r=request as Req;if(!(await auth(r,reply)))return;
    const workspaceId=request.query.workspaceId;
    if(workspaceId && !await accessRole(r,workspaceId))return reply.code(403).send({code:'FORBIDDEN'});
    if(r.access!.superAdmin){
      const params=workspaceId?[workspaceId]:[];
      const filter=workspaceId?' AND b.workspace_id=$1':'';
      return (await getPool().query(`SELECT b.id,b.workspace_id,b.name,b.status,b.created_at,'owner' AS role FROM collaboration_batches b JOIN workspaces w ON w.id=b.workspace_id AND w.deleted_at IS NULL WHERE b.deleted_at IS NULL${filter} ORDER BY b.created_at DESC`,params)).rows;
    }
    if(rejectLegacyAccount(r,reply))return;
    const params=workspaceId?[r.access!.id,workspaceId]:[r.access!.id];
    const filter=workspaceId?' AND b.workspace_id=$2':'';
    return (await getPool().query(`SELECT DISTINCT b.id,b.workspace_id,b.name,b.status,b.created_at,CASE WHEN wm.role IN ('owner','admin') THEN 'owner' ELSE m.role END AS role FROM collaboration_batches b JOIN workspaces w ON w.id=b.workspace_id AND w.deleted_at IS NULL JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$1 LEFT JOIN batch_members m ON m.batch_id=b.id AND m.user_id=$1 WHERE b.deleted_at IS NULL${filter} AND (wm.role IN ('owner','admin') OR m.user_id IS NOT NULL) ORDER BY b.created_at DESC`,params)).rows;
  });
  app.get<{ Params:{id:string} }>('/api/batches/:id', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const context=await batchContext(r,request.params.id);if(!canReadBatch(context))return reply.code(404).send({code:'NOT_FOUND'});return (await getPool().query('SELECT id,workspace_id,name,status,created_by,created_at FROM collaboration_batches WHERE id=$1 AND deleted_at IS NULL',[request.params.id])).rows[0];});
  app.get<{ Params:{id:string} }>('/api/batches/:id/members', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const context=await batchContext(r,request.params.id);if(!canReadBatch(context))return reply.code(404).send({code:'NOT_FOUND'});return (await getPool().query('SELECT u.id,u.username,m.role,m.created_at FROM batch_members m JOIN users u ON u.id=m.user_id WHERE m.batch_id=$1 ORDER BY m.created_at',[request.params.id])).rows;});
  app.patch<{ Params:{id:string}; Body:{name?:string} }>('/api/batches/:id', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const context=await batchContext(r,request.params.id);if(!canManageBatch(context))return reply.code(403).send({code:'FORBIDDEN'});const name=request.body?.name?.trim();if(!name)return reply.code(400).send({code:'INVALID_BATCH'});await getPool().query('UPDATE collaboration_batches SET name=$2 WHERE id=$1',[request.params.id,name]);await audit(context!.workspaceId,r.access!.id,'batch.update','batch',request.params.id);return {ok:true};});
  app.delete<{ Params:{id:string} }>('/api/batches/:id', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const context=await batchContext(r,request.params.id);if(!canManageBatch(context))return reply.code(403).send({code:'FORBIDDEN'});await getPool().query('UPDATE collaboration_batches SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL',[request.params.id]);await audit(context!.workspaceId,r.access!.id,'batch.delete','batch',request.params.id);return {ok:true};});
  app.post<{ Params:{id:string} }>('/api/batches/:id/close', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const context=await batchContext(r,request.params.id);if(!canManageBatch(context))return reply.code(403).send({code:'FORBIDDEN'});await getPool().query("UPDATE collaboration_batches SET status='closed' WHERE id=$1",[request.params.id]);await audit(context!.workspaceId,r.access!.id,'batch.close','batch',request.params.id);return {ok:true};});
  app.post<{ Params:{id:string}; Body:{userId?:string; role?:string} }>('/api/batches/:id/members', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const context=await batchContext(r,request.params.id);if(!canManageBatch(context))return reply.code(403).send({code:'FORBIDDEN'});if(!request.body?.userId || !['editor','viewer'].includes(request.body.role??'') || !await role(request.body.userId,context!.workspaceId))return reply.code(400).send({code:'INVALID_MEMBER'});await getPool().query('INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(batch_id,user_id) DO UPDATE SET role=$3',[request.params.id,request.body.userId,request.body.role]);await audit(context!.workspaceId,r.access!.id,'batch.member.add','batch_member',request.params.id,{userId:request.body.userId,role:request.body.role});return {ok:true};});
  app.patch<{ Params:{id:string; userId:string}; Body:{role?:string} }>('/api/batches/:id/members/:userId', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const context=await batchContext(r,request.params.id);if(!canManageBatch(context)||!['editor','viewer'].includes(request.body?.role??''))return reply.code(403).send({code:'FORBIDDEN'});await getPool().query('UPDATE batch_members SET role=$3 WHERE batch_id=$1 AND user_id=$2 AND role<>\'owner\'',[request.params.id,request.params.userId,request.body!.role]);await audit(context!.workspaceId,r.access!.id,'batch.member.role.update','batch_member',request.params.id,{userId:request.params.userId,role:request.body!.role});return {ok:true};});
  app.delete<{ Params:{id:string; userId:string} }>('/api/batches/:id/members/:userId', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const context=await batchContext(r,request.params.id);if(!canManageBatch(context))return reply.code(403).send({code:'FORBIDDEN'});await getPool().query('DELETE FROM batch_members WHERE batch_id=$1 AND user_id=$2 AND role<>\'owner\'',[request.params.id,request.params.userId]);await audit(context!.workspaceId,r.access!.id,'batch.member.remove','batch_member',request.params.id,{userId:request.params.userId});return {ok:true};});
  app.get('/api/audit', async(request,reply)=>{const r=request as Req;if(!(await auth(r,reply)))return;const ws=(request.query as {workspaceId?:string})?.workspaceId;if(!ws||!canManage(await accessRole(r,ws)))return reply.code(403).send({code:'FORBIDDEN'});return (await getPool().query('SELECT a.id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.username AS actor_username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.workspace_id=$1 ORDER BY a.created_at DESC LIMIT 200',[ws])).rows;});
}

export { role };
