package amazon

import "testing"

func TestParseMerchantListingsReport(t *testing.T) {
	raw := []byte("item-name\tseller-sku\tasin1\tstatus\tprice\n" +
		"Coat Defense Powder\tCD-PWD-01\tB0TESTASIN1\tActive\t19.99\n" +
		"Coat Defense Spray\tCD-SPR-02\tB0TESTASIN2\tInactive\t14.99\n")

	listings, err := parseMerchantListingsReport(raw)
	if err != nil {
		t.Fatalf("parseMerchantListingsReport() error: %v", err)
	}
	if len(listings) != 2 {
		t.Fatalf("got %d listings, want 2", len(listings))
	}

	if listings[0].ASIN != "B0TESTASIN1" {
		t.Errorf("listings[0].ASIN = %q, want B0TESTASIN1", listings[0].ASIN)
	}
	if listings[0].SellerSKU != "CD-PWD-01" {
		t.Errorf("listings[0].SellerSKU = %q, want CD-PWD-01", listings[0].SellerSKU)
	}
	if listings[0].ProductName != "Coat Defense Powder" {
		t.Errorf("listings[0].ProductName = %q, want %q", listings[0].ProductName, "Coat Defense Powder")
	}
	if listings[0].Status != "Active" {
		t.Errorf("listings[0].Status = %q, want Active", listings[0].Status)
	}
}

func TestParseMerchantListingsReport_FallbackColumnNames(t *testing.T) {
	// Some accounts/marketplaces may use "asin" and "sku" instead of
	// "asin1"/"seller-sku" — the fallback list should still resolve them.
	raw := []byte("item-name\tsku\tasin\n" +
		"Test Product\tSKU1\tB0FALLBACK\n")

	listings, err := parseMerchantListingsReport(raw)
	if err != nil {
		t.Fatalf("parseMerchantListingsReport() error: %v", err)
	}
	if len(listings) != 1 {
		t.Fatalf("got %d listings, want 1", len(listings))
	}
	if listings[0].ASIN != "B0FALLBACK" {
		t.Errorf("ASIN = %q, want B0FALLBACK", listings[0].ASIN)
	}
	if listings[0].SellerSKU != "SKU1" {
		t.Errorf("SellerSKU = %q, want SKU1", listings[0].SellerSKU)
	}
}

func TestParseMerchantListingsReport_SkipsRowsWithNoASIN(t *testing.T) {
	raw := []byte("item-name\tasin1\n" +
		"No ASIN Product\t\n" +
		"Has ASIN Product\tB0HASASIN\n")

	listings, err := parseMerchantListingsReport(raw)
	if err != nil {
		t.Fatalf("parseMerchantListingsReport() error: %v", err)
	}
	if len(listings) != 1 {
		t.Fatalf("got %d listings, want 1", len(listings))
	}
	if listings[0].ASIN != "B0HASASIN" {
		t.Errorf("ASIN = %q, want B0HASASIN", listings[0].ASIN)
	}
}

func TestParseMerchantListingsReport_EmptyInput(t *testing.T) {
	listings, err := parseMerchantListingsReport([]byte(""))
	if err != nil {
		t.Fatalf("parseMerchantListingsReport() error: %v", err)
	}
	if len(listings) != 0 {
		t.Fatalf("got %d listings, want 0", len(listings))
	}
}

func TestParseMerchantListingsReport_MissingASINColumn(t *testing.T) {
	raw := []byte("item-name\tprice\nSome Product\t9.99\n")
	_, err := parseMerchantListingsReport(raw)
	if err == nil {
		t.Fatal("expected an error when no ASIN column is present, got nil")
	}
}
