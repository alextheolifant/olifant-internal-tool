"use client";

import { createContext, useCallback, useContext, useState } from "react";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to:   string; // YYYY-MM-DD
  label: string;
}

interface DateRangeContextValue {
  range: DateRange;
  setRange: (r: DateRange) => void;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultRange(): DateRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(today);
  from.setDate(from.getDate() - 6);
  return { from: isoDate(from), to: isoDate(today), label: "Last 7 Days" };
}

const DateRangeContext = createContext<DateRangeContextValue>({
  range: defaultRange(),
  setRange: () => {},
});

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [range, setRaw] = useState<DateRange>(defaultRange);
  const setRange = useCallback((r: DateRange) => setRaw(r), []);
  return (
    <DateRangeContext.Provider value={{ range, setRange }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  return useContext(DateRangeContext);
}
