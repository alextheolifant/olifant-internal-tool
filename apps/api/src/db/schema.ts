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
    connectedByUserId: uuid('connected_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
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
    // manually in the migration — Drizzle doesn't support partial index WHERE clauses.
  ],
);

export const spReportRequests = pgTable(
  'sp_report_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    amazonSpAccountId: uuid('amazon_sp_account_id')
      .notNull()
      .references(() => amazonSpAccounts.id, { onDelete: 'cascade' }),
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

export const anomalies = pgTable(
  'anomalies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    metric: anomalyMetricEnum('metric').notNull(),
    baselineValue: numeric('baseline_value', { precision: 14, scale: 4 }).notNull(),
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
    targetAcosDefault: numeric('target_acos_default', { precision: 5, scale: 2 }),
    // Account-level rollup/reporting target — independent of the bid-math
    // fallback above. Purely a reporting number; bid/rule math (a later
    // phase) always reads the per-product targets, never this.
    accountTargetMetric: ppcAccountTargetMetricEnum('account_target_metric')
      .notNull()
      .default('tacos'),
    accountTargetMetricValue: numeric('account_target_metric_value', { precision: 5, scale: 2 }),
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
// Auto-population from Amazon's Catalog Items API is a later phase (needs that
// SP-API endpoint synced, not yet built) — today's Ads sync doesn't carry
// product-ad/ASIN-level data either, so this roster starts empty and is
// manually maintained until then.
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
