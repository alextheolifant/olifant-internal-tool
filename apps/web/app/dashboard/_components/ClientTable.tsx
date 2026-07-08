"use client";

import { useState, useMemo } from "react";
import type { ClientRow, ViewMode, Totals } from "../_lib/types";
import { resolveCurrency } from "../_lib/format";
import { derive } from "../_lib/derive";
import { tableTokens } from "../_lib/theme";
import { TableSkeleton } from "./TableSkeleton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { ClientRow as ClientRowComponent } from "./ClientRow";
import { TotalsRow } from "./TotalsRow";

// ── Column definitions ────────────────────────────────────────────────────────

type SortKey = (c: ClientRow) => number | string | null;

interface ColDef {
  id: string;
  label: string;
  align: "left" | "right" | "center";
  showIn: ("core" | "full")[];
  minW?: string;
  sortKey?: SortKey;
}

const CORE_COLS: ColDef[] = [
  { id: "client",     label: "Client",    align: "left",   showIn: ["core", "full"], minW: "min-w-[166px]", sortKey: (c) => c.name.toLowerCase() },
  { id: "tier",       label: "Tier",      align: "center", showIn: ["core", "full"], minW: "w-[84px]",      sortKey: (c) => c.tier },
  { id: "status",     label: "Status",    align: "left",   showIn: ["core", "full"], minW: "w-[116px]",     sortKey: (c) => c.status },
  { id: "revenue",    label: "Revenue",   align: "right",  showIn: ["core", "full"], sortKey: (c) => derive(c).revenue },
  { id: "adSpend",    label: "Ad Spend",  align: "right",  showIn: ["core", "full"], sortKey: (c) => c.spend },
  { id: "tacos",      label: "TACoS",     align: "right",  showIn: ["core", "full"], sortKey: (c) => derive(c).tacos },
  { id: "acos",       label: "ACoS",      align: "right",  showIn: ["core", "full"], sortKey: (c) => derive(c).acos },
  { id: "roas",       label: "ROAS",      align: "right",  showIn: ["core", "full"], sortKey: (c) => derive(c).roas },
  { id: "organicPct", label: "Organic %", align: "right",  showIn: ["core", "full"], sortKey: (c) => derive(c).organicPct },
  { id: "cvr",        label: "CVR",       align: "right",  showIn: ["core", "full"], sortKey: (c) => derive(c).cvr },
  { id: "cpc",        label: "CPC",       align: "right",  showIn: ["core", "full"], sortKey: (c) => derive(c).cpc },
  { id: "ctr",        label: "CTR",       align: "right",  showIn: ["core", "full"], sortKey: (c) => derive(c).ctr },
];

const FULL_ONLY_COLS: ColDef[] = [
  { id: "ppcRev",  label: "PPC Rev",        align: "right", showIn: ["full"], sortKey: (c) => c.ppcRev },
  { id: "ppcOrd",  label: "PPC Orders",     align: "right", showIn: ["full"], sortKey: (c) => c.ppcOrd },
  { id: "orgRev",  label: "Organic Rev",    align: "right", showIn: ["full"], sortKey: (c) => c.orgRev },
  { id: "orgOrd",  label: "Organic Orders", align: "right", showIn: ["full"], sortKey: (c) => c.orgOrd },
  { id: "clicks",  label: "Clicks",         align: "right", showIn: ["full"], sortKey: (c) => c.clicks },
  { id: "impr",    label: "Impressions",    align: "right", showIn: ["full"], sortKey: (c) => c.impr },
  { id: "units",   label: "Units Sold",     align: "right", showIn: ["full"], sortKey: (c) => c.units },
];

