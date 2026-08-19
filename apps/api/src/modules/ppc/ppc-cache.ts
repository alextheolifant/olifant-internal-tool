import { Logger } from '@nestjs/common';
import { RedisService } from '../../db/redis.service';

const logger = new Logger('PpcCache');

// Cache keys are per date-range/marketplace (ppc:clients:v1:{from}:{to}:{mkt}),
// so there's no single key to invalidate — clear every cached variant rather
// than trying to enumerate which ranges a config/product change could affect.
// Non-fatal: a cache-clear failure must not fail the write it followed.
export async function invalidatePpcClientsCache(
  redis: RedisService,
): Promise<void> {
  try {
    const keys = await redis.client.keys('ppc:clients:*');
    if (keys.length > 0) await redis.client.del(...keys);
  } catch (err) {
    logger.error(
      `Failed to invalidate ppc:clients cache: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
