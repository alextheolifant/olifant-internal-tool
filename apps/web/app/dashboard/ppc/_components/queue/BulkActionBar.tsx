"use client";

import { healthTokens, taskTypeToken } from "../../../_lib/theme";
import type { BulkApproveResponse } from "../../_lib/ppc-queue-api";

// Sticky bar shown while a selection exists. The API returns PER-TASK
// results, so a partial outcome is reported as exactly that — never
// flattened into a blanket "approved" or "failed", which would leave the
// user unsure which rows actually moved.
export function BulkActionBar({
  count,
  lockedType,
  isSubmitting,
  onApprove,
  onClear,
}: {
  count: number;
  lockedType: string | null;
  isSubmitting: boolean;
  onApprove: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  const typeLabel = lockedType ? taskTypeToken(lockedType).label.toLowerCase() : "task";

  return (
    <div className="sticky bottom-4 z-10 mt-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-ink px-4 py-3 shadow-lg">
      <span className="text-[12.5px] font-semibold text-neutral-50">
        {count} {typeLabel}
        {count === 1 ? "" : "s"} selected
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-[11.5px] font-medium text-neutral-300 underline-offset-2 hover:underline"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onApprove}
        disabled={isSubmitting}
        className="ml-auto rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-bold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isSubmitting ? "Approving…" : `Approve ${count}`}
      </button>
    </div>
  );
}

export function BulkResultBanner({
  result,
  onDismiss,
}: {
  result: BulkApproveResponse;
  onDismiss: () => void;
}) {
  const allOk = result.failed === 0;
  const allFailed = result.approved === 0;
  const tone = allOk ? healthTokens.on_target : allFailed ? healthTokens.act_now : healthTokens.watch;

  return (
    <div className={`mb-3 rounded-lg border ${tone.border} ${tone.bg} px-4 py-2.5`}>
      <div className="flex items-center gap-3">
        <p className={`text-[12px] font-semibold ${tone.text}`}>
          {allOk
            ? `Approved ${result.approved} task${result.approved === 1 ? "" : "s"}.`
            : allFailed
              ? `Nothing was approved — ${result.failed} task${result.failed === 1 ? "" : "s"} failed.`
              : `Approved ${result.approved}, ${result.failed} failed.`}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className={`ml-auto text-[11.5px] font-medium ${tone.text} underline-offset-2 hover:underline`}
        >
          Dismiss
        </button>
      </div>

      {/* Per-task detail for anything that didn't go through, so a partial
          result is actionable rather than just a count. */}
      {result.failed > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {result.results
            .filter((r) => !r.ok)
            .map((r) => (
              <li key={r.id} className={`text-[11.5px] ${tone.text}`}>
                <span className="font-mono">{r.id}</span> — {r.error ?? "failed"}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
