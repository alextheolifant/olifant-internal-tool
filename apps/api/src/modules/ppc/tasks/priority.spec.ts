import { computePriorityScore, sortTierForBand } from './priority';

describe('computePriorityScore', () => {
  it('applies impact ÷ est_minutes × confidence × client multiplier', () => {
    const score = computePriorityScore({
      impactMonthlyUsd: 300,
      estMinutes: 15,
      confidence: 'high',
      clientMultiplier: 1.0,
    });
    expect(score).toBe(20); // 300/15 = 20 * 1.0 * 1.0
  });

  it('medium confidence applies the 0.7 multiplier', () => {
    const score = computePriorityScore({
      impactMonthlyUsd: 300,
      estMinutes: 15,
      confidence: 'medium',
      clientMultiplier: 1.0,
    });
    expect(score).toBe(14); // 20 * 0.7 = 14
  });

  it('provisional confidence applies the 0.4 multiplier', () => {
    const score = computePriorityScore({
      impactMonthlyUsd: 300,
      estMinutes: 15,
      confidence: 'provisional',
      clientMultiplier: 1.0,
    });
    expect(score).toBe(8); // 20 * 0.4 = 8
  });

  it('client multiplier escalates the score', () => {
    const score = computePriorityScore({
      impactMonthlyUsd: 300,
      estMinutes: 15,
      confidence: 'high',
      clientMultiplier: 2.0,
    });
    expect(score).toBe(40);
  });

  it('null impact (no $ estimate available) scores 0, not an error', () => {
    const score = computePriorityScore({
      impactMonthlyUsd: null,
      estMinutes: 15,
      confidence: 'high',
      clientMultiplier: 1.0,
    });
    expect(score).toBe(0);
  });
});

describe('sortTierForBand', () => {
  it('D-band gets tier 0 (sorts first)', () => {
    expect(sortTierForBand('D')).toBe(0);
  });

  it('every non-D band gets tier 1 (sorts after D, regardless of which band)', () => {
    expect(sortTierForBand('W')).toBe(1);
    expect(sortTierForBand('S')).toBe(1);
    expect(sortTierForBand('M')).toBe(1);
    expect(sortTierForBand('I')).toBe(1);
    expect(sortTierForBand('G')).toBe(1);
  });
});
