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

  // Revenue requires orgRev (SP-API) — null until connected
  const revenue = orgRev !== null ? ppcRev + orgRev : null;

  // TACoS requires total revenue
  const tacos = revenue !== null && revenue > 0
    ? (spend / revenue) * 100
    : null;

  // ACoS is ad-spend / PPC revenue — Ads API only, always computable
  const acos = ppcRev > 0 ? (spend / ppcRev) * 100 : 0;

  // ROAS is PPC revenue / ad-spend — Ads API only
  const roas = spend > 0 ? ppcRev / spend : 0;

  // CPC, CTR, CVR — Ads API only
  const cpc = clicks > 0 ? spend / clicks : 0;
  const ctr = impr > 0 ? (clicks / impr) * 100 : 0;
  const cvr = clicks > 0 ? (ppcOrd / clicks) * 100 : 0;

  // Organic % requires orgRev
  const organicPct = revenue !== null && revenue > 0
    ? ((orgRev ?? 0) / revenue) * 100
    : null;

  // Total orders requires orgOrd (SP-API)
  const totalOrders = orgOrd !== null ? ppcOrd + orgOrd : null;

  return { revenue, tacos, acos, roas, cpc, ctr, cvr, organicPct, totalOrders };
}

/**
 * Sum two RawInputs objects component-by-component.
 * Null + number = null (SP-API data is still missing).
 */
export function sumRaw(a: RawInputs, b: RawInputs): RawInputs {
  return {
    spend:  a.spend  + b.spend,
    ppcRev: a.ppcRev + b.ppcRev,
    orgRev: a.orgRev !== null && b.orgRev !== null
              ? a.orgRev + b.orgRev
              : a.orgRev ?? b.orgRev,   // keep whichever is non-null; if both null → null
    ppcOrd: a.ppcOrd + b.ppcOrd,
    orgOrd: a.orgOrd !== null && b.orgOrd !== null
              ? a.orgOrd + b.orgOrd
              : a.orgOrd ?? b.orgOrd,
    clicks: a.clicks + b.clicks,
    impr:   a.impr   + b.impr,
    units:  a.units  !== null && b.units !== null
              ? a.units + b.units
              : a.units ?? b.units,
  };
}

export const ZERO_RAW: RawInputs = {
  spend: 0, ppcRev: 0, orgRev: null,
  ppcOrd: 0, orgOrd: null,
  clicks: 0, impr: 0, units: null,
};
