import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RuleRunnerService } from './rule-runner.service';

// Manual trigger for the rule runner. This slice doesn't build the actual
// daily scheduler (Temporal workflow / cron) — "runs daily, after sync
// completes" describes the intended eventual trigger, not something wired up
// here. This endpoint exists so the runner is invokable for testing and for
// whatever schedules it later.
@Controller('ppc/rules')
@UseGuards(JwtAuthGuard)
export class RuleRunnerController {
  constructor(private readonly ruleRunner: RuleRunnerService) {}

  @Post('run')
  run(@Query('date') date: string) {
    return this.ruleRunner.runForDate(date);
  }
}
