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
