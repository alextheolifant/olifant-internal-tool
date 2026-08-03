import { apiFetch } from "@/lib/api";
import type { Health } from "../../_lib/types";

export interface PpcConfigChecklistItem {
  key: string;
  label: string;
  met: boolean;
}

export interface PpcClientFreshness {
  lastSyncedAt: string | null;
  level: Health;
}

export interface PpcClientPacing {
  spendMonthToDate: number;
  monthlyBudget: number;
  percent: number;
}

export interface PpcClientRow {
  id: string;
  name: string;
  tier: number;
  status: string;
  spend: number;
  acos: number;
  roas: number;
  wastedSpend: null;
  configCompletePercent: number;
  configChecklist: PpcConfigChecklistItem[];
  locked: boolean;
  freshness: PpcClientFreshness;
  pacing: PpcClientPacing | null;
  openTasks: null;
  dollarsAtStake: null;
  verifiedSavingsPerMonth: null;
  guardActive: null;
  externalChanges30d: null;
}

export async function fetchPpcClients(
  from: string,
  to: string,
  marketplace: string,
  signal?: AbortSignal,
): Promise<PpcClientRow[]> {
  const qs = new URLSearchParams({ from, to });
  if (marketplace !== "ALL") qs.set("marketplace", marketplace);
  const res = await apiFetch(`/api/ppc/clients?${qs}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: { clients: PpcClientRow[] } = await res.json();
  return data.clients;
}
