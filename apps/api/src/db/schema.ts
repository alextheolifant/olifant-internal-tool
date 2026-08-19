import { relations } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  date,
  integer,
  numeric,
  text,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['admin', 'analyst']);

export const clientStatusEnum = pgEnum('client_status', [
  'active',
  'onboarding',
  'paused',
  'churned',
]);

export const clientTierEnum = pgEnum('client_tier', ['t1', 't2', 't3']);

export const syncTypeEnum = pgEnum('sync_type', [
  'ads_campaigns',
  'ads_metrics',
  'ads_metrics_retry',
  'sp_orders',
  'sp_inventory',
  'ads_profiles',
  'anomaly_detection',
  'catalog_items',
  'ads_search_term',
  'ads_targeting',
  'entity_snapshots',
]);

export const syncStatusEnum = pgEnum('sync_status', [
  'pending',
  'running',
  'success',
  'failed',
]);

export const copilotMessageRoleEnum = pgEnum('copilot_message_role', [
  'user',
  'assistant',
]);

export const anomalyMetricEnum = pgEnum('anomaly_metric', [
  'acos',
  'spend',
  'ctr',
  'clicks',
  'tacos',
  'revenue',
]);

export const anomalySeverityEnum = pgEnum('anomaly_severity', [
  'watch',
  'act_now',
]);

export const ppcStrategyEnum = pgEnum('ppc_strategy', [
  'launch',
  'growth',
  'maintain',
]);

export const ppcAccountTargetMetricEnum = pgEnum('ppc_account_target_metric', [
  'acos',
  'tacos',
]);

// active = normal operation. frozen = exceptions only, no optimization tasks.
export const ppcOpsStatusEnum = pgEnum('ppc_ops_status', ['active', 'frozen']);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: userRoleEnum('role').notNull().default('analyst'),
  // Credential ownership (e.g. ads_manager_accounts) belongs to the
  // organization, not the individual user — every user in an org can see and
  // use every credential the org has connected. Migration 0018 backfills
  // every existing row before adding the NOT NULL constraint this reflects.
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  status: clientStatusEnum('status').notNull().default('onboarding'),
  tier: clientTierEnum('tier'),
  targetTacos: numeric('target_tacos', { precision: 5, scale: 2 }),
  goalRevenue: numeric('goal_revenue', { precision: 14, scale: 2 }),
  baseCurrency: varchar('base_currency', { length: 3 })
    .notNull()
    .default('USD'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const amazonAdsAccounts = pgTable(
  'amazon_ads_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    profileId: varchar('profile_id', { length: 255 }).notNull(),
    accountName: varchar('account_name', { length: 255 }),
    marketplace: varchar('marketplace', { length: 10 }),
    countryCode: varchar('country_code', { length: 5 }),
    currencyCode: varchar('currency_code', { length: 3 }),
    timezone: varchar('timezone', { length: 100 }),
    accountType: varchar('account_type', { length: 20 }),
    marketplaceStringId: varchar('marketplace_string_id', { length: 50 }),
    region: varchar('region', { length: 3 }),
    adsManagerAccountId: uuid('ads_manager_account_id').references(
      () => adsManagerAccounts.id,
    ),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_ads_account_profile').on(t.profileId),
    index('idx_ads_account_client').on(t.clientId),
  ],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonAdsAccountId: uuid('amazon_ads_account_id')
      .notNull()
      .references(() => amazonAdsAccounts.id, { onDelete: 'cascade' }),
    campaignId: varchar('campaign_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    state: varchar('state', { length: 50 }).notNull(),
    budget: numeric('budget', { precision: 12, scale: 2 }),
    budgetType: varchar('budget_type', { length: 50 }),
    targetingType: varchar('targeting_type', { length: 50 }),
    startDate: date('start_date'),
    portfolioId: varchar('portfolio_id', { length: 255 }),
    biddingStrategy: varchar('bidding_strategy', { length: 100 }),
    rawData: jsonb('raw_data'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_campaign_per_account').on(
      t.amazonAdsAccountId,
      t.campaignId,
    ),
    index('idx_campaign_account').on(t.amazonAdsAccountId),
  ],
);

export const campaignMetricsDaily = pgTable(
  'campaign_metrics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    spend: numeric('spend', { precision: 12, scale: 4 }).notNull().default('0'),
    sales: numeric('sales', { precision: 12, scale: 4 }).notNull().default('0'),
    orders: integer('orders').notNull().default(0),
    acos: numeric('acos', { precision: 8, scale: 4 }),
    roas: numeric('roas', { precision: 8, scale: 4 }),
    ctr: numeric('ctr', { precision: 8, scale: 4 }),
    cpc: numeric('cpc', { precision: 8, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_metrics_campaign_date').on(t.campaignId, t.date),
    index('idx_metrics_date').on(t.date),
  ],
);

export const syncLogs = pgTable(
  'sync_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonAdsAccountId: uuid('amazon_ads_account_id').references(
      () => amazonAdsAccounts.id,
      { onDelete: 'cascade' },
    ),
    amazonSpAccountId: uuid('amazon_sp_account_id').references(
      () => amazonSpAccounts.id,
      { onDelete: 'cascade' },
    ),
    syncType: syncTypeEnum('sync_type').notNull(),
    status: syncStatusEnum('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    recordsSynced: integer('records_synced').notNull().default(0),
  },
  (t) => [
    index('idx_sync_log_account').on(t.amazonAdsAccountId),
    index('idx_sync_log_sp_account').on(t.amazonSpAccountId),
    index('idx_sync_log_status').on(t.status),
  ],
);

