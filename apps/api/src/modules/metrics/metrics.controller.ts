import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MetricsService } from './metrics.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Controller('metrics')
@UseGuards(JwtAuthGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('clients')
  getClientMetrics(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('marketplace') marketplace?: string,
  ) {
    if (!from || !DATE_RE.test(from) || !to || !DATE_RE.test(to)) {
      throw new BadRequestException(
        'from and to are required in YYYY-MM-DD format',
      );
    }
    if (from > to) {
      throw new BadRequestException('from must be on or before to');
    }
    return this.metricsService.getClientMetrics(from, to, marketplace);
  }
}
