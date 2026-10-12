// Validate captured SELECTs against development PostgreSQL; EXPLAIN never executes them.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { getPool } from '../../../apps/backend/dist/db/client.js';
const captured = JSON.parse(await readFile(new URL('./evidence/implementation/api-queries.json', import.meta.url), 'utf8'));
const statements = [...new Map(captured.map((item) => [item.sql, item])).values()];
const pool = getPool();
const client = await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '5s'");
  for (const { sql, params } of statements) {
    assert.match(sql.trim(), /^SELECT\b/i);
    await client.query(`EXPLAIN ${sql}`, params);
  }
  const result = { compiledSelects: statements.length, readOnly: true, executesBusinessQueries: false };
  await writeFile(new URL('./evidence/implementation/sql-result.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(`PostgreSQL read-only: ${statements.length} SELECTs compiled; no business query executed`);
} finally {
  try { await client.query('ROLLBACK'); } finally { client.release(); await pool.end(); }
}
