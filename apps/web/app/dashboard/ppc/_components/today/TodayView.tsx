"use client";

import { cur, EM_DASH, intfmt } from "../../../_lib/format";
import { healthTokens } from "../../../_lib/theme";
import { usePpcDataFreshness } from "../../../_lib/ppc-status";
import { usePpcClientFilter } from "../../_lib/ppc-client-filter-context";
import { usePpcToday } from "../../_lib/ppc-today";
import type { PpcTodayException } from "../../_lib/ppc-today-api";
import { RuleChip } from "./RuleChip";

// Task intent per rule (from the D1/D4/D5/D6 build): D1 suggests a specific
// fix (raise budget) — actionable. D4/D5/D6 all end in "review"/"diagnose"/
// "escalate" — none of them prescribe a specific change, so they read as
// "go investigate" rather than "here's the fix, apply it." The API doesn't
// carry an intent field yet, hence this small config map instead.
const ACTION_LABEL_BY_RULE: Record<string, string> = {
  D1: "Open task",
  D4: "Investigate",
  D5: "Investigate",
  D6: "Investigate",
};

function actionLabelForRule(ruleId: string): string {
  return ACTION_LABEL_BY_RULE[ruleId] ?? "Investigate";
}

export function TodayView() {
  const { clientId } = usePpcClientFilter();
  const { data, isLoading, isRefetching, error, retry } = usePpcToday(clientId);
  const { isStale, isAgeStale, hasRecentFailures } = usePpcDataFreshness();

  if (error) {
    return (
      <div className="px-5 py-5">
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
          <p className="text-[13.5px] font-semibold text-red-700">Couldn&rsquo;t load today&rsquo;s exceptions</p>
          <p className="mt-1 text-[12px] text-red-600">{error}</p>
          <button
            onClick={retry}
            className="mt-3.5 rounded-lg border border-red-300 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-red-700 transition-colors hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="px-5 py-5">
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-surface px-4 py-3.5 shadow-sm">
              <div className="h-3 w-24 animate-pulse rounded bg-neutral-200" />
              <div className="h-7 w-20 animate-pulse rounded-md bg-neutral-200" />
              <div className="h-3 w-32 animate-pulse rounded bg-neutral-200" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-neutral-200 bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  const { statCards, exceptions } = data;
  const exceptionTone = exceptions.length > 0 ? healthTokens.act_now : healthTokens.on_target;

  return (
    <div className={`px-5 py-5 ${isRefetching ? "opacity-60 transition-opacity" : ""}`}>
      {isStale && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800">
          {hasRecentFailures
            ? "A recent sync failed — exceptions below may be based on incomplete data until it's resolved."
            : isAgeStale
              ? "Data is more than 48 hours old — exceptions below may be out of date. Treat as unverified until the sync catches up."
              : "Sync status is unavailable — exceptions below may be out of date."}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Verified savings"
          value={statCards.verifiedSavings}
          format={(n) => `${cur(n)}/mo`}
          colorClassWhenAvailable="text-green-700"
          sub="run-rate across synced accounts"
          subWhenUnavailable="Not yet available — Ledger/Monitor not built"
        />
        <StatTile
          label="Open tasks"
          value={statCards.openTasksCount}
          format={(n) => intfmt(n)}
          colorClassWhenAvailable="text-ink"
          sub="raw candidate count — task layer pending"
        />
        <StatTile
          label="$ at stake in queue"
          value={statCards.dollarsAtStake}
          format={(n) => `${cur(n)}/mo`}
          colorClassWhenAvailable="text-amber-700"
          sub="sum of open task impact"
          subWhenUnavailable="Not yet available — needs task-level impact scoring"
        />
        <StatTile
          label="Exceptions today"
          value={statCards.exceptionsToday}
          format={(n) => intfmt(n)}
          colorClassWhenAvailable={exceptionTone.text}
          sub="something broke — handle first"
        />
      </div>

      {exceptions.length === 0 ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-12 text-center">
          <p className="text-[13.5px] font-semibold text-green-800">Nothing broke today</p>
          <p className="mt-1 text-[12px] text-green-700">
            No exceptions right now — break/fix alerts will show up here the moment something needs attention.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {exceptions.map((e, idx) => (
            <ExceptionCard key={`${e.ruleId}-${e.clientId}-${idx}`} exception={e} />
          ))}
        </div>
      )}

      <p className="mt-4 text-[11.5px] text-neutral-400">
        Exceptions are break/fix alerts, not optimizations. They bypass the weekly queue and always sort first.
      </p>
    </div>
  );
}

function ExceptionCard({ exception }: { exception: PpcTodayException }) {
  const actionLabel = actionLabelForRule(exception.ruleId);

  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-neutral-200 bg-surface px-4.5 py-3.5">
      <RuleChip ruleId={exception.ruleId} guardColor={exception.guardColor} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink">{exception.clientName}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-600">{exception.description}</p>
      </div>
      {/* TODO(task-queue): wire this to the real task detail route once the
          Task Queue screen exists — deliberately disabled, not a dead link
          or a route that 404s. */}
      <button
        type="button"
        disabled
        title="Coming soon — Task Queue isn't built yet"
        className="shrink-0 cursor-not-allowed rounded-md border border-neutral-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-300"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function StatTile({
  label,
  value,
  format,
  colorClassWhenAvailable,
  sub,
  subWhenUnavailable,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  colorClassWhenAvailable: string;
  sub: string;
  subWhenUnavailable?: string;
}) {
  const isAvailable = value !== null;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-surface px-4 py-3.5 shadow-sm">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      <p
        className={`text-[22px] font-bold leading-tight tracking-tight ${
          isAvailable ? colorClassWhenAvailable : "text-neutral-300"
        }`}
      >
        {isAvailable ? format(value) : EM_DASH}
      </p>
      <p className="text-[11px] text-neutral-400">{isAvailable ? sub : (subWhenUnavailable ?? "Not yet available")}</p>
    </div>
  );
}
