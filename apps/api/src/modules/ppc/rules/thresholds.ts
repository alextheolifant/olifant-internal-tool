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
