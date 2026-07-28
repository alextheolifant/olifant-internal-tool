package sync

import (
	"testing"
	"time"

	"olifant/sync-ads-api/internal/amazon"
)

func TestDedupeByProfileID_NoCollision_PreservesAll(t *testing.T) {
	now := time.Now()
	tagged := []taggedProfile{
		{profile: amazon.Profile{ProfileID: 1}, region: "na", managerAccountID: "ma-1", managerConnectedAt: now},
		{profile: amazon.Profile{ProfileID: 2}, region: "eu", managerAccountID: "ma-1", managerConnectedAt: now},
	}

	got := dedupeByProfileID(tagged)

	if len(got) != 2 {
		t.Fatalf("expected 2 profiles, got %d", len(got))
	}
}

func TestDedupeByProfileID_Collision_MostRecentlyConnectedWins(t *testing.T) {
	older := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	newer := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	tagged := []taggedProfile{
		{profile: amazon.Profile{ProfileID: 42}, region: "na", managerAccountID: "ma-older", managerConnectedAt: older},
		{profile: amazon.Profile{ProfileID: 42}, region: "na", managerAccountID: "ma-newer", managerConnectedAt: newer},
	}

	got := dedupeByProfileID(tagged)

	if len(got) != 1 {
		t.Fatalf("expected 1 deduped profile, got %d", len(got))
	}
	if got[0].managerAccountID != "ma-newer" {
		t.Fatalf("expected the more-recently-connected manager account to win, got %q", got[0].managerAccountID)
	}
}

func TestDedupeByProfileID_CollisionRegardlessOfEncounterOrder(t *testing.T) {
	older := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	newer := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	// Newer one encountered FIRST this time — winner selection must not
	// depend on which one showed up first in the slice.
	tagged := []taggedProfile{
		{profile: amazon.Profile{ProfileID: 42}, region: "na", managerAccountID: "ma-newer", managerConnectedAt: newer},
		{profile: amazon.Profile{ProfileID: 42}, region: "na", managerAccountID: "ma-older", managerConnectedAt: older},
	}

	got := dedupeByProfileID(tagged)

	if len(got) != 1 || got[0].managerAccountID != "ma-newer" {
		t.Fatalf("expected ma-newer to win regardless of encounter order, got %+v", got)
	}
}

func TestDedupeByProfileID_PreservesOriginalEncounterOrder(t *testing.T) {
	now := time.Now()
	tagged := []taggedProfile{
		{profile: amazon.Profile{ProfileID: 3}, managerAccountID: "ma-1", managerConnectedAt: now},
		{profile: amazon.Profile{ProfileID: 1}, managerAccountID: "ma-1", managerConnectedAt: now},
		{profile: amazon.Profile{ProfileID: 2}, managerAccountID: "ma-1", managerConnectedAt: now},
	}

	got := dedupeByProfileID(tagged)

	wantOrder := []int64{3, 1, 2}
	for i, id := range wantOrder {
		if got[i].profile.ProfileID != id {
			t.Fatalf("position %d: expected profileID %d, got %d", i, id, got[i].profile.ProfileID)
		}
	}
}
