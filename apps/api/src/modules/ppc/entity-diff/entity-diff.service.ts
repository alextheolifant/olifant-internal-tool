import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { entitySnapshotsDaily, syncLogs } from '../../../db/schema';
import { STALE_HOURS } from '../ppc-freshness';
import type { ChangeType, EntityDiff, FieldChange } from './entity-diff.types';

// ─── Diff engine (TypeScript port) ──────────────────────────────────────────
// services/sync-ads-api/internal/sync/diff.go is the original — its own
// header comment says it exists specifically so "the execution/verification
// loop and D3" can consume it. But that engine is Go, and this consumer
// (Part 1/2/3 of this task) is explicitly scoped to apps/api (NestJS/TS).
// Go and TypeScript can't share code directly, and there's no cross-runtime
// call path in this repo (the Go services are one-off batch binaries, not a
// long-running RPC server) — so this is a straight port, not a wrapper.
// Kept field-for-field identical to diff.go: same flatten convention (dotted
// paths, arrays as single leaf values), same three-way created/deleted/
// modified classification, same "unchanged fields omitted" behavior. Changes
// to diff.go's semantics should be mirrored here by hand; there's no
// automated way to keep them in sync short of introducing a shared IDL,
// which is out of scope for this task.
@Injectable()
export class EntityDiffService {
  constructor(private readonly drizzle: DrizzleService) {}

