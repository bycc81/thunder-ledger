import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.js';
import { SESSION_COOKIE_NAME } from './auth-session.js';
import { getPool } from './db/client.js';

type Role = 'owner' | 'admin' | 'editor' | 'viewer';
type RequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: Record<string, unknown>;
};

const roles: Role[] = ['owner', 'admin', 'editor', 'viewer'];
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/thunderledger_role_test') {
  throw new Error('role regression refuses to run unless DATABASE_URL targets thunderledger_role_test');
}

process.env.SESSION_SECRET ||= 'role-regression-session-secret';
process.env.SESSION_COOKIE_SECURE = 'false';
process.env.CORS_ORIGINS = 'http://role-test.local';
process.env.ADMIN_USERNAME = 'role-regression-system-admin';

const app = await buildApp();
const pool = getPool();
const workspaceId = randomUUID();
const batchId = randomUUID();
const userIds = Object.fromEntries(roles.map((role) => [role, randomUUID()])) as Record<Role, string>;
const usernames = Object.fromEntries(roles.map((role) => [role, `role-${role}-${randomUUID().slice(0, 8)}`])) as Record<Role, string>;
const cookies = {} as Record<Role, string>;

function writeRequest(method: RequestOptions['method']): boolean {
  return method !== 'GET';
}

async function request(role: Role, options: RequestOptions) {
  return app.inject({
    ...options,
    headers: {
      cookie: cookies[role],
      ...(writeRequest(options.method) ? { origin: 'http://role-test.local' } : {}),
    },
  });
}

async function expectStatus(label: string, role: Role, options: RequestOptions, expected: number) {
  const response = await request(role, options);
  assert.equal(response.statusCode, expected, `${label} (${role}) expected ${expected}, received ${response.statusCode}: ${response.body}`);
  return response;
}

