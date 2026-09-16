import type { FastifyInstance, FastifyReply } from 'fastify';
import { audit, auth, role, type AccessRequest } from './access.js';
import { getPool } from './db/client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_TYPES = ['inventory', 'sales', 'profit', 'members', 'unsettled'] as const;
type ReportType = typeof REPORT_TYPES[number];
type ReportQuery = { workspaceId?: unknown; batchId?: unknown; reportType?: unknown; from?: unknown; to?: unknown };
type ReportContext = { workspaceId: string; batchIds: string[]; batchId: string | null; from: string | null; to: string | null; reportType: ReportType };

async function canLogWorkspaceFailure(request: AccessRequest, workspaceId: unknown): Promise<boolean> {
  if (!request.access?.id || typeof workspaceId !== 'string' || !UUID_RE.test(workspaceId)) return false;
  try {
    return Boolean(await role(request.access.id, workspaceId));
  } catch {
    return false;
  }
}

function money(value: number | string): string {
  const amount = Number(value);
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  return `${sign}${Math.floor(absolute / 10)}.${absolute % 10}`;
}

export function formatReportDateTime(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  const shanghaiTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${shanghaiTime.getUTCFullYear()}-${pad(shanghaiTime.getUTCMonth() + 1)}-${pad(shanghaiTime.getUTCDate())} ${pad(shanghaiTime.getUTCHours())}:${pad(shanghaiTime.getUTCMinutes())}:${pad(shanghaiTime.getUTCSeconds())}`;
}

function message(reply: FastifyReply, code: string, text: string, status = 400) {
  return reply.code(status).send({ code, message: text });
}

function dateValue(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const date = new Date(`${value}T00:00:00+08:00`);
  const validCalendarDate = calendarDate.getUTCFullYear() === year && calendarDate.getUTCMonth() + 1 === month && calendarDate.getUTCDate() === day;
  return validCalendarDate && date.getTime() === calendarDate.getTime() - 8 * 60 * 60 * 1000 ? value : null;
}

function dateClause(alias: string, from: string | null, to: string | null, field = 'occurred_at'): string {
  const clauses: string[] = [];
  if (from) clauses.push(`${alias}.${field} >= ($2::date AT TIME ZONE 'Asia/Shanghai')`);
  if (to) clauses.push(`${alias}.${field} < (($${from ? 3 : 2}::date + 1) AT TIME ZONE 'Asia/Shanghai')`);
  return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
}

async function accessibleBatches(request: AccessRequest, workspaceId: string, batchId: string | null): Promise<string[] | null> {
  if (!request.access?.id) return null;
  const membership = await getPool().query(`
    SELECT 1
    FROM workspace_members wm
    JOIN workspaces w ON w.id=wm.workspace_id AND w.deleted_at IS NULL
    WHERE wm.workspace_id=$1 AND wm.user_id=$2
  `, [workspaceId, request.access.id]);
  if (!membership.rowCount) return null;
  const params = batchId ? [workspaceId, request.access.id, batchId] : [workspaceId, request.access.id];
  const filter = batchId ? ' AND b.id=$3' : '';
  const rows = (await getPool().query(`
    SELECT b.id
    FROM collaboration_batches b
    JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
    LEFT JOIN batch_members bm ON bm.batch_id=b.id AND bm.user_id=$2
    WHERE b.workspace_id=$1 AND b.deleted_at IS NULL${filter}
      AND (wm.role IN ('owner','admin') OR bm.user_id IS NOT NULL)
    ORDER BY b.created_at DESC
  `, params)).rows as Array<{ id: string }>;
  if (batchId && rows.length !== 1) return null;
  return rows.map((row) => row.id);
}

async function parseReportContext(request: AccessRequest, query: ReportQuery): Promise<ReportContext | { error: string }> {
  const workspaceId = String(query.workspaceId ?? '');
  const batchIdValue = query.batchId ? String(query.batchId) : null;
  const reportType = String(query.reportType ?? '') as ReportType;
  const from = query.from ? dateValue(query.from) : null;
  const to = query.to ? dateValue(query.to) : null;
  if (!UUID_RE.test(workspaceId) || (batchIdValue && !UUID_RE.test(batchIdValue))) return { error: '工作区或批次无效' };
  if (!REPORT_TYPES.includes(reportType)) return { error: '报表类型无效' };
  if ((query.from && !from) || (query.to && !to)) return { error: '日期格式无效' };
  if (from && to && from > to) return { error: '开始日期不能晚于结束日期' };
  const batchIds = await accessibleBatches(request, workspaceId, batchIdValue);
  if (!batchIds) return { error: '无权访问当前工作区或批次' };
  return { workspaceId, batchIds, batchId: batchIdValue, from, to, reportType };
}

function queryParams(context: ReportContext): [string[], ...string[]] {
  return [context.batchIds, ...(context.from ? [context.from] : []), ...(context.to ? [context.to] : [])] as [string[], ...string[]];
}

function summary(key: string, label: string, value: string | number) {
  return { key, label, value: typeof value === 'number' ? String(value) : value };
}

async function report(context: ReportContext) {
  const pool = getPool();
  const params = queryParams(context);
  const purchaseDate = dateClause('ip', context.from, context.to);
  const saleDate = dateClause('s', context.from, context.to);
  const adjustmentDate = dateClause('ia', context.from, context.to, 'created_at');
  const expenseDate = dateClause('e', context.from, context.to);

  if (context.reportType === 'inventory') {
    const rows = (await pool.query(`
      WITH purchases AS (
        SELECT ip.batch_id,ip.product_id,SUM(ip.quantity)::int AS "purchaseQuantity",SUM(ip.total_cost_tenths)::text AS "purchaseCost"
        FROM inventory_purchases ip WHERE ip.batch_id=ANY($1::uuid[])${purchaseDate} GROUP BY ip.batch_id,ip.product_id
      ), sales AS (
        SELECT s.batch_id,s.product_id,SUM(s.quantity)::int AS "soldQuantity",SUM(s.consumed_cost_tenths)::text AS "soldCost"
        FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id
        WHERE s.batch_id=ANY($1::uuid[]) AND sr.sale_id IS NULL${saleDate} GROUP BY s.batch_id,s.product_id
      ), adjustments AS (
        SELECT ia.batch_id,ia.product_id,SUM(ia.quantity)::int AS "adjustedQuantity",SUM(ia.consumed_cost_tenths)::text AS "adjustedCost"
        FROM inventory_adjustments ia WHERE ia.batch_id=ANY($1::uuid[])${adjustmentDate} GROUP BY ia.batch_id,ia.product_id
      )
      SELECT b.id AS "batchId",b.name AS "batchName",p.id AS "productId",p.name AS "productName",purchases."purchaseQuantity",
        COALESCE(sales."soldQuantity",0)::int AS "soldQuantity",
        COALESCE(adjustments."adjustedQuantity",0)::int AS "adjustedQuantity",
        purchases."purchaseCost",COALESCE(sales."soldCost",'0') AS "soldCost",
        COALESCE(adjustments."adjustedCost",'0') AS "adjustedCost"
      FROM purchases JOIN products p ON p.id=purchases.product_id
      JOIN collaboration_batches b ON b.id=purchases.batch_id
      LEFT JOIN sales ON sales.batch_id=purchases.batch_id AND sales.product_id=purchases.product_id
      LEFT JOIN adjustments ON adjustments.batch_id=purchases.batch_id AND adjustments.product_id=purchases.product_id
      ORDER BY b.created_at DESC,p.name
    `, params)).rows as Array<Record<string, string | number>>;
    const mapped = rows.map((row) => {
      const purchaseQuantity = Number(row.purchaseQuantity);
      const soldQuantity = Number(row.soldQuantity);
      const adjustedQuantity = Number(row.adjustedQuantity);
      const purchaseCost = Number(row.purchaseCost);
      const soldCost = Number(row.soldCost);
      const adjustedCost = Number(row.adjustedCost);
      return { ...row, reportRowId: `${row.batchId}-${row.productId}`, availableQuantity: purchaseQuantity - soldQuantity - adjustedQuantity, remainingCost: money(purchaseCost - soldCost - adjustedCost), purchaseCost: money(purchaseCost), soldCost: money(soldCost), adjustedCost: money(adjustedCost) };
    });
    return { summary: [summary('availableQuantity', '可卖数量', mapped.reduce((total, row) => total + Number(row.availableQuantity), 0)), summary('remainingCost', '剩余成本', money(mapped.reduce((total, row) => total + Number(row.purchaseCost.replace('.', '')) - Number(row.soldCost.replace('.', '')) - Number(row.adjustedCost.replace('.', '')), 0)))], rows: mapped };
  }

  if (context.reportType === 'sales') {
    const rows = (await pool.query(`
      SELECT s.id AS "saleId",b.name AS "batchName",p.name AS "productName",s.quantity,s.total_price_tenths::text AS "totalPriceTenths",
        s.consumed_cost_tenths::text AS "consumedCostTenths",u.username AS "sellerUsername",s.occurred_at AS "occurredAt",
        (sbs.sale_id IS NOT NULL) AS settled
      FROM sales s JOIN products p ON p.id=s.product_id JOIN collaboration_batches b ON b.id=s.batch_id
      JOIN users u ON u.id=s.seller_user_id LEFT JOIN sale_reversals sr ON sr.sale_id=s.id
      LEFT JOIN settlement_bill_sales sbs ON sbs.sale_id=s.id
      WHERE s.batch_id=ANY($1::uuid[]) AND sr.sale_id IS NULL${saleDate}
      ORDER BY s.occurred_at DESC,s.created_at DESC
    `, params)).rows as Array<Record<string, string | number | boolean>>;
    const mapped = rows.map((row) => ({ ...row, reportRowId: String(row.saleId), totalPrice: money(String(row.totalPriceTenths)), consumedCost: money(String(row.consumedCostTenths)), grossProfit: money(Number(row.totalPriceTenths) - Number(row.consumedCostTenths)) }));
    const salesTotal = rows.reduce((total, row) => total + Number(row.totalPriceTenths), 0);
    const costTotal = rows.reduce((total, row) => total + Number(row.consumedCostTenths), 0);
    const salesQuantity = rows.reduce((total, row) => total + Number(row.quantity), 0);
    return { summary: [summary('salesTotal', '销售额', money(salesTotal)), summary('costTotal', '销售成本', money(costTotal)), summary('grossProfit', '销售利润（未扣费用）', money(salesTotal - costTotal)), summary('salesQuantity', '销售数量', salesQuantity)], rows: mapped };
  }

  if (context.reportType === 'profit') {
    const rows = (await pool.query(`
      WITH sales AS (
        SELECT s.batch_id,SUM(s.total_price_tenths)::text AS "salesTotal",SUM(s.consumed_cost_tenths)::text AS "costTotal",
          SUM(s.total_price_tenths) FILTER (WHERE sbs.sale_id IS NOT NULL)::text AS "settledSales",
          SUM(s.total_price_tenths) FILTER (WHERE sbs.sale_id IS NULL)::text AS "unsettledSales"
        FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id LEFT JOIN settlement_bill_sales sbs ON sbs.sale_id=s.id
        WHERE s.batch_id=ANY($1::uuid[]) AND sr.sale_id IS NULL${saleDate} GROUP BY s.batch_id
      ), expenses AS (
        SELECT e.batch_id,SUM(e.amount_tenths)::text AS "expenseTotal"
        FROM expenses e LEFT JOIN expense_reversals er ON er.expense_id=e.id
        WHERE e.batch_id=ANY($1::uuid[]) AND er.expense_id IS NULL${expenseDate} GROUP BY e.batch_id
      )
      SELECT b.id AS "batchId",b.name AS "batchName",COALESCE(sales."salesTotal",'0') AS "salesTotal",COALESCE(expenses."expenseTotal",'0') AS "expenseTotal",
        COALESCE(sales."costTotal",'0') AS "costTotal",COALESCE(sales."settledSales",'0') AS "settledSales",
        COALESCE(sales."unsettledSales",'0') AS "unsettledSales"
      FROM collaboration_batches b LEFT JOIN sales ON sales.batch_id=b.id LEFT JOIN expenses ON expenses.batch_id=b.id
      WHERE b.id=ANY($1::uuid[]) AND (sales.batch_id IS NOT NULL OR expenses.batch_id IS NOT NULL)
      ORDER BY b.created_at DESC
    `, params)).rows as Array<Record<string, string | number>>;
    const mapped = rows.map((row) => {
      const salesTotal = Number(row.salesTotal);
      const expenseTotal = Number(row.expenseTotal);
      const costTotal = Number(row.costTotal);
      return { ...row, reportRowId: String(row.batchId), salesTotal: money(salesTotal), expenseTotal: money(expenseTotal), costTotal: money(costTotal), settledSales: money(String(row.settledSales)), unsettledSales: money(String(row.unsettledSales)), profitTotal: money(salesTotal - expenseTotal - costTotal) };
    });
    const totals = rows.reduce<{ sales: number; expense: number; cost: number }>((total, row) => ({ sales: total.sales + Number(row.salesTotal), expense: total.expense + Number(row.expenseTotal), cost: total.cost + Number(row.costTotal) }), { sales: 0, expense: 0, cost: 0 });
    return { summary: [summary('salesTotal', '销售额', money(totals.sales)), summary('expenseTotal', '费用', money(totals.expense)), summary('costTotal', '消耗成本', money(totals.cost)), summary('profitTotal', '利润', money(totals.sales - totals.expense - totals.cost))], rows: mapped };
  }

  if (context.reportType === 'members') {
    const rows = (await pool.query(`
      WITH sales AS (
        SELECT s.batch_id,s.seller_user_id AS user_id,SUM(s.quantity)::int AS "salesQuantity",SUM(s.total_price_tenths)::text AS "salesTotal",SUM(s.consumed_cost_tenths)::text AS "costTotal"
        FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id WHERE s.batch_id=ANY($1::uuid[]) AND sr.sale_id IS NULL${saleDate} GROUP BY s.batch_id,s.seller_user_id
      ), expenses AS (
        SELECT e.batch_id,e.payer_user_id AS user_id,SUM(e.amount_tenths)::text AS "expenseTotal"
        FROM expenses e LEFT JOIN expense_reversals er ON er.expense_id=e.id WHERE e.batch_id=ANY($1::uuid[]) AND er.expense_id IS NULL${expenseDate} GROUP BY e.batch_id,e.payer_user_id
      ), purchases AS (
        SELECT ip.batch_id,ip.payer_user_id AS user_id,SUM(ip.total_cost_tenths)::text AS "purchaseTotal"
        FROM inventory_purchases ip WHERE ip.batch_id=ANY($1::uuid[])${purchaseDate} GROUP BY ip.batch_id,ip.payer_user_id
      ), members AS (
        SELECT b.id AS batch_id,bm.user_id
        FROM collaboration_batches b
        JOIN batch_members bm ON bm.batch_id=b.id
        WHERE b.id=ANY($1::uuid[])
      )
      SELECT b.id AS "batchId",b.name AS "batchName",u.id AS "userId",u.username,"salesQuantity",COALESCE(sales."salesTotal",'0') AS "salesTotal",
        COALESCE(sales."costTotal",'0') AS "costTotal",COALESCE(expenses."expenseTotal",'0') AS "expenseTotal",
        COALESCE(purchases."purchaseTotal",'0') AS "purchaseTotal"
      FROM members JOIN users u ON u.id=members.user_id JOIN collaboration_batches b ON b.id=members.batch_id
      LEFT JOIN sales ON sales.batch_id=members.batch_id AND sales.user_id=members.user_id
      LEFT JOIN expenses ON expenses.batch_id=members.batch_id AND expenses.user_id=members.user_id
      LEFT JOIN purchases ON purchases.batch_id=members.batch_id AND purchases.user_id=members.user_id
      ORDER BY b.created_at DESC,u.username
    `, params)).rows as Array<Record<string, string | number>>;
    const mapped = rows.map((row) => ({ ...row, reportRowId: `${row.batchId}-${row.userId}`, salesTotal: money(String(row.salesTotal)), costTotal: money(String(row.costTotal)), expenseTotal: money(String(row.expenseTotal)), purchaseTotal: money(String(row.purchaseTotal)), contribution: money(Number(row.salesTotal) - Number(row.costTotal) - Number(row.expenseTotal)) }));
    return { summary: [summary('memberCount', '成员数', mapped.length), summary('salesTotal', '销售额', money(rows.reduce((total, row) => total + Number(row.salesTotal), 0))), summary('purchaseTotal', '采购支付', money(rows.reduce((total, row) => total + Number(row.purchaseTotal), 0)))], rows: mapped };
  }

  const rows = (await pool.query(`
    WITH sales AS (
      SELECT s.batch_id,COUNT(*)::int AS "saleCount",SUM(s.total_price_tenths)::text AS "saleTotal",SUM(s.total_price_tenths-s.consumed_cost_tenths)::text AS "saleProfit"
      FROM sales s LEFT JOIN sale_reversals sr ON sr.sale_id=s.id LEFT JOIN settlement_bill_sales sbs ON sbs.sale_id=s.id
      WHERE s.batch_id=ANY($1::uuid[]) AND sr.sale_id IS NULL AND sbs.sale_id IS NULL${saleDate} GROUP BY s.batch_id
    ), expenses AS (
      SELECT e.batch_id,COUNT(*)::int AS "expenseCount",SUM(e.amount_tenths)::text AS "expenseTotal"
      FROM expenses e LEFT JOIN expense_reversals er ON er.expense_id=e.id LEFT JOIN settlement_bill_expenses sbe ON sbe.expense_id=e.id
      WHERE e.batch_id=ANY($1::uuid[]) AND er.expense_id IS NULL AND sbe.expense_id IS NULL${expenseDate} GROUP BY e.batch_id
    )
    SELECT b.id AS "batchId",b.name AS "batchName",COALESCE(sales."saleCount",0)::int AS "saleCount",COALESCE(sales."saleTotal",'0') AS "saleTotal",
      COALESCE(expenses."expenseCount",0)::int AS "expenseCount",COALESCE(expenses."expenseTotal",'0') AS "expenseTotal",
      (COALESCE(sales."saleProfit",'0')::bigint-COALESCE(expenses."expenseTotal",'0')::bigint)::text AS "unsettledProfit"
    FROM collaboration_batches b LEFT JOIN sales ON sales.batch_id=b.id LEFT JOIN expenses ON expenses.batch_id=b.id
    WHERE b.id=ANY($1::uuid[]) AND (sales.batch_id IS NOT NULL OR expenses.batch_id IS NOT NULL)
    ORDER BY b.created_at DESC
  `, params)).rows as Array<Record<string, string | number>>;
  const mapped = rows.map((row) => ({ ...row, reportRowId: String(row.batchId), saleTotal: money(String(row.saleTotal)), expenseTotal: money(String(row.expenseTotal)), unsettledProfit: money(String(row.unsettledProfit)) }));
  return { summary: [summary('saleCount', '未结算销售笔数', rows.reduce((total, row) => total + Number(row.saleCount), 0)), summary('saleTotal', '未结算销售额', money(rows.reduce((total, row) => total + Number(row.saleTotal), 0))), summary('expenseTotal', '未结算费用', money(rows.reduce((total, row) => total + Number(row.expenseTotal), 0)))], rows: mapped };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvFor(type: ReportType, rows: Array<Record<string, unknown>>): string {
  const columns: Record<ReportType, Array<[string, string]>> = {
    inventory: [['batchName', '批次'], ['productName', '商品'], ['purchaseQuantity', '采购数量'], ['soldQuantity', '销售数量'], ['adjustedQuantity', '减少库存数量'], ['availableQuantity', '可卖数量'], ['purchaseCost', '采购成本'], ['remainingCost', '剩余成本']],
    sales: [['batchName', '批次'], ['productName', '商品'], ['quantity', '数量'], ['totalPrice', '销售额'], ['consumedCost', '销售成本'], ['grossProfit', '销售利润（未扣费用）'], ['sellerUsername', '卖出人'], ['occurredAt', '发生时间'], ['settled', '已结算']],
    profit: [['batchName', '批次'], ['salesTotal', '销售额'], ['expenseTotal', '费用'], ['costTotal', '销售成本'], ['profitTotal', '利润'], ['settledSales', '已结算销售额'], ['unsettledSales', '待结算销售额']],
    members: [['batchName', '批次'], ['username', '成员'], ['salesQuantity', '销售数量'], ['salesTotal', '销售额'], ['costTotal', '销售成本'], ['expenseTotal', '费用支付'], ['purchaseTotal', '采购支付'], ['contribution', '贡献额']],
    unsettled: [['batchName', '批次'], ['saleCount', '未结算销售笔数'], ['saleTotal', '未结算销售额'], ['expenseCount', '未结算费用笔数'], ['expenseTotal', '未结算费用'], ['unsettledProfit', '未结算毛利']],
  };
  const selected = columns[type];
  return `\uFEFF${selected.map(([, label]) => csvCell(label)).join(',')}\r\n${rows.map((row) => selected.map(([key]) => csvCell(key === 'occurredAt' ? formatReportDateTime(row[key]) : row[key])).join(',')).join('\r\n')}\r\n`;
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ReportQuery }>('/api/reports', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await auth(r, reply))) return;
    const context = await parseReportContext(r, request.query ?? {});
    if ('error' in context) return message(reply, 'INVALID_REPORT_QUERY', context.error, context.error.includes('无权') ? 403 : 400);
    const result = await report(context);
    return { reportType: context.reportType, workspaceId: context.workspaceId, batchId: context.batchId, from: context.from, to: context.to, generatedAt: new Date().toISOString(), ...result };
  });

  app.get<{ Querystring: ReportQuery }>('/api/reports/export', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await auth(r, reply))) return;
    const context = await parseReportContext(r, request.query ?? {});
    if ('error' in context) {
      try {
        if (await canLogWorkspaceFailure(r, request.query?.workspaceId)) {
          await audit(String(request.query?.workspaceId), r.access!.id, 'report.export.failed', 'report', null, { reportType: request.query?.reportType ?? null, reason: context.error });
        }
      } catch { /* preserve the original validation response */ }
      return message(reply, 'INVALID_REPORT_QUERY', context.error, context.error.includes('无权') ? 403 : 400);
    }
    try {
      const result = await report(context);
      const content = csvFor(context.reportType, result.rows as Array<Record<string, unknown>>);
      await audit(context.workspaceId, r.access!.id, 'report.export', 'report', null, { reportType: context.reportType, batchId: context.batchId, rowCount: result.rows.length });
      return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="thunderledger-${context.reportType}.csv"`).send(content);
    } catch (error) {
      try { await audit(context.workspaceId, r.access!.id, 'report.export.failed', 'report', null, { reportType: context.reportType, reason: error instanceof Error ? error.message : 'export failed' }); } catch { /* do not hide the original failure */ }
      throw error;
    }
  });
}
