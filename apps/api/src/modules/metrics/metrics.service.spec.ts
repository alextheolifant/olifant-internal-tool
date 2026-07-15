import { deriveMetrics, floorOrgRev } from './metrics.service';

describe('deriveMetrics', () => {
  it('returns null revenue/tacos/organicPct when orgRev is null (not SP-API connected)', () => {
    const d = deriveMetrics(1000, 5000, 50, 200, 4000, null);

    expect(d.revenue).toBeNull();
    expect(d.tacos).toBeNull();
    expect(d.organicPct).toBeNull();
    // PPC-only metrics are unaffected by SP-API connection status.
    expect(d.acos).toBeCloseTo(20);
    expect(d.roas).toBeCloseTo(5);
  });

  it('computes real revenue/tacos/organicPct once orgRev is known', () => {
    const d = deriveMetrics(1000, 5000, 50, 200, 4000, 15000);

    expect(d.revenue).toBe(20000);
    expect(d.tacos).toBeCloseTo((1000 / 20000) * 100);
    expect(d.organicPct).toBeCloseTo((15000 / 20000) * 100);
  });

  it('does not divide by zero when revenue is exactly 0', () => {
    const d = deriveMetrics(0, 0, 0, 0, 0, 0);

    expect(d.revenue).toBe(0);
    expect(d.tacos).toBe(0);
    expect(d.organicPct).toBe(0);
  });
});

describe('floorOrgRev', () => {
  it('returns the real difference when total sales exceed PPC revenue', () => {
    expect(floorOrgRev(20000, 5000)).toEqual({ orgRev: 15000, floored: false });
  });

  it('floors at 0 and flags it when SP-API total sales come in under PPC revenue', () => {
    // Expected on recent days given attribution timing drift between the two APIs.
    expect(floorOrgRev(4000, 5000)).toEqual({ orgRev: 0, floored: true });
  });

  it('treats an exact match as not floored', () => {
    expect(floorOrgRev(5000, 5000)).toEqual({ orgRev: 0, floored: false });
  });
});
