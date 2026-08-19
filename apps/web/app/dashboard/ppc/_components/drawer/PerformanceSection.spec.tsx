import { render, screen } from "@testing-library/react";
import type { PerformancePoint, PerformanceResponse } from "../../_lib/ppc-task-detail-api";
import { PerformanceSection } from "./PerformanceSection";

function pt(date: string, over: Partial<PerformancePoint> = {}): PerformancePoint {
  return { date, spend: 10, sales: 40, clicks: 5, impressions: 100, orders: 1, acos: 25, provisional: false, ...over };
}

function perf(over: Partial<Extract<PerformanceResponse, { available: true }>> = {}): PerformanceResponse {
  return {
    available: true, taskId: "TSK-1", executionDate: "2026-08-11",
    entitySeries: null, entityType: "campaign", entityId: "c1",
    campaignSeries: [pt("2026-08-09"), pt("2026-08-10"), pt("2026-08-11")],
    campaignId: "c1", provisionalFromDate: "2026-08-05", latestFactDate: "2026-08-13",
    verdict: null, verdictStage: null, verifiedSavingsMonthly: null,
    ...over,
  };
}

describe("PerformanceSection", () => {
  it("renders nothing when the API says performance is unavailable", () => {
    const { container } = render(
      <PerformanceSection perf={{ available: false, taskId: "TSK-1", reason: "not executed" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the verdict VERBATIM, without reformatting", () => {
    // The string is worded to state its normalization honestly; summarising
    // it would defeat the point.
    const verdict =
      "+14d verdict: $19.40 verified savings to date ($41/mo run-rate), stated net of account trend — account-wide spend +6% over the same window.";
    render(<PerformanceSection perf={perf({ verdict })} />);
    expect(screen.getByText(verdict)).toBeInTheDocument();
  });

  it("says no verdict exists yet rather than showing an empty strip", () => {
    render(<PerformanceSection perf={perf({ verdict: null })} />);
    expect(screen.getByText(/first checkpoint is written 14 days after execution/)).toBeInTheDocument();
  });

  it("renders one chart for a campaign-level task and explains why", () => {
    render(<PerformanceSection perf={perf({ entitySeries: null })} />);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText(/entity and campaign series are the same/)).toBeInTheDocument();
  });

  it("renders TWO charts when the entity differs from the campaign", () => {
    render(
      <PerformanceSection
        perf={perf({
          entityType: "search_term",
          entitySeries: [pt("2026-08-09"), pt("2026-08-10"), pt("2026-08-11")],
        })}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByText(/series are the same/)).not.toBeInTheDocument();
  });

  it("handles a series too short to plot without crashing", () => {
    render(<PerformanceSection perf={perf({ campaignSeries: [pt("2026-08-09")] })} />);
    expect(screen.getByText(/Not enough points to plot/)).toBeInTheDocument();
  });

  it("handles an entirely empty series", () => {
    render(<PerformanceSection perf={perf({ campaignSeries: [] })} />);
    expect(screen.getByText(/No data in this window yet/)).toBeInTheDocument();
  });

  it("shows a provisional legend only when the API flagged provisional days", () => {
    const { rerender } = render(<PerformanceSection perf={perf()} />);
    expect(screen.queryByText("provisional")).not.toBeInTheDocument();

    rerender(
      <PerformanceSection
        perf={perf({ campaignSeries: [pt("2026-08-09"), pt("2026-08-10"), pt("2026-08-11", { provisional: true })] })}
      />,
    );
    expect(screen.getByText("provisional")).toBeInTheDocument();
  });
});
