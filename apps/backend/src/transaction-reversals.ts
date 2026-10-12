import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

type TransactionSource = 'sale' | 'quick_sale';
const sources = {
  sale: { table: 'sales', reversal: 'sale_reversals', bill: 'settlement_bill_sales', reference: 'sale_id', label: '销售' },
  quick_sale: { table: 'quick_sales', reversal: 'quick_sale_reversals', bill: 'settlement_bill_quick_sales', reference: 'quick_sale_id', label: '快速售出' },
} as const;

export class LinkedExpenseSettledError extends Error {
  constructor() { super('关联费用已纳入账单，不能撤销这笔销售'); }
}

/** 先锁主交易，再读取最新状态，与销售撤销、结算保持同一锁顺序。 */
export async function canLinkExpense(client: PoolClient, batchId: string, source: TransactionSource, transactionId: string): Promise<boolean> {
  const { table, reversal, bill, reference } = sources[source];
  const locked = await client.query(`SELECT id FROM ${table} WHERE id=$1 AND batch_id=$2 FOR UPDATE`, [transactionId, batchId]);
  if (!locked.rowCount) return false;
  const unavailable = await client.query(`SELECT 1 FROM ${reversal} WHERE ${reference}=$1 UNION ALL SELECT 1 FROM ${bill} WHERE ${reference}=$1`, [transactionId]);
  return !unavailable.rowCount;
}

/** 调用者已锁定主交易；费用、审计和销售撤销共同提交或回滚。 */
export async function reverseLinkedExpenses(client: PoolClient, context: { batchId: string; workspaceId: string; source: TransactionSource; transactionId: string; actorUserId: string; reason: string }): Promise<number> {
  const { reference, label } = sources[context.source];
  // 锁后重新查询撤销/结账状态，避免等待并发单独撤销时读到旧快照。
  await client.query(`SELECT id FROM expenses WHERE batch_id=$1 AND ${reference}=$2 ORDER BY id FOR UPDATE`, [context.batchId, context.transactionId]);
  const rows = (await client.query(`SELECT e.id,(sbe.expense_id IS NOT NULL) AS settled FROM expenses e LEFT JOIN expense_reversals er ON er.expense_id=e.id LEFT JOIN settlement_bill_expenses sbe ON sbe.expense_id=e.id WHERE e.batch_id=$1 AND e.${reference}=$2 AND er.expense_id IS NULL ORDER BY e.id`, [context.batchId, context.transactionId])).rows as Array<{ id: string; settled: boolean }>;
  if (rows.some(row => row.settled)) throw new LinkedExpenseSettledError();
  const reason = `随${label}撤销：${context.reason}`;
  for (const row of rows) {
    await client.query('INSERT INTO expense_reversals(expense_id,reason,created_by) VALUES($1,$2,$3)', [row.id, reason, context.actorUserId]);
    await client.query("INSERT INTO audit_logs(id,workspace_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'expense.reverse','expense',$4,$5::jsonb)", [randomUUID(), context.workspaceId, context.actorUserId, row.id, JSON.stringify({ source: context.source, transactionId: context.transactionId, cascade: true })]);
  }
  return rows.length;
}
