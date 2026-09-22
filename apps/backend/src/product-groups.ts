import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { accessRole, audit, auth, batchContext, canEditBatch, canReadBatch, type AccessRequest } from './access.js';
import { createAssetReadUrl } from './assets.js';
import { getPool } from './db/client.js';
import { rebuildProductCostLedger } from './cost-ledger.js';
import { purchaseBusinessDate } from './inventory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const cents = (v: unknown) => typeof v === 'string' && MONEY_RE.test(v) ? (() => { const [a, b = ''] = v.split('.'); const n = Number(a) * 100 + Number(b.padEnd(2, '0')); return Number.isSafeInteger(n) ? n : null; })() : null;
const money = (v: string | number) => `${Math.floor(Number(v) / 100)}.${String(Number(v) % 100).padStart(2, '0')}`;
const message = (reply: FastifyReply, code: string, text: string, status = 400) => reply.code(status).send({ code, message: text });
function templateValues(body: { name?: unknown; variants?: unknown }) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const variants = Array.isArray(body.variants) ? body.variants.map((item) => typeof item === 'object' && item ? String((item as { name?: unknown }).name ?? '').trim() : '') : [];
  if (!name || name.length > 100 || !variants.length || variants.some((value) => !value || value.length > 100) || new Set(variants.map((value) => value.toLocaleLowerCase())).size !== variants.length) return null;
  return { name, variants };
}
function allocate(total: number, parts: Array<{ userId: string; amount: number }>) {
  const output = new Map(parts.map((part) => [part.userId, 0])); const weight = parts.reduce((sum, part) => sum + part.amount, 0); let used = 0;
  for (const part of parts) { const value = Math.floor(total * part.amount / weight); output.set(part.userId, value); used += value; }
  for (const part of [...parts].sort((a, b) => a.userId.localeCompare(b.userId)).slice(0, total - used)) output.set(part.userId, (output.get(part.userId) ?? 0) + 1);
  return output;
}
type ProductGroupRow = { id: string; name: string; description: string | null; referencePrice: string | null; createdAt: string; updatedAt: string; firstObjectKey?: string | null; variants: Array<{ id: string; name: string | null; referencePrice: string | null }> };
type GroupImageRow = { assetId: string; position: number; objectKey: string };
function assetIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.length <= 5 && new Set(value).size === value.length && value.every((id) => typeof id === 'string' && UUID_RE.test(id)) ? value as string[] : null;
}
async function assertReadyAssets(client: PoolClient, workspaceId: string, ids: string[]) {
  if (!ids.length) return true;
  return (await client.query("SELECT id FROM assets WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='ready' AND deleted_at IS NULL", [workspaceId, ids])).rowCount === ids.length;
}
async function replaceGroupImages(client: PoolClient, groupId: string, workspaceId: string, ids: string[]) {
  if (!(await assertReadyAssets(client, workspaceId, ids))) return false;
  await client.query('DELETE FROM product_group_images WHERE product_group_id=$1', [groupId]);
  for (const [index, assetId] of ids.entries()) await client.query('INSERT INTO product_group_images(product_group_id,asset_id,position) VALUES($1,$2,$3)', [groupId, assetId, index + 1]);
  return true;
}
async function imageUrl(objectKey: string | null | undefined): Promise<string | null> {
  if (!objectKey) return null;
  try { return await createAssetReadUrl(objectKey); }
  catch { return null; }
}
async function presentGroup(row: ProductGroupRow, images: GroupImageRow[] = []) {
  return { ...row, firstImage: await imageUrl(row.firstObjectKey), images: await Promise.all(images.map(async (image) => ({ assetId: image.assetId, position: image.position, url: await imageUrl(image.objectKey) }))) };
}

async function workspaceAccess(request: AccessRequest, reply: FastifyReply, workspaceId: string, write = false) {
  if (!(await auth(request, reply))) return false;
  const role = await accessRole(request, workspaceId);
  if (!role) { await reply.code(404).send({ code: 'NOT_FOUND' }); return false; }
  if (write && !['owner', 'admin', 'editor'].includes(role)) { await reply.code(403).send({ code: 'FORBIDDEN' }); return false; }
  return true;
}
async function requireBatch(request: AccessRequest, reply: FastifyReply, batchId: string, write = false) {
  if (!(await auth(request, reply))) return null;
  const context = await batchContext(request, batchId);
  if (!canReadBatch(context)) { await reply.code(404).send({ code: 'NOT_FOUND' }); return null; }
  if (write && !canEditBatch(context)) { await reply.code(403).send({ code: 'FORBIDDEN' }); return null; }
  return context;
}

