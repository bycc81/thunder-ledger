import type { PoolClient } from 'pg';

type AmountMap = Map<string, number>;
type EventKind = 'purchase' | 'sale' | 'adjustment';
type Event = { id: string; kind: EventKind; occurredAt: string; occurredAtMs: number; quantity: number; cost?: number; payerUserId?: string; shares?: Array<{ userId: string; amount: number }> };
export type SaleCost = { cost: number; payer: AmountMap; burden: AmountMap };
export class InventoryTimelineError extends Error {
  constructor(event: { kind: 'sale' | 'adjustment'; occurredAt: string; requiredQuantity: number; availableQuantity: number }) {
    const kindText = event.kind === 'sale' ? '销售' : '报损/丢失';
    super(`${formatBusinessTime(event.occurredAt)} 的${kindText}需要 ${event.requiredQuantity} 件，当时库存只有 ${event.availableQuantity} 件。请补录更早的采购，或调整采购/销售时间。`);
    this.name = 'InventoryTimelineError';
  }
}

function split(total: number, source: AmountMap): AmountMap {
  const result = new Map<string, number>(); const weight = [...source.values()].reduce((sum, value) => sum + value, 0);
  if (!total || !weight) return result;
  let used = 0; const rows = [...source].sort(([a], [b]) => a.localeCompare(b));
  for (const [userId, amount] of rows) { const value = Math.floor(total * amount / weight); result.set(userId, value); used += value; }
  for (let index = 0; index < total - used; index += 1) { const userId = rows[index % rows.length][0]; result.set(userId, (result.get(userId) ?? 0) + 1); }
  return result;
}
function subtract(target: AmountMap, values: AmountMap) { for (const [id, amount] of values) target.set(id, (target.get(id) ?? 0) - amount); }
function add(target: AmountMap, id: string, amount: number) { target.set(id, (target.get(id) ?? 0) + amount); }
export function compareInventoryTimelineEvents(a: { id: string; kind: EventKind; occurredAtMs: number }, b: { id: string; kind: EventKind; occurredAtMs: number }): number {
  return a.occurredAtMs - b.occurredAtMs || ({ purchase: 0, adjustment: 1, sale: 2 }[a.kind] - { purchase: 0, adjustment: 1, sale: 2 }[b.kind]) || a.id.localeCompare(b.id);
}
function eventTime(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return { occurredAt: date.toISOString(), occurredAtMs: date.getTime() };
}
function formatBusinessTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23' }).format(new Date(value)).replace(/\//g, '-');
}

/** 按发生时间重放一个商品的混合库存；不会把销售绑定到采购记录。 */
export async function rebuildProductCostLedger(client: PoolClient, batchId: string, productId: string): Promise<{ quantity: number; cost: number; sales: Map<string, SaleCost> }> {
  const [purchasesResult, salesResult, adjustmentsResult] = await Promise.all([
    client.query(`SELECT id,quantity,total_cost_tenths::text AS cost,payer_user_id AS "payerUserId",occurred_at AS "occurredAt" FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2`, [batchId, productId]),
    client.query(`SELECT s.id,s.quantity,s.occurred_at AS "occurredAt" FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=$1 AND s.product_id=$2 AND sr.sale_id IS NULL`, [batchId, productId]),
    client.query('SELECT id,quantity,created_at AS "occurredAt" FROM inventory_adjustments WHERE batch_id=$1 AND product_id=$2', [batchId, productId]),
  ]);
  const purchaseIds = purchasesResult.rows.map((row) => row.id as string);
  const sharesResult = purchaseIds.length ? await client.query('SELECT purchase_id AS "purchaseId",user_id AS "userId",amount_tenths::text AS amount FROM purchase_cost_shares WHERE purchase_id=ANY($1::uuid[])', [purchaseIds]) : { rows: [] as Array<{ purchaseId: string; userId: string; amount: string }> };
  const shares = new Map<string, Array<{ userId: string; amount: number }>>(); for (const row of sharesResult.rows) shares.set(row.purchaseId, [...(shares.get(row.purchaseId) ?? []), { userId: row.userId, amount: Number(row.amount) }]);
  const events: Event[] = [
    ...purchasesResult.rows.map((row) => ({ id: row.id as string, kind: 'purchase' as const, ...eventTime(row.occurredAt), quantity: Number(row.quantity), cost: Number(row.cost), payerUserId: String(row.payerUserId), shares: shares.get(row.id as string) ?? [] })),
    ...salesResult.rows.map((row) => ({ id: row.id as string, kind: 'sale' as const, ...eventTime(row.occurredAt), quantity: Number(row.quantity) })),
    ...adjustmentsResult.rows.map((row) => ({ id: row.id as string, kind: 'adjustment' as const, ...eventTime(row.occurredAt), quantity: Number(row.quantity) })),
  ].sort(compareInventoryTimelineEvents);
  let quantity = 0; let totalCost = 0; const payer = new Map<string, number>(); const burden = new Map<string, number>(); const sales = new Map<string, SaleCost>();
  for (const event of events) {
    if (event.kind === 'purchase') { quantity += event.quantity; totalCost += event.cost ?? 0; add(payer, event.payerUserId!, event.cost ?? 0); for (const share of event.shares ?? []) add(burden, share.userId, share.amount); continue; }
    if (event.quantity > quantity) throw new InventoryTimelineError({ kind: event.kind, occurredAt: event.occurredAt, requiredQuantity: event.quantity, availableQuantity: quantity });
    const cost = event.quantity === quantity ? totalCost : Math.floor(totalCost * event.quantity / quantity); const payerOut = split(cost, payer); const burdenOut = split(cost, burden);
    quantity -= event.quantity; totalCost -= cost; subtract(payer, payerOut); subtract(burden, burdenOut);
    if (event.kind === 'sale') sales.set(event.id, { cost, payer: payerOut, burden: burdenOut });
    else await client.query('UPDATE inventory_adjustments SET consumed_cost_tenths=$2 WHERE id=$1', [event.id, cost]);
  }
  for (const [saleId, value] of sales) {
    await client.query('UPDATE sales SET consumed_cost_tenths=$2 WHERE id=$1', [saleId, value.cost]);
    await client.query('DELETE FROM sale_cost_allocations WHERE sale_id=$1', [saleId]);
    for (const [userId, amount] of value.payer) await client.query("INSERT INTO sale_cost_allocations(sale_id,allocation_type,user_id,amount_tenths) VALUES($1,'payer',$2,$3)", [saleId, userId, amount]);
    for (const [userId, amount] of value.burden) await client.query("INSERT INTO sale_cost_allocations(sale_id,allocation_type,user_id,amount_tenths) VALUES($1,'burden',$2,$3)", [saleId, userId, amount]);
  }
  return { quantity, cost: totalCost, sales };
}

export async function saleAllocations(client: PoolClient, saleIds: string[], type: 'payer' | 'burden'): Promise<Map<string, number>> {
  const rows = saleIds.length ? await client.query('SELECT user_id AS "userId",SUM(amount_tenths)::text AS amount FROM sale_cost_allocations WHERE sale_id=ANY($1::uuid[]) AND allocation_type=$2 GROUP BY user_id', [saleIds, type]) : { rows: [] as Array<{ userId: string; amount: string }> };
  return new Map(rows.rows.map((row) => [row.userId, Number(row.amount)]));
}
