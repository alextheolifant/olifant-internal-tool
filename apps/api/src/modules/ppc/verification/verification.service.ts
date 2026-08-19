import { Injectable, Logger } from '@nestjs/common';
import {
  EntityDiffService,
  flattenJSON,
  valuesMatch,
} from '../entity-diff/entity-diff.service';
import { LedgerService } from '../ledger/ledger.service';
import { TaskRepository, type TaskRow } from '../tasks/task.repository';
import type { TaskAction, TaskVerifyMismatchReason } from '../tasks/task.types';
import { SlackNotifierService } from './slack-notifier.service';

export interface VerificationSummary {
  checked: number; // executed tasks with a field-level change, actually evaluated
  verified: number;
  verifyFailed: number;
  pendingFreshData: number; // left as 'executed' — no fresh-enough snapshot to judge by
  skippedNoField: number; // executed tasks with nothing to verify (diagnostic actions)
}

// ─── Execution verification ─────────────────────────────────────────────────
// Runs on the next daily sync (per the brief) — this is the callable unit;
// the actual daily trigger is out of scope here, same convention as
// RuleRunnerService.runForDate and TaskPromotionService.
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly diff: EntityDiffService,
    private readonly ledger: LedgerService,
    private readonly slack: SlackNotifierService,
  ) {}

  async verifyExecutedTasks(): Promise<VerificationSummary> {
    const summary: VerificationSummary = {
      checked: 0,
      verified: 0,
      verifyFailed: 0,
      pendingFreshData: 0,
      skippedNoField: 0,
    };

    const executed = await this.taskRepo.findExecuted();

    for (const task of executed) {
      const action = task.action as TaskAction;
      if (!action.field) {
        summary.skippedNoField++;
        continue; // diagnostic task — no field-level change was ever proposed, nothing to verify
      }

      const latest = await this.diff.getLatestSnapshot(
        task.entityType,
        task.entityId,
      );
      if (!latest) {
        // Never captured by a snapshot at all — could be brand new (e.g. a
        // harvest_launch's new keyword) whose account just hasn't had its
        // next snapshot batch run yet. Not evidence of anything; wait.
        summary.pendingFreshData++;
        continue;
      }

      if (await this.diff.isSnapshotStale(latest.accountId)) {
        // Per the brief: a stale snapshot must never produce a false
        // verify_failed. Leave the task exactly as it is.
        summary.pendingFreshData++;
        continue;
      }

      const accountLatestDate = await this.diff.getLatestSnapshotDate(
        latest.accountId,
        task.entityType,
      );
      const entityStillExists =
        accountLatestDate !== null && latest.snapshotDate === accountLatestDate;

      if (!entityStillExists) {
        await this.taskRepo.setVerifyFailed(task.id, 'entity_deleted');
        await this.notifyMismatch(task, 'entity_deleted', undefined);
        summary.verifyFailed++;
        continue;
      }

      summary.checked++;

      const currentValue = flattenJSON(latest.state)[action.field];
      const confirmed = task.confirmedValue;

      if (valuesMatch(confirmed, currentValue)) {
        await this.taskRepo.setVerified(task.id);
        // Idempotent — a no-op if recordEngineChange already ran when the
        // task was confirmed executed (it should have). Called again here
        // as the second of the two triggers the brief names ("every task
        // reaching executed OR verified writes an entry").
        await this.ledger.recordEngineChange(task);
        summary.verified++;
        continue;
      }

      // Mismatch — distinguish "never actually done" from "done to
      // something else," per the brief: these mean different things to
      // whoever investigates.
      const reason: TaskVerifyMismatchReason = valuesMatch(
        action.oldValue,
        currentValue,
      )
        ? 'unchanged'
        : 'different_value';
      await this.taskRepo.setVerifyFailed(task.id, reason);
      await this.notifyMismatch(task, reason, currentValue);
      summary.verifyFailed++;
    }

    this.logger.log(
      `verifyExecutedTasks: ${JSON.stringify(summary)} (${executed.length} executed tasks seen)`,
    );
    return summary;
  }

  private async notifyMismatch(
    task: TaskRow,
    reason: TaskVerifyMismatchReason,
    currentValue: unknown,
  ): Promise<void> {
    const action = task.action as TaskAction;
    const label =
      reason === 'unchanged'
        ? `still shows the old value (${action.oldValue ?? 'unknown'}) — the change was never actually made`
        : reason === 'entity_deleted'
          ? `entity no longer appears in the latest sync — deleted or archived`
          : `now shows ${currentValue === undefined ? 'an unknown value' : String(currentValue)}, not the confirmed ${task.confirmedValue}`;

    await this.slack.send(
      `⚠️ Verification failed for ${task.id} (${task.ruleId}) — "${action.campaignName ?? task.entityId}" ` +
        `${action.field}: ${label}.`,
    );
  }
}
