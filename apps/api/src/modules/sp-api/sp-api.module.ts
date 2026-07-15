import { Module } from '@nestjs/common';
import { SpApiController } from './sp-api.controller';
import { SpApiService } from './sp-api.service';

@Module({
  controllers: [SpApiController],
  providers: [SpApiService],
})
export class SpApiModule {}
