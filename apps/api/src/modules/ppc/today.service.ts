import { Injectable } from '@nestjs/common';
import { and, eq, gte, lt } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import { clients, taskCandidates } from '../../db/schema';
import { SavingsService } from './monitor/savings.service';
import { REGISTERED_RULES } from './rules/rules.registry';
import type { RuleDefinition } from './rules/types';

// Same convention apps/web/app/dashboard/_lib/theme.ts's healthTokens uses —
// not redefined here, just the same four string values, so the frontend can
// index straight into its existing healthTokens[guardColor] with no new
// mapping logic. D-band candidates are 'act_now' (red); G-band guards are
// 'watch' (amber) — though the frontend's RuleChip actually overrides G-rule
// chip color to the distinct yellow "pending" family regardless of this
// value, so this mainly keeps the field itself semantically honest.
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
    // Real: agency-wide verified savings from concluded monitors (see
    // monitor/savings.service.ts). $/month, conservative — only what each
    // monitored entity's own before/after showed, net of account trend.
    // Stays null ONLY while no monitor has concluded its 30-day window yet,
    // which is a different statement from "$0 saved" and renders
    // differently; verifiedSavingsPending distinguishes the two.
    verifiedSavings: number | null;
    verifiedSavingsPending: boolean;
    // STAND-IN: the task layer (dedup/scoring/enqueue) doesn't exist yet —
    // this is a raw task_candidates count, not deduplicated tasks.
    openTasksCount: number;
    // Needs task-level impact scoring (task layer) — explicitly unavailable.
    dollarsAtStake: null;
    // Real: count of D-band candidates emitted for evaluationDate. G-band
    // guards are NOT counted here — they're ongoing protective state, not
    // one-off "something broke today" alerts — but they DO appear in the
    // exceptions list below, alongside D-candidates, with a distinct color.
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
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly savings: SavingsService,
  ) {}

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
    let dBandCount = 0;
    for (const row of rows) {
      const rule = rulesById.get(row.ruleId);
      // The Today screen shows D-band exceptions and G-band guards together
      // (guards use a distinct chip color on the frontend) — everything else
      // (W/S/M/I bands, once they exist) belongs on the weekly queue instead.
      if (!rule || (rule.band !== 'D' && rule.band !== 'G')) continue;
      if (rule.band === 'D') dBandCount++;

      const evidence = row.evidence as Record<string, unknown>;
      exceptions.push({
        ruleId: rule.id,
        ruleLabel: rule.label,
        clientId: row.clientId,
        clientName: row.clientName,
        description: rule.describe(evidence),
        evidence,
        guardColor: rule.band === 'G' ? 'watch' : 'act_now',
      });
    }

    // Agency-wide unless the caller scoped to one client, matching how the
    // rest of this response already respects clientIdFilter.
    const savings = clientIdFilter
      ? await this.savings.getForClient(clientIdFilter)
      : await (async () => {
          const s = await this.savings.getSummary();
          return { verifiedSavingsMonthly: s.agencyVerifiedSavingsMonthly, noConcludedMonitors: s.noConcludedMonitors };
        })();

    return {
      evaluationDate,
      statCards: {
        verifiedSavings: savings.noConcludedMonitors ? null : savings.verifiedSavingsMonthly,
        verifiedSavingsPending: savings.noConcludedMonitors,
        openTasksCount: rows.length,
        dollarsAtStake: null,
        exceptionsToday: dBandCount,
      },
      exceptions,
    };
  }
}
