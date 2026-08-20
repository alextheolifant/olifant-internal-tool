// ─── Central design token file (v2 — approved brand) ─────────────────────────
//
// ALL color, typography, and visual decisions live here.
// Components MUST reference these tokens — zero hardcoded hex in JSX/TSX.
//
// TODO: Replace placeholder values with final Olifant brand assets when
// the full brand guide is delivered. Current palette approved as-is.

import type { Health, Tier, ClientStatus } from "./types";

// ── Health status tokens ──────────────────────────────────────────────────────
// stroke = SVG color used in sparklines (hex here, not in component attributes)
export const healthTokens: Record<
  Health,
  { text: string; bg: string; border: string; dot: string; stroke: string }
> = {
  on_target: {
    text:   "text-green-700",
    bg:     "bg-green-50",
    border: "border-green-400",
    dot:    "bg-green-400",
    stroke: "#2D8C04",
  },
  watch: {
    text:   "text-amber-700",
    bg:     "bg-amber-100",
    border: "border-amber-600",
    dot:    "bg-amber-600",
    stroke: "#CC9900",
  },
  act_now: {
    text:   "text-red-600",
    bg:     "bg-red-50",
    border: "border-red-600",
    dot:    "bg-red-600",
    stroke: "#E62415",
  },
  unknown: {
    text:   "text-neutral-500",
    bg:     "",
    border: "",
    dot:    "bg-neutral-400",
    stroke: "#A39A8F",
  },
};

// ── Tier badges ───────────────────────────────────────────────────────────────
export const tierTokens: Record<Tier, { bg: string; text: string; label: string }> = {
  1: { bg: "bg-ink",         text: "text-brand",        label: "T1" },
  2: { bg: "bg-yellow-200",  text: "text-amber-800",    label: "T2" },
  3: { bg: "bg-neutral-200", text: "text-neutral-500",  label: "T3" },
};

// ── Status badges ─────────────────────────────────────────────────────────────
export const statusTokens: Record<
  ClientStatus,
  { bg: string; text: string; dot: string; label: string }
> = {
  Active:     { bg: "bg-green-50",   text: "text-green-700", dot: "bg-green-400",  label: "Active" },
  Onboarding: { bg: "bg-blue-50",    text: "text-blue-700",  dot: "bg-blue-700",   label: "Onboarding" },
  Paused:     { bg: "bg-amber-100",  text: "text-amber-800", dot: "bg-amber-600",  label: "Paused" },
  Churned:    { bg: "bg-red-50",     text: "text-red-600",   dot: "bg-red-600",    label: "Churned" },
};

// ── PPC strategy badges ───────────────────────────────────────────────────────
export const strategyTokens: Record<
  "launch" | "growth" | "maintain",
  { bg: string; text: string; label: string }
> = {
  launch:   { bg: "bg-amber-100", text: "text-amber-800", label: "Launch" },
  growth:   { bg: "bg-blue-50",   text: "text-blue-700",  label: "Growth" },
  maintain: { bg: "bg-green-50",  text: "text-green-700", label: "Maintain" },
};

// ── Table chrome ──────────────────────────────────────────────────────────────
export const tableTokens = {
  headerBg:     "bg-neutral-100 border-b border-neutral-200",
  headerText:   "text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500",
  rowBorder:    "border-b border-neutral-200",
  rowHover:     "hover:bg-neutral-50",
  rowExpanded:  "bg-neutral-50",
  subRowBg:     "bg-neutral-100/60",
  cellPad:      "px-3 py-2.5",
  numericAlign: "text-right tabular-nums",
  nullText:     "text-neutral-400 select-none",
  inkText:      "text-ink font-medium",
  totalsRowBg:  "bg-neutral-100 border-t-2 border-neutral-300",
  totalsText:   "font-bold text-ink",
} as const;

// ── Control pill tokens ───────────────────────────────────────────────────────
export const controlTokens = {
  pillBase:     "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
  pillActive:   "bg-ink text-neutral-50 cursor-pointer",
  pillInactive: "text-neutral-500 hover:text-ink hover:bg-neutral-100 cursor-pointer",
  groupWrap:    "flex items-center rounded-lg border border-neutral-200 bg-neutral-100 p-[3px]",
} as const;

