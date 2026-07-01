"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { Marketplace } from "./types";

interface MarketplaceContextValue {
  marketplace: Marketplace;
  setMarketplace: (m: Marketplace) => void;
}

const MarketplaceContext = createContext<MarketplaceContextValue>({
  marketplace: "ALL",
  setMarketplace: () => {},
});

export function MarketplaceProvider({ children }: { children: React.ReactNode }) {
  const [marketplace, setMarketplaceRaw] = useState<Marketplace>("ALL");

  const setMarketplace = useCallback((m: Marketplace) => {
    setMarketplaceRaw(m);
  }, []);

  return (
    <MarketplaceContext.Provider value={{ marketplace, setMarketplace }}>
      {children}
    </MarketplaceContext.Provider>
  );
}

export function useMarketplace() {
  return useContext(MarketplaceContext);
}
