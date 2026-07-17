import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { ClickhouseService } from '../../db/clickhouse.service';
import { RedisService } from '../../db/redis.service';
import {
  amazonAdsAccounts,
  amazonSpAccounts,
  spSalesDaily,
} from '../../db/schema';

// ── Internal types ─────────────────────────────────────────────────────────────

interface ChRow {
  account_id: string;
  date: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
}

interface DerivedMetrics {
  revenue: number | null;
  tacos: number | null;
  organicPct: number | null;
  acos: number;
  roas: number;
  cpc: number;
  ctr: number;
  cvr: number;
  totalOrders: number;
}

interface RawDailyTotals {
  spend: number;
  ppcRev: number;
  ppcOrd: number;
  clicks: number;
  impr: number;
}

export type DailyMetricPoint = RawDailyTotals & DerivedMetrics;

// ── Helpers ────────────────────────────────────────────────────────────────────

// orgRev is null when there's no SP-API connection to compute it from (client
// not yet connected, or — for individual ad accounts — total sales is only
// ever known at the client grain, never per-account). Never fabricated as 0.
export function deriveMetrics(
  spend: number,
  ppcRev: number,
  ppcOrd: number,
  clicks: number,
  impr: number,
  orgRev: number | null,
): DerivedMetrics {
  const revenue = orgRev === null ? null : ppcRev + orgRev;
  return {
    revenue,
    tacos: revenue === null ? null : revenue > 0 ? (spend / revenue) * 100 : 0,
    organicPct:
      revenue === null
        ? null
        : revenue > 0
          ? ((orgRev as number) / revenue) * 100
          : 0,
    acos: ppcRev > 0 ? (spend / ppcRev) * 100 : 0,
    roas: spend > 0 ? ppcRev / spend : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    ctr: impr > 0 ? (clicks / impr) * 100 : 0,
    cvr: clicks > 0 ? (ppcOrd / clicks) * 100 : 0,
    totalOrders: ppcOrd,
  };
}

// organic_revenue = total_sales - ppc_sales, floored at 0 — the two Amazon
// systems have different attribution timing, so this can legitimately go
// negative on recent days. Not a bug to chase perfectly, per the task spec.
export function floorOrgRev(
  totalSales: number,
  ppcRev: number,
): { orgRev: number; floored: boolean } {
  const raw = totalSales - ppcRev;
  return raw < 0
    ? { orgRev: 0, floored: true }
    : { orgRev: raw, floored: false };
}

