import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, gte, sql } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { clients, amazonAdsAccounts, campaigns, campaignMetricsDaily } from '../../db/schema';
import { CreateClientDto } from './dto/create-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly drizzle: DrizzleService) {}

  findAll() {
    return this.drizzle.db.query.clients.findMany({
      with: { amazonAdsAccounts: true },
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });
  }

  async create(dto: CreateClientDto) {
    const [client] = await this.drizzle.db
      .insert(clients)
      .values({ name: dto.name, tier: dto.tier })
      .returning();
    return client;
  }

  async findOne(id: string) {
    const client = await this.drizzle.db.query.clients.findFirst({
      where: eq(clients.id, id),
      with: { amazonAdsAccounts: true },
    });

    if (!client) throw new NotFoundException(`Client ${id} not found`);

    const [metrics] = await this.drizzle.db
      .select({
        totalSpend: sql<string>`coalesce(sum(${campaignMetricsDaily.spend}), 0)`,
        totalSales: sql<string>`coalesce(sum(${campaignMetricsDaily.sales}), 0)`,
        totalOrders: sql<string>`coalesce(sum(${campaignMetricsDaily.orders}), 0)`,
        totalClicks: sql<string>`coalesce(sum(${campaignMetricsDaily.clicks}), 0)`,
        totalImpressions: sql<string>`coalesce(sum(${campaignMetricsDaily.impressions}), 0)`,
      })
      .from(campaignMetricsDaily)
      .innerJoin(campaigns, eq(campaigns.id, campaignMetricsDaily.campaignId))
      .innerJoin(amazonAdsAccounts, eq(amazonAdsAccounts.id, campaigns.amazonAdsAccountId))
      .where(
        and(
          eq(amazonAdsAccounts.clientId, id),
          gte(campaignMetricsDaily.date, sql`(CURRENT_DATE - INTERVAL '30 days')::date`),
        ),
      );

    const spend = parseFloat(metrics.totalSpend);
    const sales = parseFloat(metrics.totalSales);

    return {
      ...client,
      metrics30d: {
        spend,
        sales,
        orders: parseInt(metrics.totalOrders, 10),
        clicks: parseInt(metrics.totalClicks, 10),
        impressions: parseInt(metrics.totalImpressions, 10),
        acos: sales > 0 ? parseFloat(((spend / sales) * 100).toFixed(2)) : null,
        roas: spend > 0 ? parseFloat((sales / spend).toFixed(2)) : null,
      },
    };
  }
}
