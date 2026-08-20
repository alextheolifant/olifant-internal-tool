import { apiFetch } from "@/lib/api";
import type { Health } from "../../_lib/types";

// Same four values as Health (apps/web/app/dashboard/_lib/types.ts) — the
// backend's GET /ppc/today returns this exact string so the frontend can
// index straight into healthTokens with no translation layer.
export type GuardColor = Health;

export interface PpcTodayException {
  ruleId: string;
  ruleLabel: string;
  clientId: string;
  clientName: string;
  description: string;
  evidence: Record<string, unknown>;
  guardColor: GuardColor;
}

export interface PpcTodayResponse {
  evaluationDate: string;
  statCards: {
    // Real, from concluded monitors. Null only while nothing has concluded
    // its 30-day window yet — verifiedSavingsPending disambiguates that
    // from a measured $0.
    verifiedSavings: number | null;
    verifiedSavingsPending: boolean;
    openTasksCount: number;
    dollarsAtStake: number | null;
    exceptionsToday: number;
  };
  exceptions: PpcTodayException[];
}

export async function fetchPpcToday(clientId: string, signal?: AbortSignal): Promise<PpcTodayResponse> {
  const qs = clientId !== "all" ? `?clientId=${encodeURIComponent(clientId)}` : "";
  const res = await apiFetch(`/api/ppc/today${qs}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
