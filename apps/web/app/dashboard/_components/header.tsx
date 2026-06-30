"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";
import DateFilter from "./date-filter";
import UserMenu from "./user-menu";

export default function Header() {
  const pathname = usePathname();

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

      <div className="flex items-center gap-3">
        <DateFilter />
        <UserMenu />
      </div>
    </header>
  );
}
