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

// Different hosts from the Advertising API's regional endpoints — do not conflate.
const SP_API_REGION_BASE_URLS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};

interface OAuthState {
  clientId: string;
  region: string;
}

interface LwaTokenResponse {
  refresh_token: string;
  access_token: string;
}

// VERIFY against a real response during testing — documented shape, not yet
// confirmed against a live call.
interface MarketplaceParticipationsResponse {
  payload: {
    marketplace: { id: string };
    participation: { isParticipating: boolean };
  }[];
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
   * access. Region is resolved from the client's existing Ads account(s) —
   * Olifant already knows this for every real client. One authorization
   * covers every marketplace the seller operates in within that region (see
   * handleCallback) — the seller never needs to repeat this per marketplace.
   */
  async buildAuthorizationUrl(
    clientId: string,
    regionOverride?: string,
  ): Promise<{ authorizationUrl: string; region: string }> {
    const client = await this.drizzle.db.query.clients.findFirst({
      where: eq(clients.id, clientId),
    });
    if (!client) throw new NotFoundException('Client not found');

    const region = await this.resolveRegion(clientId, regionOverride);

    const applicationId = process.env.SP_API_APPLICATION_ID;
    if (!applicationId) throw new Error('SP_API_APPLICATION_ID is not set');

    const state = randomUUID();
    const payload: OAuthState = { clientId, region };
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
    return { authorizationUrl: url.toString(), region };
  }

  private async resolveRegion(
    clientId: string,
    regionOverride?: string,
  ): Promise<string> {
    if (regionOverride) return regionOverride;

    const adsAccounts = await this.drizzle.db.query.amazonAdsAccounts.findMany({
      where: eq(amazonAdsAccounts.clientId, clientId),
    });
    const distinct = new Set(
      adsAccounts.filter((a) => a.region).map((a) => a.region as string),
    );

    if (distinct.size === 1) return [...distinct][0];
    throw new BadRequestException(
      distinct.size === 0
        ? 'Client has no existing Ads account to infer a region from — pass ?region= explicitly.'
        : 'Client operates in multiple regions — pass ?region= explicitly to disambiguate.',
    );
  }

  /**
   * Handles Amazon's OAuth redirect: validates the CSRF state, exchanges the
   * authorization code for tokens, discovers every marketplace this
   * authorization actually covers, and upserts one account row per
   * marketplace — a single seller consent should never need repeating per
   * marketplace. Never throws for "expected" failures the user caused (e.g.
   * a stale state); those are reported back via the redirect instead.
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

    const { clientId, region } = JSON.parse(stored) as OAuthState;

    const { refreshToken, accessToken } =
      await this.exchangeCodeForTokens(code);
    const encryptedToken = encrypt(refreshToken);

    const marketplaceIds = await this.fetchMarketplaceParticipations(
      accessToken,
      region,
    );
    if (marketplaceIds.length === 0) {
      this.logger.error(
        `client=${clientId} sellingPartnerId=${sellingPartnerId}: no participating marketplaces returned`,
      );
      throw new BadRequestException(
        'No active marketplaces found for this seller account',
      );
    }

    for (const marketplace of marketplaceIds) {
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
          target: [
            amazonSpAccounts.sellingPartnerId,
            amazonSpAccounts.marketplace,
          ],
          set: {
            clientId,
            region,
            refreshToken: encryptedToken,
            isActive: true,
            updatedAt: new Date(),
          },
        });
    }

    return clientId;
  }

  private async exchangeCodeForTokens(
    code: string,
  ): Promise<{ refreshToken: string; accessToken: string }> {
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
    return { refreshToken: body.refresh_token, accessToken: body.access_token };
  }

  /**
   * One authorization covers every marketplace the seller operates in within
   * a region — this discovers exactly which ones, rather than assuming the
   * single marketplace passed in at /connect time.
   */
  private async fetchMarketplaceParticipations(
    accessToken: string,
    region: string,
  ): Promise<string[]> {
    const baseUrl = SP_API_REGION_BASE_URLS[region];
    if (!baseUrl) throw new Error(`Unknown SP-API region: ${region}`);

    const res = await fetch(`${baseUrl}/sellers/v1/marketplaceParticipations`, {
      headers: { 'x-amz-access-token': accessToken },
    });

    if (!res.ok) {
      this.logger.error(
        `marketplaceParticipations failed with status ${res.status}`,
      );
      throw new BadRequestException('Failed to look up seller marketplaces');
    }

    const body = (await res.json()) as MarketplaceParticipationsResponse;
    return body.payload
      .filter((p) => p.participation.isParticipating)
      .map((p) => p.marketplace.id);
  }
}
