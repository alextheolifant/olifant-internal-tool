import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { ppcClientConfigs } from '../../../db/schema';
import { RULE_THRESHOLD_DEFAULTS, makeThresholdResolver } from '../rules/thresholds';
import { computeActionFingerprint } from '../tasks/action-fingerprint';
import { TaskIdRepository } from '../tasks/task-id.repository';
import { TaskRepository } from '../tasks/task.repository';
import type { TaskAction, TaskEvidence, TaskType } from '../tasks/task.types';
import { MonitorFactsRepository } from './monitor-facts.repository';
import { MonitorRepository, type TaskMonitorRow, type TaskRow } from './monitor.repository';
import type { MonitorVerdict, ProvisionalInfo, VerdictStage, WindowMetrics } from './monitor.types';
import { aggregateOverDates, computeNormalizedComparison, datesIn, normalizedPctChange } from './normalization';
import { buildVerdictBody } from './verdict';

// Monitoring window, straight from the brief: execution date −14d through
// +30d, with a checkpoint verdict at +14d.
const BASELINE_DAYS = 14;
const CHECKPOINT_DAY = 14;
const FINAL_DAY = 30;

// Amazon restates attribution for roughly 14 days after the fact date, so
// anything inside that age is provisional and must be labelled — the UI
// needs to be able to say "these numbers may still move".
const RESTATEMENT_DAYS = 14;

// Synthetic rule id for monitor-raised review tasks. Deliberately NOT added
// to REGISTERED_RULES: these are created directly by the monitor, not
// emitted as candidates by the rule runner, so they must not be swept by
// expireClearedTasks (which walks registered rules against
// rule_condition_state a monitor task would never have).
const REVIEW_RULE_ID = 'MON1';

