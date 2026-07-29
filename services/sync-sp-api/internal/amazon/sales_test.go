package amazon

import "testing"

func TestParseSalesAndTrafficReport(t *testing.T) {
	raw := []byte(`{
		"salesAndTrafficByDate": [
			{
				"date": "2026-07-01",
				"salesByDate": {
					"orderedProductSales": { "amount": 1234.56, "currencyCode": "USD" },
					"unitsOrdered": 42,
					"totalOrderItems": 30
				},
				"trafficByDate": { "pageViews": 100 }
			},
			{
				"date": "2026-07-02",
				"salesByDate": {
					"orderedProductSales": { "amount": 0, "currencyCode": "USD" },
					"unitsOrdered": 0,
					"totalOrderItems": 0
				},
				"trafficByDate": { "pageViews": 0 }
			}
		],
		"salesAndTrafficByAsin": []
	}`)

	records, err := parseSalesAndTrafficReport(raw)
	if err != nil {
		t.Fatalf("parseSalesAndTrafficReport() error: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("got %d records, want 2", len(records))
	}

	if records[0].Date != "2026-07-01" {
		t.Errorf("records[0].Date = %q, want 2026-07-01", records[0].Date)
	}
	if records[0].TotalSales != 1234.56 {
		t.Errorf("records[0].TotalSales = %v, want 1234.56", records[0].TotalSales)
	}
	if records[0].UnitsOrdered != 42 {
		t.Errorf("records[0].UnitsOrdered = %v, want 42", records[0].UnitsOrdered)
	}
	if records[0].Orders != 30 {
		t.Errorf("records[0].Orders = %v, want 30", records[0].Orders)
	}

	if records[1].TotalSales != 0 {
		t.Errorf("records[1].TotalSales = %v, want 0", records[1].TotalSales)
	}
}

func TestParseSalesAndTrafficReport_SkipsEntriesWithNoDate(t *testing.T) {
	raw := []byte(`{
		"salesAndTrafficByDate": [
			{ "date": "", "salesByDate": { "orderedProductSales": { "amount": 5 } } },
			{ "date": "2026-07-03", "salesByDate": { "orderedProductSales": { "amount": 5 } } }
		]
	}`)

	records, err := parseSalesAndTrafficReport(raw)
	if err != nil {
		t.Fatalf("parseSalesAndTrafficReport() error: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("got %d records, want 1", len(records))
	}
	if records[0].Date != "2026-07-03" {
		t.Errorf("records[0].Date = %q, want 2026-07-03", records[0].Date)
	}
}

func TestParseSalesAndTrafficReport_EmptyInput(t *testing.T) {
	records, err := parseSalesAndTrafficReport([]byte(""))
	if err != nil {
		t.Fatalf("parseSalesAndTrafficReport() error: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("got %d records, want 0", len(records))
	}
}

func TestParseSalesAndTrafficReport_NoDatesInBody(t *testing.T) {
	records, err := parseSalesAndTrafficReport([]byte(`{"salesAndTrafficByDate": []}`))
	if err != nil {
		t.Fatalf("parseSalesAndTrafficReport() error: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("got %d records, want 0", len(records))
	}
}

func TestParseSalesAndTrafficReport_InvalidJSON(t *testing.T) {
	_, err := parseSalesAndTrafficReport([]byte("not json"))
	if err == nil {
		t.Fatal("expected an error for invalid JSON, got nil")
	}
}
