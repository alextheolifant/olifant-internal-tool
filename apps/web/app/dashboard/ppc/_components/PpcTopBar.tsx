"use client";

import { usePathname } from "next/navigation";
import { PPC_NAV_ITEMS } from "../../_components/nav-items";
import { AccountSelector } from "../../_components/chat/AccountSelector";
import UserMenu from "../../_components/user-menu";
import { useClientRoster } from "../../_lib/use-client-roster";
import { usePpcDataFreshness } from "../../_lib/ppc-status";
import { usePpcClientFilter } from "../_lib/ppc-client-filter-context";

function activeTitle(pathname: string): string {
  return PPC_NAV_ITEMS.find((item) => pathname.startsWith(item.href))?.label ?? "PPC";
}

export default function PpcTopBar() {
  const pathname = usePathname();
  const title = activeTitle(pathname);

  const { clients, isLoading: rosterLoading } = useClientRoster();
  const { clientId, clientLabel, setClient } = usePpcClientFilter();
  const { label: freshnessLabel, isStale } = usePpcDataFreshness();

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-5">
      <span className="text-[14px] font-bold text-ink">{title}</span>

      <div className="flex items-center gap-2.5">
        <AccountSelector
          accountLabel={clientLabel}
          clients={clients}
          isLoading={rosterLoading}
          selectedId={clientId}
          onSelect={setClient}
        />

        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            isStale ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
          }`}
        >
          {freshnessLabel}
        </span>

        <UserMenu />
      </div>
    </header>
  );
}
