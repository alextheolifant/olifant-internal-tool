// ─── Evidence → fact-table resolution ───────────────────────────────────────
// The facts endpoint (GET /ppc/tasks/:id/facts) has to map an evidence number
// back to the daily rows that produced it. The brief is explicit that this
// must NOT be a per-rule mapping — every new rule would then need an API
// change.
//
// So the resolution is two generic lookups, neither of which knows a rule id:
//
//   1. WHICH TABLE — from the task's evidence provenance. Provenance records
//      the sync that sourced the metrics (see evidence.ts), and a sync type
//      maps 1:1 to the fact table it writes. Add a new rule reading an
//      existing sync type and this keeps working untouched.
//
//   2. WHICH COLUMNS — from a per-TABLE column alias map. An evidence key is
//      expandable if and only if it names a real column in the resolved
//      table. Anything else (expected_clicks_per_order, clicksThreshold,
//      monthlyWaste, …) is derived arithmetic with no stored row behind it,
//      and is reported as non-expandable rather than returning an empty
//      table the UI would render as "no data".

export type FactTable = 'campaign_metrics_daily' | 'search_term_metrics_daily' | 'target_metrics_daily';

/** sync_type → the fact table that sync writes. */
export const SYNC_TYPE_TO_FACT_TABLE: Record<string, FactTable> = {
  ads_metrics: 'campaign_metrics_daily',
  ads_metrics_retry: 'campaign_metrics_daily',
  ads_search_term: 'search_term_metrics_daily',
  ads_targeting: 'target_metrics_daily',
};

/**
 * Evidence key → the column in that table holding the same quantity.
 *
 * Keyed by table, not by rule. The left-hand side is the name a rule uses in
 * its evidence payload; the right-hand side is the physical column. Where a
 * rule already uses the column name verbatim the entry is an identity — kept
 * explicit anyway, because presence in this map is what makes a number
 * clickable, and an accidental omission should read as "not expandable"
 * rather than silently matching.
 */
export const EXPANDABLE_METRICS: Record<FactTable, Record<string, string>> = {
  campaign_metrics_daily: {
    impressions: 'impressions',
    clicks: 'clicks',
    spend: 'spend',
    sales: 'sales',
    orders: 'orders',
    acos: 'acos',
    // D4/D5 evidence names its windowed aggregates rather than the raw
    // column, but they expand into the same daily rows.
    trailing7dSpend: 'spend',
    trailing7dSales: 'sales',
    impressionsYesterday: 'impressions',
    baselineAvgDailySales: 'sales',
    baselineAvgDailySpend: 'spend',
  },
  search_term_metrics_daily: {
    impressions: 'impressions',
    clicks: 'clicks',
    cost: 'cost',
    sales: 'sales_7d',
    orders: 'orders_7d',
    sales7d: 'sales_7d',
    orders7d: 'orders_7d',
    units7d: 'units_7d',
  },
  target_metrics_daily: {
    impressions: 'impressions',
    clicks: 'clicks',
    cost: 'cost',
    sales: 'sales_7d',
    orders: 'orders_7d',
    sales7d: 'sales_7d',
    orders7d: 'orders_7d',
    units7d: 'units_7d',
  },
};

/**
 * Why a metric can't be expanded. Returned to the UI so it can render the
 * number as plain text instead of a dead link.
 */
export type NonExpandableReason =
  | 'derived' // computed from other numbers; no stored row holds it
  | 'unknown_fact_table' // provenance didn't identify a source sync
  | 'unknown_metric'; // not a column in the resolved table

export interface MetricResolution {
  expandable: boolean;
  factTable: FactTable | null;
  column: string | null;
  reason: NonExpandableReason | null;
}

export function resolveMetric(syncType: string | null | undefined, metricKey: string): MetricResolution {
  const factTable = syncType ? (SYNC_TYPE_TO_FACT_TABLE[syncType] ?? null) : null;
  if (!factTable) {
    return { expandable: false, factTable: null, column: null, reason: 'unknown_fact_table' };
  }
  const column = EXPANDABLE_METRICS[factTable][metricKey] ?? null;
  if (!column) {
    // Distinguish "we know this one is arithmetic" from "we don't recognise
    // it at all" — the UI renders both as non-interactive, but the former is
    // expected and the latter is worth noticing in logs.
    const reason: NonExpandableReason = DERIVED_METRIC_KEYS.has(metricKey) ? 'derived' : 'unknown_metric';
    return { expandable: false, factTable, column: null, reason };
  }
  return { expandable: true, factTable, column, reason: null };
}

/**
 * Evidence keys known to be computed rather than stored. Not a per-rule map —
 * it's a flat set of arithmetic outputs, and a rule adding a new derived
 * number simply falls through to 'unknown_metric', which the UI treats
 * identically. Listed so the common cases report the accurate reason.
 */
export const DERIVED_METRIC_KEYS = new Set<string>([
  'expectedClicksPerOrder',
  'expectationSampleClicks',
  'expectationSampleOrders',
  'clicksThreshold',
  'clicksMultiple',
  'monthlyWaste',
  'recentClickShare',
  'trailing7dAcos',
  'trailing30dAcos',
  'be',
  'multiplier',
  'minSpend',
  'isProfitable',
  'currentBudget',
  'trailingBaselineDaysMeetingBar',
  'trailingBaselineDaysRequired',
  'meaningfulImpressionsThreshold',
  'nearZeroThreshold',
]);

/** Every evidence key that could be offered as clickable for a given table. */
export function expandableKeysFor(factTable: FactTable | null): string[] {
  if (!factTable) return [];
  return Object.keys(EXPANDABLE_METRICS[factTable]);
}
