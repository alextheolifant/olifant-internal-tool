"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientRow } from "../../_lib/types";
import { tierTokens, statusTokens } from "../../_lib/theme";
import { IconChevronDown, IconTarget } from "./icons";

interface AccountSelectorProps {
  accountLabel: string;
  clients: ClientRow[];
  isLoading: boolean;
  selectedId: string; // "all" | client.id
  onSelect: (id: string, name: string) => void;
  size?: "sm" | "lg";
}

export function AccountSelector({
  accountLabel,
  clients,
  isLoading,
  selectedId,
  onSelect,
  size = "sm",
}: AccountSelectorProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const big = size === "lg";

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          big
            ? "flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-[13.5px] font-semibold shadow-sm transition-colors hover:border-neutral-300"
            : "flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] shadow-sm transition-colors hover:border-neutral-300"
        }
      >
        <IconTarget className="h-3.5 w-3.5 text-green-700" />
        <span className="font-normal text-neutral-400">{big ? "Working on:" : "Account:"}</span>
        <span className="font-semibold text-ink">{accountLabel}</span>
        <IconChevronDown className="h-2.5 w-2.5 text-neutral-400" />
      </button>

      {open && (
        <div
          className={`absolute z-20 mt-1.5 max-h-80 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg ${
            big ? "left-0" : "right-0"
          }`}
        >
          <button
            onClick={() => {
              onSelect("all", "All Clients");
              setOpen(false);
            }}
            className={`flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-neutral-50 ${
              selectedId === "all" ? "bg-brand/15" : ""
            }`}
          >
            <span className="text-[12.5px] font-semibold text-ink">All Clients</span>
            <span className="text-[10.5px] text-neutral-400">Agency blended</span>
          </button>

          <div className="my-1 border-t border-neutral-150" />

          {isLoading && (
            <div className="px-3 py-2 text-[11.5px] text-neutral-400">Loading clients…</div>
          )}

          {!isLoading && clients.length === 0 && (
            <div className="px-3 py-2 text-[11.5px] text-neutral-400">No clients found</div>
          )}

          {!isLoading &&
            clients.map((c) => {
              const tier = tierTokens[c.tier];
              const status = statusTokens[c.status];
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelect(c.id, c.name);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-neutral-50 ${
                    selectedId === c.id ? "bg-brand/15" : ""
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />
                  <span className="flex-1 truncate text-[12.5px] font-medium text-ink">{c.name}</span>
                  <span
                    className={`inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[9.5px] font-bold ${tier.bg} ${tier.text}`}
                  >
                    {tier.label}
                  </span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
