// ─── Threshold override resolution ──────────────────────────────────────────
// Every tunable number a rule reads must go through here — rules must never
// hardcode a threshold inline. Client overrides come from
// ppc_client_configs.threshold_overrides (a flat Record<string, number>);
// anything not present there falls back to the system default below.

export const RULE_THRESHOLD_DEFAULTS = {
  // D4: trailing 7d ACOS must exceed BE × this multiplier to enter.
  d4_acos_multiplier: 2.0,
  // D4: minimum trailing-7d spend required before a campaign is evaluated at
  // all — protects against noisy ACOS readings on near-zero spend.
  d4_min_spend: 50,
  // D5: yesterday's impressions at or below this count as "~0" (stopped).
  d5_near_zero_impressions: 2,
  // D5: a prior day counts as "meaningfully serving" if impressions were at
  // or above this — used to establish the campaign was actually delivering
  // before, not just newly launched or always-quiet.
  d5_meaningful_impressions: 10,

  // ── Monitor (post-change feedback loop) ──────────────────────────────────
  // What makes an account's trend baseline usable for difference-in-
  // differences normalization. Failing ANY of the three means the verdict
  // must say "trend baseline insufficient — raw comparison shown" rather
  // than presenting a raw number as if it were normalized (see
  // normalization.ts).
  //
  // Total account spend across the 14-day pre-window. Below this the
  // account-wide percentage movement is dominated by rounding on a handful
  // of dollars — dividing by it produces a trend factor that is noise.
  monitor_min_baseline_spend: 100,
  // Days in the 14-day pre-window that must actually carry spend data. A
  // window with 3 populated days isn't a trend, it's three points.
  monitor_min_baseline_days: 7,
  // Coefficient of variation (stddev / mean) of account daily spend across
  // the pre-window. Above this the account is too volatile for its own mean
  // to represent a "normal" level worth normalizing against. 1.0 = the
  // day-to-day swing is as large as the average day itself.
  monitor_max_baseline_cv: 1.0,

  // Auto-flag triggers, evaluated on the NORMALIZED comparison specifically
  // so a seasonal account-wide swing can't fire a false rollback alarm.
  // Monitored campaign's trailing-7d ACOS deteriorating by more than this
  // percent versus its pre-change baseline.
  monitor_flag_acos_deterioration_pct: 25,
  // A repriced target's impressions dropping by more than this percent —
  // the "bid cut too deep" signal.
  monitor_flag_impression_drop_pct: 80,
} as const;

export type RuleThresholdKey = keyof typeof RULE_THRESHOLD_DEFAULTS;

export function makeThresholdResolver(
  overrides: Record<string, number> | null | undefined,
): (key: string, systemDefault: number) => number {
  return (key, systemDefault) => {
    const override = overrides?.[key];
    return override !== undefined && override !== null ? override : systemDefault;
  };
}

// Hysteresis: default clear = enter × 0.85 unless a rule states otherwise.
export function defaultClearThreshold(enterValue: number, clearMultiplier = 0.85): number {
  return enterValue * clearMultiplier;
}

// Same default 0.85 relationship, but for a "low value is bad" metric (e.g.
// impressions) rather than "high value is bad" (e.g. ACOS) — the clear bar
// must be a LOOSER (higher) threshold than enter, so dividing instead of
// multiplying keeps the same "15% buffer" intent in the correct direction.
export function defaultClearThresholdForLowMetric(enterValue: number, clearMultiplier = 0.85): number {
  return enterValue / clearMultiplier;
}
