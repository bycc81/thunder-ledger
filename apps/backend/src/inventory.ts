import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { accessRole, audit, auth, batchContext, canEditBatch, canReadBatch, type AccessRequest, type BatchContext } from './access.js';
import { getPool } from './db/client.js';
import { createPurchaseCorrectionAdjustments } from './settlements.js';
import { InventoryTimelineError, rebuildProductCostLedger } from './cost-ledger.js';

type CostShareInput = { userId?: unknown; amount?: unknown };
type PurchaseInput = { productId?: unknown; channelId?: unknown; payerUserId?: unknown; quantity?: unknown; totalCost?: unknown; costShares?: unknown; occurredAt?: unknown; sourceUrl?: unknown; note?: unknown; costCorrectionReason?: unknown };
type AdjustmentInput = { quantity?: unknown; reason?: unknown };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

/** 采购日期用于兼容展示，按业务时区从发生时间派生，不能直接截取 UTC 日期。 */
export function purchaseBusinessDate(occurredAt: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(occurredAt));
  const value = (name: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === name)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function isSameOccurredAt(left: string | Date, right: string): boolean {
  return new Date(left).getTime() === new Date(right).getTime();
}

export function purchaseCorrectionFixedFields(current: { channelId: string; occurredAt: string | Date }, input: { channelId: string; occurredAt: string }): string[] {
  return [
    input.channelId !== current.channelId ? '采购渠道' : null,
    !isSameOccurredAt(current.occurredAt, input.occurredAt) ? '采购时间' : null
  ].filter((field): field is string => Boolean(field));
}