export async function registerProductGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>('/api/workspaces/:workspaceId/product-groups', async (request, reply) => {
    const r = request as AccessRequest; if (!(await workspaceAccess(r, reply, request.params.workspaceId))) return;
    const rows = (await getPool().query(`SELECT g.id,g.name,g.description,g.reference_price::text AS "referencePrice",g.created_at AS "createdAt",g.updated_at AS "updatedAt",cover.object_key AS "firstObjectKey",COALESCE(json_agg(json_build_object('id',p.id,'name',p.variant_name,'referencePrice',p.reference_price::text) ORDER BY p.created_at) FILTER (WHERE p.id IS NOT NULL),'[]') AS variants FROM product_groups g LEFT JOIN products p ON p.group_id=g.id LEFT JOIN LATERAL (SELECT a.object_key FROM product_group_images gi JOIN assets a ON a.id=gi.asset_id AND a.deleted_at IS NULL AND a.status='ready' WHERE gi.product_group_id=g.id ORDER BY gi.position LIMIT 1) cover ON true WHERE g.workspace_id=$1 GROUP BY g.id,cover.object_key ORDER BY g.created_at DESC`, [request.params.workspaceId])).rows as ProductGroupRow[];
    return Promise.all(rows.map(async (row) => {
      const images = (await getPool().query('SELECT gi.asset_id AS "assetId",gi.position,a.object_key AS "objectKey" FROM product_group_images gi JOIN assets a ON a.id=gi.asset_id AND a.status=\'ready\' AND a.deleted_at IS NULL WHERE gi.product_group_id=$1 ORDER BY gi.position', [row.id])).rows as GroupImageRow[];
      return presentGroup(row, images);
    }));
  });
  app.post<{ Params: { workspaceId: string }; Body: { name?: unknown; description?: unknown; referencePrice?: unknown; variants?: unknown; assetIds?: unknown } }>('/api/workspaces/:workspaceId/product-groups', async (request, reply) => {
    const r = request as AccessRequest; if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    const body = request.body ?? {}; const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = body.description === undefined || body.description === null ? null : typeof body.description === 'string' ? body.description.trim() || null : undefined;
    const referencePrice = body.referencePrice === undefined || body.referencePrice === null || body.referencePrice === '' ? null : cents(body.referencePrice);
    const variants = Array.isArray(body.variants) ? body.variants.map((item) => {
      const value = typeof item === 'object' && item ? item as { name?: unknown; referencePrice?: unknown } : {};
      const variantName = String(value.name ?? '').trim();
      const variantReferencePrice = value.referencePrice === undefined || value.referencePrice === null || value.referencePrice === '' ? null : cents(value.referencePrice);
      return { name: variantName, referencePrice: variantReferencePrice, validPrice: value.referencePrice === undefined || value.referencePrice === null || value.referencePrice === '' || variantReferencePrice !== null };
    }) : [];
    const imageIds = body.assetIds === undefined ? [] : assetIds(body.assetIds);
    if (!name || description === undefined || imageIds === null || (body.referencePrice !== undefined && body.referencePrice !== null && body.referencePrice !== '' && referencePrice === null) || variants.some((v) => !v.name || v.name.length > 100 || !v.validPrice) || new Set(variants.map((v) => v.name.toLocaleLowerCase())).size !== variants.length) return message(reply, 'INVALID_PRODUCT_GROUP', '请填写有效的商品组、不重复款式、参考价和图片');
    const client = await getPool().connect(); const id = randomUUID();
    try { await client.query('BEGIN'); await client.query('INSERT INTO product_groups(id,workspace_id,name,description,reference_price,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6)', [id, request.params.workspaceId, name, description, referencePrice === null ? null : referencePrice / 100, r.access!.id]); if (!(await replaceGroupImages(client, id, request.params.workspaceId, imageIds))) { await client.query('ROLLBACK'); return message(reply, 'INVALID_PRODUCT_GROUP_IMAGES', '商品组图片无效或尚未上传完成'); } for (const variant of variants.length ? variants : [{ name: null, referencePrice }]) await client.query('INSERT INTO products(id,workspace_id,group_id,variant_name,name,description,reference_price,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)', [randomUUID(), request.params.workspaceId, id, variant.name, variant.name ? `${name} · ${variant.name}` : name, description, variant.referencePrice === null ? null : variant.referencePrice / 100, r.access!.id]); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(request.params.workspaceId, r.access!.id, 'product_group.create', 'product_group', id, { variantCount: variants.length }); return { id };
  });
  app.patch<{ Params: { workspaceId: string; groupId: string }; Body: { name?: unknown; description?: unknown; referencePrice?: unknown; variants?: unknown; assetIds?: unknown } }>('/api/workspaces/:workspaceId/product-groups/:groupId', async (request, reply) => {
    const r = request as AccessRequest; if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    if (!UUID_RE.test(request.params.groupId)) return message(reply, 'INVALID_PRODUCT_GROUP', '商品组无效');
    const body = request.body ?? {}; const name = typeof body.name === 'string' ? body.name.trim() : ''; const description = body.description === undefined || body.description === null ? null : typeof body.description === 'string' ? body.description.trim() || null : undefined;
    const referencePrice = body.referencePrice === undefined || body.referencePrice === null || body.referencePrice === '' ? null : cents(body.referencePrice);
    const imageIds = body.assetIds === undefined ? null : assetIds(body.assetIds);
    const variants = Array.isArray(body.variants) ? body.variants.map((item) => { const value = typeof item === 'object' && item ? item as { id?: unknown; name?: unknown; referencePrice?: unknown } : {}; const variantName = String(value.name ?? '').trim(); const variantReferencePrice = value.referencePrice === undefined || value.referencePrice === null || value.referencePrice === '' ? null : cents(value.referencePrice); return { id: typeof value.id === 'string' ? value.id : null, name: variantName, referencePrice: variantReferencePrice, validPrice: value.referencePrice === undefined || value.referencePrice === null || value.referencePrice === '' || variantReferencePrice !== null }; }) : null;
    if (!name || description === undefined || imageIds === null || variants === null || (body.referencePrice !== undefined && body.referencePrice !== null && body.referencePrice !== '' && referencePrice === null) || variants.some((item) => !item.name || !item.validPrice || (item.id !== null && !UUID_RE.test(item.id))) || new Set(variants.map((item) => item.name.toLocaleLowerCase())).size !== variants.length || new Set(variants.filter((item) => item.id).map((item) => item.id)).size !== variants.filter((item) => item.id).length) return message(reply, 'INVALID_PRODUCT_GROUP', '请填写有效的商品组、款式、参考价和图片');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const current = (await client.query('SELECT id FROM product_groups WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [request.params.groupId, request.params.workspaceId])).rows[0];
      if (!current) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'NOT_FOUND' }); }
      const existing = (await client.query('SELECT id,variant_name AS "variantName" FROM products WHERE group_id=$1 AND workspace_id=$2 FOR UPDATE', [request.params.groupId, request.params.workspaceId])).rows as Array<{ id: string; variantName: string | null }>;
      const existingNamed = new Set(existing.filter((item) => item.variantName !== null).map((item) => item.id)); const unnamed = existing.find((item) => item.variantName === null); const submittedIds = new Set(variants.filter((item) => item.id).map((item) => item.id!));
      if ([...submittedIds].some((id) => !existingNamed.has(id))) { await client.query('ROLLBACK'); return message(reply, 'INVALID_PRODUCT_GROUP_VARIANT', '款式不属于该商品组'); }
      const removed = [...existingNamed].filter((id) => !submittedIds.has(id));
      if (removed.length) {
        const used = (await client.query('SELECT id FROM products p WHERE p.id=ANY($1::uuid[]) AND (EXISTS (SELECT 1 FROM inventory_purchases ip WHERE ip.product_id=p.id) OR EXISTS (SELECT 1 FROM sales s WHERE s.product_id=p.id) OR EXISTS (SELECT 1 FROM listing_variants lv WHERE lv.product_id=p.id) OR EXISTS (SELECT 1 FROM listings l WHERE l.product_id=p.id))', [removed])).rowCount;
        if (used) { await client.query('ROLLBACK'); return message(reply, 'PRODUCT_GROUP_VARIANT_IN_USE', '已有采购、上架或销售记录的款式不能删除', 409); }
        await client.query('DELETE FROM products WHERE id=ANY($1::uuid[])', [removed]);
      }
      if (unnamed && variants.length) {
        const used = (await client.query('SELECT id FROM products p WHERE p.id=$1 AND (EXISTS (SELECT 1 FROM inventory_purchases ip WHERE ip.product_id=p.id) OR EXISTS (SELECT 1 FROM sales s WHERE s.product_id=p.id) OR EXISTS (SELECT 1 FROM listings l WHERE l.product_id=p.id))', [unnamed.id])).rowCount;
        if (used) { await client.query('ROLLBACK'); return message(reply, 'PRODUCT_GROUP_VARIANT_IN_USE', '已有业务记录的无款式商品不能改为款式商品', 409); }
        await client.query('DELETE FROM products WHERE id=$1', [unnamed.id]);
      }
      await client.query('UPDATE product_groups SET name=$3,description=$4,reference_price=$5,updated_by=$6,updated_at=now() WHERE id=$1 AND workspace_id=$2', [request.params.groupId, request.params.workspaceId, name, description, referencePrice === null ? null : referencePrice / 100, r.access!.id]);
      if (!(await replaceGroupImages(client, request.params.groupId, request.params.workspaceId, imageIds))) { await client.query('ROLLBACK'); return message(reply, 'INVALID_PRODUCT_GROUP_IMAGES', '商品组图片无效或尚未上传完成'); }
      for (const variant of variants) {
        if (variant.id) await client.query('UPDATE products SET name=$3,description=$4,variant_name=$5,reference_price=$6,updated_by=$7,updated_at=now() WHERE id=$1 AND group_id=$2', [variant.id, request.params.groupId, `${name} · ${variant.name}`, description, variant.name, variant.referencePrice === null ? null : variant.referencePrice / 100, r.access!.id]);
        else await client.query('INSERT INTO products(id,workspace_id,group_id,variant_name,name,description,reference_price,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)', [randomUUID(), request.params.workspaceId, request.params.groupId, variant.name, `${name} · ${variant.name}`, description, variant.referencePrice === null ? null : variant.referencePrice / 100, r.access!.id]);
      }
      if (!variants.length) {
        if (unnamed) await client.query('UPDATE products SET name=$3,description=$4,reference_price=$5,updated_by=$6,updated_at=now() WHERE id=$1 AND group_id=$2', [unnamed.id, request.params.groupId, name, description, referencePrice === null ? null : referencePrice / 100, r.access!.id]);
        else await client.query('INSERT INTO products(id,workspace_id,group_id,variant_name,name,description,reference_price,created_by,updated_by) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$7)', [randomUUID(), request.params.workspaceId, request.params.groupId, name, description, referencePrice === null ? null : referencePrice / 100, r.access!.id]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(request.params.workspaceId, r.access!.id, 'product_group.update', 'product_group', request.params.groupId, { variantCount: variants.length }); return { id: request.params.groupId };
  });
  app.get<{ Params: { workspaceId: string } }>('/api/workspaces/:workspaceId/product-group-templates', async (request, reply) => {
    const r = request as AccessRequest; if (!(await workspaceAccess(r, reply, request.params.workspaceId))) return;
    return (await getPool().query(`SELECT t.id,t.name,t.created_at AS "createdAt",t.updated_at AS "updatedAt",COALESCE(json_agg(json_build_object('id',v.id,'name',v.name,'position',v.position) ORDER BY v.position) FILTER (WHERE v.id IS NOT NULL),'[]') AS variants FROM product_group_templates t LEFT JOIN product_group_template_variants v ON v.template_id=t.id WHERE t.workspace_id=$1 GROUP BY t.id ORDER BY t.created_at DESC`, [request.params.workspaceId])).rows;
  });
  app.post<{ Params: { workspaceId: string }; Body: { name?: unknown; variants?: unknown } }>('/api/workspaces/:workspaceId/product-group-templates', async (request, reply) => {
    const r = request as AccessRequest; if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    const value = templateValues(request.body ?? {}); if (!value) return message(reply, 'INVALID_PRODUCT_GROUP_TEMPLATE', '请填写模板名称和不重复款式');
    const client = await getPool().connect(); const id = randomUUID();
    try { await client.query('BEGIN'); await client.query('INSERT INTO product_group_templates(id,workspace_id,name,created_by,updated_by) VALUES($1,$2,$3,$4,$4)', [id, request.params.workspaceId, value.name, r.access!.id]); for (const [index, name] of value.variants.entries()) await client.query('INSERT INTO product_group_template_variants(id,template_id,name,position) VALUES($1,$2,$3,$4)', [randomUUID(), id, name, index + 1]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(request.params.workspaceId, r.access!.id, 'product_group_template.create', 'product_group_template', id, { variantCount: value.variants.length }); return { id };
  });
  app.patch<{ Params: { workspaceId: string; templateId: string }; Body: { name?: unknown; variants?: unknown } }>('/api/workspaces/:workspaceId/product-group-templates/:templateId', async (request, reply) => {
    const r = request as AccessRequest; if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    if (!UUID_RE.test(request.params.templateId)) return message(reply, 'INVALID_PRODUCT_GROUP_TEMPLATE', '组合模板无效');
    const value = templateValues(request.body ?? {}); if (!value) return message(reply, 'INVALID_PRODUCT_GROUP_TEMPLATE', '请填写模板名称和不重复款式');
    const client = await getPool().connect();
    try { await client.query('BEGIN'); const updated = await client.query('UPDATE product_group_templates SET name=$3,updated_by=$4,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id', [request.params.templateId, request.params.workspaceId, value.name, r.access!.id]); if (!updated.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'NOT_FOUND' }); } await client.query('DELETE FROM product_group_template_variants WHERE template_id=$1', [request.params.templateId]); for (const [index, name] of value.variants.entries()) await client.query('INSERT INTO product_group_template_variants(id,template_id,name,position) VALUES($1,$2,$3,$4)', [randomUUID(), request.params.templateId, name, index + 1]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(request.params.workspaceId, r.access!.id, 'product_group_template.update', 'product_group_template', request.params.templateId, { variantCount: value.variants.length }); return { id: request.params.templateId };
  });
  app.delete<{ Params: { workspaceId: string; templateId: string } }>('/api/workspaces/:workspaceId/product-group-templates/:templateId', async (request, reply) => {
    const r = request as AccessRequest; if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    if (!UUID_RE.test(request.params.templateId)) return message(reply, 'INVALID_PRODUCT_GROUP_TEMPLATE', '组合模板无效');
    const deleted = await getPool().query('DELETE FROM product_group_templates WHERE id=$1 AND workspace_id=$2 RETURNING id', [request.params.templateId, request.params.workspaceId]);
    if (!deleted.rowCount) return reply.code(404).send({ code: 'NOT_FOUND' });
    await audit(request.params.workspaceId, r.access!.id, 'product_group_template.delete', 'product_group_template', request.params.templateId); return reply.code(204).send();
  });
  app.get<{ Params: { batchId: string } }>('/api/batches/:batchId/products', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId); if (!context) return;
    return (await getPool().query(`SELECT p.id,p.name,p.group_id AS "groupId",p.variant_name AS "variantName",g.name AS "groupName",(COALESCE(ip.q,0)-COALESCE(sa.q,0)-COALESCE(ad.q,0))::int AS "availableQuantity" FROM products p LEFT JOIN product_groups g ON g.id=p.group_id LEFT JOIN (SELECT product_id,SUM(quantity)::int q FROM inventory_purchases WHERE batch_id=$1 GROUP BY product_id) ip ON ip.product_id=p.id LEFT JOIN (SELECT product_id,SUM(quantity)::int q FROM sales WHERE batch_id=$1 AND id NOT IN (SELECT sale_id FROM sale_reversals) GROUP BY product_id) sa ON sa.product_id=p.id LEFT JOIN (SELECT product_id,SUM(quantity)::int q FROM inventory_adjustments WHERE batch_id=$1 GROUP BY product_id) ad ON ad.product_id=p.id WHERE p.workspace_id=$2 ORDER BY COALESCE(g.name,p.name),p.variant_name`, [request.params.batchId, context.workspaceId])).rows;
  });
  app.post<{ Params: { batchId: string }; Body: { channelId?: unknown; payerUserId?: unknown; occurredAt?: unknown; totalCost?: unknown; costShares?: unknown; variants?: unknown; sourceUrl?: unknown; note?: unknown } }>('/api/batches/:batchId/group-purchases', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const b = request.body ?? {}; const total = cents(b.totalCost); const variants = Array.isArray(b.variants) ? b.variants as Array<{ productId?: unknown; quantity?: unknown; totalCost?: unknown }> : []; const shares = Array.isArray(b.costShares) ? b.costShares as Array<{ userId?: unknown; amount?: unknown }> : [];
    if (!UUID_RE.test(String(b.channelId ?? '')) || !UUID_RE.test(String(b.payerUserId ?? '')) || total === null || !variants.length || !shares.length || new Set(variants.map((v) => String(v.productId))).size !== variants.length || !variants.every((v) => UUID_RE.test(String(v.productId ?? '')) && Number.isInteger(v.quantity) && Number(v.quantity) > 0 && cents(v.totalCost) !== null) || !shares.every((s) => UUID_RE.test(String(s.userId ?? '')) && cents(s.amount) !== null) || shares.reduce((n, s) => n + (cents(s.amount) ?? 0), 0) !== total || variants.reduce((n, v) => n + (cents(v.totalCost) ?? 0), 0) !== total) return message(reply, 'INVALID_GROUP_PURCHASE', '款式数量、成本和承担合计无效');
    const occurredAt = typeof b.occurredAt === 'string' && !Number.isNaN(new Date(b.occurredAt).getTime()) ? new Date(b.occurredAt).toISOString() : null; if (!occurredAt) return message(reply, 'INVALID_GROUP_PURCHASE', '采购时间无效');
    const client = await getPool().connect(); const ids: string[] = [];
    try { await client.query('BEGIN'); const products = await client.query('SELECT p.id,p.group_id,p.name,p.variant_name AS "variantName",g.name AS "groupName" FROM products p LEFT JOIN product_groups g ON g.id=p.group_id WHERE p.workspace_id=$1 AND p.id=ANY($2::uuid[])', [context.workspaceId, variants.map((v) => String(v.productId))]); const channel = await client.query('SELECT id FROM manual_channels WHERE id=$1 AND workspace_id=$2', [b.channelId, context.workspaceId]); const participantIds = [String(b.payerUserId), ...shares.map((share) => String(share.userId))]; const participants = await client.query('SELECT user_id FROM batch_members WHERE batch_id=$1 AND user_id=ANY($2::uuid[])', [request.params.batchId, participantIds]); if (products.rowCount !== new Set(variants.map((v) => String(v.productId))).size || !channel.rowCount || participants.rowCount !== new Set(participantIds).size || !products.rows[0]?.group_id || new Set(products.rows.map((item: { group_id: string | null }) => item.group_id)).size !== 1) { await client.query('ROLLBACK'); return message(reply, 'INVALID_GROUP_PURCHASE', '款式、渠道或参与人不属于当前批次'); } const productMap = new Map(products.rows.map((item: { id: string; name: string; groupName: string | null; variantName: string | null }) => [item.id, item])); for (const v of variants) { const id = randomUUID(); ids.push(id); const variantCost = cents(v.totalCost)!; const product = productMap.get(String(v.productId))!; await client.query('INSERT INTO inventory_purchases(id,batch_id,product_id,channel_id,payer_user_id,quantity,total_cost_cents,purchased_on,occurred_at,source_url,note,product_name_snapshot,product_group_name_snapshot,variant_name_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [id, request.params.batchId, v.productId, b.channelId, b.payerUserId, v.quantity, variantCost, purchaseBusinessDate(occurredAt), occurredAt, typeof b.sourceUrl === 'string' ? b.sourceUrl.trim() || null : null, typeof b.note === 'string' ? b.note.trim() || null : null, product.name, product.groupName, product.variantName, r.access!.id]); for (const [userId, amount] of allocate(variantCost, shares.map((share) => ({ userId: String(share.userId), amount: cents(share.amount)! })))) await client.query('INSERT INTO purchase_cost_shares(purchase_id,user_id,amount_cents) VALUES($1,$2,$3)', [id, userId, amount]); await rebuildProductCostLedger(client, request.params.batchId, String(v.productId)); } await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'inventory.group_purchase.create', 'inventory_purchase', ids[0], { purchaseCount: ids.length, totalCost: money(total) }); return { purchaseIds: ids };
  });
}