export const amazonSpAccounts = pgTable(
  'amazon_sp_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    sellingPartnerId: varchar('selling_partner_id', { length: 255 }),
    // Real Amazon marketplace ID (e.g. "ATVPDKIKX0DER"), not a short country
    // code — one seller authorization covers every marketplace they operate
    // in within a region, so one row per (selling_partner_id, marketplace).
    marketplace: varchar('marketplace', { length: 20 }),
    region: varchar('region', { length: 10 }),
    refreshToken: varchar('refresh_token', { length: 2048 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_sp_account_client').on(t.clientId),
    uniqueIndex('uq_sp_account_selling_partner_marketplace').on(
      t.sellingPartnerId,
      t.marketplace,
    ),
  ],
);

// A Manager Account credential belongs to the organization, not the
// individual who connected it — every user in the org can see and use every
// active row here. connected_by_user_id is audit/reference only, never used
// for access control. Deliberately no unique constraint: multiple manager
// accounts are expected to be simultaneously active for one org.
//
// TODO: if the same person (or someone else) re-authorizes the same
// underlying Amazon Manager Account a second time, this produces a second,
// functionally-duplicate row — not detected or deduped today. See
// profiles.go's connected-at tiebreak in the Go sync service for the runtime
// symptom this causes (the same profileId appearing under two manager
// accounts) and how it's handled defensively, without solving the root cause.
export const adsManagerAccounts = pgTable(
  'ads_manager_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectedByUserId: uuid('connected_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    refreshToken: varchar('refresh_token', { length: 2048 }).notNull(),
    connectedAt: timestamp('connected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('idx_ads_manager_account_org').on(t.organizationId)],
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  adsManagerAccounts: many(adsManagerAccounts),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  amazonAdsAccounts: many(amazonAdsAccounts),
  amazonSpAccounts: many(amazonSpAccounts),
  anomalies: many(anomalies),
}));

export const amazonAdsAccountsRelations = relations(
  amazonAdsAccounts,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [amazonAdsAccounts.clientId],
      references: [clients.id],
    }),
    adsManagerAccount: one(adsManagerAccounts, {
      fields: [amazonAdsAccounts.adsManagerAccountId],
      references: [adsManagerAccounts.id],
    }),
    campaigns: many(campaigns),
    syncLogs: many(syncLogs),
  }),
);

export const adsManagerAccountsRelations = relations(
  adsManagerAccounts,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [adsManagerAccounts.organizationId],
      references: [organizations.id],
    }),
    connectedByUser: one(users, {
      fields: [adsManagerAccounts.connectedByUserId],
      references: [users.id],
    }),
    amazonAdsAccounts: many(amazonAdsAccounts),
  }),
);

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  amazonAdsAccount: one(amazonAdsAccounts, {
    fields: [campaigns.amazonAdsAccountId],
    references: [amazonAdsAccounts.id],
  }),
  metrics: many(campaignMetricsDaily),
}));

export const campaignMetricsDailyRelations = relations(
  campaignMetricsDaily,
  ({ one }) => ({
    campaign: one(campaigns, {
      fields: [campaignMetricsDaily.campaignId],
      references: [campaigns.id],
    }),
  }),
);

export const syncLogsRelations = relations(syncLogs, ({ one }) => ({
  amazonAdsAccount: one(amazonAdsAccounts, {
    fields: [syncLogs.amazonAdsAccountId],
    references: [amazonAdsAccounts.id],
  }),
  amazonSpAccount: one(amazonSpAccounts, {
    fields: [syncLogs.amazonSpAccountId],
    references: [amazonSpAccounts.id],
  }),
}));

export const amazonSpAccountsRelations = relations(
  amazonSpAccounts,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [amazonSpAccounts.clientId],
      references: [clients.id],
    }),
    syncLogs: many(syncLogs),
    catalogItems: many(catalogItems),
  }),
);

