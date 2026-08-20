import { apiFetch } from "@/lib/api";

// Mirrors the API's QueueRow / QueueResponse (apps/api/src/modules/ppc/
// tasks/queue.types.ts). Ordering and the impact bar fraction are computed
// server-side — the table renders what it receives and never re-sorts or
// recomputes proportions.
export interface PpcQueueRow {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  ruleId: string;
  band: string;
  type: string;
  status: string;
  confidence: string;
  priorityScore: number;
  impactMonthlyUsd: number | null;
  // Fraction (0..1) of the largest impact in the current result set. Null
  // when the task carries no dollar figure at all — which is NOT the same as
  // 0, and renders as an em-dash with no bar.
  impactBarFraction: number | null;
  estMinutes: number;
  blockedBy: string | null;
  assignee: string | null;
  createdAt: string;
}

export interface PpcQueueResponse {
  rows: PpcQueueRow[];
  // Total matching the filters, ignoring paging.
  total: number;
  limit: number;
  offset: number;
}

export interface PpcQueueFilters {
  clientId?: string;
  type?: string;
  status?: string;
  assignee?: string;
  // Paging. The API defaults to 50 and caps at 200; omitting them keeps
  // whatever the server considers a page.
  limit?: number;
  offset?: number;
}

// Rows per page. Matches the API's own default, so the first request is
// identical whether or not the UI supplies it.
export const QUEUE_PAGE_SIZE = 50;

export interface BulkApproveResult {
  id: string;
  ok: boolean;
  status: string | null;
  error: string | null;
}

export interface BulkApproveResponse {
  approved: number;
  failed: number;
  results: BulkApproveResult[];
}

export function queueQueryString(filters: PpcQueueFilters): string {
  const params = new URLSearchParams();
  // "all" is the client filter's sentinel for unset, matching the shared
  // client-filter context the rest of the PPC section uses.
  if (filters.clientId && filters.clientId !== "all") params.set("clientId", filters.clientId);
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.assignee) params.set("assignee", filters.assignee);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  // offset=0 is meaningful (page one) but also the server default, so it's
  // only sent when non-zero to keep the first page's URL clean.
  if (filters.offset) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchPpcQueue(
  filters: PpcQueueFilters,
  signal?: AbortSignal,
): Promise<PpcQueueResponse> {
  const res = await apiFetch(`/api/ppc/tasks${queueQueryString(filters)}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function bulkApproveTasks(ids: string[]): Promise<BulkApproveResponse> {
  const res = await apiFetch(`/api/ppc/tasks/bulk-approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
