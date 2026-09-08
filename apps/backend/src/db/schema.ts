import { bigint, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

export const manualChannels = pgTable('manual_channels', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const inventoryPurchases = pgTable('inventory_purchases', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  productId: uuid('product_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  payerUserId: uuid('payer_user_id').notNull(),
  quantity: integer('quantity').notNull(),
  totalCostTenths: bigint('total_cost_tenths', { mode: 'number' }).notNull(),
  purchasedOn: text('purchased_on').notNull(),
  sourceUrl: text('source_url'),
  note: text('note'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const purchaseCostShares = pgTable('purchase_cost_shares', {
  purchaseId: uuid('purchase_id').notNull(),
  userId: uuid('user_id').notNull(),
  amountTenths: bigint('amount_tenths', { mode: 'number' }).notNull(),
});

export const listings = pgTable('listings', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  productId: uuid('product_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  externalUrl: text('external_url'),
  displayPriceTenths: bigint('display_price_tenths', { mode: 'number' }),
  status: text('status').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const sales = pgTable('sales', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  productId: uuid('product_id').notNull(),
  listingId: uuid('listing_id'),
  quantity: integer('quantity').notNull(),
  totalPriceTenths: bigint('total_price_tenths', { mode: 'number' }).notNull(),
  consumedCostTenths: bigint('consumed_cost_tenths', { mode: 'number' }).notNull(),
  sellerUserId: uuid('seller_user_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  note: text('note'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey(),
  batchId: uuid('batch_id').notNull(),
  saleId: uuid('sale_id'),
  type: text('type').notNull(),
  name: text('name').notNull(),
  amountTenths: bigint('amount_tenths', { mode: 'number' }).notNull(),
  payerUserId: uuid('payer_user_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  note: text('note'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
