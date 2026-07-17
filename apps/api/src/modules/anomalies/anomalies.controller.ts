import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnomaliesService } from './anomalies.service';

@Controller('anomalies')
@UseGuards(JwtAuthGuard)
export class AnomaliesController {
  constructor(private readonly anomaliesService: AnomaliesService) {}

  @Get()
  list(
    @Query('resolved') resolved: string | undefined,
    @Query('clientId') clientId: string | undefined,
  ) {
    const resolvedFilter = resolved === undefined ? false : resolved === 'true';
    return this.anomaliesService.listAnomalies(resolvedFilter, clientId);
  }

  @Patch(':id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string) {
    return this.anomaliesService.resolveAnomaly(id);
  }
}
