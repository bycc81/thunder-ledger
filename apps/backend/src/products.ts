import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { accessRole, audit, auth, canEditWorkspace, type AccessRequest } from './access.js';
import { createAssetReadUrl } from './assets.js';
import { getPool } from './db/client.js';

type ProductInput = { name?: unknown; description?: unknown; referencePrice?: unknown; assetIds?: unknown };
type ProductRow = { id: string; name: string; description: string | null; referencePrice: string | null; createdAt: string; updatedAt: string; firstObjectKey?: string | null };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function workspaceAccess(request: AccessRequest, reply: FastifyReply, workspaceId: string, write = false): Promise<boolean> {
  if (!(await auth(request, reply))) return false;
  const role = await accessRole(request, workspaceId);
  if (!role) { await reply.code(404).send({ code: 'NOT_FOUND' }); return false; }
  if (write && !canEditWorkspace(role)) { await reply.code(403).send({ code: 'FORBIDDEN' }); return false; }
  return true;
}

function parseInput(input: ProductInput, requireName: boolean): { value?: { name?: string; description?: string | null; referencePrice?: string | null; assetIds?: string[] }; message?: string } {
  const value: { name?: string; description?: string | null; referencePrice?: string | null; assetIds?: string[] } = {};
  if (requireName || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) return { message: '请填写商品名称' };
    value.name = input.name.trim();
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') return { message: '商品描述无效' };
    value.description = input.description.trim() || null;
  }
  if (input.referencePrice !== undefined) {
    if (input.referencePrice === null || input.referencePrice === '') value.referencePrice = null;
    else if (typeof input.referencePrice !== 'string' || !/^\d+(\.\d)?$/.test(input.referencePrice)) return { message: '参考价必须为非负金额，最多一位小数' };
    else value.referencePrice = input.referencePrice;
  }
  if (input.assetIds !== undefined) {
    if (!Array.isArray(input.assetIds) || input.assetIds.length > 5 || new Set(input.assetIds).size !== input.assetIds.length || input.assetIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) return { message: '商品图片无效，最多五张' };
    value.assetIds = input.assetIds as string[];
  }
  return { value };
}

async function assertReadyAssets(client: PoolClient, workspaceId: string, assetIds: string[]): Promise<boolean> {
  if (!assetIds.length) return true;
  const result = await client.query("SELECT id FROM assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='ready' AND deleted_at IS NULL", [workspaceId, assetIds]);
  return result.rowCount === assetIds.length;
}

async function replaceImages(client: PoolClient, productId: string, workspaceId: string, assetIds: string[]): Promise<boolean> {
  if (!(await assertReadyAssets(client, workspaceId, assetIds))) return false;
  await client.query('DELETE FROM product_images WHERE product_id=$1', [productId]);
  for (const [index, assetId] of assetIds.entries()) await client.query('INSERT INTO product_images(product_id,asset_id,position) VALUES($1,$2,$3)', [productId, assetId, index + 1]);
  return true;
}

