import type { Config } from 'drizzle-kit';

export default {
  schema: './apps/backend/src/db/schema.ts',
  out: './db/migrations/drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config;
