import { addDaysISO } from './campaign-window';
import { defaultClearThresholdForLowMetric } from './thresholds';
import type {
  RuleConditionResult,
  RuleDefinition,
  RuleEvalContext,
} from './types';

const BASELINE_DAYS = 7;
// "Previously serving" = majority (>half) of the 7 days before yesterday had
// meaningful impressions. Treated as a fixed structural definition, not a
// tunable threshold — the meaningful-impressions bar itself IS tunable
// (d5_meaningful_impressions), this just says how many of 7 days must clear it.
const MAJORITY_DAYS_REQUIRED = 4;

// D5 — Delivery stopped: a previously-serving campaign is at ~0 impressions
// yesterday (T-2) and is not paused. Task intent: diagnose (bid below floor,
// ad eligibility, stock issue) — NOT to take an automatic action.
//
// GAP, same root cause as D1: "not out of budget" cannot be verified — no
// budget-capped/serving-status signal is synced (see D1's comment for the
// full investigation: confirmed empirically against 27k+ real campaigns'
// raw_data, and the Go sync code doesn't request or parse any such field).
//
// Unlike D1, this rule still FIRES on what IS verifiable (near-zero
// impressions + not paused) rather than gating off entirely. Reasoning: D1's
// trigger requires certainty because its task intent is a specific action
// (raise budget by X%) — firing on a guess would recommend a concrete change
// based on an unconfirmed premise. D5's task intent is "go investigate why,"
// not "take this action" — surfacing "this stopped serving, cause unknown"
// still has real diagnostic value even without ruling out budget as one of
// several possible causes. Evidence marks budget status explicitly unknown
// rather than fabricating a check either way. Flagging this interpretation
// for confirmation, since the brief said "apply the same approach as D1"
// without specifying which part (the honesty methodology, or the literal
// always-false gate) that referred to.
export const d5DeliveryStoppedRule: RuleDefinition = {
  id: 'D5',
  band: 'D',
  label: 'Delivery stopped',

  describe(evidence) {
    const name = String(evidence.campaignName ?? 'Unnamed campaign');
    const impressions = Number(evidence.impressionsYesterday);
    const daysMeetingBar = Number(evidence.trailingBaselineDaysMeetingBar);
    return `Campaign "${name}" had ${impressions} impression${impressions === 1 ? '' : 's'} yesterday after serving normally on ${daysMeetingBar} of the last 7 days — budget status unknown.`;
  },

  async evaluate(ctx: RuleEvalContext): Promise<RuleConditionResult[]> {
    const nearZeroThreshold = ctx.resolveThreshold(
      'd5_near_zero_impressions',
      2,
    );
    const meaningfulThreshold = ctx.resolveThreshold(
      'd5_meaningful_impressions',
      10,
    );
    const clearThreshold = defaultClearThresholdForLowMetric(nearZeroThreshold);

    const windowEnd = addDaysISO(ctx.evaluationDate, -2); // T-2, per the settled-data convention
    const baselineEnd = addDaysISO(windowEnd, -1); // T-3 — the day before yesterday
    const baselineStart = addDaysISO(baselineEnd, -(BASELINE_DAYS - 1)); // 7 days ending T-3

    // getEnabledCampaignsWithDailyMetrics already filters to state='ENABLED',
    // which IS the "not paused" check — no separate query needed.
    const campaigns =
      await ctx.campaignMetrics.getEnabledCampaignsWithDailyMetrics(
        ctx.clientId,
        baselineStart,
        windowEnd,
      );

    const results: RuleConditionResult[] = [];
    for (const c of campaigns) {
      const yesterday = c.dailyMetrics.find((d) => d.date === windowEnd);
      const impressionsYesterday = yesterday?.impressions ?? 0;

      const baselineDays = c.dailyMetrics.filter(
        (d) => d.date >= baselineStart && d.date <= baselineEnd,
      );
      const daysMeetingBar = baselineDays.filter(
        (d) => d.impressions >= meaningfulThreshold,
      ).length;
      const wasPreviouslyServing = daysMeetingBar >= MAJORITY_DAYS_REQUIRED;

      if (!wasPreviouslyServing) continue; // never really serving — "stopped" doesn't apply

      // Average sales/spend across only the qualifying (bar-meeting) baseline
      // days — a stopped-delivery day mixed into a plain 7-day average would
      // understate what "normal" looked like. Surfaced here (not just
      // impressions) so the task layer can derive a real lost-sales impact
      // estimate instead of leaving D5 with no dollar figure at all.
      const qualifyingDays = baselineDays.filter(
        (d) => d.impressions >= meaningfulThreshold,
      );
      const baselineAvgDailySales =
        qualifyingDays.reduce((sum, d) => sum + d.sales, 0) /
        qualifyingDays.length;
      const baselineAvgDailySpend =
        qualifyingDays.reduce((sum, d) => sum + d.spend, 0) /
        qualifyingDays.length;

      results.push({
        entityType: 'campaign',
        entityId: c.campaignId,
        holdsAtEnter: impressionsYesterday <= nearZeroThreshold,
        holdsAtClear: impressionsYesterday <= clearThreshold,
        evidence: {
          campaignName: c.campaignName,
          impressionsYesterday,
          yesterdayDate: windowEnd,
          trailingBaselineDaysMeetingBar: daysMeetingBar,
          trailingBaselineDaysRequired: MAJORITY_DAYS_REQUIRED,
          trailingBaselineWindow: { start: baselineStart, end: baselineEnd },
          meaningfulImpressionsThreshold: meaningfulThreshold,
          nearZeroThreshold,
          campaignState: 'ENABLED',
          budgetStatus:
            'unknown — not synced (see rule comment for what was checked)',
          baselineAvgDailySales,
          baselineAvgDailySpend,
        },
      });
    }
    return results;
  },
};