export const adsReportRequests = pgTable(
  'ads_report_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonAdsAccountId: uuid('amazon_ads_account_id')
      .notNull()
      .references(() => amazonAdsAccounts.id, { onDelete: 'cascade' }),
    syncLogId: uuid('sync_log_id').references(() => syncLogs.id, {
      onDelete: 'set null',
    }),
    // Internal report-family key ('campaigns' | 'searchTerm' | 'targeting',
    // ...) — NOT Amazon's own reportTypeId, so our storage stays stable even
    // if Amazon renames theirs. Defaults 'campaigns' so pre-existing rows
    // (from before report types were parameterized) stay correctly attributed.
    reportType: varchar('report_type', { length: 20 })
      .notNull()
      .default('campaigns'),
    region: varchar('region', { length: 3 }).notNull(),
    reportId: varchar('report_id', { length: 255 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    retryCount: integer('retry_count').notNull().default(0),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
  },
  (t) => [
    index('idx_report_req_status').on(t.status),
    index('idx_report_req_account').on(t.amazonAdsAccountId),
    // Partial unique index (WHERE status IN ('PENDING','PROCESSING')) is added
    // manually in the migration — Drizzle doesn't support partial index WHERE
    // clauses. It's keyed on (account, report_type, start_date, end_date) so
    // an in-flight campaigns report never blocks submitting a search-term
    // report for the same account/date range.
  ],
);

// Search terms are high-cardinality (one row per term/keyword/campaign/ad
// group/date) — no FK to campaigns.id, campaign_id/ad_group_id are stored as
// raw Amazon ids, matching how ads_report_requests itself stores them.
export const searchTermMetricsDaily = pgTable(
  'search_term_metrics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonAdsAccountId: uuid('amazon_ads_account_id')
      .notNull()
      .references(() => amazonAdsAccounts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    searchTerm: text('search_term').notNull(),
    keywordId: varchar('keyword_id', { length: 64 }),
    campaignId: varchar('campaign_id', { length: 64 }).notNull(),
    adGroupId: varchar('ad_group_id', { length: 64 }).notNull(),
    matchType: varchar('match_type', { length: 32 }),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    cost: numeric('cost', { precision: 12, scale: 4 }).notNull().default('0'),
    sales7d: numeric('sales_7d', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    sales14d: numeric('sales_14d', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    orders7d: integer('orders_7d').notNull().default(0),
    orders14d: integer('orders_14d').notNull().default(0),
    units7d: integer('units_7d').notNull().default(0),
    units14d: integer('units_14d').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // NULLs in a unique index are never considered equal to each other in
    // Postgres, so rows with no keyword_id (auto/product-targeting search
    // terms) are not deduped against each other by this constraint alone —
    // the upsert additionally coalesces keyword_id to '' before the ON
    // CONFLICT match so those rows still overwrite correctly.
    uniqueIndex('uq_search_term_metrics').on(
      t.amazonAdsAccountId,
      t.date,
      t.searchTerm,
      t.keywordId,
      t.campaignId,
      t.adGroupId,
    ),
    index('idx_search_term_metrics_date').on(t.date),
    index('idx_search_term_metrics_account').on(t.amazonAdsAccountId),
  ],
);

export const targetMetricsDaily = pgTable(
  'target_metrics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonAdsAccountId: uuid('amazon_ads_account_id')
      .notNull()
      .references(() => amazonAdsAccounts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    targetId: varchar('target_id', { length: 64 }).notNull(),
    expression: text('expression').notNull(),
    matchType: varchar('match_type', { length: 32 }),
    campaignId: varchar('campaign_id', { length: 64 }).notNull(),
    adGroupId: varchar('ad_group_id', { length: 64 }).notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    cost: numeric('cost', { precision: 12, scale: 4 }).notNull().default('0'),
    sales7d: numeric('sales_7d', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    sales14d: numeric('sales_14d', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    orders7d: integer('orders_7d').notNull().default(0),
    orders14d: integer('orders_14d').notNull().default(0),
    units7d: integer('units_7d').notNull().default(0),
    units14d: integer('units_14d').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_target_metrics').on(
      t.amazonAdsAccountId,
      t.date,
      t.targetId,
    ),
    index('idx_target_metrics_date').on(t.date),
    index('idx_target_metrics_account').on(t.amazonAdsAccountId),
  ],
);

export const spReportRequests = pgTable(
  'sp_report_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonSpAccountId: uuid('amazon_sp_account_id')
      .notNull()
      .references(() => amazonSpAccounts.id, { onDelete: 'cascade' }),
    // Links back to the sync_logs row created when this report was
    // submitted, so Phase 2 polling can mark it success/failed on
    // completion — without this, sync_logs stays 'running' forever
    // regardless of how the report request resolves.
    syncLogId: uuid('sync_log_id').references(() => syncLogs.id, {
      onDelete: 'set null',
    }),
    region: varchar('region', { length: 3 }).notNull(),
    reportId: varchar('report_id', { length: 255 }).notNull(),
    reportDocumentId: varchar('report_document_id', { length: 255 }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    // SP-API's own processingStatus values — different from ads_report_requests'
    // PENDING/PROCESSING, do not conflate the two.
    status: varchar('status', { length: 20 }).notNull().default('IN_QUEUE'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
  },
  (t) => [
    index('idx_sp_report_req_status').on(t.status),
    index('idx_sp_report_req_account').on(t.amazonSpAccountId),
    // Partial unique index (WHERE status IN ('IN_QUEUE','IN_PROGRESS')) is added
    // manually in the migration — Drizzle doesn't support partial index WHERE clauses.
  ],
);

export const spSalesDaily = pgTable(
  'sp_sales_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonSpAccountId: uuid('amazon_sp_account_id')
      .notNull()
      .references(() => amazonSpAccounts.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    totalSales: numeric('total_sales', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    unitsOrdered: integer('units_ordered').notNull().default(0),
    orders: integer('orders').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_sp_sales_account_date').on(t.amazonSpAccountId, t.date),
    index('idx_sp_sales_date').on(t.date),
  ],
);

export const spInventory = pgTable(
  'sp_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonSpAccountId: uuid('amazon_sp_account_id')
      .notNull()
      .references(() => amazonSpAccounts.id, { onDelete: 'cascade' }),
    asin: varchar('asin', { length: 20 }).notNull(),
    sellerSku: varchar('seller_sku', { length: 255 }),
    fulfillableQuantity: integer('fulfillable_quantity').notNull().default(0),
    totalQuantity: integer('total_quantity').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_sp_inventory_account_asin').on(t.amazonSpAccountId, t.asin),
    index('idx_sp_inventory_account').on(t.amazonSpAccountId),
  ],
);

// Raw ingestion from the GET_MERCHANT_LISTINGS_ALL_DATA report (SP-API
// Reports) — mirrors sp_inventory's role: written only by the Go sync
// (services/sync-sp-api), never via the NestJS API. Chosen over the Catalog
// Items API because Catalog Items' searchCatalogItems searches Amazon's
// whole public catalog rather than filtering by seller, so it can't discover
// which ASINs this seller actually has; the listings report is inherently
// seller-scoped and works for FBM sellers too (FBA inventory would not).
// Requires the "Inventory and Order Tracking" role, which Olifant's app
// already holds — verified against Amazon's role-mapping docs before
// building this, since the app does NOT hold "Product Listing" (required by
// the Catalog Items API, which is why that path wasn't used).
//
// The sync also propagates product_name into product_economics for matching
// (client, asin) rows — see ProductEconomicsService — but never touches
// product_economics' team-entered fields (margin/strategy/targets/
// launch_until). ASIN entry into product_economics itself stays manual;
// catalog_items independently holds every ASIN the report returns.
//
// Confirmed against 2 real accounts on 2026-08-03 — see
// services/sync-sp-api/internal/amazon/listings.go for the flat-file parser
// and the one fix that came out of that run (a leading UTF-8 BOM silently
// blanked product_name until it was stripped).
export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonSpAccountId: uuid('amazon_sp_account_id')
      .notNull()
      .references(() => amazonSpAccounts.id, { onDelete: 'cascade' }),
    asin: varchar('asin', { length: 20 }).notNull(),
    sellerSku: varchar('seller_sku', { length: 255 }),
    productName: varchar('product_name', { length: 500 }),
    status: varchar('status', { length: 50 }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_catalog_items_account_asin').on(
      t.amazonSpAccountId,
      t.asin,
    ),
    index('idx_catalog_items_account').on(t.amazonSpAccountId),
  ],
);

export const catalogItemsRelations = relations(catalogItems, ({ one }) => ({
  amazonSpAccount: one(amazonSpAccounts, {
    fields: [catalogItems.amazonSpAccountId],
    references: [amazonSpAccounts.id],
  }),
}));

export const anomalies = pgTable(
  'anomalies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    metric: anomalyMetricEnum('metric').notNull(),
    baselineValue: numeric('baseline_value', {
      precision: 14,
      scale: 4,
    }).notNull(),
    actualValue: numeric('actual_value', { precision: 14, scale: 4 }).notNull(),
    // Null when the baseline was 0 — a "new activity" anomaly has no meaningful
    // percentage; never fabricated as a sentinel number.
    percentChange: numeric('percent_change', { precision: 10, scale: 2 }),
    severity: anomalySeverityEnum('severity').notNull(),
    explanation: text('explanation'),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolved: boolean('resolved').notNull().default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Open-anomaly lookup for the dedup check: "is there already an
    // unresolved anomaly for this client+metric?"
    index('idx_anomaly_open_lookup').on(t.clientId, t.metric, t.resolved),
  ],
);

export const anomaliesRelations = relations(anomalies, ({ one }) => ({
  client: one(clients, {
    fields: [anomalies.clientId],
    references: [clients.id],
  }),
}));

export const copilotConversations = pgTable(
  'copilot_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // null clientId = "All Clients" / agency-wide conversation
    clientId: uuid('client_id').references(() => clients.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('idx_copilot_conversations_user').on(t.userId)],
);

export const copilotMessages = pgTable(
  'copilot_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => copilotConversations.id, { onDelete: 'cascade' }),
    role: copilotMessageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    // Anthropic token usage — populated on assistant rows only (null for user rows).
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('idx_copilot_messages_conversation').on(t.conversationId)],
);

export const loginAuditLogs = pgTable(
  'login_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ip: varchar('ip', { length: 45 }).notNull(),
    userAgent: varchar('user_agent', { length: 500 }),
    success: boolean('success').notNull(),
    failureReason: varchar('failure_reason', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_login_audit_email').on(t.email),
    index('idx_login_audit_created_at').on(t.createdAt),
  ],
);

export const copilotConversationsRelations = relations(
  copilotConversations,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [copilotConversations.clientId],
      references: [clients.id],
    }),
    user: one(users, {
      fields: [copilotConversations.userId],
      references: [users.id],
    }),
    messages: many(copilotMessages),
  }),
);

