import { apiFetch } from "@/lib/api";

// Mirrors the API's TaskDetail / FactsResponse / PerformanceResponse
// (apps/api/src/modules/ppc/tasks/queue.types.ts).

export interface TaskDetailAction {
  entityType: string;
  campaignId: string;
  campaignName: string | null;
  adGroupId: string | null;
  field: string | null;
  oldValue: string | number | null;
  newValue: string | number | null;
}

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
  status: string;
  type: string;
  band: string;
  confidence: string;
  profile: string | null;
  priorityScore: number;
  estMinutes: number;
  requiresReview: boolean;
  impactMonthlyUsd: number | null;
  impactBasis: string | null;
  instructions: string[];
  // Harvest tasks only; W4 doesn't exist yet so this is always null and the
  // Why panel is skipped rather than filled with placeholder content.
  decisionPath: null;
  action: TaskDetailAction;
  evidence: {
    metrics: Record<string, unknown>;
    window: { start: string; end: string } | null;
    provenance: { reportJobId: string | null; syncedAt: string | null; syncType: string | null };
    // Keys here that are `true` mark a value that came from a FALLBACK
    // rather than a configured one. §8.6's grounding rule: a fallback must
    // never render indistinguishably from a real value.
    fallbacks: Record<string, boolean>;
    expandableMetrics: string[];
    factTable: string | null;
  };
  crossCheck: { performed: boolean; winners: CrossCheckWinner[]; summary: string } | null;
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
  monitor: { state: string; executionDate: string; hasVerdict: boolean; verdictSummary: string | null } | null;
}

export interface FactRow {
  date: string;
  [column: string]: string | number | null;
}

export interface FactsResponse {
  taskId: string;
  metric: string;
  expandable: boolean;
  reason: string | null;
  factTable: string | null;
  column: string | null;
  window: { start: string; end: string } | null;
  rows: FactRow[];
  total: number | null;
}

export interface PerformancePoint {
  date: string;
  spend: number;
  sales: number;
  clicks: number;
  impressions: number;
  orders: number;
  acos: number | null;
  // Flagged by the API (restatement age) — never computed client-side.
  provisional: boolean;
}

export interface PerformanceAvailable {
  available: true;
  taskId: string;
  executionDate: string;
  entitySeries: PerformancePoint[] | null;
  entityType: string;
  entityId: string;
  campaignSeries: PerformancePoint[];
  campaignId: string;
  provisionalFromDate: string;
  latestFactDate: string | null;
  verdict: string | null;
  verdictStage: string | null;
  verifiedSavingsMonthly: number | null;
}

export interface PerformanceUnavailable {
  available: false;
  taskId: string;
  reason: string;
}

export type PerformanceResponse = PerformanceAvailable | PerformanceUnavailable;

export async function fetchTaskDetail(id: string, signal?: AbortSignal): Promise<TaskDetail> {
  const res = await apiFetch(`/api/ppc/tasks/${encodeURIComponent(id)}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchTaskFacts(id: string, metric: string, signal?: AbortSignal): Promise<FactsResponse> {
  const res = await apiFetch(
    `/api/ppc/tasks/${encodeURIComponent(id)}/facts?metric=${encodeURIComponent(metric)}`,
    { cache: "no-store", signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchTaskPerformance(id: string, signal?: AbortSignal): Promise<PerformanceResponse> {
  const res = await apiFetch(`/api/ppc/tasks/${encodeURIComponent(id)}/performance`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function post(path: string, body?: unknown): Promise<TaskDetail> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    // The API returns a specific message for invalid transitions and missing
    // confirmed values — surface it rather than a bare status code.
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const approveTask = (id: string) => post(`/api/ppc/tasks/${encodeURIComponent(id)}/approve`);

export const executeTask = (id: string, confirmedValue: string | null) =>
  post(`/api/ppc/tasks/${encodeURIComponent(id)}/execute`, { confirmedValue });

export const dismissTask = (id: string, reason: string, note?: string) =>
  post(`/api/ppc/tasks/${encodeURIComponent(id)}/dismiss`, { reason, note });

// Structured reasons, matching the API's task_dismiss_reason enum.
export const DISMISS_REASONS = [
  { value: "not_actionable", label: "Not actionable" },
  { value: "already_handled", label: "Already handled" },
  { value: "incorrect_data", label: "Incorrect data" },
  { value: "client_preference", label: "Client preference" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other" },
] as const;
