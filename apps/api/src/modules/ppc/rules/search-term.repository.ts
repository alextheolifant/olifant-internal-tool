import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import {
  amazonAdsAccounts,
  campaigns,
  entitySnapshotsDaily,
  searchTermMetricsDaily,
  targetMetricsDaily,
} from '../../../db/schema';
import { normalizeSearchTerm } from './term-normalization';

/** One (campaign, ad group, term) aggregate over the trigger window. */
export interface TermAggregate {
  accountId: string;
  campaignId: string;
  campaignName: string | null;
  adGroupId: string;
  searchTerm: string; // verbatim, exactly as Amazon reported it
  normalizedTerm: string;
  keywordId: string | null;
  matchType: string | null;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
}

/** Clicks-per-order population for one ad group or campaign. */
export interface ClicksOrdersPopulation {
  clicks: number;
  orders: number;
}

/** A place the same normalized term is converting, for Guard 2. */
export interface TermWinner {
  kind: 'search_term' | 'enabled_exact_target';
  campaignId: string;
  campaignName: string | null;
  adGroupId: string | null;
  /** Verbatim text as it appears on the winning side. */
  text: string;
  matchType: string | null;
  state: string | null;
  clicks: number;
  orders: number;
  sales: number;
}

@Injectable()
export class SearchTermRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async getAccountIds(clientId: string): Promise<string[]> {
    const rows = await this.drizzle.db
      .select({ id: amazonAdsAccounts.id })
      .from(amazonAdsAccounts)
      .where(eq(amazonAdsAccounts.clientId, clientId));
    return rows.map((r) => r.id);
  }

  /**
   * Every (campaign, ad group, term) aggregate in the window, for one
   * client. Grouped by campaign BY CONSTRUCTION — W1 never sees a term
   * account-wide, which is Guard 1 enforced at the data layer rather than
   * left to the rule to remember.
   *
   * Campaign name is joined verbatim from the campaigns table so the task
   * payload and instructions can quote it exactly, per the self-contained
   * instruction standard.
   */
  async getTermAggregates(
    accountIds: string[],
    windowStart: string,
    windowEnd: string,
  ): Promise<TermAggregate[]> {
    if (accountIds.length === 0) return [];

    const rows = await this.drizzle.db
      .select({
        accountId: searchTermMetricsDaily.amazonAdsAccountId,
        campaignId: searchTermMetricsDaily.campaignId,
        campaignName: campaigns.name,
        adGroupId: searchTermMetricsDaily.adGroupId,
        searchTerm: searchTermMetricsDaily.searchTerm,
        keywordId: sql<string | null>`max(${searchTermMetricsDaily.keywordId})`,
        matchType: sql<string | null>`max(${searchTermMetricsDaily.matchType})`,
        clicks: sql<string>`sum(${searchTermMetricsDaily.clicks})`,
        cost: sql<string>`sum(${searchTermMetricsDaily.cost})`,
        orders: sql<string>`sum(${searchTermMetricsDaily.orders7d})`,
        sales: sql<string>`sum(${searchTermMetricsDaily.sales7d})`,
      })
      .from(searchTermMetricsDaily)
      .leftJoin(
        campaigns,
        and(
          eq(campaigns.campaignId, searchTermMetricsDaily.campaignId),
          eq(
            campaigns.amazonAdsAccountId,
            searchTermMetricsDaily.amazonAdsAccountId,
          ),
        ),
      )
      .where(
        and(
          inArray(searchTermMetricsDaily.amazonAdsAccountId, accountIds),
          gte(searchTermMetricsDaily.date, windowStart),
          lte(searchTermMetricsDaily.date, windowEnd),
        ),
      )
      .groupBy(
        searchTermMetricsDaily.amazonAdsAccountId,
        searchTermMetricsDaily.campaignId,
        campaigns.name,
        searchTermMetricsDaily.adGroupId,
        searchTermMetricsDaily.searchTerm,
      );

    return rows.map((r) => ({
      accountId: r.accountId,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      adGroupId: r.adGroupId,
      searchTerm: r.searchTerm,
      normalizedTerm: normalizeSearchTerm(r.searchTerm),
      keywordId: r.keywordId,
      matchType: r.matchType,
      clicks: Number(r.clicks ?? 0),
      cost: Number(r.cost ?? 0),
      orders: Number(r.orders ?? 0),
      sales: Number(r.sales ?? 0),
    }));
  }

  /**
   * Clicks-and-orders populations for expected_clicks_per_order, keyed by ad
   * group id and by campaign id, over the (longer) expectation window.
   *
   * Read from target_metrics_daily rather than search_term_metrics_daily:
   * targets are what actually carry the bids and spend, so their
   * clicks-per-order is the ad group's true conversion economics. A search
   * term aggregate would double-count the same clicks across the several
   * terms that matched one target.
   */
  async getClicksOrdersPopulations(
    accountIds: string[],
    windowStart: string,
    windowEnd: string,
  ): Promise<{
    byAdGroup: Map<string, ClicksOrdersPopulation>;
    byCampaign: Map<string, ClicksOrdersPopulation>;
  }> {
    const byAdGroup = new Map<string, ClicksOrdersPopulation>();
    const byCampaign = new Map<string, ClicksOrdersPopulation>();
    if (accountIds.length === 0) return { byAdGroup, byCampaign };

    const rows = await this.drizzle.db
      .select({
        campaignId: targetMetricsDaily.campaignId,
        adGroupId: targetMetricsDaily.adGroupId,
        clicks: sql<string>`sum(${targetMetricsDaily.clicks})`,
        orders: sql<string>`sum(${targetMetricsDaily.orders7d})`,
      })
      .from(targetMetricsDaily)
      .where(
        and(
          inArray(targetMetricsDaily.amazonAdsAccountId, accountIds),
          gte(targetMetricsDaily.date, windowStart),
          lte(targetMetricsDaily.date, windowEnd),
        ),
      )
      .groupBy(targetMetricsDaily.campaignId, targetMetricsDaily.adGroupId);

    for (const r of rows) {
      const clicks = Number(r.clicks ?? 0);
      const orders = Number(r.orders ?? 0);
      add(byAdGroup, r.adGroupId, clicks, orders);
      add(byCampaign, r.campaignId, clicks, orders);
    }
    return { byAdGroup, byCampaign };
  }

  /**
   * Daily click series for one term inside one campaign — Guard 3's input.
   * Spans a reference window longer than the 14-day restatement period, per
   * checkSettledData's own requirement.
   */
  async getTermDailyClicks(
    accountIds: string[],
    campaignId: string,
    searchTerm: string,
    windowStart: string,
    windowEnd: string,
  ): Promise<{ date: string; clicks: number }[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.drizzle.db
      .select({
        date: searchTermMetricsDaily.date,
        clicks: sql<string>`sum(${searchTermMetricsDaily.clicks})`,
      })
      .from(searchTermMetricsDaily)
      .where(
        and(
          inArray(searchTermMetricsDaily.amazonAdsAccountId, accountIds),
          eq(searchTermMetricsDaily.campaignId, campaignId),
          eq(searchTermMetricsDaily.searchTerm, searchTerm),
          gte(searchTermMetricsDaily.date, windowStart),
          lte(searchTermMetricsDaily.date, windowEnd),
        ),
      )
      .groupBy(searchTermMetricsDaily.date);
    return rows.map((r) => ({ date: r.date, clicks: Number(r.clicks ?? 0) }));
  }

  /**
   * Guard 2 — winner cross-check.
   *
   * TODO(target-index): the plan's Phase 2.2 Target Index (a denormalized
   * nightly table of term × match type × campaign × state × bid × trailing
   * performance) is the intended home for this lookup. It doesn't exist yet,
   * so this queries search_term_metrics_daily and entity_snapshots_daily
   * directly. Correct, but it scans rather than seeks — migrate when the
   * index ships.
   *
   * Two independent sources of "this term wins somewhere":
   *   a) the same normalized term converting as a SEARCH TERM in any other
   *      campaign in the account
   *   b) the same normalized term existing as an ENABLED EXACT keyword
   *      target that converted in the window
   *
   * Both sides are normalized with normalizeSearchTerm — the comparison is
   * normalized-to-normalized, never raw-to-normalized.
   */
  async findWinnersElsewhere(
    accountIds: string[],
    normalizedTerm: string,
    excludeCampaignId: string,
    windowStart: string,
    windowEnd: string,
  ): Promise<TermWinner[]> {
    if (accountIds.length === 0) return [];
    const winners: TermWinner[] = [];

    // (a) Converting as a search term in another campaign.
    const stRows = await this.drizzle.db
      .select({
        campaignId: searchTermMetricsDaily.campaignId,
        campaignName: campaigns.name,
        adGroupId: searchTermMetricsDaily.adGroupId,
        searchTerm: searchTermMetricsDaily.searchTerm,
        matchType: sql<string | null>`max(${searchTermMetricsDaily.matchType})`,
        clicks: sql<string>`sum(${searchTermMetricsDaily.clicks})`,
        orders: sql<string>`sum(${searchTermMetricsDaily.orders7d})`,
        sales: sql<string>`sum(${searchTermMetricsDaily.sales7d})`,
      })
      .from(searchTermMetricsDaily)
      .leftJoin(
        campaigns,
        and(
          eq(campaigns.campaignId, searchTermMetricsDaily.campaignId),
          eq(
            campaigns.amazonAdsAccountId,
            searchTermMetricsDaily.amazonAdsAccountId,
          ),
        ),
      )
      .where(
        and(
          inArray(searchTermMetricsDaily.amazonAdsAccountId, accountIds),
          gte(searchTermMetricsDaily.date, windowStart),
          lte(searchTermMetricsDaily.date, windowEnd),
        ),
      )
      .groupBy(
        searchTermMetricsDaily.campaignId,
        campaigns.name,
        searchTermMetricsDaily.adGroupId,
        searchTermMetricsDaily.searchTerm,
      )
      .having(sql`sum(${searchTermMetricsDaily.orders7d}) > 0`);

    for (const r of stRows) {
      if (r.campaignId === excludeCampaignId) continue;
      if (normalizeSearchTerm(r.searchTerm) !== normalizedTerm) continue;
      winners.push({
        kind: 'search_term',
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        adGroupId: r.adGroupId,
        text: r.searchTerm,
        matchType: r.matchType,
        state: null,
        clicks: Number(r.clicks ?? 0),
        orders: Number(r.orders ?? 0),
        sales: Number(r.sales ?? 0),
      });
    }

    // (b) Existing as an ENABLED EXACT keyword target that converted.
    const snapshotDate = await this.latestSnapshotDate(accountIds);
    if (snapshotDate) {
      const kwRows = await this.drizzle.db
        .select({
          entityId: entitySnapshotsDaily.entityId,
          state: entitySnapshotsDaily.state,
        })
        .from(entitySnapshotsDaily)
        .where(
          and(
            inArray(entitySnapshotsDaily.amazonAdsAccountId, accountIds),
            eq(entitySnapshotsDaily.entityType, 'keyword'),
            eq(entitySnapshotsDaily.snapshotDate, snapshotDate),
          ),
        );

      const matchingTargetIds: {
        targetId: string;
        text: string;
        campaignId: string;
        adGroupId: string | null;
      }[] = [];
      for (const r of kwRows) {
        const s = r.state as {
          keywordText?: string;
          matchType?: string;
          state?: string;
          campaignId?: string;
          adGroupId?: string;
        };
        if (
          !s?.keywordText ||
          normalizeSearchTerm(s.keywordText) !== normalizedTerm
        )
          continue;
        if ((s.state ?? '').toUpperCase() !== 'ENABLED') continue;
        if ((s.matchType ?? '').toUpperCase() !== 'EXACT') continue;
        if (s.campaignId === excludeCampaignId) continue;
        matchingTargetIds.push({
          targetId: r.entityId,
          text: s.keywordText,
          campaignId: s.campaignId ?? '',
          adGroupId: s.adGroupId ?? null,
        });
      }

      if (matchingTargetIds.length > 0) {
        const perf = await this.getTargetPerformance(
          accountIds,
          matchingTargetIds.map((m) => m.targetId),
          windowStart,
          windowEnd,
        );
        for (const m of matchingTargetIds) {
          const p = perf.get(m.targetId);
          if (!p || p.orders <= 0) continue; // must be CONVERTING, not merely enabled
          winners.push({
            kind: 'enabled_exact_target',
            campaignId: m.campaignId,
            campaignName: null,
            adGroupId: m.adGroupId,
            text: m.text,
            matchType: 'EXACT',
            state: 'ENABLED',
            clicks: p.clicks,
            orders: p.orders,
            sales: p.sales,
          });
        }
      }
    }

    return winners;
  }

  private async latestSnapshotDate(
    accountIds: string[],
  ): Promise<string | null> {
    const [row] = await this.drizzle.db
      .select({
        d: sql<string | null>`max(${entitySnapshotsDaily.snapshotDate})`,
      })
      .from(entitySnapshotsDaily)
      .where(inArray(entitySnapshotsDaily.amazonAdsAccountId, accountIds));
    return row?.d ?? null;
  }

  private async getTargetPerformance(
    accountIds: string[],
    targetIds: string[],
    windowStart: string,
    windowEnd: string,
  ): Promise<Map<string, { clicks: number; orders: number; sales: number }>> {
    const out = new Map<
      string,
      { clicks: number; orders: number; sales: number }
    >();
    if (targetIds.length === 0) return out;
    const rows = await this.drizzle.db
      .select({
        targetId: targetMetricsDaily.targetId,
        clicks: sql<string>`sum(${targetMetricsDaily.clicks})`,
        orders: sql<string>`sum(${targetMetricsDaily.orders7d})`,
        sales: sql<string>`sum(${targetMetricsDaily.sales7d})`,
      })
      .from(targetMetricsDaily)
      .where(
        and(
          inArray(targetMetricsDaily.amazonAdsAccountId, accountIds),
          inArray(targetMetricsDaily.targetId, targetIds),
          gte(targetMetricsDaily.date, windowStart),
          lte(targetMetricsDaily.date, windowEnd),
        ),
      )
      .groupBy(targetMetricsDaily.targetId);
    for (const r of rows) {
      out.set(r.targetId, {
        clicks: Number(r.clicks ?? 0),
        orders: Number(r.orders ?? 0),
        sales: Number(r.sales ?? 0),
      });
    }
    return out;
  }
}

function add(
  map: Map<string, ClicksOrdersPopulation>,
  key: string,
  clicks: number,
  orders: number,
): void {
  const cur = map.get(key);
  if (cur) {
    cur.clicks += clicks;
    cur.orders += orders;
  } else {
    map.set(key, { clicks, orders });
  }
}