function buildDateSeries(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

const TIER_MAP: Record<string, number> = { t1: 1, t2: 2, t3: 3 };
const STATUS_MAP: Record<string, string> = {
  active: 'Active',
  onboarding: 'Onboarding',
  paused: 'Paused',
  churned: 'Churned',
};

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ch: ClickhouseService,
    private readonly redis: RedisService,
  ) {}

  async getClientMetrics(from: string, to: string, marketplace?: string) {
    const mkt =
      marketplace && marketplace.toUpperCase() !== 'ALL'
        ? marketplace.toUpperCase()
        : null;

    const cacheKey = `metrics:clients:v1:${from}:${to}:${mkt ?? 'ALL'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const result = await this.build(from, to, mkt);
    await this.redis.setex(cacheKey, 300, JSON.stringify(result));
    return result;
  }

  private async build(from: string, to: string, mkt: string | null) {
    // ── 1. Fetch all clients + active accounts from PG ────────────────────────
    const clientRows = await this.drizzle.db.query.clients.findMany({
      with: {
        amazonAdsAccounts: {
          where: eq(amazonAdsAccounts.isActive, true),
        },
      },
      orderBy: (c, { asc }) => [asc(c.name)],
    });

    // ── 2. Filter by marketplace if requested ─────────────────────────────────
    const filtered = mkt
      ? clientRows.filter((c) =>
          c.amazonAdsAccounts.some((a) => a.countryCode?.toUpperCase() === mkt),
        )
      : clientRows;

    // ── 3. Build profile_id → { clientId, marketplace, currencyCode } map ────
    const profileMap = new Map<
      string,
      { clientId: string; marketplace: string; currencyCode: string }
    >();
    for (const c of filtered) {
      for (const a of c.amazonAdsAccounts) {
        if (!mkt || a.countryCode?.toUpperCase() === mkt) {
          profileMap.set(a.profileId, {
            clientId: c.id,
            marketplace: a.marketplace ?? a.countryCode ?? '',
            currencyCode: a.currencyCode ?? '',
          });
        }
      }
    }

    // ── 4. Query ClickHouse ───────────────────────────────────────────────────
    const profileIds = [...profileMap.keys()];
    const chRows: ChRow[] =
      profileIds.length > 0
        ? await this.ch.query<ChRow>(this.buildChQuery(profileIds, from, to))
        : [];

    // ── 5. Build date series for trends ──────────────────────────────────────
    const allDates = buildDateSeries(from, to);

    // ── 6. Account-level aggregation ─────────────────────────────────────────
    interface AccAgg {
      spend: number;
      ppcRev: number;
      ppcOrd: number;
      clicks: number;
      impr: number;
      byDate: Map<string, number>;
      clientId: string;
      marketplace: string;
      currencyCode: string;
      profileId: string;
    }

    const accMap = new Map<string, AccAgg>();
    for (const [profileId, info] of profileMap) {
      accMap.set(profileId, {
        spend: 0,
        ppcRev: 0,
        ppcOrd: 0,
        clicks: 0,
        impr: 0,
        byDate: new Map(),
        profileId,
        ...info,
      });
    }

    for (const row of chRows) {
      const agg = accMap.get(row.account_id);
      if (!agg) continue;
      agg.spend += Number(row.spend);
      agg.ppcRev += Number(row.sales);
      agg.ppcOrd += Number(row.orders);
      agg.clicks += Number(row.clicks);
      agg.impr += Number(row.impressions);
      const prev = agg.byDate.get(row.date) ?? 0;
      agg.byDate.set(row.date, prev + Number(row.spend));
    }

    // ── 7. Client-level aggregation ───────────────────────────────────────────
    interface ClientAgg {
      id: string;
      name: string;
      tier: string | null;
      status: string;
      targetTacos: string | null;
      goalRevenue: string | null;
      spend: number;
      ppcRev: number;
      ppcOrd: number;
      clicks: number;
      impr: number;
      byDate: Map<string, number>;
      accountRows: object[];
    }

    const clientAgg = new Map<string, ClientAgg>();
    for (const c of filtered) {
      clientAgg.set(c.id, {
        id: c.id,
        name: c.name,
        tier: c.tier,
        status: c.status,
        targetTacos: c.targetTacos,
        goalRevenue: c.goalRevenue,
        spend: 0,
        ppcRev: 0,
        ppcOrd: 0,
        clicks: 0,
        impr: 0,
        byDate: new Map(),
        accountRows: [],
      });
    }

    for (const [, agg] of accMap) {
      const client = clientAgg.get(agg.clientId);
      if (!client) continue;

      const trend = allDates.map((d) => agg.byDate.get(d) ?? 0);
      // Total sales from SP-API is only ever known at the client grain (an SP
      // account isn't tied to one ads profile/marketplace) — never computable
      // per individual account row.
      const accDerived = deriveMetrics(
        agg.spend,
        agg.ppcRev,
        agg.ppcOrd,
        agg.clicks,
        agg.impr,
        null,
      );

      client.accountRows.push({
        profileId: agg.profileId,
        marketplace: agg.marketplace,
        currencyCode: agg.currencyCode,
        spend: agg.spend,
        ppcRev: agg.ppcRev,
        ppcOrd: agg.ppcOrd,
        clicks: agg.clicks,
        impr: agg.impr,
        orgRev: null,
        orgOrd: null,
        units: null,
        ...accDerived,
        trend,
      });

      client.spend += agg.spend;
      client.ppcRev += agg.ppcRev;
      client.ppcOrd += agg.ppcOrd;
      client.clicks += agg.clicks;
      client.impr += agg.impr;
      for (const [date, spend] of agg.byDate) {
        client.byDate.set(date, (client.byDate.get(date) ?? 0) + spend);
      }
    }

    // ── 8. Resolve organic revenue (SP-API) per client, where connected ───────
    const { connected, totalSalesByClient } =
      await this.fetchOrganicSalesInputs(
        filtered.map((c) => c.id),
        from,
        to,
      );

    // ── 9. Build client response rows ─────────────────────────────────────────
    const clients = [...clientAgg.values()].map((c) => {
      const trend = allDates.map((d) => c.byDate.get(d) ?? 0);
      const orgRev = this.resolveClientOrgRev(
        c.id,
        c.ppcRev,
        connected,
        totalSalesByClient,
      );
      const d = deriveMetrics(
        c.spend,
        c.ppcRev,
        c.ppcOrd,
        c.clicks,
        c.impr,
        orgRev,
      );
      return {
        id: c.id,
        name: c.name,
        tier: TIER_MAP[c.tier ?? ''] ?? 3,
        status: STATUS_MAP[c.status] ?? c.status,
        goalTacos: c.targetTacos ? parseFloat(c.targetTacos) : null,
        goalRevenue: c.goalRevenue ? parseFloat(c.goalRevenue) : null,
        marketplaceCount: c.accountRows.length,
        spend: c.spend,
        ppcRev: c.ppcRev,
        ppcOrd: c.ppcOrd,
        clicks: c.clicks,
        impr: c.impr,
        orgRev,
        orgOrd: null,
        units: null,
        ...d,
        trend,
        accounts: c.accountRows,
      };
    });

    // ── 10. Totals — sum raw inputs first, then derive once ───────────────────
    const raw = clients.reduce(
      (acc, c) => ({
        spend: acc.spend + c.spend,
        ppcRev: acc.ppcRev + c.ppcRev,
        ppcOrd: acc.ppcOrd + c.ppcOrd,
        clicks: acc.clicks + c.clicks,
        impr: acc.impr + c.impr,
      }),
      { spend: 0, ppcRev: 0, ppcOrd: 0, clicks: 0, impr: 0 },
    );
    // Only sums what's actually known — null only when not a single client is
    // SP-API connected yet, same null-propagation deriveMetrics applies per client.
    const totalsOrgRev = clients.some((c) => c.orgRev !== null)
      ? clients.reduce((sum, c) => sum + (c.orgRev ?? 0), 0)
      : null;
    const totalsDerived = deriveMetrics(
      raw.spend,
      raw.ppcRev,
      raw.ppcOrd,
      raw.clicks,
      raw.impr,
      totalsOrgRev,
    );
    const activeCount = clients.filter((c) => c.status === 'Active').length;

    return {
      from,
      to,
      marketplace: mkt ?? 'ALL',
      clients,
      totals: {
        ...raw,
        orgRev: totalsOrgRev,
        orgOrd: null,
        units: null,
        ...totalsDerived,
        clientCount: clients.length,
        activeCount,
      },
    };
  }

  // ── Organic revenue (SP-API) ─────────────────────────────────────────────────

  // Returns which clients have an active SP-API connection, and each
  // connected client's total (organic + PPC) sales for the date range.
  private async fetchOrganicSalesInputs(
    clientIds: string[],
    from: string,
    to: string,
  ): Promise<{
    connected: Set<string>;
    totalSalesByClient: Map<string, number>;
  }> {
    if (clientIds.length === 0) {
      return { connected: new Set(), totalSalesByClient: new Map() };
    }

    const connectedRows = await this.drizzle.db
      .select({ clientId: amazonSpAccounts.clientId })
      .from(amazonSpAccounts)
      .where(
        and(
          eq(amazonSpAccounts.isActive, true),
          inArray(amazonSpAccounts.clientId, clientIds),
        ),
      );
    const connected = new Set(connectedRows.map((r) => r.clientId));

    const salesRows = await this.drizzle.db
      .select({
        clientId: amazonSpAccounts.clientId,
        totalSales: sql<string>`COALESCE(SUM(${spSalesDaily.totalSales}), 0)`,
      })
      .from(spSalesDaily)
      .innerJoin(
        amazonSpAccounts,
        eq(spSalesDaily.amazonSpAccountId, amazonSpAccounts.id),
      )
      .where(
        and(
          inArray(amazonSpAccounts.clientId, clientIds),
          gte(spSalesDaily.date, from),
          lte(spSalesDaily.date, to),
        ),
      )
      .groupBy(amazonSpAccounts.clientId);

    const totalSalesByClient = new Map<string, number>();
    for (const row of salesRows) {
      totalSalesByClient.set(row.clientId, Number(row.totalSales));
    }

    return { connected, totalSalesByClient };
  }

  // null = not SP-API connected (genuinely unknown, never fabricated as 0).
  // Floored at 0 (with a warning) when SP-API total sales come in under PPC
  // revenue — expected on recent days given the two APIs' different
  // attribution timing, not a bug to chase perfectly.
  private resolveClientOrgRev(
    clientId: string,
    ppcRev: number,
    connected: Set<string>,
    totalSalesByClient: Map<string, number>,
  ): number | null {
    if (!connected.has(clientId)) return null;

    const totalSales = totalSalesByClient.get(clientId) ?? 0;
    const { orgRev, floored } = floorOrgRev(totalSales, ppcRev);
    if (floored) {
      this.logger.warn(
        `Client ${clientId}: organic revenue floored at 0 (SP-API total sales ${totalSales} < PPC revenue ${ppcRev}) — likely attribution timing drift between SP-API and Ads API.`,
      );
    }
    return orgRev;
  }

  // ── Daily metrics (anomaly detection) ─────────────────────────────────────────

  // Per-day metrics for ONE client, reusing buildChQuery/deriveMetrics as-is —
  // getClientMetrics collapses everything but spend into range totals, but
  // baseline calculation needs the real daily values.
  async getDailyMetricsForClient(
    clientId: string,
    from: string,
    to: string,
  ): Promise<Map<string, DailyMetricPoint>> {
    const adsAccounts = await this.drizzle.db.query.amazonAdsAccounts.findMany({
      where: and(
        eq(amazonAdsAccounts.clientId, clientId),
        eq(amazonAdsAccounts.isActive, true),
      ),
    });
    const profileIds = adsAccounts.map((a) => a.profileId);

    const chRows: ChRow[] =
      profileIds.length > 0
        ? await this.ch.query<ChRow>(this.buildChQuery(profileIds, from, to))
        : [];

    const byDate = new Map<string, RawDailyTotals>();
    for (const row of chRows) {
      const agg = byDate.get(row.date) ?? {
        spend: 0,
        ppcRev: 0,
        ppcOrd: 0,
        clicks: 0,
        impr: 0,
      };
      agg.spend += Number(row.spend);
      agg.ppcRev += Number(row.sales);
      agg.ppcOrd += Number(row.orders);
      agg.clicks += Number(row.clicks);
      agg.impr += Number(row.impressions);
      byDate.set(row.date, agg);
    }

    const { connected, totalSalesByDate } = await this.fetchOrganicSalesDaily(
      clientId,
      from,
      to,
    );

    const result = new Map<string, DailyMetricPoint>();
    for (const date of buildDateSeries(from, to)) {
      const agg = byDate.get(date) ?? {
        spend: 0,
        ppcRev: 0,
        ppcOrd: 0,
        clicks: 0,
        impr: 0,
      };
      const orgRev = connected
        ? floorOrgRev(totalSalesByDate.get(date) ?? 0, agg.ppcRev).orgRev
        : null;
      const derived = deriveMetrics(
        agg.spend,
        agg.ppcRev,
        agg.ppcOrd,
        agg.clicks,
        agg.impr,
        orgRev,
      );
      result.set(date, { ...agg, ...derived });
    }
    return result;
  }

  // Same shape as fetchOrganicSalesInputs but grouped by date instead of
  // aggregated over the whole range, and scoped to one client.
  private async fetchOrganicSalesDaily(
    clientId: string,
    from: string,
    to: string,
  ): Promise<{ connected: boolean; totalSalesByDate: Map<string, number> }> {
    const connectedRows = await this.drizzle.db
      .select({ id: amazonSpAccounts.id })
      .from(amazonSpAccounts)
      .where(
        and(
          eq(amazonSpAccounts.isActive, true),
          eq(amazonSpAccounts.clientId, clientId),
        ),
      )
      .limit(1);
    if (connectedRows.length === 0) {
      return { connected: false, totalSalesByDate: new Map() };
    }

    const salesRows = await this.drizzle.db
      .select({
        date: spSalesDaily.date,
        totalSales: sql<string>`COALESCE(SUM(${spSalesDaily.totalSales}), 0)`,
      })
      .from(spSalesDaily)
      .innerJoin(
        amazonSpAccounts,
        eq(spSalesDaily.amazonSpAccountId, amazonSpAccounts.id),
      )
      .where(
        and(
          eq(amazonSpAccounts.clientId, clientId),
          gte(spSalesDaily.date, from),
          lte(spSalesDaily.date, to),
        ),
      )
      .groupBy(spSalesDaily.date);

    const totalSalesByDate = new Map<string, number>();
    for (const row of salesRows) {
      totalSalesByDate.set(row.date, Number(row.totalSales));
    }
    return { connected: true, totalSalesByDate };
  }

  private buildChQuery(profileIds: string[], from: string, to: string): string {
    const ids = profileIds.map((id) => `'${id}'`).join(',');
    return `
      SELECT
        account_id,
        toString(date) AS date,
        toFloat64(SUM(spend))       AS spend,
        toFloat64(SUM(sales))       AS sales,
        toUInt64(SUM(orders))       AS orders,
        toUInt64(SUM(clicks))       AS clicks,
        toUInt64(SUM(impressions))  AS impressions
      FROM campaign_metrics
      WHERE date >= '${from}' AND date <= '${to}'
        AND account_id IN (${ids})
      GROUP BY account_id, date
      ORDER BY account_id, date
    `;
  }
}
