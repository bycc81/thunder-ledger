import pg from 'pg';

const { Pool } = pg;
let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    pool = new Pool({ connectionString, max: 5, ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  }
  return pool;
}

export async function checkDatabase(): Promise<void> {
  await getPool().query('select 1');
}
