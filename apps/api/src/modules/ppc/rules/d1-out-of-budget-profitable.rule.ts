import { addDaysISO, aggregateWindow } from './campaign-window';
import type { RuleConditionResult, RuleDefinition, RuleEvalContext } from './types';

const TRAILING_DAYS = 30;

// D1 — Out of budget, profitable: campaign hit its budget cap yesterday
// (T-2, per the settled-data convention) AND 30d ACOS < BE. Task intent:
// raise budget (suggested +25-50%).
//
// GAP — reported, not approximated (checked before writing this rule):
// neither `campaigns` nor `campaign_metrics_daily` carries any budget-usage /
// serving-status signal. Confirmed empirically against 27,636 real synced
// campaigns' raw_data (services/sync-ads-api's Campaign struct stores
// Amazon's full campaign JSON via `Raw json.RawMessage`) — zero occurrences
// of servingStatus, budgetUsage, or any OUT_OF_BUDGET-shaped field anywhere
// in it, and the Go sync code doesn't request or parse any such field either.
// Amazon's Campaigns API can expose a servingStatus (which includes an
// out-of-budget state) but this sync doesn't currently fetch it.
//
// So: the profitability half (30d ACOS < BE) is fully implemented below and
// ready to use, but `cappedYesterday` is hardcoded false — this rule can
// never emit today. That's deliberate: emitting on half the trigger
// condition would be exactly the "approximate with a proxy" this task
// explicitly forbids. Once a budget-capped signal is synced (either by
// requesting servingStatus in sync-campaigns, or from a dedicated budget
// usage report), replace the hardcoded false below with the real per-campaign
// flag — everything else here is already correct and ready to combine with it.

export const d1OutOfBudgetProfitableRule: RuleDefinition = {
  id: 'D1',
  band: 'D',
  label: 'Out of budget, profitable',

  // Written for whenever the gap above closes and this can actually fire —
  // never exercised today since holdsAtEnter is always false.
  describe(evidence) {
    const name = String(evidence.campaignName ?? 'Unnamed campaign');
    const acos = Number(evidence.trailing30dAcos).toFixed(1);
    const be = Number(evidence.be);
    return `Campaign "${name}" capped out while profitable — ${acos}% ACOS vs ${be}% BE.`;
  },

  async evaluate(ctx: RuleEvalContext): Promise<RuleConditionResult[]> {
    if (ctx.be.value === null) return [];

    const windowEnd = addDaysISO(ctx.evaluationDate, -2); // T-2
    const windowStart = addDaysISO(windowEnd, -(TRAILING_DAYS - 1));

    const campaigns = await ctx.campaignMetrics.getEnabledCampaignsWithDailyMetrics(
      ctx.clientId,
      windowStart,
      windowEnd,
    );

    const results: RuleConditionResult[] = [];
    for (const c of campaigns) {
      const trailing = aggregateWindow(c.dailyMetrics, windowStart, windowEnd);
      if (trailing.acos === null) continue; // no sales in window — nothing to compare

      const isProfitable = trailing.acos < ctx.be.value;
      // Always false — see the gap note above. Never derived from a proxy.
      const cappedYesterday = false;

      results.push({
        entityType: 'campaign',
        entityId: c.campaignId,
        holdsAtEnter: cappedYesterday && isProfitable,
        holdsAtClear: cappedYesterday && isProfitable,
        evidence: {
          campaignName: c.campaignName,
          // The campaign's currently-synced daily budget — real data (from
          // campaigns.budget), surfaced here so the task layer's suggested
          // budget increase has something real to compute from whenever the
          // gate above closes. Not itself the missing signal — that's still
          // budgetCappedSignal below.
          currentBudget: c.budget ?? null,
          trailing30dAcos: trailing.acos,
          trailing30dSpend: trailing.spend,
          be: ctx.be.value,
          beIsFallback: ctx.be.isFallback,
          isProfitable,
          windowStart,
          windowEnd,
          budgetCappedSignal: 'unavailable — not synced (see rule comment for what was checked)',
          // Amazon's own missed-sales estimate isn't synced either — same
          // "report the gap" instruction applies; nothing fabricated here.
          missedSalesEstimate: 'unavailable — not synced',
        },
      });
    }
    return results;
  },
};
