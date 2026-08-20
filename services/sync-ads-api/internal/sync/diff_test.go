package sync

import (
	"encoding/json"
	"sort"
	"testing"
)

func changeMap(diff EntityDiff) map[string]FieldChange {
	m := make(map[string]FieldChange, len(diff.Changes))
	for _, c := range diff.Changes {
		m[c.Field] = c
	}
	return m
}

func TestDiffStates_Modified_FieldLevel(t *testing.T) {
	from := json.RawMessage(`{"bid": 1.20, "state": "ENABLED"}`)
	to := json.RawMessage(`{"bid": 1.85, "state": "ENABLED"}`)

	diff, err := diffStates("keyword", "kw1", "ag1", true, from, true, to)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if diff.ChangeType != ChangeModified {
		t.Fatalf("expected modified, got %s", diff.ChangeType)
	}
	// Only the bid field changed — a bid moving 1.20 -> 1.85 is ONE change,
	// not a wholesale entity replacement.
	if len(diff.Changes) != 1 {
		t.Fatalf("expected exactly 1 field change, got %d: %+v", len(diff.Changes), diff.Changes)
	}
	c := diff.Changes[0]
	if c.Field != "bid" {
		t.Fatalf("expected the changed field to be 'bid', got %q", c.Field)
	}
	if c.OldValue != 1.20 || c.NewValue != 1.85 {
		t.Fatalf("expected 1.20 -> 1.85, got %v -> %v", c.OldValue, c.NewValue)
	}
}

func TestDiffStates_NestedField(t *testing.T) {
	from := json.RawMessage(`{"budget": {"budget": 50, "budgetType": "DAILY"}}`)
	to := json.RawMessage(`{"budget": {"budget": 75, "budgetType": "DAILY"}}`)

	diff, err := diffStates("campaign", "c1", "", true, from, true, to)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	changes := changeMap(diff)
	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d: %+v", len(changes), diff.Changes)
	}
	c, ok := changes["budget.budget"]
	if !ok {
		t.Fatalf("expected a change on 'budget.budget', got fields: %v", keysOf(changes))
	}
	if c.OldValue != float64(50) || c.NewValue != float64(75) {
		t.Fatalf("expected 50 -> 75, got %v -> %v", c.OldValue, c.NewValue)
	}
}

func TestDiffStates_IdenticalState_Unchanged(t *testing.T) {
	state := json.RawMessage(`{"bid": 1.20, "state": "ENABLED"}`)
	diff, err := diffStates("keyword", "kw1", "ag1", true, state, true, state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if diff.ChangeType != ChangeNone {
		t.Fatalf("expected unchanged, got %s with changes %+v", diff.ChangeType, diff.Changes)
	}
	if len(diff.Changes) != 0 {
		t.Fatalf("expected no field changes, got %d", len(diff.Changes))
	}
}

func TestDiffStates_Creation(t *testing.T) {
	to := json.RawMessage(`{"bid": 1.20, "state": "ENABLED"}`)
	diff, err := diffStates("keyword", "kw1", "ag1", false, nil, true, to)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if diff.ChangeType != ChangeCreated {
		t.Fatalf("expected created, got %s", diff.ChangeType)
	}
	changes := changeMap(diff)
	if len(changes) != 2 {
		t.Fatalf("expected 2 fields (bid, state), got %d: %+v", len(changes), diff.Changes)
	}
	for _, c := range changes {
		if c.OldValue != nil {
			t.Fatalf("expected nil OldValue for a created entity's fields, got %v", c.OldValue)
		}
	}
}

func TestDiffStates_Deletion(t *testing.T) {
	from := json.RawMessage(`{"bid": 1.20, "state": "ENABLED"}`)
	diff, err := diffStates("keyword", "kw1", "ag1", true, from, false, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if diff.ChangeType != ChangeDeleted {
		t.Fatalf("expected deleted, got %s", diff.ChangeType)
	}
	changes := changeMap(diff)
	if len(changes) != 2 {
		t.Fatalf("expected 2 fields (bid, state), got %d: %+v", len(changes), diff.Changes)
	}
	for _, c := range changes {
		if c.NewValue != nil {
			t.Fatalf("expected nil NewValue for a deleted entity's fields, got %v", c.NewValue)
		}
	}
}

func TestDiffStates_FieldAddedOrRemoved(t *testing.T) {
	from := json.RawMessage(`{"bid": 1.20}`)
	to := json.RawMessage(`{"bid": 1.20, "placement": "TOP"}`)

	diff, err := diffStates("keyword", "kw1", "ag1", true, from, true, to)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	changes := changeMap(diff)
	if len(changes) != 1 {
		t.Fatalf("expected 1 change (the added field), got %d: %+v", len(changes), diff.Changes)
	}
	c, ok := changes["placement"]
	if !ok {
		t.Fatalf("expected a change on 'placement'")
	}
	if c.OldValue != nil || c.NewValue != "TOP" {
		t.Fatalf("expected nil -> TOP, got %v -> %v", c.OldValue, c.NewValue)
	}
}

func TestDiffStates_ArrayTreatedAsOneField(t *testing.T) {
	from := json.RawMessage(`{"expression": [{"type": "ASIN_SAME_AS", "value": "B001"}]}`)
	to := json.RawMessage(`{"expression": [{"type": "ASIN_SAME_AS", "value": "B002"}]}`)

	diff, err := diffStates("product_target", "t1", "ag1", true, from, true, to)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// The whole array is one field's value — not exploded into per-index changes.
	if len(diff.Changes) != 1 {
		t.Fatalf("expected 1 change (whole array), got %d: %+v", len(diff.Changes), diff.Changes)
	}
	if diff.Changes[0].Field != "expression" {
		t.Fatalf("expected the change to be on 'expression', got %q", diff.Changes[0].Field)
	}
}

func keysOf(m map[string]FieldChange) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
