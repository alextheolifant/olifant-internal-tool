// ─── Monitor types ──────────────────────────────────────────────────────────
// Mirrors schema.ts's monitor_state enum, plus the shape of the verdict
// payloads stored in task_monitors.checkpoint_14d / verdict_30d.

export type MonitorState = 'watching' | 'concluded';

/** Which of the two verdict slots a run is writing. */
export type VerdictStage = 'checkpoint_14d' | 'verdict_30d';

/** One window's aggregated facts for one entity or campaign. */
export interface WindowMetrics {
  /** Days in the window that actually carry a fact row. */
  daysWithData: number;
  /** Calendar days the window spans — daysWithData/windowDays is density. */
  windowDays: number;
  spend: number;
  sales: number;
  clicks: number;
  impressions: number;
  orders: number;
  /** Spend / windowDays — the run-rate the verdicts extrapolate from. */
  dailySpend: number;
  dailySales: number;
  /** Null when spend is 0 — an ACOS of "0%" on no spend is meaningless. */
  acos: number | null;
}

/**
 * Why an account's trend baseline was rejected for normalization. Null when
 * the baseline is usable. Every reason maps to one threshold in
 * RULE_THRESHOLD_DEFAULTS — see thresholds.ts.
 */
export type InsufficientBaselineReason =
  | 'baseline_spend_too_low'
  | 'baseline_days_too_sparse'
  | 'baseline_too_volatile'
  | 'no_baseline_data'
  // The pre-window was fine but the POST window has no account data at all
  // (the sync hasn't reached those dates yet). Without it there is no
  // "account's change over the identical window" to difference against —
  // and treating an unsynced window as a real 100% account-wide collapse
  // would poison every verdict computed during a sync lag.
  | 'no_post_window_data';

/**
 * The difference-in-differences result for one measured quantity.
 *
 * `normalized: false` means the account trend could NOT be established and
 * everything here is a raw before/after — callers must surface that, never
 * present it as trend-adjusted (see normalization.ts).
 */
export interface NormalizedComparison {
  normalized: boolean;
  insufficientBaselineReason: InsufficientBaselineReason | null;

  /** Entity's own pre/post daily run-rate. */
  entityPreDaily: number;
  entityPostDaily: number;
  entityRawDeltaDaily: number;

  /** Account-wide movement over the identical window, as a factor and a %. */
  accountTrendFactor: number | null;
  accountMovementPct: number | null;

  /**
   * What the entity's post daily rate would have been had it simply
   * followed the account. Null when not normalized.
   */
  counterfactualDaily: number | null;
  /** entityPostDaily − counterfactualDaily. Null when not normalized. */
  normalizedDeltaDaily: number | null;
}

/** A data-freshness caveat attached to every verdict. */
export interface ProvisionalInfo {
  /** True when any day in the post window falls inside the restatement age. */
  hasProvisionalData: boolean;
  /** Post-window days still subject to Amazon's ~14d attribution restatement. */
  provisionalDays: number;
  /** Facts dated on/after this are provisional. */
  provisionalFromDate: string;
  /** Latest fact date available at all — the post window may end short of it. */
  latestFactDate: string | null;
}

export interface MonitorFlag {
  kind: 'campaign_acos_deterioration' | 'impressions_collapsed';
  detail: string;
  /** The measured value that breached, and the threshold it breached. */
  observed: number;
  threshold: number;
}

/** The full payload written into checkpoint_14d / verdict_30d. */
export interface MonitorVerdict {
  stage: VerdictStage;
  computedAt: string;
  taskType: string;
  executionDate: string;
  window: {
    baselineStart: string;
    baselineEnd: string;
    postStart: string;
    postEnd: string;
  };
  entity: { level: 'entity'; entityType: string; entityId: string; pre: WindowMetrics; post: WindowMetrics } | null;
  campaign: { level: 'campaign'; campaignId: string; pre: WindowMetrics; post: WindowMetrics };
  /** Normalization of entity spend — the basis for verified savings. */
  spendComparison: NormalizedComparison | null;
  /** Normalization of the parent campaign's ACOS — the side-effect check. */
  campaignAcos: { pre: number | null; post: number | null; deltaPct: number | null; normalizedDeltaPct: number | null };
  /**
   * Verified savings in $/month, conservative (see normalization.ts's
   * conservativeCounterfactual). Null for task types where "savings" isn't
   * the thing being measured, or where it can't be established.
   */
  verifiedSavingsMonthly: number | null;
  flags: MonitorFlag[];
  provisional: ProvisionalInfo;
  /** Plain-language verdict, following the brief's stated pattern. */
  summary: string;
  /**
   * Set when the task type has no measurable field change at all (every
   * `investigate` task today) — the monitor still records observed movement
   * as context but explicitly claims no attribution.
   */
  notMeasurable: string | null;
}
