import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { PpcClientsController } from './ppc-clients.controller';
import { PpcClientsService } from './ppc-clients.service';
import { PpcConfigController } from './ppc-config.controller';
import { PpcConfigService } from './ppc-config.service';
import { ProductEconomicsController } from './product-economics.controller';
import { ProductEconomicsService } from './product-economics.service';

@Module({
  imports: [MetricsModule],
  controllers: [PpcClientsController, PpcConfigController, ProductEconomicsController],
  providers: [PpcClientsService, PpcConfigService, ProductEconomicsService],
})
export class PpcModule {}