export const copilotMessagesRelations = relations(
  copilotMessages,
  ({ one }) => ({
    conversation: one(copilotConversations, {
      fields: [copilotMessages.conversationId],
      references: [copilotConversations.id],
    }),
  }),
);

// ─── PPC Engine: client config ─────────────────────────────────────────────────
// One row per client (1:1) — PPC-specific settings, kept out of the core
// `clients` table so the task/rule engine's config doesn't bloat the generic
// client record.
export const ppcClientConfigs = pgTable(
  'ppc_client_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // PPC-ops status — deliberately separate from clients.status (the CRM
    // lifecycle: Active/Onboarding/Paused/Churned). frozen = exceptions only,
    // no optimization tasks generated for this account.
    opsStatus: ppcOpsStatusEnum('ops_status').notNull().default('active'),
    monthlyAdBudget: numeric('monthly_ad_budget', { precision: 12, scale: 2 }),
    // Fallback bid-math defaults used when a product has no economics row of
    // its own. marginDefault doubles as the account's default break-even
    // ACOS (BE = margin) — displayed as "BE" in the UI, not stored twice.
    marginDefault: numeric('margin_default', { precision: 5, scale: 2 }),
    targetAcosDefault: numeric('target_acos_default', {
      precision: 5,
      scale: 2,
    }),
    // Account-level rollup/reporting target — independent of the bid-math
    // fallback above. Purely a reporting number; bid/rule math (a later
    // phase) always reads the per-product targets, never this.
    accountTargetMetric: ppcAccountTargetMetricEnum('account_target_metric')
      .notNull()
      .default('tacos'),
    accountTargetMetricValue: numeric('account_target_metric_value', {
      precision: 5,
      scale: 2,
    }),
    brandTerms: jsonb('brand_terms').notNull().default([]),
    ownAsins: jsonb('own_asins').notNull().default([]),
    // Array of { campaignName: string, objective: 'performance' | 'defense' | 'ntb' }.
    sbObjectives: jsonb('sb_objectives').notNull().default([]),
    // Array of { asin: string, campaignName: string, maxTargets: number | null }
    // — which campaign receives harvested keywords for a given ASIN, and an
    // optional cap on how many targets that campaign should hold.
    harvestDestinationCampaigns: jsonb('harvest_destination_campaigns'),
    // Record<ruleName, overrideValue> — per-client overrides of default rule
    // thresholds. Starts empty; the rule engine that reads this is a later
    // phase, this table just holds the config for it.
    thresholdOverrides: jsonb('threshold_overrides'),
    standingDirectives: text('standing_directives'),
    conservativeMode: boolean('conservative_mode').notNull().default(false),
    // Manual per-client escalation applied to every task's priority score
    // (priority.ts's client_multiplier term). Default 1.00 = no escalation.
    // A client paying for a faster SLA, or one the team wants to prioritize,
    // gets this bumped above 1.0; it's a blunt multiplier, not a per-rule setting.
    priorityMultiplier: numeric('priority_multiplier', {
      precision: 4,
      scale: 2,
    })
      .notNull()
      .default('1.00'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('uq_ppc_client_config_client').on(t.clientId)],
);

