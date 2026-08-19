"use client";

// ─── PPC Engine status stubs ──────────────────────────────────────────────────
// The exceptions/tasks/ideas tables don't exist yet (later phases). These hooks
// give the shell (sidebar badges, top bar freshness chip) a stable shape to
// render against now, so screens don't need to change when the real data lands.

import { useEffect, useState } from "react";
import { fetchPpcFreshness, type PpcGlobalFreshness } from "../ppc/_lib/ppc-clients-api";

export interface PpcBadgeCounts {
  today: number; // open/unresolved exceptions
  queue: number; // open tasks
  ideas: number; // open ideas
}

// TODO: replace with a real fetch against the exceptions/tasks/ideas tables
// once they exist.
export function usePpcBadgeCounts(): PpcBadgeCounts {
  return { today: 0, queue: 0, ideas: 0 };
}

export interface PpcSyncStatus {
  label: string;
  isStale: boolean; // true when the chip should render as a warning — age OR failures
  isAgeStale: boolean; // true specifically when the last sync itself is >48h old
  hasRecentFailures: boolean; // true when a sync has failed within the last 24h
}

function formatSyncDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Backs the PPC top bar's data-freshness chip. Reports on engine-wide sync
// health (last completed sync + whether anything's failing recently), not
// scoped to whatever client filter is selected — same rationale as the
// backend's getGlobalFreshness().
export function usePpcDataFreshness(): PpcSyncStatus {
  const [freshness, setFreshness] = useState<PpcGlobalFreshness | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchPpcFreshness(controller.signal)
      .then(setFreshness)
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return { label: "● sync status unavailable", isStale: true, isAgeStale: false, hasRecentFailures: false };
  }
  if (!freshness || !freshness.lastSyncedAt) {
    return { label: "● no sync data yet", isStale: true, isAgeStale: true, hasRecentFailures: false };
  }

  const isAgeStale = freshness.level === "act_now";
  const isStale = isAgeStale || freshness.hasRecentFailures;
  const statusPhrase = freshness.hasRecentFailures
    ? "sync issues detected"
    : isAgeStale
      ? "sync overdue"
      : "all reports reconciled";

  return {
    label: `● data through ${formatSyncDate(freshness.lastSyncedAt)} · ${statusPhrase}`,
    isStale,
    isAgeStale,
    hasRecentFailures: freshness.hasRecentFailures,
  };
}
