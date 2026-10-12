// Verify actual PostgreSQL row waits on two independent connections in a disposable local schema.
// Only this schema is committed. Production/development business tables are never written.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { getPool } from '../../../apps/backend/dist/db/client.js';
import { canLinkExpense, reverseLinkedExpenses } from '../../../apps/backend/dist/transaction-reversals.js';
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
const pool = getPool(), a = await pool.connect(), b = await pool.connect(), observer = await pool.connect();
const schema = `transaction_reversal_concurrency_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^transaction_reversal_concurrency_[a-f0-9]{32}$/);
const batchId = randomUUID(), workspaceId = randomUUID(), actorUserId = randomUUID(), checks = [];
let created = false;
const context = (source, transactionId) => ({ source, transactionId, batchId, workspaceId, actorUserId, reason: '并发验收' });
const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
async function waited() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await observer.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
    if (result.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected second connection to block on row lock');
}
try {
  await observer.query(`CREATE SCHEMA "${schema}"`); created = true;
  for (const client of [a, b]) { await client.query(`SET search_path TO "${schema}"`); await client.query("SET statement_timeout='10s'"); }
  // Minimal test tables match the helper's SQL; no foreign keys into business tables.
  for (const name of ['sales', 'quick_sales']) await a.query(`CREATE TABLE ${name}(id uuid PRIMARY KEY,batch_id uuid NOT NULL)`);
  for (const [name, reference] of [['sale_reversals','sale_id'], ['quick_sale_reversals','quick_sale_id'], ['settlement_bill_sales','sale_id'], ['settlement_bill_quick_sales','quick_sale_id']]) await a.query(`CREATE TABLE ${name}(${reference} uuid PRIMARY KEY)`);
  await a.query('CREATE TABLE expenses(id uuid PRIMARY KEY,batch_id uuid,sale_id uuid,quick_sale_id uuid)');
  await a.query('CREATE TABLE expense_reversals(expense_id uuid PRIMARY KEY,reason text,created_by uuid)');
  await a.query('CREATE TABLE settlement_bill_expenses(expense_id uuid PRIMARY KEY)');
  await a.query('CREATE TABLE audit_logs(id uuid PRIMARY KEY,workspace_id uuid,actor_user_id uuid,action text,entity_type text,entity_id text,metadata jsonb)');
  for (const source of ['sale', 'quick_sale']) {
    const table = source === 'sale' ? 'sales' : 'quick_sales', reversal = source === 'sale' ? 'sale_reversals' : 'quick_sale_reversals', reference = source === 'sale' ? 'sale_id' : 'quick_sale_id';
    // Reversal wins: creator waits for the main sale and must see the committed reversal afterward.
    const reversed = randomUUID(); await a.query(`INSERT INTO ${table} VALUES($1,$2)`, [reversed,batchId]);
    await a.query('BEGIN'); await a.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [reversed]);
    await b.query('BEGIN'); const creator = canLinkExpense(b,batchId,source,reversed); await waited();
    await a.query(`INSERT INTO ${reversal} VALUES($1)`, [reversed]); await a.query('COMMIT');
    assert.equal(await creator, false); await b.query('ROLLBACK');
    checks.push(`${source}: create waits for reversal and rejects the new reversed state`);
    // Creator wins: reversal waits for the main sale, then includes the committed new fee.
    const pending = randomUUID(), fee = randomUUID(); await a.query(`INSERT INTO ${table} VALUES($1,$2)`, [pending,batchId]);
    await a.query('BEGIN'); assert.equal(await canLinkExpense(a,batchId,source,pending),true);
    await b.query('BEGIN');
    const reverser = (async () => { await b.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [pending]); return reverseLinkedExpenses(b,context(source,pending)); })();
    await waited(); await a.query(`INSERT INTO expenses(id,batch_id,${reference}) VALUES($1,$2,$3)`, [fee,batchId,pending]); await a.query('COMMIT');
    assert.equal(await reverser,1); await b.query('COMMIT');
    assert.equal((await observer.query(`SELECT COUNT(*)::int AS count FROM "${schema}".expense_reversals WHERE expense_id=$1`,[fee])).rows[0].count,1);
    checks.push(`${source}: reversal waits for create and includes the committed fee`);
    // Standalone fee reversal wins: cascade waits on the fee, re-reads and preserves its original reason.
    const sale = randomUUID(), oldFee = randomUUID(); await a.query(`INSERT INTO ${table} VALUES($1,$2)`, [sale,batchId]); await a.query(`INSERT INTO expenses(id,batch_id,${reference}) VALUES($1,$2,$3)`, [oldFee,batchId,sale]);
    await a.query('BEGIN'); await a.query('SELECT id FROM expenses WHERE id=$1 FOR UPDATE',[oldFee]);
    await b.query('BEGIN'); await b.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[sale]); const cascade = reverseLinkedExpenses(b,context(source,sale)); await waited();
    await a.query("INSERT INTO expense_reversals VALUES($1,'原单独撤销原因',$2)",[oldFee,actorUserId]); await a.query('COMMIT');
    assert.equal(await cascade,0); await b.query('COMMIT');
    assert.equal((await observer.query(`SELECT reason FROM "${schema}".expense_reversals WHERE expense_id=$1`,[oldFee])).rows[0].reason,'原单独撤销原因');
    checks.push(`${source}: cascade waits for standalone fee reversal and preserves history`);
  }
  await mkdir(new URL('./evidence/',import.meta.url),{recursive:true}); await writeFile(new URL('./evidence/concurrency.json',import.meta.url),JSON.stringify({checks,isolatedSchema:true},null,2));
  console.log(`PASS: ${checks.length} actual row-lock concurrency cases`); checks.forEach(check=>console.log(`- ${check}`));
} finally {
  for (const client of [a,b]) { await client.query('ROLLBACK'); await client.query('RESET search_path'); }
  // The exact generated name was verified above and contains no business table names.
  if (created) await observer.query(`DROP SCHEMA "${schema}" CASCADE`);
  a.release(); b.release(); observer.release(); await pool.end();
}
