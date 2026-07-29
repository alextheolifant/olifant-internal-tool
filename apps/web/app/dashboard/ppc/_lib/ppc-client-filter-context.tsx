"use client";

import { createContext, useContext, useState } from "react";

// ─── PPC client filter ────────────────────────────────────────────────────────
// Shared across every PPC Engine screen. Set from the top bar's client filter;
// read by whichever screen needs to scope its data to one client. No screen
// consumes this yet — this shell just makes the state available.

interface PpcClientFilterContextValue {
  clientId: string; // "all" | client.id
  clientLabel: string;
  setClient: (id: string, label: string) => void;
}

const PpcClientFilterContext = createContext<PpcClientFilterContextValue>({
  clientId: "all",
  clientLabel: "All Clients",
  setClient: () => {},
});

export function PpcClientFilterProvider({ children }: { children: React.ReactNode }) {
  const [clientId, setClientId] = useState("all");
  const [clientLabel, setClientLabel] = useState("All Clients");

  const setClient = (id: string, label: string) => {
    setClientId(id);
    setClientLabel(label);
  };

  return (
    <PpcClientFilterContext.Provider value={{ clientId, clientLabel, setClient }}>
      {children}
    </PpcClientFilterContext.Provider>
  );
}

export function usePpcClientFilter() {
  return useContext(PpcClientFilterContext);
}
