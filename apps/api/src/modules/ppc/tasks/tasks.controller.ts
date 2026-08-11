import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { assertValidTransition, InvalidTaskTransitionError } from './task-lifecycle';
import { TaskPromotionService } from './task-promotion.service';
import { TaskRepository } from './task.repository';
import type { TaskDismissReason, TaskStatus } from './task.types';

function assertValidTransitionOrBadRequest(from: TaskStatus, to: TaskStatus): void {
  try {
    assertValidTransition(from, to);
  } catch (err) {
    if (err instanceof InvalidTaskTransitionError) throw new BadRequestException(err.message);
    throw err;
  }
}

// No UI consumes this yet — this task is the task LAYER, not the screen.
// Exists so the promotion/lifecycle logic is invokable for testing and for
// whatever screen/scheduler wires into it next, same convention as
// RuleRunnerController.
@Controller('ppc/tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(
    private readonly promotion: TaskPromotionService,
    private readonly taskRepo: TaskRepository,
  ) {}

  @Post('promote')
  promote() {
    return this.promotion.promoteNewCandidates();
  }

  @Post('expire')
  async expire() {
    const expiredOnClear = await this.promotion.expireClearedTasks();
    const expiredOnCeiling = await this.promotion.expireStaleTasks();
    return { expiredOnClear, expiredOnCeiling };
  }

  @Get()
  list(@Query('clientId') clientId?: string) {
    return this.taskRepo.listSorted(clientId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.taskRepo.findById(id);
  }

  @Patch(':id/status')
  async setStatus(@Param('id') id: string, @Body('status') status: TaskStatus) {
    const task = await this.taskRepo.findById(id);
    if (!task) return { error: 'not found' };
    assertValidTransitionOrBadRequest(task.status, status);
    await this.taskRepo.setStatus(id, status, status === 'executed' ? { executedAt: new Date() } : {});
    return this.taskRepo.findById(id);
  }

  @Patch(':id/dismiss')
  async dismiss(
    @Param('id') id: string,
    @Body('reason') reason: TaskDismissReason,
    @Body('note') note?: string,
  ) {
    const task = await this.taskRepo.findById(id);
    if (!task) return { error: 'not found' };
    assertValidTransitionOrBadRequest(task.status, 'dismissed');
    await this.taskRepo.dismiss(id, reason, note ?? null);
    return this.taskRepo.findById(id);
  }
}
