import type { FactTable, NonExpandableReason } from './fact-source';
import type { TaskConfidence, TaskStatus, TaskType } from './task.types';

// ─── Queue list (Part 1) ────────────────────────────────────────────────────

export interface QueueFilters {
  clientId?: string;
  type?: TaskType;
  status?: TaskStatus;
  assignee?: string;
  limit?: number;
  offset?: number;
}

export interface QueueRow {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  ruleId: string;
  band: string;
  type: TaskType;
  status: TaskStatus;
  confidence: TaskConfidence;
  priorityScore: number;
  impactMonthlyUsd: number | null;
  /**
   * Impact as a fraction (0..1) of the largest impact in THIS result set, so
   * the table can draw its proportional bar without a second pass over the
   * data. Null when the task has no impact figure at all — distinct from
   * 0, which means "measured, and it's the smallest here".
   */
  impactBarFraction: number | null;
  estMinutes: number;
  /** Present only for blocked tasks — renders as "waits on TSK-…". */
  blockedBy: string | null;
  assignee: string | null;
  createdAt: string;
}

export interface QueueResponse {
  rows: QueueRow[];
  /** Total matching the filters, ignoring limit/offset — bulk-approve needs it. */
  total: number;
  limit: number;
  offset: number;
}

// ─── Drawer detail (Part 2) ─────────────────────────────────────────────────

export interface CrossCheckWinner {
  kind: string;
  campaignId: string;
  campaignName: string | null;
  text: string;
  orders: number;
  sales: number;
}

export interface TaskDetail {
  id: string;
  ruleId: string;
  clientId: string;
  clientName: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  band: string;
  confidence: TaskConfidence;
  profile: string | null;
  priorityScore: number;
  estMinutes: number;
  // Some rules mark a task as needing human judgement before action. The
  // drawer surfaces this as a caution pill — it must not stay buried in the
  // row, which is why it's a first-class field rather than left in evidence.
  requiresReview: boolean;
  impactMonthlyUsd: number | null;
  impactBasis: string | null;
  instructions: string[];
  /**
   * Harvest tasks only. W4 (the harvest rule) doesn't exist yet, so this is
   * always null today — declared so the drawer can build against it now
   * rather than waiting. Never fabricated for non-harvest types.
   */
  decisionPath: null;
  action: {
    entityType: string;
    campaignId: string;
    campaignName: string | null;
    adGroupId: string | null;
    field: string | null;
    oldValue: string | number | null;
    newValue: string | number | null;
  };
  evidence: {
    metrics: Record<string, unknown>;
    window: { start: string; end: string } | null;
    provenance: {
      reportJobId: string | null;
      syncedAt: string | null;
      syncType: string | null;
    };
    fallbacks: Record<string, boolean>;
    /**
     * Which evidence keys the facts endpoint can expand, resolved from
     * provenance — lets the UI mark numbers interactive without probing.
     */
    expandableMetrics: string[];
    factTable: FactTable | null;
  };
  /**
   * W1's winner-conflict result, when the rule performed one. Null for rules
   * that don't cross-check at all — distinct from an empty array, which
   * means "checked, found nothing".
   */
  crossCheck: {
    performed: boolean;
    winners: CrossCheckWinner[];
    summary: string;
  } | null;
  rollback: string;
  dismissReason: string | null;
  dismissNote: string | null;
  blockedBy: string | null;
  assignee: string | null;
  confirmedValue: string | null;
  verifyMismatchReason: string | null;
  createdAt: string;
  executedAt: string | null;
  verifiedAt: string | null;
  /** Compact monitor headline; the full series lives at /:id/performance. */
  monitor: {
    state: string;
    executionDate: string;
    hasVerdict: boolean;
    verdictSummary: string | null;
  } | null;
}

// ─── Performance series (Part 3) ────────────────────────────────────────────

export interface PerformancePoint {
  date: string;
  spend: number;
  sales: number;
  clicks: number;
  impressions: number;
  orders: number;
  acos: number | null;
  /** Inside the 14-day restatement age — the UI shades these. */
  provisional: boolean;
}

export interface PerformanceResponse {
  taskId: string;
  executionDate: string;
  /** Daily series for the entity the task changed. Null if it has no fact table. */
  entitySeries: PerformancePoint[] | null;
  entityType: string;
  entityId: string;
  /** Parent campaign daily series — the side-effect chart. */
  campaignSeries: PerformancePoint[];
  campaignId: string;
  provisionalFromDate: string;
  latestFactDate: string | null;
  /** Plain-language, already normalized net of account trend. */
  verdict: string | null;
  verdictStage: string | null;
  verifiedSavingsMonthly: number | null;
}

// ─── Clickable evidence (Part 4) ────────────────────────────────────────────

export interface FactRow {
  date: string;
  [column: string]: string | number | null;
}

export interface FactsResponse {
  taskId: string;
  metric: string;
  expandable: boolean;
  reason: NonExpandableReason | null;
  factTable: FactTable | null;
  column: string | null;
  window: { start: string; end: string } | null;
  rows: FactRow[];
  /** Sum of the expanded column across the returned rows, for reconciliation. */
  total: number | null;
}

// ─── Bulk approve (Part 5) ──────────────────────────────────────────────────

export interface BulkApproveResult {
  id: string;
  ok: boolean;
  status: TaskStatus | null;
  error: string | null;
}

export interface BulkApproveResponse {
  approved: number;
  failed: number;
  results: BulkApproveResult[];
}
