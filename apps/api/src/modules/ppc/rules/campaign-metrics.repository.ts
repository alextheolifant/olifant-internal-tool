import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import {
  amazonAdsAccounts,
  campaignMetricsDaily,
  campaigns,
} from '../../../db/schema';
import type { CampaignWithDailyMetrics } from './campaign-window';

@Injectable()
export class CampaignMetricsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // Every ENABLED campaign belonging to the client's ads accounts, each with
  // its daily metrics rows in [windowStart, windowEnd] (inclusive). Callers
  // are responsible for making windowEnd settled-data-safe (T-2) — this
  // repository just fetches the range it's asked for. A campaign with zero
  // metrics rows in range still appears, with an empty dailyMetrics array.
  async getEnabledCampaignsWithDailyMetrics(
    clientId: string,
    windowStart: string,
    windowEnd: string,
  ): Promise<CampaignWithDailyMetrics[]> {
    const rows = await this.drizzle.db
      .select({
        campaignId: campaigns.campaignId,
        campaignName: campaigns.name,
        budget: campaigns.budget,
        date: campaignMetricsDaily.date,
        spend: campaignMetricsDaily.spend,
        sales: campaignMetricsDaily.sales,
        clicks: campaignMetricsDaily.clicks,
        impressions: campaignMetricsDaily.impressions,
      })
      .from(campaigns)
      .innerJoin(
        amazonAdsAccounts,
        eq(amazonAdsAccounts.id, campaigns.amazonAdsAccountId),
      )
      .leftJoin(
        campaignMetricsDaily,
        and(
          eq(campaignMetricsDaily.campaignId, campaigns.id),
          gte(campaignMetricsDaily.date, windowStart),
          lte(campaignMetricsDaily.date, windowEnd),
        ),
      )
      .where(
        and(
          eq(amazonAdsAccounts.clientId, clientId),
          eq(campaigns.state, 'ENABLED'),
        ),
      );

    const byCampaign = new Map<string, CampaignWithDailyMetrics>();
    for (const r of rows) {
      let c = byCampaign.get(r.campaignId);
      if (!c) {
        c = {
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          budget:
            r.budget !== null && r.budget !== undefined
              ? Number(r.budget)
              : null,
          dailyMetrics: [],
        };
        byCampaign.set(r.campaignId, c);
      }
      if (r.date) {
        c.dailyMetrics.push({
          date: r.date,
          spend: Number(r.spend ?? 0),
          sales: Number(r.sales ?? 0),
          clicks: Number(r.clicks ?? 0),
          impressions: Number(r.impressions ?? 0),
        });
      }
    }
    return [...byCampaign.values()];
  }
}
