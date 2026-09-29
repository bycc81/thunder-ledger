import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { audit, auth, batchContext, canReadBatch, type AccessRequest, type BatchContext } from './access.js';
import { getPool } from './db/client.js';
import { saleAllocations } from './cost-ledger.js';

type ProfitShareInput = { userId?: unknown; percentage?: unknown };
type SettlementInput = { saleIds?: unknown; quickSaleIds?: unknown; expenseIds?: unknown; profitShares?: unknown };
type Member = { id: string; username: string };
type AdjustmentMember = { userId: string; username: string };
type SaleRow = { id: string; source: 'sale' | 'quick_sale'; productId: string | null; productName: string; productGroupName: string | null; variantName: string | null; quantity: number; totalPriceCents: string; consumedCostCents: string; serviceFeeCents: string; sellerUserId: string; sellerUsername: string; occurredAt: string };
type ExpenseRow = { id: string; saleId: string | null; quickSaleId: string | null; name: string; amountCents: string; payerUserId: string; payerUsername: string; occurredAt: string };
type Calculation = Awaited<ReturnType<typeof calculate>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function money(value: number): string { const sign = value < 0 ? '-' : ''; const absolute = Math.abs(value); return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`; }
export function settlementProfitPercentageBasisPoints(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  const basisPoints = Math.round(value * 100);
  return Math.abs(value * 100 - basisPoints) < 1e-8 ? basisPoints : null;
}
function message(reply: FastifyReply, code: string, text: string, status = 400) { return reply.code(status).send({ code, message: text }); }
function uniqueIds(value: unknown): string[] | null { if (!Array.isArray(value) || !value.length || value.some((id) => !UUID_RE.test(String(id)))) return null; const ids = value.map(String); return new Set(ids).size === ids.length ? ids : null; }
function shareInputs(value: unknown, members: Member[]): Map<string, number> | null {
  if (!Array.isArray(value) || value.length !== members.length) return null;
  const result = new Map<string, number>();
  for (const raw of value as ProfitShareInput[]) {
    const userId = String(raw.userId ?? '');
    if (!members.some((member) => member.id === userId) || result.has(userId)) return null;
    const amount = settlementProfitPercentageBasisPoints((raw as ProfitShareInput).percentage);
    if (amount === null || !Number.isInteger(amount) || amount < 0) return null;
    result.set(userId, amount);
  }
  return result.size === members.length ? result : null;
}
function allocated(total: number, shares: Array<{ userId: string; weight: number }>): Map<string, number> {
  const output = new Map(shares.map(({ userId }) => [userId, 0]));
  const weight = shares.reduce((sum, item) => sum + item.weight, 0);
  if (!weight || !total) return output;
  const sign = total < 0 ? -1 : 1; const magnitude = Math.abs(total); let used = 0;
  for (const item of shares) { const value = Math.floor(magnitude * item.weight / weight); output.set(item.userId, value); used += value; }
  const ordered = [...shares].sort((a, b) => a.userId.localeCompare(b.userId));
  for (let index = 0; index < magnitude - used; index += 1) output.set(ordered[index % ordered.length].userId, (output.get(ordered[index % ordered.length].userId) ?? 0) + 1);
  for (const [id, value] of output) output.set(id, value * sign);
  return output;
}
export function calculateSettlementMemberNet(input: { profitAmount: number; costRecovery: number; salesReceived: number; expensesPaid: number }): number {
  return input.profitAmount + input.costRecovery + input.expensesPaid - input.salesReceived;
}
async function requireSettlementAccess(request: AccessRequest, reply: FastifyReply, batchId: string, write = false): Promise<BatchContext | null> {
  if (!(await auth(request, reply))) return null;
  const context = await batchContext(request, batchId);
  if (!canReadBatch(context)) { await reply.code(404).send({ code: 'NOT_FOUND' }); return null; }
  if (write && context?.batchRole !== 'owner') { await reply.code(403).send({ code: 'FORBIDDEN', message: '只有批次所有者或工作区管理员可以结算' }); return null; }
  if (write) {
    const row = (await getPool().query('SELECT status FROM collaboration_batches WHERE id=$1', [batchId])).rows[0] as { status?: string } | undefined;
    if (row?.status !== 'open') { await message(reply, 'BATCH_CLOSED', '已关闭的批次不能结算', 409); return null; }
  }
  return context;
}
async function members(client: import('pg').PoolClient, batchId: string): Promise<Member[]> { return (await client.query('SELECT u.id,u.username FROM batch_members bm JOIN users u ON u.id=bm.user_id WHERE bm.batch_id=$1 ORDER BY u.id', [batchId])).rows as Member[]; }
async function availableSales(client: import('pg').PoolClient, batchId: string, ids?: string[], lock = false): Promise<SaleRow[]> {
  const idsFilter = ids ? ' AND s.id=ANY($2::uuid[])' : ''; const suffix = lock ? ' FOR UPDATE OF s' : '';
  return (await client.query(`SELECT s.id,'sale' AS source,s.product_id AS "productId",COALESCE(s.product_name_snapshot,p.name) AS "productName",COALESCE(s.product_group_name_snapshot,g.name) AS "productGroupName",COALESCE(s.variant_name_snapshot,p.variant_name) AS "variantName",s.quantity,s.total_price_cents::text AS "totalPriceCents",s.consumed_cost_cents::text AS "consumedCostCents",s.service_fee_cents::text AS "serviceFeeCents",u.id AS "sellerUserId",u.username AS "sellerUsername",s.occurred_at AS "occurredAt" FROM sales s JOIN products p ON p.id=s.product_id LEFT JOIN product_groups g ON g.id=p.group_id JOIN users u ON u.id=s.seller_user_id LEFT JOIN sale_reversals sr ON sr.sale_id=s.id LEFT JOIN settlement_bill_sales sbs ON sbs.sale_id=s.id WHERE s.batch_id=$1 AND sr.sale_id IS NULL AND sbs.sale_id IS NULL${idsFilter} ORDER BY s.occurred_at DESC,s.created_at DESC${suffix}`, ids ? [batchId, ids] : [batchId])).rows as SaleRow[];
}
async function availableQuickSales(client: import('pg').PoolClient, batchId: string, ids?: string[], lock = false): Promise<SaleRow[]> {
  const idsFilter = ids ? ' AND qs.id=ANY($2::uuid[])' : '';
  if (lock && ids?.length) await client.query('SELECT id FROM quick_sales WHERE batch_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE', [batchId, ids]);
  return (await client.query(`SELECT qs.id,'quick_sale' AS source,NULL::uuid AS "productId",string_agg(qsi.name,' + ' ORDER BY qsi.position) AS "productName",NULL::text AS "productGroupName",NULL::text AS "variantName",SUM(qsi.quantity)::int AS quantity,qs.total_price_cents::text AS "totalPriceCents",SUM(qsi.cost_cents)::bigint::text AS "consumedCostCents",qs.service_fee_cents::text AS "serviceFeeCents",u.id AS "sellerUserId",u.username AS "sellerUsername",qs.occurred_at AS "occurredAt" FROM quick_sales qs JOIN quick_sale_items qsi ON qsi.quick_sale_id=qs.id JOIN users u ON u.id=qs.seller_user_id LEFT JOIN quick_sale_reversals qsr ON qsr.quick_sale_id=qs.id LEFT JOIN settlement_bill_quick_sales sbqs ON sbqs.quick_sale_id=qs.id WHERE qs.batch_id=$1 AND qsr.quick_sale_id IS NULL AND sbqs.quick_sale_id IS NULL${idsFilter} GROUP BY qs.id,u.id,u.username ORDER BY qs.occurred_at DESC,qs.created_at DESC`, ids ? [batchId, ids] : [batchId])).rows as SaleRow[];
}
async function transactionAllocations(client: import('pg').PoolClient, sales: SaleRow[], type: 'payer' | 'burden') {
  const normalIds = sales.filter((sale) => sale.source === 'sale').map((sale) => sale.id); const quickIds = sales.filter((sale) => sale.source === 'quick_sale').map((sale) => sale.id); const result = await saleAllocations(client, normalIds, type);
  if (quickIds.length) for (const row of (await client.query('SELECT user_id AS "userId",SUM(amount_cents)::text AS amount FROM quick_sale_cost_allocations WHERE quick_sale_id=ANY($1::uuid[]) AND allocation_type=$2 GROUP BY user_id', [quickIds, type])).rows as Array<{ userId: string; amount: string }>) result.set(row.userId, (result.get(row.userId) ?? 0) + Number(row.amount));
  return result;
}
async function recommendedCosts(client: import('pg').PoolClient, sales: SaleRow[], memberList: Member[]) {
  const allocations = await transactionAllocations(client, sales, 'burden'); return new Map(memberList.map((member) => [member.id, allocations.get(member.id) ?? 0]));
}
async function availableExpenses(client: import('pg').PoolClient, batchId: string, selectedSaleIds: string[], selectedQuickSaleIds: string[], selectedExpenseIds?: string[], lock = false): Promise<ExpenseRow[]> {
  const expenseFilter = selectedExpenseIds ? ' AND e.id=ANY($4::uuid[])' : ''; const suffix = lock ? ' FOR UPDATE OF e' : '';
  return (await client.query(`SELECT e.id,e.sale_id AS "saleId",e.quick_sale_id AS "quickSaleId",e.name,e.amount_cents::text AS "amountCents",u.id AS "payerUserId",u.username AS "payerUsername",e.occurred_at AS "occurredAt" FROM expenses e JOIN users u ON u.id=e.payer_user_id LEFT JOIN expense_reversals er ON er.expense_id=e.id LEFT JOIN settlement_bill_expenses sbe ON sbe.expense_id=e.id WHERE e.batch_id=$1 AND er.expense_id IS NULL AND sbe.expense_id IS NULL AND (e.sale_id IS NULL OR e.sale_id=ANY($2::uuid[]) OR e.quick_sale_id=ANY($3::uuid[]))${expenseFilter} ORDER BY e.occurred_at DESC,e.created_at DESC${suffix}`, selectedExpenseIds ? [batchId, selectedSaleIds, selectedQuickSaleIds, selectedExpenseIds] : [batchId, selectedSaleIds, selectedQuickSaleIds])).rows as ExpenseRow[];
}
async function purchasePayments(client: import('pg').PoolClient, sales: SaleRow[], membersList: Member[]) {
  const allocations = await transactionAllocations(client, sales, 'payer'); return new Map(membersList.map((member) => [member.id, allocations.get(member.id) ?? 0]));
}
async function calculate(client: import('pg').PoolClient, batchId: string, membersList: Member[], sales: SaleRow[], expenses: ExpenseRow[], costShares: Map<string, number>, profitShares: Map<string, number>) {
  const saleTotal = sales.reduce((sum, item) => sum + Number(item.totalPriceCents), 0);
  const serviceFeeTotal = sales.reduce((sum, item) => sum + Number(item.serviceFeeCents), 0);
  const costTotal = sales.reduce((sum, item) => sum + Number(item.consumedCostCents), 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + Number(item.amountCents), 0);
  const profitTotal = saleTotal - serviceFeeTotal - expenseTotal - costTotal;
  // 成本承担是真实经济归属：先分配销售扣费用后的可分配额，再扣减各自承担成本。
  const profitAmounts = allocated(profitTotal, membersList.map((member) => ({ userId: member.id, weight: profitShares.get(member.id) ?? 0 })));
  const salesReceived = new Map(membersList.map((member) => [member.id, 0])); const expensesPaid = new Map(membersList.map((member) => [member.id, 0])); const purchasesPaid = await purchasePayments(client, sales, membersList);
  for (const sale of sales) salesReceived.set(sale.sellerUserId, (salesReceived.get(sale.sellerUserId) ?? 0) + Number(sale.totalPriceCents) - Number(sale.serviceFeeCents));
  for (const expense of expenses) expensesPaid.set(expense.payerUserId, (expensesPaid.get(expense.payerUserId) ?? 0) + Number(expense.amountCents));
  const results = membersList.map((member) => { const cost = costShares.get(member.id) ?? 0; const received = salesReceived.get(member.id) ?? 0; const expensePaid = expensesPaid.get(member.id) ?? 0; const purchasePaid = purchasesPaid.get(member.id) ?? 0; const profit = profitAmounts.get(member.id) ?? 0; return { userId: member.id, username: member.username, costShare: cost, costRecovery: cost, salesReceived: received, purchasesPaid: purchasePaid, expensesPaid: expensePaid, profitPercentage: (profitShares.get(member.id) ?? 0) / 100, profitAmount: profit, net: calculateSettlementMemberNet({ profitAmount: profit, costRecovery: cost, salesReceived: received, expensesPaid: expensePaid }) }; });
  const debtors = results.filter((item) => item.net < 0).map((item) => ({ ...item, remaining: -item.net })); const creditors = results.filter((item) => item.net > 0).map((item) => ({ ...item, remaining: item.net })); const transfers: Array<{ payerUserId: string; payerUsername: string; payeeUserId: string; payeeUsername: string; amount: number }> = [];
  let debtorIndex = 0; let creditorIndex = 0;
  while (debtors[debtorIndex] && creditors[creditorIndex]) { const debtor = debtors[debtorIndex]; const creditor = creditors[creditorIndex]; const amount = Math.min(debtor.remaining, creditor.remaining); if (amount) transfers.push({ payerUserId: debtor.userId, payerUsername: debtor.username, payeeUserId: creditor.userId, payeeUsername: creditor.username, amount }); debtor.remaining -= amount; creditor.remaining -= amount; if (!debtor.remaining) debtorIndex += 1; if (!creditor.remaining) creditorIndex += 1; }
  return { saleTotal, serviceFeeTotal, expenseTotal, costTotal, profitTotal, results, transfers };
}
function present(calculation: Calculation) { return { saleTotal: money(calculation.saleTotal), serviceFeeTotal: money(calculation.serviceFeeTotal), expenseTotal: money(calculation.expenseTotal), costTotal: money(calculation.costTotal), profitTotal: money(calculation.profitTotal), isLoss: calculation.profitTotal < 0, members: calculation.results.map((item) => ({ ...item, costShare: money(item.costShare), costRecovery: money(item.costRecovery), salesReceived: money(item.salesReceived), purchasesPaid: money(item.purchasesPaid), expensesPaid: money(item.expensesPaid), profitAmount: money(item.profitAmount), net: money(item.net), direction: item.net > 0 ? 'receivable' : item.net < 0 ? 'payable' : 'settled' })), transfers: calculation.transfers.map((item) => ({ ...item, amount: money(item.amount) })) }; }
async function validateAndCalculate(client: import('pg').PoolClient, batchId: string, input: SettlementInput, lock = false) {
  if (Object.prototype.hasOwnProperty.call(input as object, 'costShares')) return { error: '结算时不能填写成本承担，请修改采购记录' };
  const saleIds = uniqueIds(input.saleIds) ?? []; const quickSaleIds = uniqueIds(input.quickSaleIds) ?? []; const expenseIds = Array.isArray(input.expenseIds) && input.expenseIds.every((id) => UUID_RE.test(String(id))) ? input.expenseIds.map(String) : null;
  if ((!saleIds.length && !quickSaleIds.length) || !expenseIds || new Set(expenseIds).size !== expenseIds.length) return { error: '请选择有效的销售和费用' };
  const memberList = await members(client, batchId); const profits = shareInputs(input.profitShares, memberList);
  if (!profits) return { error: '请为每位批次参与人填写利润比例' };
  const normalSales = saleIds.length ? await availableSales(client, batchId, saleIds, lock) : []; const quickSales = quickSaleIds.length ? await availableQuickSales(client, batchId, quickSaleIds, lock) : []; const sales = [...normalSales, ...quickSales]; if (normalSales.length !== saleIds.length || quickSales.length !== quickSaleIds.length) return { error: '部分销售已撤销或已结账，请重新加载' };
  const related = await availableExpenses(client, batchId, saleIds, quickSaleIds, undefined, lock); const requiredExpenseIds = related.filter((expense) => expense.saleId !== null || expense.quickSaleId !== null).map((expense) => expense.id); const allExpenseIds = [...new Set([...expenseIds, ...requiredExpenseIds])]; const expenses = await availableExpenses(client, batchId, saleIds, quickSaleIds, allExpenseIds, lock);
  if (expenses.length !== allExpenseIds.length) return { error: '部分费用无效、已撤销或已纳入其他账单，请重新加载' };
  const costs = await recommendedCosts(client, sales, memberList);
  if ([...profits.values()].reduce((sum, amount) => sum + amount, 0) !== 10000) return { error: '利润比例合计必须是 100%' };
  return { value: { sales, expenses, memberList, costs, profits, calculation: await calculate(client, batchId, memberList, sales, expenses, costs, profits) } };
}

type CorrectionPurchase = { id: string; oldQuantity: number; newQuantity: number; oldCost: number; newCost: number; oldPayerUserId: string; newPayerUserId: string; oldShares: Array<{ userId: string; amount: number }>; newShares: Array<{ userId: string; amount: number }> };

/** 在采购更正事务中，为已确认账单写入不可变的增量调整快照。 */
export async function createPurchaseCorrectionAdjustments(client: import('pg').PoolClient, batchId: string, productId: string, correctionId: string, createdBy: string, purchase: CorrectionPurchase, oldPool: { quantity: number; cost: number }, newPool: { quantity: number; cost: number }) {
  const payerRows = (await client.query('SELECT payer_user_id AS "userId",SUM(total_cost_cents)::text AS amount FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2 GROUP BY payer_user_id', [batchId, productId])).rows as Array<{ userId: string; amount: string }>;
  const shareRows = (await client.query('SELECT pcs.user_id AS "userId",SUM(pcs.amount_cents)::text AS amount FROM purchase_cost_shares pcs JOIN inventory_purchases ip ON ip.id=pcs.purchase_id WHERE ip.batch_id=$1 AND ip.product_id=$2 GROUP BY pcs.user_id', [batchId, productId])).rows as Array<{ userId: string; amount: string }>;
  const adjust = (rows: Array<{ userId: string; amount: string }>, removeUserId: string, removeAmount: number, addUserId: string, addAmount: number) => {
    const totals = new Map(rows.map((row) => [row.userId, Number(row.amount)])); totals.set(removeUserId, (totals.get(removeUserId) ?? 0) - removeAmount); totals.set(addUserId, (totals.get(addUserId) ?? 0) + addAmount);
    return [...totals].filter(([, amount]) => amount > 0).map(([userId, amount]) => ({ userId, weight: amount }));
  };
  const newPayers = payerRows.map((row) => ({ userId: row.userId, weight: Number(row.amount) }));
  const oldPayers = adjust(payerRows, purchase.newPayerUserId, purchase.newCost, purchase.oldPayerUserId, purchase.oldCost);
  const newShares = shareRows.map((row) => ({ userId: row.userId, weight: Number(row.amount) }));
  const oldShares = new Map(shareRows.map((row) => [row.userId, Number(row.amount)]));
  for (const share of purchase.newShares) oldShares.set(share.userId, (oldShares.get(share.userId) ?? 0) - share.amount);
  for (const share of purchase.oldShares) oldShares.set(share.userId, (oldShares.get(share.userId) ?? 0) + share.amount);
  const oldShareWeights = [...oldShares].filter(([, amount]) => amount > 0).map(([userId, weight]) => ({ userId, weight }));
  const affected = (await client.query(`SELECT sb.id AS "billId",SUM(s.quantity)::int AS quantity FROM settlement_bills sb JOIN settlement_bill_sales sbs ON sbs.settlement_bill_id=sb.id JOIN sales s ON s.id=sbs.sale_id WHERE sb.batch_id=$1 AND s.product_id=$2 GROUP BY sb.id`, [batchId, productId])).rows as Array<{ billId: string; quantity: number }>;
  for (const bill of affected) {
    const oldCost = oldPool.quantity ? Math.floor(oldPool.cost * bill.quantity / oldPool.quantity) : 0;
    const newCost = newPool.quantity ? Math.floor(newPool.cost * bill.quantity / newPool.quantity) : 0;
    const adjustmentId = randomUUID();
    await client.query('INSERT INTO settlement_adjustment_bills(id,batch_id,settlement_bill_id,purchase_correction_id,old_cost_cents,new_cost_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [adjustmentId, batchId, bill.billId, correctionId, oldCost, newCost, createdBy]);
    const memberRows = (await client.query('SELECT user_id AS "userId",username FROM settlement_member_results WHERE settlement_bill_id=$1', [bill.billId])).rows as AdjustmentMember[];
    const ids = new Set([...memberRows.map((row) => row.userId), ...oldPayers.map((row) => row.userId), ...newPayers.map((row) => row.userId), ...oldShareWeights.map((row) => row.userId), ...newShares.map((row) => row.userId)]);
    const names = new Map(memberRows.map((row) => [row.userId, row.username]));
    if (ids.size) {
      const users = (await client.query('SELECT id,username FROM users WHERE id=ANY($1::uuid[])', [[...ids]])).rows as Member[]; for (const user of users) names.set(user.id, user.username);
    }
    const oldPaid = allocated(oldCost, oldPayers); const newPaid = allocated(newCost, newPayers); const oldBurden = allocated(oldCost, oldShareWeights); const newBurden = allocated(newCost, newShares);
    const results = [...ids].map((userId) => ({ userId, username: names.get(userId) ?? '已移除成员', oldCost: oldBurden.get(userId) ?? 0, newCost: newBurden.get(userId) ?? 0, oldPaid: oldPaid.get(userId) ?? 0, newPaid: newPaid.get(userId) ?? 0 })).map((row) => ({ ...row, delta: row.newPaid - row.oldPaid - (row.newCost - row.oldCost) }));
    for (const row of results) await client.query('INSERT INTO settlement_adjustment_member_results(adjustment_bill_id,user_id,username,old_cost_share_cents,new_cost_share_cents,old_purchase_paid_cents,new_purchase_paid_cents,net_delta_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [adjustmentId, row.userId, row.username, row.oldCost, row.newCost, row.oldPaid, row.newPaid, row.delta]);
    const debtors = results.filter((row) => row.delta < 0).map((row) => ({ ...row, remaining: -row.delta })); const creditors = results.filter((row) => row.delta > 0).map((row) => ({ ...row, remaining: row.delta })); let debtor = 0; let creditor = 0; let sequence = 1;
    while (debtors[debtor] && creditors[creditor]) { const amount = Math.min(debtors[debtor].remaining, creditors[creditor].remaining); if (amount) await client.query('INSERT INTO settlement_adjustment_transfers(adjustment_bill_id,sequence,payer_user_id,payer_username,payee_user_id,payee_username,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7)', [adjustmentId, sequence++, debtors[debtor].userId, debtors[debtor].username, creditors[creditor].userId, creditors[creditor].username, amount]); debtors[debtor].remaining -= amount; creditors[creditor].remaining -= amount; if (!debtors[debtor].remaining) debtor += 1; if (!creditors[creditor].remaining) creditor += 1; }
  }
}

export async function registerSettlementRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { batchId: string } }>('/api/batches/:batchId/settlements', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId); if (!context) return;
    const pool = getPool(); const unsettled = await pool.query(`SELECT (
      (SELECT COUNT(*) FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id LEFT JOIN settlement_bill_sales sbs ON sbs.sale_id=s.id WHERE s.batch_id=$1 AND sr.sale_id IS NULL AND sbs.sale_id IS NULL)
      +
      (SELECT COUNT(*) FROM quick_sales qs LEFT JOIN quick_sale_reversals qsr ON qsr.quick_sale_id=qs.id LEFT JOIN settlement_bill_quick_sales sbqs ON sbqs.quick_sale_id=qs.id WHERE qs.batch_id=$1 AND qsr.quick_sale_id IS NULL AND sbqs.quick_sale_id IS NULL)
    )::int AS count`, [request.params.batchId]);
    const bills = await pool.query(`SELECT sb.id,sb.confirmed_at AS "confirmedAt",sb.profit_total_cents::text AS "profitTotalCents",(
      (SELECT COUNT(*) FROM settlement_bill_sales sbs WHERE sbs.settlement_bill_id=sb.id)
      +
      (SELECT COUNT(*) FROM settlement_bill_quick_sales sbqs WHERE sbqs.settlement_bill_id=sb.id)
    )::int AS "saleCount" FROM settlement_bills sb WHERE sb.batch_id=$1 ORDER BY sb.confirmed_at DESC`, [request.params.batchId]);
    const adjustments = await pool.query(`SELECT sab.id,sab.settlement_bill_id AS "settlementBillId",sab.status,sab.created_at AS "createdAt",sab.old_cost_cents::text AS "oldCostCents",sab.new_cost_cents::text AS "newCostCents" FROM settlement_adjustment_bills sab WHERE sab.batch_id=$1 AND sab.status='pending' ORDER BY sab.created_at DESC`, [request.params.batchId]);
    return { unsettledSaleCount: unsettled.rows[0]?.count ?? 0, canManage: context.batchRole === 'owner', bills: bills.rows.map((bill: { profitTotalCents: string }) => ({ ...bill, profitTotal: money(Number(bill.profitTotalCents)) })), adjustments: adjustments.rows.map((item: Record<string, string>) => ({ id: item.id, settlementBillId: item.settlementBillId, status: item.status, createdAt: item.createdAt, oldCost: money(Number(item.oldCostCents)), newCost: money(Number(item.newCostCents)) })) };
  });
  app.get<{ Params: { batchId: string; adjustmentId: string } }>('/api/batches/:batchId/settlement-adjustments/:adjustmentId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId); if (!context) return;
    const pool = getPool(); const bill = (await pool.query(`SELECT sab.id,sab.settlement_bill_id AS "settlementBillId",sab.status,sab.created_at AS "createdAt",sab.confirmed_at AS "confirmedAt",sab.old_cost_cents::text AS "oldCostCents",sab.new_cost_cents::text AS "newCostCents" FROM settlement_adjustment_bills sab WHERE sab.id=$1 AND sab.batch_id=$2`, [request.params.adjustmentId, request.params.batchId])).rows[0] as Record<string, string> | undefined;
    if (!bill) return reply.code(404).send({ code: 'NOT_FOUND' });
    const [membersResult, transfersResult] = await Promise.all([pool.query('SELECT user_id AS "userId",username,old_cost_share_cents::text AS "oldCostCents",new_cost_share_cents::text AS "newCostCents",old_purchase_paid_cents::text AS "oldPaidCents",new_purchase_paid_cents::text AS "newPaidCents",net_delta_cents::text AS "netDeltaCents" FROM settlement_adjustment_member_results WHERE adjustment_bill_id=$1 ORDER BY username', [bill.id]), pool.query('SELECT payer_user_id AS "payerUserId",payer_username AS "payerUsername",payee_user_id AS "payeeUserId",payee_username AS "payeeUsername",amount_cents::text AS "amountCents" FROM settlement_adjustment_transfers WHERE adjustment_bill_id=$1 ORDER BY sequence', [bill.id])]);
    return { id: bill.id, settlementBillId: bill.settlementBillId, status: bill.status, canManage: context.batchRole === 'owner', createdAt: bill.createdAt, confirmedAt: bill.confirmedAt ?? null, oldCost: money(Number(bill.oldCostCents)), newCost: money(Number(bill.newCostCents)), members: membersResult.rows.map((row: Record<string, string>) => ({ userId: row.userId, username: row.username, oldCost: money(Number(row.oldCostCents)), newCost: money(Number(row.newCostCents)), oldPaid: money(Number(row.oldPaidCents)), newPaid: money(Number(row.newPaidCents)), netDelta: money(Number(row.netDeltaCents)), direction: Number(row.netDeltaCents) > 0 ? 'receivable' : Number(row.netDeltaCents) < 0 ? 'payable' : 'settled' })), transfers: transfersResult.rows.map((row: Record<string, string>) => ({ ...row, amount: money(Number(row.amountCents)) })) };
  });
  app.post<{ Params: { batchId: string; adjustmentId: string } }>('/api/batches/:batchId/settlement-adjustments/:adjustmentId/confirm', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const result = await getPool().query(`UPDATE settlement_adjustment_bills SET status='confirmed',confirmed_by=$3,confirmed_at=now() WHERE id=$1 AND batch_id=$2 AND status='pending' RETURNING id`, [request.params.adjustmentId, request.params.batchId, r.access!.id]);
    if (!result.rowCount) return message(reply, 'ADJUSTMENT_NOT_PENDING', '调整单不存在或已确认', 409);
    await audit(context.workspaceId, r.access!.id, 'settlement.adjustment.confirm', 'settlement_adjustment_bill', request.params.adjustmentId, {}); return { ok: true };
  });
  app.get<{ Params: { batchId: string } }>('/api/batches/:batchId/settlements/draft', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const client = await getPool().connect(); try { const memberList = await members(client, request.params.batchId); const sales = await availableSales(client, request.params.batchId); const quickSales = await availableQuickSales(client, request.params.batchId); const expenses = (await client.query(`SELECT e.id,e.sale_id AS "saleId",e.quick_sale_id AS "quickSaleId",e.name,e.amount_cents::text AS "amountCents",u.id AS "payerUserId",u.username AS "payerUsername",e.occurred_at AS "occurredAt" FROM expenses e JOIN users u ON u.id=e.payer_user_id LEFT JOIN expense_reversals er ON er.expense_id=e.id LEFT JOIN settlement_bill_expenses sbe ON sbe.expense_id=e.id WHERE e.batch_id=$1 AND er.expense_id IS NULL AND sbe.expense_id IS NULL ORDER BY e.occurred_at DESC,e.created_at DESC`, [request.params.batchId])).rows as ExpenseRow[]; const transactions = [...sales, ...quickSales].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).map((sale) => ({ ...sale, sourceLabel: sale.source === 'quick_sale' ? '快速售出' : '普通销售', displayName: sale.productGroupName && sale.variantName ? `${sale.productGroupName} · ${sale.variantName}` : sale.productName, totalPrice: money(Number(sale.totalPriceCents)), consumedCost: money(Number(sale.consumedCostCents)) })); return { members: memberList, transactions, sales: transactions.filter((sale) => sale.source === 'sale'), expenses: expenses.map((expense) => ({ ...expense, amount: money(Number(expense.amountCents)) })) }; } finally { client.release(); }
  });
  app.post<{ Params: { batchId: string }; Body: { saleIds?: unknown; quickSaleIds?: unknown } }>('/api/batches/:batchId/settlements/recommendation', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const saleIds = uniqueIds(request.body?.saleIds) ?? []; const quickSaleIds = uniqueIds(request.body?.quickSaleIds) ?? []; if (!saleIds.length && !quickSaleIds.length) return message(reply, 'NO_SETTLABLE_SALES', '请至少选择一笔销售'); const client = await getPool().connect();
    try { const sales = await availableSales(client, request.params.batchId, saleIds); const quickSales = await availableQuickSales(client, request.params.batchId, quickSaleIds); if (sales.length !== saleIds.length || quickSales.length !== quickSaleIds.length) return message(reply, 'SETTLEMENT_CONFLICT', '部分销售已撤销或已结账，请重新加载', 409); const memberList = await members(client, request.params.batchId); const recommendations = await recommendedCosts(client, [...sales, ...quickSales], memberList); return { costTotal: money([...sales, ...quickSales].reduce((sum, sale) => sum + Number(sale.consumedCostCents), 0)), costShares: memberList.map((member) => ({ userId: member.id, amount: money(recommendations.get(member.id) ?? 0) })) }; } finally { client.release(); }
  });
  app.post<{ Params: { batchId: string }; Body: SettlementInput }>('/api/batches/:batchId/settlements/preview', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const client = await getPool().connect(); try { const checked = await validateAndCalculate(client, request.params.batchId, request.body ?? {}); if (!checked.value) return message(reply, 'INVALID_SETTLEMENT', checked.error ?? '结算数据无效'); return present(checked.value.calculation); } finally { client.release(); }
  });
  app.post<{ Params: { batchId: string }; Body: SettlementInput }>('/api/batches/:batchId/settlements', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const client = await getPool().connect(); const id = randomUUID();
    try { await client.query('BEGIN'); const checked = await validateAndCalculate(client, request.params.batchId, request.body ?? {}, true); if (!checked.value) { await client.query('ROLLBACK'); return message(reply, 'INVALID_SETTLEMENT', checked.error ?? '结算数据无效', 409); } const value = checked.value; const calculation = value.calculation;
      await client.query('INSERT INTO settlement_bills(id,batch_id,sale_total_cents,service_fee_total_cents,expense_total_cents,cost_total_cents,profit_total_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, request.params.batchId, calculation.saleTotal, calculation.serviceFeeTotal, calculation.expenseTotal, calculation.costTotal, calculation.profitTotal, r.access!.id]);
      for (const sale of value.sales) { if (sale.source === 'sale') await client.query('INSERT INTO settlement_bill_sales(settlement_bill_id,sale_id,product_name,product_group_name,variant_name,quantity,total_price_cents,consumed_cost_cents,service_fee_cents,seller_user_id,seller_username,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [id, sale.id, sale.productName, sale.productGroupName, sale.variantName, sale.quantity, sale.totalPriceCents, sale.consumedCostCents, sale.serviceFeeCents, sale.sellerUserId, sale.sellerUsername, sale.occurredAt]); else await client.query('INSERT INTO settlement_bill_quick_sales(settlement_bill_id,quick_sale_id,item_summary,quantity,total_price_cents,consumed_cost_cents,service_fee_cents,seller_user_id,seller_username,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, sale.id, sale.productName, sale.quantity, sale.totalPriceCents, sale.consumedCostCents, sale.serviceFeeCents, sale.sellerUserId, sale.sellerUsername, sale.occurredAt]); }
      for (const expense of value.expenses) await client.query('INSERT INTO settlement_bill_expenses(settlement_bill_id,expense_id,sale_id,quick_sale_id,name,amount_cents,payer_user_id,payer_username,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, expense.id, expense.saleId, expense.quickSaleId, expense.name, expense.amountCents, expense.payerUserId, expense.payerUsername, expense.occurredAt]);
      for (const member of value.memberList) { const result = calculation.results.find((item) => item.userId === member.id)!; await client.query('INSERT INTO settlement_cost_shares(settlement_bill_id,user_id,username,amount_cents) VALUES($1,$2,$3,$4)', [id, member.id, member.username, result.costShare]); await client.query('INSERT INTO settlement_profit_shares(settlement_bill_id,user_id,username,percentage,amount_cents) VALUES($1,$2,$3,$4,$5)', [id, member.id, member.username, result.profitPercentage, result.profitAmount]); await client.query('INSERT INTO settlement_member_results(settlement_bill_id,user_id,username,cost_share_cents,cost_recovery_cents,sales_received_cents,purchases_paid_cents,expenses_paid_cents,profit_percentage,profit_amount_cents,net_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, member.id, member.username, result.costShare, result.costRecovery, result.salesReceived, result.purchasesPaid, result.expensesPaid, result.profitPercentage, result.profitAmount, result.net]); }
      for (const [sequence, transfer] of calculation.transfers.entries()) await client.query('INSERT INTO settlement_transfer_suggestions(settlement_bill_id,sequence,payer_user_id,payer_username,payee_user_id,payee_username,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, sequence + 1, transfer.payerUserId, transfer.payerUsername, transfer.payeeUserId, transfer.payeeUsername, transfer.amount]);
      await client.query('COMMIT'); await audit(context.workspaceId, r.access!.id, 'settlement.confirm', 'settlement_bill', id, { saleCount: value.sales.length, expenseCount: value.expenses.length, profitTotal: money(calculation.profitTotal) }); return { id, ...present(calculation) };
    } catch (error: unknown) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') return message(reply, 'SETTLEMENT_CONFLICT', '部分销售或费用已被结账，请重新加载', 409); throw error; } finally { client.release(); }
  });
  app.get<{ Params: { batchId: string; settlementId: string } }>('/api/batches/:batchId/settlements/:settlementId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId); if (!context) return;
    const bill = (await getPool().query('SELECT id,confirmed_at AS "confirmedAt",sale_total_cents::text AS "saleTotalCents",service_fee_total_cents::text AS "serviceFeeTotalCents",expense_total_cents::text AS "expenseTotalCents",cost_total_cents::text AS "costTotalCents",profit_total_cents::text AS "profitTotalCents" FROM settlement_bills WHERE id=$1 AND batch_id=$2', [request.params.settlementId, request.params.batchId])).rows[0] as { id: string; confirmedAt: string; saleTotalCents: string; serviceFeeTotalCents: string; expenseTotalCents: string; costTotalCents: string; profitTotalCents: string } | undefined;
    if (!bill) return reply.code(404).send({ code: 'NOT_FOUND' }); const pool = getPool(); const [memberRows, transferRows, sales, quickSales, expenses, adjustments] = await Promise.all([pool.query('SELECT user_id AS "userId",username,cost_share_cents::text AS "costShareCents",cost_recovery_cents::text AS "costRecoveryCents",sales_received_cents::text AS "salesReceivedCents",purchases_paid_cents::text AS "purchasesPaidCents",expenses_paid_cents::text AS "expensesPaidCents",profit_percentage AS "profitPercentage",profit_amount_cents::text AS "profitAmountCents",net_cents::text AS "netCents" FROM settlement_member_results WHERE settlement_bill_id=$1 ORDER BY username', [bill.id]), pool.query('SELECT payer_user_id AS "payerUserId",payer_username AS "payerUsername",payee_user_id AS "payeeUserId",payee_username AS "payeeUsername",amount_cents::text AS "amountCents" FROM settlement_transfer_suggestions WHERE settlement_bill_id=$1 ORDER BY sequence', [bill.id]), pool.query('SELECT sale_id AS id,product_name AS "productName",product_group_name AS "productGroupName",variant_name AS "variantName",quantity,total_price_cents::text AS "totalPriceCents",consumed_cost_cents::text AS "consumedCostCents",service_fee_cents::text AS "serviceFeeCents",seller_username AS "sellerUsername",occurred_at AS "occurredAt" FROM settlement_bill_sales WHERE settlement_bill_id=$1 ORDER BY occurred_at DESC', [bill.id]), pool.query('SELECT quick_sale_id AS id,item_summary AS "productName",quantity,total_price_cents::text AS "totalPriceCents",consumed_cost_cents::text AS "consumedCostCents",service_fee_cents::text AS "serviceFeeCents",seller_username AS "sellerUsername",occurred_at AS "occurredAt" FROM settlement_bill_quick_sales WHERE settlement_bill_id=$1 ORDER BY occurred_at DESC', [bill.id]), pool.query('SELECT expense_id AS id,sale_id AS "saleId",quick_sale_id AS "quickSaleId",name,amount_cents::text AS "amountCents",payer_username AS "payerUsername",occurred_at AS "occurredAt" FROM settlement_bill_expenses WHERE settlement_bill_id=$1 ORDER BY occurred_at DESC', [bill.id]), pool.query('SELECT id,status,created_at AS "createdAt",old_cost_cents::text AS "oldCostCents",new_cost_cents::text AS "newCostCents" FROM settlement_adjustment_bills WHERE settlement_bill_id=$1 ORDER BY created_at DESC', [bill.id])]);
    return { id: bill.id, confirmedAt: bill.confirmedAt, saleTotal: money(Number(bill.saleTotalCents)), serviceFeeTotal: money(Number(bill.serviceFeeTotalCents)), expenseTotal: money(Number(bill.expenseTotalCents)), costTotal: money(Number(bill.costTotalCents)), profitTotal: money(Number(bill.profitTotalCents)), isLoss: Number(bill.profitTotalCents) < 0, members: memberRows.rows.map((item: Record<string, string | number>) => ({ userId: item.userId, username: item.username, costShare: money(Number(item.costShareCents)), costRecovery: money(Number(item.costRecoveryCents)), salesReceived: money(Number(item.salesReceivedCents)), purchasesPaid: money(Number(item.purchasesPaidCents)), expensesPaid: money(Number(item.expensesPaidCents)), profitPercentage: Number(item.profitPercentage), profitAmount: money(Number(item.profitAmountCents)), net: money(Number(item.netCents)), direction: Number(item.netCents) > 0 ? 'receivable' : Number(item.netCents) < 0 ? 'payable' : 'settled' })), transfers: transferRows.rows.map((item: Record<string, string>) => ({ payerUserId: item.payerUserId, payerUsername: item.payerUsername, payeeUserId: item.payeeUserId, payeeUsername: item.payeeUsername, amount: money(Number(item.amountCents)) })), transactions: [...sales.rows.map((item: Record<string, string | number>) => ({ ...item, source: 'sale' as const, sourceLabel: '普通销售', totalPrice: money(Number(item.totalPriceCents)), consumedCost: money(Number(item.consumedCostCents)), serviceFee: money(Number(item.serviceFeeCents)) })), ...quickSales.rows.map((item: Record<string, string | number>) => ({ ...item, source: 'quick_sale' as const, sourceLabel: '快速售出', productGroupName: null, variantName: null, totalPrice: money(Number(item.totalPriceCents)), consumedCost: money(Number(item.consumedCostCents)), serviceFee: money(Number(item.serviceFeeCents)) }))].sort((a, b) => new Date(String((a as unknown as { occurredAt: string }).occurredAt)).getTime() - new Date(String((b as unknown as { occurredAt: string }).occurredAt)).getTime()), sales: sales.rows.map((item: Record<string, string | number>) => ({ ...item, totalPrice: money(Number(item.totalPriceCents)), consumedCost: money(Number(item.consumedCostCents)), serviceFee: money(Number(item.serviceFeeCents)) })), expenses: expenses.rows.map((item: Record<string, string | null>) => ({ ...item, amount: money(Number(item.amountCents)) })), adjustments: adjustments.rows.map((item: Record<string, string>) => ({ id: item.id, status: item.status, createdAt: item.createdAt, oldCost: money(Number(item.oldCostCents)), newCost: money(Number(item.newCostCents)) })) };
  });
}
