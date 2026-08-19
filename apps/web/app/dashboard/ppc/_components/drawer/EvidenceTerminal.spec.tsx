import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaskDetail } from "../../_lib/ppc-task-detail-api";
import { fetchTaskFacts } from "../../_lib/ppc-task-detail-api";
import { EvidenceTerminal } from "./EvidenceTerminal";

jest.mock("../../_lib/ppc-task-detail-api", () => ({
  ...jest.requireActual("../../_lib/ppc-task-detail-api"),
  fetchTaskFacts: jest.fn(),
}));
const mockFetch = fetchTaskFacts as jest.MockedFunction<typeof fetchTaskFacts>;

function detail(over: Partial<TaskDetail["evidence"]> = {}, crossCheck: TaskDetail["crossCheck"] = null): TaskDetail {
  return {
    id: "TSK-1", ruleId: "W1", clientId: "c1", clientName: "Acme", title: "t",
    status: "pending", type: "negation", band: "W", confidence: "high", profile: "US",
    priorityScore: 1, estMinutes: 4, requiresReview: false, impactMonthlyUsd: null,
    impactBasis: null, instructions: [], decisionPath: null,
    action: { entityType: "search_term", campaignId: "1", campaignName: "C", adGroupId: null, field: "f", oldValue: null, newValue: "x" },
    evidence: {
      metrics: { clicks: 8, expectedClicksPerOrder: 3.2 }, window: { start: "2026-06-25", end: "2026-07-24" },
      provenance: { reportJobId: "r8841aaa", syncedAt: "2026-07-26T00:00:00Z", syncType: "ads_search_term" },
      fallbacks: {}, expandableMetrics: ["clicks"], factTable: "search_term_metrics_daily",
      ...over,
    },
    crossCheck, rollback: "", dismissReason: null, dismissNote: null, blockedBy: null,
    assignee: null, confirmedValue: null, verifyMismatchReason: null, createdAt: "",
    executedAt: null, verifiedAt: null, monitor: null,
  };
}

beforeEach(() => mockFetch.mockReset());

describe("interactive numbers", () => {
  it("makes an API-listed metric clickable and leaves a derived one inert", () => {
    render(<EvidenceTerminal detail={detail()} />);
    // clicks -> button (expandable)
    expect(screen.getByRole("button", { name: /clicks 8/ })).toBeInTheDocument();
    // expected clicks per order -> plain text, no button
    expect(screen.queryByRole("button", { name: /expected clicks per order/ })).not.toBeInTheDocument();
    expect(screen.getByText(/expected clicks per order 3\.20/)).toBeInTheDocument();
  });

  it("expands the daily fact rows on click", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      taskId: "TSK-1", metric: "clicks", expandable: true, reason: null,
      factTable: "search_term_metrics_daily", column: "clicks",
      window: { start: "2026-06-25", end: "2026-07-24" },
      rows: [{ date: "2026-07-14", clicks: 2, cost: 7.26 }, { date: "2026-07-17", clicks: 5, cost: 22.45 }],
      total: 7,
    });

    render(<EvidenceTerminal detail={detail()} />);
    await user.click(screen.getByRole("button", { name: /clicks 8/ }));

    await waitFor(() => expect(screen.getByText("2026-07-14")).toBeInTheDocument());
    expect(screen.getByText("2026-07-17")).toBeInTheDocument();
    expect(screen.getByText("total 7")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("TSK-1", "clicks");
  });

  it("keeps only one expansion open at a time", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      taskId: "TSK-1", metric: "clicks", expandable: true, reason: null,
      factTable: "t", column: "clicks", window: null, rows: [{ date: "2026-07-14", clicks: 2 }], total: 2,
    });
    render(<EvidenceTerminal detail={detail({ metrics: { clicks: 8, cost: 30.61 }, expandableMetrics: ["clicks", "cost"] })} />);

    await user.click(screen.getByRole("button", { name: /clicks 8/ }));
    await waitFor(() => expect(screen.getByText("2026-07-14")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /cost \$30\.61/ }));

    // One expansion panel, now belonging to the second metric.
    await waitFor(() => expect(screen.getAllByText(/^(clicks|cost)$/).length).toBeGreaterThan(0));
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("closes the expansion when the same number is clicked again", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      taskId: "TSK-1", metric: "clicks", expandable: true, reason: null,
      factTable: "t", column: "clicks", window: null, rows: [{ date: "2026-07-14", clicks: 2 }], total: 2,
    });
    render(<EvidenceTerminal detail={detail()} />);
    const btn = screen.getByRole("button", { name: /clicks 8/ });
    await user.click(btn);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    await user.click(btn);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("surfaces a facts error instead of an empty table", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValue(new Error("HTTP 500"));
    render(<EvidenceTerminal detail={detail()} />);
    await user.click(screen.getByRole("button", { name: /clicks 8/ }));
    await waitFor(() => expect(screen.getByText("HTTP 500")).toBeInTheDocument());
  });
});

describe("terminal lines", () => {
  it("discloses a fallback value on its own line", () => {
    render(<EvidenceTerminal detail={detail({ metrics: { be: 35 }, fallbacks: { be: true }, expandableMetrics: [] })} />);
    expect(screen.getByText(/account default — no product economics set/)).toBeInTheDocument();
  });

  it("renders the same value with NO disclosure when it isn't a fallback", () => {
    render(<EvidenceTerminal detail={detail({ metrics: { be: 35 }, fallbacks: {}, expandableMetrics: [] })} />);
    expect(screen.queryByText(/account default/)).not.toBeInTheDocument();
  });

  it("renders the window and source provenance", () => {
    render(<EvidenceTerminal detail={detail()} />);
    expect(screen.getByText("Jun 25 – Jul 24")).toBeInTheDocument();
    expect(screen.getByText(/ads_search_term report/)).toBeInTheDocument();
    expect(screen.getByText(/pulled Jul 26/)).toBeInTheDocument();
  });

  it("renders the cross-check line when the rule performed one", () => {
    render(
      <EvidenceTerminal
        detail={detail({}, { performed: true, winners: [], summary: "Checked: not converting anywhere else." })}
      />,
    );
    expect(screen.getByText("Checked: not converting anywhere else.")).toBeInTheDocument();
  });

  it("omits the cross-check line for rules that don't perform one", () => {
    render(<EvidenceTerminal detail={detail()} />);
    expect(screen.queryByText(/Checked:/)).not.toBeInTheDocument();
  });
});
