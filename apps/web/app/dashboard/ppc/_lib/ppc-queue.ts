"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPpcQueue, type PpcQueueFilters, type PpcQueueResponse } from "./ppc-queue-api";

export interface UsePpcQueueResult {
  data: PpcQueueResponse | null;
  // True only until the first load ever completes.
  isLoading: boolean;
  // True during a refetch (filters changed) — data stays whatever it was, so
  // the table doesn't flash to a skeleton on every filter change.
  isRefetching: boolean;
  error: string | null;
  retry: () => void;
}

export function usePpcQueue(filters: PpcQueueFilters): UsePpcQueueResult {
  const [data, setData] = useState<PpcQueueResponse | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isRefetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const hasLoadedOnce = useRef(false);

  // Filters are an object literal from the caller, so a stable primitive key
  // is what the effect depends on — otherwise every render refetches.
  const filterKey = `${filters.clientId ?? ""}|${filters.type ?? ""}|${filters.status ?? ""}|${filters.assignee ?? ""}`;

  useEffect(() => {
    const controller = new AbortController();
    if (hasLoadedOnce.current) setRefetching(true);
    else setLoading(true);
    setError(null);

    fetchPpcQueue(filters, controller.signal)
      .then((result) => {
        setData(result);
        hasLoadedOnce.current = true;
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load the task queue");
      })
      .finally(() => {
        setLoading(false);
        setRefetching(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, retryToken]);

  const retry = useCallback(() => setRetryToken((n) => n + 1), []);

  return { data, isLoading, isRefetching, error, retry };
}
