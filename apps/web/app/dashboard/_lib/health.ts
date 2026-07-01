import type { Health } from "./types";
import { healthTokens } from "./theme";

/** Return theme tokens for a health value. */
export function getHealthTokens(health: Health) {
  return healthTokens[health] ?? healthTokens.unknown;
}

/**
 * Derive row-level health from TACoS vs goal.
 * Falls back to "unknown" when either value is null.
 */
export function deriveHealth(
  tacos: number | null,
  goalTacos: number | null
): Health {
  if (tacos === null || goalTacos === null) return "unknown";
  if (tacos <= goalTacos) return "on_target";
  if (tacos <= goalTacos * 1.25) return "watch";
  return "act_now";
}

/**
 * Color a metric value against per-metric thresholds.
 * Returns a Tailwind text-color class string.
 *
 * Single source of truth for threshold → color mapping — never inline in JSX.
 */
export function metricColor(
  metric: "acos" | "tacos" | "roas" | "cvr" | "ctr" | "organicPct",
  value: number | null
): string {
  if (value === null) return "text-neutral-400";

  switch (metric) {
    case "acos":
    case "tacos":
      if (value < 20) return "text-green-700";
      if (value < 30) return "text-amber-700";
      return "text-red-600";

    case "roas":
      if (value >= 4)  return "text-green-700";
      if (value >= 2.5) return "text-amber-700";
      return "text-red-600";

    case "cvr":
      if (value >= 3)  return "text-green-700";
      if (value >= 1.5) return "text-amber-700";
      return "text-red-600";

    case "organicPct":
      // Higher organic % = better (less reliant on paid ads)
      if (value >= 30) return "text-green-700";
      if (value >= 10) return "text-neutral-600";
      return "text-neutral-400";

    default:
      return "text-ink";
  }
}

/** Color the TACoS cell based on its relationship to the goal. */
export function tacosGoalColor(tacos: number, goalTacos: number): string {
  if (tacos <= goalTacos)        return "text-green-700";
  if (tacos <= goalTacos * 1.25) return "text-amber-700";
  return "text-red-600";
}
