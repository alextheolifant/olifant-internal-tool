// ─── Task layer core types ─────────────────────────────────────────────────
// Mirrors the enums declared in db/schema.ts (task_type, task_status,
// task_confidence, task_dismiss_reason) — kept as plain TS unions here so the
// rest of this module doesn't need to import Drizzle's pgEnum runtime values
// just to talk about a status.

export type TaskType =
  | 'negation'
  | 'bid_change'
  | 'harvest_launch'
  | 'budget'
  | 'placement'
  | 'pause'
  | 'structural'
  | 'exception'
  | 'investigate'
  | 'sqp_opportunity'
  | 'rank_defense'
  | 'cro_flag'
  | 'inventory_guard'
  | 'pacing';

export type TaskStatus = 'pending' | 'approved' | 'blocked' | 'executed' | 'verified' | 'dismissed' | 'expired';

export type TaskConfidence = 'high' | 'medium' | 'provisional';

export type TaskDismissReason =
  | 'not_actionable'
  | 'already_handled'
  | 'incorrect_data'
  | 'client_preference'
  | 'duplicate'
  | 'other';

// §8.1's action object. adGroupId is always null today — no ad-group-level
// data is synced by either Go sync service yet (campaign-level only), so
// there is nothing real to put there. Left in the shape (not omitted) so
// nothing downstream needs to change when that data starts flowing.
export interface TaskAction {
  entityType: string;
  campaignId: string;
  campaignName: string | null; // verbatim, exactly as synced from the Ads console — never paraphrased
  adGroupId: string | null;
  oldValue: string | number | null;
  newValue: string | number | null;
}

export interface TaskEvidenceProvenance {
  // sync_logs.id of the most recent successful sync that populated this
  // entity's metrics — null when none could be resolved (see evidence.ts).
  reportJobId: string | null;
  syncedAt: string | null; // ISO timestamp of that sync's completion
}

export interface TaskEvidence {
  // The rule's own raw evidence payload, unmodified.
  metrics: Record<string, unknown>;
  window: { start: string; end: string } | null;
  provenance: TaskEvidenceProvenance;
  // Explicit flags for any fallback value baked into `metrics` — e.g.
  // { be: true } when account-default BE stood in for a per-product value.
  // A fallback must never be indistinguishable from a real reading.
  fallbacks: Record<string, boolean>;
}
