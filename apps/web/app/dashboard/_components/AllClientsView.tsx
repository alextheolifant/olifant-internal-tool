"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import type { ClientRow, ViewMode, Tier, ClientStatus, AccountRow } from "../_lib/types";
import { computeTotals } from "../_lib/totals";
import { apiFetch } from "@/lib/api";
import { resolveCurrency } from "../_lib/format";
import { useMarketplace } from "../_lib/marketplace-context";
import { useDateRange } from "../_lib/date-range-context";
import { TableToolbar } from "./TableToolbar";
import { SummaryCards } from "./SummaryCards";
import { ClientTable } from "./ClientTable";
import { TrendsPanel } from "./TrendsPanel";
import { ClientEditPanel, type ClientFormValues } from "./ClientEditPanel";

// ── API response types ────────────────────────────────────────────────────────

interface ApiAccount {
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

interface ApiClient {
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

interface ApiResponse {
  from: string;
  to: string;
  marketplace: string;
  clients: ApiClient[];
}

// ── Mapper: API response → ClientRow[] ───────────────────────────────────────

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

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchClients(
  from: string,
  to: string,
  marketplace: string,
): Promise<ClientRow[]> {
  const qs = new URLSearchParams({ from, to });
  if (marketplace !== "ALL") qs.set("marketplace", marketplace);
  const res = await apiFetch(`/api/metrics/clients?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: ApiResponse = await res.json();
  return data.clients.map(mapApiClient);
}

// ── Status / Tier maps (form values → API enum strings) ───────────────────────

const STATUS_TO_API: Record<ClientStatus, string> = {
  Active: "active", Onboarding: "onboarding", Paused: "paused", Churned: "churned",
};
const TIER_TO_API: Record<number, string> = { 1: "t1", 2: "t2", 3: "t3" };

// ── Component ─────────────────────────────────────────────────────────────────

export function AllClientsView() {
  const { marketplace } = useMarketplace();
  const { range } = useDateRange();

  const [viewMode, setViewMode]       = useState<ViewMode>("core");
  const [showTrends, setShowTrends]   = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [clients, setClients]   = useState<ClientRow[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [, startTransition]     = useTransition();

  const [editTarget, setEditTarget] = useState<ClientRow | undefined>(undefined);
  const panelOpen = editTarget !== undefined;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchClients(range.from, range.to, marketplace)
      .then((data) => {
        startTransition(() => {
          setClients(data);
          setLoading(false);
        });
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Unknown error");
        setLoading(false);
      });
  }, [marketplace, range.from, range.to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setExpandedIds(new Set()); }, [marketplace, range.from, range.to]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Save handler (PATCH only — create not yet supported) ─────────────────

  const handleSave = useCallback(async (values: ClientFormValues) => {
    const body = {
      status: STATUS_TO_API[values.status],
      tier: values.tier != null ? TIER_TO_API[values.tier] : null,
      targetTacos: values.goalTacos !== "" ? parseFloat(values.goalTacos) : null,
      goalRevenue: values.goalRevenue !== "" ? parseFloat(values.goalRevenue) : null,
    };

    const id = editTarget!.id;
    const optimistic: ClientRow = {
      ...editTarget!,
      status: values.status,
      tier: values.tier ?? 3,
      goalTacos: values.goalTacos !== "" ? parseFloat(values.goalTacos) : null,
      goalRevenue: values.goalRevenue !== "" ? parseFloat(values.goalRevenue) : null,
    };

    setClients((prev) => prev.map((c) => (c.id === id ? optimistic : c)));

    try {
      const res = await apiFetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      // Reload to get fresh metric data after edit
      load();
    } catch (err) {
      setClients((prev) => prev.map((c) => (c.id === id ? editTarget! : c)));
      throw err;
    }
  }, [editTarget, load]);

  const totals = computeTotals(clients);
  const { code: portfolioCc, approx: portfolioApprox } = resolveCurrency(
    clients.flatMap((c) => c.accounts.map((a) => a.currencyCode)),
  );

  return (
    <div className="flex h-full flex-col bg-canvas overflow-auto">
      <SummaryCards totals={totals} dateLabel={range.label} isLoading={isLoading} currencyCode={portfolioCc} approx={portfolioApprox} />

      <div className="flex flex-1 items-start gap-4 p-4">
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <TableToolbar
            clientCount={clients.length}
            viewMode={viewMode}
            showTrends={showTrends}
            onViewChange={setViewMode}
            onTrendsToggle={() => setShowTrends((v) => !v)}
          />
          <ClientTable
            clients={clients}
            totals={totals}
            isLoading={isLoading}
            error={error}
            viewMode={viewMode}
            showTrends={showTrends}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            onEdit={(client) => setEditTarget(client)}
            onRetry={load}
          />
        </div>

        {showTrends && (
          <div className="w-74 shrink-0 rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
            <TrendsPanel
              clients={clients}
              onClose={() => setShowTrends(false)}
            />
          </div>
        )}
      </div>

      {editTarget && (
        <ClientEditPanel
          client={editTarget}
          isOpen={panelOpen}
          onClose={() => setEditTarget(undefined)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
