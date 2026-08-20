import {
  buildFallbackLines,
  buildMetricValues,
  buildSourceLine,
  buildWindowLine,
  fallbackDisclosure,
  formatMetricValue,
  humanizeKey,
  shortDate,
} from "./evidence-lines";
import type { TaskDetail } from "./ppc-task-detail-api";

function detail(over: Partial<TaskDetail["evidence"]> = {}): TaskDetail {
  return {
    id: "TSK-1", ruleId: "W1", clientId: "c1", clientName: "Acme", title: "t",
    status: "pending", type: "negation", band: "W", confidence: "high", profile: "US",
    priorityScore: 1, estMinutes: 4, requiresReview: false, impactMonthlyUsd: null,
    impactBasis: null, instructions: [], decisionPath: null,
    action: { entityType: "search_term", campaignId: "1", campaignName: "C", adGroupId: null, field: "negative_keyword", oldValue: null, newValue: "NEGATIVE_EXACT" },
    evidence: {
      metrics: {}, window: null,
      provenance: { reportJobId: null, syncedAt: null, syncType: null },
      fallbacks: {}, expandableMetrics: [], factTable: null,
      ...over,
    },
    crossCheck: null, rollback: "", dismissReason: null, dismissNote: null,
    blockedBy: null, assignee: null, confirmedValue: null, verifyMismatchReason: null,
    createdAt: "", executedAt: null, verifiedAt: null, monitor: null,
  };
}

describe("fallback disclosure (§8.6 grounding rule)", () => {
  it("emits a disclosure line for every flagged fallback", () => {
    // The rule that matters: a fallback must never be indistinguishable
    // from a configured value.
    const lines = buildFallbackLines(detail({ metrics: { be: 35 }, fallbacks: { be: true } }));
    expect(lines).toHaveLength(1);
    expect(lines[0].display).toBe("35.0%");
    expect(lines[0].disclosure).toBe("account default — no product economics set");
  });

  it("emits NOTHING when the same value is not a fallback", () => {
    expect(buildFallbackLines(detail({ metrics: { be: 35 }, fallbacks: {} }))).toHaveLength(0);
    expect(buildFallbackLines(detail({ metrics: { be: 35 }, fallbacks: { be: false } }))).toHaveLength(0);
  });

  it("still discloses an unknown fallback key rather than staying silent", () => {
    const lines = buildFallbackLines(detail({ metrics: { somethingNew: 1 }, fallbacks: { somethingNew: true } }));
    expect(lines[0].disclosure).toContain("fallback value");
  });

  it("has a generic disclosure for any key not explicitly worded", () => {
    expect(fallbackDisclosure("be")).toContain("account default");
    expect(fallbackDisclosure("unmapped")).toContain("not configured");
  });
});

describe("expandable vs derived metrics", () => {
  it("marks only what the API listed as expandable", () => {
    const values = buildMetricValues(
      detail({ metrics: { clicks: 8, expectedClicksPerOrder: 3.2 }, expandableMetrics: ["clicks"] }),
    );
    expect(values.find((v) => v.key === "clicks")?.expandable).toBe(true);
    // Derived: must never get a clickable affordance.
    expect(values.find((v) => v.key === "expectedClicksPerOrder")?.expandable).toBe(false);
  });

  it("sorts expandable metrics first so clickable numbers cluster", () => {
    const values = buildMetricValues(
      detail({ metrics: { expectedClicksPerOrder: 3.2, clicks: 8 }, expandableMetrics: ["clicks"] }),
    );
    expect(values[0].key).toBe("clicks");
  });

  it("omits structural keys that have their own lines", () => {
    const values = buildMetricValues(
      detail({ metrics: { clicks: 8, searchTerm: "x", campaignName: "C", winnersElsewhere: [] } }),
    );
    expect(values.map((v) => v.key)).toEqual(["clicks"]);
  });

  it("omits nested objects, which aren't terminal lines", () => {
    const values = buildMetricValues(detail({ metrics: { clicks: 8, nested: { a: 1 } } }));
    expect(values.map((v) => v.key)).toEqual(["clicks"]);
  });
});

describe("value formatting", () => {
  it("formats money, percentages and counts distinctly", () => {
    expect(formatMetricValue("cost", 30.611)).toBe("$30.61");
    expect(formatMetricValue("monthlyWaste", 214.5)).toBe("$214.50");
    expect(formatMetricValue("recentClickShare", 0.046)).toBe("0.0%");
    // Break-even ACoS is a percentage even though its key doesn't say so.
    expect(formatMetricValue("be", 35)).toBe("35.0%");
    expect(formatMetricValue("clicks", 8)).toBe("8");
    expect(formatMetricValue("expectedClicksPerOrder", 25.098)).toBe("25.10");
  });

  it("renders null as an em-dash rather than 0", () => {
    expect(formatMetricValue("clicks", null)).toBe("—");
  });

  it("humanises camelCase keys", () => {
    expect(humanizeKey("expectedClicksPerOrder")).toBe("expected clicks per order");
    expect(humanizeKey("ad_group_id")).toBe("ad group id");
  });
});

describe("window and source lines", () => {
  it("formats the window as short dates", () => {
    expect(buildWindowLine(detail({ window: { start: "2026-06-25", end: "2026-07-24" } }))).toBe("Jun 25 – Jul 24");
  });

  it("returns null when there is no window", () => {
    expect(buildWindowLine(detail())).toBeNull();
  });

  it("states the source sync, job and pull date", () => {
    const line = buildSourceLine(
      detail({ provenance: { reportJobId: "5b0e21be-a633-459e", syncedAt: "2026-08-10T05:59:43Z", syncType: "ads_search_term" } }),
    );
    expect(line).toContain("ads_search_term report");
    expect(line).toContain("job 5b0e21be");
    expect(line).toContain("pulled Aug 10");
  });

  it("says the source is unknown rather than inventing one", () => {
    expect(buildSourceLine(detail())).toContain("source unknown");
  });

  it("handles a malformed date without crashing", () => {
    expect(shortDate("not-a-date")).toBe("not-a-date");
    expect(shortDate(null)).toBe("—");
  });
});
