"use client";

import { useEffect, useState } from "react";
import type { ClientRow } from "./types";
import { useDateRange } from "./date-range-context";
import { useMarketplace } from "./marketplace-context";
import { fetchClients } from "./clients-api";

/**
 * Client roster for pickers (e.g. the Chat account selector). Reuses the same
 * fetchClients() call as AllClientsView so there's one fetch path for the
 * client list, not a duplicate one per surface.
 */
export function useClientRoster() {
  const { range } = useDateRange();
  const { marketplace } = useMarketplace();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchClients(range.from, range.to, marketplace, controller.signal)
      .then((data) => setClients(data))
      .catch((e) => {
        if (e instanceof Error && e.name === "AbortError") return;
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [range.from, range.to, marketplace]);

  return { clients, isLoading };
}
