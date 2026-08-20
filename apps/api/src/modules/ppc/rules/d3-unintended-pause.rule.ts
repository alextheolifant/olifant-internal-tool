import type {
  RuleConditionResult,
  RuleDefinition,
  RuleEvalContext,
} from './types';

// How far back D3 looks for unattributed pauses — see
// ledger.repository.ts's findUnattributedPauses for why a window exists at
// all (unbounded history would re-propose a dismissed finding forever).
const LOOKBACK_DAYS = 2;

// D3 — Unintended pause: an external, non-task-attributed change paused a
// previously-enabled campaign. Trigger straight from the brief: "external
// state change with no matching task" — which is now exactly what a
// source='external' ledger_entries row already means. Part 2's matching
// step (ledger.service.ts) never writes an 'external' row for anything
// attributable to an existing task in the first place, so D3 doesn't
// re-derive "was this unmatched" — it just reads the ledger.
//
// Scoped to entityType='campaign' only for this build: evidence provenance
// resolution (EvidenceProvenanceResolver.resolveForCampaign) assumes
// entityId is a real campaigns.campaign_id row, which holds for
// campaign-level pauses but not ad_group/keyword-level ones. Extending D3
// to those levels is a natural follow-on, not built here.
export const d3UnintendedPauseRule: RuleDefinition = {
  id: 'D3',
  band: 'D',
  label: 'Unintended pause',

  describe(evidence) {
    const name = String(evidence.campaignName ?? 'Unnamed campaign');
    const detectedAt = String(evidence.detectedAt ?? 'an earlier sync');
    return `Campaign "${name}" was paused outside the task queue (detected ${detectedAt}) — no task attributes the change.`;
  },

  async evaluate(ctx: RuleEvalContext): Promise<RuleConditionResult[]> {
    const sinceDate = new Date(ctx.evaluationDate);
    sinceDate.setUTCDate(sinceDate.getUTCDate() - LOOKBACK_DAYS);

    const rows = await ctx.ledger.findUnattributedPauses(
      ctx.clientId,
      sinceDate,
    );

    return rows.map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      // One-shot detected fact, not a threshold that needs to persist across
      // days — D-band already skips the persistence gate (see
      // persistence-hysteresis-guard.ts); this just needs to fire once,
      // immediately, which holdsAtEnter=true unconditionally does.
      holdsAtEnter: true,
      holdsAtClear: true,
      evidence: {
        campaignName: row.campaignName,
        ledgerEntryId: row.id,
        detectedAt: row.timestampDetected.toISOString(),
        oldValue: row.oldValue,
        newValue: row.newValue,
        category: row.category,
      },
    }));
  },
};
