import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { LedgerService } from '../ledger/ledger.service';
import { VerificationService } from '../verification/verification.service';
import { QueueService } from './queue.service';
import type { BulkApproveResponse, BulkApproveResult } from './queue.types';
import { assertValidTransition, InvalidTaskTransitionError } from './task-lifecycle';
import { TaskPromotionService } from './task-promotion.service';
import { TaskRepository } from './task.repository';
import type { TaskAction, TaskDismissReason, TaskStatus, TaskType } from './task.types';

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

@Controller('ppc/tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(
    private readonly promotion: TaskPromotionService,
    private readonly taskRepo: TaskRepository,
    private readonly verification: VerificationService,
    private readonly ledger: LedgerService,
    private readonly queue: QueueService,
  ) {}

  // ─── Pipeline triggers (no scheduler in this slice) ─────────────────────

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

  @Post('verify')
  verify() {
    return this.verification.verifyExecutedTasks();
  }

  // ─── Part 1 — queue list ────────────────────────────────────────────────
  // Filters are all optional and combinable. Ordering (D-band above every
  // other band, then priority score descending) comes from the task layer's
  // own tier expression — see TaskRepository.queryQueue.
  @Get()
  list(
    @Query('clientId') clientId?: string,
    @Query('type') type?: TaskType,
    @Query('status') status?: TaskStatus,
    @Query('assignee') assignee?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.queue.list({
      clientId,
      type,
      status,
      assignee,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  // ─── Part 5 — bulk approve ──────────────────────────────────────────────
  // Declared before ':id' routes so "bulk-approve" isn't captured as an id.
  //
  // Every id is validated against the state machine independently and one
  // bad id never fails the batch — the UI acts on a filtered set and needs
  // to know precisely which rows moved.
  @Post('bulk-approve')
  async bulkApprove(@Body('ids') ids: string[]): Promise<BulkApproveResponse> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('ids must be a non-empty array of task ids');
    }

    const results: BulkApproveResult[] = [];
    for (const id of ids) {
      const task = await this.taskRepo.findById(id);
      if (!task) {
        results.push({ id, ok: false, status: null, error: 'not found' });
        continue;
      }
      try {
        assertValidTransition(task.status, 'approved');
      } catch (err) {
        results.push({
          id,
          ok: false,
          status: task.status,
          error: err instanceof InvalidTaskTransitionError ? err.message : String(err),
        });
        continue;
      }
      await this.taskRepo.approve(id);
      results.push({ id, ok: true, status: 'approved', error: null });
    }

    return {
      approved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  // ─── Part 2 — drawer detail ─────────────────────────────────────────────
  @Get(':id')
  async get(@Param('id') id: string) {
    const detail = await this.queue.detail(id);
    if (!detail) throw new NotFoundException(`No task ${id}`);
    return detail;
  }

  // ─── Part 3 — monitor series ────────────────────────────────────────────
  @Get(':id/performance')
  async performance(@Param('id') id: string) {
    const task = await this.taskRepo.findById(id);
    if (!task) throw new NotFoundException(`No task ${id}`);
    const result = await this.queue.performance(id);
    if (!result) {
      // A task with no monitor hasn't been executed — say so plainly rather
      // than returning empty series the UI would draw as flat lines.
      return {
        taskId: id,
        available: false,
        reason: `Task is '${task.status}' and has no monitor — performance is only tracked once a task is executed.`,
      };
    }
    return { available: true, ...result };
  }

  // ─── Part 4 — clickable evidence ────────────────────────────────────────
  @Get(':id/facts')
  async facts(@Param('id') id: string, @Query('metric') metric: string) {
    if (!metric) throw new BadRequestException('metric query parameter is required');
    const result = await this.queue.facts(id, metric);
    if (!result) throw new NotFoundException(`No task ${id}`);
    return result;
  }

  // ─── Part 5 — action endpoints ──────────────────────────────────────────

  @Post(':id/approve')
  async approve(@Param('id') id: string) {
    const task = await this.taskRepo.findById(id);
    if (!task) throw new NotFoundException(`No task ${id}`);
    assertValidTransitionOrBadRequest(task.status, 'approved');
    await this.taskRepo.approve(id);
    return this.queue.detail(id);
  }

  // Marking executed requires confirming the value (§8.3) — pre-filled from
  // action.newValue on the client, but what's stored is whatever the
  // executor actually confirms, since it may differ from what was proposed.
  // Delegates storage to the execution/verification loop's own path.
  @Post(':id/execute')
  async execute(@Param('id') id: string, @Body('confirmedValue') confirmedValue?: string | number | null) {
    const task = await this.taskRepo.findById(id);
    if (!task) throw new NotFoundException(`No task ${id}`);
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
    return this.queue.detail(id);
  }

  @Post(':id/dismiss')
  async dismissPost(
    @Param('id') id: string,
    @Body('reason') reason: TaskDismissReason,
    @Body('note') note?: string,
  ) {
    if (!reason) throw new BadRequestException('reason is required to dismiss a task');
    const task = await this.taskRepo.findById(id);
    if (!task) throw new NotFoundException(`No task ${id}`);
    assertValidTransitionOrBadRequest(task.status, 'dismissed');
    await this.taskRepo.dismiss(id, reason, note ?? null);
    return this.queue.detail(id);
  }

  // ─── Pre-existing transition endpoints ──────────────────────────────────

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
    if (!task) throw new NotFoundException(`No task ${id}`);
    assertValidTransitionOrBadRequest(task.status, status);
    await this.taskRepo.setStatus(id, status);
    return this.taskRepo.findById(id);
  }

  @Patch(':id/dismiss')
  async dismiss(
    @Param('id') id: string,
    @Body('reason') reason: TaskDismissReason,
    @Body('note') note?: string,
  ) {
    return this.dismissPost(id, reason, note);
  }
}
