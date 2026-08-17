import { d4AcosBlowoutRule } from './d4-acos-blowout.rule';
import { makeThresholdResolver } from './thresholds';
import type { LedgerRepository } from '../ledger/ledger.repository';
import type { SearchTermRepository } from './search-term.repository';
import type { CampaignMetricsRepository } from './campaign-metrics.repository';
import type { CampaignWithDailyMetrics } from './campaign-window';
import type { RuleEvalContext } from './types';

function fakeRepo(campaigns: CampaignWithDailyMetrics[]): CampaignMetricsRepository {
  return {
    getEnabledCampaignsWithDailyMetrics: async () => campaigns,
  } as unknown as CampaignMetricsRepository;
}

// D4 doesn't touch the ledger — only D3 does — so an unimplemented stub is
// enough to satisfy RuleEvalContext's shape here.
const fakeLedger = {} as unknown as LedgerRepository;
// Only W1 reads the search-term grain — a stub satisfies the context shape.
const fakeSearchTerms = {} as unknown as SearchTermRepository;

function dailyRow(date: string, spend: number, sales: number, clicks = 10, impressions = 0) {
  return { date, spend, sales, clicks, impressions };
}

describe('d4AcosBlowoutRule', () => {
  const evaluationDate = '2026-08-04'; // window: trailing 7d ending T-2 = 2026-07-27..2026-08-02

  function makeCtx(campaigns: CampaignWithDailyMetrics[], overrides: Record<string, number> = {}): RuleEvalContext {
    return {
      clientId: 'client-1',
      evaluationDate,
      resolveThreshold: makeThresholdResolver(overrides),
      be: { value: 30, isFallback: true },
      campaignMetrics: fakeRepo(campaigns),
      ledger: fakeLedger,
      searchTerms: fakeSearchTerms,
    };
  }

  it('fires (holdsAtEnter) when trailing 7d ACOS exceeds 2x BE on sufficient spend, on a mature campaign', () => {
    // Mature campaign: plenty of older clicks so the settled-data guard passes.
    const daily = [dailyRow('2026-06-01', 10, 100, 500)];
    for (let d = 27; d <= 31; d++) daily.push(dailyRow(`2026-07-${d}`, 20, 10, 5)); // 200% ACOS days
    daily.push(dailyRow('2026-08-01', 20, 10, 5));
    daily.push(dailyRow('2026-08-02', 20, 10, 5));

    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'Test', dailyMetrics: daily }]);
    return d4AcosBlowoutRule.evaluate(ctx).then((results) => {
      expect(results).toHaveLength(1);
      expect(results[0].holdsAtEnter).toBe(true);
      expect(results[0].evidence.be).toBe(30);
      expect(results[0].evidence.beIsFallback).toBe(true);
    });
  });

  it('does not fire below the minimum spend threshold', async () => {
    const daily = [dailyRow('2026-06-01', 1, 10, 500), dailyRow('2026-07-28', 5, 1, 5)]; // huge ACOS, tiny spend
    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'Test', dailyMetrics: daily }], { d4_min_spend: 1000 });
    const results = await d4AcosBlowoutRule.evaluate(ctx);
    expect(results).toHaveLength(0);
  });

  it('respects threshold overrides for the multiplier', async () => {
    const daily = [dailyRow('2026-06-01', 10, 100, 500)];
    for (let d = 27; d <= 31; d++) daily.push(dailyRow(`2026-07-${d}`, 12, 10, 5)); // 120% ACOS
    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'Test', dailyMetrics: daily }], {
      d4_acos_multiplier: 5.0, // 5x BE(30) = 150% — 120% doesn't clear this
    });
    const results = await d4AcosBlowoutRule.evaluate(ctx);
    expect(results[0].holdsAtEnter).toBe(false);
  });

  it('is blocked by the settled-data guard for a brand-new campaign', async () => {
    // All clicks are recent — no mature history at all.
    const daily = [
      dailyRow('2026-07-28', 20, 10, 50),
      dailyRow('2026-07-29', 20, 10, 50),
      dailyRow('2026-08-01', 20, 10, 50),
    ];
    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'New', dailyMetrics: daily }]);
    const results = await d4AcosBlowoutRule.evaluate(ctx);
    expect(results).toHaveLength(0);
  });

  it('is deterministic: evaluating the same inputs twice yields identical results', async () => {
    const daily = [dailyRow('2026-06-01', 10, 100, 500)];
    for (let d = 27; d <= 31; d++) daily.push(dailyRow(`2026-07-${d}`, 20, 10, 5));
    const campaigns = [{ campaignId: 'c1', campaignName: 'Test', dailyMetrics: daily }];

    const run1 = await d4AcosBlowoutRule.evaluate(makeCtx(campaigns));
    const run2 = await d4AcosBlowoutRule.evaluate(makeCtx(campaigns));
    expect(run1).toEqual(run2);
  });
});
