"use client";

import { useEffect, useState } from "react";
import { useDateRange } from "../../../_lib/date-range-context";
import { useMarketplace } from "../../../_lib/marketplace-context";
import { fetchPpcClients, type PpcClientRow } from "../../_lib/ppc-clients-api";
import { usePpcClientFilter } from "../../_lib/ppc-client-filter-context";
import { PpcClientCard } from "./PpcClientCard";

export function PpcClientsView() {
  const { range } = useDateRange();
  const { marketplace } = useMarketplace();
  const { clientId } = usePpcClientFilter();

  const [clients, setClients] = useState<PpcClientRow[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchPpcClients(range.from, range.to, marketplace, controller.signal)
      .then(setClients)
      .catch((e) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load clients");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [range.from, range.to, marketplace]);

  const visible = clientId === "all" ? clients : clients.filter((c) => c.id === clientId);
  const lockedCount = clients.filter((c) => c.locked).length;

  return (
    <div className="px-5 py-5">
      {!isLoading && !error && clients.length > 0 && (
        <p className="mb-4 text-[11.5px] text-neutral-400">
          {clients.length} client{clients.length === 1 ? "" : "s"} shown · {lockedCount} awaiting config. External-change
          count is a health stat — a disciplined account trends toward zero.
        </p>
      )}

      {isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-neutral-100" />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center text-[13px] text-red-700">
          Failed to load clients — {error}
        </div>
      )}

      {!isLoading && !error && visible.length === 0 && (
        <div className="rounded-xl border border-neutral-200 bg-surface px-6 py-12 text-center text-[13px] text-neutral-400">
          No clients to show.
        </div>
      )}

      {!isLoading && !error && visible.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
          {visible.map((c) => (
            <PpcClientCard key={c.id} client={c} />
          ))}
        </div>
      )}
    </div>
  );
}
