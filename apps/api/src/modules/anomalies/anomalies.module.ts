import { Module } from '@nestjs/common';
import { AnomaliesController } from './anomalies.controller';
import { AnomaliesService } from './anomalies.service';
import { MetricsModule } from '../metrics/metrics.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [MetricsModule, AiModule],
  controllers: [AnomaliesController],
  providers: [AnomaliesService],
  exports: [AnomaliesService],
})
export class AnomaliesModule {}
