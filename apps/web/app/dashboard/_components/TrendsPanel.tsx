"use client";

import { useState, useRef, useEffect } from "react";
import type { ClientRow } from "../_lib/types";
import { derive } from "../_lib/derive";
import { cur, pct } from "../_lib/format";
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
  const len = clients[0]?.trend.length ?? 0;
  if (len === 0) return { spend: [], tacos: [], acos: [] };

  const spend = new Array<number>(len).fill(0);

  for (const c of clients) {
    for (let i = 0; i < len; i++) {
      spend[i] += c.trend[i] ?? 0;
    }
  }

  // ACoS/TACoS are estimated — we only store daily spend in trend, not daily revenue.
  // Apply the period's blended ACoS ratio to approximate the shape.
  const ppcRev = new Array<number>(len).fill(0);
  for (const c of clients) {
    const d = derive(c);
    const ratio = d.acos > 0 ? 100 / d.acos : 0;
    for (let i = 0; i < len; i++) {
      ppcRev[i] += (c.trend[i] ?? 0) * ratio;
    }
  }

  const tacos = spend.map((s, i) => (ppcRev[i] > 0 ? (s / ppcRev[i]) * 100 : 0));
  const acos  = spend.map((s, i) => (ppcRev[i] > 0 ? (s / ppcRev[i]) * 100 : 0));
  return { spend, tacos, acos };
}

function buildClientTrend(client: ClientRow) {
  const spend = client.trend;
  const d = derive(client);
  const ratio = d.acos > 0 ? 100 / d.acos : 0;
  const ppcRev = spend.map((s) => s * ratio);
  const tacos = spend.map((s, i) => (ppcRev[i] > 0 ? (s / ppcRev[i]) * 100 : 0));
  const acos  = spend.map((s, i) => (ppcRev[i] > 0 ? (s / ppcRev[i]) * 100 : 0));
  return { spend, tacos, acos };
}

// ── Tier + status helpers for dropdown ───────────────────────────────────────

const TIER_STYLE: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-ink",         text: "text-brand" },
  2: { bg: "bg-yellow-200",  text: "text-amber-800" },
  3: { bg: "bg-neutral-200", text: "text-neutral-500" },
};

const STATUS_DOT: Record<string, string> = {
  Active:     "bg-green-400",
  Paused:     "bg-amber-600",
  Onboarding: "bg-blue-500",
  Churned:    "bg-red-600",
};

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
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = clients.find((c) => c.id === selectedId);
  const label = selected ? selected.name : "All Clients";

  return (
    <div ref={ref} className="relative">
      {/* Trigger — full width, blue ring when open */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors ${
          open
            ? "border-blue-500 ring-2 ring-blue-100"
            : "border-neutral-200 hover:border-neutral-300"
        } bg-surface text-ink`}
      >
        {/* Target icon */}
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
          {/* All Clients option */}
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors bg-amber-50 hover:bg-amber-100"
          >
            <span className="text-[13px] font-bold text-ink">All Clients</span>
            <span className="text-[12px] text-neutral-400">· blended</span>
          </button>

          {/* Per-client options */}
          <div className="max-h-56 overflow-y-auto">
            {clients.map((c) => {
              const tier = TIER_STYLE[c.tier] ?? TIER_STYLE[3];
              const dot  = STATUS_DOT[c.status] ?? "bg-neutral-400";
              return (
                <button
                  key={c.id}
                  onClick={() => { onChange(c.id); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-[13px] transition-colors hover:bg-neutral-50 ${
                    selectedId === c.id ? "font-semibold text-ink" : "text-neutral-700"
                  }`}
                >
                  <span className="flex-1 truncate text-left">{c.name}</span>
                  {/* Tier badge */}
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${tier.bg} ${tier.text}`}>
                    T{c.tier}
                  </span>
                  {/* Status dot */}
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
  const { spend, tacos, acos } = selectedClient
    ? buildClientTrend(selectedClient)
    : buildPortfolioTrend(clients);

  const lastSpend = spend[spend.length - 1] ?? 0;
  const lastTacos = tacos[tacos.length - 1] ?? 0;
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

      {/* Scope selector — now a dropdown */}
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
          stroke="#CC9900"
          fill="rgba(204,153,0,0.12)"
        />
        <MetricChart
          label="TACoS"
          value={pct(lastTacos)}
          data={tacos}
          stroke="#4A3F35"
          fill="rgba(74,63,53,0.08)"
        />
        <MetricChart
          label="ACoS"
          value={pct(lastAcos)}
          data={acos}
          stroke="#4A3F35"
          fill="rgba(74,63,53,0.08)"
        />
      </div>
    </div>
  );
}
