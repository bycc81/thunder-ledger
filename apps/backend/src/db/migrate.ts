import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './client.js';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

async function main(): Promise<void> {
  const pool = getPool();
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const sql = await readFile(resolve(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = (await pool.query('SELECT checksum FROM schema_migrations WHERE version = $1', [version])).rows[0] as { checksum?: string | null } | undefined;
    if (existing) {
      if (existing.checksum && existing.checksum !== checksum) throw new Error(`migration checksum mismatch: ${version}`);
      continue;
    }
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [version, checksum]);
      await pool.query('COMMIT');
    } catch (error) { await pool.query('ROLLBACK'); throw error; }
  }
  await pool.end();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
