// Tunable anomaly-detection config — kept out of the detection logic so
// thresholds can be adjusted here without touching anomalies.service.ts.

export const BASELINE_WINDOW_DAYS = 7;

// Uniform noise gate across ALL metrics, based on baseline ad spend — a
// low-spend client's CTR/ACoS naturally swings wildly for the same reason
// its spend does (too little traffic to be statistically meaningful), so
// this isn't a per-metric concept.
export const MIN_BASELINE_SPEND = 50;

// How many percentage points worse an already-open anomaly must get before
// it's treated as a materially new situation (update) rather than the same
// ongoing issue (skip, no duplicate).
export const MATERIAL_WORSENING_DELTA_PP = 10;

export type AnomalyMetric =
  | 'acos'
  | 'spend'
  | 'ctr'
  | 'clicks'
  | 'tacos'
  | 'revenue';

export type AnomalyDirection = 'rise' | 'drop' | 'drop_or_spike';
export type AnomalySeverity = 'watch' | 'act_now';

export interface MetricThresholdConfig {
  direction: AnomalyDirection;
  thresholdPct: number;
  actNowThresholdPct: number;
  // TACoS/Revenue require SP-API data — null baseline/actual for these means
  // "not connected yet", so checks must be skipped, not treated as a real 0.
  requiresSpApi: boolean;
}

export const ANOMALY_THRESHOLDS: Record<AnomalyMetric, MetricThresholdConfig> =
  {
    acos: {
      direction: 'rise',
      thresholdPct: 30,
      actNowThresholdPct: 60,
      requiresSpApi: false,
    },
    spend: {
      direction: 'drop_or_spike',
      thresholdPct: 50,
      actNowThresholdPct: 80,
      requiresSpApi: false,
    },
    ctr: {
      direction: 'drop',
      thresholdPct: 30,
      actNowThresholdPct: 60,
      requiresSpApi: false,
    },
    // "Drops to near-zero" (spec'd as below 10% of baseline) is the same
    // condition as a 90% drop — expressed as `drop` with a steeper
    // threshold rather than a separate direction.
    clicks: {
      direction: 'drop',
      thresholdPct: 90,
      actNowThresholdPct: 95,
      requiresSpApi: false,
    },
    tacos: {
      direction: 'rise',
      thresholdPct: 30,
      actNowThresholdPct: 60,
      requiresSpApi: true,
    },
    revenue: {
      direction: 'drop',
      thresholdPct: 40,
      actNowThresholdPct: 70,
      requiresSpApi: true,
    },
  };

export interface AnomalyEvaluation {
  isAnomaly: boolean;
  // Null when the baseline was 0 — see evaluateAnomaly.
  percentChange: number | null;
  severity: AnomalySeverity | null;
}

/**
 * Pure threshold check for one client+metric+day. Callers are responsible for
 * the null-data skip (SP-API not connected) and the volume gate — this only
 * ever sees clean, already-screened numbers.
 */
export function evaluateAnomaly(
  baseline: number,
  actual: number,
  config: MetricThresholdConfig,
): AnomalyEvaluation {
  if (baseline === 0) {
    // No meaningful percentage to compute. A jump from nothing to something
    // real is itself worth flagging — anything at/below 0 is not.
    const isNewActivity = actual > 0;
    return {
      isAnomaly: isNewActivity,
      percentChange: null,
      severity: isNewActivity ? 'watch' : null,
    };
  }

  const percentChange = ((actual - baseline) / baseline) * 100;
  const crossed = directionCrossed(
    config.direction,
    percentChange,
    config.thresholdPct,
  );

  if (!crossed) {
    return { isAnomaly: false, percentChange, severity: null };
  }

  const actNowCrossed = directionCrossed(
    config.direction,
    percentChange,
    config.actNowThresholdPct,
  );
  return {
    isAnomaly: true,
    percentChange,
    severity: actNowCrossed ? 'act_now' : 'watch',
  };
}

function directionCrossed(
  direction: AnomalyDirection,
  percentChange: number,
  thresholdPct: number,
): boolean {
  switch (direction) {
    case 'rise':
      return percentChange >= thresholdPct;
    case 'drop':
      return percentChange <= -thresholdPct;
    case 'drop_or_spike':
      return percentChange >= thresholdPct || percentChange <= -thresholdPct;
  }
}

/**
 * Compares a freshly-computed percent_change against an already-open
 * anomaly's recorded percent_change to decide whether this is the same
 * ongoing issue (false) or has materially worsened (true).
 *
 * A transition between "has a numeric percent_change" and "new activity
 * (null)" is always treated as materially worsened — those are genuinely
 * different situations, not a continuation of the same one.
 */
export function isMateriallyWorsened(
  newPercentChange: number | null,
  existingPercentChange: number | null,
  deltaPp: number = MATERIAL_WORSENING_DELTA_PP,
): boolean {
  if (newPercentChange === null && existingPercentChange === null) return false;
  if (newPercentChange === null || existingPercentChange === null) return true;
  return (
    Math.abs(Math.abs(newPercentChange) - Math.abs(existingPercentChange)) >=
    deltaPp
  );
}
