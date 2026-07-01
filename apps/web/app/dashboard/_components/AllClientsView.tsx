"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import type { ClientRow, ViewMode, Tier, ClientStatus, AccountRow } from "../_lib/types";
import { computeTotals } from "../_lib/totals";
import { apiFetch } from "@/lib/api";
import { useMarketplace } from "../_lib/marketplace-context";
import { TableToolbar } from "./TableToolbar";
import { SummaryCards } from "./SummaryCards";
import { ClientTable } from "./ClientTable";
import { TrendsPanel } from "./TrendsPanel";
import { ClientEditPanel, type ClientFormValues } from "./ClientEditPanel";

// ── API response types ────────────────────────────────────────────────────────

interface ApiAccount {
  profileId: string;
  accountName: string | null;
  marketplace: string | null;
  countryCode: string | null;
  currencyCode: string | null;
}

interface ApiClient {
  id: string;
  name: string;
  tier: number;
  status: string;
  goalTacos: number | null;
  goalRevenue: number | null;
  marketplaceCount: number;
  accounts: ApiAccount[];
}

interface ApiResponse {
  clients: ApiClient[];
  clientCount: number;
  activeCount: number;
}

// ── Mapper: API response → ClientRow[] ───────────────────────────────────────

const ZERO_RAW = {
  spend: 0, ppcRev: 0, orgRev: null,
  ppcOrd: 0, orgOrd: null,
  clicks: 0, impr: 0, units: null,
};

function mapApiClient(c: ApiClient): ClientRow {
  return {
    id: c.id,
    name: c.name,
    tier: (c.tier as Tier) ?? 3,
    status: (c.status as ClientStatus) ?? "Active",
    goalTacos: c.goalTacos,
    goalRevenue: c.goalRevenue,
    trend: [],
    ...ZERO_RAW,
    accounts: c.accounts.map((a): AccountRow => ({
      profileId: a.profileId,
      marketplace: a.marketplace ?? "",
      currencyCode: a.currencyCode ?? "",
      trend: [],
      ...ZERO_RAW,
    })),
  };
}

function mapApiResponse(data: ApiResponse): ClientRow[] {
  return data.clients.map(mapApiClient);
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchClients(marketplace: string): Promise<ClientRow[]> {
  const qs = new URLSearchParams();
  if (marketplace !== "ALL") qs.set("marketplace", marketplace);
  const res = await apiFetch(`/api/clients?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: ApiResponse = await res.json();
  return mapApiResponse(data);
}

// ── Status / Tier maps (form values → API enum strings) ───────────────────────

const STATUS_TO_API: Record<ClientStatus, string> = {
  Active: "active", Onboarding: "onboarding", Paused: "paused", Churned: "churned",
};
const TIER_TO_API: Record<number, string> = { 1: "t1", 2: "t2", 3: "t3" };

// ── Component ─────────────────────────────────────────────────────────────────

export function AllClientsView() {
  const { marketplace } = useMarketplace();

  const [viewMode, setViewMode]       = useState<ViewMode>("core");
  const [showTrends, setShowTrends]   = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [clients, setClients]   = useState<ClientRow[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [, startTransition]     = useTransition();

  // Edit panel state — undefined = closed, ClientRow = editing
  const [editTarget, setEditTarget] = useState<ClientRow | undefined>(undefined);
  const panelOpen = editTarget !== undefined;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchClients(marketplace)
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
  }, [marketplace]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setExpandedIds(new Set()); }, [marketplace]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Save handler (create + edit) ─────────────────────────────────────────

  const handleSave = useCallback(async (values: ClientFormValues) => {
    const body = {
      status: STATUS_TO_API[values.status],
      tier: values.tier != null ? TIER_TO_API[values.tier] : null,
      targetTacos: values.goalTacos !== "" ? parseFloat(values.goalTacos) : null,
      goalRevenue: values.goalRevenue !== "" ? parseFloat(values.goalRevenue) : null,
    };

    // PATCH — optimistic update then API call
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
      const updated: ApiClient = await res.json();
      setClients((prev) => prev.map((c) => (c.id === id ? mapApiClient(updated) : c)));
    } catch (err) {
      setClients((prev) => prev.map((c) => (c.id === id ? editTarget! : c)));
      throw err;
    }
  }, [editTarget]);

  const totals = computeTotals(clients);

  return (
    <div className="flex h-full flex-col bg-canvas overflow-auto">
      <SummaryCards totals={totals} dateRange="7d" isLoading={isLoading} />

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
            showTrends={true}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
            onEdit={(client) => setEditTarget(client)}
            onRetry={load}
          />
        </div>

        {showTrends && (
          <div className="w-[296px] shrink-0 rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
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
