import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { amazonAdsAccounts, campaigns, syncLogs } from '../../../db/schema';
import type { TaskEvidence, TaskEvidenceProvenance } from './task.types';

@Injectable()
export class EvidenceProvenanceResolver {
  constructor(private readonly drizzle: DrizzleService) {}

  // "Report job id" = the id of the most recent successful ads_metrics
  // sync_logs row for the campaign's account.
  //
  // campaign_metrics_daily rows carry no per-row sync lineage — they're
  // upserted in place keyed on (campaign_id, date), not append-only with a
  // sync_log_id column — so exact row-level provenance for a given number
  // isn't tracked anywhere in this codebase today. The closest real,
  // traceable answer to "where did these numbers come from" is: the last
  // sync that successfully wrote this account's metrics. That's what this
  // resolves to. Documented here rather than fabricating row-level lineage
  // that doesn't exist.
  //
  // Also resolves the task's "profile" field (e.g. "US") from the same join
  // — a client can own accounts across multiple marketplaces, so this comes
  // from the specific account that owns the campaign, not the client row.
  async resolveForCampaign(
    clientId: string,
    campaignEntityId: string,
  ): Promise<{ provenance: TaskEvidenceProvenance; profile: string | null }> {
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
          eq(syncLogs.syncType, 'ads_metrics'),
          eq(syncLogs.status, 'success'),
        ),
      )
      .where(and(eq(amazonAdsAccounts.clientId, clientId), eq(campaigns.campaignId, campaignEntityId)))
      .orderBy(desc(syncLogs.completedAt))
      .limit(1);

    if (!row) return { provenance: { reportJobId: null, syncedAt: null }, profile: null };
    return {
      provenance: {
        reportJobId: row.syncLogId,
        syncedAt: row.completedAt ? row.completedAt.toISOString() : null,
      },
      profile: row.countryCode,
    };
  }
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
