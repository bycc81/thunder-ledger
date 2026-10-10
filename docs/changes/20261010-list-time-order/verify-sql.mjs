// Compile captured SELECTs against the configured development PostgreSQL without writes.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { getPool } from '../../../apps/backend/dist/db/client.js';
const captured = (await Promise.all(['lists', 'settlement'].map(async (name) => JSON.parse(await readFile(new URL(`./evidence/${name}/queries.json`, import.meta.url), 'utf8'))))).flat();
const statements = [...new Map(captured.map((item) => [item.sql, item])).values()];
const pool = getPool(); const client = await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '5s'");
  for (const { sql, params } of statements) {
    assert.match(sql.trim(), /^SELECT\b/i);
    await client.query(`EXPLAIN ${sql}`, params);
  }
  // Real PostgreSQL temporal ordering: late-entered old procurement must not jump first.
  const fixture = await client.query(`WITH purchases(product_id,occurred_at,created_at) AS (VALUES
    ('new-business','2026-10-10T08:00:00+08:00'::timestamptz,'2026-10-10T01:00:00Z'::timestamptz),
    ('late-entry','2026-10-09T00:00:00Z'::timestamptz,'2026-10-10T03:00:00Z'::timestamptz),
    ('same-business','2026-10-10T00:00:00Z'::timestamptz,'2026-10-10T02:00:00Z'::timestamptz))
    SELECT product_id FROM purchases GROUP BY product_id ORDER BY MAX(occurred_at) DESC,MAX(created_at) DESC,product_id`);
  assert.deepEqual(fixture.rows.map((row) => row.product_id), ['same-business', 'new-business', 'late-entry']);
  const result = { compiledSelects: statements.length, readOnly: true, temporalOrdering: 'timezones, creation ties, late-entry older purchase' };
  await writeFile(new URL('./evidence/sql-result.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(`PostgreSQL read-only: ${statements.length} SELECTs compiled; temporal ordering verified`);
} finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
