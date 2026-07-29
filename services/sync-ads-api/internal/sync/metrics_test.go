package sync

import "testing"

func TestNullIfOverflowsNumeric84(t *testing.T) {
	cases := []struct {
		name     string
		value    float64
		wantNull bool
	}{
		{"normal ACoS", 45.5, false},
		{"exactly at the boundary", 9999.9999, false},
		{"just over the boundary", 10000.0, true},
		{"extreme ratio from near-zero sales", 500000.0, true},
		{"negative extreme", -500000.0, true},
		{"zero", 0.0, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := nullIfOverflowsNumeric84(tc.value)
			if tc.wantNull {
				if got != nil {
					t.Fatalf("expected nil for %v, got %v", tc.value, *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("expected a value for %v, got nil", tc.value)
			}
			if *got != tc.value {
				t.Fatalf("expected %v, got %v", tc.value, *got)
			}
		})
	}
}
