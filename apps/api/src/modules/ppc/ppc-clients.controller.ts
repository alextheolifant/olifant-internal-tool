import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PpcClientsService } from './ppc-clients.service';

@Controller('ppc/clients')
@UseGuards(JwtAuthGuard)
export class PpcClientsController {
  constructor(private readonly ppcClientsService: PpcClientsService) {}

  @Get()
  list(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('marketplace') marketplace?: string,
  ) {
    return this.ppcClientsService.getClients(from, to, marketplace);
  }

  @Get('freshness')
  freshness() {
    return this.ppcClientsService.getGlobalFreshness();
  }
}
