import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import {
  amazonAdsAccounts,
  campaignMetricsDaily,
  campaigns,
  searchTermMetricsDaily,
  targetMetricsDaily,
} from '../../../db/schema';
import { MonitorRepository } from '../monitor/monitor.repository';
import type { MonitorVerdict } from '../monitor/monitor.types';
import { parseSearchTermEntityId } from '../rules/term-normalization';
import { expandableKeysFor, resolveMetric, type FactTable } from './fact-source';
import { estMinutesFor } from './priority';
import type {
  CrossCheckWinner,
  FactRow,
  FactsResponse,
  PerformancePoint,
  PerformanceResponse,
  QueueFilters,
  QueueResponse,
  QueueRow,
  TaskDetail,
} from './queue.types';
import { TaskRepository, type TaskRow } from './task.repository';
import type { TaskAction, TaskConfidence, TaskEvidence, TaskType } from './task.types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Amazon restates attribution for ~14 days; the monitor uses the same
// constant. Days inside it are shaded as provisional by the UI.
const RESTATEMENT_DAYS = 14;

// The monitor's own window, reused so the performance charts and the
// verdict cover exactly the same span.
const PRE_DAYS = 14;
const POST_DAYS = 30;

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly taskRepo: TaskRepository,
    private readonly monitors: MonitorRepository,
  ) {}

  // ─── Part 1 — queue list ────────────────────────────────────────────────
  async list(filters: QueueFilters): Promise<QueueResponse> {
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = filters.offset ?? 0;

    const { rows, total } = await this.taskRepo.queryQueue({
      clientId: filters.clientId,
      type: filters.type,
      status: filters.status,
      assignee: filters.assignee,
      limit,
      offset,
    });

    // Bar fraction is relative to the largest impact IN THIS RESULT SET, per
    // the brief — so the UI never has to scan the rows itself. Computed over
    // the returned page: the bar is a visual comparison between the rows the
    // user is actually looking at.
    const maxImpact = rows.reduce((m, r) => {
      const v = r.impactMonthlyUsd !== null ? Number(r.impactMonthlyUsd) : 0;
      return v > m ? v : m;
    }, 0);

    const queueRows: QueueRow[] = rows.map((r) => {
      const impact = r.impactMonthlyUsd !== null ? Number(r.impactMonthlyUsd) : null;
      return {
        id: r.id,
        title: r.title,
        clientId: r.clientId,
        clientName: r.clientName,
        ruleId: r.ruleId,
        band: r.band,
        type: r.type as TaskType,
        status: r.status,
        confidence: r.confidence as TaskConfidence,
        priorityScore: r.priorityScore,
        impactMonthlyUsd: impact,
        impactBarFraction: impact === null ? null : maxImpact > 0 ? impact / maxImpact : 0,
        estMinutes: estMinutesFor(r.ruleId, r.type as TaskType),
        blockedBy: r.blockedBy,
        assignee: r.assignee,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return { rows: queueRows, total, limit, offset };
  }

  // ─── Part 2 — drawer detail ─────────────────────────────────────────────
  async detail(id: string): Promise<TaskDetail | null> {
    const task = await this.taskRepo.findByIdWithClient(id);
    if (!task) return null;

    const action = task.action as TaskAction;
    const evidence = task.evidence as TaskEvidence;
    const syncType = evidence.provenance?.syncType ?? null;
    const factTable = resolveMetric(syncType, '__probe__').factTable;

    const monitor = await this.monitors.findByTaskId(id);
    const verdict = (monitor?.verdict30d ?? monitor?.checkpoint14d) as MonitorVerdict | null;

    return {
      id: task.id,
      ruleId: task.ruleId,
      clientId: task.clientId,
      clientName: task.clientName,
      title: task.title,
      status: task.status,
      type: task.type as TaskType,
      band: task.band,
      confidence: task.confidence as TaskConfidence,
      profile: task.profile,
      priorityScore: task.priorityScore,
      estMinutes: estMinutesFor(task.ruleId, task.type as TaskType),
      impactMonthlyUsd: task.impactMonthlyUsd !== null ? Number(task.impactMonthlyUsd) : null,
      impactBasis: task.impactBasis,
      instructions: (task.instructions as string[]) ?? [],
      // Harvest-only, and the harvest rule (W4) doesn't exist yet. Declared
      // so the drawer can build against the field now; never fabricated for
      // the types that do exist.
      decisionPath: null,
      action: {
        entityType: action.entityType,
        campaignId: action.campaignId,
        campaignName: action.campaignName,
        adGroupId: action.adGroupId,
        field: action.field ?? null,
        oldValue: action.oldValue,
        newValue: action.newValue,
      },
      evidence: {
        metrics: evidence.metrics ?? {},
        window: evidence.window ?? null,
        provenance: {
          reportJobId: evidence.provenance?.reportJobId ?? null,
          syncedAt: evidence.provenance?.syncedAt ?? null,
          syncType,
        },
        fallbacks: evidence.fallbacks ?? {},
        // Only the keys this task's evidence actually carries AND that the
        // resolved fact table can expand — so the UI marks exactly the
        // numbers that will return rows.
        expandableMetrics: expandableKeysFor(factTable).filter((k) =>
          Object.prototype.hasOwnProperty.call(evidence.metrics ?? {}, k),
        ),
        factTable,
      },
      crossCheck: buildCrossCheck(evidence.metrics ?? {}),
      rollback: task.rollback,
      dismissReason: task.dismissReason,
      dismissNote: task.dismissNote,
      blockedBy: task.blockedBy,
      assignee: task.assignee,
      confirmedValue: task.confirmedValue,
      verifyMismatchReason: task.verifyMismatchReason,
      createdAt: task.createdAt.toISOString(),
      executedAt: task.executedAt ? task.executedAt.toISOString() : null,
      verifiedAt: task.verifiedAt ? task.verifiedAt.toISOString() : null,
      monitor: monitor
        ? {
            state: monitor.state,
            executionDate: monitor.executionDate,
            hasVerdict: verdict !== null,
            verdictSummary: verdict?.summary ?? null,
          }
        : null,
    };
  }

  // ─── Part 3 — performance series ────────────────────────────────────────
  //
  // Kept as its own endpoint rather than inlined into the detail payload.
  // Reasoning: the two series span −14d…+30d, so a fully-populated task
  // returns ~88 daily points across both charts plus per-point provisional
  // flags — several times the size of the rest of the drawer payload, on
  // every drawer open, for the minority of tasks that are executed at all.
  // The detail endpoint carries the verdict headline instead, which is what
  // the drawer shows before the charts are scrolled to.
  async performance(id: string): Promise<PerformanceResponse | null> {
    const task = await this.taskRepo.findById(id);
    if (!task) return null;
    const monitor = await this.monitors.findByTaskId(id);
    if (!monitor) return null; // only meaningful once a task has been executed

    const action = task.action as TaskAction;
    const campaignId = action.campaignId || task.entityId;

    const start = addDays(monitor.executionDate, -PRE_DAYS);
    const end = addDays(monitor.executionDate, POST_DAYS);
    const accountIds = await this.accountIdsFor(task.clientId);

    const [campaignSeries, entitySeries, latestFactDate] = await Promise.all([
      this.campaignSeries(task.clientId, campaignId, start, end),
      this.entitySeries(accountIds, task.entityType, task.entityId, campaignId, start, end),
      this.latestFactDate(),
    ]);

    const provisionalFrom = addDays(todayISO(), -RESTATEMENT_DAYS);
    const verdict = (monitor.verdict30d ?? monitor.checkpoint14d) as MonitorVerdict | null;

    return {
      taskId: id,
      executionDate: monitor.executionDate,
      entitySeries: entitySeries ? markProvisional(entitySeries, provisionalFrom) : null,
      entityType: task.entityType,
      entityId: task.entityId,
      campaignSeries: markProvisional(campaignSeries, provisionalFrom),
      campaignId,
      provisionalFromDate: provisionalFrom,
      latestFactDate,
      verdict: verdict?.summary ?? null,
      verdictStage: verdict?.stage ?? null,
      verifiedSavingsMonthly: verdict?.verifiedSavingsMonthly ?? null,
    };
  }

  // ─── Part 4 — clickable evidence ────────────────────────────────────────
  //
  // Resolves the source table from the task's own provenance (see
  // fact-source.ts), never from its rule id, so a new rule reading an
  // existing sync type needs no change here.
  async facts(id: string, metric: string): Promise<FactsResponse | null> {
    const task = await this.taskRepo.findById(id);
    if (!task) return null;

    const evidence = task.evidence as TaskEvidence;
    const syncType = evidence.provenance?.syncType ?? null;
    const resolution = resolveMetric(syncType, metric);
    const window = evidence.window ?? null;

    const base: FactsResponse = {
      taskId: id,
      metric,
      expandable: resolution.expandable,
      reason: resolution.reason,
      factTable: resolution.factTable,
      column: resolution.column,
      window,
      rows: [],
      total: null,
    };

    // Derived numbers (expected_clicks_per_order, thresholds, run-rates) have
    // no stored row behind them — the UI renders them as plain text rather
    // than an interactive control that opens an empty table.
    if (!resolution.expandable || !window) return base;

    const action = task.action as TaskAction;
    const campaignId = action.campaignId || task.entityId;
    const accountIds = await this.accountIdsFor(task.clientId);

    const rows = await this.factRows(
      resolution.factTable as FactTable,
      resolution.column as string,
      { clientId: task.clientId, accountIds, entityType: task.entityType, entityId: task.entityId, campaignId },
      window.start,
      window.end,
    );

    const total = rows.reduce((s, r) => {
      const v = r[resolution.column as string];
      return s + (typeof v === 'number' ? v : Number(v ?? 0));
    }, 0);

    return { ...base, rows, total };
  }

  // ── fact access ────────────────────────────────────────────────────────

  private async factRows(
    table: FactTable,
    column: string,
    scope: { clientId: string; accountIds: string[]; entityType: string; entityId: string; campaignId: string },
    start: string,
    end: string,
  ): Promise<FactRow[]> {
    if (table === 'campaign_metrics_daily') {
      const rows = await this.drizzle.db
        .select({
          date: campaignMetricsDaily.date,
          impressions: campaignMetricsDaily.impressions,
          clicks: campaignMetricsDaily.clicks,
          spend: campaignMetricsDaily.spend,
          sales: campaignMetricsDaily.sales,
          orders: campaignMetricsDaily.orders,
          acos: campaignMetricsDaily.acos,
        })
        .from(campaignMetricsDaily)
        .innerJoin(campaigns, eq(campaigns.id, campaignMetricsDaily.campaignId))
        .innerJoin(amazonAdsAccounts, eq(amazonAdsAccounts.id, campaigns.amazonAdsAccountId))
        .where(
          and(
            eq(amazonAdsAccounts.clientId, scope.clientId),
            eq(campaigns.campaignId, scope.campaignId),
            gte(campaignMetricsDaily.date, start),
            lte(campaignMetricsDaily.date, end),
          ),
        )
        .orderBy(asc(campaignMetricsDaily.date));
      return rows.map((r) => numeric({ ...r }, column));
    }

    if (scope.accountIds.length === 0) return [];

    if (table === 'search_term_metrics_daily') {
      const parsed = parseSearchTermEntityId(scope.entityId);
      const term = parsed?.term ?? scope.entityId;
      const campaignId = parsed?.campaignId ?? scope.campaignId;
      const rows = await this.drizzle.db
        .select({
          date: searchTermMetricsDaily.date,
          impressions: searchTermMetricsDaily.impressions,
          clicks: searchTermMetricsDaily.clicks,
          cost: searchTermMetricsDaily.cost,
          sales_7d: searchTermMetricsDaily.sales7d,
          orders_7d: searchTermMetricsDaily.orders7d,
          units_7d: searchTermMetricsDaily.units7d,
        })
        .from(searchTermMetricsDaily)
        .where(
          and(
            inArray(searchTermMetricsDaily.amazonAdsAccountId, scope.accountIds),
            eq(searchTermMetricsDaily.searchTerm, term),
            eq(searchTermMetricsDaily.campaignId, campaignId),
            gte(searchTermMetricsDaily.date, start),
            lte(searchTermMetricsDaily.date, end),
          ),
        )
        .orderBy(asc(searchTermMetricsDaily.date));
      return rows.map((r) => numeric({ ...r }, column));
    }

    const rows = await this.drizzle.db
      .select({
        date: targetMetricsDaily.date,
        impressions: targetMetricsDaily.impressions,
        clicks: targetMetricsDaily.clicks,
        cost: targetMetricsDaily.cost,
        sales_7d: targetMetricsDaily.sales7d,
        orders_7d: targetMetricsDaily.orders7d,
        units_7d: targetMetricsDaily.units7d,
      })
      .from(targetMetricsDaily)
      .where(
        and(
          inArray(targetMetricsDaily.amazonAdsAccountId, scope.accountIds),
          eq(targetMetricsDaily.targetId, scope.entityId),
          gte(targetMetricsDaily.date, start),
          lte(targetMetricsDaily.date, end),
        ),
      )
      .orderBy(asc(targetMetricsDaily.date));
    return rows.map((r) => numeric({ ...r }, column));
  }

  private async campaignSeries(
    clientId: string,
    campaignId: string,
    start: string,
    end: string,
  ): Promise<PerformancePoint[]> {
    const rows = await this.drizzle.db
      .select({
        date: campaignMetricsDaily.date,
        spend: campaignMetricsDaily.spend,
        sales: campaignMetricsDaily.sales,
        clicks: campaignMetricsDaily.clicks,
        impressions: campaignMetricsDaily.impressions,
        orders: campaignMetricsDaily.orders,
      })
      .from(campaignMetricsDaily)
      .innerJoin(campaigns, eq(campaigns.id, campaignMetricsDaily.campaignId))
      .innerJoin(amazonAdsAccounts, eq(amazonAdsAccounts.id, campaigns.amazonAdsAccountId))
      .where(
        and(
          eq(amazonAdsAccounts.clientId, clientId),
          eq(campaigns.campaignId, campaignId),
          gte(campaignMetricsDaily.date, start),
          lte(campaignMetricsDaily.date, end),
        ),
      )
      .orderBy(asc(campaignMetricsDaily.date));
    return rows.map(toPoint);
  }

  private async entitySeries(
    accountIds: string[],
    entityType: string,
    entityId: string,
    campaignId: string,
    start: string,
    end: string,
  ): Promise<PerformancePoint[] | null> {
    if (entityType === 'campaign') return null; // identical to the campaign chart
    if (accountIds.length === 0) return [];

    if (entityType === 'search_term') {
      const parsed = parseSearchTermEntityId(entityId);
      const rows = await this.drizzle.db
        .select({
          date: searchTermMetricsDaily.date,
          spend: searchTermMetricsDaily.cost,
          sales: searchTermMetricsDaily.sales7d,
          clicks: searchTermMetricsDaily.clicks,
          impressions: searchTermMetricsDaily.impressions,
          orders: searchTermMetricsDaily.orders7d,
        })
        .from(searchTermMetricsDaily)
        .where(
          and(
            inArray(searchTermMetricsDaily.amazonAdsAccountId, accountIds),
            eq(searchTermMetricsDaily.searchTerm, parsed?.term ?? entityId),
            eq(searchTermMetricsDaily.campaignId, parsed?.campaignId ?? campaignId),
            gte(searchTermMetricsDaily.date, start),
            lte(searchTermMetricsDaily.date, end),
          ),
        )
        .orderBy(asc(searchTermMetricsDaily.date));
      return rows.map(toPoint);
    }

    if (entityType === 'keyword' || entityType === 'product_target') {
      const rows = await this.drizzle.db
        .select({
          date: targetMetricsDaily.date,
          spend: targetMetricsDaily.cost,
          sales: targetMetricsDaily.sales7d,
          clicks: targetMetricsDaily.clicks,
          impressions: targetMetricsDaily.impressions,
          orders: targetMetricsDaily.orders7d,
        })
        .from(targetMetricsDaily)
        .where(
          and(
            inArray(targetMetricsDaily.amazonAdsAccountId, accountIds),
            eq(targetMetricsDaily.targetId, entityId),
            gte(targetMetricsDaily.date, start),
            lte(targetMetricsDaily.date, end),
          ),
        )
        .orderBy(asc(targetMetricsDaily.date));
      return rows.map(toPoint);
    }

    return null; // no fact table covers this grain
  }

  private async accountIdsFor(clientId: string): Promise<string[]> {
    const rows = await this.drizzle.db
      .select({ id: amazonAdsAccounts.id })
      .from(amazonAdsAccounts)
      .where(eq(amazonAdsAccounts.clientId, clientId));
    return rows.map((r) => r.id);
  }

  /** The data frontier — how far the syncs have actually reached. */
  private async latestFactDate(): Promise<string | null> {
    const [row] = await this.drizzle.db
      .select({ date: campaignMetricsDaily.date })
      .from(campaignMetricsDaily)
      .orderBy(desc(campaignMetricsDaily.date))
      .limit(1);
    return row?.date ?? null;
  }
}

function buildCrossCheck(metrics: Record<string, unknown>): TaskDetail['crossCheck'] {
  // Only rules that actually perform a cross-check set this flag. Absent
  // means "this rule doesn't cross-check", which is different from
  // "checked and found nothing" (performed: true, winners: []).
  if (metrics.winnerCrossCheckPerformed !== true) return null;

  const raw = Array.isArray(metrics.winnersElsewhere) ? metrics.winnersElsewhere : [];
  const winners: CrossCheckWinner[] = raw.map((w) => {
    const o = w as Record<string, unknown>;
    return {
      kind: String(o.kind ?? 'unknown'),
      campaignId: String(o.campaignId ?? ''),
      campaignName: typeof o.campaignName === 'string' ? o.campaignName : null,
      text: String(o.text ?? ''),
      orders: Number(o.orders ?? 0),
      sales: Number(o.sales ?? 0),
    };
  });

  const term = String(metrics.searchTerm ?? 'this term');
  const summary =
    winners.length === 0
      ? `Checked: "${term}" is not converting anywhere else in this account.`
      : `"${term}" IS converting in ${winners.length} other place(s) — this task is scoped to the failing campaign only. Do not negate account-wide.`;

  return { performed: true, winners, summary };
}

function toPoint(r: {
  date: string;
  spend: string | number | null;
  sales: string | number | null;
  clicks: string | number | null;
  impressions: string | number | null;
  orders: string | number | null;
}): PerformancePoint {
  const spend = Number(r.spend ?? 0);
  const sales = Number(r.sales ?? 0);
  return {
    date: r.date,
    spend,
    sales,
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    orders: Number(r.orders ?? 0),
    acos: spend > 0 && sales > 0 ? (spend / sales) * 100 : null,
    provisional: false, // set by markProvisional
  };
}

function markProvisional(points: PerformancePoint[], provisionalFrom: string): PerformancePoint[] {
  return points.map((p) => ({ ...p, provisional: p.date >= provisionalFrom }));
}

/** Coerces numeric-looking columns, keeping the expanded one first-class. */
function numeric(row: Record<string, unknown>, column: string): FactRow {
  const out: FactRow = { date: String(row.date) };
  for (const [k, v] of Object.entries(row)) {
    if (k === 'date') continue;
    out[k] = v === null || v === undefined ? null : typeof v === 'number' ? v : Number(v);
  }
  void column;
  return out;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
