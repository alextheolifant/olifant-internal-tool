"use client";

import { useState } from "react";
import { DISMISS_REASONS, type TaskDetail } from "../../_lib/ppc-task-detail-api";

// Actions are contextual to status. Every transition is validated by the
// API's state machine; this only decides what to offer.
export function DrawerActions({
  detail,
  isBusy,
  error,
  onApprove,
  onExecute,
  onDismiss,
}: {
  detail: TaskDetail;
  isBusy: boolean;
  error: string | null;
  onApprove: () => void;
  onExecute: (confirmedValue: string | null) => void;
  onDismiss: (reason: string, note: string) => void;
}) {
  // Pre-filled from the proposed value but editable — the executor may have
  // entered something different in the console, and what gets stored is what
  // they actually confirm.
  const [confirmedValue, setConfirmedValue] = useState(
    detail.action.newValue !== null ? String(detail.action.newValue) : "",
  );
  const [showDismiss, setShowDismiss] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const isTerminal = ["verified", "verify_failed", "dismissed", "expired"].includes(detail.status);
  const needsValue = detail.action.field !== null;

  return (
    <div className="border-t border-neutral-200 bg-surface px-5 py-3">
      {error && <p className="mb-2 text-[11.5px] text-red-600">{error}</p>}

      {detail.status === "pending" && (
        <button
          type="button"
          disabled={isBusy}
          onClick={onApprove}
          className="w-full rounded-lg bg-ink px-4 py-2 text-[12.5px] font-bold text-brand transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isBusy ? "Working…" : "Approve task"}
        </button>
      )}

      {detail.status === "approved" && (
        <div className="flex flex-col gap-2">
          {needsValue && (
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">
                Confirm the value you entered
              </span>
              <input
                value={confirmedValue}
                onChange={(e) => setConfirmedValue(e.target.value)}
                className="rounded-lg border border-neutral-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </label>
          )}
          <button
            type="button"
            disabled={isBusy || (needsValue && confirmedValue.trim() === "")}
            onClick={() => onExecute(needsValue ? confirmedValue : null)}
            className="w-full rounded-lg bg-green-700 px-4 py-2 text-[12.5px] font-bold text-neutral-50 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isBusy ? "Working…" : "Mark executed"}
          </button>
        </div>
      )}

      {!isTerminal && (
        <>
          {!showDismiss ? (
            <button
              type="button"
              onClick={() => setShowDismiss(true)}
              className="mt-2 w-full text-[11.5px] font-medium text-neutral-500 transition-colors hover:text-ink"
            >
              Dismiss…
            </button>
          ) : (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-100 p-2.5">
              <select
                aria-label="Dismiss reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="rounded-lg border border-neutral-200 bg-surface px-2.5 py-1.5 text-[12px] text-ink"
              >
                <option value="">Select a reason…</option>
                {DISMISS_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <input
                aria-label="Dismiss note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note"
                className="rounded-lg border border-neutral-200 bg-surface px-2.5 py-1.5 text-[12px] text-ink"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowDismiss(false)}
                  className="flex-1 rounded-lg border border-neutral-200 bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  // Reason is REQUIRED — the API rejects a dismissal without
                  // one, so the button stays disabled rather than round-
                  // tripping to a guaranteed error.
                  disabled={isBusy || reason === ""}
                  onClick={() => onDismiss(reason, note)}
                  className="flex-1 rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-semibold text-neutral-50 disabled:opacity-40"
                >
                  Confirm dismiss
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
