import { addDaysISO, aggregateWindow } from './campaign-window';

describe('aggregateWindow', () => {
  it('computes ACOS as a percentage (spend/sales * 100) over the window, not an average of daily ratios', () => {
    const rows = [
      { date: '2026-08-01', spend: 10, sales: 100, clicks: 5, impressions: 0 }, // 10% ACOS day
      { date: '2026-08-02', spend: 90, sales: 100, clicks: 5, impressions: 0 }, // 90% ACOS day
    ];
    const agg = aggregateWindow(rows, '2026-08-01', '2026-08-02');
    // Naive average of daily ACOS would be 50%; correct blended is 100/200 = 50%
    // here by coincidence — use an asymmetric case to actually distinguish them.
    expect(agg.acos).toBeCloseTo(50);

    const skewed = [
      { date: '2026-08-01', spend: 1, sales: 1000, clicks: 1, impressions: 0 }, // huge volume, tiny ACOS
      { date: '2026-08-02', spend: 90, sales: 10, clicks: 5, impressions: 0 }, // tiny volume, huge ACOS
    ];
    const skewedAgg = aggregateWindow(skewed, '2026-08-01', '2026-08-02');
    // Naive average of the two days' ACOS (0.1% and 900%) would be ~450%.
    // Correct blended: (1+90)/(1000+10) * 100 ≈ 9.01%.
    expect(skewedAgg.acos).toBeCloseTo((91 / 1010) * 100);
  });

  it('excludes rows outside the requested window', () => {
    const rows = [
      { date: '2026-07-01', spend: 1000, sales: 1, clicks: 1, impressions: 0 }, // outside
      { date: '2026-08-01', spend: 10, sales: 100, clicks: 5, impressions: 0 }, // inside
    ];
    const agg = aggregateWindow(rows, '2026-08-01', '2026-08-02');
    expect(agg.spend).toBe(10);
    expect(agg.sales).toBe(100);
  });

  it('returns null ACOS when there are no sales in the window', () => {
    const rows = [
      { date: '2026-08-01', spend: 50, sales: 0, clicks: 10, impressions: 0 },
    ];
    const agg = aggregateWindow(rows, '2026-08-01', '2026-08-01');
    expect(agg.acos).toBeNull();
  });
});

describe('addDaysISO', () => {
  it('adds (or subtracts) whole days, crossing month boundaries', () => {
    expect(addDaysISO('2026-08-01', -2)).toBe('2026-07-30');
    expect(addDaysISO('2026-08-01', 30)).toBe('2026-08-31');
  });
});
