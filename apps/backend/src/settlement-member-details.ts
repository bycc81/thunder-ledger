import type { FastifyInstance } from 'fastify';
import { auth, batchContext, canReadBatch, type AccessRequest } from './access.js';
import { getPool } from './db/client.js';

type Selection = { saleIds?: unknown; quickSaleIds?: unknown; expenseIds?: unknown };
type Member = { id: string; username: string };
type Sale = { id: string; source: 'sale' | 'quick_sale'; productId: string | null; productName: string; quantity: number; totalPriceCents: string; costCents: string; serviceFeeCents: string; sellerUserId: string; sellerUsername: string; occurredAt: string | Date; createdAt: string | Date };
type Expense = { id: string; saleId: string | null; quickSaleId: string | null; name: string; amountCents: string; payerUserId: string; payerUsername: string; occurredAt: string | Date };
type Allocation = { saleId: string; userId: string; username: string; type: 'payer' | 'burden'; amountCents: string };
type ItemRow = { id: string; quickSaleId: string; name: string; quantity: number; costCents: string; consumptionId: string | null; productId: string | null; productName: string | null; linkedQuantity: number | null; consumedCostCents: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function ids(value: unknown): string[] | null { return Array.isArray(value) && value.every((id) => typeof id === 'string' && UUID.test(id)) && new Set(value).size === value.length ? value : null; }
function money(cents: number): string { const absolute = Math.abs(cents); return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`; }
const instant = (value: string | Date) => new Date(value).getTime();

/** 只读取现有销售/费用及分摊；不引用结算计算、账本重建或分配函数。 */
export async function registerSettlementMemberDetailsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { batchId: string; userId: string }; Body: Selection }>('/api/batches/:batchId/settlements/members/:userId/details', async (request, reply) => {
    const access = request as AccessRequest;
    if (!(await auth(access, reply))) return;
    const { batchId, userId } = request.params;
    if (!UUID.test(batchId) || !UUID.test(userId)) return reply.code(400).send({ code: 'INVALID_SELECTION', message: '请选择有效的批次和人员' });
    const context = await batchContext(access, batchId);
    if (!canReadBatch(context)) return reply.code(404).send({ code: 'NOT_FOUND' });
    if (context?.batchRole !== 'owner') return reply.code(403).send({ code: 'FORBIDDEN', message: '只有批次所有者或工作区管理员可以查看结算明细' });
    const saleIds = ids(request.body?.saleIds), quickSaleIds = ids(request.body?.quickSaleIds), expenseIds = ids(request.body?.expenseIds);
    if (!saleIds || !quickSaleIds || !expenseIds || (!saleIds.length && !quickSaleIds.length)) return reply.code(400).send({ code: 'INVALID_SELECTION', message: '请选择有效的销售和费用，ID不能重复' });
    const client = await getPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // 开放批次与成员记录在同一只读快照中核验；只读事务结束统一回滚。
      const batch = (await client.query('SELECT status FROM collaboration_batches WHERE id=$1 AND deleted_at IS NULL', [batchId])).rows[0];
      if (!batch) return reply.code(404).send({ code: 'NOT_FOUND' });
      if (batch.status !== 'open') return reply.code(409).send({ code: 'BATCH_CLOSED', message: '已关闭的批次不能结算' });
      const memberList = (await client.query('SELECT u.id,u.username FROM batch_members bm JOIN users u ON u.id=bm.user_id WHERE bm.batch_id=$1 ORDER BY u.id', [batchId])).rows as Member[];
      const member = memberList.find((item) => item.id === userId);
      if (!member) return reply.code(404).send({ code: 'MEMBER_NOT_FOUND', message: '人员不属于当前批次' });
      // 表/字段沿用销售草稿契约，排除撤销和已结账记录；不锁行，不改变记录。
      const normal = saleIds.length ? (await client.query(`SELECT s.id,'sale' AS source,s.product_id AS "productId",COALESCE(s.product_name_snapshot,p.name) AS "productName",COALESCE(s.product_group_name_snapshot,g.name) AS "productGroupName",COALESCE(s.variant_name_snapshot,p.variant_name) AS "variantName",s.quantity,s.total_price_cents::text AS "totalPriceCents",s.consumed_cost_cents::text AS "costCents",s.service_fee_cents::text AS "serviceFeeCents",s.seller_user_id AS "sellerUserId",u.username AS "sellerUsername",s.occurred_at AS "occurredAt",s.created_at AS "createdAt" FROM sales s JOIN products p ON p.id=s.product_id LEFT JOIN product_groups g ON g.id=p.group_id JOIN users u ON u.id=s.seller_user_id LEFT JOIN sale_reversals sr ON sr.sale_id=s.id LEFT JOIN settlement_bill_sales sbs ON sbs.sale_id=s.id WHERE s.batch_id=$1 AND s.id=ANY($2::uuid[]) AND sr.sale_id IS NULL AND sbs.sale_id IS NULL`, [batchId, saleIds])).rows as Array<Sale & { productGroupName: string | null; variantName: string | null }> : [];
      const quick = quickSaleIds.length ? (await client.query(`SELECT qs.id,'quick_sale' AS source,NULL::uuid AS "productId",COALESCE(string_agg(qsi.name,' + ' ORDER BY qsi.position),'快速售出') AS "productName",COALESCE(SUM(qsi.quantity),0)::int AS quantity,qs.total_price_cents::text AS "totalPriceCents",COALESCE(SUM(qsi.cost_cents),0)::bigint::text AS "costCents",qs.service_fee_cents::text AS "serviceFeeCents",qs.seller_user_id AS "sellerUserId",u.username AS "sellerUsername",qs.occurred_at AS "occurredAt",qs.created_at AS "createdAt" FROM quick_sales qs LEFT JOIN quick_sale_items qsi ON qsi.quick_sale_id=qs.id JOIN users u ON u.id=qs.seller_user_id LEFT JOIN quick_sale_reversals qsr ON qsr.quick_sale_id=qs.id LEFT JOIN settlement_bill_quick_sales sbqs ON sbqs.quick_sale_id=qs.id WHERE qs.batch_id=$1 AND qs.id=ANY($2::uuid[]) AND qsr.quick_sale_id IS NULL AND sbqs.quick_sale_id IS NULL GROUP BY qs.id,u.username`, [batchId, quickSaleIds])).rows as Sale[] : [];
      if (normal.length !== saleIds.length || quick.length !== quickSaleIds.length) return reply.code(409).send({ code: 'SETTLEMENT_CONFLICT', message: '部分销售已撤销或已结账，请重新加载' });
      // 与原结算费用条件一致：显式费用与已选销售关联费用取并集。
      const availableExpenses = (await client.query(`SELECT e.id,e.sale_id AS "saleId",e.quick_sale_id AS "quickSaleId",e.name,e.amount_cents::text AS "amountCents",e.payer_user_id AS "payerUserId",u.username AS "payerUsername",e.occurred_at AS "occurredAt" FROM expenses e JOIN users u ON u.id=e.payer_user_id LEFT JOIN expense_reversals er ON er.expense_id=e.id LEFT JOIN settlement_bill_expenses sbe ON sbe.expense_id=e.id WHERE e.batch_id=$1 AND er.expense_id IS NULL AND sbe.expense_id IS NULL AND (e.sale_id IS NULL OR e.sale_id=ANY($2::uuid[]) OR e.quick_sale_id=ANY($3::uuid[])) ORDER BY e.occurred_at DESC,e.created_at DESC,e.id`, [batchId, saleIds, quickSaleIds])).rows as Expense[];
      const requiredIds = new Set([...expenseIds, ...availableExpenses.filter((item) => item.saleId !== null || item.quickSaleId !== null).map((item) => item.id)]);
      const selectedExpenses = availableExpenses.filter((item) => requiredIds.has(item.id));
      if (selectedExpenses.length !== requiredIds.size) return reply.code(409).send({ code: 'SETTLEMENT_CONFLICT', message: '部分费用无效、已撤销或已纳入其他账单，请重新加载' });
      const normalAllocations = saleIds.length ? (await client.query(`SELECT a.sale_id AS "saleId",a.user_id AS "userId",u.username,a.allocation_type AS type,a.amount_cents::text AS "amountCents" FROM sale_cost_allocations a JOIN users u ON u.id=a.user_id WHERE a.sale_id=ANY($1::uuid[]) ORDER BY a.user_id,a.allocation_type`, [saleIds])).rows as Allocation[] : [];
      const quickAllocations = quickSaleIds.length ? (await client.query(`SELECT a.quick_sale_id AS "saleId",a.user_id AS "userId",u.username,a.allocation_type AS type,a.amount_cents::text AS "amountCents" FROM quick_sale_cost_allocations a JOIN users u ON u.id=a.user_id WHERE a.quick_sale_id=ANY($1::uuid[]) ORDER BY a.user_id,a.allocation_type`, [quickSaleIds])).rows as Allocation[] : [];
      const itemRows = quickSaleIds.length ? (await client.query(`SELECT qsi.id,qsi.quick_sale_id AS "quickSaleId",qsi.name,qsi.quantity,qsi.cost_cents::text AS "costCents",qsc.id AS "consumptionId",qsc.product_id AS "productId",p.name AS "productName",qsc.quantity AS "linkedQuantity",qsc.consumed_cost_cents::text AS "consumedCostCents" FROM quick_sale_items qsi LEFT JOIN quick_sale_inventory_consumptions qsc ON qsc.quick_sale_item_id=qsi.id LEFT JOIN products p ON p.id=qsc.product_id WHERE qsi.quick_sale_id=ANY($1::uuid[]) ORDER BY qsi.quick_sale_id,qsi.position,qsc.id`, [quickSaleIds])).rows as ItemRow[] : [];
      const issues: Array<{ source: Sale['source']; saleId: string; message: string }> = [];
      const transactions = [...normal.map((sale) => ({ ...sale, productName: sale.productGroupName && sale.variantName ? `${sale.productGroupName} · ${sale.variantName}` : sale.productName })), ...quick]
        .sort((a, b) => instant(b.occurredAt) - instant(a.occurredAt) || instant(b.createdAt) - instant(a.createdAt) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id))
        .map((sale) => {
          const allocations = (sale.source === 'sale' ? normalAllocations : quickAllocations).filter((item) => item.saleId === sale.id);
          const own = (type: Allocation['type']) => allocations.filter((item) => item.type === type && item.userId === userId);
          const invalid = (type: Allocation['type']) => allocations.filter((item) => item.type === type).reduce((sum, item) => sum + Number(item.amountCents), 0) !== Number(sale.costCents);
          if (invalid('burden') || invalid('payer')) issues.push({ source: sale.source, saleId: sale.id, message: '人员分摊记录缺失或合计与销售成本不一致，无法完整核对，不推算补齐。' });
          if (allocations.some((item) => !memberList.some((member) => member.id === item.userId))) issues.push({ source: sale.source, saleId: sale.id, message: '分摊包含非当前批次成员，请返回核对。' });
          const storedItems = [...new Map(itemRows.filter((item) => item.quickSaleId === sale.id).map((item) => [item.id, item])).values()];
          const quickItems = storedItems.map((item) => ({
            id: item.id, name: item.name, quantity: item.quantity, cost: money(Number(item.costCents)),
            consumptions: itemRows.filter((row) => row.id === item.id && row.consumptionId).map((row) => ({ id: row.consumptionId!, productId: row.productId!, productName: row.productName ?? '库存商品', quantity: row.linkedQuantity!, consumedCost: money(Number(row.consumedCostCents)) }))
          }));
          if (sale.source === 'quick_sale' && (!quickItems.length || storedItems.reduce((sum, item) => sum + Number(item.costCents), 0) !== Number(sale.costCents))) issues.push({ source: sale.source, saleId: sale.id, message: '快速售出商品项缺失或成本合计不一致。' });
          const amount = (type: Allocation['type']) => own(type).length || !invalid(type) ? money(own(type).reduce((sum, item) => sum + Number(item.amountCents), 0)) : null;
          return { id: sale.id, source: sale.source, productId: sale.productId, productName: sale.productName, quantity: sale.quantity, occurredAt: sale.occurredAt, totalPrice: money(Number(sale.totalPriceCents)), cost: money(Number(sale.costCents)), serviceFee: money(Number(sale.serviceFeeCents)), sellerUserId: sale.sellerUserId, sellerUsername: sale.sellerUsername, costShare: amount('burden'), purchasesPaid: amount('payer'), netReceipt: money(Number(sale.totalPriceCents) - Number(sale.serviceFeeCents)), allocations: allocations.map((item) => ({ userId: item.userId, username: item.username, type: item.type, amount: money(Number(item.amountCents)) })), quickItems };
        });
      const allAllocations = [...normalAllocations.filter((row) => saleIds.includes(row.saleId)), ...quickAllocations.filter((row) => quickSaleIds.includes(row.saleId))];
      const personalSum = (type: Allocation['type']) => allAllocations.filter((item) => item.userId === userId && item.type === type).reduce((sum, item) => sum + Number(item.amountCents), 0);
      return {
        member,
        totals: { costTotal: money([...normal, ...quick].reduce((sum, sale) => sum + Number(sale.costCents), 0)), costShare: money(personalSum('burden')), purchasesPaid: money(personalSum('payer')), expensesPaid: money(selectedExpenses.filter((item) => item.payerUserId === userId).reduce((sum, item) => sum + Number(item.amountCents), 0)), salesReceived: money([...normal, ...quick].filter((item) => item.sellerUserId === userId).reduce((sum, item) => sum + Number(item.totalPriceCents) - Number(item.serviceFeeCents), 0)) },
        transactions,
        expenses: selectedExpenses.filter((item) => item.payerUserId === userId).map((item) => ({ id: item.id, saleId: item.saleId, quickSaleId: item.quickSaleId, name: item.name, amount: money(Number(item.amountCents)), occurredAt: item.occurredAt })),
        issues
      };
    } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
  });
}
