import { NotFoundException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { DrizzleService } from '../../db/drizzle.service';
import { RedisService } from '../../db/redis.service';

function buildDrizzleMock(existing: unknown) {
  const findFirst = jest.fn().mockResolvedValue(existing);
  const returning = jest.fn().mockResolvedValue([
    {
      id: 'client-1',
      name: 'Test Client',
      tier: 't1',
      status: 'active',
      targetTacos: null,
      goalRevenue: null,
    },
  ]);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });

  return {
    db: { query: { clients: { findFirst } }, update },
    _mocks: { findFirst, update, set, where, returning },
  };
}

function buildRedisMock(existingKeys: string[] = []) {
  const keys = jest.fn().mockResolvedValue(existingKeys);
  const del = jest.fn().mockResolvedValue(undefined);
  return { client: { keys, del }, _mocks: { keys, del } };
}

describe('ClientsService.update', () => {
  const existingClient = { id: 'client-1', amazonAdsAccounts: [] };

  it('throws NotFoundException when the client does not exist', async () => {
    const drizzle = buildDrizzleMock(undefined);
    const redis = buildRedisMock();
    const service = new ClientsService(
      drizzle as unknown as DrizzleService,
      redis as unknown as RedisService,
    );

    await expect(service.update('missing', {})).rejects.toThrow(
      NotFoundException,
    );
    expect(redis._mocks.keys).not.toHaveBeenCalled();
  });

  it('invalidates every cached metrics:clients:* key after a successful update', async () => {
    const drizzle = buildDrizzleMock(existingClient);
    const redis = buildRedisMock([
      'metrics:clients:v1:2026-07-01:2026-07-28:ALL',
      'metrics:clients:v1:2026-07-22:2026-07-28:US',
    ]);
    const service = new ClientsService(
      drizzle as unknown as DrizzleService,
      redis as unknown as RedisService,
    );

    await service.update('client-1', { status: 'paused' });

    expect(redis._mocks.keys).toHaveBeenCalledWith('metrics:clients:*');
    expect(redis._mocks.del).toHaveBeenCalledWith(
      'metrics:clients:v1:2026-07-01:2026-07-28:ALL',
      'metrics:clients:v1:2026-07-22:2026-07-28:US',
    );
  });

  it('skips del when there are no cached keys to clear', async () => {
    const drizzle = buildDrizzleMock(existingClient);
    const redis = buildRedisMock([]);
    const service = new ClientsService(
      drizzle as unknown as DrizzleService,
      redis as unknown as RedisService,
    );

    await service.update('client-1', { status: 'paused' });

    expect(redis._mocks.del).not.toHaveBeenCalled();
  });

  it('does not fail the update if cache invalidation itself errors', async () => {
    const drizzle = buildDrizzleMock(existingClient);
    const redis = buildRedisMock();
    redis._mocks.keys.mockRejectedValue(new Error('redis unreachable'));
    const service = new ClientsService(
      drizzle as unknown as DrizzleService,
      redis as unknown as RedisService,
    );

    await expect(
      service.update('client-1', { status: 'paused' }),
    ).resolves.toMatchObject({
      id: 'client-1',
    });
  });
});
