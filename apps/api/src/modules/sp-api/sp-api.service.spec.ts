import { randomBytes } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SpApiService } from './sp-api.service';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';
import { decrypt } from '../../common/crypto.util';

interface InsertedSpAccount {
  clientId: string;
  sellingPartnerId: string;
  marketplace: string;
  region: string;
  refreshToken: string;
}

function buildDrizzleMock() {
  const clientsFindFirst = jest.fn();
  const adsAccountsFindMany = jest.fn().mockResolvedValue([]);
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = jest.fn().mockReturnValue({ values });
  // handleCallback runs its inserts through db.transaction(tx => ...) — the
  // mock tx reuses the same `insert` mock so existing call-assertions still work.
  const transaction = jest.fn(
    async (callback: (tx: { insert: typeof insert }) => Promise<void>) =>
      callback({ insert }),
  );

  return {
    db: {
      query: {
        clients: { findFirst: clientsFindFirst },
        amazonAdsAccounts: { findMany: adsAccountsFindMany },
      },
      insert,
      transaction,
    },
    _mocks: {
      clientsFindFirst,
      adsAccountsFindMany,
      insert,
      values,
      onConflictDoUpdate,
      transaction,
    },
  };
}

function buildRedisMock() {
  const get = jest.fn();
  const setex = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn().mockResolvedValue(undefined);
  return { get, setex, client: { del } };
}

// Mocks fetch for both calls handleCallback makes, branching on URL — the LWA
// token exchange, then the marketplaceParticipations lookup.
function mockFetchSequence(opts: {
  tokenOk?: boolean;
  tokenStatus?: number;
  accessToken?: string;
  refreshToken?: string;
  participationsOk?: boolean;
  participationsStatus?: number;
  marketplaceIds?: string[];
}) {
  const {
    tokenOk = true,
    tokenStatus = 200,
    accessToken = 'Atza|IwEBIExampleAccessToken',
    refreshToken = 'Atzr|IwEBIExampleRefreshToken',
    participationsOk = true,
    participationsStatus = 200,
    marketplaceIds = ['ATVPDKIKX0DER'],
  } = opts;

  jest.spyOn(global, 'fetch').mockImplementation((input) => {
    // The service only ever calls fetch(url: string, init) — never with a
    // Request/URL object — so this reflects the real invariant.
    const url = input as string;
    if (url.includes('api.amazon.com/auth/o2/token')) {
      return Promise.resolve({
        ok: tokenOk,
        status: tokenStatus,
        json: () =>
          Promise.resolve({
            refresh_token: refreshToken,
            access_token: accessToken,
          }),
      } as Response);
    }
    if (url.includes('/sellers/v1/marketplaceParticipations')) {
      return Promise.resolve({
        ok: participationsOk,
        status: participationsStatus,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              payload: marketplaceIds.map((id) => ({
                marketplace: { id },
                participation: { isParticipating: true },
              })),
            }),
          ),
      } as Response);
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
}

