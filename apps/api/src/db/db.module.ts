import { Module, Global } from '@nestjs/common';
import { DrizzleService } from './drizzle.service';
import { RedisService } from './redis.service';
import { ClickhouseService } from './clickhouse.service';

@Global()
@Module({
  providers: [DrizzleService, RedisService, ClickhouseService],
  exports: [DrizzleService, RedisService, ClickhouseService],
})
export class DbModule {}