export const ppcClientConfigsRelations = relations(
  ppcClientConfigs,
  ({ one }) => ({
    client: one(clients, {
      fields: [ppcClientConfigs.clientId],
      references: [clients.id],
    }),
  }),
);

// ─── PPC Engine: product economics roster ──────────────────────────────────────
// asin/productName rows are auto-created and productName kept in sync by the
// SP-API catalog sync (services/sync-sp-api/internal/sync/catalog.go) for
// every active listing it finds. margin/strategy/targetAcos/targetTacos/
// launchUntil are exclusively team-entered — the sync never writes them.
export const productEconomics = pgTable(
  'product_economics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    asin: varchar('asin', { length: 20 }).notNull(),
    productName: varchar('product_name', { length: 255 }),
    margin: numeric('margin', { precision: 5, scale: 2 }),
    strategy: ppcStrategyEnum('strategy'),
    targetAcos: numeric('target_acos', { precision: 5, scale: 2 }),
    targetTacos: numeric('target_tacos', { precision: 5, scale: 2 }),
    launchUntil: date('launch_until'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_product_economics_client_asin').on(t.clientId, t.asin),
    index('idx_product_economics_client').on(t.clientId),
  ],
);

export const productEconomicsRelations = relations(
  productEconomics,
  ({ one }) => ({
    client: one(clients, {
      fields: [productEconomics.clientId],
      references: [clients.id],
    }),
  }),
);

