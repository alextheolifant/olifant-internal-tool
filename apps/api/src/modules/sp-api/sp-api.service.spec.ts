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

  return {
    db: {
      query: {
        clients: { findFirst: clientsFindFirst },
        amazonAdsAccounts: { findMany: adsAccountsFindMany },
      },
      insert,
    },
    _mocks: {
      clientsFindFirst,
      adsAccountsFindMany,
      insert,
      values,
      onConflictDoUpdate,
    },
  };
}

function buildRedisMock() {
  const get = jest.fn();
  const setex = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn().mockResolvedValue(undefined);
  return { get, setex, client: { del } };
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

    it('infers marketplace/region from a single distinct Ads account and stores state', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });
      drizzle._mocks.adsAccountsFindMany.mockResolvedValue([
        { marketplace: 'US', region: 'na' },
        { marketplace: 'US', region: 'na' },
      ]);

      const url = await service.buildAuthorizationUrl('client-1');
      const parsed = new URL(url);

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
        JSON.stringify({
          clientId: 'client-1',
          marketplace: 'US',
          region: 'na',
        }),
      );
    });

    it('uses the marketplace/region override instead of inferring when both are given', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });

      await service.buildAuthorizationUrl('client-1', 'UK', 'eu');

      expect(drizzle._mocks.adsAccountsFindMany).not.toHaveBeenCalled();
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('sp-api:oauth-state:'),
        600,
        JSON.stringify({
          clientId: 'client-1',
          marketplace: 'UK',
          region: 'eu',
        }),
      );
    });

    it('throws BadRequestException when the client has no Ads accounts and no override', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });
      drizzle._mocks.adsAccountsFindMany.mockResolvedValue([]);

      await expect(service.buildAuthorizationUrl('client-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the client spans multiple marketplaces and no override', async () => {
      drizzle._mocks.clientsFindFirst.mockResolvedValue({ id: 'client-1' });
      drizzle._mocks.adsAccountsFindMany.mockResolvedValue([
        { marketplace: 'US', region: 'na' },
        { marketplace: 'UK', region: 'eu' },
      ]);

      await expect(service.buildAuthorizationUrl('client-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('handleCallback', () => {
    it('throws BadRequestException when the state is missing or expired', async () => {
      redis.get.mockResolvedValue(null);

      await expect(
        service.handleCallback('auth-code', 'A1SELLER', 'bad-state'),
      ).rejects.toThrow(BadRequestException);
    });

    it('exchanges the code, encrypts the refresh token, upserts the account, and single-uses the state', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          clientId: 'client-1',
          marketplace: 'US',
          region: 'na',
        }),
      );
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ refresh_token: 'Atzr|IwEBIExampleRefreshToken' }),
      } as Response);

      const clientId = await service.handleCallback(
        'auth-code',
        'A1SELLER',
        'good-state',
      );

      expect(clientId).toBe('client-1');
      expect(redis.client.del).toHaveBeenCalledWith(
        'sp-api:oauth-state:good-state',
      );

      expect(drizzle._mocks.insert).toHaveBeenCalled();
      const typedValues = drizzle._mocks.values as jest.Mock<
        unknown,
        [InsertedSpAccount]
      >;
      const insertedValues = typedValues.mock.calls[0][0];
      expect(insertedValues.clientId).toBe('client-1');
      expect(insertedValues.sellingPartnerId).toBe('A1SELLER');
      expect(insertedValues.marketplace).toBe('US');
      expect(insertedValues.region).toBe('na');
      expect(decrypt(insertedValues.refreshToken)).toBe(
        'Atzr|IwEBIExampleRefreshToken',
      );
    });

    it('throws BadRequestException when the LWA token exchange fails', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          clientId: 'client-1',
          marketplace: 'US',
          region: 'na',
        }),
      );
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 400 } as Response);

      await expect(
        service.handleCallback('bad-code', 'A1SELLER', 'good-state'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
