import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { LedgerService } from './ledger.service';

// Manual triggers for now — same convention as RuleRunnerController and
// TasksController's /promote, /expire: the actual daily scheduling
// (Temporal) isn't built in this slice, this is the callable unit for
// testing and for whatever schedules it next.
@Controller('ppc/ledger')
@UseGuards(JwtAuthGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Post('detect')
  detect(
    @Query('accountId') accountId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.ledger.detectExternalChanges(accountId, fromDate, toDate);
  }

  @Get()
  list(@Query('clientId') clientId: string, @Query('limit') limit?: string) {
    return this.ledger.listForClient(
      clientId,
      limit ? Number(limit) : undefined,
    );
  }
}
