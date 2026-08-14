import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { MonitorRepository } from './monitor.repository';
import { MonitorService } from './monitor.service';
import { SavingsService } from './savings.service';

// Manual triggers, same convention as RuleRunnerController and the ledger's
// /detect: the daily scheduler (Temporal) isn't built in this slice — these
// are the callable units for testing and for whatever schedules them next.
@Controller('ppc/monitor')
@UseGuards(JwtAuthGuard)
export class MonitorController {
  constructor(
    private readonly monitor: MonitorService,
    private readonly monitors: MonitorRepository,
    private readonly savings: SavingsService,
  ) {}

  /** Opens monitors for newly executed tasks, then advances every watcher. */
  @Post('run')
  run(@Query('date') date?: string) {
    return this.monitor.runDailyPass(date ?? new Date().toISOString().slice(0, 10));
  }

  @Post('open')
  async open() {
    return { opened: await this.monitor.openForExecutedTasks() };
  }

  @Get()
  list() {
    return this.monitors.listAll();
  }

  @Get('savings')
  getSavings() {
    return this.savings.getSummary();
  }

  /**
   * Computes a monitor's verdict without persisting it — lets a verdict be
   * inspected at any point mid-window, and lets the +14d and +30d framings
   * of the same monitor be compared side by side.
   */
  @Get(':taskId/verdict')
  async verdict(
    @Param('taskId') taskId: string,
    @Query('stage') stage?: string,
    @Query('date') date?: string,
  ) {
    const monitor = await this.monitors.findByTaskId(taskId);
    if (!monitor) return { error: 'no monitor for that task' };
    return this.monitor.computeVerdict(
      monitor,
      stage === 'verdict_30d' ? 'verdict_30d' : 'checkpoint_14d',
      date ?? new Date().toISOString().slice(0, 10),
    );
  }
}
