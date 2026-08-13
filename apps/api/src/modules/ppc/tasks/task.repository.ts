import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { tasks } from '../../../db/schema';
import { OPEN_STATUSES } from './task-lifecycle';
import type {
  TaskAction,
  TaskConfidence,
  TaskDismissReason,
  TaskEvidence,
  TaskStatus,
  TaskType,
  TaskVerifyMismatchReason,
} from './task.types';

export type TaskRow = typeof tasks.$inferSelect;

export interface NewTaskInput {
  id: string;
  clientId: string;
  profile: string | null;
  ruleId: string;
  band: string;
  entityType: string;
  entityId: string;
  type: TaskType;
  title: string;
  action: TaskAction;
  evidence: TaskEvidence;
  instructions: string[];
  impactMonthlyUsd: number | null;
  impactBasis: string | null;
  priorityScore: number;
  confidence: TaskConfidence;
  rollback: string;
  actionFingerprint: string;
}

@Injectable()
export class TaskRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findOpenByFingerprint(
    clientId: string,
    ruleId: string,
    actionFingerprint: string,
  ): Promise<TaskRow | undefined> {
    return this.drizzle.db.query.tasks.findFirst({
      where: and(
        eq(tasks.clientId, clientId),
        eq(tasks.ruleId, ruleId),
        eq(tasks.actionFingerprint, actionFingerprint),
        inArray(tasks.status, OPEN_STATUSES),
      ),
    });
  }

  async create(input: NewTaskInput): Promise<TaskRow> {
    const [row] = await this.drizzle.db
      .insert(tasks)
      .values({
        id: input.id,
        clientId: input.clientId,
        profile: input.profile,
        ruleId: input.ruleId,
        band: input.band,
        entityType: input.entityType,
        entityId: input.entityId,
        type: input.type,
        title: input.title,
        action: input.action,
        evidence: input.evidence,
        instructions: input.instructions,
        impactMonthlyUsd: input.impactMonthlyUsd !== null ? input.impactMonthlyUsd.toFixed(2) : null,
        impactBasis: input.impactBasis,
        priorityScore: input.priorityScore,
        confidence: input.confidence,
        rollback: input.rollback,
        actionFingerprint: input.actionFingerprint,
      })
      .returning();
    return row;
  }

  // A re-fire on an entity with an already-open task updates that task's
  // evidence/instructions/priority in place rather than creating a new row —
  // the numbers justifying the action move, the task itself doesn't multiply.
  async updateEvidence(
    id: string,
    fields: {
      evidence: TaskEvidence;
      instructions: string[];
      impactMonthlyUsd: number | null;
      impactBasis: string | null;
      priorityScore: number;
      confidence: TaskConfidence;
      title: string;
    },
  ): Promise<void> {
    await this.drizzle.db
      .update(tasks)
      .set({
        evidence: fields.evidence,
        instructions: fields.instructions,
        impactMonthlyUsd: fields.impactMonthlyUsd !== null ? fields.impactMonthlyUsd.toFixed(2) : null,
        impactBasis: fields.impactBasis,
        priorityScore: fields.priorityScore,
        confidence: fields.confidence,
        title: fields.title,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id));
  }

  async findOpenByClientRule(clientId: string, ruleId: string): Promise<TaskRow[]> {
    return this.drizzle.db.query.tasks.findMany({
      where: and(eq(tasks.clientId, clientId), eq(tasks.ruleId, ruleId), inArray(tasks.status, OPEN_STATUSES)),
    });
  }

  async findById(id: string): Promise<TaskRow | undefined> {
    return this.drizzle.db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  }

  async setStatus(id: string, status: TaskStatus, extra: { executedAt?: Date } = {}): Promise<void> {
    await this.drizzle.db
      .update(tasks)
      .set({ status, updatedAt: new Date(), ...(extra.executedAt ? { executedAt: extra.executedAt } : {}) })
      .where(eq(tasks.id, id));
  }

  // Marking executed requires confirming the value (§8.3) — this is the only
  // path that may set status='executed', separate from the generic setStatus
  // above (see tasks.controller.ts, which rejects 'executed' through the
  // generic PATCH). confirmedValue is what the executor actually entered,
  // which may differ from action.newValue; null when the action has nothing
  // to confirm (action.field null — investigate-type tasks).
  async confirmExecution(id: string, confirmedValue: string | null): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .update(tasks)
      .set({ status: 'executed', executedAt: now, updatedAt: now, confirmedValue })
      .where(eq(tasks.id, id));
  }

  async setVerified(id: string): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .update(tasks)
      .set({ status: 'verified', verifiedAt: now, updatedAt: now })
      .where(eq(tasks.id, id));
  }

  async setVerifyFailed(id: string, reason: TaskVerifyMismatchReason): Promise<void> {
    const now = new Date();
    await this.drizzle.db
      .update(tasks)
      .set({ status: 'verify_failed', verifiedAt: now, verifyMismatchReason: reason, updatedAt: now })
      .where(eq(tasks.id, id));
  }

  // Every task currently awaiting verification. Filtering to only the ones
  // with a field-level change (action.field non-null) happens in
  // verification.service.ts rather than here — expected volume is low
  // enough (executed tasks, not all tasks) that an in-memory filter over a
  // jsonb column beats a raw ->> query for a set this small, and keeps the
  // "what counts as verifiable" decision next to the rest of the
  // verification logic instead of split across two files.
  async findExecuted(): Promise<TaskRow[]> {
    return this.drizzle.db.query.tasks.findMany({ where: eq(tasks.status, 'executed') });
  }

  async dismiss(id: string, reason: TaskDismissReason, note: string | null): Promise<void> {
    await this.drizzle.db
      .update(tasks)
      .set({ status: 'dismissed', dismissReason: reason, dismissNote: note, updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }

  async expire(id: string): Promise<void> {
    await this.drizzle.db.update(tasks).set({ status: 'expired', updatedAt: new Date() }).where(eq(tasks.id, id));
  }

  // Hard 45-day ceiling — anything still open past this gets expired
  // regardless of what its rule's condition state says. Returns the ids
  // expired, for logging.
  async expireOlderThan(cutoff: Date): Promise<string[]> {
    const rows = await this.drizzle.db
      .update(tasks)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(inArray(tasks.status, OPEN_STATUSES), lt(tasks.createdAt, cutoff)))
      .returning({ id: tasks.id });
    return rows.map((r) => r.id);
  }

  // Sorted for display: D-band above every other band regardless of score
  // (sql CASE, not a stored numeric tier — one fewer thing to keep in sync
  // with the band column), then by score descending within a tier.
  async listSorted(clientId?: string): Promise<TaskRow[]> {
    const bandTier = sql<number>`case when ${tasks.band} = 'D' then 0 else 1 end`;
    return this.drizzle.db
      .select()
      .from(tasks)
      .where(clientId ? and(eq(tasks.clientId, clientId), inArray(tasks.status, OPEN_STATUSES)) : inArray(tasks.status, OPEN_STATUSES))
      .orderBy(asc(bandTier), desc(tasks.priorityScore));
  }
}
