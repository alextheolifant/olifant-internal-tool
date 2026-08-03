package amazon

import (
	"bytes"
	"context"
	"fmt"
	"strings"
)

// MerchantListingsReportType is the report type value for the ASIN-discovery
// sync. Chosen over Catalog Items' searchCatalogItems because that endpoint
// searches Amazon's whole public catalog rather than filtering by seller —
// it can't discover which ASINs this seller actually has. This report is
// inherently seller-scoped (generated with that seller's own access token)
// and covers FBM sellers too, unlike FBA inventory.
const MerchantListingsReportType = "GET_MERCHANT_LISTINGS_ALL_DATA"

// MerchantListing is one row of a parsed GET_MERCHANT_LISTINGS_ALL_DATA report.
type MerchantListing struct {
	ASIN        string
	SellerSKU   string
	ProductName string
	Status      string
}

// Confirmed against real accounts on 2026-08-03: tab-separated, asin1/
// seller-sku/status all matched on the first production run. item-name did
// not — Amazon prefixes this report with a UTF-8 BOM, which attaches to
// whichever column is physically first in the header row (item-name here),
// so it silently failed the exact-string match while every other column
// (unaffected by the BOM) matched fine. Stripped below.
var (
	asinColumns     = []string{"asin1", "asin"}
	skuColumns      = []string{"seller-sku", "sku"}
	productNameCols = []string{"item-name"}
	statusColumns   = []string{"status"}
)

// utf8BOM is the byte sequence Amazon prefixes this report with.
var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// DownloadMerchantListingsReport downloads and parses a
// GET_MERCHANT_LISTINGS_ALL_DATA document via the shared
// DownloadReportDocument fetch/decompress logic.
func (c *Client) DownloadMerchantListingsReport(ctx context.Context, accessToken string, region Region, reportDocumentID string) ([]MerchantListing, error) {
	rawBody, err := c.DownloadReportDocument(ctx, accessToken, region, reportDocumentID)
	if err != nil {
		return nil, err
	}
	return parseMerchantListingsReport(rawBody)
}

// parseMerchantListingsReport parses the tab-separated flat file returned by
// GET_MERCHANT_LISTINGS_ALL_DATA: a header row naming each column, then one
// row per listing. Columns are resolved by header name, not fixed position.
func parseMerchantListingsReport(raw []byte) ([]MerchantListing, error) {
	trimmed := bytes.TrimSpace(bytes.TrimPrefix(raw, utf8BOM))
	if len(trimmed) == 0 {
		return nil, nil
	}

	lines := strings.Split(string(trimmed), "\n")
	if len(lines) < 1 {
		return nil, nil
	}

	header := strings.Split(strings.TrimRight(lines[0], "\r"), "\t")
	colIndex := make(map[string]int, len(header))
	for i, name := range header {
		colIndex[strings.ToLower(strings.TrimSpace(name))] = i
	}

	asinCol, err := resolveColumn(colIndex, asinColumns)
	if err != nil {
		return nil, fmt.Errorf("merchant listings report: %w", err)
	}
	skuCol := resolveColumnOptional(colIndex, skuColumns)
	nameCol := resolveColumnOptional(colIndex, productNameCols)
	statusCol := resolveColumnOptional(colIndex, statusColumns)

	listings := make([]MerchantListing, 0, len(lines)-1)
	for _, line := range lines[1:] {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Split(line, "\t")

		asin := field(fields, asinCol)
		if asin == "" {
			continue // no ASIN on this row — nothing to record
		}

		listings = append(listings, MerchantListing{
			ASIN:        asin,
			SellerSKU:   field(fields, skuCol),
			ProductName: field(fields, nameCol),
			Status:      field(fields, statusCol),
		})
	}

	return listings, nil
}

// resolveColumn finds the first matching column name and errors if none of
// the candidates are present — used for the ASIN column, without which a row
// is useless.
func resolveColumn(colIndex map[string]int, candidates []string) (int, error) {
	idx := resolveColumnOptional(colIndex, candidates)
	if idx < 0 {
		return -1, fmt.Errorf("no column found among %v (header was: %v)", candidates, keys(colIndex))
	}
	return idx, nil
}

// resolveColumnOptional finds the first matching column name, or -1 if none
// of the candidates are present — used for columns that degrade gracefully
// to an empty string.
func resolveColumnOptional(colIndex map[string]int, candidates []string) int {
	for _, c := range candidates {
		if idx, ok := colIndex[c]; ok {
			return idx
		}
	}
	return -1
}

func field(fields []string, idx int) string {
	if idx < 0 || idx >= len(fields) {
		return ""
	}
	return strings.TrimSpace(fields[idx])
}

func keys(m map[string]int) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	return ks
}
