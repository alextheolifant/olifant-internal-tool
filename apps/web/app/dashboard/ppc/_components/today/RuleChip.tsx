import { healthTokens, tierTokens } from "../../../_lib/theme";
import type { GuardColor } from "../../_lib/ppc-today-api";

// D-rules use the standard exception (guard-color) treatment — the backend
// already returns guardColor per exception, straight off the same Health
// enum healthTokens is keyed by, so no re-mapping needed here.
//
// G-rules are a distinct fourth color family: "same yellow as pending
// status." No literal "pending status" token exists anywhere in this
// codebase (searched) — tierTokens[2] (bg-yellow-200/text-amber-800) is the
// ONLY yellow (as opposed to amber) token theme.ts defines, so it's used
// here as the closest existing match rather than inventing a new color.
// Flagging this interpretation for confirmation. No G-rules exist yet; this
// mapping just ensures one isn't retrofitted later.
export function ruleChipTokens(ruleId: string, guardColor: GuardColor): { bg: string; text: string } {
  if (ruleId.startsWith("G")) return { bg: tierTokens[2].bg, text: tierTokens[2].text };
  return { bg: healthTokens[guardColor].bg, text: healthTokens[guardColor].text };
}

export function RuleChip({ ruleId, guardColor }: { ruleId: string; guardColor: GuardColor }) {
  const t = ruleChipTokens(ruleId, guardColor);
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${t.bg} ${t.text}`}>
      {ruleId}
    </span>
  );
}
