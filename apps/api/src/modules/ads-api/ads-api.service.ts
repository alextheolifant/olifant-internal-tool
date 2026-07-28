import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';
import { adsManagerAccounts, users } from '../../db/schema';
import { encrypt } from '../../common/crypto.util';

// Long enough to cover a user clicking through Amazon's consent screen; short
// enough that a stale/abandoned state can't be replayed hours later. Same
// window as the SP-API connect flow.
const STATE_TTL_SECONDS = 600;
const STATE_KEY_PREFIX = 'ads-api:oauth-state:';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const LWA_AUTHORIZE_URL = 'https://www.amazon.com/ap/oa';

interface OAuthState {
  userId: string;
  organizationId: string;
}

interface LwaTokenResponse {
  refresh_token: string;
  access_token: string;
}

export interface ManagerAccountStatus {
  id: string;
  connectedAt: Date;
  connectedByEmail: string | null;
  isActive: boolean;
}

@Injectable()
export class AdsApiService {
  private readonly logger = new Logger(AdsApiService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Builds the Amazon consent URL for a dashboard user to connect an
   * additional Ads Manager Account on behalf of their organization. The
   * credential this produces belongs to the organization, not this user —
   * any other user in the same org can see and use it once connected.
   *
   * For now, capped at one active connection per user (not per org — the
   * org can still end up with several, one per team member). This is a
   * simple guardrail against the same person accidentally re-authorizing
   * the same underlying Manager Account twice, producing a duplicate row
   * (a known, intentionally-undetected edge case — see the TODO on
   * ads_manager_accounts in schema.ts). Revisit if this ever needs to be
   * relaxed to more than one per user.
   */
  async buildAuthorizationUrl(userId: string): Promise<{ authorizationUrl: string }> {
    const user = await this.drizzle.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.drizzle.db.query.adsManagerAccounts.findFirst({
      where: and(
        eq(adsManagerAccounts.connectedByUserId, userId),
        eq(adsManagerAccounts.isActive, true),
      ),
    });
    if (existing) {
      throw new BadRequestException(
        'You have already connected an Ads Manager Account. Each team member can connect one for now.',
      );
    }

    const clientId = process.env.ADS_CLIENT_ID;
    if (!clientId) throw new Error('ADS_CLIENT_ID is not set');
    const redirectUri = process.env.ADS_REDIRECT_URI;
    if (!redirectUri) throw new Error('ADS_REDIRECT_URI is not set');

    const state = randomUUID();
    const payload: OAuthState = { userId, organizationId: user.organizationId };
    await this.redis.setex(
      `${STATE_KEY_PREFIX}${state}`,
      STATE_TTL_SECONDS,
      JSON.stringify(payload),
    );

    const url = new URL(LWA_AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', 'advertising::campaign_management');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return { authorizationUrl: url.toString() };
  }

  /**
   * Handles Amazon's OAuth redirect: validates the CSRF state, exchanges the
   * code for a refresh token, and adds a new ads_manager_accounts row. This
   * is always an addition — an existing connection for this organization is
   * never touched, deactivated, or replaced.
   */
  async handleCallback(code: string, state: string): Promise<void> {
    const stateKey = `${STATE_KEY_PREFIX}${state}`;
    const stored = await this.redis.get(stateKey);
    if (!stored) throw new BadRequestException('Invalid or expired OAuth state');
    await this.redis.client.del(stateKey); // single-use — no replay

    const { userId, organizationId } = JSON.parse(stored) as OAuthState;

    const refreshToken = await this.exchangeCodeForRefreshToken(code);
    const encryptedToken = encrypt(refreshToken);

    await this.drizzle.db.insert(adsManagerAccounts).values({
      organizationId,
      connectedByUserId: userId,
      refreshToken: encryptedToken,
      isActive: true,
    });
  }

  /**
   * Lists every active manager account for the requesting user's
   * organization — visible to any user in that org, not just whoever
   * connected each one.
   */
  async listManagerAccounts(userId: string): Promise<ManagerAccountStatus[]> {
    const user = await this.drizzle.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException('User not found');

    const rows = await this.drizzle.db.query.adsManagerAccounts.findMany({
      where: eq(adsManagerAccounts.organizationId, user.organizationId),
      with: { connectedByUser: true },
    });

    return rows.map((row) => ({
      id: row.id,
      connectedAt: row.connectedAt,
      connectedByEmail: row.connectedByUser?.email ?? null,
      isActive: row.isActive,
    }));
  }

  private async exchangeCodeForRefreshToken(code: string): Promise<string> {
    const clientId = process.env.ADS_CLIENT_ID;
    const clientSecret = process.env.ADS_CLIENT_SECRET;
    const redirectUri = process.env.ADS_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('ADS_CLIENT_ID/ADS_CLIENT_SECRET/ADS_REDIRECT_URI are not set');
    }

    const res = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
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
