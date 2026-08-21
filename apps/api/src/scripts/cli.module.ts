import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module';
import { PpcModule } from '../modules/ppc/ppc.module';

// Minimal bootstrap for CLI/cron scripts (run-rules.ts, promote-tasks.ts) —
// deliberately NOT the full AppModule. These scripts never handle an HTTP
// request, so there's no reason to construct AuthModule — whose JwtStrategy
// hard-requires JWT_SECRET/JWT_REFRESH_SECRET at construction time just to
// exist, never to actually verify a token here — or any of the other
// request-only modules (AI, SP-API, Ads-API, clients, campaigns, sync,
// anomalies, proposals, reports, notifications). Only what
// RuleRunnerService/TaskPromotionService actually depend on: Postgres/Redis/
// ClickHouse (DbModule, @Global — imported once here) and PpcModule itself
// (which pulls in MetricsModule on its own). Keep this in sync if a future
// PPC service starts depending on something outside this set.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DbModule,
    PpcModule,
  ],
})
export class CliModule {}
