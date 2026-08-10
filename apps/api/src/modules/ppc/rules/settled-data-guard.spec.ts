import { checkSettledData } from './settled-data-guard';

describe('checkSettledData', () => {
  const evaluationDate = '2026-08-04';

  it('is not settled for a brand-new campaign whose entire click history is inside the 14-day restatement window', () => {
    const clicks = [
      { date: '2026-08-01', clicks: 50 },
      { date: '2026-07-30', clicks: 40 },
      { date: '2026-07-28', clicks: 30 },
    ];
    const result = checkSettledData(clicks, evaluationDate);
    expect(result.recentClickShare).toBe(1);
    expect(result.isSettled).toBe(false);
  });

  it('is settled for a mature campaign where most clicks are older than 14 days', () => {
    const clicks = [
      // Older than 14 days from 2026-08-04 (cutoff is 2026-07-21)
      { date: '2026-07-01', clicks: 500 },
      { date: '2026-07-10', clicks: 500 },
      // Inside the restatement window
      { date: '2026-08-01', clicks: 50 },
    ];
    const result = checkSettledData(clicks, evaluationDate);
    expect(result.recentClickShare).toBeCloseTo(50 / 1050);
    expect(result.isSettled).toBe(true);
  });

  it('treats zero total clicks as settled (nothing to restate)', () => {
    const result = checkSettledData([], evaluationDate);
    expect(result.isSettled).toBe(true);
    expect(result.recentClickShare).toBe(0);
  });

  it('respects a custom materiality threshold', () => {
    const clicks = [
      { date: '2026-07-01', clicks: 60 },
      { date: '2026-08-01', clicks: 40 },
    ];
    // 40% recent share: settled at the default 50% threshold...
    expect(checkSettledData(clicks, evaluationDate).isSettled).toBe(true);
    // ...but not settled against a stricter 30% threshold.
    expect(checkSettledData(clicks, evaluationDate, 0.3).isSettled).toBe(false);
  });
});
