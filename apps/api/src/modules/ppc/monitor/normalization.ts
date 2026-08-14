import type {
  InsufficientBaselineReason,
  NormalizedComparison,
  WindowMetrics,
} from './monitor.types';

// ─── Difference-in-differences normalization ────────────────────────────────
// Every verdict compares an entity's change against the ACCOUNT'S OWN change
// over the identical window, never against the entity's raw before/after.
//
// Why this matters enough to be its own module: a raw before/after lies
// during demand shifts. A negation executed the week before a peak event
// looks catastrophic (everything else grew, this went to zero); one executed
// into a slump looks brilliant (spend fell, but so did the whole account's).
// The auto-flag thresholds read the normalized numbers specifically so a
// seasonal swing can't fire a false rollback alarm.
//
// Pure functions only — no DB access, no clock — so the arithmetic is
// directly unit-testable, same convention as persistence-hysteresis-guard.ts.

/** One day of facts, already reduced to the fields the monitor measures. */
export interface DailyFactRow {
  date: string;
  spend: number;
  sales: number;
  clicks: number;
  impressions: number;
  orders: number;
}

export function emptyWindow(windowDays: number): WindowMetrics {
  return {
    daysWithData: 0,
    windowDays,
    spend: 0,
    sales: 0,
    clicks: 0,
    impressions: 0,
    orders: 0,
    dailySpend: 0,
    dailySales: 0,
    acos: null,
  };
}

/**
 * Aggregates a window's daily rows over an explicit set of effective dates —
 * the dates the ACCOUNT actually has data for in that window.
 *
 * Why not just divide by the calendar span: sync gaps are real and common
 * (verified against this dev DB — one client is missing 2026-08-04..08-08
 * entirely while spending a steady ~$4k/day either side). Treating those
 * absent days as $0 would have reported that account's trend as +89% when
 * the true movement was +22%, and every counterfactual built on it would
 * inherit the error.
 *
 * Restricting BOTH the entity and the account series to the same effective
 * dates keeps the difference-in-differences ratio apples-to-apples: an
 * account day that was never synced is excluded from both sides rather than
 * imputed as zero on both. A day that IS present but on which the entity
 * simply didn't serve still counts as a real zero for that entity, which is
 * correct.
 */
export function aggregateOverDates(rows: DailyFactRow[], effectiveDates: Set<string>): WindowMetrics {
  const inWindow = rows.filter((r) => effectiveDates.has(r.date));
  return aggregateWindow(inWindow, effectiveDates.size);
}

/** The dates a series actually carries data for — the effective support. */
export function datesIn(rows: DailyFactRow[]): Set<string> {
  return new Set(rows.map((r) => r.date));
}

/**
 * Aggregates rows over an explicit divisor. Prefer aggregateOverDates in
 * production paths; this stays exported for the unit tests, which construct
 * dense windows where span and support are identical.
 */
export function aggregateWindow(rows: DailyFactRow[], windowDays: number): WindowMetrics {
  const w = emptyWindow(windowDays);
  for (const r of rows) {
    w.spend += r.spend;
    w.sales += r.sales;
    w.clicks += r.clicks;
    w.impressions += r.impressions;
    w.orders += r.orders;
  }
  w.daysWithData = rows.length;
  w.dailySpend = windowDays > 0 ? w.spend / windowDays : 0;
  w.dailySales = windowDays > 0 ? w.sales / windowDays : 0;
  w.acos = w.spend > 0 && w.sales > 0 ? (w.spend / w.sales) * 100 : w.spend > 0 ? null : null;
  return w;
}

export interface BaselineThresholds {
  minBaselineSpend: number;
  minBaselineDays: number;
  maxBaselineCv: number;
}

/**
 * Decides whether the account's pre-window is a usable trend baseline.
 * Returns null when it is; otherwise the specific reason it isn't.
 *
 * "Insufficient" is deliberately concrete and configurable (see
 * thresholds.ts) rather than a vibe — a verdict that silently degraded to a
 * raw comparison would be worse than no verdict at all.
 */
