import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TodayService } from './today.service';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

@Controller('ppc/today')
@UseGuards(JwtAuthGuard)
export class TodayController {
  constructor(private readonly todayService: TodayService) {}

  @Get()
  get(@Query('clientId') clientId?: string) {
    return this.todayService.getToday(todayISO(), clientId);
  }
}