// ─── PPC Engine: rule runner (Today screen exception rules) ────────────────────
// task_candidates is the raw, undeduplicated feed the rule runner writes to.
// The task layer (tasks/task-promotion.service.ts) consumes rows where
// promotedAt IS NULL, converts each into a real task (deduping via
// action_fingerprint), and stamps promotedAt — so promotion is idempotent
// and doesn't depend on correlating against a specific evaluation date.
export const taskCandidates = pgTable(
  'task_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    ruleId: varchar('rule_id', { length: 20 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    evidence: jsonb('evidence').notNull(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_task_candidates_client_rule_entity').on(
      t.clientId,
      t.ruleId,
      t.entityId,
    ),
  ],
);

export const taskCandidatesRelations = relations(taskCandidates, ({ one }) => ({
  client: one(clients, {
    fields: [taskCandidates.clientId],
    references: [clients.id],
  }),
}));

// Backs two runner-level guards, tracked per (client, rule, entity):
//   - persistence guard: streakCount — consecutive days the ENTER threshold
//     has held, before a non-D-band rule is allowed to fire.
//   - hysteresis: isActive — once true, the next evaluation re-checks against
//     the looser CLEAR threshold instead of ENTER, so an entity hovering right
//     at the line doesn't flicker in and out.
export const ruleConditionState = pgTable(
  'rule_condition_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    ruleId: varchar('rule_id', { length: 20 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    isActive: boolean('is_active').notNull().default(false),
    streakCount: integer('streak_count').notNull().default(0),
    lastEvaluatedDate: date('last_evaluated_date').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_rule_condition_state_client_rule_entity').on(
      t.clientId,
      t.ruleId,
      t.entityType,
      t.entityId,
    ),
  ],
);

export const ruleConditionStateRelations = relations(
  ruleConditionState,
  ({ one }) => ({
    client: one(clients, {
      fields: [ruleConditionState.clientId],
      references: [clients.id],
    }),
  }),
);

// ─── Task layer ──────────────────────────────────────────────────────────────

export const taskTypeEnum = pgEnum('task_type', [
  'negation',
  'bid_change',
  'harvest_launch',
  'budget',
  'placement',
  'pause',
  'structural',
  'exception',
  'investigate',
  'sqp_opportunity',
  'rank_defense',
  'cro_flag',
  'inventory_guard',
  'pacing',
]);

export const taskStatusEnum = pgEnum('task_status', [
  'pending',
  'approved',
  'blocked',
  'executed',
  'verified',
  'verify_failed',
  'dismissed',
  'expired',
]);

// Which of the three distinct mismatch cases produced a verify_failed —
// see verification.service.ts. Recorded so the person investigating knows
// whether to look for "never actually done," "someone entered something
// else," or "entity's gone" without re-deriving it from the diff by hand.
export const taskVerifyMismatchReasonEnum = pgEnum(
  'task_verify_mismatch_reason',
  [
    'unchanged', // entity's current value still matches the pre-change oldValue
    'different_value', // entity changed, but not to the confirmed value
    'entity_deleted', // entity no longer appears in the latest snapshot
  ],
);

export const taskConfidenceEnum = pgEnum('task_confidence', [
  'high',
  'medium',
  'provisional',
]);

// Structured dismissal reasons — feed threshold tuning later, so a fixed
// vocabulary rather than free text is required (a note field carries anything
// unstructured on top of the reason).
export const taskDismissReasonEnum = pgEnum('task_dismiss_reason', [
  'not_actionable',
  'already_handled',
  'incorrect_data',
  'client_preference',
  'duplicate',
  'other',
]);

// One counter per calendar day, incremented atomically to produce the
// human-readable TSK-YYYY-MM-DD-NNNNN id — see task-id.service.ts.
export const taskIdCounters = pgTable('task_id_counters', {
  dateKey: date('date_key').primaryKey(),
  counter: integer('counter').notNull().default(0),
});

