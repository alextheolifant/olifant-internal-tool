import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';
import { clients, ppcClientConfigs, productEconomics } from '../../db/schema';
import { computePpcConfigCompleteness } from './ppc-completeness';
import { invalidatePpcClientsCache } from './ppc-cache';
import { resolveTarget, type ResolvedTarget } from './ppc-resolved-target';
import { UpdatePpcConfigDto } from './dto/update-ppc-config.dto';

// ── Response shapes ──────────────────────────────────────────────────────────

export interface PpcConfigResponse {
  clientId: string;
  // PPC-ops status — deliberately separate from the client's CRM status
  // (Active/Onboarding/Paused/Churned, edited elsewhere). frozen = exceptions
  // only, no optimization tasks generated for this account.
  opsStatus: 'active' | 'frozen';
  adsAccounts: { profileId: string; accountName: string | null; marketplace: string | null }[];
  monthlyAdBudget: number | null;
  // Fallback bid-math defaults used when a product has no economics row of
  // its own. marginDefault doubles as the account's default break-even ACOS
  // ("BE" in the UI) — same number, not stored twice.
  marginDefault: number | null;
  targetAcosDefault: number | null;
  // Account-level rollup/reporting target — independent of the bid-math
  // fallback above; bid math (later phase) always reads the per-product
  // targets, never this.
  accountTargetMetric: 'acos' | 'tacos';
  accountTargetMetricValue: number | null;
  brandTerms: string[];
  ownAsins: string[];
  sbObjectives: { campaignName: string; objective: 'performance' | 'defense' | 'ntb' }[];
  harvestDestinationCampaigns: { asin: string; campaignName: string; maxTargets: number | null }[];
  thresholdOverrides: Record<string, number>;
  standingDirectives: string | null;
  conservativeMode: boolean;
  products: ProductEconomicsResponse[];
  completeness: { percent: number; checklist: { key: string; label: string; met: boolean }[] };
}

export interface ProductEconomicsResponse {
  id: string;
  asin: string;
  productName: string | null;
  margin: number | null;
  strategy: string | null;
  targetAcos: number | null;
  targetTacos: number | null;
  launchUntil: string | null;
  // Effective value bid math would use, plus whether it came from the
  // account default — see ppc-resolved-target.ts. No account-level TACOS
  // default exists in this schema, so resolvedTargetTacos.isFallback is
  // always false (it's just the product's own value, or null).
  resolvedTargetAcos: ResolvedTarget;
  resolvedTargetTacos: ResolvedTarget;
}

function num(v: string | null): number | null {
  return v === null ? null : parseFloat(v);
}

type RawProduct = Omit<ProductEconomicsResponse, 'resolvedTargetAcos' | 'resolvedTargetTacos'>;

function mapProduct(row: typeof productEconomics.$inferSelect): RawProduct {
  return {
    id: row.id,
    asin: row.asin,
    productName: row.productName,
    margin: num(row.margin),
    strategy: row.strategy,
    targetAcos: num(row.targetAcos),
    targetTacos: num(row.targetTacos),
    launchUntil: row.launchUntil,
  };
}

