package amazon

import "testing"

func TestExtractNameAndStatus(t *testing.T) {
	item := CatalogItem{
		ASIN: "B0TEST123",
		Summaries: []CatalogItemSummary{
			{MarketplaceID: "ATVPDKIKX0DER", ItemName: "Test Product", Status: "DISCOVERABLE"},
		},
	}

	name, status := ExtractNameAndStatus(item)
	if name != "Test Product" {
		t.Errorf("name = %q, want %q", name, "Test Product")
	}
	if status != "DISCOVERABLE" {
		t.Errorf("status = %q, want %q", status, "DISCOVERABLE")
	}
}

func TestExtractNameAndStatus_NoSummaries(t *testing.T) {
	name, status := ExtractNameAndStatus(CatalogItem{ASIN: "B0NOTFOUND"})
	if name != "" || status != "" {
		t.Errorf("got (%q, %q), want (\"\", \"\")", name, status)
	}
}

func TestChunkASINs(t *testing.T) {
	asins := make([]string, 45)
	for i := range asins {
		asins[i] = "B0"
	}

	chunks := ChunkASINs(asins)
	if len(chunks) != 3 {
		t.Fatalf("got %d chunks, want 3", len(chunks))
	}
	if len(chunks[0]) != 20 || len(chunks[1]) != 20 || len(chunks[2]) != 5 {
		t.Errorf("chunk sizes = %d, %d, %d, want 20, 20, 5", len(chunks[0]), len(chunks[1]), len(chunks[2]))
	}
}

func TestChunkASINs_Empty(t *testing.T) {
	if chunks := ChunkASINs(nil); chunks != nil {
		t.Errorf("got %v, want nil", chunks)
	}
}

func TestChunkASINs_ExactMultiple(t *testing.T) {
	asins := make([]string, 40)
	chunks := ChunkASINs(asins)
	if len(chunks) != 2 {
		t.Fatalf("got %d chunks, want 2", len(chunks))
	}
	if len(chunks[0]) != 20 || len(chunks[1]) != 20 {
		t.Errorf("chunk sizes = %d, %d, want 20, 20", len(chunks[0]), len(chunks[1]))
	}
}
