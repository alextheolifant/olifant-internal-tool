import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { EntityDiffService } from './entity-diff/entity-diff.service';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerRepository } from './ledger/ledger.repository';
import { LedgerService } from './ledger/ledger.service';
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
import { EvidenceProvenanceResolver } from './tasks/evidence';
import { TaskIdRepository } from './tasks/task-id.repository';
import { TaskPromotionService } from './tasks/task-promotion.service';
import { TaskRepository } from './tasks/task.repository';
import { TasksController } from './tasks/tasks.controller';
import { TodayController } from './today.controller';
import { TodayService } from './today.service';
import { SlackNotifierService } from './verification/slack-notifier.service';
import { VerificationService } from './verification/verification.service';

@Module({
  imports: [MetricsModule],
  controllers: [
    LedgerController,
    PpcClientsController,
    PpcConfigController,
    ProductEconomicsController,
    RuleRunnerController,
    TasksController,
    TodayController,
  ],
  providers: [
    PpcClientsService,
    PpcConfigService,
    ProductEconomicsService,
    CampaignMetricsRepository,
    RuleStateRepository,
    RuleRunnerService,
    EvidenceProvenanceResolver,
    TaskIdRepository,
    TaskRepository,
    TaskPromotionService,
    TodayService,
    EntityDiffService,
    LedgerRepository,
    LedgerService,
    VerificationService,
    SlackNotifierService,
  ],
})
export class PpcModule {}
