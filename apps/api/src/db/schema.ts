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
  'sp_orders',
  'sp_inventory',
  'ads_profiles',
]);

export const syncStatusEnum = pgEnum('sync_status', [
  'pending',
  'running',
  'success',
  'failed',
]);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: userRoleEnum('role').notNull().default('analyst'),
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
    marketplace: varchar('marketplace', { length: 10 }),
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
  (t) => [index('idx_sp_account_client').on(t.clientId)],
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, () => ({}));

export const clientsRelations = relations(clients, ({ many }) => ({
  amazonAdsAccounts: many(amazonAdsAccounts),
  amazonSpAccounts: many(amazonSpAccounts),
}));

export const amazonAdsAccountsRelations = relations(
  amazonAdsAccounts,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [amazonAdsAccounts.clientId],
      references: [clients.id],
    }),
    campaigns: many(campaigns),
    syncLogs: many(syncLogs),
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
}));

export const amazonSpAccountsRelations = relations(
  amazonSpAccounts,
  ({ one }) => ({
    client: one(clients, {
      fields: [amazonSpAccounts.clientId],
      references: [clients.id],
    }),
  }),
);

export const loginAuditLogs = pgTable(
  'login_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    ip: varchar('ip', { length: 45 }).notNull(),
    userAgent: varchar('user_agent', { length: 500 }),
    success: boolean('success').notNull(),
    failureReason: varchar('failure_reason', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_login_audit_email').on(t.email),
    index('idx_login_audit_created_at').on(t.createdAt),
  ],
);