async function imageUrl(objectKey: string | null | undefined): Promise<string | null> { return objectKey ? createAssetReadUrl(objectKey) : null; }
async function presentProduct(row: ProductRow, images: Array<{ assetId: string; position: number; objectKey: string }> = []) {
  return { id: row.id, name: row.name, description: row.description, referencePrice: row.referencePrice, createdAt: row.createdAt, updatedAt: row.updatedAt, firstImage: await imageUrl(row.firstObjectKey), images: await Promise.all(images.map(async (image) => ({ assetId: image.assetId, position: image.position, url: await imageUrl(image.objectKey) }))) };
}

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string }; Querystring: { q?: string } }>('/api/workspaces/:workspaceId/products', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await workspaceAccess(r, reply, request.params.workspaceId))) return;
    const query = request.query.q?.trim() ?? '';
    const rows = (await getPool().query(`SELECT p.id,p.name,p.description,p.reference_price::text AS "referencePrice",p.created_at AS "createdAt",p.updated_at AS "updatedAt",cover.object_key AS "firstObjectKey"
      FROM products p LEFT JOIN LATERAL (SELECT a.object_key FROM product_images pi JOIN assets a ON a.id=pi.asset_id AND a.deleted_at IS NULL AND a.status='ready' WHERE pi.product_id=p.id ORDER BY pi.position LIMIT 1) cover ON true
      WHERE p.workspace_id=$1 AND ($2='' OR p.name ILIKE '%' || $2 || '%') ORDER BY p.created_at DESC`, [request.params.workspaceId, query])).rows as ProductRow[];
    try { return await Promise.all(rows.map((row) => presentProduct(row))); }
    catch { return reply.code(503).send({ code: 'STORAGE_NOT_CONFIGURED', message: '图片存储尚未配置' }); }
  });

  app.get<{ Params: { workspaceId: string; productId: string } }>('/api/workspaces/:workspaceId/products/:productId', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await workspaceAccess(r, reply, request.params.workspaceId))) return;
    const row = (await getPool().query(`SELECT p.id,p.name,p.description,p.reference_price::text AS "referencePrice",p.created_at AS "createdAt",p.updated_at AS "updatedAt",cover.object_key AS "firstObjectKey"
      FROM products p LEFT JOIN LATERAL (SELECT a.object_key FROM product_images pi JOIN assets a ON a.id=pi.asset_id AND a.deleted_at IS NULL AND a.status='ready' WHERE pi.product_id=p.id ORDER BY pi.position LIMIT 1) cover ON true
      WHERE p.id=$1 AND p.workspace_id=$2`, [request.params.productId, request.params.workspaceId])).rows[0] as ProductRow | undefined;
    if (!row) return reply.code(404).send({ code: 'NOT_FOUND' });
    const images = (await getPool().query("SELECT pi.asset_id AS \"assetId\",pi.position,a.object_key AS \"objectKey\" FROM product_images pi JOIN assets a ON a.id=pi.asset_id AND a.status='ready' AND a.deleted_at IS NULL WHERE pi.product_id=$1 ORDER BY pi.position", [row.id])).rows as Array<{ assetId: string; position: number; objectKey: string }>;
    try { return await presentProduct(row, images); }
    catch { return reply.code(503).send({ code: 'STORAGE_NOT_CONFIGURED', message: '图片存储尚未配置' }); }
  });

  app.post<{ Params: { workspaceId: string }; Body: ProductInput }>('/api/workspaces/:workspaceId/products', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    const parsed = parseInput(request.body ?? {}, true);
    if (!parsed.value) return reply.code(400).send({ code: 'INVALID_PRODUCT', message: parsed.message });
    const client = await getPool().connect(); const id = randomUUID();
    try {
      await client.query('BEGIN');
      const row = (await client.query('INSERT INTO products(id,workspace_id,name,description,reference_price,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id,name,description,reference_price::text AS "referencePrice",created_at AS "createdAt",updated_at AS "updatedAt"', [id, request.params.workspaceId, parsed.value.name, parsed.value.description ?? null, parsed.value.referencePrice ?? null, r.access!.id])).rows[0] as ProductRow;
      if (!(await replaceImages(client, id, request.params.workspaceId, parsed.value.assetIds ?? []))) { await client.query('ROLLBACK'); return reply.code(400).send({ code: 'INVALID_PRODUCT_IMAGES', message: '商品图片无效或尚未上传完成' }); }
      await client.query('COMMIT');
      await audit(request.params.workspaceId, r.access!.id, 'product.create', 'product', id, { fields: ['name', 'description', 'referencePrice', 'assetIds'] });
      return presentProduct(row);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });

  app.patch<{ Params: { workspaceId: string; productId: string }; Body: ProductInput }>('/api/workspaces/:workspaceId/products/:productId', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    const parsed = parseInput(request.body ?? {}, false);
    if (!parsed.value || !Object.keys(parsed.value).length) return reply.code(400).send({ code: 'INVALID_PRODUCT', message: parsed.message ?? '未提供可更新字段' });
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const current = (await client.query('SELECT id,name,description,reference_price::text AS "referencePrice" FROM products WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [request.params.productId, request.params.workspaceId])).rows[0] as { id: string; name: string; description: string | null; referencePrice: string | null } | undefined;
      if (!current) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'NOT_FOUND' }); }
      if (parsed.value.assetIds && !(await replaceImages(client, current.id, request.params.workspaceId, parsed.value.assetIds))) { await client.query('ROLLBACK'); return reply.code(400).send({ code: 'INVALID_PRODUCT_IMAGES', message: '商品图片无效或尚未上传完成' }); }
      const row = (await client.query('UPDATE products SET name=$3,description=$4,reference_price=$5,updated_by=$6,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id,name,description,reference_price::text AS "referencePrice",created_at AS "createdAt",updated_at AS "updatedAt"', [current.id, request.params.workspaceId, parsed.value.name ?? current.name, parsed.value.description ?? current.description, parsed.value.referencePrice === undefined ? current.referencePrice : parsed.value.referencePrice, r.access!.id])).rows[0] as ProductRow;
      await client.query('COMMIT');
      await audit(request.params.workspaceId, r.access!.id, 'product.update', 'product', current.id, { fields: Object.keys(parsed.value) });
      const images = (await getPool().query("SELECT pi.asset_id AS \"assetId\",pi.position,a.object_key AS \"objectKey\" FROM product_images pi JOIN assets a ON a.id=pi.asset_id AND a.status='ready' AND a.deleted_at IS NULL WHERE pi.product_id=$1 ORDER BY pi.position", [current.id])).rows as Array<{ assetId: string; position: number; objectKey: string }>;
      return presentProduct(row, images);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
}
