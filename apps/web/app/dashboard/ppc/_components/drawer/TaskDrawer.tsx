"use client";

import { useCallback, useEffect, useState } from "react";
import {
  approveTask,
  dismissTask,
  executeTask,
  fetchTaskDetail,
  fetchTaskPerformance,
  type PerformanceResponse,
  type TaskDetail,
} from "../../_lib/ppc-task-detail-api";
import { ChangeCards } from "./ChangeCards";
import { DrawerActions } from "./DrawerActions";
import { DrawerHeader } from "./DrawerHeader";
import { EvidenceTerminal } from "./EvidenceTerminal";
import { PerformanceSection } from "./PerformanceSection";

// Statuses that have a monitor worth charting.
const HAS_PERFORMANCE = ["executed", "verified", "verify_failed"];

/**
 * Right-side slide-in, ~520px. Modelled on the existing ClientEditPanel
 * shell (backdrop + Escape + fixed right panel) so it opens over ANY screen,
 * not just the Queue — Observe will mount the same component later.
 *
 * onUpdated fires after every successful action so the caller can refresh
 * whatever list is underneath; the drawer never leaves a stale view over an
 * updated table.
 */
export function TaskDrawer({
  taskId,
  onClose,
  onUpdated,
}: {
  taskId: string | null;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [perf, setPerf] = useState<PerformanceResponse | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (id: string, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const d = await fetchTaskDetail(id, signal);
        setDetail(d);
        setPerf(HAS_PERFORMANCE.includes(d.status) ? await fetchTaskPerformance(id, signal) : null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Couldn't load this task");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!taskId) {
      setDetail(null);
      setPerf(null);
      setActionError(null);
      return;
    }
    const controller = new AbortController();
    void load(taskId, controller.signal);
    return () => controller.abort();
  }, [taskId, load]);

  useEffect(() => {
    if (!taskId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [taskId, onClose]);

  if (!taskId) return null;

  async function run(action: () => Promise<TaskDetail>) {
    setBusy(true);
    setActionError(null);
    try {
      // The action endpoints return the refreshed detail, so the drawer
      // updates from the server's own view rather than a guessed one.
      const updated = await action();
      setDetail(updated);
      setPerf(HAS_PERFORMANCE.includes(updated.status) ? await fetchTaskPerformance(updated.id) : null);
      onUpdated?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action failed");
      // Re-read on failure so the drawer can't keep showing a state the
      // server rejected.
      if (taskId) await load(taskId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
        className="fixed right-0 top-0 z-50 flex h-full w-[520px] max-w-full flex-col border-l border-neutral-200 bg-surface shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close task detail"
          className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-[16px] leading-none text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-ink"
        >
          ×
        </button>

        {isLoading && !detail && (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-[12px] text-neutral-400">Loading task…</span>
          </div>
        )}

        {error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[13px] font-semibold text-red-600">Couldn&rsquo;t load this task</p>
            <p className="text-[11.5px] text-red-600">{error}</p>
            <button
              onClick={() => taskId && load(taskId)}
              className="mt-1 rounded-lg border border-neutral-200 bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink"
            >
              Retry
            </button>
          </div>
        )}

        {detail && (
          <>
            <DrawerHeader detail={detail} />

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-4">
                {/* What to do — rendered verbatim from the task layer. */}
                <section>
                  <h3 className="mb-2 text-[12px] font-bold text-ink">What to do</h3>
                  <ol className="flex list-decimal flex-col gap-1.5 rounded-lg bg-yellow-200 py-3 pl-8 pr-3">
                    {detail.instructions.map((step, i) => (
                      <li key={i} className="text-[12px] leading-relaxed text-amber-800">{step}</li>
                    ))}
                  </ol>
                </section>

                {/* Why — harvest only. W4 doesn't exist, so the API returns
                    null and this renders nothing rather than placeholder text. */}
                {detail.decisionPath !== null && (
                  <section>
                    <h3 className="mb-2 text-[12px] font-bold text-ink">Why</h3>
                    <div className="rounded-lg bg-green-50 px-3 py-2 text-[12px] text-green-700">
                      {String(detail.decisionPath)}
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="mb-2 text-[12px] font-bold text-ink">Evidence</h3>
                  <EvidenceTerminal detail={detail} />
                </section>

                <ChangeCards action={detail.action} />

                {perf && <PerformanceSection perf={perf} />}

                <p className="text-[11.5px] leading-relaxed text-neutral-500">
                  <span className="font-semibold text-neutral-600">Rollback:</span> {detail.rollback}
                </p>
              </div>
            </div>

            <DrawerActions
              detail={detail}
              isBusy={isBusy}
              error={actionError}
              onApprove={() => run(() => approveTask(detail.id))}
              onExecute={(v) => run(() => executeTask(detail.id, v))}
              onDismiss={(reason, note) => run(() => dismissTask(detail.id, reason, note))}
            />
          </>
        )}
      </aside>
    </>
  );
}
