import { healthTokens } from "../../../_lib/theme";

function barColor(percent: number): string {
  if (percent >= 100) return healthTokens.on_target.dot;
  if (percent >= 50) return healthTokens.watch.dot;
  return healthTokens.act_now.dot;
}

export function CompletenessMeter({
  percent,
  metCount,
  total,
  barClassName = "flex-1",
}: {
  percent: number;
  metCount: number;
  total: number;
  barClassName?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className={`h-1.5 overflow-hidden rounded-full bg-neutral-150 ${barClassName}`}>
        <div className={`h-1.5 rounded-full transition-all ${barColor(percent)}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-neutral-500">
        {metCount}/{total} complete
      </span>
    </div>
  );
}
