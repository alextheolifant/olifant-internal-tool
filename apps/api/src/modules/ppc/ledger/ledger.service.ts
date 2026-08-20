import { Injectable, Logger } from '@nestjs/common';
import {
  EntityDiffService,
  valuesMatch,
} from '../entity-diff/entity-diff.service';
import type { TaskAction } from '../tasks/task.types';
import {
  LedgerRepository,
  type LedgerEntryRow,
  type TaskRow,
} from './ledger.repository';
import type { LedgerCategory } from './ledger.types';

// Must match schema.ts's entitySnapshotTypeEnum exactly — there's no way to
// derive a plain string[] from a Drizzle pgEnum at the value level without
// pulling in the enum's runtime object, so this is kept in sync by hand
// (same tradeoff task-lifecycle.ts's TaskStatus union already accepts
// against schema.ts's task_status enum).
const ENTITY_TYPES = [
  'campaign',
  'ad_group',
  'keyword',
  'product_target',
  'negative',
  'product_ad',
  'portfolio',
] as const;

// A same (field, newValue) change landing on this many-or-more distinct
// entities in the same account on the same day reads as a bulk edit rather
// than a coincidence of separate manual changes — conservative on purpose
// (see schema.ts's ledgerCategoryEnum comment for why 'amazon_recommendation'
// is never assigned at all: no signal for it exists in the captured data).
const BULK_OPERATION_THRESHOLD = 3;

// ±3 days, per the brief's own matching rule.
const MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

interface PendingExternalEntry {
  entityType: string;
  entityId: string;
  parentId: string | null;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface DetectExternalChangesResult {
  written: number;
  matched: number;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly repo: LedgerRepository,
    private readonly diff: EntityDiffService,
  ) {}

  // ─── Source 1: engine changes ─────────────────────────────────────────────
  // Called from both the execution-confirmation endpoint (task reaches
  // 'executed') and the verification job (task reaches 'verified') — the
  // brief says "every task reaching executed or verified writes an entry,"
  // and this is idempotent (hasEngineEntryForTask) so calling it from both
  // places writes exactly one row, whichever transition reaches it first,
  // rather than risking two rows for the same change.
  async recordEngineChange(task: TaskRow): Promise<void> {
    const action = task.action as TaskAction;
    if (!action.field) return; // diagnostic task — no field-level change to record
    if (await this.repo.hasEngineEntryForTask(task.id)) return; // already recorded

    await this.repo.insert({
      clientId: task.clientId,
      profile: task.profile,
      timestampDetected: task.executedAt ?? task.updatedAt,
      entityType: task.entityType,
      entityId: task.entityId,
      campaignName: action.campaignName,
      field: action.field,
      oldValue: action.oldValue !== null ? String(action.oldValue) : null,
      // What was actually confirmed, if it differs from what was proposed —
      // falls back to the proposed value only if somehow nothing was
      // confirmed (shouldn't happen once the execute endpoint enforces it).
      newValue:
        task.confirmedValue ??
        (action.newValue !== null ? String(action.newValue) : null),
      source: 'engine',
      taskId: task.id,
      actor: task.assignee,
      note: null,
      // The source itself already says "this went through the task queue" —
      // no separate category inference needed for engine-sourced rows.
      category: null,
    });
  }

  // ─── Source 2: detected external changes ──────────────────────────────────
  // One account, one day's diff (fromDate -> toDate) across every tracked
  // entity type. Unmatched field changes get written as source='external';
  // changes attributable to an existing task are skipped (already recorded
  // via source 1, don't duplicate).
  async detectExternalChanges(
    accountId: string,
    fromDate: string,
    toDate: string,
  ): Promise<DetectExternalChangesResult> {
    const context = await this.repo.getAccountContext(accountId);
    if (!context) {
      throw new Error(
        `detectExternalChanges: no amazon_ads_account found for id ${accountId}`,
      );
    }
    const { clientId, profile } = context;

    const pending: PendingExternalEntry[] = [];
    let matched = 0;

    for (const entityType of ENTITY_TYPES) {
      const diffs = await this.diff.diffAccountState(
        accountId,
        entityType,
        fromDate,
        toDate,
      );
      for (const d of diffs) {
        for (const change of d.changes) {
          const matchedTask = await this.findMatchingTask(
            clientId,
            d.entityType,
            d.entityId,
            change.field,
            change.newValue,
            toDate,
          );
          if (matchedTask) {
            matched++;
            continue;
          }
          pending.push({
            entityType: d.entityType,
            entityId: d.entityId,
            parentId: d.parentId,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
          });
        }
      }
    }

    const categories = inferBulkCategories(pending);
    // toDate at local midnight — daily-granularity detection, not a fake
    // precise timestamp (see schema.ts's timestampDetected comment).
    const timestampDetected = new Date(`${toDate}T00:00:00.000Z`);

    let written = 0;
    for (const entry of pending) {
      const campaignName = await this.resolveCampaignName(
        accountId,
        entry.entityType,
        entry.entityId,
        entry.parentId,
        toDate,
      );
      await this.repo.insert({
        clientId,
        profile,
        timestampDetected,
        entityType: entry.entityType,
        entityId: entry.entityId,
        campaignName,
        field: entry.field,
        oldValue: entry.oldValue !== undefined ? String(entry.oldValue) : null,
        newValue: entry.newValue !== undefined ? String(entry.newValue) : null,
        source: 'external',
        taskId: null,
        actor: null,
        note: null,
        category: categories.get(bulkKey(entry)) ?? null,
      });
      written++;
    }

    this.logger.log(
      `detectExternalChanges(account=${accountId}, ${fromDate}→${toDate}): ${written} written, ${matched} matched to existing tasks`,
    );
    return { written, matched };
  }

