import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { amazonAdsAccounts, campaigns, syncLogs } from '../../../db/schema';
import { parseSearchTermEntityId } from '../rules/term-normalization';
import type { TaskEvidence, TaskEvidenceProvenance } from './task.types';

/**
 * Which sync actually sourced a rule's metrics, by the grain the rule reads.
 *
 * Not a per-rule map: it keys on entity type, so any future rule reading
 * search terms or targets gets correct provenance without touching this.
 * This is what lets the facts endpoint resolve a fact table from provenance
 * alone (see fact-source.ts) instead of hardcoding a table per rule.
 */
const SYNC_TYPE_BY_ENTITY_TYPE: Record<string, 'ads_metrics' | 'ads_search_term' | 'ads_targeting'> = {
  campaign: 'ads_metrics',
  search_term: 'ads_search_term',
  keyword: 'ads_targeting',
  product_target: 'ads_targeting',
};

@Injectable()
export class EvidenceProvenanceResolver {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * "Report job id" = the id of the most recent successful sync_logs row of
   * the sync type that sources this entity's grain, for the entity's account.
   *
   * campaign_metrics_daily and friends carry no per-row sync lineage —
   * they're upserted in place keyed on (entity, date), not append-only with
   * a sync_log_id column — so exact row-level provenance for a given number
   * isn't tracked anywhere in this codebase. The closest real, traceable
   * answer to "where did these numbers come from" is: the last sync that
   * successfully wrote this account's data at this grain. That's what this
   * resolves to. Documented rather than fabricating row-level lineage.
   *
   * Also resolves the task's "profile" (e.g. "US") from the same join — a
   * client can own accounts across multiple marketplaces, so it comes from
   * the specific account that owns the campaign, not the client row.
   */
  async resolveForEntity(
    clientId: string,
    entityType: string,
    entityId: string,
  ): Promise<{ provenance: TaskEvidenceProvenance; profile: string | null }> {
    const campaignId = campaignIdFor(entityType, entityId);
    const syncType = SYNC_TYPE_BY_ENTITY_TYPE[entityType] ?? 'ads_metrics';
    const empty = { provenance: { reportJobId: null, syncedAt: null, syncType }, profile: null };

    if (!campaignId) return empty;

    const [row] = await this.drizzle.db
      .select({
        syncLogId: syncLogs.id,
        completedAt: syncLogs.completedAt,
        countryCode: amazonAdsAccounts.countryCode,
      })
      .from(campaigns)
      .innerJoin(amazonAdsAccounts, eq(amazonAdsAccounts.id, campaigns.amazonAdsAccountId))
      .innerJoin(
        syncLogs,
        and(
          eq(syncLogs.amazonAdsAccountId, amazonAdsAccounts.id),
          eq(syncLogs.syncType, syncType),
          eq(syncLogs.status, 'success'),
        ),
      )
      .where(and(eq(amazonAdsAccounts.clientId, clientId), eq(campaigns.campaignId, campaignId)))
      .orderBy(desc(syncLogs.completedAt))
      .limit(1);

    if (!row) {
      // No sync of that type has succeeded for this account. Still resolve
      // the profile from the campaign itself rather than losing it too —
      // profile is a property of the account, not of any particular sync.
      const profile = await this.resolveProfile(clientId, campaignId);
      return { provenance: { reportJobId: null, syncedAt: null, syncType }, profile };
    }

    return {
      provenance: {
        reportJobId: row.syncLogId,
        syncedAt: row.completedAt ? row.completedAt.toISOString() : null,
        syncType,
      },
      profile: row.countryCode,
    };
  }

  private async resolveProfile(clientId: string, campaignId: string): Promise<string | null> {
    const [row] = await this.drizzle.db
      .select({ countryCode: amazonAdsAccounts.countryCode })
      .from(campaigns)
      .innerJoin(amazonAdsAccounts, eq(amazonAdsAccounts.id, campaigns.amazonAdsAccountId))
      .where(and(eq(amazonAdsAccounts.clientId, clientId), eq(campaigns.campaignId, campaignId)))
      .limit(1);
    return row?.countryCode ?? null;
  }
}

/**
 * The campaign an entity belongs to, from its entity id.
 *
 * Campaign-level entities ARE their campaign id. W1's search_term entities
 * carry a composite "<campaignId>::<term>" id (see term-normalization.ts) —
 * passing that straight into a campaigns.campaign_id lookup matches nothing,
 * which is exactly the bug this handles: every W1 task previously resolved to
 * null provenance AND null profile.
 *
 * Returns null for grains whose entity id carries no campaign at all
 * (keyword/product_target ids are Amazon target ids); those get null
 * provenance honestly rather than a wrong lookup.
 */
function campaignIdFor(entityType: string, entityId: string): string | null {
  if (entityType === 'campaign') return entityId;
  if (entityType === 'search_term') return parseSearchTermEntityId(entityId)?.campaignId ?? null;
  return null;
}

// Wraps a rule's raw evidence into the full §8.6-provenance envelope. Pulls
// window bounds out of the raw evidence when present (every current rule's
// evidence carries windowStart/windowEnd or an equivalent pair) rather than
// requiring a second, parallel window argument that could drift from it.
export function buildEvidence(
  rawEvidence: Record<string, unknown>,
  provenance: TaskEvidenceProvenance,
): TaskEvidence {
  const window = extractWindow(rawEvidence);
  const fallbacks: Record<string, boolean> = {};
  if (rawEvidence.beIsFallback === true) fallbacks.be = true;

  return { metrics: rawEvidence, window, provenance, fallbacks };
}

function extractWindow(evidence: Record<string, unknown>): { start: string; end: string } | null {
  const start = evidence.windowStart;
  const end = evidence.windowEnd;
  if (typeof start === 'string' && typeof end === 'string') return { start, end };

  // D5 doesn't carry windowStart/windowEnd (its "window" is really just
  // yesterday plus a baseline lookback) — trailingBaselineWindow.start
  // through yesterdayDate is the closest equivalent.
  const baseline = evidence.trailingBaselineWindow as { start?: string; end?: string } | undefined;
  const yesterday = evidence.yesterdayDate;
  if (baseline?.start && typeof yesterday === 'string') {
    return { start: baseline.start, end: yesterday };
  }

  return null;
}
