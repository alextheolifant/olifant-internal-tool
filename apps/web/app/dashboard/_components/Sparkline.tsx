import type { Health } from "../_lib/types";
import { getHealthTokens } from "../_lib/health";

interface SparklineProps {
  data: number[];
  health?: Health;
  width?: number;
  height?: number;
}

/**
 * Zero-dependency inline SVG sparkline.
 * Stroke color is sourced exclusively from theme tokens — no hex in JSX.
 */
export function Sparkline({
  data,
  health = "unknown",
  width = 68,
  height = 22,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return <span className="text-[11px] text-neutral-400">—</span>;
  }

  const { stroke } = getHealthTokens(health);
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pad = 2;
  const iH = height - pad * 2;
  const step = width / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = pad + iH - ((v - min) / range) * iH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const lastX = (data.length - 1) * step;
  const lastV = data[data.length - 1];
  const lastY = pad + iH - ((lastV - min) / range) * iH;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true">
      <polyline
        points={points}
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
    </svg>
  );
}
