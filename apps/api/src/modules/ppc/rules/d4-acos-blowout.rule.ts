import { addDaysISO, aggregateWindow } from './campaign-window';
import { defaultClearThreshold } from './thresholds';
import { checkSettledData } from './settled-data-guard';
import type { RuleConditionResult, RuleDefinition, RuleEvalContext } from './types';

const TRAILING_DAYS = 7;
const REFERENCE_WINDOW_DAYS = 60; // for the settled-data click-maturity check

// D4 — ACOS blowout: campaign's trailing 7d ACOS > 2x BE on >= $X spend.
// Task intent: review campaign.
export const d4AcosBlowoutRule: RuleDefinition = {
  id: 'D4',
  band: 'D',
  label: 'ACOS blowout',

  describe(evidence) {
    const name = String(evidence.campaignName ?? 'Unnamed campaign');
    const acos = Number(evidence.trailing7dAcos).toFixed(1);
    const be = Number(evidence.be);
    const multiplier = Number(evidence.multiplier);
    return `Campaign "${name}" is running ${acos}% ACOS over the last 7 days — ${multiplier}× BE (${be}%).`;
  },

  async evaluate(ctx: RuleEvalContext): Promise<RuleConditionResult[]> {
    if (ctx.be.value === null) return []; // nothing to compare against

    const multiplier = ctx.resolveThreshold('d4_acos_multiplier', 2.0);
    const minSpend = ctx.resolveThreshold('d4_min_spend', 50);
    const enterAcos = ctx.be.value * multiplier;
    const clearAcos = defaultClearThreshold(enterAcos);

    const windowEnd = addDaysISO(ctx.evaluationDate, -2); // T-2, per the settled-data guard
    const trailingStart = addDaysISO(windowEnd, -(TRAILING_DAYS - 1));
    const referenceStart = addDaysISO(windowEnd, -(REFERENCE_WINDOW_DAYS - 1));

    const campaigns = await ctx.campaignMetrics.getEnabledCampaignsWithDailyMetrics(
      ctx.clientId,
      referenceStart,
      windowEnd,
    );

    const results: RuleConditionResult[] = [];
    for (const c of campaigns) {
      const trailing = aggregateWindow(c.dailyMetrics, trailingStart, windowEnd);
      if (trailing.spend < minSpend || trailing.acos === null) continue;

      const settled = checkSettledData(c.dailyMetrics, ctx.evaluationDate);
      if (!settled.isSettled) continue;

      results.push({
        entityType: 'campaign',
        entityId: c.campaignId,
        holdsAtEnter: trailing.acos > enterAcos,
        holdsAtClear: trailing.acos > clearAcos,
        evidence: {
          campaignName: c.campaignName,
          trailing7dAcos: trailing.acos,
          trailing7dSpend: trailing.spend,
          trailing7dSales: trailing.sales,
          windowStart: trailingStart,
          windowEnd,
          be: ctx.be.value,
          beIsFallback: ctx.be.isFallback,
          multiplier,
          enterAcos,
          clearAcos,
          minSpend,
          recentClickShare: settled.recentClickShare,
        },
      });
    }
    return results;
  },
};
