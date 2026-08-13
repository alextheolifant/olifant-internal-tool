import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { LedgerService } from '../ledger/ledger.service';
import { VerificationService } from '../verification/verification.service';
import { assertValidTransition, InvalidTaskTransitionError } from './task-lifecycle';
import { TaskPromotionService } from './task-promotion.service';
import { TaskRepository } from './task.repository';
import type { TaskAction, TaskDismissReason, TaskStatus } from './task.types';

function assertValidTransitionOrBadRequest(from: TaskStatus, to: TaskStatus): void {
  try {
    assertValidTransition(from, to);
  } catch (err) {
    if (err instanceof InvalidTaskTransitionError) throw new BadRequestException(err.message);
    throw err;
  }
}

// Statuses only the system may set — never through the generic status
// endpoint below. 'executed' requires confirming a value (see /execute);
// 'verified'/'verify_failed' are decided by the verification job, not typed
// in by a human.
const SYSTEM_ONLY_STATUSES: TaskStatus[] = ['executed', 'verified', 'verify_failed'];

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
    private readonly verification: VerificationService,
    private readonly ledger: LedgerService,
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
    if (SYSTEM_ONLY_STATUSES.includes(status)) {
      throw new BadRequestException(
        status === 'executed'
          ? `'executed' requires confirming a value — use POST /ppc/tasks/${id}/execute instead.`
          : `'${status}' is set by the verification job, not directly.`,
      );
    }
    const task = await this.taskRepo.findById(id);
    if (!task) return { error: 'not found' };
    assertValidTransitionOrBadRequest(task.status, status);
    await this.taskRepo.setStatus(id, status);
    return this.taskRepo.findById(id);
  }

  // Marking executed requires confirming the value (§8.3) — pre-filled from
  // action.newValue on the client, but what's stored is whatever the
  // executor actually confirms, since it may differ from what was proposed.
  // Required whenever the action has a field to confirm; omitted/ignored for
  // diagnostic tasks (action.field null) that have nothing to confirm.
  @Post(':id/execute')
  async execute(@Param('id') id: string, @Body('confirmedValue') confirmedValue?: string | number | null) {
    const task = await this.taskRepo.findById(id);
    if (!task) return { error: 'not found' };
    assertValidTransitionOrBadRequest(task.status, 'executed');

    const action = task.action as TaskAction;
    if (action.field && (confirmedValue === undefined || confirmedValue === null || confirmedValue === '')) {
      throw new BadRequestException(
        `This task proposes a change to '${action.field}' — confirmedValue is required to mark it executed.`,
      );
    }

    await this.taskRepo.confirmExecution(id, action.field ? String(confirmedValue) : null);
    const updated = await this.taskRepo.findById(id);
    if (updated) await this.ledger.recordEngineChange(updated);
    return updated;
  }

  @Post('verify')
  verify() {
    return this.verification.verifyExecutedTasks();
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
