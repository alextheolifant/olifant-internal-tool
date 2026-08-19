import { chartColors } from "../../../_lib/theme";
import type { PerformancePoint } from "../../_lib/ppc-task-detail-api";

// Zero-dependency inline SVG, extending the approach already used by
// _components/Sparkline.tsx rather than introducing a charting library.
// Adds the two things the drawer needs that a sparkline doesn't have: a
// dashed marker at the execution date, and gray shading over the days the
// API flagged provisional.
//
// Provisional days are NEVER computed here — the flag comes from the API.
export function TaskLineChart({
  title,
  points,
  valueOf,
  executionDate,
  formatValue,
  width = 224,
  height = 76,
}: {
  title: string;
  points: PerformancePoint[];
  valueOf: (p: PerformancePoint) => number | null;
  executionDate: string;
  formatValue: (v: number) => string;
  width?: number;
  height?: number;
}) {
  const usable = points.filter((p) => valueOf(p) !== null);

  if (usable.length < 2) {
    return (
      <div className="flex-1">
        <p className="mb-1 text-[11px] font-semibold text-neutral-500">{title}</p>
        <div className="flex h-[76px] items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100">
          <span className="text-[11px] text-neutral-400">
            {points.length === 0 ? "No data in this window yet" : "Not enough points to plot"}
          </span>
        </div>
      </div>
    );
  }

  const values = usable.map((p) => valueOf(p) as number);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pad = 6;
  const innerH = height - pad * 2;
  const step = width / (usable.length - 1);

  const x = (i: number) => i * step;
  const y = (v: number) => pad + innerH - ((v - min) / range) * innerH;

  const line = usable.map((p, i) => `${x(i).toFixed(1)},${y(valueOf(p) as number).toFixed(1)}`).join(" ");

  // Contiguous provisional run at the tail — shaded as one band.
  const firstProvisional = usable.findIndex((p) => p.provisional);
  const provisionalX = firstProvisional >= 0 ? x(firstProvisional) : null;

  // Execution marker: the first point on/after the execution date.
  const execIndex = usable.findIndex((p) => p.date >= executionDate);
  const execX = execIndex >= 0 ? x(execIndex) : null;

  const last = valueOf(usable[usable.length - 1]) as number;

  return (
    <div className="flex-1">
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-[11px] font-semibold text-neutral-500">{title}</p>
        <span className="font-mono text-[11px] text-ink">{formatValue(last)}</span>
      </div>
      <div className="rounded-lg border border-neutral-200 bg-surface p-1">
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} height={height} fill="none" role="img" aria-label={title}>
          {provisionalX !== null && (
            <rect
              x={provisionalX}
              y={0}
              width={width - provisionalX}
              height={height}
              fill={chartColors.dark.fill}
            />
          )}
          {execX !== null && (
            <line
              x1={execX}
              y1={0}
              x2={execX}
              y2={height}
              stroke={chartColors.brand.stroke}
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          )}
          <polyline
            points={line}
            stroke={chartColors.dark.stroke}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10px] text-neutral-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-brand" /> executed
        </span>
        {provisionalX !== null && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-neutral-300" /> provisional
          </span>
        )}
      </div>
    </div>
  );
}