function asCents(value: unknown): number | null {
  if (typeof value !== 'string' || !MONEY_RE.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}
function asMoney(value: string | number): string {
  const amount = Number(value); const sign = amount < 0 ? '-' : ''; const absolute = Math.abs(amount); return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
function message(reply: FastifyReply, code: string, text: string, status = 400) { return reply.code(status).send({ code, message: text }); }
async function requireBatch(request: AccessRequest, reply: FastifyReply, batchId: string, write = false): Promise<BatchContext | null> {
  if (!(await auth(request, reply))) return null;
  const context = await batchContext(request, batchId);
  if (!canReadBatch(context)) { await reply.code(404).send({ code: 'NOT_FOUND' }); return null; }
  if (write && !canEditBatch(context)) { await reply.code(403).send({ code: 'FORBIDDEN' }); return null; }
  if (write) {
    const batch = (await getPool().query('SELECT status FROM collaboration_batches WHERE id=$1', [batchId])).rows[0] as { status: string } | undefined;
    if (batch?.status !== 'open') { await reply.code(409).send({ code: 'BATCH_CLOSED', message: '已关闭的批次不能新增采购' }); return null; }
  }
  return context;
}
function parsePurchase(input: PurchaseInput): { value?: { productId: string; channelId: string; payerUserId: string; quantity: number; totalCostCents: number; costShares: Array<{ userId: string; amountCents: number }>; purchasedOn: string; occurredAt: string; sourceUrl: string | null; note: string | null; costCorrectionReason: string | null }; error?: string } {
  if (!UUID_RE.test(String(input.productId ?? '')) || !UUID_RE.test(String(input.channelId ?? '')) || !UUID_RE.test(String(input.payerUserId ?? ''))) return { error: '商品、渠道和付款人无效' };
  if (!Number.isInteger(input.quantity) || Number(input.quantity) <= 0) return { error: '数量必须是正整数' };
  const totalCostCents = asCents(input.totalCost);
  if (totalCostCents === null) return { error: '总成本必须是非负金额，最多两位小数' };
  if (!Array.isArray(input.costShares) || !input.costShares.length) return { error: '请填写成本由谁承担' };
  const costShares: Array<{ userId: string; amountCents: number }> = [];
  for (const share of input.costShares as CostShareInput[]) {
    const amountCents = asCents(share.amount);
    if (!UUID_RE.test(String(share.userId ?? '')) || amountCents === null) return { error: '成本承担信息无效' };
    costShares.push({ userId: String(share.userId), amountCents });
  }
  if (new Set(costShares.map((share) => share.userId)).size !== costShares.length) return { error: '同一成员只能填写一次成本承担' };
  if (costShares.reduce((sum, share) => sum + share.amountCents, 0) !== totalCostCents) return { error: '成本承担合计必须等于总成本' };
  const occurredAt = typeof input.occurredAt === 'string' && !Number.isNaN(new Date(input.occurredAt).getTime()) ? new Date(input.occurredAt).toISOString() : null;
  if (!occurredAt) return { error: '请选择采购时间' };
  if (input.sourceUrl !== undefined && input.sourceUrl !== null && (typeof input.sourceUrl !== 'string' || input.sourceUrl.length > 1000)) return { error: '来源链接无效' };
  if (input.note !== undefined && input.note !== null && (typeof input.note !== 'string' || input.note.length > 1000)) return { error: '备注无效' };
  if (input.costCorrectionReason !== undefined && input.costCorrectionReason !== null && (typeof input.costCorrectionReason !== 'string' || input.costCorrectionReason.length > 500)) return { error: '修改成本原因不能超过 500 个字' };
  return { value: { productId: String(input.productId), channelId: String(input.channelId), payerUserId: String(input.payerUserId), quantity: Number(input.quantity), totalCostCents, costShares, purchasedOn: purchaseBusinessDate(occurredAt), occurredAt, sourceUrl: typeof input.sourceUrl === 'string' && input.sourceUrl.trim() ? input.sourceUrl.trim() : null, note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null, costCorrectionReason: typeof input.costCorrectionReason === 'string' && input.costCorrectionReason.trim() ? input.costCorrectionReason.trim() : null } };
}

async function purchaseShares(purchaseIds: string[]) {
  const shares = (await getPool().query(`SELECT pcs.purchase_id AS "purchaseId",u.id AS "userId",u.username,pcs.amount_cents::text AS "amountCents" FROM purchase_cost_shares pcs JOIN users u ON u.id=pcs.user_id WHERE pcs.purchase_id=ANY($1::uuid[]) ORDER BY u.username`, [purchaseIds])).rows as Array<{ purchaseId: string; userId: string; username: string; amountCents: string }>;
  const byPurchase = new Map<string, Array<{ userId: string; username: string; amount: string }>>();
  for (const share of shares) byPurchase.set(share.purchaseId, [...(byPurchase.get(share.purchaseId) ?? []), { userId: share.userId, username: share.username, amount: asMoney(share.amountCents) }]);
  return byPurchase;
}

async function validatePurchaseReferences(client: import('pg').PoolClient, batchId: string, workspaceId: string, input: NonNullable<ReturnType<typeof parsePurchase>['value']>): Promise<boolean> {
  const product = (await client.query('SELECT id FROM products WHERE id=$1 AND workspace_id=$2', [input.productId, workspaceId])).rows[0];
  const channel = (await client.query('SELECT id FROM manual_channels WHERE id=$1 AND workspace_id=$2', [input.channelId, workspaceId])).rows[0];
  const participantIds = [input.payerUserId, ...input.costShares.map((share) => share.userId)];
  const participants = await client.query('SELECT user_id FROM batch_members WHERE batch_id=$1 AND user_id=ANY($2::uuid[])', [batchId, participantIds]);
  return Boolean(product && channel && participants.rowCount === new Set(participantIds).size);
}

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { batchId: string } }>('/api/batches/:batchId/channels', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId); if (!context) return;
    return (await getPool().query('SELECT id,name FROM manual_channels WHERE workspace_id=$1 ORDER BY lower(name)', [context.workspaceId])).rows;
  });

  app.post<{ Params: { batchId: string }; Body: { name?: unknown } }>('/api/batches/:batchId/channels', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    if (!name || name.length > 100) return message(reply, 'INVALID_CHANNEL', '请填写不超过 100 个字符的渠道名称');
    const id = randomUUID();
    try { await getPool().query('INSERT INTO manual_channels(id,workspace_id,name,created_by) VALUES($1,$2,$3,$4)', [id, context.workspaceId, name, r.access!.id]); }
    catch (error: unknown) { if ((error as { code?: string }).code === '23505') return message(reply, 'CHANNEL_EXISTS', '该渠道已存在'); throw error; }
    await audit(context.workspaceId, r.access!.id, 'inventory.channel.create', 'manual_channel', id, { name });
    return { id, name };
  });

  app.get<{ Params: { batchId: string } }>('/api/batches/:batchId/inventory', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId); if (!context) return;
    return (await getPool().query(`SELECT ip.product_id AS "productId", (array_agg(COALESCE(ip.product_name_snapshot,p.name) ORDER BY ip.occurred_at DESC,ip.created_at DESC))[1] AS "productName", (SUM(ip.quantity)-COALESCE(adj.quantity,0)-COALESCE(sale.quantity,0))::int AS "availableQuantity", (SUM(ip.total_cost_cents)-COALESCE(adj.cost,0)-COALESCE(sale.cost,0))::text AS "totalCostCents", COUNT(*)::int AS "purchaseCount"
      FROM inventory_purchases ip JOIN products p ON p.id=ip.product_id AND p.workspace_id=$2
      LEFT JOIN (SELECT product_id,SUM(quantity) AS quantity,SUM(consumed_cost_cents) AS cost FROM inventory_adjustments WHERE batch_id=$1 GROUP BY product_id) adj ON adj.product_id=ip.product_id
      LEFT JOIN (SELECT s.product_id,SUM(s.quantity) AS quantity,SUM(s.consumed_cost_cents) AS cost FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND sr.sale_id IS NULL GROUP BY s.product_id) sale ON sale.product_id=ip.product_id
      WHERE ip.batch_id=$1 GROUP BY ip.product_id,adj.quantity,adj.cost,sale.quantity,sale.cost ORDER BY MAX(ip.created_at) DESC`, [request.params.batchId, context.workspaceId])).rows
      .map((row: { productId: string; productName: string; availableQuantity: number; totalCostCents: string; purchaseCount: number }) => ({ ...row, totalCost: asMoney(row.totalCostCents) }));
  });

  app.get<{ Params: { batchId: string; productId: string } }>('/api/batches/:batchId/inventory/:productId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId); if (!context) return;
    const summary = (await getPool().query(`SELECT ip.product_id AS "productId", (array_agg(COALESCE(ip.product_name_snapshot,p.name) ORDER BY ip.occurred_at DESC,ip.created_at DESC))[1] AS "productName", (SUM(ip.quantity)-COALESCE(adj.quantity,0)-COALESCE(sale.quantity,0))::int AS "availableQuantity", (SUM(ip.total_cost_cents)-COALESCE(adj.cost,0)-COALESCE(sale.cost,0))::text AS "totalCostCents", COUNT(*)::int AS "purchaseCount"
      FROM inventory_purchases ip JOIN products p ON p.id=ip.product_id AND p.workspace_id=$3
      LEFT JOIN (SELECT SUM(quantity) AS quantity,SUM(consumed_cost_cents) AS cost FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2) adj ON true
      LEFT JOIN (SELECT SUM(s.quantity) AS quantity,SUM(s.consumed_cost_cents) AS cost FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL) sale ON true
      WHERE ip.batch_id=$1 AND ip.product_id=$2 GROUP BY ip.product_id,adj.quantity,adj.cost,sale.quantity,sale.cost`, [request.params.batchId, request.params.productId, context.workspaceId])).rows[0] as { productId: string; productName: string; availableQuantity: number; totalCostCents: string; purchaseCount: number } | undefined;
    if (!summary) return reply.code(404).send({ code: 'NOT_FOUND' });
    const purchases = (await getPool().query(`SELECT ip.id,ip.product_id AS "productId",ip.channel_id AS "channelId",ip.quantity,ip.total_cost_cents::text AS "totalCostCents",ip.occurred_at AS "occurredAt",ip.source_url AS "sourceUrl",ip.note,c.name AS "channelName",u.id AS "payerUserId",u.username AS "payerUsername"
      FROM inventory_purchases ip JOIN manual_channels c ON c.id=ip.channel_id JOIN users u ON u.id=ip.payer_user_id WHERE ip.batch_id=$1 AND ip.product_id=$2 ORDER BY ip.occurred_at DESC,ip.created_at DESC`, [request.params.batchId, request.params.productId])).rows as Array<{ id: string; quantity: number; totalCostCents: string; occurredAt: string; sourceUrl: string | null; note: string | null; channelName: string; payerUserId: string; payerUsername: string }>;
    const sharesByPurchase = await purchaseShares(purchases.map((purchase) => purchase.id));
    const adjustments = (await getPool().query(`SELECT ia.id,ia.quantity,ia.consumed_cost_cents::text AS "consumedCostCents",ia.reason,ia.created_at AS "createdAt",u.username AS "createdByUsername" FROM inventory_adjustments ia JOIN users u ON u.id=ia.created_by WHERE ia.batch_id=$1 AND ia.product_id=$2 ORDER BY ia.created_at DESC`, [request.params.batchId, request.params.productId])).rows;
    return { ...summary, totalCost: asMoney(summary.totalCostCents), purchases: purchases.map((purchase) => ({ ...purchase, totalCost: asMoney(purchase.totalCostCents), costShares: sharesByPurchase.get(purchase.id) ?? [] })), adjustments: adjustments.map((adjustment: { consumedCostCents: string }) => ({ ...adjustment, consumedCost: asMoney(adjustment.consumedCostCents) })) };
  });

  app.post<{ Params: { batchId: string }; Body: PurchaseInput }>('/api/batches/:batchId/purchases', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const parsed = parsePurchase(request.body ?? {}); if (!parsed.value) return message(reply, 'INVALID_PURCHASE', parsed.error ?? '采购信息无效');
    const input = parsed.value; const client = await getPool().connect(); const id = randomUUID();
    try {
      await client.query('BEGIN');
      if (!(await validatePurchaseReferences(client, request.params.batchId, context.workspaceId, input))) { await client.query('ROLLBACK'); return message(reply, 'INVALID_PURCHASE', '商品、渠道、付款人或成本承担人不属于当前批次'); }
      const product = (await client.query('SELECT p.name,p.variant_name AS "variantName",g.name AS "groupName" FROM products p LEFT JOIN product_groups g ON g.id=p.group_id WHERE p.id=$1 AND p.workspace_id=$2', [input.productId, context.workspaceId])).rows[0] as { name: string; variantName: string | null; groupName: string | null } | undefined;
      if (!product) { await client.query('ROLLBACK'); return message(reply, 'INVALID_PURCHASE', '商品不属于当前工作区'); }
      await client.query('INSERT INTO inventory_purchases(id,batch_id,product_id,channel_id,payer_user_id,quantity,total_cost_cents,purchased_on,occurred_at,source_url,note,product_name_snapshot,product_group_name_snapshot,variant_name_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [id, request.params.batchId, input.productId, input.channelId, input.payerUserId, input.quantity, input.totalCostCents, input.purchasedOn, input.occurredAt, input.sourceUrl, input.note, product.name, product.groupName, product.variantName, r.access!.id]);
      for (const share of input.costShares) await client.query('INSERT INTO purchase_cost_shares(purchase_id,user_id,amount_cents) VALUES($1,$2,$3)', [id, share.userId, share.amountCents]);
      await rebuildProductCostLedger(client, request.params.batchId, input.productId);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); if (error instanceof InventoryTimelineError) return message(reply, 'INVENTORY_TIMELINE_INVALID', error.message, 409); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'inventory.purchase.create', 'inventory_purchase', id, { productId: input.productId, quantity: input.quantity, totalCost: asMoney(input.totalCostCents) });
    return { id };
  });

  app.get<{ Params: { batchId: string; purchaseId: string } }>('/api/batches/:batchId/purchases/:purchaseId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId); if (!context) return;
    const purchase = (await getPool().query(`SELECT id,product_id AS "productId",channel_id AS "channelId",payer_user_id AS "payerUserId",quantity,total_cost_cents::text AS "totalCostCents",occurred_at AS "occurredAt",source_url AS "sourceUrl",note FROM inventory_purchases WHERE id=$1 AND batch_id=$2`, [request.params.purchaseId, request.params.batchId])).rows[0] as { id: string; productId: string; totalCostCents: string } | undefined;
    if (!purchase) return reply.code(404).send({ code: 'NOT_FOUND' });
    const shares = await purchaseShares([purchase.id]); const pool = getPool();
    const [sales, corrections, adjustments] = await Promise.all([pool.query('SELECT COUNT(*)::int AS count FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL', [request.params.batchId, purchase.productId]), pool.query(`SELECT pc.id,pc.reason,pc.created_at AS "createdAt",u.username AS "createdByUsername" FROM purchase_corrections pc JOIN users u ON u.id=pc.created_by WHERE pc.purchase_id=$1 ORDER BY pc.created_at DESC`, [purchase.id]), pool.query('SELECT COUNT(*)::int AS count FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2', [request.params.batchId, purchase.productId])]);
    return { ...purchase, totalCost: asMoney(purchase.totalCostCents), costShares: shares.get(purchase.id) ?? [], hasSales: Number(sales.rows[0]?.count ?? 0) > 0, hasInventoryAdjustments: Number(adjustments.rows[0]?.count ?? 0) > 0, corrections: corrections.rows };
  });

  app.patch<{ Params: { batchId: string; purchaseId: string }; Body: PurchaseInput }>('/api/batches/:batchId/purchases/:purchaseId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const parsed = parsePurchase(request.body ?? {}); if (!parsed.value) return message(reply, 'INVALID_PURCHASE', parsed.error ?? '采购信息无效');
    const input = parsed.value; const client = await getPool().connect(); let adjustmentCount = 0;
    try {
      await client.query('BEGIN');
      const current = (await client.query('SELECT id,product_id,channel_id,payer_user_id,quantity,total_cost_cents,purchased_on,occurred_at FROM inventory_purchases WHERE id=$1 AND batch_id=$2 FOR UPDATE', [request.params.purchaseId, request.params.batchId])).rows[0] as { id: string; product_id: string; channel_id: string; payer_user_id: string; quantity: number; total_cost_cents: string; purchased_on: string; occurred_at: string | Date } | undefined;
      if (!current) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'NOT_FOUND' }); }
      if (input.productId !== current.product_id) { await client.query('ROLLBACK'); return message(reply, 'PURCHASE_PRODUCT_FIXED', '编辑采购时不能更换商品，请新建一笔采购', 409); }
      if (!(await validatePurchaseReferences(client, request.params.batchId, context.workspaceId, input))) { await client.query('ROLLBACK'); return message(reply, 'INVALID_PURCHASE', '商品、渠道、付款人或成本承担人不属于当前批次'); }
      const reduced = (await client.query(`SELECT COALESCE((SELECT SUM(quantity) FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2),0)::int AS quantity,COALESCE((SELECT SUM(consumed_cost_cents) FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2),0)::bigint AS cost,COALESCE((SELECT SUM(s.quantity) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL),0)::int AS "soldQuantity",COALESCE((SELECT SUM(s.consumed_cost_cents) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL),0)::bigint AS "soldCost"`, [request.params.batchId, current.product_id])).rows[0] as { quantity: number; cost: string; soldQuantity: number; soldCost: string };
      const hasSales = reduced.soldQuantity > 0;
      if (reduced.quantity > 0) { await client.query('ROLLBACK'); return message(reply, 'PURCHASE_CORRECTION_BLOCKED_BY_ADJUSTMENT', '该商品已有报损或丢失减库存记录，暂不支持更正采购', 409); }
      if (hasSales) {
        const fixedFields = purchaseCorrectionFixedFields({ channelId: current.channel_id, occurredAt: current.occurred_at }, { channelId: input.channelId, occurredAt: input.occurredAt });
        if (fixedFields.length) { await client.query('ROLLBACK'); return message(reply, 'PURCHASE_CORRECTION_FIXED_FIELDS', `已有销售后不能更正：${fixedFields.join('、')}`, 409); }
        if (!input.costCorrectionReason) { await client.query('ROLLBACK'); return message(reply, 'PURCHASE_CORRECTION_REASON_REQUIRED', '请填写更正原因', 409); }
      }
      const prospective = (await client.query(`SELECT COALESCE(SUM(CASE WHEN id=$3 THEN $4 ELSE quantity END),0)::int AS quantity,COALESCE(SUM(CASE WHEN id=$3 THEN $5 ELSE total_cost_cents END),0)::bigint AS cost FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2`, [request.params.batchId, input.productId, current.id, input.quantity, input.totalCostCents])).rows[0] as { quantity: number; cost: string };
      if (!hasSales && (prospective.quantity < reduced.quantity || Number(prospective.cost) < Number(reduced.cost))) { await client.query('ROLLBACK'); return message(reply, 'INVENTORY_ALREADY_REDUCED', '采购数量或总成本不能低于已减少库存数量或成本', 409); }
      const oldShares = (await client.query('SELECT user_id AS "userId",amount_cents::text AS amount FROM purchase_cost_shares WHERE purchase_id=$1', [current.id])).rows as Array<{ userId: string; amount: string }>;
      const changed = current.quantity !== input.quantity || Number(current.total_cost_cents) !== input.totalCostCents || current.payer_user_id !== input.payerUserId || oldShares.length !== input.costShares.length || oldShares.some((share) => input.costShares.find((next) => next.userId === share.userId)?.amountCents !== Number(share.amount));
      await client.query('UPDATE inventory_purchases SET product_id=$3,channel_id=$4,payer_user_id=$5,quantity=$6,total_cost_cents=$7,purchased_on=$8,occurred_at=$9,source_url=$10,note=$11 WHERE id=$1 AND batch_id=$2', [current.id, request.params.batchId, input.productId, input.channelId, input.payerUserId, input.quantity, input.totalCostCents, input.purchasedOn, input.occurredAt, input.sourceUrl, input.note]);
      await client.query('DELETE FROM purchase_cost_shares WHERE purchase_id=$1', [current.id]);
      for (const share of input.costShares) await client.query('INSERT INTO purchase_cost_shares(purchase_id,user_id,amount_cents) VALUES($1,$2,$3)', [current.id, share.userId, share.amountCents]);
      if (changed) await rebuildProductCostLedger(client, request.params.batchId, current.product_id);
      if (hasSales && changed) {
        const correctionId = randomUUID();
        await client.query('INSERT INTO purchase_corrections(id,purchase_id,batch_id,old_quantity,new_quantity,old_total_cost_cents,new_total_cost_cents,old_payer_user_id,new_payer_user_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [correctionId, current.id, request.params.batchId, current.quantity, input.quantity, current.total_cost_cents, input.totalCostCents, current.payer_user_id, input.payerUserId, input.costCorrectionReason, r.access!.id]);
        for (const share of oldShares) await client.query("INSERT INTO purchase_correction_cost_shares(correction_id,version,user_id,amount_cents) VALUES($1,'old',$2,$3)", [correctionId, share.userId, share.amount]);
        for (const share of input.costShares) await client.query("INSERT INTO purchase_correction_cost_shares(correction_id,version,user_id,amount_cents) VALUES($1,'new',$2,$3)", [correctionId, share.userId, share.amountCents]);
        const count = (await client.query('SELECT COUNT(DISTINCT sb.id)::int AS count FROM settlement_bills sb JOIN settlement_bill_sales sbs ON sbs.settlement_bill_id=sb.id JOIN sales s ON s.id=sbs.sale_id WHERE sb.batch_id=$1 AND s.product_id=$2', [request.params.batchId, current.product_id])).rows[0] as { count: number };
        adjustmentCount = Number(count.count);
        await createPurchaseCorrectionAdjustments(client, request.params.batchId, current.product_id, correctionId, r.access!.id, { id: current.id, oldQuantity: current.quantity, newQuantity: input.quantity, oldCost: Number(current.total_cost_cents), newCost: input.totalCostCents, oldPayerUserId: current.payer_user_id, newPayerUserId: input.payerUserId, oldShares: oldShares.map((share) => ({ userId: share.userId, amount: Number(share.amount) })), newShares: input.costShares.map((share) => ({ userId: share.userId, amount: share.amountCents })) }, { quantity: prospective.quantity - input.quantity + current.quantity, cost: Number(prospective.cost) - input.totalCostCents + Number(current.total_cost_cents) }, { quantity: prospective.quantity, cost: Number(prospective.cost) });
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); if (error instanceof InventoryTimelineError) return message(reply, 'INVENTORY_TIMELINE_INVALID', error.message, 409); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'inventory.purchase.update', 'inventory_purchase', request.params.purchaseId, { productId: input.productId, quantity: input.quantity, totalCost: asMoney(input.totalCostCents), costCorrectionReason: input.costCorrectionReason });
    return { ok: true, adjustmentCount };
  });

  app.post<{ Params: { batchId: string; productId: string }; Body: AdjustmentInput }>('/api/batches/:batchId/inventory/:productId/adjustments', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const quantity = request.body?.quantity; const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
    if (!Number.isInteger(quantity) || Number(quantity) <= 0 || !reason || reason.length > 500) return message(reply, 'INVALID_INVENTORY_ADJUSTMENT', '请填写正整数数量和不超过 500 个字的原因');
    const client = await getPool().connect(); const id = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2 FOR UPDATE', [request.params.batchId, request.params.productId]);
      const totals = (await client.query(`SELECT COALESCE((SELECT SUM(quantity) FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2),0)::int AS quantity,COALESCE((SELECT SUM(total_cost_cents) FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2),0)::bigint AS cost,COALESCE((SELECT SUM(quantity) FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2),0)::int AS "reducedQuantity",COALESCE((SELECT SUM(consumed_cost_cents) FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2),0)::bigint AS "reducedCost",COALESCE((SELECT SUM(s.quantity) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL),0)::int AS "soldQuantity",COALESCE((SELECT SUM(s.consumed_cost_cents) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL),0)::bigint AS "soldCost"`, [request.params.batchId, request.params.productId])).rows[0] as { quantity: number; cost: string; reducedQuantity: number; reducedCost: string; soldQuantity: number; soldCost: string };
      const availableQuantity = totals.quantity - totals.reducedQuantity - totals.soldQuantity; const remainingCost = Number(totals.cost) - Number(totals.reducedCost) - Number(totals.soldCost);
      if (Number(quantity) > availableQuantity) { await client.query('ROLLBACK'); return message(reply, 'INSUFFICIENT_INVENTORY', '减少数量不能超过可卖数量', 409); }
      const consumedCost = Number(quantity) === availableQuantity ? remainingCost : Math.floor((remainingCost * Number(quantity)) / availableQuantity);
      await client.query('INSERT INTO inventory_adjustments(id,batch_id,product_id,quantity,consumed_cost_cents,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, request.params.batchId, request.params.productId, quantity, consumedCost, reason, r.access!.id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'inventory.adjustment.create', 'inventory_adjustment', id, { productId: request.params.productId, quantity, reason });
    return { id };
  });
}
