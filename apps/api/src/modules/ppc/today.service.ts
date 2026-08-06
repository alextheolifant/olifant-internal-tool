import { Injectable } from '@nestjs/common';
import { and, eq, gte, lt } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { clients, taskCandidates } from '../../db/schema';
import { REGISTERED_RULES } from './rules/rules.registry';
import type { RuleDefinition } from './rules/types';

// Same convention apps/web/app/dashboard/_lib/theme.ts's healthTokens uses —
// not redefined here, just the same four string values, so the frontend can
// index straight into its existing healthTokens[guardColor] with no new
// mapping logic. D-band candidates are always 'act_now' today; the other
// values exist for when W/S-band rules are registered.
export type GuardColor = 'on_target' | 'watch' | 'act_now' | 'unknown';

export interface TodayException {
  ruleId: string;
  ruleLabel: string;
  clientId: string;
  clientName: string;
  description: string;
  evidence: Record<string, unknown>;
  guardColor: GuardColor;
}

export interface TodayResponse {
  evaluationDate: string;
  statCards: {
    // Ledger/Monitor doesn't exist yet — explicitly unavailable, never 0.
    verifiedSavings: null;
    // STAND-IN: the task layer (dedup/scoring/enqueue) doesn't exist yet —
    // this is a raw task_candidates count, not deduplicated tasks.
    openTasksCount: number;
    // Needs task-level impact scoring (task layer) — explicitly unavailable.
    dollarsAtStake: null;
    // Real: count of D-band candidates emitted for evaluationDate.
    exceptionsToday: number;
  };
  exceptions: TodayException[];
}

function ruleBandById(): Map<string, RuleDefinition> {
  return new Map(REGISTERED_RULES.map((r) => [r.id, r]));
}

function dayBoundsUTC(evaluationDate: string): { start: Date; end: Date } {
  const start = new Date(`${evaluationDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

@Injectable()
export class TodayService {
  constructor(private readonly drizzle: DrizzleService) {}

  async getToday(evaluationDate: string, clientIdFilter?: string): Promise<TodayResponse> {
    const { start, end } = dayBoundsUTC(evaluationDate);
    const rulesById = ruleBandById();

    const conditions = [gte(taskCandidates.evaluatedAt, start), lt(taskCandidates.evaluatedAt, end)];
    if (clientIdFilter) conditions.push(eq(taskCandidates.clientId, clientIdFilter));

    const rows = await this.drizzle.db
      .select({
        ruleId: taskCandidates.ruleId,
        clientId: taskCandidates.clientId,
        clientName: clients.name,
        evidence: taskCandidates.evidence,
      })
      .from(taskCandidates)
      .innerJoin(clients, eq(clients.id, taskCandidates.clientId))
      .where(and(...conditions));

    const exceptions: TodayException[] = [];
    for (const row of rows) {
      const rule = rulesById.get(row.ruleId);
      if (!rule || rule.band !== 'D') continue; // Today's "exceptions" are D-band only, per spec

      const evidence = row.evidence as Record<string, unknown>;
      exceptions.push({
        ruleId: rule.id,
        ruleLabel: rule.label,
        clientId: row.clientId,
        clientName: row.clientName,
        description: rule.describe(evidence),
        evidence,
        guardColor: 'act_now',
      });
    }

    return {
      evaluationDate,
      statCards: {
        verifiedSavings: null,
        openTasksCount: rows.length,
        dollarsAtStake: null,
        exceptionsToday: exceptions.length,
      },
      exceptions,
    };
  }
}
