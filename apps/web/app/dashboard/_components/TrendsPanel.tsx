"use client";

import { useState, useRef, useEffect } from "react";
import type { ClientRow } from "../_lib/types";
import { derive } from "../_lib/derive";
import { cur, pct } from "../_lib/format";
import { tierTokens, statusTokens, chartColors } from "../_lib/theme";
import { useDateRange } from "../_lib/date-range-context";

interface TrendsPanelProps {
  clients: ClientRow[];
  onClose: () => void;
}

// ── Area chart ────────────────────────────────────────────────────────────────

function AreaChart({
  data,
  stroke,
  fill,
  width = 248,
  height = 64,
}: {
  data: number[];
  stroke: string;
  fill: string;
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2)
    return <div style={{ height }} className="rounded-md bg-neutral-100" />;

  const max = Math.max(...data, 0.001);
  const min = Math.min(...data);
  const range = max - min || 0.001;
  const pad = 2;
  const iH = height - pad * 2;
  const step = width / (data.length - 1);

  const pts = data.map((v, i) => {
    const x = (i * step).toFixed(1);
    const y = (pad + iH - ((v - min) / range) * iH).toFixed(1);
    return `${x},${y}`;
  });

  const area =
    `M${pts[0]} ` +
    pts.slice(1).map((p) => `L${p}`).join(" ") +
    ` L${((data.length - 1) * step).toFixed(1)},${(pad + iH).toFixed(1)}` +
    ` L0,${(pad + iH).toFixed(1)} Z`;

  const line = `M${pts[0]} ` + pts.slice(1).map((p) => `L${p}`).join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true">
      <path d={area} fill={fill} />
      <path d={line} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MetricChart({
  label,
  value,
  data,
  stroke,
  fill,
}: {
  label: string;
  value: string;
  data: number[];
  stroke: string;
  fill: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500">
          {label}
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-neutral-500">{value}</span>
      </div>
      <div className="overflow-hidden rounded-md bg-neutral-50">
        <AreaChart data={data} stroke={stroke} fill={fill} />
      </div>
    </div>
  );
}

// ── Trend builders ────────────────────────────────────────────────────────────

function buildPortfolioTrend(clients: ClientRow[]) {
  const len = Math.max(0, ...clients.map(c => c.trend.length));
  if (len === 0) return { spend: [], tacos: [], acos: [], tacosAvailable: false };

  const spend    = new Array<number>(len).fill(0);
  const ppcRev   = new Array<number>(len).fill(0);
  const totalRev = new Array<number>(len).fill(0);
  let tacosAvailable = true;

  for (const c of clients) {
    const { acos: dAcos, tacos: dTacos } = derive(c);
    if (dTacos === null) tacosAvailable = false;
    const acosRatio  = dAcos  != null && dAcos  > 0 ? 100 / dAcos  : 0;
    const tacosRatio = dTacos != null && dTacos > 0  ? 100 / dTacos : 0;
    for (let i = 0; i < len; i++) {
      const s = c.trend[i] ?? 0;
      spend[i]    += s;
      ppcRev[i]   += s * acosRatio;
      totalRev[i] += s * tacosRatio;
    }
  }

  const acos  = spend.map((s, i) => (ppcRev[i]   > 0 ? (s / ppcRev[i])   * 100 : 0));
  const tacos = spend.map((s, i) => (totalRev[i]  > 0 ? (s / totalRev[i]) * 100 : 0));
  return { spend, tacos, acos, tacosAvailable };
}

function buildClientTrend(client: ClientRow) {
  const spend = client.trend;
  const { acos: dAcos, tacos: dTacos } = derive(client);
  const tacosAvailable = dTacos !== null;

  const acosRatio  = dAcos  != null && dAcos  > 0 ? 100 / dAcos  : 0;
  const tacosRatio = dTacos != null && dTacos > 0  ? 100 / dTacos : 0;

  const ppcRev   = spend.map((s) => s * acosRatio);
  const totalRev = spend.map((s) => s * tacosRatio);
  const acos  = spend.map((s, i) => (ppcRev[i]   > 0 ? (s / ppcRev[i])   * 100 : 0));
  const tacos = spend.map((s, i) => (totalRev[i]  > 0 ? (s / totalRev[i]) * 100 : 0));
  return { spend, tacos, acos, tacosAvailable };
}

// ── Client dropdown ───────────────────────────────────────────────────────────

function ClientDropdown({
  clients,
  selectedId,
  onChange,
}: {
  clients: ClientRow[];
  selectedId: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = clients.find((c) => c.id === selectedId);
  const label = selected ? selected.name : "All Clients";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors ${
          open
            ? "border-blue-500 ring-2 ring-blue-100"
            : "border-neutral-200 hover:border-neutral-300"
        } bg-surface text-ink`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-green-600" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="8" r="0.75" fill="currentColor" />
        </svg>
        <span className="flex-1 truncate text-left">{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-neutral-400" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-xl border border-neutral-200 bg-surface shadow-lg overflow-hidden">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors bg-amber-50 hover:bg-amber-100"
          >
            <span className="text-[13px] font-bold text-ink">All Clients</span>
            <span className="text-[12px] text-neutral-400">· blended</span>
          </button>

          <div className="max-h-56 overflow-y-auto">
            {clients.map((c) => {
              const tier = tierTokens[c.tier] ?? tierTokens[3];
              const dot  = statusTokens[c.status]?.dot ?? "bg-neutral-400";
              return (
                <button
                  key={c.id}
                  onClick={() => { onChange(c.id); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-[13px] transition-colors hover:bg-neutral-50 ${
                    selectedId === c.id ? "font-semibold text-ink" : "text-neutral-700"
                  }`}
                >
                  <span className="flex-1 truncate text-left">{c.name}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${tier.bg} ${tier.text}`}>
                    T{c.tier}
                  </span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function TrendsPanel({ clients, onClose }: TrendsPanelProps) {
  const { range } = useDateRange();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedClient = clients.find((c) => c.id === selectedId) ?? null;
  const { spend, tacos, acos, tacosAvailable } = selectedClient
    ? buildClientTrend(selectedClient)
    : buildPortfolioTrend(clients);

  const lastSpend = spend[spend.length - 1] ?? 0;
  const lastTacos = tacosAvailable ? (tacos[tacos.length - 1] ?? null) : null;
  const lastAcos  = acos[acos.length - 1] ?? 0;

  return (
    <div className="flex h-full w-[296px] shrink-0 flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <span className="text-[13px] font-bold text-ink">Trends</span>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-ink transition-colors"
          aria-label="Close trends"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Scope selector */}
      <div className="border-b border-neutral-200 px-4 py-2.5">
        <ClientDropdown
          clients={clients}
          selectedId={selectedId}
          onChange={setSelectedId}
        />
        <p className="mt-1.5 text-[10.5px] text-neutral-400">Daily · {range.label}</p>
      </div>

      {/* Charts */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <MetricChart
          label="Ad Spend"
          value={cur(lastSpend)}
          data={spend}
          stroke={chartColors.brand.stroke}
          fill={chartColors.brand.fill}
        />
        <MetricChart
          label="TACoS"
          value={pct(lastTacos)}
          data={tacosAvailable ? tacos : []}
          stroke={chartColors.dark.stroke}
          fill={chartColors.dark.fill}
        />
        <MetricChart
          label="ACoS"
          value={pct(lastAcos)}
          data={acos}
          stroke={chartColors.dark.stroke}
          fill={chartColors.dark.fill}
        />
      </div>
    </div>
  );
}