export const tasks = pgTable(
  'tasks',
  {
    id: varchar('id', { length: 24 }).primaryKey(), // TSK-YYYY-MM-DD-NNNNN
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    profile: varchar('profile', { length: 10 }), // e.g. "US" — marketplace/profile scope, nullable until multi-marketplace tasks exist
    ruleId: varchar('rule_id', { length: 20 }).notNull(),
    // The rule's band (D/W/S/M/I/G) at creation time — stored rather than
    // re-derived from ruleId via the rule registry on every query, since
    // sorting (D-band always above every other band, regardless of score)
    // needs it directly queryable/sortable in SQL.
    band: varchar('band', { length: 5 }).notNull(),
    // Duplicated from action.entityType/action.campaignId as first-class
    // columns — same convention as task_candidates/rule_condition_state —
    // so expiry-on-clear-condition and other entity-scoped lookups don't
    // need JSONB path queries.
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    type: taskTypeEnum('type').notNull(),
    title: text('title').notNull(),
    // { entityType, campaignId, campaignName (verbatim), adGroupId, oldValue, newValue }
    action: jsonb('action').notNull(),
    // { metrics: {...rule evidence...}, window: {start,end}, provenance: {...}, fallbacks: {...} } — see evidence.ts
    evidence: jsonb('evidence').notNull(),
    // Ordered array of console-literal instruction strings — see instruction-templates.ts
    instructions: jsonb('instructions').notNull(),
    impactMonthlyUsd: numeric('impact_monthly_usd', {
      precision: 12,
      scale: 2,
    }),
    impactBasis: text('impact_basis'),
    priorityScore: integer('priority_score').notNull(),
    confidence: taskConfidenceEnum('confidence').notNull(),
    status: taskStatusEnum('status').notNull().default('pending'),
    blockedBy: varchar('blocked_by', { length: 24 }).references(
      (): AnyPgColumn => tasks.id,
    ),
    requiresReview: boolean('requires_review').notNull().default(false),
    standingDirectivesAck: boolean('standing_directives_ack')
      .notNull()
      .default(false),
    assignee: varchar('assignee', { length: 255 }),
    rollback: text('rollback').notNull(),
    dismissReason: taskDismissReasonEnum('dismiss_reason'),
    dismissNote: text('dismiss_note'),
    // Dedup key component — see action-fingerprint.ts for the exact definition.
    actionFingerprint: varchar('action_fingerprint', { length: 64 }).notNull(),
    // What the executor actually confirmed at execution time — may differ
    // from action.newValue (the proposed value). Null for actions with
    // nothing to confirm (investigate-type tasks, action.newValue null).
    // What verification compares against, not action.newValue directly.
    confirmedValue: text('confirmed_value'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifyMismatchReason: taskVerifyMismatchReasonEnum(
      'verify_mismatch_reason',
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_tasks_client_status').on(t.clientId, t.status),
    // Dedup lookup: does an open task already exist for this
    // (client, rule, action_fingerprint)?
    index('idx_tasks_dedup').on(t.clientId, t.ruleId, t.actionFingerprint),
    // Expiry-on-clear lookup: for each open task, what's the current
    // rule_condition_state for its entity?
    index('idx_tasks_entity').on(
      t.clientId,
      t.ruleId,
      t.entityType,
      t.entityId,
    ),
  ],
);

export const tasksRelations = relations(tasks, ({ one }) => ({
  client: one(clients, {
    fields: [tasks.clientId],
    references: [clients.id],
  }),
  blockedByTask: one(tasks, {
    fields: [tasks.blockedBy],
    references: [tasks.id],
  }),
}));

// ─── Entity snapshots: versioned daily history ─────────────────────────────
// Append-only daily rows, not row versioning — one row per (account, date,
// entity). The existing current-state tables (campaigns, etc.) are untouched
// and keep serving live queries; this is additive history alongside them,
// built specifically so diffEntityState (services/sync-ads-api/internal/sync/
// diff.go) has two dated states of the same entity to compare. entity_id
// (and parent_id) are Amazon's own raw ids — not FK'd to campaigns.id —
// same convention as search_term_metrics_daily/target_metrics_daily, since
// several entity types here (keywords, negatives, product ads) have no
// current-state table of their own to FK to yet.
export const entitySnapshotTypeEnum = pgEnum('entity_snapshot_type', [
  'campaign',
  'ad_group',
  'keyword',
  'product_target',
  'negative',
  'product_ad',
  'portfolio',
]);

export const entitySnapshotsDaily = pgTable(
  'entity_snapshots_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonAdsAccountId: uuid('amazon_ads_account_id')
      .notNull()
      .references(() => amazonAdsAccounts.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    entityType: entitySnapshotTypeEnum('entity_type').notNull(),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    // ad_group_id for keyword/product_target/negative/product_ad rows,
    // campaign_id for ad_group/negative(campaign-level) rows, null for
    // campaign/portfolio rows (nothing above them).
    parentId: varchar('parent_id', { length: 255 }),
    // The full field set captured for this entity type on this date — see
    // each entity's amazon.SP*/writer.SnapshotUpsert Go type for the exact
    // shape. Deliberately untyped here (jsonb, not a fixed column set): the
    // 7 entity types have different fields, and the diff engine reads
    // whatever keys are present rather than assuming a shared shape.
    state: jsonb('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_entity_snapshot_daily').on(
      t.amazonAdsAccountId,
      t.snapshotDate,
      t.entityType,
      t.entityId,
    ),
    // "Give me this entity's history" — newest first.
    index('idx_entity_snapshot_history').on(
      t.amazonAdsAccountId,
      t.entityType,
      t.entityId,
      t.snapshotDate,
    ),
  ],
);

export const entitySnapshotsDailyRelations = relations(
  entitySnapshotsDaily,
  ({ one }) => ({
    account: one(amazonAdsAccounts, {
      fields: [entitySnapshotsDaily.amazonAdsAccountId],
      references: [amazonAdsAccounts.id],
    }),
  }),
);

// ─── Ledger: append-only change history ────────────────────────────────────
// Two sources write here — see ledger.service.ts:
//   'engine'   — a task reaching executed/verified, the change the engine
//                itself made (or a human made via the task queue).
//   'external' — a diff-engine-detected change with no matching task; the
//                diff engine's own comparison a human or Amazon made
//                directly in the console/API, outside the task queue.
// Never updated or deleted after insert — a correction is a new row, not an
// edit to an old one. Retained indefinitely (this IS the audit trail).
export const ledgerSourceEnum = pgEnum('ledger_source', ['engine', 'external']);

// Inferred pattern behind an external change, where the evidence clearly
// supports it — deliberately conservative (see ledger.service.ts's
// inferCategory): 'bulk_operation' is the only one actually detected today
// (same field+value changing across several entities on the same account on
// the same day). 'amazon_recommendation' has no signal to detect it against
// in the data this platform captures (no "applied by" field anywhere in the
// synced entity state) — the value exists in the vocabulary but nothing
// assigns it yet, rather than guessing. 'manual' is never assigned either,
// for the same reason: "not bulk" isn't positive evidence of "a human did
// this by hand," just an absence of the one pattern that IS detectable.
export const ledgerCategoryEnum = pgEnum('ledger_category', [
  'bulk_operation',
  'amazon_recommendation',
  'manual',
]);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    profile: varchar('profile', { length: 10 }),
    // The day the change was detected, not the exact console timestamp —
    // for source='external' this is the diff's toDate (daily-granularity
    // detection, see ledger.service.ts). For source='engine' this is the
    // task's executedAt, which IS a real timestamp.
    timestampDetected: timestamp('timestamp_detected', {
      withTimezone: true,
    }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    campaignName: varchar('campaign_name', { length: 500 }),
    field: varchar('field', { length: 100 }).notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    source: ledgerSourceEnum('source').notNull(),
    taskId: varchar('task_id', { length: 24 }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    actor: varchar('actor', { length: 255 }),
    note: text('note'),
    // Not in the literal §8.5 column list — added so "Category inference on
    // external changes" (Part 2) has somewhere real to persist its result.
    category: ledgerCategoryEnum('category'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_ledger_client_timestamp').on(t.clientId, t.timestampDetected),
    index('idx_ledger_client_entity').on(t.clientId, t.entityId),
  ],
);

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  client: one(clients, {
    fields: [ledgerEntries.clientId],
    references: [clients.id],
  }),
  task: one(tasks, {
    fields: [ledgerEntries.taskId],
    references: [tasks.id],
  }),
}));

