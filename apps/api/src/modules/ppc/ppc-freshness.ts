// ─── PPC Engine: sync freshness ─────────────────────────────────────────────────
// Reuses the same red/amber/green convention as TACOS health elsewhere in the
// app (on_target/watch/act_now), applied to "how long since this client's
// last successful sync" instead of a performance metric.

export type FreshnessLevel = 'on_target' | 'watch' | 'act_now' | 'unknown';

export interface ClientFreshness {
  lastSyncedAt: string | null; // ISO timestamp, null when never synced
  level: FreshnessLevel;
}

const FRESH_HOURS = 24;
const STALE_HOURS = 48;

export function classifyFreshness(lastSyncedAt: Date | null): ClientFreshness {
  if (!lastSyncedAt) return { lastSyncedAt: null, level: 'unknown' };

  const hoursSince = (Date.now() - lastSyncedAt.getTime()) / (60 * 60 * 1000);
  const level: FreshnessLevel =
    hoursSince <= FRESH_HOURS ? 'on_target' : hoursSince <= STALE_HOURS ? 'watch' : 'act_now';

  return { lastSyncedAt: lastSyncedAt.toISOString(), level };
}
