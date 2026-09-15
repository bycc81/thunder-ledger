import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { audit, auth, batchContext, canReadBatch, type AccessRequest, type BatchContext } from './access.js';
import { getPool } from './db/client.js';
import { saleAllocations } from './cost-ledger.js';

type ProfitShareInput = { userId?: unknown; percentage?: unknown };
type SettlementInput = { saleIds?: unknown; expenseIds?: unknown; profitShares?: unknown };
type Member = { id: string; username: string };
type AdjustmentMember = { userId: string; username: string };
type SaleRow = { id: string; productId: string; productName: string; quantity: number; totalPriceTenths: string; consumedCostTenths: string; sellerUserId: string; sellerUsername: string; occurredAt: string };
type ExpenseRow = { id: string; saleId: string | null; name: string; amountTenths: string; payerUserId: string; payerUsername: string; occurredAt: string };
type Calculation = Awaited<ReturnType<typeof calculate>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function money(value: number): string { const sign = value < 0 ? '-' : ''; const absolute = Math.abs(value); return `${sign}${Math.floor(absolute / 10)}.${absolute % 10}`; }
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
  return (await client.query(`SELECT s.id,s.product_id AS "productId",p.name AS "productName",s.quantity,s.total_price_tenths::text AS "totalPriceTenths",s.consumed_cost_tenths::text AS "consumedCostTenths",u.id AS "sellerUserId",u.username AS "sellerUsername",s.occurred_at AS "occurredAt" FROM sales s JOIN products p ON p.id=s.product_id JOIN users u ON u.id=s.seller_user_id LEFT JOIN sale_reversals sr ON sr.sale_id=s.id LEFT JOIN settlement_bill_sales sbs ON sbs.sale_id=s.id WHERE s.batch_id=$1 AND sr.sale_id IS NULL AND sbs.sale_id IS NULL${idsFilter} ORDER BY s.occurred_at DESC,s.created_at DESC${suffix}`, ids ? [batchId, ids] : [batchId])).rows as SaleRow[];
}
async function recommendedCosts(client: import('pg').PoolClient, batchId: string, sales: SaleRow[], memberList: Member[]) {
  const allocations = await saleAllocations(client, sales.map((sale) => sale.id), 'burden'); return new Map(memberList.map((member) => [member.id, allocations.get(member.id) ?? 0]));
}
async function availableExpenses(client: import('pg').PoolClient, batchId: string, selectedSaleIds: string[], selectedExpenseIds?: string[], lock = false): Promise<ExpenseRow[]> {
  const expenseFilter = selectedExpenseIds ? ' AND e.id=ANY($3::uuid[])' : ''; const suffix = lock ? ' FOR UPDATE OF e' : '';
  return (await client.query(`SELECT e.id,e.sale_id AS "saleId",e.name,e.amount_tenths::text AS "amountTenths",u.id AS "payerUserId",u.username AS "payerUsername",e.occurred_at AS "occurredAt" FROM expenses e JOIN users u ON u.id=e.payer_user_id LEFT JOIN expense_reversals er ON er.expense_id=e.id LEFT JOIN settlement_bill_expenses sbe ON sbe.expense_id=e.id WHERE e.batch_id=$1 AND er.expense_id IS NULL AND sbe.expense_id IS NULL AND (e.sale_id IS NULL OR e.sale_id=ANY($2::uuid[]))${expenseFilter} ORDER BY e.occurred_at DESC,e.created_at DESC${suffix}`, selectedExpenseIds ? [batchId, selectedSaleIds, selectedExpenseIds] : [batchId, selectedSaleIds])).rows as ExpenseRow[];
}
async function purchasePayments(client: import('pg').PoolClient, batchId: string, sales: SaleRow[], membersList: Member[]) {
  const allocations = await saleAllocations(client, sales.map((sale) => sale.id), 'payer'); return new Map(membersList.map((member) => [member.id, allocations.get(member.id) ?? 0]));
}
async function calculate(client: import('pg').PoolClient, batchId: string, membersList: Member[], sales: SaleRow[], expenses: ExpenseRow[], costShares: Map<string, number>, profitShares: Map<string, number>) {
  const saleTotal = sales.reduce((sum, item) => sum + Number(item.totalPriceTenths), 0);
  const costTotal = sales.reduce((sum, item) => sum + Number(item.consumedCostTenths), 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + Number(item.amountTenths), 0);
  const profitTotal = saleTotal - expenseTotal - costTotal;
  // 成本承担是真实经济归属：先分配销售扣费用后的可分配额，再扣减各自承担成本。
  const profitAmounts = allocated(profitTotal, membersList.map((member) => ({ userId: member.id, weight: profitShares.get(member.id) ?? 0 })));
  const salesReceived = new Map(membersList.map((member) => [member.id, 0])); const expensesPaid = new Map(membersList.map((member) => [member.id, 0])); const purchasesPaid = await purchasePayments(client, batchId, sales, membersList);
  for (const sale of sales) salesReceived.set(sale.sellerUserId, (salesReceived.get(sale.sellerUserId) ?? 0) + Number(sale.totalPriceTenths));
  for (const expense of expenses) expensesPaid.set(expense.payerUserId, (expensesPaid.get(expense.payerUserId) ?? 0) + Number(expense.amountTenths));
  const results = membersList.map((member) => { const cost = costShares.get(member.id) ?? 0; const received = salesReceived.get(member.id) ?? 0; const expensePaid = expensesPaid.get(member.id) ?? 0; const purchasePaid = purchasesPaid.get(member.id) ?? 0; const profit = profitAmounts.get(member.id) ?? 0; return { userId: member.id, username: member.username, costShare: cost, costRecovery: cost, salesReceived: received, purchasesPaid: purchasePaid, expensesPaid: expensePaid, profitPercentage: (profitShares.get(member.id) ?? 0) / 100, profitAmount: profit, net: calculateSettlementMemberNet({ profitAmount: profit, costRecovery: cost, salesReceived: received, expensesPaid: expensePaid }) }; });
  const debtors = results.filter((item) => item.net < 0).map((item) => ({ ...item, remaining: -item.net })); const creditors = results.filter((item) => item.net > 0).map((item) => ({ ...item, remaining: item.net })); const transfers: Array<{ payerUserId: string; payerUsername: string; payeeUserId: string; payeeUsername: string; amount: number }> = [];
  let debtorIndex = 0; let creditorIndex = 0;
  while (debtors[debtorIndex] && creditors[creditorIndex]) { const debtor = debtors[debtorIndex]; const creditor = creditors[creditorIndex]; const amount = Math.min(debtor.remaining, creditor.remaining); if (amount) transfers.push({ payerUserId: debtor.userId, payerUsername: debtor.username, payeeUserId: creditor.userId, payeeUsername: creditor.username, amount }); debtor.remaining -= amount; creditor.remaining -= amount; if (!debtor.remaining) debtorIndex += 1; if (!creditor.remaining) creditorIndex += 1; }
  return { saleTotal, expenseTotal, costTotal, profitTotal, results, transfers };
}
function present(calculation: Calculation) { return { saleTotal: money(calculation.saleTotal), expenseTotal: money(calculation.expenseTotal), costTotal: money(calculation.costTotal), profitTotal: money(calculation.profitTotal), isLoss: calculation.profitTotal < 0, members: calculation.results.map((item) => ({ ...item, costShare: money(item.costShare), costRecovery: money(item.costRecovery), salesReceived: money(item.salesReceived), purchasesPaid: money(item.purchasesPaid), expensesPaid: money(item.expensesPaid), profitAmount: money(item.profitAmount), net: money(item.net), direction: item.net > 0 ? 'receivable' : item.net < 0 ? 'payable' : 'settled' })), transfers: calculation.transfers.map((item) => ({ ...item, amount: money(item.amount) })) }; }
async function validateAndCalculate(client: import('pg').PoolClient, batchId: string, input: SettlementInput, lock = false) {
  if (Object.prototype.hasOwnProperty.call(input as object, 'costShares')) return { error: '结算时不能填写成本承担，请修改采购记录' };
  const saleIds = uniqueIds(input.saleIds); const expenseIds = Array.isArray(input.expenseIds) && input.expenseIds.every((id) => UUID_RE.test(String(id))) ? input.expenseIds.map(String) : null;
  if (!saleIds || !expenseIds || new Set(expenseIds).size !== expenseIds.length) return { error: '请选择有效的销售和费用' };
  const memberList = await members(client, batchId); const profits = shareInputs(input.profitShares, memberList);
  if (!profits) return { error: '请为每位批次参与人填写利润比例' };
  const sales = await availableSales(client, batchId, saleIds, lock); if (sales.length !== saleIds.length) return { error: '部分销售已撤销或已结账，请重新加载' };
  const related = await availableExpenses(client, batchId, saleIds, undefined, lock); const requiredExpenseIds = related.filter((expense) => expense.saleId !== null).map((expense) => expense.id); const allExpenseIds = [...new Set([...expenseIds, ...requiredExpenseIds])]; const expenses = await availableExpenses(client, batchId, saleIds, allExpenseIds, lock);
  if (expenses.length !== allExpenseIds.length) return { error: '部分费用无效、已撤销或已纳入其他账单，请重新加载' };
  const costs = await recommendedCosts(client, batchId, sales, memberList);
  if ([...profits.values()].reduce((sum, amount) => sum + amount, 0) !== 10000) return { error: '利润比例合计必须是 100%' };
  return { value: { sales, expenses, memberList, costs, profits, calculation: await calculate(client, batchId, memberList, sales, expenses, costs, profits) } };
}

