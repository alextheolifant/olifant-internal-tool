import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { DbModule } from './db/db.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { SyncModule } from './modules/sync/sync.module';
import { AiModule } from './modules/ai/ai.module';
import { SpApiModule } from './modules/sp-api/sp-api.module';
import { AnomaliesModule } from './modules/anomalies/anomalies.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1 minute window
        limit: 120, // 120 req/min for general API traffic
      },
    ]),
    DbModule,
    AuthModule,
    ClientsModule,
    MetricsModule,
    CampaignsModule,
    SyncModule,
    AiModule,
    SpApiModule,
    AnomaliesModule,
    ProposalsModule,
    ReportsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Per-user rate limiting (keyed by JWT sub, not IP) — see UserThrottlerGuard.
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule {}