export function assessBaseline(
  accountPre: WindowMetrics,
  accountDailySpends: number[],
  t: BaselineThresholds,
  accountPost?: WindowMetrics,
): InsufficientBaselineReason | null {
  if (accountPre.daysWithData === 0 || accountPre.spend <= 0) return 'no_baseline_data';
  if (accountPre.spend < t.minBaselineSpend) return 'baseline_spend_too_low';
  if (accountPre.daysWithData < t.minBaselineDays) return 'baseline_days_too_sparse';
  if (coefficientOfVariation(accountDailySpends) > t.maxBaselineCv) return 'baseline_too_volatile';
  // A post window the sync hasn't reached yet has zero rows, which would
  // compute as a 100% account-wide collapse and make every counterfactual
  // zero. That's a data gap, not a measurement.
  if (accountPost && accountPost.daysWithData === 0) return 'no_post_window_data';
  return null;
}

/** stddev / mean (population). 0 for a flat series; 0 for fewer than 2 points. */
export function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * The difference-in-differences core.
 *
 *   accountTrendFactor = accountPostDaily / accountPreDaily
 *   counterfactualDaily = entityPreDaily × accountTrendFactor
 *       ("what this entity would be spending had it simply moved with the
 *        account")
 *   normalizedDeltaDaily = entityPostDaily − counterfactualDaily
 *       (the part of the change that is NOT explained by account-wide drift)
 *
 * When the baseline is unusable, everything trend-related is null and
 * `normalized` is false — callers must render the raw figures with the
 * insufficient-baseline statement, never as a normalized result.
 */
export function computeNormalizedComparison(
  entityPre: WindowMetrics,
  entityPost: WindowMetrics,
  accountPre: WindowMetrics,
  accountPost: WindowMetrics,
  accountDailySpends: number[],
  t: BaselineThresholds,
): NormalizedComparison {
  const entityPreDaily = entityPre.dailySpend;
  const entityPostDaily = entityPost.dailySpend;
  const base: NormalizedComparison = {
    normalized: false,
    insufficientBaselineReason: null,
    entityPreDaily,
    entityPostDaily,
    entityRawDeltaDaily: entityPostDaily - entityPreDaily,
    accountTrendFactor: null,
    accountMovementPct: null,
    counterfactualDaily: null,
    normalizedDeltaDaily: null,
  };

  const reason = assessBaseline(accountPre, accountDailySpends, t, accountPost);
  if (reason) return { ...base, insufficientBaselineReason: reason };

  const accountTrendFactor = accountPost.dailySpend / accountPre.dailySpend;
  const counterfactualDaily = entityPreDaily * accountTrendFactor;

  return {
    ...base,
    normalized: true,
    accountTrendFactor,
    accountMovementPct: (accountTrendFactor - 1) * 100,
    counterfactualDaily,
    normalizedDeltaDaily: entityPostDaily - counterfactualDaily,
  };
}

const DAYS_PER_MONTH = 30;

/**
 * Verified savings in $/month for a spend-eliminating change (negation,
 * pause), stated conservatively.
 *
 * The counterfactual is capped at the entity's own pre-change run-rate:
 *
 *   - Account trend DOWN → the entity would likely have spent less anyway,
 *     so the trend-adjusted (smaller) counterfactual is used. Claiming the
 *     raw pre-rate here would bill the engine for a decline the whole
 *     account was having.
 *   - Account trend UP → the trend-adjusted counterfactual is LARGER than
 *     what this entity ever actually spent. Using it would claim savings on
 *     spend that never happened, which is exactly the extrapolation the
 *     brief forbids ("only claim what the entity's own before/after shows").
 *     So the raw pre-rate caps it.
 *
 * Returns null when there's nothing defensible to claim: no baseline spend,
 * or spend didn't actually fall.
 */
export function conservativeSavingsMonthly(c: NormalizedComparison): number | null {
  if (c.entityPreDaily <= 0) return null;
  const counterfactual =
    c.normalized && c.counterfactualDaily !== null
      ? Math.min(c.counterfactualDaily, c.entityPreDaily)
      : c.entityPreDaily;
  const savedPerDay = counterfactual - c.entityPostDaily;
  if (savedPerDay <= 0) return null; // spend didn't fall — nothing to claim
  return savedPerDay * DAYS_PER_MONTH;
}

/**
 * Percentage change, normalized against the account's own movement in the
 * same metric where a trend factor is available. Used for the campaign-ACOS
 * side-effect check and the auto-flag thresholds, which the brief requires
 * to read normalized rather than raw.
 */
export function normalizedPctChange(
  pre: number | null,
  post: number | null,
  accountPre: number | null,
  accountPost: number | null,
): { rawPct: number | null; normalizedPct: number | null } {
  if (pre === null || post === null || pre === 0) return { rawPct: null, normalizedPct: null };
  const rawPct = ((post - pre) / pre) * 100;

  if (accountPre === null || accountPost === null || accountPre === 0) {
    return { rawPct, normalizedPct: null };
  }
  const accountFactor = accountPost / accountPre;
  const counterfactual = pre * accountFactor;
  if (counterfactual === 0) return { rawPct, normalizedPct: null };
  return { rawPct, normalizedPct: ((post - counterfactual) / counterfactual) * 100 };
}

export function fmtMoney(v: number): string {
  return `$${Math.abs(v).toFixed(2)}`;
}

export function fmtSignedPct(v: number): string {
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(0)}%`;
}

export const INSUFFICIENT_BASELINE_TEXT: Record<InsufficientBaselineReason, string> = {
  no_baseline_data: 'no account spend recorded in the baseline window',
  baseline_spend_too_low: 'account baseline spend below the minimum for a stable trend',
  baseline_days_too_sparse: 'too few days with data in the baseline window',
  baseline_too_volatile: 'account spend too volatile across the baseline window',
  no_post_window_data: 'no account data synced yet for the post-execution window',
};

/**
 * The plain-language verdict string, following the brief's stated pattern:
 *
 *   "Term spend $0 since execution (was $1.40/day). Account-wide spend +18%
 *    over the same window — savings stated net of trend: $38/mo."
 *
 * When the baseline is insufficient this states so explicitly and labels the
 * figures raw, rather than quietly emitting the same sentence minus the
 * trend clause.
 */
export function buildSpendSummary(
  entityLabel: string,
  c: NormalizedComparison,
  savingsMonthly: number | null,
): string {
  const head = `${entityLabel} spend ${fmtMoney(c.entityPostDaily)}/day since execution (was ${fmtMoney(c.entityPreDaily)}/day).`;

  if (!c.normalized) {
    const why = c.insufficientBaselineReason
      ? INSUFFICIENT_BASELINE_TEXT[c.insufficientBaselineReason]
      : 'trend baseline unavailable';
    const raw =
      savingsMonthly !== null
        ? ` Raw spend reduction: ${fmtMoney(savingsMonthly)}/mo.`
        : ' No spend reduction to report.';
    return `${head} Trend baseline insufficient (${why}) — raw comparison shown.${raw}`;
  }

  const trend = `Account-wide spend ${fmtSignedPct(c.accountMovementPct as number)} over the same window`;
  if (savingsMonthly === null) {
    return `${head} ${trend} — no spend reduction to report net of trend.`;
  }
  const capped = (c.counterfactualDaily as number) > c.entityPreDaily;
  const note = capped
    ? ' (counterfactual capped at the entity\'s own pre-change rate — account trend rose, and savings are never claimed on spend that never happened)'
    : '';
  return `${head} ${trend} — savings stated net of trend: ${fmtMoney(savingsMonthly)}/mo${note}.`;
}
