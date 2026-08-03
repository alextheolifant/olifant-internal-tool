import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';
import { clients, ppcClientConfigs, productEconomics } from '../../db/schema';
import { invalidatePpcClientsCache } from './ppc-cache';
import type { ProductEconomicsResponse } from './ppc-config.service';
import { resolveTarget } from './ppc-resolved-target';
import { CreateProductEconomicsDto, UpdateProductEconomicsDto } from './dto/product-economics.dto';

function num(v: string | null): number | null {
  return v === null ? null : parseFloat(v);
}

function mapRow(row: typeof productEconomics.$inferSelect, targetAcosDefault: number | null): ProductEconomicsResponse {
  const targetAcos = num(row.targetAcos);
  const targetTacos = num(row.targetTacos);
  return {
    id: row.id,
    asin: row.asin,
    productName: row.productName,
    margin: num(row.margin),
    strategy: row.strategy,
    targetAcos,
    targetTacos,
    launchUntil: row.launchUntil,
    resolvedTargetAcos: resolveTarget(targetAcos, targetAcosDefault),
    // No account-level TACOS default exists in this schema — see
    // ppc-config.service.ts's identical comment.
    resolvedTargetTacos: resolveTarget(targetTacos, null),
  };
}

@Injectable()
export class ProductEconomicsService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly redis: RedisService,
  ) {}

  private async getTargetAcosDefault(clientId: string): Promise<number | null> {
    const config = await this.drizzle.db.query.ppcClientConfigs.findFirst({
      where: eq(ppcClientConfigs.clientId, clientId),
    });
    return config ? num(config.targetAcosDefault) : null;
  }

  async create(clientId: string, dto: CreateProductEconomicsDto): Promise<ProductEconomicsResponse> {
    const client = await this.drizzle.db.query.clients.findFirst({
      where: eq(clients.id, clientId),
    });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    const existing = await this.drizzle.db.query.productEconomics.findFirst({
      where: and(eq(productEconomics.clientId, clientId), eq(productEconomics.asin, dto.asin)),
    });
    if (existing) {
      throw new ConflictException(`ASIN ${dto.asin} already has a product economics row for this client`);
    }

    const [row] = await this.drizzle.db
      .insert(productEconomics)
      .values({
        clientId,
        asin: dto.asin,
        margin: dto.margin != null ? String(dto.margin) : null,
        strategy: dto.strategy ?? null,
        targetAcos: dto.targetAcos != null ? String(dto.targetAcos) : null,
        targetTacos: dto.targetTacos != null ? String(dto.targetTacos) : null,
        launchUntil: dto.launchUntil ?? null,
      })
      .returning();

    await invalidatePpcClientsCache(this.redis);
    return mapRow(row, await this.getTargetAcosDefault(clientId));
  }

  async update(id: string, dto: UpdateProductEconomicsDto): Promise<ProductEconomicsResponse> {
    const patch: Partial<typeof productEconomics.$inferInsert> = { updatedAt: new Date() };
    if (dto.margin !== undefined) patch.margin = dto.margin != null ? String(dto.margin) : null;
    if (dto.strategy !== undefined) patch.strategy = dto.strategy;
    if (dto.targetAcos !== undefined)
      patch.targetAcos = dto.targetAcos != null ? String(dto.targetAcos) : null;
    if (dto.targetTacos !== undefined)
      patch.targetTacos = dto.targetTacos != null ? String(dto.targetTacos) : null;
    if (dto.launchUntil !== undefined) patch.launchUntil = dto.launchUntil;

    const [row] = await this.drizzle.db
      .update(productEconomics)
      .set(patch)
      .where(eq(productEconomics.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Product economics row ${id} not found`);

    await invalidatePpcClientsCache(this.redis);
    return mapRow(row, await this.getTargetAcosDefault(row.clientId));
  }

  async remove(id: string): Promise<void> {
    const result = await this.drizzle.db
      .delete(productEconomics)
      .where(eq(productEconomics.id, id))
      .returning({ id: productEconomics.id });
    if (result.length === 0) throw new NotFoundException(`Product economics row ${id} not found`);

    await invalidatePpcClientsCache(this.redis);
  }
}
