import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { accessRole, audit, auth, batchContext, canEditBatch, canReadBatch, type AccessRequest, type BatchContext } from './access.js';
import { getPool } from './db/client.js';

type CostShareInput = { userId?: unknown; amount?: unknown };
type PurchaseInput = { productId?: unknown; channelId?: unknown; payerUserId?: unknown; quantity?: unknown; totalCost?: unknown; costShares?: unknown; purchasedOn?: unknown; sourceUrl?: unknown; note?: unknown; costCorrectionReason?: unknown };
type AdjustmentInput = { quantity?: unknown; reason?: unknown };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^\d+(\.\d)?$/;

function asTenths(value: unknown): number | null {
  if (typeof value !== 'string' || !MONEY_RE.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 10 + Number(fraction || 0);
  return Number.isSafeInteger(amount) ? amount : null;
}
function asMoney(value: string | number): string {
  const amount = Number(value); return `${Math.floor(amount / 10)}.${Math.abs(amount % 10)}`;
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
function parsePurchase(input: PurchaseInput): { value?: { productId: string; channelId: string; payerUserId: string; quantity: number; totalCostTenths: number; costShares: Array<{ userId: string; amountTenths: number }>; purchasedOn: string; sourceUrl: string | null; note: string | null; costCorrectionReason: string | null }; error?: string } {
  if (!UUID_RE.test(String(input.productId ?? '')) || !UUID_RE.test(String(input.channelId ?? '')) || !UUID_RE.test(String(input.payerUserId ?? ''))) return { error: '商品、渠道和付款人无效' };
  if (!Number.isInteger(input.quantity) || Number(input.quantity) <= 0) return { error: '数量必须是正整数' };
  const totalCostTenths = asTenths(input.totalCost);
  if (totalCostTenths === null) return { error: '总成本必须是非负金额，最多一位小数' };
  if (!Array.isArray(input.costShares) || !input.costShares.length) return { error: '请填写成本由谁承担' };
  const costShares: Array<{ userId: string; amountTenths: number }> = [];
  for (const share of input.costShares as CostShareInput[]) {
    const amountTenths = asTenths(share.amount);
    if (!UUID_RE.test(String(share.userId ?? '')) || amountTenths === null) return { error: '成本承担信息无效' };
    costShares.push({ userId: String(share.userId), amountTenths });
  }
  if (new Set(costShares.map((share) => share.userId)).size !== costShares.length) return { error: '同一成员只能填写一次成本承担' };
  if (costShares.reduce((sum, share) => sum + share.amountTenths, 0) !== totalCostTenths) return { error: '成本承担合计必须等于总成本' };
  if (typeof input.purchasedOn !== 'string' || !DATE_RE.test(input.purchasedOn)) return { error: '请选择采购日期' };
  if (input.sourceUrl !== undefined && input.sourceUrl !== null && (typeof input.sourceUrl !== 'string' || input.sourceUrl.length > 1000)) return { error: '来源链接无效' };
  if (input.note !== undefined && input.note !== null && (typeof input.note !== 'string' || input.note.length > 1000)) return { error: '备注无效' };
  if (input.costCorrectionReason !== undefined && input.costCorrectionReason !== null && (typeof input.costCorrectionReason !== 'string' || input.costCorrectionReason.length > 500)) return { error: '修改成本原因不能超过 500 个字' };
  return { value: { productId: String(input.productId), channelId: String(input.channelId), payerUserId: String(input.payerUserId), quantity: Number(input.quantity), totalCostTenths, costShares, purchasedOn: input.purchasedOn, sourceUrl: typeof input.sourceUrl === 'string' && input.sourceUrl.trim() ? input.sourceUrl.trim() : null, note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null, costCorrectionReason: typeof input.costCorrectionReason === 'string' && input.costCorrectionReason.trim() ? input.costCorrectionReason.trim() : null } };
}

async function purchaseShares(purchaseIds: string[]) {
  const shares = (await getPool().query(`SELECT pcs.purchase_id AS "purchaseId",u.id AS "userId",u.username,pcs.amount_tenths::text AS "amountTenths" FROM purchase_cost_shares pcs JOIN users u ON u.id=pcs.user_id WHERE pcs.purchase_id=ANY($1::uuid[]) ORDER BY u.username`, [purchaseIds])).rows as Array<{ purchaseId: string; userId: string; username: string; amountTenths: string }>;
  const byPurchase = new Map<string, Array<{ userId: string; username: string; amount: string }>>();
  for (const share of shares) byPurchase.set(share.purchaseId, [...(byPurchase.get(share.purchaseId) ?? []), { userId: share.userId, username: share.username, amount: asMoney(share.amountTenths) }]);
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
    return (await getPool().query(`SELECT ip.product_id AS "productId", p.name AS "productName", (SUM(ip.quantity)-COALESCE(adj.quantity,0)-COALESCE(sale.quantity,0))::int AS "availableQuantity", (SUM(ip.total_cost_tenths)-COALESCE(adj.cost,0)-COALESCE(sale.cost,0))::text AS "totalCostTenths", COUNT(*)::int AS "purchaseCount"
      FROM inventory_purchases ip JOIN products p ON p.id=ip.product_id AND p.workspace_id=$2
      LEFT JOIN (SELECT product_id,SUM(quantity) AS quantity,SUM(consumed_cost_tenths) AS cost FROM inventory_adjustments WHERE batch_id=$1 GROUP BY product_id) adj ON adj.product_id=ip.product_id
      LEFT JOIN (SELECT s.product_id,SUM(s.quantity) AS quantity,SUM(s.consumed_cost_tenths) AS cost FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND sr.sale_id IS NULL GROUP BY s.product_id) sale ON sale.product_id=ip.product_id
      WHERE ip.batch_id=$1 GROUP BY ip.product_id,p.name,adj.quantity,adj.cost,sale.quantity,sale.cost ORDER BY MAX(ip.created_at) DESC`, [request.params.batchId, context.workspaceId])).rows
      .map((row: { productId: string; productName: string; availableQuantity: number; totalCostTenths: string; purchaseCount: number }) => ({ ...row, totalCost: asMoney(row.totalCostTenths) }));
  });

  app.get<{ Params: { batchId: string; productId: string } }>('/api/batches/:batchId/inventory/:productId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId); if (!context) return;
    const summary = (await getPool().query(`SELECT ip.product_id AS "productId", p.name AS "productName", (SUM(ip.quantity)-COALESCE(adj.quantity,0)-COALESCE(sale.quantity,0))::int AS "availableQuantity", (SUM(ip.total_cost_tenths)-COALESCE(adj.cost,0)-COALESCE(sale.cost,0))::text AS "totalCostTenths", COUNT(*)::int AS "purchaseCount"
      FROM inventory_purchases ip JOIN products p ON p.id=ip.product_id AND p.workspace_id=$3
      LEFT JOIN (SELECT SUM(quantity) AS quantity,SUM(consumed_cost_tenths) AS cost FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2) adj ON true
      LEFT JOIN (SELECT SUM(s.quantity) AS quantity,SUM(s.consumed_cost_tenths) AS cost FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL) sale ON true
      WHERE ip.batch_id=$1 AND ip.product_id=$2 GROUP BY ip.product_id,p.name,adj.quantity,adj.cost,sale.quantity,sale.cost`, [request.params.batchId, request.params.productId, context.workspaceId])).rows[0] as { productId: string; productName: string; availableQuantity: number; totalCostTenths: string; purchaseCount: number } | undefined;
    if (!summary) return reply.code(404).send({ code: 'NOT_FOUND' });
    const purchases = (await getPool().query(`SELECT ip.id,ip.product_id AS "productId",ip.channel_id AS "channelId",ip.quantity,ip.total_cost_tenths::text AS "totalCostTenths",ip.purchased_on AS "purchasedOn",ip.source_url AS "sourceUrl",ip.note,c.name AS "channelName",u.id AS "payerUserId",u.username AS "payerUsername"
      FROM inventory_purchases ip JOIN manual_channels c ON c.id=ip.channel_id JOIN users u ON u.id=ip.payer_user_id WHERE ip.batch_id=$1 AND ip.product_id=$2 ORDER BY ip.purchased_on DESC,ip.created_at DESC`, [request.params.batchId, request.params.productId])).rows as Array<{ id: string; quantity: number; totalCostTenths: string; purchasedOn: string; sourceUrl: string | null; note: string | null; channelName: string; payerUserId: string; payerUsername: string }>;
    const sharesByPurchase = await purchaseShares(purchases.map((purchase) => purchase.id));
    const adjustments = (await getPool().query(`SELECT ia.id,ia.quantity,ia.consumed_cost_tenths::text AS "consumedCostTenths",ia.reason,ia.created_at AS "createdAt",u.username AS "createdByUsername" FROM inventory_adjustments ia JOIN users u ON u.id=ia.created_by WHERE ia.batch_id=$1 AND ia.product_id=$2 ORDER BY ia.created_at DESC`, [request.params.batchId, request.params.productId])).rows;
    return { ...summary, totalCost: asMoney(summary.totalCostTenths), purchases: purchases.map((purchase) => ({ ...purchase, totalCost: asMoney(purchase.totalCostTenths), costShares: sharesByPurchase.get(purchase.id) ?? [] })), adjustments: adjustments.map((adjustment: { consumedCostTenths: string }) => ({ ...adjustment, consumedCost: asMoney(adjustment.consumedCostTenths) })) };
  });

  app.post<{ Params: { batchId: string }; Body: PurchaseInput }>('/api/batches/:batchId/purchases', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const parsed = parsePurchase(request.body ?? {}); if (!parsed.value) return message(reply, 'INVALID_PURCHASE', parsed.error ?? '采购信息无效');
    const input = parsed.value; const client = await getPool().connect(); const id = randomUUID();
    try {
      await client.query('BEGIN');
      if (!(await validatePurchaseReferences(client, request.params.batchId, context.workspaceId, input))) { await client.query('ROLLBACK'); return message(reply, 'INVALID_PURCHASE', '商品、渠道、付款人或成本承担人不属于当前批次'); }
      await client.query('INSERT INTO inventory_purchases(id,batch_id,product_id,channel_id,payer_user_id,quantity,total_cost_tenths,purchased_on,source_url,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, request.params.batchId, input.productId, input.channelId, input.payerUserId, input.quantity, input.totalCostTenths, input.purchasedOn, input.sourceUrl, input.note, r.access!.id]);
      for (const share of input.costShares) await client.query('INSERT INTO purchase_cost_shares(purchase_id,user_id,amount_tenths) VALUES($1,$2,$3)', [id, share.userId, share.amountTenths]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'inventory.purchase.create', 'inventory_purchase', id, { productId: input.productId, quantity: input.quantity, totalCost: asMoney(input.totalCostTenths) });
    return { id };
  });

  app.get<{ Params: { batchId: string; purchaseId: string } }>('/api/batches/:batchId/purchases/:purchaseId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId); if (!context) return;
    const purchase = (await getPool().query(`SELECT id,product_id AS "productId",channel_id AS "channelId",payer_user_id AS "payerUserId",quantity,total_cost_tenths::text AS "totalCostTenths",purchased_on AS "purchasedOn",source_url AS "sourceUrl",note FROM inventory_purchases WHERE id=$1 AND batch_id=$2`, [request.params.purchaseId, request.params.batchId])).rows[0] as { id: string; totalCostTenths: string } | undefined;
    if (!purchase) return reply.code(404).send({ code: 'NOT_FOUND' });
    const shares = await purchaseShares([purchase.id]);
    return { ...purchase, totalCost: asMoney(purchase.totalCostTenths), costShares: shares.get(purchase.id) ?? [] };
  });

  app.patch<{ Params: { batchId: string; purchaseId: string }; Body: PurchaseInput }>('/api/batches/:batchId/purchases/:purchaseId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const parsed = parsePurchase(request.body ?? {}); if (!parsed.value) return message(reply, 'INVALID_PURCHASE', parsed.error ?? '采购信息无效');
    const input = parsed.value; const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const current = (await client.query('SELECT id,product_id,total_cost_tenths FROM inventory_purchases WHERE id=$1 AND batch_id=$2 FOR UPDATE', [request.params.purchaseId, request.params.batchId])).rows[0] as { id: string; product_id: string; total_cost_tenths: string } | undefined;
      if (!current) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'NOT_FOUND' }); }
      if (input.productId !== current.product_id) { await client.query('ROLLBACK'); return message(reply, 'PURCHASE_PRODUCT_FIXED', '编辑采购时不能更换商品，请新建一笔采购', 409); }
      if (Number(current.total_cost_tenths) !== input.totalCostTenths && !input.costCorrectionReason) { await client.query('ROLLBACK'); return message(reply, 'COST_CORRECTION_REASON_REQUIRED', '修改总成本时请填写原因'); }
      if (!(await validatePurchaseReferences(client, request.params.batchId, context.workspaceId, input))) { await client.query('ROLLBACK'); return message(reply, 'INVALID_PURCHASE', '商品、渠道、付款人或成本承担人不属于当前批次'); }
      const reduced = (await client.query(`SELECT COALESCE((SELECT SUM(quantity) FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2),0)::int AS quantity,COALESCE((SELECT SUM(consumed_cost_tenths) FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2),0)::bigint AS cost,COALESCE((SELECT SUM(s.quantity) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL),0)::int AS "soldQuantity",COALESCE((SELECT SUM(s.consumed_cost_tenths) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL),0)::bigint AS "soldCost"`, [request.params.batchId, current.product_id])).rows[0] as { quantity: number; cost: string; soldQuantity: number; soldCost: string };
      const prospective = (await client.query(`SELECT COALESCE(SUM(CASE WHEN id=$3 THEN $4 ELSE quantity END),0)::int AS quantity,COALESCE(SUM(CASE WHEN id=$3 THEN $5 ELSE total_cost_tenths END),0)::bigint AS cost FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2`, [request.params.batchId, input.productId, current.id, input.quantity, input.totalCostTenths])).rows[0] as { quantity: number; cost: string };
      if (prospective.quantity < reduced.quantity + reduced.soldQuantity || Number(prospective.cost) < Number(reduced.cost) + Number(reduced.soldCost)) { await client.query('ROLLBACK'); return message(reply, 'INVENTORY_ALREADY_REDUCED', '已有卖出或商品损坏、丢失记录，不能把采购数量或成本改得更低', 409); }
      await client.query('UPDATE inventory_purchases SET product_id=$3,channel_id=$4,payer_user_id=$5,quantity=$6,total_cost_tenths=$7,purchased_on=$8,source_url=$9,note=$10 WHERE id=$1 AND batch_id=$2', [current.id, request.params.batchId, input.productId, input.channelId, input.payerUserId, input.quantity, input.totalCostTenths, input.purchasedOn, input.sourceUrl, input.note]);
      await client.query('DELETE FROM purchase_cost_shares WHERE purchase_id=$1', [current.id]);
      for (const share of input.costShares) await client.query('INSERT INTO purchase_cost_shares(purchase_id,user_id,amount_tenths) VALUES($1,$2,$3)', [current.id, share.userId, share.amountTenths]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'inventory.purchase.update', 'inventory_purchase', request.params.purchaseId, { productId: input.productId, quantity: input.quantity, totalCost: asMoney(input.totalCostTenths), costCorrectionReason: input.costCorrectionReason });
    return { ok: true };
  });

  app.post<{ Params: { batchId: string; productId: string }; Body: AdjustmentInput }>('/api/batches/:batchId/inventory/:productId/adjustments', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const quantity = request.body?.quantity; const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
    if (!Number.isInteger(quantity) || Number(quantity) <= 0 || !reason || reason.length > 500) return message(reply, 'INVALID_INVENTORY_ADJUSTMENT', '请填写正整数数量和不超过 500 个字的原因');
    const client = await getPool().connect(); const id = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2 FOR UPDATE', [request.params.batchId, request.params.productId]);
      const totals = (await client.query(`SELECT COALESCE((SELECT SUM(quantity) FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2),0)::int AS quantity,COALESCE((SELECT SUM(total_cost_tenths) FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2),0)::bigint AS cost,COALESCE((SELECT SUM(quantity) FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2),0)::int AS "reducedQuantity",COALESCE((SELECT SUM(consumed_cost_tenths) FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2),0)::bigint AS "reducedCost",COALESCE((SELECT SUM(s.quantity) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL),0)::int AS "soldQuantity",COALESCE((SELECT SUM(s.consumed_cost_tenths) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL),0)::bigint AS "soldCost"`, [request.params.batchId, request.params.productId])).rows[0] as { quantity: number; cost: string; reducedQuantity: number; reducedCost: string; soldQuantity: number; soldCost: string };
      const availableQuantity = totals.quantity - totals.reducedQuantity - totals.soldQuantity; const remainingCost = Number(totals.cost) - Number(totals.reducedCost) - Number(totals.soldCost);
      if (Number(quantity) > availableQuantity) { await client.query('ROLLBACK'); return message(reply, 'INSUFFICIENT_INVENTORY', '减少数量不能超过可卖数量', 409); }
      const consumedCost = Number(quantity) === availableQuantity ? remainingCost : Math.floor((remainingCost * Number(quantity)) / availableQuantity);
      await client.query('INSERT INTO inventory_adjustments(id,batch_id,product_id,quantity,consumed_cost_tenths,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, request.params.batchId, request.params.productId, quantity, consumedCost, reason, r.access!.id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'inventory.adjustment.create', 'inventory_adjustment', id, { productId: request.params.productId, quantity, reason });
    return { id };
  });
}
