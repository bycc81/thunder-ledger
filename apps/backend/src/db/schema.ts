import { integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
  workspaceId: uuid('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  referencePrice: numeric('reference_price', { precision: 12, scale: 1 }),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const productImages = pgTable('product_images', {
  productId: uuid('product_id').notNull(),
  assetId: uuid('asset_id').notNull(),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
