"use client";

import { tableTokens } from "../../../_lib/theme";
import type { FactsResponse } from "../../_lib/ppc-task-detail-api";

// The expanded state: a compact daily table, visually subordinate to the
// terminal above it and clearly attached to the number that opened it (it
// sits directly beneath, indented, and names the metric).
export function FactRowsTable({
  metric,
  facts,
  isLoading,
  error,
  onClose,
}: {
  metric: string;
  facts: FactsResponse | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const columns = facts?.rows.length
    ? Object.keys(facts.rows[0]).filter((c) => c !== "date")
    : [];

  return (
    <div className="ml-4 mt-1 rounded-b-lg border-x border-b border-neutral-200 bg-neutral-100 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[11px] font-semibold text-ink">{metric}</span>
        {facts?.factTable && (
          <span className="font-mono text-[10.5px] text-neutral-400">{facts.factTable}</span>
        )}
        {facts?.total !== null && facts?.total !== undefined && (
          <span className="text-[10.5px] text-neutral-500">total {facts.total}</span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[10.5px] font-medium text-neutral-500 hover:text-ink"
        >
          Close
        </button>
      </div>

      {isLoading && <p className="py-2 text-[11px] text-neutral-400">Loading daily rows…</p>}
      {error && <p className="py-2 text-[11px] text-red-600">{error}</p>}

      {!isLoading && !error && facts && facts.rows.length === 0 && (
        <p className="py-2 text-[11px] text-neutral-400">
          No daily rows in this window.
        </p>
      )}

      {!isLoading && facts && facts.rows.length > 0 && (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full font-mono text-[10.5px]">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-1 pr-3 font-semibold">date</th>
                {columns.map((c) => (
                  <th key={c} className="py-1 pr-3 text-right font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {facts.rows.map((r) => (
                <tr key={r.date} className="border-t border-neutral-200">
                  <td className="py-1 pr-3 text-neutral-600">{r.date}</td>
                  {columns.map((c) => (
                    <td key={c} className={`py-1 pr-3 ${tableTokens.numericAlign} text-ink`}>
                      {r[c] === null ? "—" : String(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
