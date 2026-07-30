// ─── Shared client-roster fetch ───────────────────────────────────────────────
// Single source of truth for GET /api/metrics/clients. Consumed by
// AllClientsView (full metrics table) and useClientRoster (Chat account
// selector) so both stay backed by the same data source.

import type { ClientRow, Tier, ClientStatus, AccountRow, Totals } from "./types";
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
  spConnected: boolean;
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

export interface ApiTotals {
  spend: number;
  ppcRev: number;
  ppcOrd: number;
  clicks: number;
  impr: number;
  orgRev: number | null;
  orgOrd: number | null;
  units: number | null;
  revenue: number | null;
  tacos: number | null;
  acos: number | null;
  roas: number | null;
  cpc: number | null;
  ctr: number | null;
  cvr: number | null;
  organicPct: number | null;
  totalOrders: number | null;
  clientCount: number;
  activeCount: number;
}

export interface ApiResponse {
  from: string;
  to: string;
  marketplace: string;
  clients: ApiClient[];
  totals: ApiTotals;
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

function mapApiTotals(t: ApiTotals): Totals {
  return {
    spend: t.spend,
    ppcRev: t.ppcRev,
    orgRev: t.orgRev,
    ppcOrd: t.ppcOrd,
    orgOrd: t.orgOrd,
    clicks: t.clicks,
    impr: t.impr,
    units: t.units,
    revenue: t.revenue,
    tacos: t.tacos,
    acos: t.acos,
    roas: t.roas,
    cpc: t.cpc,
    ctr: t.ctr,
    cvr: t.cvr,
    organicPct: t.organicPct,
    totalOrders: t.totalOrders,
    activeCount: t.activeCount,
    totalCount: t.clientCount,
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
    spConnected: c.spConnected,
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

export interface ClientsAndTotals {
  clients: ClientRow[];
  totals: Totals;
}

export async function fetchClients(
  from: string,
  to: string,
  marketplace: string,
  signal: AbortSignal,
): Promise<ClientsAndTotals> {
  const qs = new URLSearchParams({ from, to });
  if (marketplace !== "ALL") qs.set("marketplace", marketplace);
  const res = await apiFetch(`/api/metrics/clients?${qs}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: ApiResponse = await res.json();
  return { clients: data.clients.map(mapApiClient), totals: mapApiTotals(data.totals) };
}
