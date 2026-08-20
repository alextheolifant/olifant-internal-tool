import { d1OutOfBudgetProfitableRule } from './d1-out-of-budget-profitable.rule';
import { makeThresholdResolver } from './thresholds';
import type { LedgerRepository } from '../ledger/ledger.repository';
import type { SearchTermRepository } from './search-term.repository';
import type { CampaignMetricsRepository } from './campaign-metrics.repository';
import type { CampaignWithDailyMetrics } from './campaign-window';
import type { RuleEvalContext } from './types';

function fakeRepo(
  campaigns: CampaignWithDailyMetrics[],
): CampaignMetricsRepository {
  return {
    getEnabledCampaignsWithDailyMetrics: async () => campaigns,
  } as unknown as CampaignMetricsRepository;
}

// D1 doesn't touch the ledger — only D3 does — so an unimplemented stub is
// enough to satisfy RuleEvalContext's shape here.
const fakeLedger = {} as unknown as LedgerRepository;
// Only W1 reads the search-term grain — a stub satisfies the context shape.
const fakeSearchTerms = {} as unknown as SearchTermRepository;

describe('d1OutOfBudgetProfitableRule', () => {
  const evaluationDate = '2026-08-04';

  it('never emits (holdsAtEnter always false) since no budget-capped signal is synced — even for a genuinely profitable campaign', async () => {
    const daily = [
      {
        date: '2026-07-10',
        spend: 100,
        sales: 1000,
        clicks: 50,
        impressions: 0,
      },
    ]; // 10% ACOS, way under a 30% BE
    const ctx: RuleEvalContext = {
      clientId: 'client-1',
      evaluationDate,
      resolveThreshold: makeThresholdResolver({}),
      be: { value: 30, isFallback: true },
      campaignMetrics: fakeRepo([
        { campaignId: 'c1', campaignName: 'Profitable', dailyMetrics: daily },
      ]),
      ledger: fakeLedger,
      searchTerms: fakeSearchTerms,
    };

    const results = await d1OutOfBudgetProfitableRule.evaluate(ctx);
    expect(results).toHaveLength(1);
    // The profitability half is computed correctly and visible in evidence...
    expect(results[0].evidence.isProfitable).toBe(true);
    // ...but the rule can never actually fire without the missing signal.
    expect(results[0].holdsAtEnter).toBe(false);
    expect(results[0].holdsAtClear).toBe(false);
    expect(results[0].evidence.budgetCappedSignal).toContain('unavailable');
  });

  it('skips campaigns with no sales in the window (nothing to compare)', async () => {
    const daily = [
      { date: '2026-07-10', spend: 100, sales: 0, clicks: 50, impressions: 0 },
    ];
    const ctx: RuleEvalContext = {
      clientId: 'client-1',
      evaluationDate,
      resolveThreshold: makeThresholdResolver({}),
      be: { value: 30, isFallback: true },
      campaignMetrics: fakeRepo([
        { campaignId: 'c1', campaignName: 'NoSales', dailyMetrics: daily },
      ]),
      ledger: fakeLedger,
      searchTerms: fakeSearchTerms,
    };
    const results = await d1OutOfBudgetProfitableRule.evaluate(ctx);
    expect(results).toHaveLength(0);
  });
});
