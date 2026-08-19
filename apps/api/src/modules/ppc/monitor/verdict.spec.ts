import type { WindowMetrics } from './monitor.types';
import {
  aggregateWindow,
  computeNormalizedComparison,
  type DailyFactRow,
} from './normalization';
import { buildVerdictBody, type VerdictInputs } from './verdict';

const T = { minBaselineSpend: 100, minBaselineDays: 7, maxBaselineCv: 1.0 };
const FLAGS = { acosDeteriorationPct: 25, impressionDropPct: 80 };

function days(
  n: number,
  spend: number,
  sales = 0,
  impressions = 0,
): DailyFactRow[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    spend,
    sales,
    clicks: 0,
    impressions,
    orders: 0,
  }));
}

function win(
  n: number,
  spend: number,
  sales = 0,
  impressions = 0,
): WindowMetrics {
  return aggregateWindow(days(n, spend, sales, impressions), n);
}

/** Entity eliminated its spend while the account stayed flat. */
function eliminatedSpend() {
  return computeNormalizedComparison(
    win(14, 20),
    win(14, 0),
    win(14, 200),
    win(14, 200),
    Array(14).fill(200),
    T,
  );
}

function baseInputs(overrides: Partial<VerdictInputs> = {}): VerdictInputs {
  return {
    taskType: 'negation',
    actionField: 'state',
    entityLabel: 'Term',
    entityPre: win(14, 20),
    entityPost: win(14, 0),
    campaignPre: win(14, 100, 500),
    campaignPost: win(14, 100, 500),
    spendComparison: eliminatedSpend(),
    campaignAcosNormalizedPct: 0,
    campaignAcosRawPct: 0,
    flagThresholds: FLAGS,
    ...overrides,
  };
}

describe('buildVerdictBody — diagnostic (investigate) tasks', () => {
  it('claims no attribution at all when the task changed no field', () => {
    const v = buildVerdictBody(
      baseInputs({ taskType: 'investigate', actionField: null }),
    );
    expect(v.notMeasurable).toContain('no field change');
    expect(v.verifiedSavingsMonthly).toBeNull();
    expect(v.summary).toContain('no system change was made');
    expect(v.notMeasurable).toContain('observational context only');
  });
});

describe('buildVerdictBody — negation / pause', () => {
  it('reports verified savings net of trend, with the campaign side-effect check', () => {
    const v = buildVerdictBody(baseInputs({ taskType: 'negation' }));
    expect(v.verifiedSavingsMonthly).toBeCloseTo(600, 5); // $20/day eliminated × 30
    expect(v.summary).toContain('savings stated net of trend');
    expect(v.summary).toContain('Parent campaign ACOS');
    expect(v.notMeasurable).toBeNull();
  });

  it('says it cannot measure when the entity type has no fact table', () => {
    const v = buildVerdictBody(
      baseInputs({
        taskType: 'pause',
        spendComparison: null,
        entityPre: null,
        entityPost: null,
      }),
    );
    expect(v.verifiedSavingsMonthly).toBeNull();
    expect(v.notMeasurable).toContain('No fact table');
  });
});

describe('buildVerdictBody — bid_change', () => {
  it('flags an impressions collapse past the threshold and never claims savings', () => {
    const v = buildVerdictBody(
      baseInputs({
        taskType: 'bid_change',
        actionField: 'bid',
        entityPre: win(14, 20, 100, 1000),
        entityPost: win(14, 5, 20, 50), // 95% impressions drop
        spendComparison: computeNormalizedComparison(
          win(14, 20, 100, 1000),
          win(14, 5, 20, 50),
          win(14, 200),
          win(14, 200),
          Array(14).fill(200),
          T,
        ),
      }),
    );
    const flag = v.flags.find((f) => f.kind === 'impressions_collapsed');
    expect(flag).toBeDefined();
    expect(flag!.observed).toBeCloseTo(95, 0);
    expect(v.summary).toContain('Impressions collapsed');
    // A bid change reallocates spend, it doesn't eliminate it — no savings claim.
    expect(v.verifiedSavingsMonthly).toBeNull();
  });

  it('does not flag a modest impressions decline', () => {
    const v = buildVerdictBody(
      baseInputs({
        taskType: 'bid_change',
        actionField: 'bid',
        entityPre: win(14, 20, 100, 1000),
        entityPost: win(14, 18, 90, 700), // 30% drop — under the 80% bar
      }),
    );
    expect(
      v.flags.find((f) => f.kind === 'impressions_collapsed'),
    ).toBeUndefined();
  });
});

describe('buildVerdictBody — auto-flag on campaign ACOS', () => {
  it('fires on the NORMALIZED deterioration, not the raw one', () => {
    // Raw looks catastrophic (+90%) but normalized is small (+5%) — the
    // account moved, not this campaign. Must NOT fire.
    const quiet = buildVerdictBody(
      baseInputs({ campaignAcosRawPct: 90, campaignAcosNormalizedPct: 5 }),
    );
    expect(
      quiet.flags.find((f) => f.kind === 'campaign_acos_deterioration'),
    ).toBeUndefined();

    // Raw looks mild but normalized is bad — the account improved while this
    // campaign got worse. Must fire.
    const loud = buildVerdictBody(
      baseInputs({ campaignAcosRawPct: 5, campaignAcosNormalizedPct: 60 }),
    );
    const flag = loud.flags.find(
      (f) => f.kind === 'campaign_acos_deterioration',
    );
    expect(flag).toBeDefined();
    expect(flag!.detail).toContain('normalized');
  });

  it('falls back to raw only when no trend baseline exists, and says so', () => {
    const v = buildVerdictBody(
      baseInputs({ campaignAcosRawPct: 60, campaignAcosNormalizedPct: null }),
    );
    const flag = v.flags.find((f) => f.kind === 'campaign_acos_deterioration');
    expect(flag).toBeDefined();
    expect(flag!.detail).toContain('trend baseline insufficient');
  });

  it('does not fire on an improving campaign', () => {
    const v = buildVerdictBody(
      baseInputs({ campaignAcosRawPct: -40, campaignAcosNormalizedPct: -40 }),
    );
    expect(v.flags).toHaveLength(0);
  });
});

describe('buildVerdictBody — budget', () => {
  it('states the capped-days gap rather than substituting a proxy', () => {
    const v = buildVerdictBody(
      baseInputs({
        taskType: 'budget',
        actionField: 'budget.budget',
        campaignPre: win(14, 100, 400),
        campaignPost: win(14, 150, 750),
      }),
    );
    expect(v.summary).toContain('Capped-days before/after not included');
    expect(v.summary).toContain('no out-of-budget signal is synced');
  });
});
