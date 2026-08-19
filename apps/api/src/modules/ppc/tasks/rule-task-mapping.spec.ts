import { mapCandidateToTaskContent } from './rule-task-mapping';

describe('mapCandidateToTaskContent', () => {
  it('D1: suggests a +25% budget increase and computes impact from real currentBudget', () => {
    const content = mapCandidateToTaskContent('D1', 'c1', {
      campaignName: 'SP | Auto | All',
      currentBudget: 50,
      trailing30dAcos: 12.5,
      be: 30,
    });
    expect(content.type).toBe('budget');
    expect(content.action.oldValue).toBe(50);
    expect(content.action.newValue).toBe(62.5); // 50 * 1.25
    expect(content.impactMonthlyUsd).toBeCloseTo((62.5 - 50) * 30, 5);
    expect(content.rollback).toContain('50.00');
  });

  it('D4: impact is wasted spend (vs BE-implied spend for the same sales) extrapolated to a month', () => {
    const content = mapCandidateToTaskContent('D4', 'c1', {
      campaignName: 'SP | Broad',
      trailing7dAcos: 60,
      trailing7dSpend: 700,
      trailing7dSales: 1000, // BE-implied spend at 30% would be 300 -> wasted = 400
      be: 30,
      minSpend: 50,
    });
    expect(content.type).toBe('investigate');
    const expectedWasted7d = 700 - (1000 * 30) / 100; // 400
    expect(content.impactMonthlyUsd).toBeCloseTo(
      expectedWasted7d * (30 / 7),
      5,
    );
    expect(content.action.oldValue).toBeNull(); // no field-level change — diagnostic only
  });

  it('D4: confidence is high at 3x+ the min spend gate, medium otherwise', () => {
    const high = mapCandidateToTaskContent('D4', 'c1', {
      campaignName: 'X',
      trailing7dAcos: 60,
      trailing7dSpend: 200, // 4x the $50 gate
      trailing7dSales: 100,
      be: 30,
      minSpend: 50,
    });
    expect(high.confidence).toBe('high');

    const medium = mapCandidateToTaskContent('D4', 'c1', {
      campaignName: 'X',
      trailing7dAcos: 60,
      trailing7dSpend: 55, // just over the $50 gate
      trailing7dSales: 20,
      be: 30,
      minSpend: 50,
    });
    expect(medium.confidence).toBe('medium');
  });

  it('D5: impact projects baseline average daily sales forward 30 days', () => {
    const content = mapCandidateToTaskContent('D5', 'c1', {
      campaignName: 'SP | Defense',
      impressionsYesterday: 0,
      trailingBaselineDaysMeetingBar: 6,
      baselineAvgDailySales: 45,
    });
    expect(content.type).toBe('investigate');
    expect(content.impactMonthlyUsd).toBeCloseTo(45 * 30, 5);
  });

  it('D5: confidence scales with how many baseline days met the serving bar', () => {
    expect(
      mapCandidateToTaskContent('D5', 'c1', {
        campaignName: 'X',
        impressionsYesterday: 0,
        trailingBaselineDaysMeetingBar: 7,
        baselineAvgDailySales: 10,
      }).confidence,
    ).toBe('high');
    expect(
      mapCandidateToTaskContent('D5', 'c1', {
        campaignName: 'X',
        impressionsYesterday: 0,
        trailingBaselineDaysMeetingBar: 5,
        baselineAvgDailySales: 10,
      }).confidence,
    ).toBe('medium');
    expect(
      mapCandidateToTaskContent('D5', 'c1', {
        campaignName: 'X',
        impressionsYesterday: 0,
        trailingBaselineDaysMeetingBar: 4, // the minimum required to fire at all
        baselineAvgDailySales: 10,
      }).confidence,
    ).toBe('provisional');
  });

  it('throws for a rule with no registered mapping', () => {
    expect(() => mapCandidateToTaskContent('D99', 'c1', {})).toThrow(
      /No task-content mapping/,
    );
  });
});
