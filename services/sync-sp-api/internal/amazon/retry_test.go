package amazon

import (
	"net/http"
	"testing"
	"time"
)

func respWith(headers map[string]string) *http.Response {
	h := http.Header{}
	for k, v := range headers {
		h.Set(k, v)
	}
	return &http.Response{Header: h}
}

func TestRetryAfterFrom(t *testing.T) {
	// Assigned via a variable so the division is runtime, not an untyped
	// constant expression Go refuses to truncate into a Duration.
	createReportRate := 0.0167
	createReportSpacing := time.Duration(float64(time.Second) / createReportRate)

	cases := []struct {
		name    string
		headers map[string]string
		want    time.Duration
	}{
		{
			// The header that actually resolves the "exceeded 3 retries"
			// failure: Amazon states the wait outright.
			name:    "Retry-After in seconds is honoured verbatim",
			headers: map[string]string{"Retry-After": "60"},
			want:    60 * time.Second,
		},
		{
			// createReport's documented rate. Its reciprocal (~59.9s) is the
			// minimum spacing between calls — which is why a 2s ceiling
			// could never have worked.
			name:    "rate limit header converts to a per-call spacing",
			headers: map[string]string{"x-amzn-RateLimit-Limit": "0.0167"},
			want:    createReportSpacing,
		},
		{
			name:    "Retry-After wins when both are present",
			headers: map[string]string{"Retry-After": "30", "x-amzn-RateLimit-Limit": "0.0167"},
			want:    30 * time.Second,
		},
		{
			name:    "surrounding whitespace is tolerated",
			headers: map[string]string{"x-amzn-RateLimit-Limit": "  2.0  "},
			want:    500 * time.Millisecond,
		},
		{
			// No hint means fall back to the exponential ladder, NOT wait 0.
			name:    "no headers yields no hint",
			headers: map[string]string{},
			want:    0,
		},
		{
			name:    "unparseable Retry-After is ignored rather than trusted",
			headers: map[string]string{"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"},
			want:    0,
		},
		{
			name:    "non-positive values are ignored",
			headers: map[string]string{"Retry-After": "0"},
			want:    0,
		},
		{
			name:    "a zero rate never divides by zero",
			headers: map[string]string{"x-amzn-RateLimit-Limit": "0"},
			want:    0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := retryAfterFrom(respWith(tc.headers))
			if got != tc.want {
				t.Fatalf("retryAfterFrom() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestNewRetryableCarriesTheHint(t *testing.T) {
	err := newRetryable(respWith(map[string]string{"Retry-After": "45"}), "status %d", 429)
	if err.retryAfter != 45*time.Second {
		t.Fatalf("retryAfter = %v, want 45s", err.retryAfter)
	}
	if err.Error() != "status 429" {
		t.Fatalf("Error() = %q", err.Error())
	}
}
