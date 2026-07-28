import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { DrizzleService } from '../../db/drizzle.service';

function buildDrizzleMock(user: { id: string; passwordHash: string } | undefined) {
  const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
  const update = jest.fn().mockReturnValue({ set });

  return {
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(user ? [user] : []),
          }),
        }),
      }),
      update,
    },
    _mocks: { update, set },
  };
}

describe('AuthService.changePassword', () => {
  it('throws UnauthorizedException when the user does not exist', async () => {
    const drizzle = buildDrizzleMock(undefined);
    const service = new AuthService(drizzle as unknown as DrizzleService, {} as never);

    await expect(
      service.changePassword('missing-user', 'whatever123', 'newpassword123'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws BadRequestException (not Unauthorized) when the current password is wrong', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 12);
    const drizzle = buildDrizzleMock({ id: 'user-1', passwordHash });
    const service = new AuthService(drizzle as unknown as DrizzleService, {} as never);

    await expect(
      service.changePassword('user-1', 'wrong-password', 'newpassword123'),
    ).rejects.toThrow(BadRequestException);
    expect(drizzle._mocks.update).not.toHaveBeenCalled();
  });

  it('updates the password hash when the current password is correct', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 12);
    const drizzle = buildDrizzleMock({ id: 'user-1', passwordHash });
    const service = new AuthService(drizzle as unknown as DrizzleService, {} as never);

    await service.changePassword('user-1', 'correct-password', 'brand-new-password');

    expect(drizzle._mocks.update).toHaveBeenCalledTimes(1);
    const setArg = drizzle._mocks.set.mock.calls[0][0] as { passwordHash: string };
    expect(setArg.passwordHash).not.toBe(passwordHash);
    expect(setArg.passwordHash).not.toBe('brand-new-password');
    expect(await bcrypt.compare('brand-new-password', setArg.passwordHash)).toBe(true);
  });
});
