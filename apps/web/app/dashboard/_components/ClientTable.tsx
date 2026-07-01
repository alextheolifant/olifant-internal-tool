import type { ClientRow, ViewMode, Totals } from "../_lib/types";
import { tableTokens } from "../_lib/theme";
import { TableSkeleton } from "./TableSkeleton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { ClientRow as ClientRowComponent } from "./ClientRow";
import { TotalsRow } from "./TotalsRow";

// ── Column definitions ────────────────────────────────────────────────────────

interface ColDef {
  id: string;
  label: string;
  align: "left" | "right" | "center";
  /** Which view modes show this column */
  showIn: ("core" | "full")[];
  minW?: string;
}

const CORE_COLS: ColDef[] = [
  { id: "client",     label: "Client",     align: "left",   showIn: ["core", "full"], minW: "min-w-[166px]" },
  { id: "tier",       label: "Tier",       align: "center", showIn: ["core", "full"], minW: "w-[84px]" },
  { id: "status",     label: "Status",     align: "left",   showIn: ["core", "full"], minW: "w-[116px]" },
  { id: "revenue",    label: "Revenue",    align: "right",  showIn: ["core", "full"] },
  { id: "adSpend",    label: "Ad Spend",   align: "right",  showIn: ["core", "full"] },
  { id: "tacos",      label: "TACoS",      align: "right",  showIn: ["core", "full"] },
  { id: "acos",       label: "ACoS",       align: "right",  showIn: ["core", "full"] },
  { id: "roas",       label: "ROAS",       align: "right",  showIn: ["core", "full"] },
  { id: "organicPct", label: "Organic %",  align: "right",  showIn: ["core", "full"] },
  { id: "cvr",        label: "CVR",        align: "right",  showIn: ["core", "full"] },
  { id: "cpc",        label: "CPC",        align: "right",  showIn: ["core", "full"] },
  { id: "ctr",        label: "CTR",        align: "right",  showIn: ["core", "full"] },
];

const FULL_ONLY_COLS: ColDef[] = [
  { id: "ppcRev",    label: "PPC Rev",       align: "right", showIn: ["full"] },
  { id: "ppcOrd",    label: "PPC Orders",    align: "right", showIn: ["full"] },
  { id: "orgRev",    label: "Organic Rev",   align: "right", showIn: ["full"] },
  { id: "orgOrd",    label: "Organic Orders",align: "right", showIn: ["full"] },
  { id: "clicks",    label: "Clicks",        align: "right", showIn: ["full"] },
  { id: "impr",      label: "Impressions",   align: "right", showIn: ["full"] },
  { id: "units",     label: "Units Sold",    align: "right", showIn: ["full"] },
];

const TRENDS_COL: ColDef = { id: "trends", label: "Trends", align: "center", showIn: ["core", "full"] };

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
  const visibleCols = [
    ...CORE_COLS.filter((c) => c.showIn.includes(viewMode)),
    ...(viewMode === "full" ? FULL_ONLY_COLS : []),
    ...(showTrends ? [TRENDS_COL] : []),
  ];

  const thCls = (col: ColDef) =>
    `${tableTokens.cellPad} ${tableTokens.headerText} ${col.minW ?? ""} whitespace-nowrap ${
      col.align === "right"
        ? "text-right"
        : col.align === "center"
        ? "text-center"
        : "text-left"
    }`;

  return (
    <div className="flex flex-col">
      {/* Scrollable table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse text-left">
          <thead>
            <tr className={`${tableTokens.headerBg} sticky top-0 z-10`}>
              {visibleCols.map((col) => (
                <th key={col.id} className={thCls(col)}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading && <TableSkeleton cols={visibleCols.length} />}

            {!isLoading && error && <ErrorState message={error} onRetry={onRetry} />}

            {!isLoading && !error && clients.length === 0 && <EmptyState />}

            {!isLoading && !error && clients.map((c) => (
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

            {!isLoading && !error && clients.length > 0 && (
              <TotalsRow totals={totals} viewMode={viewMode} showTrends={showTrends} />
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
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
