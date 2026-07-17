import { apiFetch } from "@/lib/api";

export type AnomalyMetric = "acos" | "spend" | "ctr" | "clicks" | "tacos" | "revenue";
export type AnomalySeverity = "watch" | "act_now";

export interface Anomaly {
  id: string;
  clientId: string;
  clientName: string;
  metric: AnomalyMetric;
  baselineValue: number;
  actualValue: number;
  percentChange: number | null;
  severity: AnomalySeverity;
  explanation: string | null;
  detectedAt: string;
  resolved: boolean;
  resolvedAt: string | null;
}

export async function listAnomalies(opts?: {
  resolved?: boolean;
  clientId?: string;
}): Promise<Anomaly[]> {
  const qs = new URLSearchParams();
  if (opts?.resolved !== undefined) qs.set("resolved", String(opts.resolved));
  if (opts?.clientId) qs.set("clientId", opts.clientId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  const res = await apiFetch(`/api/anomalies${suffix}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function resolveAnomaly(id: string): Promise<void> {
  const res = await apiFetch(`/api/anomalies/${id}/resolve`, { method: "PATCH" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
