"use client";

import Link from "next/link";
import { cur, intfmt } from "../../../_lib/format";
import { healthTokens } from "../../../_lib/theme";
import { usePpcTodaySummary } from "../../_lib/ppc-today";

export function TodayView() {
  const { data } = usePpcTodaySummary();
  const { verifiedSavingsPerMonth, openTaskCount, dollarsAtStakePerMonth, exceptions } = data;

  const exceptionTone = exceptions.length > 0 ? healthTokens.act_now : healthTokens.on_target;

  return (
    <div className="px-5 py-5">
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Verified savings" value={`${cur(verifiedSavingsPerMonth)}/mo`} valueClass="text-green-700" sub="run-rate across synced accounts" />
        <StatTile label="Open tasks" value={intfmt(openTaskCount)} valueClass="text-ink" sub="pending + approved" />
        <StatTile label="$ at stake in queue" value={`${cur(dollarsAtStakePerMonth)}/mo`} valueClass="text-amber-700" sub="sum of open task impact" />
        <StatTile label="Exceptions today" value={intfmt(exceptions.length)} valueClass={exceptionTone.text} sub="something broke — handle first" />
      </div>

      {exceptions.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-surface px-6 py-12 text-center">
          <p className="text-[13.5px] font-semibold text-ink">No exceptions right now</p>
          <p className="mt-1 text-[12px] text-neutral-500">
            Break/fix alerts will show up here the moment something needs attention.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {exceptions.map((e) => {
            const t = healthTokens[e.severity];
            return (
              <div
                key={e.id}
                className={`flex items-start gap-3.5 rounded-xl border bg-surface px-4.5 py-3.5 ${t.border}`}
              >
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${t.bg} ${t.text}`}>
                  {e.ruleCode}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-ink">{e.clientName}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-600">{e.message}</p>
                </div>
                <Link
                  href="/dashboard/ppc/queue"
                  className="shrink-0 rounded-md border border-neutral-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-500 transition-colors hover:border-neutral-300 hover:text-ink"
                >
                  {e.actionLabel}
                </Link>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11.5px] text-neutral-400">
        Exceptions are break/fix alerts, not optimizations. They bypass the weekly queue and always sort first.
      </p>
    </div>
  );
}

function StatTile({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: string;
  valueClass: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-surface px-4 py-3.5 shadow-sm">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className={`text-[22px] font-bold leading-tight tracking-tight ${valueClass}`}>{value}</p>
      <p className="text-[11px] text-neutral-400">{sub}</p>
    </div>
  );
}
