// ─── v2 Number formatters ─────────────────────────────────────────────────────
// Null → em dash "—". Formats match the approved design spec.

import type { DateRange } from "./types";

/** Human-readable label for each date range (re-exported for convenience). */
export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "7d":  "Last 7 days",
  "mtd": "Month to date",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export const EM_DASH = "—";

/** $1,234 (integer dollars, thousands-separated) */
export function cur(n: number | null): string {
  if (n === null || n === undefined) return EM_DASH;
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** $1.23 (2 decimal dollars — used for CPC) */
export function cur2(n: number | null): string {
  if (n === null || n === undefined) return EM_DASH;
  return "$" + n.toFixed(2);
}

/** 13.5% (1 decimal percentage) */
export function pct(n: number | null, decimals = 1): string {
  if (n === null || n === undefined) return EM_DASH;
  return n.toFixed(decimals) + "%";
}

/** 3.88x (ROAS multiplier) */
export function xfmt(n: number | null): string {
  if (n === null || n === undefined) return EM_DASH;
  return n.toFixed(2) + "x";
}

/** 1,234 (integer, thousands-separated — clicks, impressions, orders, units) */
export function intfmt(n: number | null): string {
  if (n === null || n === undefined) return EM_DASH;
  return Math.round(n).toLocaleString("en-US");
}

