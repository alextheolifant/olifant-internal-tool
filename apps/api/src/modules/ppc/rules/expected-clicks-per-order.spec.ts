import { deriveExpectedClicksPerOrder } from './expected-clicks-per-order';

const T = { minOrders: 10, minClicks: 30 };

describe('deriveExpectedClicksPerOrder', () => {
  it('prefers the ad group — the closest comparable population to a search term', () => {
    const r = deriveExpectedClicksPerOrder({ clicks: 200, orders: 20 }, { clicks: 5000, orders: 250 }, T);
    expect(r).not.toBeNull();
    expect(r!.basis).toBe('ad_group');
    expect(r!.value).toBeCloseTo(10, 5); // 200/20, not the campaign's 20
  });

  it('falls back to the campaign when the ad group is too thin on orders', () => {
    const r = deriveExpectedClicksPerOrder({ clicks: 500, orders: 3 }, { clicks: 5000, orders: 250 }, T);
    expect(r!.basis).toBe('campaign');
    expect(r!.value).toBeCloseTo(20, 5);
  });

  it('falls back to the campaign when the ad group is too thin on clicks', () => {
    // 12 orders clears minOrders, but 12 clicks is far too small a base.
    const r = deriveExpectedClicksPerOrder({ clicks: 12, orders: 12 }, { clicks: 5000, orders: 250 }, T);
    expect(r!.basis).toBe('campaign');
  });

  it('returns null when BOTH populations are thin — W1 then does not evaluate', () => {
    // The case that matters: a brand-new ad group in a brand-new campaign.
    // Inventing an expectation here is what makes a zero-sale rule negate
    // on noise.
    expect(deriveExpectedClicksPerOrder({ clicks: 4, orders: 0 }, { clicks: 9, orders: 1 }, T)).toBeNull();
  });

  it('returns null when there is no data at all', () => {
    expect(deriveExpectedClicksPerOrder(null, null, T)).toBeNull();
  });

  it('never divides by zero orders', () => {
    expect(deriveExpectedClicksPerOrder({ clicks: 5000, orders: 0 }, null, T)).toBeNull();
  });

  it('reports the sample it used, so evidence can state the basis', () => {
    const r = deriveExpectedClicksPerOrder({ clicks: 200, orders: 20 }, null, T);
    expect(r!.sampleClicks).toBe(200);
    expect(r!.sampleOrders).toBe(20);
  });

  it('makes the trigger relative: the same clicks judged against different populations', () => {
    // A 5-clicks-per-order category vs a 40-clicks-per-order one. At the
    // default 2x multiple, 30 clicks is wasteful in the first and
    // unremarkable in the second — which is the whole point of the metric.
    const fast = deriveExpectedClicksPerOrder({ clicks: 100, orders: 20 }, null, T)!; // 5
    const slow = deriveExpectedClicksPerOrder({ clicks: 400, orders: 10 }, null, T)!; // 40
    expect(30 >= 2 * fast.value).toBe(true);
    expect(30 >= 2 * slow.value).toBe(false);
  });
});