try {
  for (const role of roles) {
    await pool.query(
      'INSERT INTO users(id,username,password_hash,status,session_version) VALUES($1,$2,$3,$4,$5)',
      [userIds[role], usernames[role], 'role-regression-password-hash', 'active', 1],
    );
  }
  await pool.query('INSERT INTO workspaces(id,name,kind,created_by) VALUES($1,$2,$3,$4)', [workspaceId, '角色回归工作区', 'collaborative', userIds.owner]);
  for (const role of roles) {
    await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [workspaceId, userIds[role], role]);
  }
  await pool.query('INSERT INTO collaboration_batches(id,workspace_id,name,created_by) VALUES($1,$2,$3,$4)', [batchId, workspaceId, '角色回归批次', userIds.owner]);
  await pool.query('INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,$3)', [batchId, userIds.owner, 'owner']);
  await pool.query('INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,$3)', [batchId, userIds.admin, 'viewer']);
  await pool.query('INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,$3)', [batchId, userIds.editor, 'editor']);
  await pool.query('INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,$3)', [batchId, userIds.viewer, 'viewer']);

  for (const role of roles) {
    const token = await app.jwt.sign({ sub: userIds[role], username: usernames[role], sessionVersion: 1 }, { expiresIn: '1h' });
    cookies[role] = `${SESSION_COOKIE_NAME}=${token}`;
  }

  const productResponse = await expectStatus('create baseline product', 'owner', {
    method: 'POST',
    url: `/api/workspaces/${workspaceId}/products`,
    payload: { name: '角色回归商品', referencePrice: '20.0', assetIds: [] },
  }, 200);
  const productId = (productResponse.json() as { id: string }).id;
  const channelResponse = await expectStatus('create baseline channel', 'owner', {
    method: 'POST',
    url: `/api/batches/${batchId}/channels`,
    payload: { name: '角色回归渠道' },
  }, 200);
  const channelId = (channelResponse.json() as { id: string }).id;
  await expectStatus('create baseline purchase', 'owner', {
    method: 'POST',
    url: `/api/batches/${batchId}/purchases`,
    payload: {
      productId,
      channelId,
      payerUserId: userIds.owner,
      quantity: 100,
      totalCost: '100.0',
      costShares: [{ userId: userIds.owner, amount: '100.0' }],
      occurredAt: '2026-09-16T01:00:00.000Z',
    },
  }, 200);

  for (const role of roles) {
    await expectStatus('read workspace members', role, { method: 'GET', url: `/api/workspaces/${workspaceId}/members` }, 200);
    await expectStatus('read batch', role, { method: 'GET', url: `/api/batches/${batchId}` }, 200);
    await expectStatus('read products', role, { method: 'GET', url: `/api/workspaces/${workspaceId}/products` }, 200);
    await expectStatus('read inventory', role, { method: 'GET', url: `/api/batches/${batchId}/inventory` }, 200);
    await expectStatus('read sales', role, { method: 'GET', url: `/api/batches/${batchId}/sales` }, 200);
    const settlement = await expectStatus('read settlements', role, { method: 'GET', url: `/api/batches/${batchId}/settlements` }, 200);
    assert.equal((settlement.json() as { canManage: boolean }).canManage, role === 'owner' || role === 'admin', `settlement canManage mismatch for ${role}`);
    await expectStatus('query reports', role, {
      method: 'GET',
      url: `/api/reports?${new URLSearchParams({ workspaceId, batchId, reportType: 'inventory' })}`,
    }, 200);
    const exported = await expectStatus('export reports', role, {
      method: 'GET',
      url: `/api/reports/export?${new URLSearchParams({ workspaceId, batchId, reportType: 'inventory' })}`,
    }, 200);
    assert.match(String(exported.headers['content-type']), /^text\/csv/);
  }

  for (const role of roles) {
    const canEdit = role !== 'viewer';
    await expectStatus('create product', role, {
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/products`,
      payload: { name: `商品-${role}`, assetIds: [] },
    }, canEdit ? 200 : 403);
    await expectStatus('create batch', role, {
      method: 'POST',
      url: '/api/batches',
      payload: { workspaceId, name: `批次-${role}` },
    }, canEdit ? 200 : 403);
    await expectStatus('create purchase', role, {
      method: 'POST',
      url: `/api/batches/${batchId}/purchases`,
      payload: {
        productId,
        channelId,
        payerUserId: userIds[role],
        quantity: 2,
        totalCost: '10.0',
        costShares: [{ userId: userIds[role], amount: '10.0' }],
        occurredAt: `2026-09-16T0${roles.indexOf(role) + 2}:00:00.000Z`,
      },
    }, canEdit ? 200 : 403);
    await expectStatus('create sale', role, {
      method: 'POST',
      url: `/api/batches/${batchId}/sales`,
      payload: {
        productId,
        quantity: 1,
        totalPrice: '20.0',
        sellerUserId: userIds[role],
        occurredAt: `2026-09-16T1${roles.indexOf(role)}:00:00.000Z`,
      },
    }, canEdit ? 200 : 403);
    await expectStatus('create expense', role, {
      method: 'POST',
      url: `/api/batches/${batchId}/expenses`,
      payload: {
        type: 'custom',
        name: `费用-${role}`,
        amount: '1.0',
        payerUserId: userIds[role],
        occurredAt: `2026-09-16T1${roles.indexOf(role)}:30:00.000Z`,
      },
    }, canEdit ? 200 : 403);
  }

  for (const role of roles) {
    const canManage = role === 'owner' || role === 'admin';
    await expectStatus('manage batch', role, {
      method: 'PATCH',
      url: `/api/batches/${batchId}`,
      payload: { name: `角色回归批次-${role}` },
    }, canManage ? 200 : 403);
    await expectStatus('invite workspace member', role, {
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/invitations`,
      payload: { username: `invite-${role}-${randomUUID().slice(0, 8)}`, role: 'viewer' },
    }, canManage ? 200 : 403);
    await expectStatus('read audit', role, {
      method: 'GET',
      url: `/api/audit?${new URLSearchParams({ workspaceId })}`,
    }, canManage ? 200 : 403);
    await expectStatus('open settlement draft', role, {
      method: 'GET',
      url: `/api/batches/${batchId}/settlements/draft`,
    }, canManage ? 200 : 403);
  }

  await expectStatus('editor cannot delete batch', 'editor', { method: 'DELETE', url: `/api/batches/${batchId}` }, 403);
  await expectStatus('viewer cannot delete batch', 'viewer', { method: 'DELETE', url: `/api/batches/${batchId}` }, 403);
  const adminBatchDetail = await expectStatus('admin sees batch detail as owner', 'admin', { method: 'GET', url: `/api/batches/${batchId}` }, 200);
  assert.equal((adminBatchDetail.json() as { role: string }).role, 'owner');
  await expectStatus('owner deletes batch with business records', 'owner', { method: 'DELETE', url: `/api/batches/${batchId}` }, 200);
  assert.equal((await pool.query('SELECT deleted_at IS NOT NULL AS deleted FROM collaboration_batches WHERE id=$1', [batchId])).rows[0]?.deleted, true);

  const adminBatchId = randomUUID();
  await pool.query('INSERT INTO collaboration_batches(id,workspace_id,name,created_by) VALUES($1,$2,$3,$4)', [adminBatchId, workspaceId, '管理员删除批次', userIds.owner]);
  await pool.query('INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,$3)', [adminBatchId, userIds.owner, 'owner']);
  await expectStatus('admin deletes workspace batch', 'admin', { method: 'DELETE', url: `/api/batches/${adminBatchId}` }, 200);
  assert.equal((await pool.query('SELECT deleted_at IS NOT NULL AS deleted FROM collaboration_batches WHERE id=$1', [adminBatchId])).rows[0]?.deleted, true);

  const deleteWorkspaceId = randomUUID();
  const deleteWorkspaceBatchId = randomUUID();
  await pool.query('INSERT INTO workspaces(id,name,kind,created_by) VALUES($1,$2,$3,$4)', [deleteWorkspaceId, '删除回归工作区', 'collaborative', userIds.owner]);
  await pool.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [deleteWorkspaceId, userIds.owner, 'owner']);
  await pool.query('INSERT INTO collaboration_batches(id,workspace_id,name,created_by) VALUES($1,$2,$3,$4)', [deleteWorkspaceBatchId, deleteWorkspaceId, '已删除批次', userIds.owner]);
  await pool.query('INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,$3)', [deleteWorkspaceBatchId, userIds.owner, 'owner']);
  const management = await expectStatus('active batches are visible in workspace management', 'owner', { method: 'GET', url: `/api/workspaces/${deleteWorkspaceId}/management` }, 200);
  assert.equal((management.json() as { batchCount: number }).batchCount, 1);
  await expectStatus('owner deletes workspace with active batches', 'owner', { method: 'DELETE', url: `/api/workspaces/${deleteWorkspaceId}` }, 200);
  assert.equal((await pool.query('SELECT deleted_at IS NOT NULL AS deleted FROM workspaces WHERE id=$1', [deleteWorkspaceId])).rows[0]?.deleted, true);
  assert.equal((await pool.query('SELECT deleted_at IS NULL AS active FROM collaboration_batches WHERE id=$1', [deleteWorkspaceBatchId])).rows[0]?.active, true);

  const unauthorized = await app.inject({ method: 'GET', url: `/api/workspaces/${workspaceId}/products` });
  assert.equal(unauthorized.statusCode, 401);
  console.log('role matrix verified: owner/admin/editor/viewer');
} finally {
  await app.close();
  await pool.end();
}
