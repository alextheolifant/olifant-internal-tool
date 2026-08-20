import { render, screen } from "@testing-library/react";
import type { TaskDetail } from "../../_lib/ppc-task-detail-api";
import { DrawerHeader } from "./DrawerHeader";

function detail(over: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: "TSK-0412", ruleId: "W1", clientId: "c1", clientName: "Coat Defense",
    title: "Zero-sale term — negate “coat defense”", status: "pending", type: "negation",
    band: "W", confidence: "high", profile: "US", priorityScore: 1, estMinutes: 4,
    requiresReview: false, impactMonthlyUsd: null, impactBasis: null, instructions: [],
    decisionPath: null,
    action: { entityType: "search_term", campaignId: "1", campaignName: "C", adGroupId: null, field: "negative_keyword", oldValue: null, newValue: "NEGATIVE_EXACT" },
    evidence: { metrics: {}, window: null, provenance: { reportJobId: null, syncedAt: null, syncType: null }, fallbacks: {}, expandableMetrics: [], factTable: null },
    crossCheck: null, rollback: "", dismissReason: null, dismissNote: null, blockedBy: null,
    assignee: null, confirmedValue: null, verifyMismatchReason: null, createdAt: "",
    executedAt: null, verifiedAt: null, monitor: null,
    ...over,
  };
}

describe("DrawerHeader", () => {
  it("renders the mono breadcrumb as id · rule · client", () => {
    render(<DrawerHeader detail={detail()} />);
    expect(screen.getByText("TSK-0412 · rule W1 · Coat Defense")).toBeInTheDocument();
  });

  it("renders status, type and confidence pills", () => {
    render(<DrawerHeader detail={detail()} />);
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText("Negation")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
  });

  it("renders the Requires review pill when the flag is set", () => {
    // NOTE: no rule currently sets requires_review, so this path has no real
    // data behind it yet — covered here so the pill can't silently regress.
    render(<DrawerHeader detail={detail({ requiresReview: true })} />);
    expect(screen.getByText("Requires review")).toBeInTheDocument();
  });

  it("omits the pill when the flag is false", () => {
    render(<DrawerHeader detail={detail()} />);
    expect(screen.queryByText("Requires review")).not.toBeInTheDocument();
  });

  it("uses the caution (amber) treatment, not the error (red) one", () => {
    // A task needing judgement is not a task that has gone wrong.
    render(<DrawerHeader detail={detail({ requiresReview: true })} />);
    const pill = screen.getByText("Requires review");
    expect(pill.className).toContain("amber");
    expect(pill.className).not.toContain("red");
  });
});