  // One entity's snapshot row at an exact date, or null if it wasn't
  // captured that day (never existed yet, deleted, or account not synced).
  async getSnapshot(
    accountId: string,
    entityType: string,
    entityId: string,
    date: string,
  ): Promise<{ parentId: string | null; state: unknown } | null> {
    const [row] = await this.drizzle.db
      .select({ parentId: entitySnapshotsDaily.parentId, state: entitySnapshotsDaily.state })
      .from(entitySnapshotsDaily)
      .where(
        and(
          eq(entitySnapshotsDaily.amazonAdsAccountId, accountId),
          eq(entitySnapshotsDaily.entityType, entityType as any),
          eq(entitySnapshotsDaily.entityId, entityId),
          eq(entitySnapshotsDaily.snapshotDate, date),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // Every snapshot row of one entityType for one account on one date —
  // DiffAccountState's per-side input.
  async listSnapshotsForDate(
    accountId: string,
    entityType: string,
    date: string,
  ): Promise<Array<{ entityId: string; parentId: string | null; state: unknown }>> {
    return this.drizzle.db
      .select({
        entityId: entitySnapshotsDaily.entityId,
        parentId: entitySnapshotsDaily.parentId,
        state: entitySnapshotsDaily.state,
      })
      .from(entitySnapshotsDaily)
      .where(
        and(
          eq(entitySnapshotsDaily.amazonAdsAccountId, accountId),
          eq(entitySnapshotsDaily.entityType, entityType as any),
          eq(entitySnapshotsDaily.snapshotDate, date),
        ),
      );
  }

  // The most recent snapshot row for one entity, regardless of account or
  // date — used by verification, which knows only (entityType, entityId)
  // from the task and needs to discover which account owns it plus what its
  // latest known state is, in one query. Amazon's own entity ids are
  // platform-global (confirmed empirically: zero entity_id collisions across
  // different amazon_ads_account_id values in this table), so this is safe
  // without also filtering by account.
  async getLatestSnapshot(
    entityType: string,
    entityId: string,
  ): Promise<{ accountId: string; snapshotDate: string; parentId: string | null; state: unknown } | null> {
    const [row] = await this.drizzle.db
      .select({
        accountId: entitySnapshotsDaily.amazonAdsAccountId,
        snapshotDate: entitySnapshotsDaily.snapshotDate,
        parentId: entitySnapshotsDaily.parentId,
        state: entitySnapshotsDaily.state,
      })
      .from(entitySnapshotsDaily)
      .where(and(eq(entitySnapshotsDaily.entityType, entityType as any), eq(entitySnapshotsDaily.entityId, entityId)))
      .orderBy(desc(entitySnapshotsDaily.snapshotDate))
      .limit(1);
    return row ?? null;
  }

  // Compares one entity's captured state between two exact snapshot dates.
  // Returns changeType 'unchanged' (empty changes) if the entity existed on
  // both dates with identical state — not an error, a common valid result.
  async diffEntityState(
    accountId: string,
    entityType: string,
    entityId: string,
    fromDate: string,
    toDate: string,
  ): Promise<EntityDiff> {
    const fromRow = await this.getSnapshot(accountId, entityType, entityId, fromDate);
    const toRow = await this.getSnapshot(accountId, entityType, entityId, toDate);
    const parentId = toRow?.parentId ?? fromRow?.parentId ?? null;
    return diffStates(entityType, entityId, parentId, fromRow?.state, toRow?.state);
  }

  // Bulk variant: every entity of one entityType that changed (created,
  // deleted, or modified — unchanged entities are omitted) between two dates
  // for one account. This is what the ledger's external-change detection and
  // D3 call — they scan broadly rather than checking one entity at a time.
  async diffAccountState(accountId: string, entityType: string, fromDate: string, toDate: string): Promise<EntityDiff[]> {
    const [fromRows, toRows] = await Promise.all([
      this.listSnapshotsForDate(accountId, entityType, fromDate),
      this.listSnapshotsForDate(accountId, entityType, toDate),
    ]);

    const fromById = new Map(fromRows.map((r) => [r.entityId, r]));
    const toById = new Map(toRows.map((r) => [r.entityId, r]));
    const allIds = new Set([...fromById.keys(), ...toById.keys()]);

    const diffs: EntityDiff[] = [];
    for (const id of allIds) {
      const fromRow = fromById.get(id);
      const toRow = toById.get(id);
      const parentId = toRow?.parentId ?? fromRow?.parentId ?? null;
      const diff = diffStates(entityType, id, parentId, fromRow?.state, toRow?.state);
      if (diff.changeType !== 'unchanged') diffs.push(diff);
    }
    return diffs;
  }

  // The most recent date this account has ANY snapshot row for this
  // entityType — used by verification to tell "this entity is missing from
  // today's batch because it was deleted/archived" apart from "today's batch
  // for this account hasn't run yet / this entity was never captured." Null
  // if the account has never had a single snapshot of this entityType.
  async getLatestSnapshotDate(accountId: string, entityType: string): Promise<string | null> {
    const [row] = await this.drizzle.db
      .select({ snapshotDate: entitySnapshotsDaily.snapshotDate })
      .from(entitySnapshotsDaily)
      .where(and(eq(entitySnapshotsDaily.amazonAdsAccountId, accountId), eq(entitySnapshotsDaily.entityType, entityType as any)))
      .orderBy(desc(entitySnapshotsDaily.snapshotDate))
      .limit(1);
    return row?.snapshotDate ?? null;
  }

  // Snapshot freshness, same STALE_HOURS(48) convention as
  // ppc-freshness.ts's classifyFreshness — but scoped specifically to
  // sync_type='entity_snapshots' (not "any sync"), since that's the one
  // verification and the ledger actually depend on being fresh. A campaign
  // sync completing recently says nothing about whether today's entity
  // snapshot batch ran.
  //
  // Deliberately NOT filtered by accountId: confirmed against real sync_logs
  // rows (services/sync-ads-api/internal/sync/snapshot.go calls
  // writer.CreateSyncLog, the same unscoped helper retry-reports uses, not
  // the per-account CreateAccountSyncLog) — entity_snapshots syncs write ONE
  // sync_logs row per run, covering every account, with
  // amazon_ads_account_id left null. Filtering by accountId here would never
  // match anything and every account would read as permanently stale. The
  // accountId parameter is kept (rather than dropped) so this method's
  // signature still documents what freshness is conceptually being asked
  // about, and so it doesn't silently keep working if a future version of
  // the Go job switches to per-account logging.
  async isSnapshotStale(_accountId: string): Promise<boolean> {
    const [row] = await this.drizzle.db
      .select({ completedAt: syncLogs.completedAt })
      .from(syncLogs)
      .where(and(eq(syncLogs.syncType, 'entity_snapshots'), eq(syncLogs.status, 'success')))
      .orderBy(desc(syncLogs.completedAt))
      .limit(1);

    if (!row?.completedAt) return true; // never synced — treat as stale, not "somehow fresh"
    const hoursSince = (Date.now() - row.completedAt.getTime()) / (60 * 60 * 1000);
    return hoursSince > STALE_HOURS;
  }
}

function diffStates(
  entityType: string,
  entityId: string,
  parentId: string | null,
  fromState: unknown | undefined,
  toState: unknown | undefined,
): EntityDiff {
  const fromExists = fromState !== undefined && fromState !== null;
  const toExists = toState !== undefined && toState !== null;

  if (!fromExists && !toExists) {
    return { entityType, entityId, parentId, changeType: 'unchanged', changes: [] };
  }

  if (!fromExists && toExists) {
    const fields = flattenJSON(toState);
    const changes: FieldChange[] = Object.entries(fields).map(([field, v]) => ({
      field,
      oldValue: undefined,
      newValue: v,
    }));
    return { entityType, entityId, parentId, changeType: 'created', changes };
  }

  if (fromExists && !toExists) {
    const fields = flattenJSON(fromState);
    const changes: FieldChange[] = Object.entries(fields).map(([field, v]) => ({
      field,
      oldValue: v,
      newValue: undefined,
    }));
    return { entityType, entityId, parentId, changeType: 'deleted', changes };
  }

  // Both exist — field-level comparison.
  const fromFields = flattenJSON(fromState);
  const toFields = flattenJSON(toState);
  const allFields = new Set([...Object.keys(fromFields), ...Object.keys(toFields)]);

  const changes: FieldChange[] = [];
  for (const field of allFields) {
    const hadOld = Object.prototype.hasOwnProperty.call(fromFields, field);
    const hasNew = Object.prototype.hasOwnProperty.call(toFields, field);
    const oldV = fromFields[field];
    const newV = toFields[field];
    if (hadOld && hasNew && deepEqual(oldV, newV)) continue; // truly unchanged — not included
    changes.push({
      field,
      oldValue: hadOld ? oldV : undefined,
      newValue: hasNew ? newV : undefined,
    });
  }

  const changeType: ChangeType = changes.length === 0 ? 'unchanged' : 'modified';
  return { entityType, entityId, parentId, changeType, changes };
}

// Turns a JSON object into a flat map of dotted field paths to scalar/array
// leaf values — {"budget":{"budget":50,"budgetType":"DAILY"}} becomes
// {"budget.budget": 50, "budget.budgetType": "DAILY"}. Arrays are kept as
// single leaf values (not exploded per-index) — same rationale as diff.go's
// flattenJSON: index-based paths become meaningless once an array's order
// isn't stable.
export function flattenJSON(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  flattenValue('', raw, out);
  return out;
}

function flattenValue(prefix: string, v: unknown, out: Record<string, unknown>): void {
  const isPlainObject = typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isPlainObject || Object.keys(v as object).length === 0) {
    if (prefix !== '') out[prefix] = v;
    return;
  }
  for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
    const key = prefix !== '' ? `${prefix}.${k}` : k;
    flattenValue(key, vv, out);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Type-tolerant equality shared by verification and the ledger's task
// matching: a bid confirmed as the number 1.01 must match a snapshot's JSON
// number 1.01 even though it's carried as text in a few places
// (tasks.confirmed_value); float noise (1.2000000001) shouldn't read as a
// mismatch. Non-numeric fields (state, matchType) compare as strings.
// undefined never matches anything — an absent value is never "the same as"
// a present one, even null.
export function valuesMatch(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === undefined) return false;
  const numA = typeof a === 'number' ? a : typeof a === 'string' && a.trim() !== '' ? Number(a) : NaN;
  const numB = typeof b === 'number' ? b : typeof b === 'string' && b.trim() !== '' ? Number(b) : NaN;
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return Math.abs(numA - numB) < 0.005;
  return String(a) === String(b);
}
