"use client";

import { useRouter } from "next/navigation";
import type { PpcClientRow } from "../../_lib/ppc-clients-api";
import { statusTokens } from "../../../_lib/theme";
import { cur, pct, xfmt } from "../../../_lib/format";
import type { ClientStatus } from "../../../_lib/types";
import { usePpcClientFilter } from "../../_lib/ppc-client-filter-context";
import { freshnessText } from "../FreshnessBadge";
import { healthTokens } from "../../../_lib/theme";


function Kv({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[12.5px]">
      <span className="text-neutral-400">{label}</span>
      <span className={`font-mono ${valueClass ?? "text-ink"}`}>{value}</span>
    </div>
  );
}

export function PpcClientCard({ client }: { client: PpcClientRow }) {
  const router = useRouter();
  const { setClient } = usePpcClientFilter();

  function goToConfig() {
    setClient(client.id, client.name);
    router.push("/dashboard/ppc/config");
  }

  if (client.locked) {
    const missing = client.configChecklist.filter((c) => !c.met);
    return (
      <div className="rounded-xl border border-dashed border-brand bg-amber-50/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-ink">{client.name}</span>
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800">
            config incomplete
          </span>
        </div>
        <p className="my-3 text-[12.5px] leading-relaxed text-neutral-600">
          Optimization paused — configuration incomplete. {missing.length} field{missing.length === 1 ? "" : "s"}{" "}
          missing: {missing.map((m) => m.label).join(", ")}. The engine generates no tasks for this account until
          config is complete.
        </p>
        <button
          onClick={goToConfig}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-semibold text-brand transition-colors hover:bg-ink/90"
        >
          Complete config
        </button>
      </div>
    );
  }

  const status = statusTokens[client.status as ClientStatus];
  const freshTokens = healthTokens[client.freshness.level];

  return (
    <div className="rounded-xl border border-neutral-200 bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-ink">{client.name}</span>
        <span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
          T{client.tier}
        </span>
      </div>

      <div className="mt-2.5 space-y-0.5">
        <Kv label="Status" value={status.label} valueClass={status.text} />
        <Kv label="Ad Spend" value={cur(client.spend)} />
        <Kv label="ACoS" value={pct(client.acos)} />
        <Kv label="ROAS" value={xfmt(client.roas)} />
        <Kv label="Wasted spend" value="not yet available" valueClass="text-neutral-300" />
        <Kv label="Open tasks" value="not yet available" valueClass="text-neutral-300" />
        <Kv label="$ at stake" value="not yet available" valueClass="text-neutral-300" />
        <Kv label="Verified savings/mo" value="not yet available" valueClass="text-neutral-300" />
        <Kv label="Guard" value="not yet available" valueClass="text-neutral-300" />
        <Kv label="External changes (30d)" value="not yet available" valueClass="text-neutral-300" />
        <Kv
          label="Month pacing (simplified)"
          value={
            client.pacing ? `${Math.round(client.pacing.percent)}% of ${cur(client.pacing.monthlyBudget)}` : "no budget set"
          }
          valueClass={client.pacing ? undefined : "text-neutral-300"}
        />
        <Kv label="Data through" value={freshnessText(client.freshness.lastSyncedAt)} valueClass={freshTokens.text} />
        <Kv label="Config" value={`✓ ${client.configCompletePercent}% complete`} valueClass="text-green-700" />
      </div>
    </div>
  );
}