const TRENDS_COL: ColDef = { id: "trends", label: "Trends", align: "center", showIn: ["core", "full"] };

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function sortedClients(clients: ClientRow[], col: ColDef | null, dir: SortDir): ClientRow[] {
  if (!col?.sortKey) return clients;
  const fn = col.sortKey;
  // Pre-compute each key once so sort comparisons are O(1)
  const keyed = clients.map((c) => ({ c, k: fn(c) }));
  keyed.sort((a, b) => {
    const av = a.k, bv = b.k;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === "string" && typeof bv === "string"
      ? av.localeCompare(bv)
      : (av as number) - (bv as number);
    return dir === "asc" ? cmp : -cmp;
  });
  return keyed.map(({ c }) => c);
}

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ state }: { state: "none" | "asc" | "desc" }) {
  return (
    <span className="ml-1 inline-flex flex-col items-center justify-center leading-none" aria-hidden="true">
      {state === "none" && (
        <svg width="8" height="10" viewBox="0 0 8 10" fill="none" className="text-neutral-300">
          <path d="M4 1L1 4h6L4 1zM4 9L1 6h6l-3 3z" fill="currentColor" />
        </svg>
      )}
      {state === "asc" && (
        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" className="text-ink">
          <path d="M4 0L0 6h8L4 0z" fill="currentColor" />
        </svg>
      )}
      {state === "desc" && (
        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" className="text-ink">
          <path d="M4 6L0 0h8L4 6z" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ClientTableProps {
  clients: ClientRow[];
  totals: Totals;
  isLoading: boolean;
  error: string | null;
  viewMode: ViewMode;
  showTrends: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onEdit: (client: ClientRow) => void;
  onRetry: () => void;
}

export function ClientTable({
  clients, totals, isLoading, error, viewMode, showTrends,
  expandedIds, onToggleExpand, onEdit, onRetry,
}: ClientTableProps) {
  const { code: cc, approx } = resolveCurrency(
    clients.flatMap((c) => c.accounts.map((a) => a.currencyCode)),
  );
  const [sortCol, setSortCol] = useState<ColDef | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const visibleCols = useMemo(() => [
    ...CORE_COLS.filter((c) => c.showIn.includes(viewMode)),
    ...(viewMode === "full" ? FULL_ONLY_COLS : []),
    ...(showTrends ? [TRENDS_COL] : []),
  ], [viewMode, showTrends]);

  function handleSort(col: ColDef) {
    if (!col.sortKey) return;
    if (sortCol?.id === col.id) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const displayClients = useMemo(
    () => sortedClients(clients, sortCol, sortDir),
    [clients, sortCol, sortDir],
  );

  const thCls = (col: ColDef) =>
    `${tableTokens.cellPad} ${tableTokens.headerText} ${col.minW ?? ""} whitespace-nowrap select-none ${
      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
    } ${col.sortKey ? "cursor-pointer hover:text-ink transition-colors" : ""}`;

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse text-left">
          <thead>
            <tr className={`${tableTokens.headerBg} sticky top-0 z-10`}>
              {visibleCols.map((col) => {
                const isActive = sortCol?.id === col.id;
                const iconState = !col.sortKey ? undefined : isActive ? sortDir : "none";
                return (
                  <th
                    key={col.id}
                    className={thCls(col)}
                    onClick={() => handleSort(col)}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      {iconState !== undefined && <SortIcon state={iconState} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {isLoading && <TableSkeleton cols={visibleCols.length} />}

            {!isLoading && error && <ErrorState message={error} onRetry={onRetry} />}

            {!isLoading && !error && displayClients.length === 0 && <EmptyState />}

            {!isLoading && !error && displayClients.map((c) => (
              <ClientRowComponent
                key={c.id}
                client={c}
                isExpanded={expandedIds.has(c.id)}
                onToggle={() => onToggleExpand(c.id)}
                onEdit={onEdit}
                viewMode={viewMode}
                showTrends={showTrends}
              />
            ))}

            {!isLoading && !error && displayClients.length > 0 && (
              <TotalsRow totals={totals} viewMode={viewMode} showTrends={showTrends} currencyCode={cc} approx={approx} />
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && !error && clients.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 border-t border-neutral-200 bg-surface px-5 py-2.5">
          <LegendItem dotCls="bg-green-400" label="On target" desc="TACoS ≤ goal" />
          <LegendItem dotCls="bg-amber-600" label="Watch"     desc="TACoS 1–25% above goal" />
          <LegendItem dotCls="bg-red-600"   label="Act now"   desc="TACoS >25% above goal" />
          <span className="ml-auto text-[10.5px] text-neutral-400">
            — = awaiting SP-API · Ratios derived from summed inputs, not averaged
          </span>
        </div>
      )}
    </div>
  );
}

function LegendItem({ dotCls, label, desc }: { dotCls: string; label: string; desc: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
      <span className={`h-2 w-2 rounded-full shrink-0 ${dotCls}`} />
      <strong className="text-neutral-700">{label}</strong>
      <span>— {desc}</span>
    </span>
  );
}
