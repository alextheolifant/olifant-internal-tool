import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { clients, ppcClientConfigs, taskCandidates } from '../../../db/schema';
import { LedgerRepository } from '../ledger/ledger.repository';
import { resolveAccountBE } from './be-resolution';
import { CampaignMetricsRepository } from './campaign-metrics.repository';
import { applyPersistenceAndHysteresis } from './persistence-hysteresis-guard';
import { REGISTERED_RULES } from './rules.registry';
import { RuleStateRepository } from './rule-state.repository';
import { makeThresholdResolver } from './thresholds';
import type { RuleEvalContext } from './types';

export interface RuleRunSummary {
  evaluationDate: string;
  clientsEvaluated: number;
  candidatesByRule: Record<string, number>;
}

@Injectable()
export class RuleRunnerService {
  private readonly logger = new Logger(RuleRunnerService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly campaignMetrics: CampaignMetricsRepository,
    private readonly ruleState: RuleStateRepository,
    private readonly ledgerRepo: LedgerRepository,
  ) {}

  // Core evaluation loop: iterate active clients -> evaluate each registered
  // rule -> apply the persistence/hysteresis guards -> persist emitted
  // candidates. Intended to run daily, after sync completes (the actual
  // daily trigger/scheduling is out of scope for this slice — this is the
  // callable unit a scheduler will invoke).
  async runForDate(evaluationDate: string): Promise<RuleRunSummary> {
    const activeClients = await this.getActiveClients();
    const candidatesByRule: Record<string, number> = {};
    for (const rule of REGISTERED_RULES) candidatesByRule[rule.id] = 0;

    for (const client of activeClients) {
      const be = resolveAccountBE(client.marginDefault);
      const resolveThreshold = makeThresholdResolver(client.thresholdOverrides);

      const ctx: RuleEvalContext = {
        clientId: client.clientId,
        evaluationDate,
        resolveThreshold,
        be,
        campaignMetrics: this.campaignMetrics,
        ledger: this.ledgerRepo,
      };

      for (const rule of REGISTERED_RULES) {
        const conditionResults = await rule.evaluate(ctx);

        for (const result of conditionResults) {
          const prior = await this.ruleState.getPrior(
            client.clientId,
            rule.id,
            result.entityType,
            result.entityId,
          );
          const decision = applyPersistenceAndHysteresis({
            band: rule.band,
            holdsAtEnter: result.holdsAtEnter,
            holdsAtClear: result.holdsAtClear,
            prior,
          });

          await this.ruleState.saveNext(
            client.clientId,
            rule.id,
            result.entityType,
            result.entityId,
            evaluationDate,
            decision.nextState,
          );

          if (decision.shouldEmit) {
            await this.drizzle.db.insert(taskCandidates).values({
              clientId: client.clientId,
              ruleId: rule.id,
              entityType: result.entityType,
              entityId: result.entityId,
              evaluatedAt: new Date(),
              evidence: result.evidence,
            });
            candidatesByRule[rule.id] += 1;
          }
        }
      }
    }

    this.logger.log(
      `runForDate(${evaluationDate}): ${activeClients.length} clients, candidates=${JSON.stringify(candidatesByRule)}`,
    );

    return { evaluationDate, clientsEvaluated: activeClients.length, candidatesByRule };
  }

  // Active = clients.status = 'active' AND ppc_client_configs.ops_status !=
  // 'frozen' (missing config row defaults to active, same convention as
  // ppc-config.service.ts). Frozen accounts are "exceptions only, no
  // optimization tasks generated" per that field's own definition.
  private async getActiveClients(): Promise<
    { clientId: string; marginDefault: number | null; thresholdOverrides: Record<string, number> | null }[]
  > {
    const rows = await this.drizzle.db
      .select({
        clientId: clients.id,
        status: clients.status,
        opsStatus: ppcClientConfigs.opsStatus,
        marginDefault: ppcClientConfigs.marginDefault,
        thresholdOverrides: ppcClientConfigs.thresholdOverrides,
      })
      .from(clients)
      .leftJoin(ppcClientConfigs, eq(ppcClientConfigs.clientId, clients.id))
      .where(eq(clients.status, 'active'));

    return rows
      .filter((r) => r.opsStatus !== 'frozen')
      .map((r) => ({
        clientId: r.clientId,
        marginDefault: r.marginDefault !== null && r.marginDefault !== undefined ? Number(r.marginDefault) : null,
        thresholdOverrides: (r.thresholdOverrides as Record<string, number> | null) ?? null,
      }));
  }
}
