import { Injectable } from '@nestjs/common';
import { MonitorRepository } from './monitor.repository';

// ─── Verified savings counter ───────────────────────────────────────────────
// Conservative attribution, per the brief: only what the monitored entity's
// own before/after shows, net of account trend and capped at the entity's
// own pre-change run-rate (see normalization.ts's conservativeSavingsMonthly).
// Nothing here extrapolates to account level.
//
// Only CONCLUDED monitors count. A +14d checkpoint is explicitly a
// mid-flight reading on partly-provisional data — banking it as "verified"
// would be exactly the overclaim this counter exists to avoid.

export interface ClientSavings {
  clientId: string;
  clientName: string;
  verifiedSavingsMonthly: number;
  /** Concluded monitors that produced a savings figure. */
  contributingTasks: number;
}

export interface SavingsSummary {
  /** Agency-wide total across every client. */
  agencyVerifiedSavingsMonthly: number;
  byClient: ClientSavings[];
  /**
   * Concluded monitors whose verdict claimed no savings — a bid change, a
   * diagnostic, or a change where spend simply didn't fall. Reported so the
   * total is never mistaken for "all concluded monitors saved money".
   */
  concludedWithoutSavings: number;
  /**
   * True when nothing has concluded yet. Distinguishes "no monitor has
   * finished its 30-day window" from "we measured and the answer is $0" —
   * the Today card renders these differently.
   */
  noConcludedMonitors: boolean;
}

@Injectable()
export class SavingsService {
  constructor(private readonly monitors: MonitorRepository) {}

  async getSummary(): Promise<SavingsSummary> {
    const rows = await this.monitors.listConcludedForSavings();

    const byClientMap = new Map<string, ClientSavings>();
    let concludedWithoutSavings = 0;

    for (const row of rows) {
      const savings = row.verdict.verifiedSavingsMonthly;
      if (savings === null || savings <= 0) {
        concludedWithoutSavings++;
        continue;
      }
      let entry = byClientMap.get(row.clientId);
      if (!entry) {
        entry = {
          clientId: row.clientId,
          clientName: row.clientName,
          verifiedSavingsMonthly: 0,
          contributingTasks: 0,
        };
        byClientMap.set(row.clientId, entry);
      }
      entry.verifiedSavingsMonthly += savings;
      entry.contributingTasks++;
    }

    const byClient = [...byClientMap.values()].sort(
      (a, b) => b.verifiedSavingsMonthly - a.verifiedSavingsMonthly,
    );

    return {
      agencyVerifiedSavingsMonthly: byClient.reduce((s, c) => s + c.verifiedSavingsMonthly, 0),
      byClient,
      concludedWithoutSavings,
      noConcludedMonitors: rows.length === 0,
    };
  }

  /** One client's figure — what the PPC clients list renders per row. */
  async getForClient(clientId: string): Promise<{ verifiedSavingsMonthly: number; noConcludedMonitors: boolean }> {
    const summary = await this.getSummary();
    const entry = summary.byClient.find((c) => c.clientId === clientId);
    return {
      verifiedSavingsMonthly: entry?.verifiedSavingsMonthly ?? 0,
      noConcludedMonitors: summary.noConcludedMonitors,
    };
  }
}
