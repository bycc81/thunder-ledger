import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { audit, auth, batchContext, canEditBatch, canReadBatch, type AccessRequest, type BatchContext } from './access.js';
import { getPool } from './db/client.js';
import { InventoryTimelineError, rebuildProductCostLedger } from './cost-ledger.js';
import { asCents, calculateServiceFeeCents } from './sales-expenses.js';

type ConsumptionInput = { productId?: unknown; quantity?: unknown };
type ItemInput = { name?: unknown; quantity?: unknown; cost?: unknown; inventoryConsumptions?: unknown };
type QuickSaleInput = { totalPrice?: unknown; sellerUserId?: unknown; occurredAt?: unknown; salesChannel?: unknown; feeMode?: unknown; feeRate?: unknown; feeAmount?: unknown; note?: unknown; items?: unknown };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE_RE = /^(100|\d{1,2})(\.\d{1,2})?$/;

function message(reply: FastifyReply, code: string, text: string, status = 400) { return reply.code(status).send({ code, message: text }); }
function money(value: number): string { const sign = value < 0 ? '-' : ''; const absolute = Math.abs(value); return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`; }
function optionalText(value: unknown, limit = 1000): string | null | undefined { if (value === null || value === undefined || value === '') return null; if (typeof value !== 'string' || value.trim().length > limit) return undefined; return value.trim() || null; }
function validTime(value: unknown): string | null { if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) return null; return new Date(value).toISOString(); }
function rateBasisPoints(value: unknown): number | null { if (typeof value !== 'string' || !RATE_RE.test(value)) return null; const result = Math.round(Number(value) * 100); return result >= 0 && result <= 10000 ? result : null; }
async function requireBatch(request: AccessRequest, reply: FastifyReply, batchId: string, write = false): Promise<BatchContext | null> {
  if (!(await auth(request, reply))) return null;
  const context = await batchContext(request, batchId);
  if (!canReadBatch(context)) { await reply.code(404).send({ code: 'NOT_FOUND' }); return null; }
  if (!write) return context;
  if (!canEditBatch(context)) { await reply.code(403).send({ code: 'FORBIDDEN' }); return null; }
  const batch = (await getPool().query('SELECT status FROM collaboration_batches WHERE id=$1', [batchId])).rows[0] as { status?: string } | undefined;
  if (batch?.status !== 'open') { return message(reply, 'BATCH_CLOSED', '已关闭的批次不能记录交易', 409); }
  return context;
}
async function participant(client: import('pg').PoolClient, batchId: string, userId: string): Promise<boolean> { return Boolean((await client.query('SELECT 1 FROM batch_members WHERE batch_id=$1 AND user_id=$2', [batchId, userId])).rowCount); }

type ParsedItem = { name: string; quantity: number; costCents: number; consumptions: Array<{ productId: string; quantity: number }> };
function parseItems(value: unknown): ParsedItem[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const items: ParsedItem[] = [];
  for (const raw of value as ItemInput[]) {
    const name = optionalText(raw.name, 200); const costCents = asCents(raw.cost); const quantity = raw.quantity;
    if (!name || !Number.isInteger(quantity) || Number(quantity) <= 0 || costCents === null) return null;
    if (!Array.isArray(raw.inventoryConsumptions)) return null;
    const seen = new Set<string>(); const consumptions: Array<{ productId: string; quantity: number }> = [];
    for (const input of raw.inventoryConsumptions as ConsumptionInput[]) {
      const productId = String(input.productId ?? ''); const amount = input.quantity;
      if (!UUID_RE.test(productId) || !Number.isInteger(amount) || Number(amount) <= 0 || seen.has(productId)) return null;
      seen.add(productId); consumptions.push({ productId, quantity: Number(amount) });
    }
    items.push({ name, quantity: Number(quantity), costCents, consumptions });
  }
  return items;
}

export function split(total: number, weights: Map<string, number>): Map<string, number> {
  const result = new Map<string, number>(); const rows = [...weights].filter(([, value]) => value > 0).sort(([a], [b]) => a.localeCompare(b)); const sum = rows.reduce((value, [, weight]) => value + weight, 0);
  if (!total || !sum) return result;
  let used = 0; for (const [userId, weight] of rows) { const value = Math.floor(total * weight / sum); result.set(userId, value); used += value; }
  for (let index = 0; index < total - used; index += 1) { const userId = rows[index % rows.length][0]; result.set(userId, (result.get(userId) ?? 0) + 1); }
  return result;
}

/** 以关联库存来源作为权重，将用户输入的商品行成本分配给成员；无来源时归属卖出人。 */
export async function rebuildQuickSaleCostAllocations(client: import('pg').PoolClient, quickSaleId: string): Promise<void> {
  const sale = (await client.query('SELECT seller_user_id AS "sellerUserId" FROM quick_sales WHERE id=$1', [quickSaleId])).rows[0] as { sellerUserId: string } | undefined;
  if (!sale) return;
  await client.query('DELETE FROM quick_sale_cost_allocations WHERE quick_sale_id=$1', [quickSaleId]);
  const rows = (await client.query(`SELECT qsi.id AS "itemId",qsi.cost_cents::text AS "costCents",qsc.id AS "consumptionId" FROM quick_sale_items qsi LEFT JOIN quick_sale_inventory_consumptions qsc ON qsc.quick_sale_item_id=qsi.id WHERE qsi.quick_sale_id=$1 ORDER BY qsi.position`, [quickSaleId])).rows as Array<{ itemId: string; costCents: string; consumptionId: string | null }>;
  const consumptionIds = rows.flatMap((row) => row.consumptionId ? [row.consumptionId] : []);
  const allocations = consumptionIds.length ? (await client.query('SELECT consumption_id AS "consumptionId",allocation_type AS "allocationType",user_id AS "userId",amount_cents::text AS amount FROM quick_sale_inventory_cost_allocations WHERE consumption_id=ANY($1::uuid[])', [consumptionIds])).rows as Array<{ consumptionId: string; allocationType: 'payer' | 'burden'; userId: string; amount: string }> : [];
  const values: Record<'payer' | 'burden', Map<string, number>> = { payer: new Map(), burden: new Map() };
  for (const item of new Map(rows.map((row) => [row.itemId, row])).values()) {
    const itemRows = rows.filter((row) => row.itemId === item.itemId && row.consumptionId);
    for (const type of ['payer', 'burden'] as const) {
      const weights = new Map<string, number>();
      for (const row of itemRows) for (const allocation of allocations) if (allocation.consumptionId === row.consumptionId && allocation.allocationType === type) weights.set(allocation.userId, (weights.get(allocation.userId) ?? 0) + Number(allocation.amount));
      const distributed = weights.size ? split(Number(item.costCents), weights) : new Map([[sale.sellerUserId, Number(item.costCents)]]);
      for (const [userId, amount] of distributed) values[type].set(userId, (values[type].get(userId) ?? 0) + amount);
    }
  }
  for (const type of ['payer', 'burden'] as const) for (const [userId, amount] of values[type]) await client.query('INSERT INTO quick_sale_cost_allocations(quick_sale_id,allocation_type,user_id,amount_cents) VALUES($1,$2,$3,$4)', [quickSaleId, type, userId, amount]);
}

export async function registerQuickSaleRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { batchId: string } }>('/api/batches/:batchId/quick-sales', async (request, reply) => {
    const r = request as AccessRequest; if (!(await requireBatch(r, reply, request.params.batchId))) return;
    const rows = (await getPool().query(`SELECT qs.id,qs.total_price_cents::text AS "totalPriceCents",qs.service_fee_cents::text AS "serviceFeeCents",qs.sales_channel AS "salesChannel",u.id AS "sellerUserId",u.username AS "sellerUsername",qs.occurred_at AS "occurredAt",qs.note,qs.created_at AS "createdAt",qsr.reason AS "reversalReason",qsr.created_at AS "reversedAt",(sbqs.quick_sale_id IS NOT NULL) AS settled,COALESCE(SUM(qsi.quantity),0)::int AS quantity,COALESCE(SUM(qsi.cost_cents),0)::bigint::text AS "costCents",string_agg(qsi.name,' + ' ORDER BY qsi.position) AS "displayName" FROM quick_sales qs JOIN users u ON u.id=qs.seller_user_id JOIN quick_sale_items qsi ON qsi.quick_sale_id=qs.id LEFT JOIN quick_sale_reversals qsr ON qsr.quick_sale_id=qs.id LEFT JOIN settlement_bill_quick_sales sbqs ON sbqs.quick_sale_id=qs.id WHERE qs.batch_id=$1 GROUP BY qs.id,u.id,u.username,qsr.reason,qsr.created_at,sbqs.quick_sale_id ORDER BY qs.occurred_at DESC,qs.created_at DESC`, [request.params.batchId])).rows as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({ ...row, source: 'quick_sale', sourceLabel: '快速售出', totalPrice: money(Number(row.totalPriceCents)), serviceFee: money(Number(row.serviceFeeCents)), receivedAmount: money(Number(row.totalPriceCents) - Number(row.serviceFeeCents)), consumedCost: money(Number(row.costCents)) }));
  });

  app.get<{ Params: { batchId: string; quickSaleId: string } }>('/api/batches/:batchId/quick-sales/:quickSaleId', async (request, reply) => {
    const r = request as AccessRequest; if (!(await requireBatch(r, reply, request.params.batchId))) return;
    if (!UUID_RE.test(request.params.quickSaleId)) return reply.code(404).send({ code: 'NOT_FOUND' });
    const sale = (await getPool().query(`SELECT qs.id,qs.total_price_cents::text AS "totalPriceCents",qs.service_fee_cents::text AS "serviceFeeCents",qs.sales_channel AS "salesChannel",qs.fee_mode AS "feeMode",qs.fee_rate_basis_points AS "feeRateBasisPoints",u.id AS "sellerUserId",u.username AS "sellerUsername",qs.occurred_at AS "occurredAt",qs.note,qs.created_at AS "createdAt",qsr.reason AS "reversalReason",qsr.created_at AS "reversedAt",sb.id AS "settlementId",sb.confirmed_at AS "settlementConfirmedAt" FROM quick_sales qs JOIN users u ON u.id=qs.seller_user_id LEFT JOIN quick_sale_reversals qsr ON qsr.quick_sale_id=qs.id LEFT JOIN settlement_bill_quick_sales sbqs ON sbqs.quick_sale_id=qs.id LEFT JOIN settlement_bills sb ON sb.id=sbqs.settlement_bill_id WHERE qs.id=$1 AND qs.batch_id=$2`, [request.params.quickSaleId, request.params.batchId])).rows[0] as Record<string, string | null> | undefined;
    if (!sale) return reply.code(404).send({ code: 'NOT_FOUND' });
    const [itemsResult, expensesResult] = await Promise.all([
      getPool().query(`SELECT qsi.id,qsi.name,qsi.quantity,qsi.cost_cents::text AS "costCents",COALESCE(json_agg(json_build_object('id',qsc.id,'productId',qsc.product_id,'productName',p.name,'quantity',qsc.quantity,'consumedCostCents',qsc.consumed_cost_cents::text)) FILTER (WHERE qsc.id IS NOT NULL),'[]') AS consumptions FROM quick_sale_items qsi LEFT JOIN quick_sale_inventory_consumptions qsc ON qsc.quick_sale_item_id=qsi.id LEFT JOIN products p ON p.id=qsc.product_id WHERE qsi.quick_sale_id=$1 GROUP BY qsi.id ORDER BY qsi.position`, [sale.id]),
      getPool().query(`SELECT e.id,e.name,e.amount_cents::text AS "amountCents",u.id AS "payerUserId",u.username AS "payerUsername",e.occurred_at AS "occurredAt",er.reason AS "reversalReason" FROM expenses e JOIN users u ON u.id=e.payer_user_id LEFT JOIN expense_reversals er ON er.expense_id=e.id WHERE e.batch_id=$1 AND e.quick_sale_id=$2 ORDER BY e.occurred_at DESC`, [request.params.batchId, sale.id]),
    ]);
    const items = itemsResult.rows as Array<{ name: string; quantity: number; costCents: string; consumptions: Array<{ consumedCostCents: string }> }>;
    const totalCost = items.reduce((sum, item) => sum + Number(item.costCents), 0); const inventoryCost = items.reduce((sum, item) => sum + item.consumptions.reduce((child, item) => child + Number(item.consumedCostCents), 0), 0); const price = Number(sale.totalPriceCents); const fee = Number(sale.serviceFeeCents);
    return { ...sale, source: 'quick_sale', sourceLabel: '快速售出', totalPrice: money(price), serviceFee: money(fee), receivedAmount: money(price - fee), consumedCost: money(totalCost), inventoryConsumedCost: money(inventoryCost), grossProfit: money(price - fee - totalCost), feeRate: sale.feeRateBasisPoints === null ? null : Number(sale.feeRateBasisPoints) / 100, items: items.map((item) => ({ ...item, cost: money(Number(item.costCents)), consumptions: item.consumptions.map((consumption) => ({ ...consumption, consumedCost: money(Number(consumption.consumedCostCents)) })) })), expenses: expensesResult.rows.map((expense: { amountCents: string }) => ({ ...expense, amount: money(Number(expense.amountCents)) })), settled: sale.settlementId !== null, settlement: sale.settlementId === null ? null : { id: sale.settlementId, confirmedAt: sale.settlementConfirmedAt } };
  });

  app.post<{ Params: { batchId: string }; Body: QuickSaleInput }>('/api/batches/:batchId/quick-sales', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return;
    const input = request.body ?? {}; const totalPrice = asCents(input.totalPrice); const occurredAt = validTime(input.occurredAt); const note = optionalText(input.note); const salesChannel = optionalText(input.salesChannel, 100); const items = parseItems(input.items); const feeMode = input.feeMode === 'percentage' || input.feeMode === 'amount' ? input.feeMode : null; const hasFee = input.feeRate !== null && input.feeRate !== undefined && input.feeRate !== '' || input.feeAmount !== null && input.feeAmount !== undefined && input.feeAmount !== ''; const feeRate = feeMode === 'percentage' ? rateBasisPoints(input.feeRate) : null; const amountFee = feeMode === 'amount' ? asCents(input.feeAmount) : null; const serviceFee = feeMode === 'percentage' && feeRate !== null && totalPrice !== null ? calculateServiceFeeCents(totalPrice, feeRate) : feeMode === 'amount' ? amountFee : 0;
    if (!UUID_RE.test(String(input.sellerUserId ?? '')) || totalPrice === null || !occurredAt || note === undefined || salesChannel === undefined || !items || (hasFee && (!feeMode || serviceFee === null)) || serviceFee === null || serviceFee > totalPrice) return message(reply, 'INVALID_QUICK_SALE', '请填写有效的商品、数量、成本、成交总价、卖出人、手续费和成交时间');
    const productIds = [...new Set(items.flatMap((item) => item.consumptions.map((consumption) => consumption.productId)))].sort(); const client = await getPool().connect(); const id = randomUUID();
    try {
      await client.query('BEGIN');
      if (!(await participant(client, request.params.batchId, String(input.sellerUserId)))) { await client.query('ROLLBACK'); return message(reply, 'INVALID_QUICK_SALE', '卖出人不属于当前批次'); }
      for (const productId of productIds) { const result = await client.query('SELECT ip.id FROM inventory_purchases ip JOIN products p ON p.id=ip.product_id WHERE ip.batch_id=$1 AND ip.product_id=$2 AND p.workspace_id=$3 FOR UPDATE', [request.params.batchId, productId, context.workspaceId]); if (!result.rowCount) { await client.query('ROLLBACK'); return message(reply, 'INVALID_QUICK_SALE', '关联库存不属于当前批次或没有采购记录'); } }
      await client.query('INSERT INTO quick_sales(id,batch_id,total_price_cents,sales_channel,fee_mode,fee_rate_basis_points,service_fee_cents,seller_user_id,occurred_at,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, request.params.batchId, totalPrice, salesChannel, hasFee ? feeMode : null, hasFee && feeMode === 'percentage' ? feeRate : null, serviceFee, input.sellerUserId, occurredAt, note, r.access!.id]);
      for (const [position, item] of items.entries()) { const itemId = randomUUID(); await client.query('INSERT INTO quick_sale_items(id,quick_sale_id,position,name,quantity,cost_cents) VALUES($1,$2,$3,$4,$5,$6)', [itemId, id, position, item.name, item.quantity, item.costCents]); for (const consumption of item.consumptions) await client.query('INSERT INTO quick_sale_inventory_consumptions(id,quick_sale_item_id,product_id,quantity) VALUES($1,$2,$3,$4)', [randomUUID(), itemId, consumption.productId, consumption.quantity]); }
      for (const productId of productIds) await rebuildProductCostLedger(client, request.params.batchId, productId);
      await rebuildQuickSaleCostAllocations(client, id);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); if (error instanceof InventoryTimelineError) return message(reply, 'INSUFFICIENT_INVENTORY_AT_TIME', error.message, 409); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'quick_sale.create', 'quick_sale', id, { itemCount: items.length, totalPrice: money(totalPrice), serviceFee: money(serviceFee) }); return { id };
  });

  app.post<{ Params: { batchId: string; quickSaleId: string }; Body: { reason?: unknown } }>('/api/batches/:batchId/quick-sales/:quickSaleId/reversals', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireBatch(r, reply, request.params.batchId, true); if (!context) return; const reason = optionalText(request.body?.reason, 500); if (!reason) return message(reply, 'INVALID_REVERSAL', '请填写不超过 500 个字的撤销原因'); const client = await getPool().connect();
    try { await client.query('BEGIN'); const sale = (await client.query('SELECT id FROM quick_sales WHERE id=$1 AND batch_id=$2 FOR UPDATE', [request.params.quickSaleId, request.params.batchId])).rows[0] as { id: string } | undefined; if (!sale) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'NOT_FOUND' }); } if ((await client.query('SELECT 1 FROM settlement_bill_quick_sales WHERE quick_sale_id=$1', [sale.id])).rowCount) { await client.query('ROLLBACK'); return message(reply, 'QUICK_SALE_SETTLED', '已纳入账单的快速售出不能撤销', 409); } if ((await client.query('SELECT 1 FROM quick_sale_reversals WHERE quick_sale_id=$1', [sale.id])).rowCount) { await client.query('ROLLBACK'); return message(reply, 'ALREADY_REVERSED', '这笔快速售出已经撤销', 409); } await client.query('SELECT qsc.id FROM quick_sale_inventory_consumptions qsc JOIN quick_sale_items qsi ON qsi.id=qsc.quick_sale_item_id WHERE qsi.quick_sale_id=$1 FOR UPDATE OF qsc', [sale.id]); const products = (await client.query('SELECT DISTINCT qsc.product_id AS "productId" FROM quick_sale_inventory_consumptions qsc JOIN quick_sale_items qsi ON qsi.id=qsc.quick_sale_item_id WHERE qsi.quick_sale_id=$1 ORDER BY qsc.product_id', [sale.id])).rows as Array<{ productId: string }>; await client.query('INSERT INTO quick_sale_reversals(quick_sale_id,reason,created_by) VALUES($1,$2,$3)', [sale.id, reason, r.access!.id]); for (const product of products) await rebuildProductCostLedger(client, request.params.batchId, product.productId); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await audit(context.workspaceId, r.access!.id, 'quick_sale.reverse', 'quick_sale', request.params.quickSaleId, { reason }); return { ok: true };
  });
}
