import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull(),
});

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey(),
  objectKey: text('object_key').notNull().unique(),
  originalName: text('original_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  status: text('status').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
