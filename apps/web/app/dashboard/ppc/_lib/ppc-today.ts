"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPpcToday, type PpcTodayResponse } from "./ppc-today-api";

export interface UsePpcTodayResult {
  data: PpcTodayResponse | null;
  // True only until the first successful (or failed) load ever completes.
  isLoading: boolean;
  // True during a subsequent fetch (e.g. client filter changed) — data stays
  // whatever it was before, so the screen doesn't flash to a loading state.
  isRefetching: boolean;
  error: string | null;
  retry: () => void;
}

export function usePpcToday(clientId: string): UsePpcTodayResult {
  const [data, setData] = useState<PpcTodayResponse | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isRefetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    if (hasLoadedOnce.current) setRefetching(true);
    else setLoading(true);
    setError(null);

    fetchPpcToday(clientId, controller.signal)
      .then((result) => {
        setData(result);
        hasLoadedOnce.current = true;
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load Today data");
      })
      .finally(() => {
        setLoading(false);
        setRefetching(false);
      });

    return () => controller.abort();
  }, [clientId, retryToken]);

  const retry = useCallback(() => setRetryToken((n) => n + 1), []);

  return { data, isLoading, isRefetching, error, retry };
}