export interface MonitorRunSummary {
  opened: number;
  checkpointsWritten: number;
  concluded: number;
  reviewTasksRaised: number;
  skippedNoData: number;
}

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly monitors: MonitorRepository,
    private readonly facts: MonitorFactsRepository,
    private readonly taskRepo: TaskRepository,
    private readonly taskIds: TaskIdRepository,
  ) {}

  /**
   * Part 1: every executed task opens a monitoring window. Idempotent —
   * safe to run on every daily pass.
   */
  async openForExecutedTasks(): Promise<number> {
    const tasks = await this.monitors.findExecutedTasksWithoutMonitor();
    let opened = 0;

    for (const task of tasks) {
      const action = task.action as TaskAction;
      const campaignId = action.campaignId || task.entityId;
      const executionDate = (task.executedAt ?? task.createdAt).toISOString().slice(0, 10);

      const row = await this.monitors.openIfAbsent({
        taskId: task.id,
        entityType: task.entityType,
        entityId: task.entityId,
        campaignId,
        executionDate,
      });
      if (row) {
        opened++;
        this.logger.log(`opened monitor for ${task.id} (${task.entityType} ${task.entityId}, exec ${executionDate})`);
      }
    }
    return opened;
  }

  /**
   * The daily pass: open monitors for newly executed tasks, then advance
   * every watching monitor — writing a +14d checkpoint, concluding at +30d,
   * and raising review tasks for any auto-flag that fires meanwhile.
   *
   * `asOf` is injectable rather than read from the clock so runs are
   * replayable, same determinism convention as RuleRunnerService.runForDate.
   */
  async runDailyPass(asOf: string): Promise<MonitorRunSummary> {
    const summary: MonitorRunSummary = {
      opened: await this.openForExecutedTasks(),
      checkpointsWritten: 0,
      concluded: 0,
      reviewTasksRaised: 0,
      skippedNoData: 0,
    };

    const watching = await this.monitors.findWatching();
    for (const monitor of watching) {
      const ageDays = daysBetween(monitor.executionDate, asOf);

      // Which slot (if any) this pass should write.
      let stage: VerdictStage | null = null;
      if (ageDays >= FINAL_DAY) stage = 'verdict_30d';
      else if (ageDays >= CHECKPOINT_DAY && monitor.checkpoint14d === null) stage = 'checkpoint_14d';

      // Auto-flags are evaluated on every pass while watching, not only at
      // the two verdict milestones — the whole point is catching a bad
      // change early enough for rollback to still matter.
      const verdict = await this.computeVerdict(monitor, stage ?? 'checkpoint_14d', asOf);
      if (!verdict) {
        summary.skippedNoData++;
        continue;
      }

      if (verdict.flags.length > 0) {
        const raised = await this.raiseReviewTask(monitor, verdict);
        if (raised) summary.reviewTasksRaised++;
      }

      if (stage === 'verdict_30d') {
        await this.monitors.conclude(monitor.id, verdict);
        summary.concluded++;
      } else if (stage === 'checkpoint_14d') {
        await this.monitors.saveCheckpoint(monitor.id, verdict);
        summary.checkpointsWritten++;
      }
    }

    this.logger.log(`runDailyPass(${asOf}): ${JSON.stringify(summary)} (${watching.length} watching)`);
    return summary;
  }

  /**
   * Computes a verdict without persisting it — used by the daily pass and
   * directly by the controller for inspection. Returns null when there is
   * no post-execution fact data at all to judge by.
   */
  async computeVerdict(monitor: TaskMonitorRow, stage: VerdictStage, asOf: string): Promise<MonitorVerdict | null> {
    const task = await this.monitors.getTask(monitor.taskId);
    if (!task) return null;

    const action = task.action as TaskAction;
    const clientId = task.clientId;

    const baselineStart = addDays(monitor.executionDate, -BASELINE_DAYS);
    const baselineEnd = addDays(monitor.executionDate, -1);
    const postStart = monitor.executionDate;

    // The nominal post window is +14d or +30d, but it must be clipped to the
    // freshest fact date that actually exists. Dividing by the nominal span
    // when only 3 days of data have landed would understate every run-rate
    // by 10x — the verdict would report a change that didn't happen.
    const latestFactDate = await this.facts.getLatestFactDate();
    const nominalEnd = addDays(monitor.executionDate, stage === 'verdict_30d' ? FINAL_DAY : CHECKPOINT_DAY);
    const cappedByToday = minDate(nominalEnd, asOf);
    const postEnd = latestFactDate ? minDate(cappedByToday, latestFactDate) : cappedByToday;

    if (postEnd < postStart) return null; // no elapsed, in-data days since execution

    // ── Facts: entity level, campaign level, account level ────────────────
    const [entityPreRows, entityPostRows] = await Promise.all([
      this.facts.getEntityFacts(clientId, monitor.entityType, monitor.entityId, monitor.campaignId, baselineStart, baselineEnd),
      this.facts.getEntityFacts(clientId, monitor.entityType, monitor.entityId, monitor.campaignId, postStart, postEnd),
    ]);
    const [campaignPreRows, campaignPostRows] = await Promise.all([
      this.facts.getCampaignFacts(clientId, monitor.campaignId, baselineStart, baselineEnd),
      this.facts.getCampaignFacts(clientId, monitor.campaignId, postStart, postEnd),
    ]);
    const [accountPreRows, accountPostRows] = await Promise.all([
      this.facts.getAccountFacts(clientId, baselineStart, baselineEnd),
      this.facts.getAccountFacts(clientId, postStart, postEnd),
    ]);

    // Effective support: the dates the ACCOUNT actually has data for in each
    // window. Everything on both sides of the difference-in-differences is
    // aggregated over exactly these dates, so a sync gap can't masquerade as
    // an account-wide spend collapse — see aggregateOverDates.
    const preDates = datesIn(accountPreRows);
    const postDates = datesIn(accountPostRows);

    const campaignPre = aggregateOverDates(campaignPreRows, preDates);
    const campaignPost = aggregateOverDates(campaignPostRows, postDates);
    const accountPre = aggregateOverDates(accountPreRows, preDates);
    const accountPost = aggregateOverDates(accountPostRows, postDates);

    const entityPre: WindowMetrics | null = entityPreRows ? aggregateOverDates(entityPreRows, preDates) : null;
    const entityPost: WindowMetrics | null = entityPostRows ? aggregateOverDates(entityPostRows, postDates) : null;

    // ── Normalization (difference-in-differences) ─────────────────────────
    const resolve = await this.thresholdResolver(clientId);
    const baselineThresholds = {
      minBaselineSpend: resolve('monitor_min_baseline_spend', RULE_THRESHOLD_DEFAULTS.monitor_min_baseline_spend),
      minBaselineDays: resolve('monitor_min_baseline_days', RULE_THRESHOLD_DEFAULTS.monitor_min_baseline_days),
      maxBaselineCv: resolve('monitor_max_baseline_cv', RULE_THRESHOLD_DEFAULTS.monitor_max_baseline_cv),
    };
    const accountDailySpends = accountPreRows.map((r) => r.spend);

    const spendComparison =
      entityPre && entityPost
        ? computeNormalizedComparison(entityPre, entityPost, accountPre, accountPost, accountDailySpends, baselineThresholds)
        : null;

    const acos = normalizedPctChange(campaignPre.acos, campaignPost.acos, accountPre.acos, accountPost.acos);

    // ── Verdict body (per task type) ──────────────────────────────────────
    const body = buildVerdictBody({
      taskType: task.type as TaskType,
      actionField: action.field ?? null,
      entityLabel: entityLabelFor(monitor.entityType, action),
      entityPre,
      entityPost,
      campaignPre,
      campaignPost,
      spendComparison,
      campaignAcosNormalizedPct: acos.normalizedPct,
      campaignAcosRawPct: acos.rawPct,
      flagThresholds: {
        acosDeteriorationPct: resolve(
          'monitor_flag_acos_deterioration_pct',
          RULE_THRESHOLD_DEFAULTS.monitor_flag_acos_deterioration_pct,
        ),
        impressionDropPct: resolve(
          'monitor_flag_impression_drop_pct',
          RULE_THRESHOLD_DEFAULTS.monitor_flag_impression_drop_pct,
        ),
      },
    });

    return {
      stage,
      computedAt: new Date().toISOString(),
      taskType: task.type,
      executionDate: monitor.executionDate,
      window: { baselineStart, baselineEnd, postStart, postEnd },
      entity:
        entityPre && entityPost
          ? { level: 'entity', entityType: monitor.entityType, entityId: monitor.entityId, pre: entityPre, post: entityPost }
          : null,
      campaign: { level: 'campaign', campaignId: monitor.campaignId, pre: campaignPre, post: campaignPost },
      spendComparison,
      campaignAcos: {
        pre: campaignPre.acos,
        post: campaignPost.acos,
        deltaPct: acos.rawPct,
        normalizedDeltaPct: acos.normalizedPct,
      },
      verifiedSavingsMonthly: body.verifiedSavingsMonthly,
      flags: body.flags,
      provisional: buildProvisionalInfo(postStart, postEnd, asOf, latestFactDate),
      summary: body.summary,
      notMeasurable: body.notMeasurable,
    };
  }

  /**
   * Part 4: an auto-flag raises a review task linking back to the original
   * change, with the original's rollback text pre-loaded so rollback is a
   * decision rather than an investigation.
   *
   * Deduplicated on (client, MON1, fingerprint) via the existing open-task
   * fingerprint lookup — a flag that keeps firing on every daily pass
   * updates nothing and creates nothing extra while a review is still open.
   */
  private async raiseReviewTask(monitor: TaskMonitorRow, verdict: MonitorVerdict): Promise<boolean> {
    const original = await this.monitors.getTask(monitor.taskId);
    if (!original) return false;

    const fingerprint = computeActionFingerprint({
      ruleId: REVIEW_RULE_ID,
      entityType: monitor.entityType,
      entityId: monitor.entityId,
      type: 'investigate',
      oldValue: null,
    });
    const existing = await this.taskRepo.findOpenByFingerprint(original.clientId, REVIEW_RULE_ID, fingerprint);
    if (existing) return false;

    const originalAction = original.action as TaskAction;
    const flagLines = verdict.flags.map((f) => f.detail);

    const action: TaskAction = {
      entityType: monitor.entityType,
      campaignId: monitor.campaignId,
      campaignName: originalAction.campaignName,
      adGroupId: originalAction.adGroupId,
      // A review proposes a decision ("roll back or accept"), not a specific
      // new value — the rollback text carries the concrete instruction.
      oldValue: null,
      newValue: null,
      field: null,
    };

    const evidence: TaskEvidence = {
      metrics: {
        originalTaskId: original.id,
        originalTaskTitle: original.title,
        monitorId: monitor.id,
        verdictStage: verdict.stage,
        executionDate: monitor.executionDate,
        flags: verdict.flags,
        summary: verdict.summary,
        provisional: verdict.provisional,
      },
      window: { start: verdict.window.postStart, end: verdict.window.postEnd },
      // A monitor-raised review task isn't sourced from a sync report — its
      // evidence is the monitor's own verdict, so there's no fact table to
      // resolve and no report job to cite.
      provenance: { reportJobId: null, syncedAt: null, syncType: null },
      fallbacks: {},
    };

    const dateKey = new Date().toISOString().slice(0, 10);
    const id = await this.taskIds.nextId(dateKey);

    await this.taskRepo.create({
      id,
      clientId: original.clientId,
      profile: original.profile,
      ruleId: REVIEW_RULE_ID,
      band: 'D', // a possibly-harmful live change — same urgency tier as a D exception
      entityType: monitor.entityType,
      entityId: monitor.entityId,
      type: 'investigate',
      title: `Post-change review — "${originalAction.campaignName ?? monitor.entityId}" flagged after ${original.id}`,
      action,
      evidence,
      instructions: [
        `This reviews the change made by ${original.id}: ${original.title}`,
        ...flagLines,
        `Verdict so far: ${verdict.summary}`,
        `To roll back: ${original.rollback}`,
        `If the change is working as intended despite the flag, dismiss this task with a reason.`,
      ],
      impactMonthlyUsd: null,
      impactBasis: null,
      // Above D5's typical band but not pinned to a fake dollar impact — a
      // flagged live change outranks a routine diagnostic by construction.
      priorityScore: 80,
      confidence: 'high',
      // THE pre-loaded rollback the brief asks for: carried verbatim from
      // the original task rather than re-derived.
      rollback: original.rollback,
      actionFingerprint: fingerprint,
    });

    this.logger.warn(`raised review task ${id} for ${original.id}: ${flagLines.join(' | ')}`);
    return true;
  }

  private async thresholdResolver(clientId: string): Promise<(key: string, systemDefault: number) => number> {
    const config = await this.drizzle.db.query.ppcClientConfigs.findFirst({
      where: eq(ppcClientConfigs.clientId, clientId),
      columns: { thresholdOverrides: true },
    });
    return makeThresholdResolver((config?.thresholdOverrides as Record<string, number> | null) ?? null);
  }
}

function entityLabelFor(entityType: string, action: TaskAction): string {
  if (entityType === 'campaign') return `Campaign "${action.campaignName ?? action.campaignId}"`;
  if (entityType === 'search_term') return 'Term';
  if (entityType === 'keyword') return 'Keyword';
  if (entityType === 'product_target') return 'Target';
  return entityType;
}

function buildProvisionalInfo(
  postStart: string,
  postEnd: string,
  asOf: string,
  latestFactDate: string | null,
): ProvisionalInfo {
  const provisionalFromDate = addDays(asOf, -RESTATEMENT_DAYS);
  // Days of the post window that fall inside the restatement age.
  const firstProvisional = maxDate(postStart, provisionalFromDate);
  const provisionalDays = postEnd >= firstProvisional ? daysBetween(firstProvisional, postEnd) + 1 : 0;
  return {
    hasProvisionalData: provisionalDays > 0,
    provisionalDays,
    provisionalFromDate,
    latestFactDate,
  };
}

// ── Date helpers (UTC, ISO yyyy-mm-dd — same convention as campaign-window.ts)
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00.000Z`).getTime();
  const b = new Date(`${toIso}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}
