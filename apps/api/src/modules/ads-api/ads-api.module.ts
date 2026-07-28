import { Module } from '@nestjs/common';
import { AdsApiController } from './ads-api.controller';
import { AdsApiService } from './ads-api.service';

@Module({
  controllers: [AdsApiController],
  providers: [AdsApiService],
})
export class AdsApiModule {}
