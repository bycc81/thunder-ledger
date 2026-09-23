import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './client.js';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * 早期开发环境曾应用过一组已确认的迁移文件版本。
 * 这些版本的数据库结构已被后续迁移依赖，不能重新执行或覆盖审计记录；
 * 仅允许这里登记过的历史 checksum 与当前规范 checksum 共存。
 */
const legacyMigrationChecksums: Record<string, Set<string>> = {
  '002_batch1_access': new Set(['f019032f46e06a53dac091f99ad2433a45bd7e2da2353a5d9a5e6d67ab43be5c']),
  '003_batch_members': new Set(['196d87cf95d192ec2ecfd3cfba95c1515c52aa0d70aa9d41b012f4f7ce02aa7a']),
  '004_product_catalog': new Set(['4ef9c27a715a2dff154639f7300424285fdbb62ecbdc30c48a3e3440bf69bbb2']),
  '005_inventory_purchases': new Set(['3d04625c6286663408f66cc6b7cac52100dcb822f875fde82620f9957933bbdf']),
  '006_inventory_maintenance': new Set(['474cd60e64c5c84ed0c65f257ef6ea8dbc38e3b33658bd168dadab63667c7f89']),
  '007_sales_expenses': new Set(['f9d0e630962354f0133f1e037aa01f457872336f468a520e571110b3882dacca']),
  '008_listing_url_optional': new Set(['894b7310ddd195b92fa39abeda7fb8dd5e752c2cc1878b6c11dc4e32a8174f45']),
  '009_account_session_version': new Set(['184001522e5b67e2fd947d619310e6fb633d24fdceec269c6ab0c003815dd4fb']),
  // 019 曾在本地开发数据库执行过早期快照列版本；保留该校验值，后续列由 020 补齐。
  '019_business_name_snapshots': new Set(['9054f4a54486eb82f3550712f077094347f1710793167762dcb19d186bbb8ab5']),
};

function normalizeMigrationSql(sql: string): string {
  return sql.replace(/\r\n?/g, '\n');
}

async function main(): Promise<void> {
  const pool = getPool();
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const sql = normalizeMigrationSql(await readFile(resolve(migrationsDir, file), 'utf8'));
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = (await pool.query('SELECT checksum FROM schema_migrations WHERE version = $1', [version])).rows[0] as { checksum?: string | null } | undefined;
    if (existing) {
      if (existing.checksum && existing.checksum !== checksum) {
        const acceptedLegacyChecksums = legacyMigrationChecksums[version];
        if (!acceptedLegacyChecksums?.has(existing.checksum)) {
          throw new Error(`migration checksum mismatch: ${version}`);
        }
        console.warn(`migration checksum legacy compatibility accepted: ${version}`);
      }
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
