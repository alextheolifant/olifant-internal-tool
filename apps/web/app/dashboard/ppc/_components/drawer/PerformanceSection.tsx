"use client";

import { cur } from "../../../_lib/format";
import { healthTokens } from "../../../_lib/theme";
import type { PerformanceResponse } from "../../_lib/ppc-task-detail-api";
import { TaskLineChart } from "./TaskLineChart";

// Executed and verified tasks only — the caller skips this entirely
// otherwise, and the API also refuses with available:false.
export function PerformanceSection({ perf }: { perf: PerformanceResponse }) {
  if (!perf.available) return null;

  // For a campaign-level task the entity IS the campaign, so the API returns
  // a null entity series rather than duplicating the same chart twice.
  const hasEntityChart = perf.entitySeries !== null;

  return (
    <section>
      <h3 className="mb-2 text-[12px] font-bold text-ink">Performance since change</h3>

      <div className="flex gap-3">
        {hasEntityChart && (
          <TaskLineChart
            title={`${perf.entityType.replace(/_/g, " ")} spend`}
            points={perf.entitySeries ?? []}
            valueOf={(p) => p.spend}
            executionDate={perf.executionDate}
            formatValue={(v) => cur(v)}
          />
        )}
        <TaskLineChart
          title="Campaign ACoS"
          points={perf.campaignSeries}
          valueOf={(p) => p.acos}
          executionDate={perf.executionDate}
          formatValue={(v) => `${v.toFixed(1)}%`}
        />
      </div>

      {!hasEntityChart && (
        <p className="mt-1 text-[10.5px] text-neutral-400">
          This task changed the campaign itself, so the entity and campaign series are the same.
        </p>
      )}

      {/* The verdict is already normalized and plain-language from the
          Monitor — rendered verbatim, never reformatted or summarised. */}
      {perf.verdict ? (
        <div className={`mt-3 rounded-lg border ${healthTokens.on_target.border} ${healthTokens.on_target.bg} px-3 py-2`}>
          <p className={`text-[11.5px] leading-relaxed ${healthTokens.on_target.text}`}>{perf.verdict}</p>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-2">
          <p className="text-[11.5px] text-neutral-500">
            No verdict yet — the first checkpoint is written 14 days after execution.
          </p>
        </div>
      )}
    </section>
  );
}
