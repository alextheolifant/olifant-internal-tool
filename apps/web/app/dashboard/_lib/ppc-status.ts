// ─── PPC Engine status stubs ──────────────────────────────────────────────────
// The exceptions/tasks/ideas tables don't exist yet (later phases). These hooks
// give the shell (sidebar badges, top bar freshness chip) a stable shape to
// render against now, so screens don't need to change when the real data lands.

export interface PpcBadgeCounts {
  today: number; // open/unresolved exceptions
  queue: number; // open tasks
  ideas: number; // open ideas
}

// TODO: replace with a real fetch against the exceptions/tasks/ideas tables
// once they exist.
export function usePpcBadgeCounts(): PpcBadgeCounts {
  return { today: 0, queue: 0, ideas: 0 };
}

export interface PpcSyncStatus {
  label: string;
  isStale: boolean; // true when the most-stale relevant sync is >48h old
}

// TODO: wire to sync_logs / the observability layer's health data once it's
// queryable. Until then this is a stub so the sidebar footer has something
// stable to render.
export function usePpcSyncStatus(): PpcSyncStatus {
  return { label: "Last synced: —", isStale: false };
}

// TODO: wire to sync_logs / the observability layer's health data once it's
// queryable. Backs the PPC top bar's data-freshness chip specifically —
// separate from usePpcSyncStatus() because the chip reports on data
// completeness/reconciliation, not just when the last sync ran.
export function usePpcDataFreshness(): PpcSyncStatus {
  return { label: "● data through Jul 25 · all reports reconciled", isStale: false };
}