describe('SpApiService', () => {
  let service: SpApiService;
  let drizzle: ReturnType<typeof buildDrizzleMock>;
  let redis: ReturnType<typeof buildRedisMock>;

  beforeEach(() => {
    process.env.SP_API_APPLICATION_ID = 'amzn1.sp.solution.test';
    process.env.SP_API_CLIENT_ID = 'test-client-id';
    process.env.SP_API_CLIENT_SECRET = 'test-client-secret';
    process.env.SP_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');

    drizzle = buildDrizzleMock();
    redis = buildRedisMock();
    service = new SpApiService(
      drizzle as unknown as DrizzleService,
      redis as unknown as RedisService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildAuthorizationUrl', () => {
    it('throws NotFoundException when the client does not exist', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue(undefined);

      await expect(
        service.buildAuthorizationUrl('missing-client'),
      ).rejects.toThrow(NotFoundException);
    });

    it('infers region from a single distinct Ads account region and stores state', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });
      drizzle._mocks.adsAccountsFindMany.mockResolvedValue([
        { region: 'na' },
        { region: 'na' },
      ]);

      const result = await service.buildAuthorizationUrl('client-1');
      expect(result.region).toBe('na');
      const parsed = new URL(result.authorizationUrl);

      expect(parsed.origin + parsed.pathname).toBe(
        'https://sellercentral.amazon.com/apps/authorize/consent',
      );
      expect(parsed.searchParams.get('application_id')).toBe(
        'amzn1.sp.solution.test',
      );
      expect(parsed.searchParams.get('version')).toBe('beta');
      const state = parsed.searchParams.get('state');
      expect(state).toBeTruthy();

      expect(redis.setex).toHaveBeenCalledWith(
        `sp-api:oauth-state:${state}`,
        600,
        JSON.stringify({ clientId: 'client-1', region: 'na' }),
      );
    });

    it('uses the region override instead of inferring when given', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });

      await service.buildAuthorizationUrl('client-1', 'eu');

      expect(drizzle._mocks.adsAccountsFindMany).not.toHaveBeenCalled();
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('sp-api:oauth-state:'),
        600,
        JSON.stringify({ clientId: 'client-1', region: 'eu' }),
      );
    });

    it('throws BadRequestException when the client has no Ads accounts and no override', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });
      drizzle._mocks.adsAccountsFindMany.mockResolvedValue([]);

      await expect(service.buildAuthorizationUrl('client-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the client spans multiple regions and no override', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });
      drizzle._mocks.adsAccountsFindMany.mockResolvedValue([
        { region: 'na' },
        { region: 'eu' },
      ]);

      await expect(service.buildAuthorizationUrl('client-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('does NOT throw for multiple Ads accounts sharing the same region (e.g. US+CA+MX)', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });
      drizzle._mocks.adsAccountsFindMany.mockResolvedValue([
        { region: 'na' },
        { region: 'na' },
        { region: 'na' },
      ]);

      await expect(
        service.buildAuthorizationUrl('client-1'),
      ).resolves.toBeTruthy();
    });
  });

  describe('handleCallback', () => {
    it('throws BadRequestException when the state is missing or expired', async () => {
      redis.get.mockResolvedValue(null);

      await expect(
        service.handleCallback('auth-code', 'A1SELLER', 'bad-state'),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates one account row per marketplace the seller actually granted — a single consent, not one per marketplace', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ clientId: 'client-1', region: 'na' }),
      );
      mockFetchSequence({
        refreshToken: 'Atzr|IwEBIExampleRefreshToken',
        marketplaceIds: ['ATVPDKIKX0DER', 'A2EUQ1WTGCTBG2', 'A1AM78C64UM0Y8'], // US, CA, MX
      });

      const clientId = await service.handleCallback(
        'auth-code',
        'A1SELLER',
        'good-state',
      );

      expect(clientId).toBe('client-1');
      expect(redis.client.del).toHaveBeenCalledWith(
        'sp-api:oauth-state:good-state',
      );

      // One insert per marketplace — not one per authorization.
      expect(drizzle._mocks.insert).toHaveBeenCalledTimes(3);
      const typedValues = drizzle._mocks.values as jest.Mock<
        unknown,
        [InsertedSpAccount]
      >;
      const insertedMarketplaces = typedValues.mock.calls.map(
        (call) => call[0].marketplace,
      );
      expect(insertedMarketplaces).toEqual([
        'ATVPDKIKX0DER',
        'A2EUQ1WTGCTBG2',
        'A1AM78C64UM0Y8',
      ]);

      for (const call of typedValues.mock.calls) {
        const inserted = call[0];
        expect(inserted.clientId).toBe('client-1');
        expect(inserted.sellingPartnerId).toBe('A1SELLER');
        expect(inserted.region).toBe('na');
        expect(decrypt(inserted.refreshToken)).toBe(
          'Atzr|IwEBIExampleRefreshToken',
        );
      }
    });

    it('only stores marketplaces the seller is actively participating in', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ clientId: 'client-1', region: 'na' }),
      );
      jest.spyOn(global, 'fetch').mockImplementation((input) => {
        const url = input as string;
        if (url.includes('auth/o2/token')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ refresh_token: 'rt', access_token: 'at' }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                payload: [
                  {
                    marketplace: { id: 'ATVPDKIKX0DER' },
                    participation: { isParticipating: true },
                  },
                  {
                    marketplace: { id: 'A2EUQ1WTGCTBG2' },
                    participation: { isParticipating: false },
                  },
                ],
              }),
            ),
        } as Response);
      });

      await service.handleCallback('auth-code', 'A1SELLER', 'good-state');

      expect(drizzle._mocks.insert).toHaveBeenCalledTimes(1);
      const typedValues = drizzle._mocks.values as jest.Mock<
        unknown,
        [InsertedSpAccount]
      >;
      expect(typedValues.mock.calls[0][0].marketplace).toBe('ATVPDKIKX0DER');
    });

    it('throws BadRequestException when no marketplaces are participating', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ clientId: 'client-1', region: 'na' }),
      );
      mockFetchSequence({ marketplaceIds: [] });

      await expect(
        service.handleCallback('auth-code', 'A1SELLER', 'good-state'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the LWA token exchange fails', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ clientId: 'client-1', region: 'na' }),
      );
      mockFetchSequence({ tokenOk: false, tokenStatus: 400 });

      await expect(
        service.handleCallback('bad-code', 'A1SELLER', 'good-state'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when marketplaceParticipations fails', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ clientId: 'client-1', region: 'na' }),
      );
      mockFetchSequence({ participationsOk: false, participationsStatus: 403 });

      await expect(
        service.handleCallback('auth-code', 'A1SELLER', 'good-state'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
