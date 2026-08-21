import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { clients, ppcClientConfigs, taskCandidates } from '../../../db/schema';
import { LedgerRepository } from '../ledger/ledger.repository';
import { PpcClientsService } from '../ppc-clients.service';
import { SlackNotifierService } from '../verification/slack-notifier.service';
import { resolveAccountBE } from './be-resolution';
import { CampaignMetricsRepository } from './campaign-metrics.repository';
import { applyPersistenceAndHysteresis } from './persistence-hysteresis-guard';
import { REGISTERED_RULES } from './rules.registry';
import { RuleStateRepository } from './rule-state.repository';
import { SearchTermRepository } from './search-term.repository';
import { makeThresholdResolver } from './thresholds';
import type { RuleEvalContext } from './types';

export interface RuleRunSummary {
  evaluationDate: string;
  clientsEvaluated: number;
  // Clients skipped entirely because their synced data is stale — see the
  // freshness guard in runForDate. Not evaluated at all, not partially.
  clientsSkippedStale: number;
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
    private readonly searchTermRepo: SearchTermRepository,
    private readonly ppcClients: PpcClientsService,
    private readonly slack: SlackNotifierService,
  ) {}

  // Core evaluation loop: iterate active clients -> evaluate each registered
  // rule -> apply the persistence/hysteresis guards -> persist emitted
  // candidates. Intended to run daily, after sync completes (the actual
  // daily trigger/scheduling is out of scope for this slice — this is the
  // callable unit a scheduler will invoke).
  //
  // Cron can't express "run after the sync actually finished" — a sync that
  // runs long or fails must not silently let this evaluate stale/missing
  // data and quietly emit wrong tasks. So each client's own last-synced
  // freshness is checked first; a client whose data isn't fresh is skipped
  // entirely (not partially evaluated) and reported via Slack rather than
  // proceeding on bad data. TODO(temporal): once the sync -> rules ->
  // promote chain is a real workflow, this guard becomes unnecessary —
  // Temporal would only invoke this step once the sync step it depends on
  // has actually completed.
  async runForDate(evaluationDate: string): Promise<RuleRunSummary> {
    const activeClients = await this.getActiveClients();
    const candidatesByRule: Record<string, number> = {};
    for (const rule of REGISTERED_RULES) candidatesByRule[rule.id] = 0;

    const freshnessByClient = await this.ppcClients.getFreshnessByClient(
      activeClients.map((c) => c.clientId),
    );
    const staleClientIds: string[] = [];

    for (const client of activeClients) {
      const freshness = freshnessByClient.get(client.clientId);
      if (!freshness || freshness.level === 'act_now' || freshness.level === 'unknown') {
        staleClientIds.push(client.clientId);
        this.logger.warn(
          `runForDate(${evaluationDate}): skipping client ${client.clientId} — ` +
            `sync data is stale (level=${freshness?.level ?? 'unknown'}, lastSyncedAt=${freshness?.lastSyncedAt ?? 'never'})`,
        );
        continue;
      }

      const be = resolveAccountBE(client.marginDefault);
      const resolveThreshold = makeThresholdResolver(client.thresholdOverrides);

      const ctx: RuleEvalContext = {
        clientId: client.clientId,
        evaluationDate,
        resolveThreshold,
        be,
        campaignMetrics: this.campaignMetrics,
        ledger: this.ledgerRepo,
        searchTerms: this.searchTermRepo,
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

    const clientsEvaluated = activeClients.length - staleClientIds.length;

    this.logger.log(
      `runForDate(${evaluationDate}): ${clientsEvaluated} clients evaluated, ` +
        `${staleClientIds.length} skipped as stale, candidates=${JSON.stringify(candidatesByRule)}`,
    );

    if (staleClientIds.length > 0) {
      await this.slack.send(
        `⚠️ Rule run for ${evaluationDate} skipped ${staleClientIds.length} client(s) with stale sync data ` +
          `(no successful sync within the freshness window): ${staleClientIds.join(', ')}. ` +
          `Their tasks were not evaluated today — check the sync logs for these accounts.`,
      );
    }

    return {
      evaluationDate,
      clientsEvaluated,
      clientsSkippedStale: staleClientIds.length,
      candidatesByRule,
    };
  }

  // Active = clients.status = 'active' AND ppc_client_configs.ops_status !=
  // 'frozen' (missing config row defaults to active, same convention as
  // ppc-config.service.ts). Frozen accounts are "exceptions only, no
  // optimization tasks generated" per that field's own definition.
  private async getActiveClients(): Promise<
    {
      clientId: string;
      marginDefault: number | null;
      thresholdOverrides: Record<string, number> | null;
    }[]
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
        marginDefault:
          r.marginDefault !== null && r.marginDefault !== undefined
            ? Number(r.marginDefault)
            : null,
        thresholdOverrides:
          (r.thresholdOverrides as Record<string, number> | null) ?? null,
      }));
  }
}
