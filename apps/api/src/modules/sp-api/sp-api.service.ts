import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';
import { clients, amazonAdsAccounts, amazonSpAccounts } from '../../db/schema';
import { encrypt } from '../../common/crypto.util';

// Long enough to cover a user clicking through Amazon's consent screen; short
// enough that a stale/abandoned state can't be replayed hours later.
const STATE_TTL_SECONDS = 600;
const STATE_KEY_PREFIX = 'sp-api:oauth-state:';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

interface OAuthState {
  clientId: string;
  marketplace: string;
  region: string;
}

interface LwaTokenResponse {
  refresh_token: string;
}

@Injectable()
export class SpApiService {
  private readonly logger = new Logger(SpApiService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Builds the Seller Central consent URL for a client to authorize SP-API
   * access. Marketplace/region are resolved from the client's existing Ads
   * account(s) — Olifant already knows these for every real client — rather
   * than requiring a second, SigV4-signed Amazon lookup mid-flow.
   */
  async buildAuthorizationUrl(
    clientId: string,
    marketplaceOverride?: string,
    regionOverride?: string,
  ): Promise<string> {
    const client = await this.drizzle.db.query.clients.findFirst({
      where: eq(clients.id, clientId),
    });
    if (!client) throw new NotFoundException('Client not found');

    const { marketplace, region } = await this.resolveMarketplaceRegion(
      clientId,
      marketplaceOverride,
      regionOverride,
    );

    const applicationId = process.env.SP_API_APPLICATION_ID;
    if (!applicationId) throw new Error('SP_API_APPLICATION_ID is not set');

    const state = randomUUID();
    const payload: OAuthState = { clientId, marketplace, region };
    await this.redis.setex(
      `${STATE_KEY_PREFIX}${state}`,
      STATE_TTL_SECONDS,
      JSON.stringify(payload),
    );

    const url = new URL(
      'https://sellercentral.amazon.com/apps/authorize/consent',
    );
    url.searchParams.set('application_id', applicationId);
    url.searchParams.set('state', state);
    url.searchParams.set('version', 'beta');
    return url.toString();
  }

  private async resolveMarketplaceRegion(
    clientId: string,
    marketplaceOverride?: string,
    regionOverride?: string,
  ): Promise<{ marketplace: string; region: string }> {
    if (marketplaceOverride && regionOverride) {
      return { marketplace: marketplaceOverride, region: regionOverride };
    }

    const adsAccounts = await this.drizzle.db.query.amazonAdsAccounts.findMany({
      where: eq(amazonAdsAccounts.clientId, clientId),
    });
    const distinct = new Set(
      adsAccounts
        .filter((a) => a.marketplace && a.region)
        .map((a) => `${a.marketplace}:${a.region}`),
    );

    if (distinct.size === 1) {
      const [marketplace, region] = [...distinct][0].split(':');
      return { marketplace, region };
    }
    throw new BadRequestException(
      distinct.size === 0
        ? 'Client has no existing Ads account to infer a marketplace/region from — pass ?marketplace=&region= explicitly.'
        : 'Client operates in multiple marketplaces — pass ?marketplace=&region= explicitly to disambiguate.',
    );
  }

  /**
   * Handles Amazon's OAuth redirect: validates the CSRF state, exchanges the
   * authorization code for a refresh token, encrypts it, and upserts the
   * account. Returns the clientId so the controller can build the dashboard
   * redirect — never throws for "expected" failures the user caused (e.g. a
   * stale state), those are reported back via the redirect instead.
   */
  async handleCallback(
    code: string,
    sellingPartnerId: string,
    state: string,
  ): Promise<string> {
    const stateKey = `${STATE_KEY_PREFIX}${state}`;
    const stored = await this.redis.get(stateKey);
    if (!stored)
      throw new BadRequestException('Invalid or expired OAuth state');
    await this.redis.client.del(stateKey); // single-use — no replay

    const { clientId, marketplace, region } = JSON.parse(stored) as OAuthState;

    const refreshToken = await this.exchangeCodeForRefreshToken(code);
    const encryptedToken = encrypt(refreshToken);

    await this.drizzle.db
      .insert(amazonSpAccounts)
      .values({
        clientId,
        sellingPartnerId,
        marketplace,
        region,
        refreshToken: encryptedToken,
      })
      .onConflictDoUpdate({
        target: amazonSpAccounts.sellingPartnerId,
        set: {
          clientId,
          marketplace,
          region,
          refreshToken: encryptedToken,
          isActive: true,
          updatedAt: new Date(),
        },
      });

    return clientId;
  }

  private async exchangeCodeForRefreshToken(code: string): Promise<string> {
    const clientId = process.env.SP_API_CLIENT_ID;
    const clientSecret = process.env.SP_API_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('SP_API_CLIENT_ID/SP_API_CLIENT_SECRET are not set');
    }

    const res = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) {
      this.logger.error(`LWA token exchange failed with status ${res.status}`);
      throw new BadRequestException('Failed to exchange authorization code');
    }

    const body = (await res.json()) as LwaTokenResponse;
    return body.refresh_token;
  }
}