  async listForClient(
    clientId: string,
    limit?: number,
  ): Promise<LedgerEntryRow[]> {
    return this.repo.listByClient(clientId, limit);
  }

  // Matches one detected (entity, field, newValue) change against open or
  // executed tasks for that same entity — same field, same expected value
  // (confirmedValue if the task is past execution, else the proposed
  // action.newValue), detected within ±3 days of when the task itself
  // intended the change (executedAt if executed, else createdAt).
  private async findMatchingTask(
    clientId: string,
    entityType: string,
    entityId: string,
    field: string,
    newValue: unknown,
    toDate: string,
  ): Promise<TaskRow | null> {
    const candidates = await this.repo.findMatchCandidateTasks(
      clientId,
      entityType,
      entityId,
    );
    const detectedAt = new Date(`${toDate}T00:00:00.000Z`).getTime();

    for (const task of candidates) {
      const action = task.action as TaskAction;
      if (action.field !== field) continue;

      const expected =
        task.confirmedValue ??
        (action.newValue !== null ? String(action.newValue) : null);
      if (!valuesMatch(expected, newValue)) continue;

      const basis = task.executedAt ?? task.createdAt;
      if (Math.abs(detectedAt - basis.getTime()) > MATCH_WINDOW_MS) continue;

      return task;
    }
    return null;
  }

  // entityType==='campaign': the entity's own name. Everything else: walk
  // up parentId — ad_group's parent IS the campaign; keyword/product_target/
  // negative/product_ad's parent is an ad_group, one more hop needed to
  // reach the campaign. portfolio has no campaign context at all. Reads the
  // toDate snapshot specifically (the date the change was detected as of) —
  // falls back to null (never fabricated) if any hop can't be resolved,
  // same convention as TaskAction.campaignName elsewhere in this codebase.
  private async resolveCampaignName(
    accountId: string,
    entityType: string,
    entityId: string,
    parentId: string | null,
    toDate: string,
  ): Promise<string | null> {
    if (entityType === 'portfolio') return null;

    if (entityType === 'campaign') {
      const row = await this.diff.getSnapshot(
        accountId,
        'campaign',
        entityId,
        toDate,
      );
      return nameFromState(row?.state);
    }

    if (entityType === 'ad_group') {
      if (!parentId) return null;
      const row = await this.diff.getSnapshot(
        accountId,
        'campaign',
        parentId,
        toDate,
      );
      return nameFromState(row?.state);
    }

    // keyword / product_target / negative / product_ad
    if (!parentId) return null;
    const adGroupRow = await this.diff.getSnapshot(
      accountId,
      'ad_group',
      parentId,
      toDate,
    );
    const campaignId = (
      adGroupRow?.state as { campaignId?: string } | undefined
    )?.campaignId;
    if (!campaignId) return null;
    const campaignRow = await this.diff.getSnapshot(
      accountId,
      'campaign',
      campaignId,
      toDate,
    );
    return nameFromState(campaignRow?.state);
  }
}

function nameFromState(state: unknown): string | null {
  const name = (state as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

function bulkKey(entry: PendingExternalEntry): string {
  return `${entry.field}::${String(entry.newValue)}`;
}

// Groups the day's unmatched external changes by (field, newValue); any
// group with BULK_OPERATION_THRESHOLD+ distinct entities gets tagged
// 'bulk_operation'. Pure function — no DB access — so it's directly
// unit-testable, same convention as persistence-hysteresis-guard.ts.
export function inferBulkCategories(
  entries: PendingExternalEntry[],
): Map<string, LedgerCategory> {
  const counts = new Map<string, Set<string>>();
  for (const e of entries) {
    const key = bulkKey(e);
    if (!counts.has(key)) counts.set(key, new Set());
    counts.get(key)!.add(e.entityId);
  }
  const result = new Map<string, LedgerCategory>();
  for (const [key, entityIds] of counts) {
    if (entityIds.size >= BULK_OPERATION_THRESHOLD)
      result.set(key, 'bulk_operation');
  }
  return result;
}
