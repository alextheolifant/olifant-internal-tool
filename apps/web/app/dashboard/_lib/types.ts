// ─── v2 Dashboard domain types ───────────────────────────────────────────────

export type ViewMode = "core" | "full";
export type Marketplace =
  | "ALL"
  // North America
  | "US" | "CA" | "MX" | "BR"
  // Europe
  | "UK" | "DE" | "FR" | "ES" | "IT" | "NL" | "BE" | "SE" | "PL" | "TR" | "IE"
  // Middle East
  | "AE" | "SA"
  // Far East / Pacific
  | "JP" | "AU";

export type Health = "on_target" | "watch" | "act_now" | "unknown";
export type ClientStatus = "Active" | "Onboarding" | "Paused" | "Churned";
export type Tier = 1 | 2 | 3;

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  ALL: "All Markets",
  // North America
  US: "United States", CA: "Canada", MX: "Mexico", BR: "Brazil",
  // Europe
  UK: "United Kingdom", DE: "Germany", FR: "France", ES: "Spain",
  IT: "Italy", NL: "Netherlands", BE: "Belgium", SE: "Sweden",
  PL: "Poland", TR: "Turkey", IE: "Ireland",
  // Middle East
  AE: "United Arab Emirates", SA: "Saudi Arabia",
  // Far East / Pacific
  JP: "Japan", AU: "Australia",
};

/**
 * Raw inputs from the API — the atomic source of truth.
 * orgRev / orgOrd / units are null until SP-API is connected.
 */
export interface RawInputs {
  spend:   number;
  ppcRev:  number;
  orgRev:  number | null;   // SP-API
  ppcOrd:  number;
  orgOrd:  number | null;   // SP-API
  clicks:  number;
  impr:    number;
  units:   number | null;   // SP-API
}

/** Metrics derived from RawInputs (never average — always derive from summed raws). */
export interface DerivedMetrics {
  revenue:     number | null;   // null when orgRev is null
  tacos:       number | null;   // null when revenue is null
  acos:        number | null;   // null when ppcRev is 0
  roas:        number | null;   // null when spend is 0
  cpc:         number | null;   // null when clicks is 0
  ctr:         number | null;   // null when impr is 0
  cvr:         number | null;   // null when clicks is 0
  organicPct:  number | null;   // null when orgRev is null
  totalOrders: number | null;   // null when orgOrd is null
}

/** Per-marketplace account breakdown (shown in expanded rows). */
export interface AccountRow extends RawInputs {
  profileId:    string;
  marketplace:  string;
  currencyCode: string;
  trend:        number[];
}

/** One row in the main table (aggregated across all/selected marketplace). */
export interface ClientRow extends RawInputs {
  id:           string;
  name:         string;
  tier:         Tier;
  status:       ClientStatus;
  goalRevenue:  number | null;
  goalTacos:    number | null;
  trend:        number[];
  accounts:     AccountRow[];
}

/** Portfolio-level totals row. */
export interface Totals extends RawInputs, DerivedMetrics {
  activeCount: number;
  totalCount:  number;
}
