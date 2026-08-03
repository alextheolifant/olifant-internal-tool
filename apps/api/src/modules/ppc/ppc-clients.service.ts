import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';
import {
  amazonAdsAccounts,
  amazonSpAccounts,
  ppcClientConfigs,
  productEconomics,
  syncLogs,
} from '../../db/schema';
import { MetricsService } from '../metrics/metrics.service';
import { computePpcConfigCompleteness, type ProductEconomicsCheck } from './ppc-completeness';
import { classifyFreshness, type ClientFreshness } from './ppc-freshness';

export interface PpcClientRow {
  id: string;
  name: string;
  tier: number;
  status: string;
  spend: number;
  acos: number;
  roas: number;
  // Needs keyword/target-level spend+orders — nothing in this codebase syncs
  // that granularity yet (only campaign-level). Not fabricated as 0.
  wastedSpend: null;
  configCompletePercent: number;
  configChecklist: { key: string; label: string; met: boolean }[];
  locked: boolean;
  freshness: ClientFreshness;
  // Simplified stand-in for the eventual W8 pacing calculation: month-to-date
  // ad spend vs. monthly_ad_budget from config. Always calendar-month-to-date,
  // independent of whatever date range the caller passed in.
  pacing: { spendMonthToDate: number; monthlyBudget: number; percent: number } | null;
  // Deferred — needs the task layer / Ledger + Monitor / SP-API inventory
  // (later phases). Rendered as unavailable, never fabricated as 0.
  openTasks: null;
  dollarsAtStake: null;
  verifiedSavingsPerMonth: null;
  guardActive: null;
  externalChanges30d: null;
}

function num(v: string | null): number | null {
  return v === null ? null : parseFloat(v);
}

function firstOfMonthUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class PpcClientsService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly redis: RedisService,
    private readonly metricsService: MetricsService,
  ) {}

  async getClients(from: string, to: string, marketplace?: string): Promise<{ clients: PpcClientRow[] }> {
    const cacheKey = `ppc:clients:v1:${from}:${to}:${marketplace ?? 'ALL'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const metrics = await this.metricsService.getClientMetrics(from, to, marketplace);
    const clientIds: string[] = metrics.clients.map((c: { id: string }) => c.id);

    const [configByClient, productsByClient, freshnessByClient, spendMtdByClient] =
      await Promise.all([
        this.fetchConfigs(clientIds),
        this.fetchProducts(clientIds),
        this.fetchFreshness(clientIds),
        this.fetchSpendMonthToDate(clientIds, marketplace),
      ]);

    const rows: PpcClientRow[] = metrics.clients.map(
      (c: {
        id: string;
        name: string;
        tier: number;
        status: string;
        spend: number;
        acos: number;
        roas: number;
      }) => {
        const config = configByClient.get(c.id);
        const products = productsByClient.get(c.id) ?? [];
        const completeness = computePpcConfigCompleteness({
          monthlyAdBudget: config ? num(config.monthlyAdBudget) : null,
          targetAcosDefault: config ? num(config.targetAcosDefault) : null,
          accountTargetMetricValue: config ? num(config.accountTargetMetricValue) : null,
          products,
        });

        const monthlyBudget = config ? num(config.monthlyAdBudget) : null;
        const spendMtd = spendMtdByClient.get(c.id) ?? 0;

        return {
          id: c.id,
          name: c.name,
          tier: c.tier,
          status: c.status,
          spend: c.spend,
          acos: c.acos,
          roas: c.roas,
          wastedSpend: null,
          configCompletePercent: completeness.percent,
          configChecklist: completeness.checklist,
          locked: completeness.percent < 100,
          freshness: freshnessByClient.get(c.id) ?? { lastSyncedAt: null, level: 'unknown' },
          pacing:
            monthlyBudget !== null
              ? {
                  spendMonthToDate: spendMtd,
                  monthlyBudget,
                  percent: monthlyBudget > 0 ? (spendMtd / monthlyBudget) * 100 : 0,
                }
              : null,
          openTasks: null,
          dollarsAtStake: null,
          verifiedSavingsPerMonth: null,
          guardActive: null,
          externalChanges30d: null,
        };
      },
    );

    const result = { clients: rows };
    await this.redis.setex(cacheKey, 300, JSON.stringify(result));
    return result;
  }

  private async fetchConfigs(
    clientIds: string[],
  ): Promise<Map<string, typeof ppcClientConfigs.$inferSelect>> {
    if (clientIds.length === 0) return new Map();
    const rows = await this.drizzle.db.query.ppcClientConfigs.findMany({
      where: inArray(ppcClientConfigs.clientId, clientIds),
    });
    return new Map(rows.map((r) => [r.clientId, r]));
  }

  private async fetchProducts(clientIds: string[]): Promise<Map<string, ProductEconomicsCheck[]>> {
    if (clientIds.length === 0) return new Map();
    const rows = await this.drizzle.db.query.productEconomics.findMany({
      where: inArray(productEconomics.clientId, clientIds),
    });
    const byClient = new Map<string, ProductEconomicsCheck[]>();
    for (const r of rows) {
      const list = byClient.get(r.clientId) ?? [];
      list.push({
        strategy: r.strategy,
        targetAcos: num(r.targetAcos),
        targetTacos: num(r.targetTacos),
        launchUntil: r.launchUntil,
      });
      byClient.set(r.clientId, list);
    }
    return byClient;
  }

  // Latest successful sync per client, across both the Ads API and SP-API
  // account paths — whichever synced most recently wins.
  private async fetchFreshness(clientIds: string[]): Promise<Map<string, ClientFreshness>> {
    if (clientIds.length === 0) return new Map();

    const adsRows = await this.drizzle.db
      .select({
        clientId: amazonAdsAccounts.clientId,
        completedAt: syncLogs.completedAt,
      })
      .from(syncLogs)
      .innerJoin(amazonAdsAccounts, eq(syncLogs.amazonAdsAccountId, amazonAdsAccounts.id))
      .where(inArray(amazonAdsAccounts.clientId, clientIds));

    const spRows = await this.drizzle.db
      .select({
        clientId: amazonSpAccounts.clientId,
        completedAt: syncLogs.completedAt,
      })
      .from(syncLogs)
      .innerJoin(amazonSpAccounts, eq(syncLogs.amazonSpAccountId, amazonSpAccounts.id))
      .where(inArray(amazonSpAccounts.clientId, clientIds));

    const latestByClient = new Map<string, Date>();
    for (const row of [...adsRows, ...spRows]) {
      if (!row.completedAt) continue;
      const current = latestByClient.get(row.clientId);
      if (!current || row.completedAt > current) latestByClient.set(row.clientId, row.completedAt);
    }

    const result = new Map<string, ClientFreshness>();
    for (const id of clientIds) result.set(id, classifyFreshness(latestByClient.get(id) ?? null));
    return result;
  }

  // Month-to-date spend per client, independent of whatever date range the
  // caller requested — pacing is inherently a calendar-month concept.
  private async fetchSpendMonthToDate(
    clientIds: string[],
    marketplace?: string,
  ): Promise<Map<string, number>> {
    if (clientIds.length === 0) return new Map();
    const metrics = await this.metricsService.getClientMetrics(
      firstOfMonthUtc(),
      todayUtc(),
      marketplace,
    );
    return new Map(
      metrics.clients.map((c: { id: string; spend: number }) => [c.id, c.spend]),
    );
  }
}
