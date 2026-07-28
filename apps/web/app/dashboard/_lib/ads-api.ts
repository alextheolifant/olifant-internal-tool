import { apiFetch } from "@/lib/api";

export interface AdsManagerAccount {
  id: string;
  connectedAt: string;
  connectedByEmail: string | null;
  isActive: boolean;
}

export async function getAdsManagerAccounts(): Promise<AdsManagerAccount[]> {
  const res = await apiFetch(`/api/ads-api/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function connectAdsManagerAccount(): Promise<{ authorizationUrl: string }> {
  const res = await apiFetch(`/api/ads-api/connect`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
