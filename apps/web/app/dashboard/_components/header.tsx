"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";
import DateFilter from "./date-filter";
import UserMenu from "./user-menu";
import { useMarketplace } from "../_lib/marketplace-context";
import { MARKETPLACE_LABELS } from "../_lib/types";
import type { Marketplace } from "../_lib/types";

const MARKETPLACE_OPTIONS: Marketplace[] = ["ALL", "US", "CA", "MX", "BR"];

export default function Header() {
  const pathname = usePathname();
  const { marketplace, setMarketplace } = useMarketplace();

  const activeLabel =
    [...NAV_ITEMS].reverse().find((item) =>
      item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href),
    )?.label ?? "Overview";

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand">
          <span className="text-xs font-bold leading-none text-ink">O</span>
        </div>
        <span className="text-[14px] font-bold text-ink">Olifant Digital</span>
        <span className="ml-1 text-[12px] text-neutral-400">/ {activeLabel}</span>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Marketplace dropdown — visible on dashboard pages */}
        {pathname.startsWith("/dashboard") && (
          <div className="relative">
            <select
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value as Marketplace)}
              className="appearance-none rounded-lg border border-neutral-200 bg-white py-1.5 pl-3 pr-7 text-[12px] font-medium text-ink shadow-sm cursor-pointer hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-brand/40 transition-colors"
            >
              {MARKETPLACE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {MARKETPLACE_LABELS[m]}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        )}

        <DateFilter />
        <UserMenu />
      </div>
    </header>
  );
}
