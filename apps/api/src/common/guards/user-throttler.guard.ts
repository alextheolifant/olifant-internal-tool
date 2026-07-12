import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate-limits by authenticated user id rather than by IP, so teammates sharing
 * one office/NAT IP each get their own budget (and a single user can't dodge the
 * limit by rotating IPs).
 *
 * The global throttler runs before route-scoped auth guards, so `req.user` isn't
 * populated yet when `getTracker` runs. We read the user id straight from the
 * bearer token's `sub` claim instead. This is only used as a throttle *key*, not
 * an auth decision — a forged or invalid token still gets rejected by
 * `JwtAuthGuard` before any Anthropic call runs, so decoding without verifying is
 * safe here. Unauthenticated routes (e.g. login) have no token and fall back to
 * IP, which is the correct behaviour for brute-force protection.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(
    req: Request & { user?: { id?: string } },
  ): Promise<string> {
    const userId = req.user?.id ?? subFromBearer(req.headers['authorization']);
    const key = userId ? `user:${userId}` : `ip:${req.ip ?? 'unknown'}`;
    return Promise.resolve(key);
  }
}

function subFromBearer(
  header: string | string[] | undefined,
): string | undefined {
  if (!header || Array.isArray(header) || !header.startsWith('Bearer '))
    return undefined;
  const token = header.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as {
      sub?: unknown;
    };
    return typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}
