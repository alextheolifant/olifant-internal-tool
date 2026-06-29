import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { DrizzleService } from '../../db/drizzle.service';
import { users, loginAuditLogs } from '../../db/schema';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly jwtService: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
    ip: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const [user] = await this.drizzle.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      this.log({ email, ip, userAgent, success: false, failureReason: 'user_not_found' });
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      this.log({ email, userId: user.id, ip, userAgent, success: false, failureReason: 'invalid_password' });
      throw new UnauthorizedException('Invalid credentials');
    }

    this.log({ email, userId: user.id, ip, userAgent, success: true });
    return this.issueTokens(user.id, user.email, user.role);
  }

  async refresh(userId: string): Promise<{ accessToken: string }> {
    const [user] = await this.drizzle.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedException();

    return { accessToken: this.signAccess(user.id, user.email, user.role) };
  }

  private issueTokens(id: string, email: string, role: string): TokenPair {
    return {
      accessToken: this.signAccess(id, email, role),
      refreshToken: this.signRefresh(id),
    };
  }

  private signAccess(id: string, email: string, role: string): string {
    return this.jwtService.sign(
      { sub: id, email, role },
      { secret: process.env.JWT_SECRET, expiresIn: '15m' },
    );
  }

  private signRefresh(id: string): string {
    return this.jwtService.sign(
      { sub: id },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '30d' },
    );
  }

  private log(data: {
    email: string;
    userId?: string;
    ip: string;
    userAgent?: string;
    success: boolean;
    failureReason?: string;
  }): void {
    this.drizzle.db
      .insert(loginAuditLogs)
      .values({
        email: data.email,
        userId: data.userId ?? null,
        ip: data.ip,
        userAgent: data.userAgent,
        success: data.success,
        failureReason: data.failureReason,
      })
      .catch(() => {
        // Non-blocking — a logging failure must never break the auth flow
      });
  }
}
