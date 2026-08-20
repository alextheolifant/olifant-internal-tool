import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { amazonAdsAccounts, ledgerEntries, tasks } from '../../../db/schema';
import type { NewLedgerEntry } from './ledger.types';

export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;

// Tasks a same-entity external diff could plausibly be "this, already
// recorded" for — anything that isn't inert (dismissed/expired) or already
// flagged as a confirmed mismatch (verify_failed, which means the console
// state is known NOT to match what was intended, so it can't be the
// explanation for whatever new value the diff just saw either).
const MATCHABLE_STATUSES: TaskRow['status'][] = [
  'pending',
  'approved',
  'blocked',
  'executed',
  'verified',
];

@Injectable()
export class LedgerRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(entry: NewLedgerEntry): Promise<LedgerEntryRow> {
    const [row] = await this.drizzle.db
      .insert(ledgerEntries)
      .values({
        clientId: entry.clientId,
        profile: entry.profile,
        timestampDetected: entry.timestampDetected,
        entityType: entry.entityType,
        entityId: entry.entityId,
        campaignName: entry.campaignName,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        source: entry.source,
        taskId: entry.taskId,
        actor: entry.actor,
        note: entry.note,
        category: entry.category,
      })
      .returning();
    return row;
  }

  // Idempotency check for recordEngineChange — append-only means "don't
  // insert a duplicate," never "update the existing one."
  async hasEngineEntryForTask(taskId: string): Promise<boolean> {
    const [row] = await this.drizzle.db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.taskId, taskId),
          eq(ledgerEntries.source, 'engine'),
        ),
      )
      .limit(1);
    return !!row;
  }

  // Candidate tasks for the ±3-day/expected-value matching in
  // ledger.service.ts — data access only, the actual matching logic (value
  // comparison, date window, field match) lives there so it stays unit
  // testable without a database.
  async findMatchCandidateTasks(
    clientId: string,
    entityType: string,
    entityId: string,
  ): Promise<TaskRow[]> {
    return this.drizzle.db.query.tasks.findMany({
      where: and(
        eq(tasks.clientId, clientId),
        eq(tasks.entityType, entityType),
        eq(tasks.entityId, entityId),
        inArray(tasks.status, MATCHABLE_STATUSES),
      ),
    });
  }

  // Resolves an account's clientId + display profile (country code, e.g.
  // "US") — so callers of detectExternalChanges only need to know which
  // account they're diffing, not also carry its client/profile around.
  async getAccountContext(
    accountId: string,
  ): Promise<{ clientId: string; profile: string | null } | null> {
    const [row] = await this.drizzle.db
      .select({
        clientId: amazonAdsAccounts.clientId,
        profile: amazonAdsAccounts.countryCode,
      })
      .from(amazonAdsAccounts)
      .where(eq(amazonAdsAccounts.id, accountId))
      .limit(1);
    return row ?? null;
  }

  async listByClient(clientId: string, limit = 200): Promise<LedgerEntryRow[]> {
    return this.drizzle.db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.clientId, clientId),
      orderBy: desc(ledgerEntries.timestampDetected),
      limit,
    });
  }

  // D3's own query — unmatched external pauses (source='external' already
  // means "no task claimed this," per ledger.service.ts's matching step),
  // scoped to a recent window rather than the entire ledger history. Without
  // a window, a ledger row whose task was later dismissed would re-propose
  // itself as a "new" D3 finding forever (dedup only checks OPEN tasks —
  // see action-fingerprint.ts) instead of respecting that dismissal. sinceDate
  // gives enough slack to survive one missed daily run without scanning
  // years of history on every evaluation.
  async findUnattributedPauses(
    clientId: string,
    sinceDate: Date,
  ): Promise<LedgerEntryRow[]> {
    return this.drizzle.db.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.clientId, clientId),
        eq(ledgerEntries.source, 'external'),
        eq(ledgerEntries.entityType, 'campaign'),
        eq(ledgerEntries.field, 'state'),
        eq(ledgerEntries.oldValue, 'ENABLED'),
        eq(ledgerEntries.newValue, 'PAUSED'),
        gte(ledgerEntries.timestampDetected, sinceDate),
      ),
    });
  }
}