type CorrectionPurchase = { id: string; oldQuantity: number; newQuantity: number; oldCost: number; newCost: number; oldPayerUserId: string; newPayerUserId: string; oldShares: Array<{ userId: string; amount: number }>; newShares: Array<{ userId: string; amount: number }> };

/** 在采购更正事务中，为已确认账单写入不可变的增量调整快照。 */
export async function createPurchaseCorrectionAdjustments(client: import('pg').PoolClient, batchId: string, productId: string, correctionId: string, createdBy: string, purchase: CorrectionPurchase, oldPool: { quantity: number; cost: number }, newPool: { quantity: number; cost: number }) {
  const payerRows = (await client.query('SELECT payer_user_id AS "userId",SUM(total_cost_tenths)::text AS amount FROM inventory_purchases WHERE batch_id=$1 AND product_id=$2 GROUP BY payer_user_id', [batchId, productId])).rows as Array<{ userId: string; amount: string }>;
  const shareRows = (await client.query('SELECT pcs.user_id AS "userId",SUM(pcs.amount_tenths)::text AS amount FROM purchase_cost_shares pcs JOIN inventory_purchases ip ON ip.id=pcs.purchase_id WHERE ip.batch_id=$1 AND ip.product_id=$2 GROUP BY pcs.user_id', [batchId, productId])).rows as Array<{ userId: string; amount: string }>;
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
    await client.query('INSERT INTO settlement_adjustment_bills(id,batch_id,settlement_bill_id,purchase_correction_id,old_cost_tenths,new_cost_tenths,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [adjustmentId, batchId, bill.billId, correctionId, oldCost, newCost, createdBy]);
    const memberRows = (await client.query('SELECT user_id AS "userId",username FROM settlement_member_results WHERE settlement_bill_id=$1', [bill.billId])).rows as AdjustmentMember[];
    const ids = new Set([...memberRows.map((row) => row.userId), ...oldPayers.map((row) => row.userId), ...newPayers.map((row) => row.userId), ...oldShareWeights.map((row) => row.userId), ...newShares.map((row) => row.userId)]);
    const names = new Map(memberRows.map((row) => [row.userId, row.username]));
    if (ids.size) {
      const users = (await client.query('SELECT id,username FROM users WHERE id=ANY($1::uuid[])', [[...ids]])).rows as Member[]; for (const user of users) names.set(user.id, user.username);
    }
    const oldPaid = allocated(oldCost, oldPayers); const newPaid = allocated(newCost, newPayers); const oldBurden = allocated(oldCost, oldShareWeights); const newBurden = allocated(newCost, newShares);
    const results = [...ids].map((userId) => ({ userId, username: names.get(userId) ?? '已移除成员', oldCost: oldBurden.get(userId) ?? 0, newCost: newBurden.get(userId) ?? 0, oldPaid: oldPaid.get(userId) ?? 0, newPaid: newPaid.get(userId) ?? 0 })).map((row) => ({ ...row, delta: row.newPaid - row.oldPaid - (row.newCost - row.oldCost) }));
    for (const row of results) await client.query('INSERT INTO settlement_adjustment_member_results(adjustment_bill_id,user_id,username,old_cost_share_tenths,new_cost_share_tenths,old_purchase_paid_tenths,new_purchase_paid_tenths,net_delta_tenths) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [adjustmentId, row.userId, row.username, row.oldCost, row.newCost, row.oldPaid, row.newPaid, row.delta]);
    const debtors = results.filter((row) => row.delta < 0).map((row) => ({ ...row, remaining: -row.delta })); const creditors = results.filter((row) => row.delta > 0).map((row) => ({ ...row, remaining: row.delta })); let debtor = 0; let creditor = 0; let sequence = 1;
    while (debtors[debtor] && creditors[creditor]) { const amount = Math.min(debtors[debtor].remaining, creditors[creditor].remaining); if (amount) await client.query('INSERT INTO settlement_adjustment_transfers(adjustment_bill_id,sequence,payer_user_id,payer_username,payee_user_id,payee_username,amount_tenths) VALUES($1,$2,$3,$4,$5,$6,$7)', [adjustmentId, sequence++, debtors[debtor].userId, debtors[debtor].username, creditors[creditor].userId, creditors[creditor].username, amount]); debtors[debtor].remaining -= amount; creditors[creditor].remaining -= amount; if (!debtors[debtor].remaining) debtor += 1; if (!creditors[creditor].remaining) creditor += 1; }
  }
}

export async function registerSettlementRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { batchId: string } }>('/api/batches/:batchId/settlements', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId); if (!context) return;
    const pool = getPool(); const unsettled = await pool.query('SELECT COUNT(*)::int AS count FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id LEFT JOIN settlement_bill_sales sbs ON sbs.sale_id=s.id WHERE s.batch_id=$1 AND sr.sale_id IS NULL AND sbs.sale_id IS NULL', [request.params.batchId]);
    const bills = await pool.query(`SELECT sb.id,sb.confirmed_at AS "confirmedAt",sb.profit_total_tenths::text AS "profitTotalTenths",COUNT(sbs.sale_id)::int AS "saleCount" FROM settlement_bills sb JOIN settlement_bill_sales sbs ON sbs.settlement_bill_id=sb.id WHERE sb.batch_id=$1 GROUP BY sb.id ORDER BY sb.confirmed_at DESC`, [request.params.batchId]);
    const adjustments = await pool.query(`SELECT sab.id,sab.settlement_bill_id AS "settlementBillId",sab.status,sab.created_at AS "createdAt",sab.old_cost_tenths::text AS "oldCostTenths",sab.new_cost_tenths::text AS "newCostTenths" FROM settlement_adjustment_bills sab WHERE sab.batch_id=$1 AND sab.status='pending' ORDER BY sab.created_at DESC`, [request.params.batchId]);
    return { unsettledSaleCount: unsettled.rows[0]?.count ?? 0, canManage: context.batchRole === 'owner', bills: bills.rows.map((bill: { profitTotalTenths: string }) => ({ ...bill, profitTotal: money(Number(bill.profitTotalTenths)) })), adjustments: adjustments.rows.map((item: Record<string, string>) => ({ id: item.id, settlementBillId: item.settlementBillId, status: item.status, createdAt: item.createdAt, oldCost: money(Number(item.oldCostTenths)), newCost: money(Number(item.newCostTenths)) })) };
  });
  app.get<{ Params: { batchId: string; adjustmentId: string } }>('/api/batches/:batchId/settlement-adjustments/:adjustmentId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId); if (!context) return;
    const pool = getPool(); const bill = (await pool.query(`SELECT sab.id,sab.settlement_bill_id AS "settlementBillId",sab.status,sab.created_at AS "createdAt",sab.confirmed_at AS "confirmedAt",sab.old_cost_tenths::text AS "oldCostTenths",sab.new_cost_tenths::text AS "newCostTenths" FROM settlement_adjustment_bills sab WHERE sab.id=$1 AND sab.batch_id=$2`, [request.params.adjustmentId, request.params.batchId])).rows[0] as Record<string, string> | undefined;
    if (!bill) return reply.code(404).send({ code: 'NOT_FOUND' });
    const [membersResult, transfersResult] = await Promise.all([pool.query('SELECT user_id AS "userId",username,old_cost_share_tenths::text AS "oldCostTenths",new_cost_share_tenths::text AS "newCostTenths",old_purchase_paid_tenths::text AS "oldPaidTenths",new_purchase_paid_tenths::text AS "newPaidTenths",net_delta_tenths::text AS "netDeltaTenths" FROM settlement_adjustment_member_results WHERE adjustment_bill_id=$1 ORDER BY username', [bill.id]), pool.query('SELECT payer_user_id AS "payerUserId",payer_username AS "payerUsername",payee_user_id AS "payeeUserId",payee_username AS "payeeUsername",amount_tenths::text AS "amountTenths" FROM settlement_adjustment_transfers WHERE adjustment_bill_id=$1 ORDER BY sequence', [bill.id])]);
    return { id: bill.id, settlementBillId: bill.settlementBillId, status: bill.status, createdAt: bill.createdAt, confirmedAt: bill.confirmedAt ?? null, oldCost: money(Number(bill.oldCostTenths)), newCost: money(Number(bill.newCostTenths)), members: membersResult.rows.map((row: Record<string, string>) => ({ userId: row.userId, username: row.username, oldCost: money(Number(row.oldCostTenths)), newCost: money(Number(row.newCostTenths)), oldPaid: money(Number(row.oldPaidTenths)), newPaid: money(Number(row.newPaidTenths)), netDelta: money(Number(row.netDeltaTenths)), direction: Number(row.netDeltaTenths) > 0 ? 'receivable' : Number(row.netDeltaTenths) < 0 ? 'payable' : 'settled' })), transfers: transfersResult.rows.map((row: Record<string, string>) => ({ ...row, amount: money(Number(row.amountTenths)) })) };
  });
  app.post<{ Params: { batchId: string; adjustmentId: string } }>('/api/batches/:batchId/settlement-adjustments/:adjustmentId/confirm', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const result = await getPool().query(`UPDATE settlement_adjustment_bills SET status='confirmed',confirmed_by=$3,confirmed_at=now() WHERE id=$1 AND batch_id=$2 AND status='pending' RETURNING id`, [request.params.adjustmentId, request.params.batchId, r.access!.id]);
    if (!result.rowCount) return message(reply, 'ADJUSTMENT_NOT_PENDING', '调整单不存在或已确认', 409);
    await audit(context.workspaceId, r.access!.id, 'settlement.adjustment.confirm', 'settlement_adjustment_bill', request.params.adjustmentId, {}); return { ok: true };
  });
  app.get<{ Params: { batchId: string } }>('/api/batches/:batchId/settlements/draft', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const client = await getPool().connect(); try { const memberList = await members(client, request.params.batchId); const sales = await availableSales(client, request.params.batchId); const expenses = (await client.query(`SELECT e.id,e.sale_id AS "saleId",e.name,e.amount_tenths::text AS "amountTenths",u.id AS "payerUserId",u.username AS "payerUsername",e.occurred_at AS "occurredAt" FROM expenses e JOIN users u ON u.id=e.payer_user_id LEFT JOIN expense_reversals er ON er.expense_id=e.id LEFT JOIN settlement_bill_expenses sbe ON sbe.expense_id=e.id WHERE e.batch_id=$1 AND er.expense_id IS NULL AND sbe.expense_id IS NULL ORDER BY e.occurred_at DESC,e.created_at DESC`, [request.params.batchId])).rows as ExpenseRow[]; return { members: memberList, sales: sales.map((sale) => ({ ...sale, totalPrice: money(Number(sale.totalPriceTenths)), consumedCost: money(Number(sale.consumedCostTenths)) })), expenses: expenses.map((expense) => ({ ...expense, amount: money(Number(expense.amountTenths)) })) }; } finally { client.release(); }
  });
  app.post<{ Params: { batchId: string }; Body: { saleIds?: unknown } }>('/api/batches/:batchId/settlements/recommendation', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const saleIds = uniqueIds(request.body?.saleIds); if (!saleIds) return message(reply, 'NO_SETTLABLE_SALES', '请至少选择一笔销售'); const client = await getPool().connect();
    try { const sales = await availableSales(client, request.params.batchId, saleIds); if (sales.length !== saleIds.length) return message(reply, 'SETTLEMENT_CONFLICT', '部分销售已撤销或已结账，请重新加载', 409); const memberList = await members(client, request.params.batchId); const recommendations = await recommendedCosts(client, request.params.batchId, sales, memberList); return { costTotal: money(sales.reduce((sum, sale) => sum + Number(sale.consumedCostTenths), 0)), costShares: memberList.map((member) => ({ userId: member.id, amount: money(recommendations.get(member.id) ?? 0) })) }; } finally { client.release(); }
  });
  app.post<{ Params: { batchId: string }; Body: SettlementInput }>('/api/batches/:batchId/settlements/preview', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const client = await getPool().connect(); try { const checked = await validateAndCalculate(client, request.params.batchId, request.body ?? {}); if (!checked.value) return message(reply, 'INVALID_SETTLEMENT', checked.error ?? '结算数据无效'); return present(checked.value.calculation); } finally { client.release(); }
  });
  app.post<{ Params: { batchId: string }; Body: SettlementInput }>('/api/batches/:batchId/settlements', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId, true); if (!context) return;
    const client = await getPool().connect(); const id = randomUUID();
    try { await client.query('BEGIN'); const checked = await validateAndCalculate(client, request.params.batchId, request.body ?? {}, true); if (!checked.value) { await client.query('ROLLBACK'); return message(reply, 'INVALID_SETTLEMENT', checked.error ?? '结算数据无效', 409); } const value = checked.value; const calculation = value.calculation;
      await client.query('INSERT INTO settlement_bills(id,batch_id,sale_total_tenths,expense_total_tenths,cost_total_tenths,profit_total_tenths,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, request.params.batchId, calculation.saleTotal, calculation.expenseTotal, calculation.costTotal, calculation.profitTotal, r.access!.id]);
      for (const sale of value.sales) await client.query('INSERT INTO settlement_bill_sales(settlement_bill_id,sale_id,product_name,quantity,total_price_tenths,consumed_cost_tenths,seller_user_id,seller_username,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, sale.id, sale.productName, sale.quantity, sale.totalPriceTenths, sale.consumedCostTenths, sale.sellerUserId, sale.sellerUsername, sale.occurredAt]);
      for (const expense of value.expenses) await client.query('INSERT INTO settlement_bill_expenses(settlement_bill_id,expense_id,sale_id,name,amount_tenths,payer_user_id,payer_username,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, expense.id, expense.saleId, expense.name, expense.amountTenths, expense.payerUserId, expense.payerUsername, expense.occurredAt]);
      for (const member of value.memberList) { const result = calculation.results.find((item) => item.userId === member.id)!; await client.query('INSERT INTO settlement_cost_shares(settlement_bill_id,user_id,username,amount_tenths) VALUES($1,$2,$3,$4)', [id, member.id, member.username, result.costShare]); await client.query('INSERT INTO settlement_profit_shares(settlement_bill_id,user_id,username,percentage,amount_tenths) VALUES($1,$2,$3,$4,$5)', [id, member.id, member.username, result.profitPercentage, result.profitAmount]); await client.query('INSERT INTO settlement_member_results(settlement_bill_id,user_id,username,cost_share_tenths,cost_recovery_tenths,sales_received_tenths,purchases_paid_tenths,expenses_paid_tenths,profit_percentage,profit_amount_tenths,net_tenths) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, member.id, member.username, result.costShare, result.costRecovery, result.salesReceived, result.purchasesPaid, result.expensesPaid, result.profitPercentage, result.profitAmount, result.net]); }
      for (const [sequence, transfer] of calculation.transfers.entries()) await client.query('INSERT INTO settlement_transfer_suggestions(settlement_bill_id,sequence,payer_user_id,payer_username,payee_user_id,payee_username,amount_tenths) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, sequence + 1, transfer.payerUserId, transfer.payerUsername, transfer.payeeUserId, transfer.payeeUsername, transfer.amount]);
      await client.query('COMMIT'); await audit(context.workspaceId, r.access!.id, 'settlement.confirm', 'settlement_bill', id, { saleCount: value.sales.length, expenseCount: value.expenses.length, profitTotal: money(calculation.profitTotal) }); return { id, ...present(calculation) };
    } catch (error: unknown) { await client.query('ROLLBACK'); if ((error as { code?: string }).code === '23505') return message(reply, 'SETTLEMENT_CONFLICT', '部分销售或费用已被结账，请重新加载', 409); throw error; } finally { client.release(); }
  });
  app.get<{ Params: { batchId: string; settlementId: string } }>('/api/batches/:batchId/settlements/:settlementId', async (request, reply) => {
    const r = request as AccessRequest; const context = await requireSettlementAccess(r, reply, request.params.batchId); if (!context) return;
    const bill = (await getPool().query('SELECT id,confirmed_at AS "confirmedAt",sale_total_tenths::text AS "saleTotalTenths",expense_total_tenths::text AS "expenseTotalTenths",cost_total_tenths::text AS "costTotalTenths",profit_total_tenths::text AS "profitTotalTenths" FROM settlement_bills WHERE id=$1 AND batch_id=$2', [request.params.settlementId, request.params.batchId])).rows[0] as { id: string; confirmedAt: string; saleTotalTenths: string; expenseTotalTenths: string; costTotalTenths: string; profitTotalTenths: string } | undefined;
    if (!bill) return reply.code(404).send({ code: 'NOT_FOUND' }); const pool = getPool(); const [memberRows, transferRows, sales, expenses, adjustments] = await Promise.all([pool.query('SELECT user_id AS "userId",username,cost_share_tenths::text AS "costShareTenths",cost_recovery_tenths::text AS "costRecoveryTenths",sales_received_tenths::text AS "salesReceivedTenths",purchases_paid_tenths::text AS "purchasesPaidTenths",expenses_paid_tenths::text AS "expensesPaidTenths",profit_percentage AS "profitPercentage",profit_amount_tenths::text AS "profitAmountTenths",net_tenths::text AS "netTenths" FROM settlement_member_results WHERE settlement_bill_id=$1 ORDER BY username', [bill.id]), pool.query('SELECT payer_user_id AS "payerUserId",payer_username AS "payerUsername",payee_user_id AS "payeeUserId",payee_username AS "payeeUsername",amount_tenths::text AS "amountTenths" FROM settlement_transfer_suggestions WHERE settlement_bill_id=$1 ORDER BY sequence', [bill.id]), pool.query('SELECT sale_id AS id,product_name AS "productName",quantity,total_price_tenths::text AS "totalPriceTenths",consumed_cost_tenths::text AS "consumedCostTenths",seller_username AS "sellerUsername",occurred_at AS "occurredAt" FROM settlement_bill_sales WHERE settlement_bill_id=$1 ORDER BY occurred_at DESC', [bill.id]), pool.query('SELECT expense_id AS id,sale_id AS "saleId",name,amount_tenths::text AS "amountTenths",payer_username AS "payerUsername",occurred_at AS "occurredAt" FROM settlement_bill_expenses WHERE settlement_bill_id=$1 ORDER BY occurred_at DESC', [bill.id]), pool.query('SELECT id,status,created_at AS "createdAt",old_cost_tenths::text AS "oldCostTenths",new_cost_tenths::text AS "newCostTenths" FROM settlement_adjustment_bills WHERE settlement_bill_id=$1 ORDER BY created_at DESC', [bill.id])]);
    return { id: bill.id, confirmedAt: bill.confirmedAt, saleTotal: money(Number(bill.saleTotalTenths)), expenseTotal: money(Number(bill.expenseTotalTenths)), costTotal: money(Number(bill.costTotalTenths)), profitTotal: money(Number(bill.profitTotalTenths)), isLoss: Number(bill.profitTotalTenths) < 0, members: memberRows.rows.map((item: Record<string, string | number>) => ({ userId: item.userId, username: item.username, costShare: money(Number(item.costShareTenths)), costRecovery: money(Number(item.costRecoveryTenths)), salesReceived: money(Number(item.salesReceivedTenths)), purchasesPaid: money(Number(item.purchasesPaidTenths)), expensesPaid: money(Number(item.expensesPaidTenths)), profitPercentage: Number(item.profitPercentage), profitAmount: money(Number(item.profitAmountTenths)), net: money(Number(item.netTenths)), direction: Number(item.netTenths) > 0 ? 'receivable' : Number(item.netTenths) < 0 ? 'payable' : 'settled' })), transfers: transferRows.rows.map((item: Record<string, string>) => ({ payerUserId: item.payerUserId, payerUsername: item.payerUsername, payeeUserId: item.payeeUserId, payeeUsername: item.payeeUsername, amount: money(Number(item.amountTenths)) })), sales: sales.rows.map((item: Record<string, string | number>) => ({ ...item, totalPrice: money(Number(item.totalPriceTenths)), consumedCost: money(Number(item.consumedCostTenths)) })), expenses: expenses.rows.map((item: Record<string, string | null>) => ({ ...item, amount: money(Number(item.amountTenths)) })), adjustments: adjustments.rows.map((item: Record<string, string>) => ({ id: item.id, status: item.status, createdAt: item.createdAt, oldCost: money(Number(item.oldCostTenths)), newCost: money(Number(item.newCostTenths)) })) };
  });
}
