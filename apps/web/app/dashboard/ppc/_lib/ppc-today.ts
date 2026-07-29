import type { Health } from "../../_lib/types";
import { usePpcBadgeCounts } from "../../_lib/ppc-status";

export interface PpcException {
  id: string;
  ruleCode: string;
  clientId: string;
  clientName: string;
  severity: Extract<Health, "watch" | "act_now">;
  message: string;
  actionLabel: string;
}

export interface PpcTodaySummary {
  verifiedSavingsPerMonth: number | null;
  openTaskCount: number;
  dollarsAtStakePerMonth: number | null;
  exceptions: PpcException[];
}

/**
 * TODO: replace with real queries once the exceptions/tasks tables exist.
 * openTaskCount is read from usePpcBadgeCounts() so this stat tile and the
 * sidebar's Task Queue badge never disagree once real data lands.
 */
export function usePpcTodaySummary(): { data: PpcTodaySummary; isLoading: boolean } {
  const badges = usePpcBadgeCounts();

  return {
    data: {
      verifiedSavingsPerMonth: null,
      openTaskCount: badges.queue,
      dollarsAtStakePerMonth: null,
      exceptions: [],
    },
    isLoading: false,
  };
}
