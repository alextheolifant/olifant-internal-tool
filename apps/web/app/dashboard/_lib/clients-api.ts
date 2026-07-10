// ─── Shared client-roster fetch ───────────────────────────────────────────────
// Single source of truth for GET /api/metrics/clients. Consumed by
// AllClientsView (full metrics table) and useClientRoster (Chat account
// selector) so both stay backed by the same data source.

import type { ClientRow, Tier, ClientStatus, AccountRow } from "./types";
import { apiFetch } from "@/lib/api";

export interface ApiAccount {
  profileId: string;
  marketplace: string;
  currencyCode: string;
  spend: number;
  ppcRev: number;
  ppcOrd: number;
  clicks: number;
  impr: number;
  orgRev: number | null;
  orgOrd: number | null;
  units: number | null;
  trend: number[];
}

export interface ApiClient {
  id: string;
  name: string;
  tier: number;
  status: string;
  goalTacos: number | null;
  goalRevenue: number | null;
  marketplaceCount: number;
  spend: number;
  ppcRev: number;
  ppcOrd: number;
  clicks: number;
  impr: number;
  orgRev: number | null;
  orgOrd: number | null;
  units: number | null;
  trend: number[];
  accounts: ApiAccount[];
}

export interface ApiResponse {
  from: string;
  to: string;
  marketplace: string;
  clients: ApiClient[];
}

function mapApiAccount(a: ApiAccount): AccountRow {
  return {
    profileId: a.profileId,
    marketplace: a.marketplace,
    currencyCode: a.currencyCode,
    spend: a.spend,
    ppcRev: a.ppcRev,
    orgRev: a.orgRev,
    ppcOrd: a.ppcOrd,
    orgOrd: a.orgOrd,
    clicks: a.clicks,
    impr: a.impr,
    units: a.units,
    trend: a.trend,
  };
}

function mapApiClient(c: ApiClient): ClientRow {
  return {
    id: c.id,
    name: c.name,
    tier: (c.tier as Tier) ?? 3,
    status: (c.status as ClientStatus) ?? "Active",
    goalTacos: c.goalTacos,
    goalRevenue: c.goalRevenue,
    spend: c.spend,
    ppcRev: c.ppcRev,
    orgRev: c.orgRev,
    ppcOrd: c.ppcOrd,
    orgOrd: c.orgOrd,
    clicks: c.clicks,
    impr: c.impr,
    units: c.units,
    trend: c.trend,
    accounts: c.accounts.map(mapApiAccount),
  };
}

export async function fetchClients(
  from: string,
  to: string,
  marketplace: string,
  signal: AbortSignal,
): Promise<ClientRow[]> {
  const qs = new URLSearchParams({ from, to });
  if (marketplace !== "ALL") qs.set("marketplace", marketplace);
  const res = await apiFetch(`/api/metrics/clients?${qs}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: ApiResponse = await res.json();
  return data.clients.map(mapApiClient);
}
