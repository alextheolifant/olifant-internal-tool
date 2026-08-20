import { APPROVABLE_STATUSES } from "../../_lib/theme";
import type { PpcQueueRow } from "./ppc-queue-api";

// ─── Bulk-selection rules ───────────────────────────────────────────────────
// Two independent constraints from the brief, kept as pure functions so the
// table component stays presentational and the rules are directly testable:
//
//   1. Only approvable statuses can be selected at all. Blocked, executed,
//      verified and dismissed rows are excluded outright — approving them
//      isn't a valid transition, and the API's state machine would reject it.
//   2. Same type only. Once a row is selected, rows of any other type become
//      unselectable until the selection clears. Reviewing five negations
//      together is reasonable; mixing a negation with a budget change isn't.

export function isApprovableStatus(status: string): boolean {
  return (APPROVABLE_STATUSES as readonly string[]).includes(status);
}

/** The type the current selection has locked onto, or null when empty. */
export function selectedType(rows: PpcQueueRow[], selectedIds: Set<string>): string | null {
  for (const row of rows) {
    if (selectedIds.has(row.id)) return row.type;
  }
  return null;
}

export type RowSelectability =
  | { selectable: true; reason: null }
  | { selectable: false; reason: "not_approvable" | "different_type" };

export function rowSelectability(
  row: PpcQueueRow,
  lockedType: string | null,
): RowSelectability {
  if (!isApprovableStatus(row.status)) return { selectable: false, reason: "not_approvable" };
  if (lockedType !== null && row.type !== lockedType) {
    return { selectable: false, reason: "different_type" };
  }
  return { selectable: true, reason: null };
}

/**
 * Toggling is guarded by the same rules the checkbox rendering uses, so a
 * stale click (e.g. a row that became unselectable between render and click)
 * can't slip a mixed-type selection through.
 */
export function toggleSelection(
  rows: PpcQueueRow[],
  selectedIds: Set<string>,
  id: string,
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  const row = rows.find((r) => r.id === id);
  if (!row) return next;
  if (!rowSelectability(row, selectedType(rows, selectedIds)).selectable) return next;
  next.add(id);
  return next;
}

/** Select-all applies only to rows that are actually selectable right now. */
export function selectAllOfLockedType(rows: PpcQueueRow[], selectedIds: Set<string>): Set<string> {
  const locked = selectedType(rows, selectedIds);
  // With nothing selected yet, select-all would have to invent a type to
  // lock onto. Defaulting to the first approvable row's type keeps the
  // same-type rule intact and matches what clicking that row would do.
  const target = locked ?? rows.find((r) => isApprovableStatus(r.status))?.type ?? null;
  if (target === null) return new Set();
  return new Set(rows.filter((r) => isApprovableStatus(r.status) && r.type === target).map((r) => r.id));
}
