import { d5DeliveryStoppedRule } from './d5-delivery-stopped.rule';
import { makeThresholdResolver } from './thresholds';
import type { CampaignMetricsRepository } from './campaign-metrics.repository';
import type { CampaignWithDailyMetrics, DailyMetricRow } from './campaign-window';
import type { RuleEvalContext } from './types';

function fakeRepo(campaigns: CampaignWithDailyMetrics[]): CampaignMetricsRepository {
  return { getEnabledCampaignsWithDailyMetrics: async () => campaigns } as unknown as CampaignMetricsRepository;
}

function row(date: string, impressions: number): DailyMetricRow {
  return { date, spend: 0, sales: 0, clicks: 0, impressions };
}

describe('d5DeliveryStoppedRule', () => {
  const evaluationDate = '2026-08-04'; // yesterday (T-2) = 2026-08-02; baseline = 2026-07-26..2026-08-01

  function makeCtx(campaigns: CampaignWithDailyMetrics[], overrides: Record<string, number> = {}): RuleEvalContext {
    return {
      clientId: 'client-1',
      evaluationDate,
      resolveThreshold: makeThresholdResolver(overrides),
      be: { value: 30, isFallback: true },
      campaignMetrics: fakeRepo(campaigns),
    };
  }

  function baselineServingDays(): DailyMetricRow[] {
    // 6 of 7 baseline days meaningfully serving (>= default 10) — well past
    // the majority (4/7) bar.
    return [
      row('2026-07-26', 50),
      row('2026-07-27', 40),
      row('2026-07-28', 60),
      row('2026-07-29', 55),
      row('2026-07-30', 45),
      row('2026-07-31', 0),
      row('2026-08-01', 30),
    ];
  }

  it('fires when a previously-serving campaign has ~0 impressions yesterday', async () => {
    const daily = [...baselineServingDays(), row('2026-08-02', 0)];
    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'Stopped', dailyMetrics: daily }]);
    const results = await d5DeliveryStoppedRule.evaluate(ctx);

    expect(results).toHaveLength(1);
    expect(results[0].holdsAtEnter).toBe(true);
    expect(results[0].evidence.impressionsYesterday).toBe(0);
    expect(results[0].evidence.trailingBaselineDaysMeetingBar).toBe(6);
    expect(results[0].evidence.budgetStatus).toContain('unknown');
  });

  it('does not fire for a campaign that was never really serving (majority of baseline days below the bar)', async () => {
    const daily = [
      row('2026-07-26', 1),
      row('2026-07-27', 0),
      row('2026-07-28', 2),
      row('2026-07-29', 0),
      row('2026-07-30', 1),
      row('2026-07-31', 0),
      row('2026-08-01', 0),
      row('2026-08-02', 0), // yesterday also 0
    ];
    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'AlwaysQuiet', dailyMetrics: daily }]);
    const results = await d5DeliveryStoppedRule.evaluate(ctx);
    expect(results).toHaveLength(0);
  });

  it('does not fire when the campaign is still delivering normally', async () => {
    const daily = [...baselineServingDays(), row('2026-08-02', 40)];
    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'StillGoing', dailyMetrics: daily }]);
    const results = await d5DeliveryStoppedRule.evaluate(ctx);
    expect(results).toHaveLength(1);
    expect(results[0].holdsAtEnter).toBe(false);
  });

  it('respects a threshold override for what counts as "meaningful" prior serving', async () => {
    // Baseline days are 50,40,60,55,45,0,30 — only 3 (50,60,55) clear a
    // raised bar of 46, below the 4-day majority.
    const daily = [...baselineServingDays(), row('2026-08-02', 0)];
    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'Borderline', dailyMetrics: daily }], {
      d5_meaningful_impressions: 46,
    });
    const results = await d5DeliveryStoppedRule.evaluate(ctx);
    expect(results).toHaveLength(0);
  });

  it('hysteresis: clear threshold is looser (higher) than enter for this low-is-bad metric', async () => {
    // Default enter=2, clear=2/0.85≈2.35 → 2 impressions still holds at clear.
    const daily = [...baselineServingDays(), row('2026-08-02', 2)];
    const ctx = makeCtx([{ campaignId: 'c1', campaignName: 'Borderline', dailyMetrics: daily }]);
    const results = await d5DeliveryStoppedRule.evaluate(ctx);
    expect(results[0].holdsAtEnter).toBe(true); // 2 <= 2
    expect(results[0].holdsAtClear).toBe(true); // 2 <= 2.35
  });
});
