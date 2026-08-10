import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { ruleConditionState } from '../../../db/schema';
import type { PriorConditionState } from './persistence-hysteresis-guard';

@Injectable()
export class RuleStateRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async getPrior(
    clientId: string,
    ruleId: string,
    entityType: string,
    entityId: string,
  ): Promise<PriorConditionState | null> {
    const row = await this.drizzle.db.query.ruleConditionState.findFirst({
      where: and(
        eq(ruleConditionState.clientId, clientId),
        eq(ruleConditionState.ruleId, ruleId),
        eq(ruleConditionState.entityType, entityType),
        eq(ruleConditionState.entityId, entityId),
      ),
    });
    if (!row) return null;
    return { isActive: row.isActive, streakCount: row.streakCount };
  }

  async saveNext(
    clientId: string,
    ruleId: string,
    entityType: string,
    entityId: string,
    evaluationDate: string,
    next: PriorConditionState,
  ): Promise<void> {
    await this.drizzle.db
      .insert(ruleConditionState)
      .values({
        clientId,
        ruleId,
        entityType,
        entityId,
        isActive: next.isActive,
        streakCount: next.streakCount,
        lastEvaluatedDate: evaluationDate,
      })
      .onConflictDoUpdate({
        target: [
          ruleConditionState.clientId,
          ruleConditionState.ruleId,
          ruleConditionState.entityType,
          ruleConditionState.entityId,
        ],
        set: {
          isActive: next.isActive,
          streakCount: next.streakCount,
          lastEvaluatedDate: evaluationDate,
          updatedAt: new Date(),
        },
      });
  }
}
