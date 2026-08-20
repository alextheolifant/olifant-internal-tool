import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import {
  ppcClientConfigs,
  ruleConditionState,
  taskCandidates,
} from '../../../db/schema';
import { REGISTERED_RULES } from '../rules/rules.registry';
import { computeActionFingerprint } from './action-fingerprint';
import { buildEvidence, EvidenceProvenanceResolver } from './evidence';
import { renderInstructions } from './instruction-templates';
import { computePriorityScore, estMinutesFor } from './priority';
import { mapCandidateToTaskContent } from './rule-task-mapping';
import { TaskIdRepository } from './task-id.repository';
import { TaskRepository } from './task.repository';

export interface PromotionSummary {
  created: number;
  updated: number;
  skipped: number; // candidates whose rule has no registered task-content mapping yet
}

export interface ExpirySummary {
  expiredOnClear: number;
  expiredOnCeiling: number;
}

const HARD_CEILING_DAYS = 45;

const RULE_BAND_BY_ID: Record<string, string> = Object.fromEntries(
  REGISTERED_RULES.map((r) => [r.id, r.band]),
);

@Injectable()
export class TaskPromotionService {
  private readonly logger = new Logger(TaskPromotionService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly taskIds: TaskIdRepository,
    private readonly taskRepo: TaskRepository,
    private readonly provenance: EvidenceProvenanceResolver,
  ) {}

  // Converts every not-yet-promoted task_candidates row into a real task
  // (create, or dedup-update an existing open one), then stamps promotedAt.
  // Idempotent to run repeatedly — already-promoted candidates are never
  // revisited, and a fully-processed batch is a no-op on the next call.
  async promoteNewCandidates(): Promise<PromotionSummary> {
    const summary: PromotionSummary = { created: 0, updated: 0, skipped: 0 };

    const pending = await this.drizzle.db.query.taskCandidates.findMany({
      where: isNull(taskCandidates.promotedAt),
      orderBy: (t, { asc }) => [asc(t.evaluatedAt)],
    });

    for (const candidate of pending) {
      const band = RULE_BAND_BY_ID[candidate.ruleId];
      if (!band) {
        this.logger.warn(
          `candidate ${candidate.id}: no registered rule for ${candidate.ruleId} — skipping`,
        );
        summary.skipped += 1;
        continue;
      }

      let content;
      try {
        content = mapCandidateToTaskContent(
          candidate.ruleId,
          candidate.entityId,
          candidate.evidence as Record<string, unknown>,
        );
      } catch (err) {
        this.logger.warn(
          `candidate ${candidate.id}: ${(err as Error).message} — skipping`,
        );
        summary.skipped += 1;
        continue;
      }

      const fingerprint = computeActionFingerprint({
        ruleId: candidate.ruleId,
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        type: content.type,
        oldValue: content.action.oldValue,
      });

      const { provenance, profile } = await this.provenance.resolveForEntity(
        candidate.clientId,
        candidate.entityType,
        candidate.entityId,
      );
      const evidence = buildEvidence(
        candidate.evidence as Record<string, unknown>,
        provenance,
      );

      const clientMultiplier = await this.resolveClientMultiplier(
        candidate.clientId,
      );
      const estMinutes = estMinutesFor(candidate.ruleId, content.type);
      const priorityScore = computePriorityScore({
        impactMonthlyUsd: content.impactMonthlyUsd,
        estMinutes,
        confidence: content.confidence,
        clientMultiplier,
      });

      const instructions = renderInstructions(candidate.ruleId, content.type, {
        action: content.action,
        evidence: candidate.evidence as Record<string, unknown>,
      });

      const existing = await this.taskRepo.findOpenByFingerprint(
        candidate.clientId,
        candidate.ruleId,
        fingerprint,
      );

      if (existing) {
        await this.taskRepo.updateEvidence(existing.id, {
          evidence,
          instructions,
          impactMonthlyUsd: content.impactMonthlyUsd,
          impactBasis: content.impactBasis,
          priorityScore,
          confidence: content.confidence,
          title: content.title,
        });
        summary.updated += 1;
      } else {
        const dateKey = candidate.evaluatedAt.toISOString().slice(0, 10);
        const id = await this.taskIds.nextId(dateKey);
        await this.taskRepo.create({
          id,
          clientId: candidate.clientId,
          profile,
          ruleId: candidate.ruleId,
          band,
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          type: content.type,
          title: content.title,
          action: content.action,
          evidence,
          instructions,
          impactMonthlyUsd: content.impactMonthlyUsd,
          impactBasis: content.impactBasis,
          priorityScore,
          confidence: content.confidence,
          rollback: content.rollback,
          actionFingerprint: fingerprint,
        });
        summary.created += 1;
      }

      await this.drizzle.db
        .update(taskCandidates)
        .set({ promotedAt: new Date() })
        .where(eq(taskCandidates.id, candidate.id));
    }

    this.logger.log(
      `promoteNewCandidates: ${JSON.stringify(summary)} (${pending.length} candidates seen)`,
    );
    return summary;
  }

  // Data-based expiry: a pending/approved/blocked task expires once its
  // rule's clear condition holds for that entity — the same
  // persistence/hysteresis mechanism the rule runner already maintains in
  // rule_condition_state (isActive flips false once an entity clears).
  // Reads current state directly rather than trying to correlate against a
  // specific evaluation run, so this is safe to call after any rule-runner
  // pass regardless of which entities it touched.
  async expireClearedTasks(): Promise<number> {
    let expired = 0;
    // Per (client, rule) via the repository, so open-status filtering lives
    // in one place — see task.repository.ts's OPEN_STATUSES scoping.
    const clients = await this.drizzle.db.query.clients.findMany({
      columns: { id: true },
    });
    for (const client of clients) {
      for (const rule of REGISTERED_RULES) {
        const open = await this.taskRepo.findOpenByClientRule(
          client.id,
          rule.id,
        );
        for (const task of open) {
          const state =
            await this.drizzle.db.query.ruleConditionState.findFirst({
              where: and(
                eq(ruleConditionState.clientId, client.id),
                eq(ruleConditionState.ruleId, rule.id),
                eq(ruleConditionState.entityType, task.entityType),
                eq(ruleConditionState.entityId, task.entityId),
              ),
            });
          // No state at all means this entity was never evaluated (e.g. the
          // client was frozen this run) — leave it alone. Only a CONFIRMED
          // clear (isActive === false) expires it.
          if (state && state.isActive === false) {
            await this.taskRepo.expire(task.id);
            expired += 1;
            this.logger.log(
              `expired ${task.id} (${rule.id}/${task.entityId}): clear condition now holds`,
            );
          }
        }
      }
    }
    return expired;
  }

  // Hard 45-day ceiling — catches anything expireClearedTasks won't (e.g. a
  // rule whose clear condition never holds because the underlying issue was
  // fixed manually outside any tracked signal).
  async expireStaleTasks(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - HARD_CEILING_DAYS * 24 * 60 * 60 * 1000,
    );
    const ids = await this.taskRepo.expireOlderThan(cutoff);
    if (ids.length > 0)
      this.logger.log(
        `expired ${ids.length} task(s) past the ${HARD_CEILING_DAYS}-day ceiling`,
      );
    return ids.length;
  }

  private async resolveClientMultiplier(clientId: string): Promise<number> {
    const config = await this.drizzle.db.query.ppcClientConfigs.findFirst({
      where: eq(ppcClientConfigs.clientId, clientId),
      columns: { priorityMultiplier: true },
    });
    if (!config?.priorityMultiplier) return 1.0;
    return Number(config.priorityMultiplier);
  }
}
