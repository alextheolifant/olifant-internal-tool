import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import {
  amazonAdsAccounts,
  campaignMetricsDaily,
  campaigns,
  searchTermMetricsDaily,
  targetMetricsDaily,
} from '../../../db/schema';
import { parseSearchTermEntityId } from '../rules/term-normalization';
import type { DailyFactRow } from './normalization';

// ─── Monitor fact access ────────────────────────────────────────────────────
// The monitor makes NO Amazon API calls — every number it reports is a query
// against the daily fact tables the sync services already populate. This
// repository is the whole of that access.
//
// Which table serves which entity level:
//   campaign        -> campaign_metrics_daily (joined through campaigns,
//                      whose uuid PK is what the fact table FKs to — the
//                      Amazon campaign id lives on campaigns.campaign_id)
//   keyword /       -> target_metrics_daily (target_id holds the keyword or
//   product_target     target id; confirmed there is no separate keyword
//                      fact table)
//   search term     -> search_term_metrics_daily
//   product_ad      -> NOT AVAILABLE. No ad-level daily fact table exists in
//                      this schema; the Ads sync doesn't request ad-level
//                      metrics. getEntityFacts returns null for it rather
//                      than substituting the parent campaign's numbers,
//                      which would silently attribute campaign-wide movement
//                      to one ad.

/** Entity levels the monitor can actually measure, given the synced tables. */
export const MEASURABLE_ENTITY_TYPES = ['campaign', 'keyword', 'product_target', 'search_term'] as const;
export type MeasurableEntityType = (typeof MEASURABLE_ENTITY_TYPES)[number];

export function isMeasurableEntityType(t: string): t is MeasurableEntityType {
  return (MEASURABLE_ENTITY_TYPES as readonly string[]).includes(t);
}