@Injectable()
export class PpcConfigService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly redis: RedisService,
  ) {}

  async getConfig(clientId: string): Promise<PpcConfigResponse> {
    const client = await this.drizzle.db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      with: { amazonAdsAccounts: true },
    });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    const config = await this.drizzle.db.query.ppcClientConfigs.findFirst({
      where: eq(ppcClientConfigs.clientId, clientId),
    });

    const products = await this.drizzle.db.query.productEconomics.findMany({
      where: eq(productEconomics.clientId, clientId),
      orderBy: (p, { asc }) => [asc(p.asin)],
    });

    return this.buildResponse(clientId, client, config, products);
  }

  async updateConfig(clientId: string, dto: UpdatePpcConfigDto): Promise<PpcConfigResponse> {
    const client = await this.drizzle.db.query.clients.findFirst({
      where: eq(clients.id, clientId),
    });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    const existing = await this.drizzle.db.query.ppcClientConfigs.findFirst({
      where: eq(ppcClientConfigs.clientId, clientId),
    });

    const patch: Partial<typeof ppcClientConfigs.$inferInsert> = { updatedAt: new Date() };
    if (dto.opsStatus !== undefined) patch.opsStatus = dto.opsStatus;
    if (dto.monthlyAdBudget !== undefined)
      patch.monthlyAdBudget = dto.monthlyAdBudget != null ? String(dto.monthlyAdBudget) : null;
    if (dto.marginDefault !== undefined)
      patch.marginDefault = dto.marginDefault != null ? String(dto.marginDefault) : null;
    if (dto.targetAcosDefault !== undefined)
      patch.targetAcosDefault = dto.targetAcosDefault != null ? String(dto.targetAcosDefault) : null;
    if (dto.accountTargetMetric !== undefined) patch.accountTargetMetric = dto.accountTargetMetric;
    if (dto.accountTargetMetricValue !== undefined)
      patch.accountTargetMetricValue =
        dto.accountTargetMetricValue != null ? String(dto.accountTargetMetricValue) : null;
    if (dto.brandTerms !== undefined) patch.brandTerms = dto.brandTerms;
    if (dto.ownAsins !== undefined) patch.ownAsins = dto.ownAsins;
    if (dto.sbObjectives !== undefined) patch.sbObjectives = dto.sbObjectives;
    if (dto.harvestDestinationCampaigns !== undefined)
      patch.harvestDestinationCampaigns = dto.harvestDestinationCampaigns;
    if (dto.thresholdOverrides !== undefined) patch.thresholdOverrides = dto.thresholdOverrides;
    if (dto.standingDirectives !== undefined) patch.standingDirectives = dto.standingDirectives;
    if (dto.conservativeMode !== undefined) patch.conservativeMode = dto.conservativeMode;

    if (existing) {
      await this.drizzle.db
        .update(ppcClientConfigs)
        .set(patch)
        .where(eq(ppcClientConfigs.clientId, clientId));
    } else {
      await this.drizzle.db.insert(ppcClientConfigs).values({ clientId, ...patch });
    }

    await invalidatePpcClientsCache(this.redis);

    return this.getConfig(clientId);
  }

  private buildResponse(
    clientId: string,
    client: {
      amazonAdsAccounts: { profileId: string; accountName: string | null; marketplace: string | null }[];
    },
    config: typeof ppcClientConfigs.$inferSelect | undefined,
    products: (typeof productEconomics.$inferSelect)[],
  ): PpcConfigResponse {
    const mappedProducts = products.map(mapProduct);
    const targetAcosDefault = config ? num(config.targetAcosDefault) : null;
    const accountTargetMetricValue = config ? num(config.accountTargetMetricValue) : null;

    // Completeness reads each product's OWN target, never the resolved
    // (fallback-inflated) value — a row leaning entirely on the account
    // default is still a row the team hasn't actually configured.
    const completeness = computePpcConfigCompleteness({
      monthlyAdBudget: config ? num(config.monthlyAdBudget) : null,
      targetAcosDefault,
      accountTargetMetricValue,
      products: mappedProducts.map((p) => ({
        strategy: p.strategy,
        targetAcos: p.targetAcos,
        targetTacos: p.targetTacos,
        launchUntil: p.launchUntil,
      })),
    });

    const resolvedProducts: ProductEconomicsResponse[] = mappedProducts.map((p) => ({
      ...p,
      resolvedTargetAcos: resolveTarget(p.targetAcos, targetAcosDefault),
      // No account-level TACOS default exists in this schema (see
      // ppc_client_configs comment in schema.ts) — passing null means this
      // always resolves to the product's own value, isFallback: false.
      resolvedTargetTacos: resolveTarget(p.targetTacos, null),
    }));

    return {
      clientId,
      opsStatus: config?.opsStatus ?? 'active',
      adsAccounts: client.amazonAdsAccounts.map((a) => ({
        profileId: a.profileId,
        accountName: a.accountName,
        marketplace: a.marketplace,
      })),
      monthlyAdBudget: config ? num(config.monthlyAdBudget) : null,
      marginDefault: config ? num(config.marginDefault) : null,
      targetAcosDefault,
      accountTargetMetric: config?.accountTargetMetric ?? 'tacos',
      accountTargetMetricValue,
      brandTerms: (config?.brandTerms as string[] | undefined) ?? [],
      ownAsins: (config?.ownAsins as string[] | undefined) ?? [],
      sbObjectives:
        (config?.sbObjectives as PpcConfigResponse['sbObjectives'] | undefined) ?? [],
      harvestDestinationCampaigns:
        (config?.harvestDestinationCampaigns as
          | PpcConfigResponse['harvestDestinationCampaigns']
          | undefined) ?? [],
      thresholdOverrides: (config?.thresholdOverrides as Record<string, number> | undefined) ?? {},
      standingDirectives: config?.standingDirectives ?? null,
      conservativeMode: config?.conservativeMode ?? false,
      products: resolvedProducts,
      completeness,
    };
  }
}
