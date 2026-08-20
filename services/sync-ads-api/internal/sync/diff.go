package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"

	"olifant/sync-ads-api/internal/db"
)

// ─── Diff engine ─────────────────────────────────────────────────────────────
// Reusable comparison layer the execution/verification loop and D3 (external
// change detection) will both consume — building neither here, only the
// capability they'll call (per the brief). Field-level, not row-level: a bid
// moving 1.20 -> 1.85 is one FieldChange on "bid", not a wholesale replace.

type ChangeType string

const (
	ChangeCreated  ChangeType = "created"  // present at toDate, absent at fromDate
	ChangeDeleted  ChangeType = "deleted"  // present at fromDate, absent at toDate
	ChangeModified ChangeType = "modified" // present both dates, at least one field differs
	ChangeNone     ChangeType = "unchanged"
)

// FieldChange is one field's before/after. OldValue is nil for a field that
// didn't exist before (part of a creation or a newly-added field); NewValue
// is nil for a field that no longer exists (part of a deletion or a removed
// field).
type FieldChange struct {
	Field    string `json:"field"`
	OldValue any    `json:"oldValue"`
	NewValue any    `json:"newValue"`
}

// EntityDiff is the full comparison result for one entity between two dates.
type EntityDiff struct {
	EntityType string        `json:"entityType"`
	EntityID   string        `json:"entityId"`
	ParentID   string        `json:"parentId,omitempty"`
	ChangeType ChangeType    `json:"changeType"`
	Changes    []FieldChange `json:"changes"`
}

// DiffEngine wraps the writer's snapshot-read methods so the comparison
// logic itself (diffStates, flattenJSON) stays pure and independently
// testable without a database.
type DiffEngine struct {
	writer *db.Writer
}

func NewDiffEngine(writer *db.Writer) *DiffEngine {
	return &DiffEngine{writer: writer}
}

// DiffEntityState compares one entity's captured state between two exact
// snapshot dates. Returns ChangeType "unchanged" (with an empty Changes
// slice) if the entity existed on both dates with identical state — not an
// error; "no diff" is a valid, common result.
func (d *DiffEngine) DiffEntityState(ctx context.Context, accountID, entityType, entityID, fromDate, toDate string) (EntityDiff, error) {
	fromRow, fromExists, err := d.writer.GetEntitySnapshot(ctx, accountID, entityType, entityID, fromDate)
	if err != nil {
		return EntityDiff{}, fmt.Errorf("get snapshot at %s: %w", fromDate, err)
	}
	toRow, toExists, err := d.writer.GetEntitySnapshot(ctx, accountID, entityType, entityID, toDate)
	if err != nil {
		return EntityDiff{}, fmt.Errorf("get snapshot at %s: %w", toDate, err)
	}

	parentID := toRow.ParentID
	if !toExists {
		parentID = fromRow.ParentID
	}

	var fromState, toState json.RawMessage
	if fromExists {
		fromState = fromRow.State
	}
	if toExists {
		toState = toRow.State
	}

	return diffStates(entityType, entityID, parentID, fromExists, fromState, toExists, toState)
}

// DiffAccountState is the bulk variant: every entity of one entityType that
// changed (created, deleted, or modified — unchanged entities are omitted,
// since a broad account scan cares about what's different) between two
// dates for one account. This is what D3 will call — it scans broadly
// rather than checking one entity at a time.
func (d *DiffEngine) DiffAccountState(ctx context.Context, accountID, entityType, fromDate, toDate string) ([]EntityDiff, error) {
	fromRows, err := d.writer.ListEntitySnapshotsForDate(ctx, accountID, entityType, fromDate)
	if err != nil {
		return nil, fmt.Errorf("list snapshots at %s: %w", fromDate, err)
	}
	toRows, err := d.writer.ListEntitySnapshotsForDate(ctx, accountID, entityType, toDate)
	if err != nil {
		return nil, fmt.Errorf("list snapshots at %s: %w", toDate, err)
	}

	fromByID := make(map[string]db.EntitySnapshotRow, len(fromRows))
	for _, r := range fromRows {
		fromByID[r.EntityID] = r
	}
	toByID := make(map[string]db.EntitySnapshotRow, len(toRows))
	for _, r := range toRows {
		toByID[r.EntityID] = r
	}

	// Union of every entity id seen on either date.
	seen := make(map[string]struct{}, len(fromByID)+len(toByID))
	for id := range fromByID {
		seen[id] = struct{}{}
	}
	for id := range toByID {
		seen[id] = struct{}{}
	}

	var diffs []EntityDiff
	for id := range seen {
		fromRow, fromExists := fromByID[id]
		toRow, toExists := toByID[id]

		parentID := toRow.ParentID
		if !toExists {
			parentID = fromRow.ParentID
		}
		var fromState, toState json.RawMessage
		if fromExists {
			fromState = fromRow.State
		}
		if toExists {
			toState = toRow.State
		}

		diff, err := diffStates(entityType, id, parentID, fromExists, fromState, toExists, toState)
		if err != nil {
			return nil, fmt.Errorf("diff entity %s: %w", id, err)
		}
		if diff.ChangeType != ChangeNone {
			diffs = append(diffs, diff)
		}
	}
	return diffs, nil
}

