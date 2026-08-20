"use client";

import { useState } from "react";
import {
  buildFallbackLines,
  buildMetricValues,
  buildSourceLine,
  buildWindowLine,
} from "../../_lib/evidence-lines";
import { fetchTaskFacts, type FactsResponse, type TaskDetail } from "../../_lib/ppc-task-detail-api";
import { FactRowsTable } from "./FactRowsTable";

// Ink background, mono type — the terminal is where someone actually reads
// the numbers before acting, so it states its own provenance and never
// renders a fallback value as though it were a configured one.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 leading-relaxed">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <span className="min-w-0 flex-1 text-neutral-50">{children}</span>
    </div>
  );
}

export function EvidenceTerminal({ detail }: { detail: TaskDetail }) {
  // Only one expansion open at a time — opening another replaces it.
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const [facts, setFacts] = useState<FactsResponse | null>(null);
  const [isLoadingFacts, setLoadingFacts] = useState(false);
  const [factsError, setFactsError] = useState<string | null>(null);

  const windowLine = buildWindowLine(detail);
  const values = buildMetricValues(detail);
  const fallbacks = buildFallbackLines(detail);

  async function toggleMetric(key: string) {
    if (openMetric === key) {
      setOpenMetric(null);
      setFacts(null);
      return;
    }
    setOpenMetric(key);
    setFacts(null);
    setFactsError(null);
    setLoadingFacts(true);
    try {
      setFacts(await fetchTaskFacts(detail.id, key));
    } catch (err) {
      setFactsError(err instanceof Error ? err.message : "Couldn't load fact rows");
    } finally {
      setLoadingFacts(false);
    }
  }

  return (
    <div>
      <div className="rounded-lg bg-ink px-4 py-3 font-mono text-[11.5px]">
        {windowLine && <Row label="window">{windowLine}</Row>}

        {values.length > 0 && (
          <Row label="metrics">
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {values.map((v) =>
                v.expandable ? (
                  // Clickable: the API confirmed this metric resolves to real
                  // daily rows.
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => toggleMetric(v.key)}
                    className={`rounded px-1 -mx-1 underline decoration-dotted underline-offset-4 transition-colors hover:bg-neutral-700 hover:text-brand ${
                      openMetric === v.key ? "bg-neutral-700 text-brand" : ""
                    }`}
                    title="Show the daily rows behind this number"
                  >
                    {v.label} {v.display}
                  </button>
                ) : (
                  // Derived — no stored rows exist, so no hover affordance.
                  <span key={v.key} className="text-neutral-300">
                    {v.label} {v.display}
                  </span>
                ),
              )}
            </span>
          </Row>
        )}

        {/* §8.6 grounding: a fallback gets its own line saying so. */}
        {fallbacks.map((f) => (
          <Row key={f.key} label={f.key}>
            {f.display} <span className="text-amber-600">({f.disclosure})</span>
          </Row>
        ))}

        <Row label="source">
          <span className="text-neutral-300">
            {buildSourceLine(detail)}
            {values.some((v) => v.expandable) && " · click any underlined number for fact rows"}
          </span>
        </Row>

        {/* Cross-check, where the rule performed one. */}
        {detail.crossCheck && (
          <Row label="check">
            <span className="text-brand">{detail.crossCheck.summary}</span>
          </Row>
        )}
      </div>

      {openMetric && (
        <FactRowsTable
          metric={openMetric}
          facts={facts}
          isLoading={isLoadingFacts}
          error={factsError}
          onClose={() => {
            setOpenMetric(null);
            setFacts(null);
          }}
        />
      )}
    </div>
  );
}
