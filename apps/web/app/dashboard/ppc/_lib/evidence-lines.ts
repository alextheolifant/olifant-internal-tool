import type { TaskDetail } from "./ppc-task-detail-api";

// ─── Evidence terminal content ──────────────────────────────────────────────
// Builds the terminal's lines from the task's own evidence payload. Pure, so
// the formatting rules are testable without rendering.
//
// Deliberately generic: nothing here branches on rule id. Which numbers are
// clickable comes from the API's expandableMetrics (resolved server-side from
// provenance), and which are disclosed as fallbacks comes from the API's
// fallbacks map. A new rule with new evidence keys renders correctly with no
// change here.

export interface EvidenceValue {
  key: string;
  label: string;
  display: string;
  // Only true when the API says this metric resolves to real fact rows.
  expandable: boolean;
}

export interface EvidenceLine {
  label: string;
  values: EvidenceValue[];
}

/** Human wording for why a value is a fallback rather than a real reading. */
export const FALLBACK_DISCLOSURES: Record<string, string> = {
  be: "account default — no product economics set",
};

export function fallbackDisclosure(key: string): string {
  return FALLBACK_DISCLOSURES[key] ?? "fallback value — not configured for this entity";
}

// Keys that are structural rather than measurements — they're rendered in
// their own lines (window, source, cross-check) or not at all, so they must
// not also appear in the metric rows.
const STRUCTURAL_KEYS = new Set([
  "windowStart", "windowEnd", "trailingBaselineWindow", "yesterdayDate",
  "winnersElsewhere", "winnerCrossCheckPerformed", "scope",
  "campaignId", "campaignName", "adGroupId", "keywordId", "normalizedTerm",
  "searchTerm", "matchType", "campaignState", "budgetStatus",
]);

// Keys that are percentages but whose NAME doesn't say so. Matched exactly
// rather than by substring: a loose pattern for "be" would also catch
// unrelated keys that merely contain those letters.
const PERCENT_KEYS = new Set(["be", "multiplier"]);

export function formatMetricValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    // Money-ish keys read better with 2dp; counts stay integers.
    if (/cost|spend|sales|waste|budget|impact/i.test(key)) return `$${value.toFixed(2)}`;
    if (PERCENT_KEYS.has(key) || /acos|share|pct|percent|rate/i.test(key)) return `${value.toFixed(1)}%`;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

/** Formats an ISO date as "Jun 25", matching the brief's terminal sample. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function buildWindowLine(detail: TaskDetail): string | null {
  const w = detail.evidence.window;
  if (!w) return null;
  return `${shortDate(w.start)} – ${shortDate(w.end)}`;
}

/**
 * The measurement rows. Expandable metrics come first so the clickable
 * numbers cluster together, then the remaining derived/context values.
 */
export function buildMetricValues(detail: TaskDetail): EvidenceValue[] {
  const { metrics, expandableMetrics } = detail.evidence;
  const expandable = new Set(expandableMetrics);
  const out: EvidenceValue[] = [];

  for (const [key, value] of Object.entries(metrics)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    if (typeof value === "object" && value !== null) continue; // nested payloads aren't terminal lines
    out.push({
      key,
      label: humanizeKey(key),
      display: formatMetricValue(key, value),
      expandable: expandable.has(key),
    });
  }

  return out.sort((a, b) => Number(b.expandable) - Number(a.expandable));
}

/** One line per fallback the API flagged. Never omitted when flagged. */
export function buildFallbackLines(detail: TaskDetail): { key: string; display: string; disclosure: string }[] {
  return Object.entries(detail.evidence.fallbacks)
    .filter(([, isFallback]) => isFallback === true)
    .map(([key]) => ({
      key,
      display: formatMetricValue(key, detail.evidence.metrics[key]),
      disclosure: fallbackDisclosure(key),
    }));
}

export function buildSourceLine(detail: TaskDetail): string {
  const p = detail.evidence.provenance;
  const parts: string[] = [];
  parts.push(p.syncType ? `${p.syncType} report` : "source unknown");
  if (p.reportJobId) parts.push(`job ${p.reportJobId.slice(0, 8)}`);
  if (p.syncedAt) parts.push(`pulled ${shortDate(p.syncedAt)}`);
  return parts.join(" · ");
}
