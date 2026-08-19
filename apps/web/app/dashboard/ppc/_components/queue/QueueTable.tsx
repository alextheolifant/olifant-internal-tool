"use client";

import { healthTokens, tableTokens, taskStatusToken, taskTypeToken } from "../../../_lib/theme";
import type { PpcQueueRow } from "../../_lib/ppc-queue-api";
import { rowSelectability, selectedType } from "../../_lib/queue-selection";
import { ImpactCell } from "./ImpactCell";

// The rule chip. RuleChip on the Today screen takes a guardColor the queue
// API doesn't return, so the colour is derived from the band the API DOES
// return, using the same token families: D-band reads as an exception
// (act_now), G-band guards as watch, everything else neutral.
function bandChipTokens(ruleId: string, band: string): { bg: string; text: string } {
  if (ruleId.startsWith("G") || band === "G") return { bg: healthTokens.watch.bg, text: healthTokens.watch.text };
  if (band === "D") return { bg: healthTokens.act_now.bg, text: healthTokens.act_now.text };
  return { bg: healthTokens.unknown.bg || "bg-neutral-100", text: healthTokens.unknown.text };
}

function RuleChipCell({ ruleId, band }: { ruleId: string; band: string }) {
  const t = bandChipTokens(ruleId, band);
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${t.bg} ${t.text}`}>
      {ruleId}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = taskStatusToken(status);
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.bg} ${t.text}`}>
      {t.label}
    </span>
  );
}

// Muted sub-line. A blocked task states its dependency instead of its
// metadata — "waits on TSK-0421" is the only thing worth reading on a row
// that can't be actioned yet.
function TaskSubLine({ row }: { row: PpcQueueRow }) {
  if (row.status === "blocked" && row.blockedBy) {
    return <span className="text-[11.5px] text-neutral-400">waits on {row.blockedBy}</span>;
  }
  return (
    <span className="text-[11.5px] text-neutral-400">
      {row.id} · {row.estMinutes} min · {row.confidence} confidence
    </span>
  );
}

export function QueueTable({
  rows,
  selectedIds,
  onToggle,
  onRowClick,
}: {
  rows: PpcQueueRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onRowClick: (id: string) => void;
}) {
  const lockedType = selectedType(rows, selectedIds);

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-surface">
      <table className="w-full">
        <thead className={tableTokens.headerBg}>
          <tr>
            <th className={`${tableTokens.cellPad} w-9`} />
            <th className={`${tableTokens.cellPad} ${tableTokens.headerText} w-32 text-right`}>Impact</th>
            <th className={`${tableTokens.cellPad} ${tableTokens.headerText} text-left`}>Task</th>
            <th className={`${tableTokens.cellPad} ${tableTokens.headerText} text-left`}>Client</th>
            <th className={`${tableTokens.cellPad} ${tableTokens.headerText} text-left`}>Type</th>
            <th className={`${tableTokens.cellPad} ${tableTokens.headerText} text-left`}>Rule</th>
            <th className={`${tableTokens.cellPad} ${tableTokens.headerText} text-left`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const sel = rowSelectability(row, lockedType);
            const isSelected = selectedIds.has(row.id);
            const type = taskTypeToken(row.type);

            return (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.id)}
                className={`${tableTokens.rowBorder} ${tableTokens.rowHover} cursor-pointer ${
                  isSelected ? tableTokens.rowExpanded : ""
                } ${!sel.selectable && sel.reason === "different_type" ? "opacity-45" : ""}`}
              >
                <td className={tableTokens.cellPad} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!sel.selectable && !isSelected}
                    onChange={() => onToggle(row.id)}
                    aria-label={
                      sel.selectable || isSelected
                        ? `Select ${row.id}`
                        : sel.reason === "different_type"
                          ? `${row.id} can't be selected — different type from the current selection`
                          : `${row.id} can't be approved from status ${row.status}`
                    }
                    title={
                      sel.reason === "different_type"
                        ? "Bulk approve works on one task type at a time — clear the selection to pick a different type"
                        : sel.reason === "not_approvable"
                          ? `A ${row.status} task can't be approved`
                          : undefined
                    }
                    className="h-3.5 w-3.5 cursor-pointer accent-ink disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </td>

                <td className={`${tableTokens.cellPad} text-right align-middle`}>
                  <ImpactCell impactMonthlyUsd={row.impactMonthlyUsd} barFraction={row.impactBarFraction} />
                </td>

                <td className={`${tableTokens.cellPad} max-w-md`}>
                  <p className="truncate text-[12.5px] font-semibold text-ink">{row.title}</p>
                  <TaskSubLine row={row} />
                </td>

                <td className={`${tableTokens.cellPad} text-[12.5px] text-neutral-600`}>{row.clientName}</td>

                <td className={`${tableTokens.cellPad} text-[12.5px] font-semibold capitalize ${type.text}`}>
                  {type.label}
                </td>

                <td className={tableTokens.cellPad}>
                  <RuleChipCell ruleId={row.ruleId} band={row.band} />
                </td>

                <td className={tableTokens.cellPad}>
                  <StatusPill status={row.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