@Injectable()
export class MonitorFactsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Latest date present in campaign_metrics_daily — the data frontier. */
  async getLatestFactDate(): Promise<string | null> {
    const [row] = await this.drizzle.db
      .select({ date: campaignMetricsDaily.date })
      .from(campaignMetricsDaily)
      .orderBy(desc(campaignMetricsDaily.date))
      .limit(1);
    return row?.date ?? null;
  }

  /**
   * Daily facts for one campaign (by Amazon campaign id) in [start, end].
   * Scoped to the client's own accounts — an Amazon campaign id is only
   * unique within an account, and the monitor must never read another
   * client's row.
   */
  async getCampaignFacts(clientId: string, campaignId: string, start: string, end: string): Promise<DailyFactRow[]> {
    const rows = await this.drizzle.db
      .select({
        date: campaignMetricsDaily.date,
        spend: campaignMetricsDaily.spend,
        sales: campaignMetricsDaily.sales,
        clicks: campaignMetricsDaily.clicks,
        impressions: campaignMetricsDaily.impressions,
        orders: campaignMetricsDaily.orders,
      })
      .from(campaignMetricsDaily)
      .innerJoin(campaigns, eq(campaigns.id, campaignMetricsDaily.campaignId))
      .innerJoin(amazonAdsAccounts, eq(amazonAdsAccounts.id, campaigns.amazonAdsAccountId))
      .where(
        and(
          eq(amazonAdsAccounts.clientId, clientId),
          eq(campaigns.campaignId, campaignId),
          gte(campaignMetricsDaily.date, start),
          lte(campaignMetricsDaily.date, end),
        ),
      );
    return rows.map(toFactRow);
  }

  /**
   * Account-wide daily facts for one client — the control series the
   * difference-in-differences normalization measures against. Summed across
   * every campaign in every account the client owns, one row per date.
   */
  async getAccountFacts(clientId: string, start: string, end: string): Promise<DailyFactRow[]> {
    const rows = await this.drizzle.db
      .select({
        date: campaignMetricsDaily.date,
        spend: sql<string>`sum(${campaignMetricsDaily.spend})`,
        sales: sql<string>`sum(${campaignMetricsDaily.sales})`,
        clicks: sql<string>`sum(${campaignMetricsDaily.clicks})`,
        impressions: sql<string>`sum(${campaignMetricsDaily.impressions})`,
        orders: sql<string>`sum(${campaignMetricsDaily.orders})`,
      })
      .from(campaignMetricsDaily)
      .innerJoin(campaigns, eq(campaigns.id, campaignMetricsDaily.campaignId))
      .innerJoin(amazonAdsAccounts, eq(amazonAdsAccounts.id, campaigns.amazonAdsAccountId))
      .where(
        and(
          eq(amazonAdsAccounts.clientId, clientId),
          gte(campaignMetricsDaily.date, start),
          lte(campaignMetricsDaily.date, end),
        ),
      )
      .groupBy(campaignMetricsDaily.date);
    return rows.map(toFactRow);
  }

  /**
   * Daily facts for the specific entity a task changed. Returns null (not an
   * empty array) when this entity type has no fact table at all, so callers
   * can distinguish "measured, found nothing" from "cannot be measured".
   */
  async getEntityFacts(
    clientId: string,
    entityType: string,
    entityId: string,
    campaignId: string,
    start: string,
    end: string,
  ): Promise<DailyFactRow[] | null> {
    if (entityType === 'campaign') {
      return this.getCampaignFacts(clientId, campaignId, start, end);
    }

    const accountIds = await this.getClientAccountIds(clientId);
    if (accountIds.length === 0) return [];

    if (entityType === 'keyword' || entityType === 'product_target') {
      const rows = await this.drizzle.db
        .select({
          date: targetMetricsDaily.date,
          spend: targetMetricsDaily.cost,
          sales: targetMetricsDaily.sales7d,
          clicks: targetMetricsDaily.clicks,
          impressions: targetMetricsDaily.impressions,
          orders: targetMetricsDaily.orders7d,
        })
        .from(targetMetricsDaily)
        .where(
          and(
            inArray(targetMetricsDaily.amazonAdsAccountId, accountIds),
            eq(targetMetricsDaily.targetId, entityId),
            gte(targetMetricsDaily.date, start),
            lte(targetMetricsDaily.date, end),
          ),
        );
      return rows.map(toFactRow);
    }

    if (entityType === 'search_term') {
      // W1 (the only producer of search_term entities) keys them on the
      // composite "<campaignId>::<verbatim term>" so the same term stays
      // distinct per campaign — see term-normalization.ts's
      // searchTermEntityId. Fall back to treating the whole id as the term
      // for any entity written before that convention existed.
      const parsed = parseSearchTermEntityId(entityId);
      const term = parsed?.term ?? entityId;
      const scopedCampaignId = parsed?.campaignId ?? campaignId;

      const rows = await this.drizzle.db
        .select({
          date: searchTermMetricsDaily.date,
          spend: searchTermMetricsDaily.cost,
          sales: searchTermMetricsDaily.sales7d,
          clicks: searchTermMetricsDaily.clicks,
          impressions: searchTermMetricsDaily.impressions,
          orders: searchTermMetricsDaily.orders7d,
        })
        .from(searchTermMetricsDaily)
        .where(
          and(
            inArray(searchTermMetricsDaily.amazonAdsAccountId, accountIds),
            eq(searchTermMetricsDaily.searchTerm, term),
            eq(searchTermMetricsDaily.campaignId, scopedCampaignId),
            gte(searchTermMetricsDaily.date, start),
            lte(searchTermMetricsDaily.date, end),
          ),
        );
      return rows.map(toFactRow);
    }

    return null; // product_ad, negative, ad_group, portfolio — no fact table
  }

  private async getClientAccountIds(clientId: string): Promise<string[]> {
    const rows = await this.drizzle.db
      .select({ id: amazonAdsAccounts.id })
      .from(amazonAdsAccounts)
      .where(eq(amazonAdsAccounts.clientId, clientId));
    return rows.map((r) => r.id);
  }
}

function toFactRow(r: {
  date: string;
  spend: string | number | null;
  sales: string | number | null;
  clicks: string | number | null;
  impressions: string | number | null;
  orders: string | number | null;
}): DailyFactRow {
  return {
    date: r.date,
    spend: Number(r.spend ?? 0),
    sales: Number(r.sales ?? 0),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    orders: Number(r.orders ?? 0),
  };
}
