import {
  aggregateWindow,
  assessBaseline,
  buildSpendSummary,
  coefficientOfVariation,
  computeNormalizedComparison,
  conservativeSavingsMonthly,
  normalizedPctChange,
  type DailyFactRow,
} from './normalization';

const T = { minBaselineSpend: 100, minBaselineDays: 7, maxBaselineCv: 1.0 };

function days(n: number, spend: number, sales = 0): DailyFactRow[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    spend,
    sales,
    clicks: 0,
    impressions: 0,
    orders: 0,
  }));
}

describe('aggregateWindow', () => {
  it('divides by the calendar span, not by days-with-data, so sparse entities are not inflated', () => {
    // 2 days of $7 spend inside a 14-day window is $1/day, not $7/day.
    const w = aggregateWindow(days(2, 7), 14);
    expect(w.spend).toBe(14);
    expect(w.daysWithData).toBe(2);
    expect(w.dailySpend).toBe(1);
  });

  it('leaves ACOS null when there is no spend or no sales rather than reporting 0%', () => {
    expect(aggregateWindow(days(3, 0, 0), 14).acos).toBeNull();
    expect(aggregateWindow(days(3, 10, 0), 14).acos).toBeNull();
    expect(aggregateWindow(days(2, 10, 40), 14).acos).toBeCloseTo(25, 5);
  });
});

describe('coefficientOfVariation', () => {
  it('is 0 for a flat series and rises with dispersion', () => {
    expect(coefficientOfVariation([10, 10, 10])).toBe(0);
    expect(coefficientOfVariation([0, 0, 60])).toBeGreaterThan(1);
  });
});

describe('assessBaseline', () => {
  it('accepts a steady, well-funded baseline', () => {
    expect(
      assessBaseline(aggregateWindow(days(14, 20), 14), Array(14).fill(20), T),
    ).toBeNull();
  });

  it('rejects a baseline below the minimum spend', () => {
    expect(
      assessBaseline(aggregateWindow(days(14, 1), 14), Array(14).fill(1), T),
    ).toBe('baseline_spend_too_low');
  });

  it('rejects a baseline with too few populated days', () => {
    // $200 total but only 4 days of it.
    expect(
      assessBaseline(aggregateWindow(days(4, 50), 14), Array(4).fill(50), T),
    ).toBe('baseline_days_too_sparse');
  });

  it('rejects a baseline too volatile to represent a normal level', () => {
    const spikes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 400];
    const rows = spikes.map((s, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      spend: s,
      sales: 0,
      clicks: 0,
      impressions: 0,
      orders: 0,
    }));
    expect(assessBaseline(aggregateWindow(rows, 14), spikes, T)).toBe(
      'baseline_too_volatile',
    );
  });

  it('rejects an empty baseline', () => {
    expect(assessBaseline(aggregateWindow([], 14), [], T)).toBe(
      'no_baseline_data',
    );
  });

  it('rejects a post window the sync has not reached, rather than reading it as a 100% collapse', () => {
    const goodPre = aggregateWindow(days(14, 20), 14);
    const emptyPost = aggregateWindow([], 3);
    expect(assessBaseline(goodPre, Array(14).fill(20), T, emptyPost)).toBe(
      'no_post_window_data',
    );
  });
});

describe('computeNormalizedComparison — unsynced post window', () => {
  it('refuses to normalize (and claims no savings) when no account data exists post-execution', () => {
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 20), 14),
      aggregateWindow([], 3),
      aggregateWindow(days(14, 200), 14),
      aggregateWindow([], 3), // sync hasn't reached these dates
      Array(14).fill(200),
      T,
    );
    expect(c.normalized).toBe(false);
    expect(c.insufficientBaselineReason).toBe('no_post_window_data');
    expect(c.accountMovementPct).toBeNull();
    // Falls back to the raw pre-rate, which is honest: the entity genuinely
    // has no recorded spend post-execution — but it is labelled raw.
    expect(conservativeSavingsMonthly(c)).toBeCloseTo(20 * 30, 5);
  });
});

