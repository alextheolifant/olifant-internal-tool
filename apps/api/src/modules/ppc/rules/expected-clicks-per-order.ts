// ─── expected_clicks_per_order ──────────────────────────────────────────────
// W1's trigger is RELATIVE, not absolute: clicks ≥ 2 × expected_clicks_per_
// order. A keyword in a category that normally converts in 5 clicks must be
// judged differently from one that needs 40.
//
// Checked first (per the brief): this metric does not exist anywhere in the
// codebase — no column, no service, no prior derivation. Derived here.
//
// Basis: the AD GROUP's own trailing clicks-per-order, because that's the
// closest comparable population to a search term — same products, same bids,
// same match intent. Falls back to the parent CAMPAIGN when the ad group is
// too thin on its own, and reports which basis was used so the task's
// evidence can state it.
//
// The thin-data case is handled by refusing to answer, not by guessing: a
// brand-new ad group with 3 clicks and 0 orders has no meaningful
// clicks-per-order, and inventing one would make W1 negate on noise. When
// neither ad group nor campaign clears the minimum, W1 does not evaluate
// that term at all.

export type ExpectationBasis = 'ad_group' | 'campaign';

export interface ExpectationInput {
  clicks: number;
  orders: number;
}

export interface ExpectedClicksPerOrder {
  value: number;
  basis: ExpectationBasis;
  /** The population the figure was computed from, for evidence. */
  sampleClicks: number;
  sampleOrders: number;
}

export interface ExpectationThresholds {
  /**
   * Minimum ORDERS in the reference population. This is the binding
   * constraint: clicks-per-order is clicks ÷ orders, so the denominator's
   * sample size is what determines whether the ratio means anything. At 1
   * order the ratio is a single observation; at 10 it's a usable central
   * estimate.
   */
  minOrders: number;
  /**
   * Minimum CLICKS in the reference population. Guards the degenerate case
   * of a tiny population that happens to have converted — 12 clicks and 10
   * orders is a real ratio but far too small a base to extrapolate a
   * "normal" clicks-per-order for the whole ad group.
   */
  minClicks: number;
}

/**
 * Returns null when neither population is dense enough — the caller must
 * then skip evaluation entirely rather than substituting a default.
 */
export function deriveExpectedClicksPerOrder(
  adGroup: ExpectationInput | null,
  campaign: ExpectationInput | null,
  t: ExpectationThresholds,
): ExpectedClicksPerOrder | null {
  const fromAdGroup = tryDerive(adGroup, 'ad_group', t);
  if (fromAdGroup) return fromAdGroup;
  return tryDerive(campaign, 'campaign', t);
}

function tryDerive(
  input: ExpectationInput | null,
  basis: ExpectationBasis,
  t: ExpectationThresholds,
): ExpectedClicksPerOrder | null {
  if (!input) return null;
  if (input.orders < t.minOrders) return null;
  if (input.clicks < t.minClicks) return null;
  if (input.orders <= 0) return null; // defensive — minOrders is >= 1 in practice
  return {
    value: input.clicks / input.orders,
    basis,
    sampleClicks: input.clicks,
    sampleOrders: input.orders,
  };
}

/** Human-readable reason a term could not be evaluated, for logging. */
export function describeInsufficientExpectation(
  adGroup: ExpectationInput | null,
  campaign: ExpectationInput | null,
  t: ExpectationThresholds,
): string {
  const fmt = (i: ExpectationInput | null) =>
    i ? `${i.clicks} clicks / ${i.orders} orders` : 'no data';
  return (
    `expected_clicks_per_order unavailable — ad group (${fmt(adGroup)}) and campaign (${fmt(campaign)}) ` +
    `both below the minimum of ${t.minOrders} orders and ${t.minClicks} clicks`
  );
}
