import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { PpcClientsController } from './ppc-clients.controller';
import { PpcClientsService } from './ppc-clients.service';
import { PpcConfigController } from './ppc-config.controller';
import { PpcConfigService } from './ppc-config.service';
import { ProductEconomicsController } from './product-economics.controller';
import { ProductEconomicsService } from './product-economics.service';
import { CampaignMetricsRepository } from './rules/campaign-metrics.repository';
import { RuleRunnerController } from './rules/rule-runner.controller';
import { RuleRunnerService } from './rules/rule-runner.service';
import { RuleStateRepository } from './rules/rule-state.repository';

@Module({
  imports: [MetricsModule],
  controllers: [
    PpcClientsController,
    PpcConfigController,
    ProductEconomicsController,
    RuleRunnerController,
  ],
  providers: [
    PpcClientsService,
    PpcConfigService,
    ProductEconomicsService,
    CampaignMetricsRepository,
    RuleStateRepository,
    RuleRunnerService,
  ],
})
export class PpcModule {}
