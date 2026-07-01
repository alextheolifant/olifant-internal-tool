"use client";

import type { ViewMode } from "../_lib/types";
import { controlTokens } from "../_lib/theme";

interface TableToolbarProps {
  clientCount: number;
  viewMode: ViewMode;
  showTrends: boolean;
  onViewChange: (v: ViewMode) => void;
  onTrendsToggle: () => void;
}

export function TableToolbar({
  clientCount,
  viewMode,
  showTrends,
  onViewChange,
  onTrendsToggle,
}: TableToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-200 bg-surface px-5 py-2">
      {/* Left: title + count */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-ink">All Clients</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-600">
          {clientCount}
        </span>
      </div>

      {/* Right: Core/Full + Trends */}
      <div className="flex items-center gap-2">
        <div className={controlTokens.groupWrap}>
          {(["core", "full"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={`${controlTokens.pillBase} ${
                viewMode === v ? controlTokens.pillActive : controlTokens.pillInactive
              }`}
            >
              {v === "core" ? "Core" : "Full"}
            </button>
          ))}
        </div>

        <button
          onClick={onTrendsToggle}
          className={`flex items-center gap-1.5 cursor-pointer rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
            showTrends
              ? "border-ink bg-ink text-neutral-50"
              : "border-neutral-200 bg-neutral-100 text-neutral-500 hover:text-ink"
          }`}
        >
          <IconSparkline className="h-3 w-3" />
          Trends
        </button>
      </div>
    </div>
  );
}

function IconSparkline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path d="M1 9.5 5 5.5l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
