// ─── Diff engine types ───────────────────────────────────────────────────────
// TypeScript port of services/sync-ads-api/internal/sync/diff.go's types.
// Kept field-for-field identical to that file (same semantics, same JSON
// shape) — see entity-diff.service.ts's header comment for why this exists
// as a port rather than a shared library.

export type ChangeType = 'created' | 'deleted' | 'modified' | 'unchanged';

// FieldChange is one field's before/after. oldValue is undefined for a field
// that didn't exist before (part of a creation or a newly-added field);
// newValue is undefined for a field that no longer exists (part of a
// deletion or a removed field). Mirrors Go's nil convention — undefined
// rather than null, so "the field is genuinely absent" stays distinguishable
// from "the field's real value is JSON null" if that ever comes up.
export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface EntityDiff {
  entityType: string;
  entityId: string;
  parentId: string | null;
  changeType: ChangeType;
  changes: FieldChange[];
}
