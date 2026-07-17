"use client";

import { useEffect, useRef, useState } from "react";
import { listAnomalies, resolveAnomaly, type Anomaly } from "../_lib/anomalies-api";
import { healthTokens } from "../_lib/theme";

const METRIC_LABELS: Record<Anomaly["metric"], string> = {
  acos: "ACoS",
  spend: "Ad Spend",
  ctr: "CTR",
  clicks: "Clicks",
  tacos: "TACoS",
  revenue: "Revenue",
};

function formatChange(anomaly: Anomaly): string {
  if (anomaly.percentChange === null) return "New activity";
  const sign = anomaly.percentChange > 0 ? "+" : "";
  return `${sign}${anomaly.percentChange.toFixed(1)}%`;
}

export function AlertsBell() {
  const [open, setOpen] = useState(false);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listAnomalies({ resolved: false })
      .then(setAnomalies)
      .catch(() => setAnomalies([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function handleResolve(id: string) {
    setResolvingId(id);
    const prev = anomalies;
    setAnomalies((list) => list.filter((a) => a.id !== id));
    try {
      await resolveAnomaly(id);
    } catch {
      setAnomalies(prev);
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Alerts"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:border-neutral-300 hover:text-ink"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.5c-2 0-3.4 1.5-3.4 3.7v2.1c0 .5-.2 1-.5 1.4l-.8 1c-.4.5 0 1.3.6 1.3h8.2c.6 0 1-.8.6-1.3l-.8-1c-.3-.4-.5-.9-.5-1.4V5.2C11.4 3 10 1.5 8 1.5Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {!loading && anomalies.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9.5px] font-bold text-white">
            {anomalies.length > 99 ? "99+" : anomalies.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 max-h-100 w-96 overflow-y-auto rounded-[10px] border border-neutral-200 bg-white shadow-lg">
          <div className="sticky top-0 border-b border-neutral-100 bg-white px-4 py-2.5">
            <span className="text-[12.5px] font-bold text-ink">Alerts</span>
          </div>

          {anomalies.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-neutral-400">No active alerts</div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {anomalies.map((a) => {
                const t = healthTokens[a.severity];
                return (
                  <div key={a.id} className="px-4 py-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
                        <span className="truncate text-[12.5px] font-semibold text-ink">{a.clientName}</span>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${t.bg} ${t.text}`}>
                          {METRIC_LABELS[a.metric]}
                        </span>
                      </div>
                      <span className={`shrink-0 text-[11px] font-semibold ${t.text}`}>{formatChange(a)}</span>
                    </div>
                    {a.explanation && (
                      <p className="mb-2 text-[12px] leading-relaxed text-neutral-500">{a.explanation}</p>
                    )}
                    <button
                      onClick={() => handleResolve(a.id)}
                      disabled={resolvingId === a.id}
                      className="rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-500 transition-colors hover:border-neutral-300 hover:text-ink disabled:opacity-60"
                    >
                      {resolvingId === a.id ? "Resolving…" : "Resolve"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
