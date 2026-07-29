import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';
import { clients } from '../../db/schema';
import { UpdateClientDto } from './dto/update-client.dto';

// ── Tier / status mappers ────────────────────────────────────────────────────

const TIER_MAP: Record<string, number> = { t1: 1, t2: 2, t3: 3 };

function mapTier(t: string | null): number {
  return t ? (TIER_MAP[t] ?? 3) : 3;
}

function mapStatus(s: string): string {
  const MAP: Record<string, string> = {
    active: 'Active',
    onboarding: 'Onboarding',
    paused: 'Paused',
    churned: 'Churned',
  };
  return MAP[s] ?? s;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface ClientListResponse {
  clients: ClientRow[];
  clientCount: number;
  activeCount: number;
}

export interface ClientRow {
  id: string;
  name: string;
  tier: number;
  status: string;
  goalTacos: number | null;
  goalRevenue: number | null;
  marketplaceCount: number;
  accounts: AccountRow[];
}

export interface AccountRow {
  profileId: string;
  accountName: string | null;
  marketplace: string | null;
  countryCode: string | null;
  currencyCode: string | null;
}

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly redis: RedisService,
  ) {}

  // ── GET /clients ─────────────────────────────────────────────────────────

  async findAll(marketplace?: string): Promise<ClientListResponse> {
    const rows = await this.drizzle.db.query.clients.findMany({
      with: { amazonAdsAccounts: true },
      orderBy: (c, { asc }) => [asc(c.name)],
    });

    let mapped: ClientRow[] = rows.map((c) => ({
      id: c.id,
      name: c.name,
      tier: mapTier(c.tier),
      status: mapStatus(c.status),
      goalTacos: c.targetTacos ? parseFloat(c.targetTacos) : null,
      goalRevenue: c.goalRevenue ? parseFloat(c.goalRevenue) : null,
      marketplaceCount: c.amazonAdsAccounts.length,
      accounts: c.amazonAdsAccounts.map((a) => ({
        profileId: a.profileId,
        accountName: a.accountName,
        marketplace: a.marketplace,
        countryCode: a.countryCode,
        currencyCode: a.currencyCode,
      })),
    }));

    if (marketplace && marketplace !== 'ALL') {
      mapped = mapped.filter((c) =>
        c.accounts.some(
          (a) => a.marketplace?.toUpperCase() === marketplace.toUpperCase(),
        ),
      );
    }

    const activeCount = mapped.filter((c) => c.status === 'Active').length;
    return { clients: mapped, clientCount: mapped.length, activeCount };
  }

  // ── PATCH /clients/:id ───────────────────────────────────────────────────

  async update(id: string, dto: UpdateClientDto): Promise<ClientRow> {
    const existing = await this.drizzle.db.query.clients.findFirst({
      where: eq(clients.id, id),
      with: { amazonAdsAccounts: true },
    });
    if (!existing) throw new NotFoundException(`Client ${id} not found`);

    const patch: Partial<typeof clients.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.tier !== undefined) patch.tier = dto.tier ?? null;
    if (dto.targetTacos !== undefined)
      patch.targetTacos =
        dto.targetTacos != null ? String(dto.targetTacos) : null;
    if (dto.goalRevenue !== undefined)
      patch.goalRevenue =
        dto.goalRevenue != null ? String(dto.goalRevenue) : null;
    patch.updatedAt = new Date();

    const [row] = await this.drizzle.db
      .update(clients)
      .set(patch)
      .where(eq(clients.id, id))
      .returning();

    // /metrics/clients caches the full client list (name, tier, status,
    // goals — everything read here) for 5 minutes. Without this, an edit
    // here silently doesn't show up on the dashboard until the cache
    // naturally expires.
    await this.invalidateClientMetricsCache();

    return {
      id: row.id,
      name: row.name,
      tier: mapTier(row.tier),
      status: mapStatus(row.status),
      goalTacos: row.targetTacos ? parseFloat(row.targetTacos) : null,
      goalRevenue: row.goalRevenue ? parseFloat(row.goalRevenue) : null,
      marketplaceCount: existing.amazonAdsAccounts.length,
      accounts: existing.amazonAdsAccounts.map((a) => ({
        profileId: a.profileId,
        accountName: a.accountName,
        marketplace: a.marketplace,
        countryCode: a.countryCode,
        currencyCode: a.currencyCode,
      })),
    };
  }

  // Cache keys are per date-range/marketplace (metrics:clients:v1:{from}:{to}:{mkt}),
  // so there's no single key to invalidate — clear every cached variant
  // rather than trying to enumerate which ranges a client edit could affect.
  // Non-fatal: a cache-clear failure must not fail the client update itself.
  private async invalidateClientMetricsCache(): Promise<void> {
    try {
      const keys = await this.redis.client.keys('metrics:clients:*');
      if (keys.length > 0) await this.redis.client.del(...keys);
    } catch (err) {
      this.logger.error(
        `Failed to invalidate metrics:clients cache: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
