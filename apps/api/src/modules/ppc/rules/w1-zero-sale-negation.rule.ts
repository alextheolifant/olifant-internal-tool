import { addDaysISO } from './campaign-window';
import { deriveExpectedClicksPerOrder } from './expected-clicks-per-order';
import { checkSettledData } from './settled-data-guard';
import { RULE_THRESHOLD_DEFAULTS } from './thresholds';
import { searchTermEntityId } from './term-normalization';
import type { RuleConditionResult, RuleDefinition, RuleEvalContext } from './types';

// W1 — Zero-sale negation.
//
// Trigger: a search term with clicks ≥ (multiple × expected_clicks_per_order)
// and ZERO orders over the trailing window.
//
// This is the vertical-slice rule the team audits against their own manual
// analysis, and its guards are the whole point — a zero-sale rule without
// them quietly destroys converting keywords. All three, in order:
//
//   Guard 1 — Per-campaign verification. The term is evaluated SEPARATELY
//     INSIDE EACH CAMPAIGN and a negative is only ever proposed in the
//     campaign where the term itself failed. The same term can convert in
//     one campaign and waste in another (different bids, ad groups,
//     products). This is enforced structurally, not by convention:
//     getTermAggregates groups by campaign, and the rule's entity identity
//     is (campaign, term) — see searchTermEntityId. There is no code path
//     that can emit an account-wide negation.
//
//   Guard 2 — Winner cross-check. If the same normalized term converts
//     anywhere else in the account — as a search term in another campaign,
//     or as an enabled EXACT target — the task says so explicitly in its
//     evidence and stays scoped to the failing campaign. This is the
//     context that stops someone broadening the negation by hand.
//
//   Guard 3 — Restatement-age hold. If ≥50% of the term's clicks are newer
//     than the 14-day restatement window, hold. Recent clicks may still
//     convert, and negating on provisional data kills keywords that were
//     about to work. Reuses the existing checkSettledData guard unchanged —
//     its 14-day cutoff and 0.5 default already express exactly this test.
//
// Band W: the runner's persistence guard therefore requires the condition to
// hold on two consecutive evaluations before a candidate is emitted. That's
// existing shared behavior (see persistence-hysteresis-guard.ts), not
// something W1 opts into, and it adds a second layer of protection against
// firing on a single noisy reading.
export const w1ZeroSaleNegationRule: RuleDefinition = {
  id: 'W1',
  band: 'W',
  label: 'Zero-sale negation',

  describe(evidence) {
    const term = String(evidence.searchTerm ?? 'unknown term');
    const campaign = String(evidence.campaignName ?? evidence.campaignId ?? 'a campaign');
    const clicks = Number(evidence.clicks ?? 0);
    const spend = Number(evidence.cost ?? 0);
    const winners = Array.isArray(evidence.winnersElsewhere) ? evidence.winnersElsewhere.length : 0;
    const winnerNote = winners > 0 ? ` Converts elsewhere in ${winners} other place(s) — scope to this campaign only.` : '';
    return `"${term}" took ${clicks} clicks and $${spend.toFixed(2)} with zero orders in "${campaign}".${winnerNote}`;
  },

  async evaluate(ctx: RuleEvalContext): Promise<RuleConditionResult[]> {
    const multiple = ctx.resolveThreshold('w1_clicks_multiple', RULE_THRESHOLD_DEFAULTS.w1_clicks_multiple);
    const windowDays = ctx.resolveThreshold('w1_window_days', RULE_THRESHOLD_DEFAULTS.w1_window_days);
    const expectationDays = ctx.resolveThreshold(
      'w1_expectation_window_days',
      RULE_THRESHOLD_DEFAULTS.w1_expectation_window_days,
    );
    const expectationThresholds = {
      minOrders: ctx.resolveThreshold(
        'w1_expectation_min_orders',
        RULE_THRESHOLD_DEFAULTS.w1_expectation_min_orders,
      ),
      minClicks: ctx.resolveThreshold(
        'w1_expectation_min_clicks',
        RULE_THRESHOLD_DEFAULTS.w1_expectation_min_clicks,
      ),
    };
    const recentShareHold = ctx.resolveThreshold(
      'w1_recent_click_share_hold',
      RULE_THRESHOLD_DEFAULTS.w1_recent_click_share_hold,
    );

    // T-2 settled-data convention, same as every other rule in this band.
    const windowEnd = addDaysISO(ctx.evaluationDate, -2);
    const windowStart = addDaysISO(windowEnd, -(windowDays - 1));
    const expectationStart = addDaysISO(windowEnd, -(expectationDays - 1));

    const accountIds = await ctx.searchTerms.getAccountIds(ctx.clientId);
    if (accountIds.length === 0) return [];

    const [aggregates, populations] = await Promise.all([
      ctx.searchTerms.getTermAggregates(accountIds, windowStart, windowEnd),
      ctx.searchTerms.getClicksOrdersPopulations(accountIds, expectationStart, windowEnd),
    ]);

    const results: RuleConditionResult[] = [];

    for (const agg of aggregates) {
      // ── expected_clicks_per_order, or skip entirely ────────────────────
      const adGroupPop = populations.byAdGroup.get(agg.adGroupId) ?? null;
      const campaignPop = populations.byCampaign.get(agg.campaignId) ?? null;
      const expectation = deriveExpectedClicksPerOrder(adGroupPop, campaignPop, expectationThresholds);

      if (!expectation) {
        // Thin data — W1 does not evaluate. Deliberately NOT emitted as a
        // non-firing result: an entity we can't judge must not write
        // rule_condition_state either, or a later data improvement would
        // look like a condition "clearing".
        continue;
      }

      const clicksThreshold = multiple * expectation.value;
      const triggers = agg.clicks >= clicksThreshold && agg.orders === 0;
      if (!triggers) continue;

      // ── Guard 3 — restatement-age hold ─────────────────────────────────
      // Reference window is the full expectation window so the guard has
      // history meaningfully deeper than its own 14-day cutoff, which is
      // what checkSettledData documents it needs.
      const dailyClicks = await ctx.searchTerms.getTermDailyClicks(
        accountIds,
        agg.campaignId,
        agg.searchTerm,
        expectationStart,
        windowEnd,
      );
      const settled = checkSettledData(dailyClicks, ctx.evaluationDate, recentShareHold);
      if (!settled.isSettled) {
        // Held, not emitted. The condition genuinely holds on the metrics
        // but the data isn't mature enough to act on.
        continue;
      }

      // ── Guard 2 — winner cross-check ───────────────────────────────────
      const winnersElsewhere = await ctx.searchTerms.findWinnersElsewhere(
        accountIds,
        agg.normalizedTerm,
        agg.campaignId,
        windowStart,
        windowEnd,
      );

      // 30d spend expressed as a monthly waste run-rate.
      const monthlyWaste = (agg.cost / windowDays) * 30;

      results.push({
        entityType: 'search_term',
        // (campaign, term) — Guard 1 as an identity, not a convention.
        entityId: searchTermEntityId(agg.campaignId, agg.searchTerm),
        holdsAtEnter: true,
        // No hysteresis band applies: "zero orders" has no looser version.
        // The condition clears the moment a single order lands.
        holdsAtClear: true,
        evidence: {
          searchTerm: agg.searchTerm, // verbatim, never the normalized form
          normalizedTerm: agg.normalizedTerm,
          campaignId: agg.campaignId,
          campaignName: agg.campaignName,
          adGroupId: agg.adGroupId,
          keywordId: agg.keywordId,
          matchType: agg.matchType,
          clicks: agg.clicks,
          cost: agg.cost,
          orders: agg.orders,
          sales: agg.sales,
          expectedClicksPerOrder: expectation.value,
          expectationBasis: expectation.basis,
          expectationSampleClicks: expectation.sampleClicks,
          expectationSampleOrders: expectation.sampleOrders,
          clicksThreshold,
          clicksMultiple: multiple,
          monthlyWaste,
          windowStart,
          windowEnd,
          recentClickShare: settled.recentClickShare,
          // Guard 2's finding — stated whether or not any winner was found,
          // so "we checked and found none" is distinguishable from "we
          // didn't check".
          winnerCrossCheckPerformed: true,
          winnersElsewhere,
          // Never account-wide. Restated in the payload itself so anything
          // reading the evidence downstream sees the scope explicitly.
          scope: 'campaign_only',
        },
      });
    }

    return results;
  },
};
