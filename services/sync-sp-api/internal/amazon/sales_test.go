package amazon

import "testing"

func TestParseTSV(t *testing.T) {
	raw := []byte("date\torderedProductSales\tunitsOrdered\ttotalOrderItems\n" +
		"2026-07-01\t1234.56\t42\t30\n" +
		"2026-07-02\t0\t0\t0\n")

	records, err := parseTSV(raw)
	if err != nil {
		t.Fatalf("parseTSV() error: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("got %d records, want 2", len(records))
	}

	if records[0]["date"] != "2026-07-01" {
		t.Errorf("records[0][date] = %q, want 2026-07-01", records[0]["date"])
	}
	if got := TSVFloat(records[0], "orderedProductSales"); got != 1234.56 {
		t.Errorf("TSVFloat(orderedProductSales) = %v, want 1234.56", got)
	}
	if got := TSVInt(records[0], "unitsOrdered"); got != 42 {
		t.Errorf("TSVInt(unitsOrdered) = %v, want 42", got)
	}
	if got := TSVInt(records[0], "totalOrderItems"); got != 30 {
		t.Errorf("TSVInt(totalOrderItems) = %v, want 30", got)
	}

	if got := TSVFloat(records[1], "orderedProductSales"); got != 0 {
		t.Errorf("TSVFloat(orderedProductSales) row 2 = %v, want 0", got)
	}
}

func TestParseTSV_MissingOrEmptyFieldsDefaultToZero(t *testing.T) {
	raw := []byte("date\torderedProductSales\n2026-07-01\t\n")

	records, err := parseTSV(raw)
	if err != nil {
		t.Fatalf("parseTSV() error: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("got %d records, want 1", len(records))
	}

	// Field present but empty.
	if got := TSVFloat(records[0], "orderedProductSales"); got != 0 {
		t.Errorf("TSVFloat on empty cell = %v, want 0", got)
	}
	// Field absent entirely from the header.
	if got := TSVInt(records[0], "unitsOrdered"); got != 0 {
		t.Errorf("TSVInt on missing key = %v, want 0", got)
	}
}

func TestParseTSV_EmptyInput(t *testing.T) {
	records, err := parseTSV([]byte(""))
	if err != nil {
		t.Fatalf("parseTSV() error: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("got %d records, want 0", len(records))
	}
}

func TestParseTSV_HeaderOnlyNoDataRows(t *testing.T) {
	records, err := parseTSV([]byte("date\torderedProductSales\n"))
	if err != nil {
		t.Fatalf("parseTSV() error: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("got %d records, want 0", len(records))
	}
}
