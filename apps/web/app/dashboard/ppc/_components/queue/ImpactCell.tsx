import { cur, EM_DASH } from "../../../_lib/format";
import { impactBarTokens, tableTokens } from "../../../_lib/theme";

// Impact figure in mono, with a thin proportional bar beneath.
//
// The fraction comes from the API (relative to the largest impact in the
// current result set) and is never recomputed here — which also means it
// re-proportions correctly on its own whenever filters change the set.
//
// Null impact is a distinct case from zero: some tasks carry no dollar
// figure at all, and those render an em-dash with NO bar rather than a
// zero-width one, so "unknown" never reads as "nothing".
export function ImpactCell({
  impactMonthlyUsd,
  barFraction,
}: {
  impactMonthlyUsd: number | null;
  barFraction: number | null;
}) {
  if (impactMonthlyUsd === null) {
    return <span className={`font-mono text-[12.5px] ${tableTokens.nullText}`}>{EM_DASH}</span>;
  }

  // Clamp defensively: a fraction outside 0..1 would paint outside the track.
  const pct = Math.max(0, Math.min(1, barFraction ?? 0)) * 100;

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-[12.5px] font-semibold tabular-nums text-ink">
        {cur(impactMonthlyUsd)}/mo
      </span>
      <div className={`w-full overflow-hidden rounded-full ${impactBarTokens.track} ${impactBarTokens.height}`}>
        <div
          className={`${impactBarTokens.fill} ${impactBarTokens.height} rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
