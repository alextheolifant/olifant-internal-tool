import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdsApiService } from './ads-api.service';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';

interface InsertedManagerAccount {
  organizationId: string;
  connectedByUserId: string;
  refreshToken: string;
  isActive: boolean;
}

function buildDrizzleMock() {
  const usersFindFirst = jest.fn();
  const adsManagerAccountsFindFirst = jest.fn().mockResolvedValue(undefined);
  const adsManagerAccountsFindMany = jest.fn().mockResolvedValue([]);
  const values = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn().mockReturnValue({ values });

  return {
    db: {
      query: {
        users: { findFirst: usersFindFirst },
        adsManagerAccounts: {
          findFirst: adsManagerAccountsFindFirst,
          findMany: adsManagerAccountsFindMany,
        },
      },
      insert,
    },
    _mocks: {
      usersFindFirst,
      adsManagerAccountsFindFirst,
      adsManagerAccountsFindMany,
      insert,
      values,
    },
  };
}

function buildRedisMock() {
  const get = jest.fn();
  const setex = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn().mockResolvedValue(undefined);
  return { get, setex, client: { del } };
}

describe('AdsApiService', () => {
  let service: AdsApiService;
  let drizzle: ReturnType<typeof buildDrizzleMock>;
  let redis: ReturnType<typeof buildRedisMock>;

  beforeEach(() => {
    process.env.ADS_CLIENT_ID = 'amzn1.application-oa2-client.test';
    process.env.ADS_CLIENT_SECRET = 'test-client-secret';
    process.env.ADS_REDIRECT_URI = 'https://app.olifantdigital.com/ads-api/callback';
    process.env.SP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

    drizzle = buildDrizzleMock();
    redis = buildRedisMock();
    service = new AdsApiService(
      drizzle as unknown as DrizzleService,
      redis as unknown as RedisService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildAuthorizationUrl', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      drizzle._mocks.usersFindFirst.mockResolvedValue(undefined);

      await expect(service.buildAuthorizationUrl('missing-user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('generates the correct Amazon consent URL and stores state', async () => {
      drizzle._mocks.usersFindFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
      });

      const result = await service.buildAuthorizationUrl('user-1');
      const parsed = new URL(result.authorizationUrl);

      expect(parsed.origin + parsed.pathname).toBe('https://www.amazon.com/ap/oa');
      expect(parsed.searchParams.get('client_id')).toBe('amzn1.application-oa2-client.test');
      expect(parsed.searchParams.get('scope')).toBe('advertising::campaign_management');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://app.olifantdigital.com/ads-api/callback',
      );
      const state = parsed.searchParams.get('state');
      expect(state).toBeTruthy();

      expect(redis.setex).toHaveBeenCalledWith(
        `ads-api:oauth-state:${state}`,
        600,
        JSON.stringify({ userId: 'user-1', organizationId: 'org-1' }),
      );
    });

    it('throws BadRequestException when this user already has an active manager account', async () => {
      drizzle._mocks.usersFindFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
      });
      drizzle._mocks.adsManagerAccountsFindFirst.mockResolvedValue({
        id: 'ama-1',
        connectedByUserId: 'user-1',
        isActive: true,
      });

      await expect(service.buildAuthorizationUrl('user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(redis.setex).not.toHaveBeenCalled();
    });
  });

  describe('handleCallback', () => {
    it('throws BadRequestException when the state is missing or expired', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.handleCallback('auth-code', 'bad-state')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deletes the state before doing any work (single-use)', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ userId: 'user-1', organizationId: 'org-1' }),
      );
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ refresh_token: 'Atzr|FakeToken', access_token: 'Atza|Fake' }),
      } as Response);

      await service.handleCallback('auth-code', 'good-state');

      expect(redis.client.del).toHaveBeenCalledWith('ads-api:oauth-state:good-state');
    });

    it('inserts a new manager account row without touching any other row', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ userId: 'user-1', organizationId: 'org-1' }),
      );
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ refresh_token: 'Atzr|FakeToken', access_token: 'Atza|Fake' }),
      } as Response);

      await service.handleCallback('auth-code', 'good-state');

      // Pure insert — no update/onConflictDoUpdate exists on this mock at all,
      // so any attempt to touch an existing row would throw instead of silently
      // succeeding.
      expect(drizzle._mocks.insert).toHaveBeenCalledTimes(1);
      const typedValues = drizzle._mocks.values as jest.Mock<unknown, [InsertedManagerAccount]>;
      const inserted = typedValues.mock.calls[0][0];
      expect(inserted.organizationId).toBe('org-1');
      expect(inserted.connectedByUserId).toBe('user-1');
      expect(inserted.isActive).toBe(true);
      expect(inserted.refreshToken).not.toBe('Atzr|FakeToken'); // encrypted, not raw
    });

    it('throws BadRequestException when the LWA token exchange fails', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ userId: 'user-1', organizationId: 'org-1' }),
      );
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400 } as Response);

      await expect(service.handleCallback('bad-code', 'good-state')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('listManagerAccounts', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      drizzle._mocks.usersFindFirst.mockResolvedValue(undefined);

      await expect(service.listManagerAccounts('missing-user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns every manager account for the requesting user\'s organization', async () => {
      drizzle._mocks.usersFindFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
      });
      const connectedAt = new Date('2026-07-28T00:00:00Z');
      drizzle._mocks.adsManagerAccountsFindMany.mockResolvedValue([
        {
          id: 'ama-1',
          connectedAt,
          isActive: true,
          connectedByUser: { email: 'admin@olifantdigital.com' },
        },
        {
          id: 'ama-2',
          connectedAt,
          isActive: true,
          connectedByUser: null,
        },
      ]);

      const result = await service.listManagerAccounts('user-1');

      expect(result).toEqual([
        { id: 'ama-1', connectedAt, connectedByEmail: 'admin@olifantdigital.com', isActive: true },
        { id: 'ama-2', connectedAt, connectedByEmail: null, isActive: true },
      ]);
    });
  });
});
