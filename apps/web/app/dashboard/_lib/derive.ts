import type { RawInputs, DerivedMetrics } from "./types";

/**
 * Derive display metrics from raw API inputs.
 *
 * CRITICAL: Always sum raw inputs across accounts first, then call derive()
 * ONCE on the totals. Never average ACoS, TACoS, ROAS, or any ratio —
 * that produces incorrect portfolio-level numbers.
 */
export function derive(raw: RawInputs): DerivedMetrics {
  const { spend, ppcRev, orgRev, ppcOrd, orgOrd, clicks, impr } = raw;

  const revenue = orgRev !== null ? ppcRev + orgRev : null;
  const tacos = revenue !== null && revenue > 0 ? (spend / revenue) * 100 : null;
  const acos  = ppcRev  > 0 ? (spend  / ppcRev) * 100 : null;
  const roas  = spend   > 0 ? ppcRev  / spend         : null;
  const cpc   = clicks  > 0 ? spend   / clicks        : null;
  const ctr   = impr    > 0 ? (clicks / impr)   * 100 : null;
  const cvr   = clicks  > 0 ? (ppcOrd / clicks) * 100 : null;

  const organicPct = revenue !== null && revenue > 0
    ? ((orgRev ?? 0) / revenue) * 100
    : null;

  const totalOrders = orgOrd !== null ? ppcOrd + orgOrd : null;

  return { revenue, tacos, acos, roas, cpc, ctr, cvr, organicPct, totalOrders };
}

