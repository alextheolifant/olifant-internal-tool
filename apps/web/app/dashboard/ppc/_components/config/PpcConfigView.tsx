"use client";

import { useState } from "react";
import { usePpcClientFilter } from "../../_lib/ppc-client-filter-context";
import { ClientSettingsTab } from "./ClientSettingsTab";
import { StrategyDefinitionsTab } from "./StrategyDefinitionsTab";

type Tab = "settings" | "strategies";

export function PpcConfigView() {
  const { clientId, clientLabel } = usePpcClientFilter();
  const [tab, setTab] = useState<Tab>("settings");

  return (
    <div className="px-5 py-5">
      <div className="mb-4 flex gap-1.5">
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
          Client settings
        </TabButton>
        <TabButton active={tab === "strategies"} onClick={() => setTab("strategies")}>
          Strategy definitions
        </TabButton>
      </div>

      {tab === "strategies" && <StrategyDefinitionsTab />}

      {tab === "settings" &&
        (clientId === "all" ? (
          <div className="rounded-xl border border-neutral-200 bg-surface px-6 py-12 text-center">
            <p className="text-[13.5px] font-semibold text-ink">Pick a client to configure</p>
            <p className="mt-1 text-[12px] text-neutral-500">
              Client settings apply to one account at a time — use the client filter in the top bar.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-[12px] text-neutral-400">Editing configuration for {clientLabel}</p>
            <ClientSettingsTab clientId={clientId} />
          </>
        ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
        active ? "bg-ink text-brand" : "text-neutral-500 hover:bg-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}