// ── Chart colors (referenced from theme — zero hardcoded hex in TSX) ─────────
// stroke hex values match the brand palette approved in the design brief
export const chartColors = {
  brand: { stroke: "#CC9900", fill: "rgba(204,153,0,0.12)" },
  dark:  { stroke: "#4A3F35", fill: "rgba(74,63,53,0.08)" },
} as const;

// ── Marketplace display ───────────────────────────────────────────────────────
export const marketplaceDisplay: Record<string, string> = {
  US: "US", CA: "CA", MX: "MX", BR: "BR",
  UK: "UK", DE: "DE", FR: "FR", ES: "ES", IT: "IT", NL: "NL",
  BE: "BE", SE: "SE", PL: "PL", TR: "TR", IE: "IE",
  AE: "AE", SA: "SA",
  JP: "JP", AU: "AU",
};

// ── Task queue: type + status treatments ─────────────────────────────────────
// Config objects, not inline conditionals — new task types and statuses land
// as each W-rule ships, and adding one should be a single entry here.
//
// TOKEN REUSE: every value below maps onto a token already defined above,
// with ONE exception. Placement's purple has no existing equivalent — there
// is no purple anywhere in this app or in globals.css — so it's the only new
// color introduced, declared here rather than inline.
export const taskTypePurple = "text-violet-700" as const;

// Colored word (not a chip), per the design brief.
export const taskTypeTokens: Record<string, { text: string; label: string }> = {
  negation:       { text: healthTokens.act_now.text,   label: "Negation" },
  bid_change:     { text: statusTokens.Onboarding.text, label: "Bid change" },
  harvest_launch: { text: healthTokens.on_target.text, label: "Harvest" },
  budget:         { text: healthTokens.watch.text,     label: "Budget" },
  placement:      { text: taskTypePurple,              label: "Placement" },
  pause:          { text: healthTokens.unknown.text,   label: "Pause" },
};

// Types the engine can emit that the brief's table doesn't assign a color to.
// Rendered in the default ink treatment rather than silently falling back to
// one of the six above, which would imply a category that wasn't intended.
export const taskTypeFallback = { text: tableTokens.inkText, label: "" } as const;

export function taskTypeToken(type: string): { text: string; label: string } {
  const known = taskTypeTokens[type];
  if (known) return known;
  // Humanise the raw enum value so an unmapped type still reads properly.
  return { text: taskTypeFallback.text, label: type.replace(/_/g, " ") };
}

// Status pills. "Verified" is the one inverted treatment — ink background
// with the brand yellow as text, which tierTokens[1] already expresses.
export const taskStatusTokens: Record<string, { bg: string; text: string; label: string }> = {
  pending:       { bg: tierTokens[2].bg,           text: tierTokens[2].text,           label: "Pending review" },
  approved:      { bg: statusTokens.Onboarding.bg, text: statusTokens.Onboarding.text, label: "Approved" },
  blocked:       { bg: tierTokens[3].bg,           text: tierTokens[3].text,           label: "Blocked" },
  executed:      { bg: healthTokens.on_target.bg,  text: healthTokens.on_target.text,  label: "Executed" },
  verified:      { bg: tierTokens[1].bg,           text: tierTokens[1].text,           label: "Verified" },
  verify_failed: { bg: healthTokens.act_now.bg,    text: healthTokens.act_now.text,    label: "Verify failed" },
  dismissed:     { bg: tierTokens[3].bg,           text: tierTokens[3].text,           label: "Dismissed" },
  expired:       { bg: tierTokens[3].bg,           text: tierTokens[3].text,           label: "Expired" },
};

export function taskStatusToken(status: string): { bg: string; text: string; label: string } {
  return taskStatusTokens[status] ?? { bg: tierTokens[3].bg, text: tierTokens[3].text, label: status };
}

// The impact bar (Part 4). Yellow, matching the brand accent already used
// for the tier-1 badge text.
// brand (#ffd046) is the palette's gold/yellow accent — the closed @theme
// block defines no yellow-400, so anything outside the listed families would
// silently render as no colour at all.
export const impactBarTokens = {
  track:  "bg-neutral-150",
  fill:   "bg-brand",
  height: "h-1",
} as const;

// Only these statuses can be bulk-approved. Everything else is excluded from
// selection entirely — see the state machine in the API's task-lifecycle.ts,
// which is the authority; this mirrors its 'pending -> approved' edge.
export const APPROVABLE_STATUSES = ["pending"] as const;
