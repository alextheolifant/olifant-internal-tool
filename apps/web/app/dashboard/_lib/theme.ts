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

// ── Marketplace display ───────────────────────────────────────────────────────
export const marketplaceDisplay: Record<string, string> = {
  US: "US", CA: "CA", MX: "MX", BR: "BR", UK: "UK", DE: "DE",
};