// ─── Monitor: post-change feedback loop ────────────────────────────────────
// One row per executed task, opening a −14d…+30d window over the EXISTING
// daily fact tables (campaign_metrics_daily / target_metrics_daily /
// search_term_metrics_daily). No Amazon API calls — the monitor is a saved
// query keyed on (entity id, campaign id, execution date), see
// monitor-facts.repository.ts.
export const monitorStateEnum = pgEnum('monitor_state', [
  'watching',
  'concluded',
]);

export const taskMonitors = pgTable(
  'task_monitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: varchar('task_id', { length: 24 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    // Duplicated from the task rather than joined on every read — a monitor
    // must keep measuring the same entity even if the task's own action is
    // later amended, same first-class-column convention as tasks.entityType.
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    // Amazon's campaign id (not campaigns.id) — the parent whose side effects
    // are tracked alongside the entity. Equal to entityId for campaign-level
    // tasks, which is every task any registered rule currently produces.
    campaignId: varchar('campaign_id', { length: 255 }).notNull(),
    executionDate: date('execution_date').notNull(),
    state: monitorStateEnum('state').notNull().default('watching'),
    // Full verdict payloads — see monitor.types.ts's MonitorVerdict for the
    // shape. jsonb rather than columns because a verdict's measured fields
    // differ per task type (savings for a negation, capped-days for a
    // budget change, impression collapse for a bid change).
    checkpoint14d: jsonb('checkpoint_14d'),
    verdict30d: jsonb('verdict_30d'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One monitor per task — openForExecutedTasks relies on this to stay
    // idempotent across repeated runs.
    uniqueIndex('uq_task_monitor_task').on(t.taskId),
    // "Which monitors are still watching" — the daily run's driving query.
    index('idx_task_monitor_state').on(t.state, t.executionDate),
  ],
);

export const taskMonitorsRelations = relations(taskMonitors, ({ one }) => ({
  task: one(tasks, {
    fields: [taskMonitors.taskId],
    references: [tasks.id],
  }),
}));