describe('computeNormalizedComparison — difference-in-differences', () => {
  it('separates an entity-specific change from account-wide drift', () => {
    // Entity halves its spend ($20/day -> $10/day) while the whole account
    // also halves. The entity did nothing unusual: normalized delta ~0.
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 20), 14),
      aggregateWindow(days(14, 10), 14),
      aggregateWindow(days(14, 200), 14),
      aggregateWindow(days(14, 100), 14),
      Array(14).fill(200),
      T,
    );
    expect(c.normalized).toBe(true);
    expect(c.accountTrendFactor).toBeCloseTo(0.5, 5);
    expect(c.entityRawDeltaDaily).toBeCloseTo(-10, 5); // raw says "halved!"
    expect(c.counterfactualDaily).toBeCloseTo(10, 5);
    expect(c.normalizedDeltaDaily).toBeCloseTo(0, 5); // trend explains all of it
  });

  it('credits a real reduction when the account was flat', () => {
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 20), 14),
      aggregateWindow(days(14, 0), 14),
      aggregateWindow(days(14, 200), 14),
      aggregateWindow(days(14, 200), 14),
      Array(14).fill(200),
      T,
    );
    expect(c.accountMovementPct).toBeCloseTo(0, 5);
    expect(c.normalizedDeltaDaily).toBeCloseTo(-20, 5);
  });

  it('marks the comparison un-normalized (never silently raw) on a bad baseline', () => {
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 20), 14),
      aggregateWindow(days(14, 0), 14),
      aggregateWindow(days(14, 1), 14), // $14 total — under the $100 floor
      aggregateWindow(days(14, 1), 14),
      Array(14).fill(1),
      T,
    );
    expect(c.normalized).toBe(false);
    expect(c.insufficientBaselineReason).toBe('baseline_spend_too_low');
    expect(c.counterfactualDaily).toBeNull();
    expect(c.normalizedDeltaDaily).toBeNull();
    // Raw figures are still present — they're just labelled as raw.
    expect(c.entityRawDeltaDaily).toBeCloseTo(-20, 5);
  });
});

describe('conservativeSavingsMonthly', () => {
  it('discounts savings when the account was already declining', () => {
    // Account halved, so this term would have drifted to $10/day anyway.
    // Only the $10/day below THAT is genuinely attributable.
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 20), 14),
      aggregateWindow(days(14, 0), 14),
      aggregateWindow(days(14, 200), 14),
      aggregateWindow(days(14, 100), 14),
      Array(14).fill(200),
      T,
    );
    expect(conservativeSavingsMonthly(c)).toBeCloseTo(10 * 30, 5);
  });

  it("caps the counterfactual at the entity's own pre-rate when account trend rose", () => {
    // Account doubled. Trend-adjusted counterfactual would be $40/day, but
    // this entity never spent $40/day — claiming that is extrapolation.
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 20), 14),
      aggregateWindow(days(14, 0), 14),
      aggregateWindow(days(14, 100), 14),
      aggregateWindow(days(14, 200), 14),
      Array(14).fill(100),
      T,
    );
    expect(c.counterfactualDaily).toBeCloseTo(40, 5);
    expect(conservativeSavingsMonthly(c)).toBeCloseTo(20 * 30, 5); // capped at $20/day
  });

  it('claims nothing when spend did not actually fall', () => {
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 20), 14),
      aggregateWindow(days(14, 25), 14),
      aggregateWindow(days(14, 200), 14),
      aggregateWindow(days(14, 200), 14),
      Array(14).fill(200),
      T,
    );
    expect(conservativeSavingsMonthly(c)).toBeNull();
  });

  it('claims nothing when there was no baseline spend to eliminate', () => {
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 0), 14),
      aggregateWindow(days(14, 0), 14),
      aggregateWindow(days(14, 200), 14),
      aggregateWindow(days(14, 200), 14),
      Array(14).fill(200),
      T,
    );
    expect(conservativeSavingsMonthly(c)).toBeNull();
  });
});

describe('normalizedPctChange', () => {
  it('nets out account-wide movement in the same metric', () => {
    // Campaign ACOS 20% -> 30% looks like +50% raw, but the whole account's
    // ACOS also went 20% -> 30%, so nothing campaign-specific happened.
    const r = normalizedPctChange(20, 30, 20, 30);
    expect(r.rawPct).toBeCloseTo(50, 5);
    expect(r.normalizedPct).toBeCloseTo(0, 5);
  });

  it('returns a raw figure with a null normalized one when no account baseline exists', () => {
    const r = normalizedPctChange(20, 30, null, null);
    expect(r.rawPct).toBeCloseTo(50, 5);
    expect(r.normalizedPct).toBeNull();
  });
});

describe('buildSpendSummary', () => {
  it("follows the brief's pattern, stating the account movement it factored out", () => {
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 1.4), 14),
      aggregateWindow(days(14, 0), 14),
      aggregateWindow(days(14, 200), 14),
      aggregateWindow(days(14, 236), 14), // +18%
      Array(14).fill(200),
      T,
    );
    const s = buildSpendSummary('Term', c, conservativeSavingsMonthly(c));
    expect(s).toContain('Term spend $0.00/day since execution (was $1.40/day)');
    expect(s).toContain('Account-wide spend +18% over the same window');
    expect(s).toContain('savings stated net of trend');
  });

  it('says so explicitly instead of passing raw off as normalized', () => {
    const c = computeNormalizedComparison(
      aggregateWindow(days(14, 1.4), 14),
      aggregateWindow(days(14, 0), 14),
      aggregateWindow(days(14, 1), 14),
      aggregateWindow(days(14, 1), 14),
      Array(14).fill(1),
      T,
    );
    const s = buildSpendSummary('Term', c, conservativeSavingsMonthly(c));
    expect(s).toContain('Trend baseline insufficient');
    expect(s).toContain('raw comparison shown');
    expect(s).not.toContain('net of trend');
  });
});
