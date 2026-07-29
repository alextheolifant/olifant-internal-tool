package amazon

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const salesReportType = "GET_SALES_AND_TRAFFIC_REPORT"

// reportRequestBody is the JSON body for POST /reports/2021-06-30/reports.
type reportRequestBody struct {
	ReportType     string   `json:"reportType"`
	DataStartTime  string   `json:"dataStartTime"`
	DataEndTime    string   `json:"dataEndTime"`
	MarketplaceIDs []string `json:"marketplaceIds"`
}

// createReportResponse is the response from POST /reports/2021-06-30/reports —
// VERIFIED shape: only reportId, nothing else. There is no initial status; the
// caller must poll immediately after to learn anything about processing state.
type createReportResponse struct {
	ReportID string `json:"reportId"`
}

// ReportStatus is the response from GET /reports/2021-06-30/reports/{reportId}.
type ReportStatus struct {
	ReportID         string `json:"reportId"`
	ProcessingStatus string `json:"processingStatus"` // IN_QUEUE | IN_PROGRESS | CANCELLED | DONE | FATAL
	ReportDocumentID string `json:"reportDocumentId"`
}

// reportDocumentResponse is the response from GET /reports/2021-06-30/documents/{id}.
type reportDocumentResponse struct {
	URL                  string `json:"url"`
	CompressionAlgorithm string `json:"compressionAlgorithm"`
}

// RequestReport submits a GET_SALES_AND_TRAFFIC_REPORT for one account and
// returns Amazon's reportId.
func (c *Client) RequestReport(ctx context.Context, accessToken string, region Region, marketplaceID, startDate, endDate string) (string, error) {
	body, err := json.Marshal(reportRequestBody{
		ReportType:     salesReportType,
		DataStartTime:  startDate,
		DataEndTime:    endDate,
		MarketplaceIDs: []string{marketplaceID},
	})
	if err != nil {
		return "", fmt.Errorf("marshal report request: %w", err)
	}

	resp, err := withRetry(ctx, func() (*createReportResponse, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, region.BaseURL+"/reports/2021-06-30/reports", bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-amz-access-token", accessToken)

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, _ := io.ReadAll(httpResp.Body)
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK && httpResp.StatusCode != http.StatusAccepted {
			return nil, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}
		var r createReportResponse
		if err := json.Unmarshal(b, &r); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
		return &r, nil
	})
	if err != nil {
		return "", err
	}
	return resp.ReportID, nil
}

// GetReportStatus polls one report's processing status. Once DONE,
// ReportDocumentID is populated in this same response — no extra call needed.
func (c *Client) GetReportStatus(ctx context.Context, accessToken string, region Region, reportID string) (*ReportStatus, error) {
	return withRetry(ctx, func() (*ReportStatus, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, region.BaseURL+"/reports/2021-06-30/reports/"+reportID, nil)
		if err != nil {
			return nil, fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("x-amz-access-token", accessToken)

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, _ := io.ReadAll(httpResp.Body)
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}
		var s ReportStatus
		if err := json.Unmarshal(b, &s); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
		return &s, nil
	})
}

// DailySales is one day's row parsed out of a GET_SALES_AND_TRAFFIC_REPORT.
type DailySales struct {
	Date         string
	TotalSales   float64
	UnitsOrdered int64
	Orders       int64
}

// DownloadReport fetches the report document's signed download URL, then
// downloads and decompresses (if needed) the underlying file.
// GET_SALES_AND_TRAFFIC_REPORT is one of the SP-API reports that comes back
// as JSON (salesAndTrafficByDate[]), not a flat/TSV file like most other
// report types.
func (c *Client) DownloadReport(ctx context.Context, accessToken string, region Region, reportDocumentID string) ([]DailySales, error) {
	doc, err := withRetry(ctx, func() (*reportDocumentResponse, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, region.BaseURL+"/reports/2021-06-30/documents/"+reportDocumentID, nil)
		if err != nil {
			return nil, fmt.Errorf("build document request: %w", err)
		}
		req.Header.Set("x-amz-access-token", accessToken)

		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("http: %w", err)}
		}
		defer httpResp.Body.Close()

		b, _ := io.ReadAll(httpResp.Body)
		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("status %d: %s", httpResp.StatusCode, b)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("status %d: %s", httpResp.StatusCode, b)
		}
		var d reportDocumentResponse
		if err := json.Unmarshal(b, &d); err != nil {
			return nil, fmt.Errorf("decode document response: %w", err)
		}
		return &d, nil
	})
	if err != nil {
		return nil, fmt.Errorf("get report document: %w", err)
	}

	// The download URL is a pre-signed S3 URL — used exactly as received, no
	// further signing or auth headers.
	rawBody, err := withRetry(ctx, func() ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, doc.URL, nil)
		if err != nil {
			return nil, fmt.Errorf("build download request: %w", err)
		}
		httpResp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, &retryableError{fmt.Errorf("download http: %w", err)}
		}
		defer httpResp.Body.Close()

		if httpResp.StatusCode == http.StatusTooManyRequests || httpResp.StatusCode >= 500 {
			return nil, &retryableError{fmt.Errorf("download status %d", httpResp.StatusCode)}
		}
		if httpResp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("download status %d", httpResp.StatusCode)
		}

		var reader io.Reader = httpResp.Body
		if strings.EqualFold(doc.CompressionAlgorithm, "GZIP") {
			gz, err := gzip.NewReader(httpResp.Body)
			if err != nil {
				return nil, fmt.Errorf("gzip open: %w", err)
			}
			defer gz.Close()
			reader = gz
		}
		return io.ReadAll(reader)
	})
	if err != nil {
		return nil, fmt.Errorf("download report file: %w", err)
	}

	return parseSalesAndTrafficReport(rawBody)
}

// salesAndTrafficReport mirrors the subset of GET_SALES_AND_TRAFFIC_REPORT's
// JSON shape we need — one entry per date, agency-wide (not per-ASIN).
type salesAndTrafficReport struct {
	SalesAndTrafficByDate []struct {
		Date        string `json:"date"`
		SalesByDate struct {
			OrderedProductSales struct {
				Amount float64 `json:"amount"`
			} `json:"orderedProductSales"`
			UnitsOrdered    int64 `json:"unitsOrdered"`
			TotalOrderItems int64 `json:"totalOrderItems"`
		} `json:"salesByDate"`
	} `json:"salesAndTrafficByDate"`
}

// parseSalesAndTrafficReport parses the JSON report body into one DailySales
// row per date present in salesAndTrafficByDate.
func parseSalesAndTrafficReport(raw []byte) ([]DailySales, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil
	}

	var report salesAndTrafficReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return nil, fmt.Errorf("decode sales and traffic report: %w", err)
	}

	records := make([]DailySales, 0, len(report.SalesAndTrafficByDate))
	for _, d := range report.SalesAndTrafficByDate {
		if d.Date == "" {
			continue
		}
		records = append(records, DailySales{
			Date:         d.Date,
			TotalSales:   d.SalesByDate.OrderedProductSales.Amount,
			UnitsOrdered: d.SalesByDate.UnitsOrdered,
			Orders:       d.SalesByDate.TotalOrderItems,
		})
	}
	return records, nil
}