func diffStates(
	entityType, entityID, parentID string,
	fromExists bool, fromState json.RawMessage,
	toExists bool, toState json.RawMessage,
) (EntityDiff, error) {
	diff := EntityDiff{EntityType: entityType, EntityID: entityID, ParentID: parentID}

	switch {
	case !fromExists && !toExists:
		// Shouldn't happen (the caller only reaches here for ids seen on at
		// least one side) but handle it as a no-op rather than panicking.
		diff.ChangeType = ChangeNone
		return diff, nil

	case !fromExists && toExists:
		diff.ChangeType = ChangeCreated
		fields, err := flattenJSON(toState)
		if err != nil {
			return diff, fmt.Errorf("flatten new state: %w", err)
		}
		for field, v := range fields {
			diff.Changes = append(diff.Changes, FieldChange{Field: field, OldValue: nil, NewValue: v})
		}
		return diff, nil

	case fromExists && !toExists:
		diff.ChangeType = ChangeDeleted
		fields, err := flattenJSON(fromState)
		if err != nil {
			return diff, fmt.Errorf("flatten old state: %w", err)
		}
		for field, v := range fields {
			diff.Changes = append(diff.Changes, FieldChange{Field: field, OldValue: v, NewValue: nil})
		}
		return diff, nil

	default: // both exist — field-level comparison
		fromFields, err := flattenJSON(fromState)
		if err != nil {
			return diff, fmt.Errorf("flatten old state: %w", err)
		}
		toFields, err := flattenJSON(toState)
		if err != nil {
			return diff, fmt.Errorf("flatten new state: %w", err)
		}

		allFields := make(map[string]struct{}, len(fromFields)+len(toFields))
		for f := range fromFields {
			allFields[f] = struct{}{}
		}
		for f := range toFields {
			allFields[f] = struct{}{}
		}

		for field := range allFields {
			oldV, hadOld := fromFields[field]
			newV, hasNew := toFields[field]
			if hadOld && hasNew && reflect.DeepEqual(oldV, newV) {
				continue // truly unchanged field — not included
			}
			var oldOut, newOut any
			if hadOld {
				oldOut = oldV
			}
			if hasNew {
				newOut = newV
			}
			diff.Changes = append(diff.Changes, FieldChange{Field: field, OldValue: oldOut, NewValue: newOut})
		}

		if len(diff.Changes) == 0 {
			diff.ChangeType = ChangeNone
		} else {
			diff.ChangeType = ChangeModified
		}
		return diff, nil
	}
}

// flattenJSON turns a JSON object into a flat map of dotted field paths to
// scalar/array leaf values — {"budget":{"budget":50,"budgetType":"DAILY"}}
// becomes {"budget.budget": 50, "budget.budgetType": "DAILY"}. Arrays are
// kept as single leaf values (not exploded per-index): reordering or
// changing an array (e.g. a target's "expression") is one field change on
// that array's path, not N changes on its elements — simpler and avoids
// index-based paths becoming meaningless when an array's order isn't stable.
func flattenJSON(raw json.RawMessage) (map[string]any, error) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	out := make(map[string]any)
	flattenValue("", v, out)
	return out, nil
}

func flattenValue(prefix string, v any, out map[string]any) {
	obj, isObject := v.(map[string]any)
	if !isObject || len(obj) == 0 {
		if prefix != "" {
			out[prefix] = v
		}
		return
	}
	for k, vv := range obj {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		flattenValue(key, vv, out)
	}
}
