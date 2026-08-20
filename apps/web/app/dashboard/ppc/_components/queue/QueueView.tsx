"use client";

import { useEffect, useMemo, useState } from "react";
import { tableTokens } from "../../../_lib/theme";
import { usePpcClientFilter } from "../../_lib/ppc-client-filter-context";
import { QUEUE_PAGE_SIZE, bulkApproveTasks, type BulkApproveResponse } from "../../_lib/ppc-queue-api";
import { usePpcQueue } from "../../_lib/ppc-queue";
import { selectAllOfLockedType, selectedType, toggleSelection } from "../../_lib/queue-selection";
import { TaskDrawer } from "../drawer/TaskDrawer";
import { BulkActionBar, BulkResultBanner } from "./BulkActionBar";
import { QueueFilters, hasActiveFilters, type QueueFilterValues } from "./QueueFilters";
import { QueuePagination } from "./QueuePagination";
import { QueueTable } from "./QueueTable";

const EMPTY_FILTERS: QueueFilterValues = { type: "", status: "", assignee: "" };

export function QueueView() {
  const { clientId } = usePpcClientFilter();
  const [filters, setFilters] = useState<QueueFilterValues>(EMPTY_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkApproveResponse | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isRefetching, error, retry } = usePpcQueue({
    clientId,
    type: filters.type || undefined,
    status: filters.status || undefined,
    assignee: filters.assignee || undefined,
    limit: QUEUE_PAGE_SIZE,
    offset,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const lockedType = selectedType(rows, selectedIds);
  const filtersActive = hasActiveFilters(filters, clientId);

  // Assignee options come from whatever the current result set actually
  // contains — there's no assignee directory endpoint, and inventing one
  // would list people who have no tasks.
  const assignees = useMemo(
    () => [...new Set(rows.map((r) => r.assignee).filter((a): a is string => Boolean(a)))].sort(),
    [rows],
  );

  // The client filter lives in the top bar's shared context, so it never
  // passes through applyFilters below — changing it has to reset paging on
  // its own, or switching to a client with fewer tasks strands you on a page
  // that no longer exists.
  useEffect(() => {
    setOffset(0);
    setSelectedIds(new Set());
  }, [clientId]);

  function applyFilters(next: QueueFilterValues) {
    setFilters(next);
    // Back to page one: the old offset may be past the end of the new,
    // smaller result set, which would render an empty page that looks like
    // "no matches".
    setOffset(0);
    // A selection is scoped to the rows that produced it; keeping it across a
    // refetch could submit ids no longer visible.
    setSelectedIds(new Set());
  }

  function goToOffset(next: number) {
    setOffset(next);
    // Same reasoning as a filter change — the selected rows leave the view.
    setSelectedIds(new Set());
  }

  async function handleApprove() {
    setSubmitting(true);
    try {
      const result = await bulkApproveTasks([...selectedIds]);
      setBulkResult(result);
      setSelectedIds(new Set());
      retry(); // refetch so approved rows show their new status
    } catch (err) {
      setBulkResult({
        approved: 0,
        failed: selectedIds.size,
        results: [...selectedIds].map((id) => ({
          id,
          ok: false,
          status: null,
          error: err instanceof Error ? err.message : "Request failed",
        })),
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="px-5 py-5">
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
          <p className="text-[13.5px] font-semibold text-red-600">Couldn&rsquo;t load the task queue</p>
          <p className="mt-1 text-[12px] text-red-600">{error}</p>
          <button
            onClick={retry}
            className="mt-3.5 rounded-lg border border-red-600 bg-surface px-3.5 py-1.5 text-[12px] font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`px-5 py-5 ${isRefetching ? "opacity-60 transition-opacity" : ""}`}>
      <QueueFilters values={filters} assignees={assignees} onChange={applyFilters} />

      {bulkResult && <BulkResultBanner result={bulkResult} onDismiss={() => setBulkResult(null)} />}

      {isLoading ? (
        <QueueSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          filtersActive={filtersActive}
          // An empty PAGE is not an empty queue. This happens when the result
          // set shrinks under you (tasks approved or expired elsewhere) and
          // the current offset falls past the new end — saying "queue is
          // clear" there would be plainly wrong.
          pastEnd={(data?.total ?? 0) > 0}
          onClear={() => applyFilters(EMPTY_FILTERS)}
          onFirstPage={() => goToOffset(0)}
        />
      ) : (
        <>
          <QueueTable
            rows={rows}
            selectedIds={selectedIds}
            onToggle={(id) => setSelectedIds((cur) => toggleSelection(rows, cur, id))}
            onRowClick={setOpenTaskId}
          />
          <QueuePagination
            total={data?.total ?? rows.length}
            limit={data?.limit ?? QUEUE_PAGE_SIZE}
            offset={data?.offset ?? offset}
            isBusy={isRefetching}
            onChange={goToOffset}
          />
        </>
      )}

      <BulkActionBar
        count={selectedIds.size}
        lockedType={lockedType}
        isSubmitting={isSubmitting}
        onApprove={handleApprove}
        onClear={() => setSelectedIds(new Set())}
      />
      {/* Select-all is deliberately not a header checkbox: with the same-type
          rule it would silently pick a type for the user. Exposed only once a
          selection exists and a type is therefore already locked. */}
      <TaskDrawer
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        // Refetch the queue after any action so the row behind the drawer
        // never shows a status the drawer has already moved past.
        onUpdated={retry}
      />

      {lockedType && (
        <button
          type="button"
          onClick={() => setSelectedIds(selectAllOfLockedType(rows, selectedIds))}
          className="mt-2 text-[11.5px] font-medium text-neutral-500 underline-offset-2 hover:text-ink hover:underline"
        >
          Select all visible {lockedType.replace(/_/g, " ")} tasks
        </button>
      )}
    </div>
  );
}

function EmptyState({
  filtersActive,
  pastEnd,
  onClear,
  onFirstPage,
}: {
  filtersActive: boolean;
  pastEnd: boolean;
  onClear: () => void;
  onFirstPage: () => void;
}) {
  if (pastEnd) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-surface px-6 py-12 text-center">
        <p className="text-[13.5px] font-semibold text-ink">Nothing on this page</p>
        <p className="mt-1 text-[12px] text-neutral-500">
          There are still tasks matching your filters — this page is past the end of them.
        </p>
        <button
          onClick={onFirstPage}
          className="mt-3.5 rounded-lg border border-neutral-200 bg-surface px-3.5 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-neutral-100"
        >
          Back to first page
        </button>
      </div>
    );
  }

  // An empty queue WITH filters means something different from a genuinely
  // empty one, so the two never share a message.
  if (filtersActive) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-surface px-6 py-12 text-center">
        <p className="text-[13.5px] font-semibold text-ink">No tasks match these filters</p>
        <p className="mt-1 text-[12px] text-neutral-500">
          The queue isn&rsquo;t empty — the current filter combination just has no results.
        </p>
        <button
          onClick={onClear}
          className="mt-3.5 rounded-lg border border-neutral-200 bg-surface px-3.5 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-neutral-100"
        >
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-green-400 bg-green-50 px-6 py-12 text-center">
      <p className="text-[13.5px] font-semibold text-green-700">Queue is clear</p>
      <p className="mt-1 text-[12px] text-green-700">
        Nothing is waiting for review right now. New tasks appear here as the engine proposes them.
      </p>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-surface">
      <div className={`${tableTokens.headerBg} h-9`} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={`flex items-center gap-4 px-3 py-3.5 ${tableTokens.rowBorder}`}>
          <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-neutral-200" />
          <div className="flex w-28 shrink-0 flex-col items-end gap-1.5">
            <div className="h-3.5 w-20 animate-pulse rounded bg-neutral-200" />
            <div className="h-1 w-full animate-pulse rounded-full bg-neutral-200" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-neutral-200" />
            <div className="h-3 w-40 animate-pulse rounded bg-neutral-200" />
          </div>
          <div className="h-3.5 w-24 shrink-0 animate-pulse rounded bg-neutral-200" />
          <div className="h-3.5 w-16 shrink-0 animate-pulse rounded bg-neutral-200" />
          <div className="h-4 w-10 shrink-0 animate-pulse rounded-full bg-neutral-200" />
          <div className="h-4 w-20 shrink-0 animate-pulse rounded-full bg-neutral-200" />
        </div>
      ))}
    </div>
  );
}
