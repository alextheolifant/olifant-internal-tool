// ─── v2 Number formatters ─────────────────────────────────────────────────────
// Null → em dash "—". Formats match the approved design spec.

export const EM_DASH = "—";

/** $1,234 / £1,234 / €1,234 (integer, currency-aware) */
export function cur(n: number | null, currencyCode = "USD", approx = false): string {
  if (n === null || n === undefined) return EM_DASH;
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(n));
  return approx ? `~${s}` : s;
}

/** $1.23 / £1.23 (2 decimal — used for CPC) */
export function cur2(n: number | null, currencyCode = "USD", approx = false): string {
  if (n === null || n === undefined) return EM_DASH;
  const s = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(n);
  return approx ? `~${s}` : s;
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

/**
 * Determine display currency from a set of account currency codes.
 * Single unique code → use it, approx=false.
 * Mixed codes → USD + approx=true (values were summed without FX conversion;
 * callers should render with a "~" prefix via cur/cur2's approx param).
 */
export function resolveCurrency(codes: (string | undefined | null)[]): { code: string; approx: boolean } {
  const unique = [...new Set(codes.filter((c): c is string => !!c))];
  if (unique.length === 0) return { code: "USD", approx: false };
  if (unique.length === 1) return { code: unique[0], approx: false };
  return { code: "USD", approx: true };
}
