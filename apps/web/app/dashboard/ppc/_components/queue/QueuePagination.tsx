"use client";

// Offset paging. Deliberately shows the range rather than a page number —
// "51–100 of 1,453" answers "where am I and how much is left" in one line,
// which a bare page index doesn't.
export function QueuePagination({
  total,
  limit,
  offset,
  isBusy,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  isBusy: boolean;
  onChange: (nextOffset: number) => void;
}) {
  // A single page needs no controls, but the count is still worth stating.
  const hasPages = total > limit;
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  const btn =
    "rounded-lg border border-neutral-200 bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink " +
    "transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-2 flex items-center gap-2">
      <p className="text-[11.5px] text-neutral-400">
        {total === 0 ? "No tasks" : `${first}–${last} of ${total.toLocaleString()}`}
      </p>

      {hasPages && (
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className={btn}
            disabled={!canPrev || isBusy}
            onClick={() => onChange(Math.max(0, offset - limit))}
          >
            Previous
          </button>
          <button
            type="button"
            className={btn}
            disabled={!canNext || isBusy}
            onClick={() => onChange(offset + limit)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
