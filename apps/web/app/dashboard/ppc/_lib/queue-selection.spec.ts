import type { PpcQueueRow } from "./ppc-queue-api";
import {
  isApprovableStatus,
  rowSelectability,
  selectAllOfLockedType,
  selectedType,
  toggleSelection,
} from "./queue-selection";

function row(id: string, type: string, status: string): PpcQueueRow {
  return {
    id, type, status,
    title: `Task ${id}`, clientId: "c1", clientName: "Acme", ruleId: "W1", band: "W",
    confidence: "high", priorityScore: 10, impactMonthlyUsd: 100, impactBarFraction: 1,
    estMinutes: 4, blockedBy: null, assignee: null, createdAt: "2026-08-01T00:00:00Z",
  };
}

const rows = [
  row("A", "negation", "pending"),
  row("B", "negation", "pending"),
  row("C", "budget", "pending"),
  row("D", "negation", "verified"),
  row("E", "negation", "blocked"),
  row("F", "negation", "dismissed"),
];

describe("approvable statuses", () => {
  it("allows only pending — the sole 'x -> approved' edge in the state machine", () => {
    expect(isApprovableStatus("pending")).toBe(true);
    for (const s of ["approved", "blocked", "executed", "verified", "dismissed", "expired"]) {
      expect(isApprovableStatus(s)).toBe(false);
    }
  });

  it("excludes non-approvable rows from selection with a specific reason", () => {
    for (const r of [row("x", "negation", "verified"), row("y", "negation", "blocked"), row("z", "negation", "dismissed")]) {
      const sel = rowSelectability(r, null);
      expect(sel.selectable).toBe(false);
      expect(sel.reason).toBe("not_approvable");
    }
  });
});

describe("same-type constraint", () => {
  it("locks onto the first selected row's type", () => {
    expect(selectedType(rows, new Set())).toBeNull();
    expect(selectedType(rows, new Set(["A"]))).toBe("negation");
  });

  it("keeps same-type rows selectable and makes other types unselectable", () => {
    expect(rowSelectability(rows[1], "negation").selectable).toBe(true);
    const other = rowSelectability(rows[2], "negation");
    expect(other.selectable).toBe(false);
    expect(other.reason).toBe("different_type");
  });

  it("REFUSES a mixed-type add even if the click gets through", () => {
    // Guards the stale-click case: the checkbox is disabled in the UI, but
    // the rule is enforced here too rather than trusting the rendering.
    const sel = toggleSelection(rows, new Set(["A"]), "C");
    expect(sel.has("C")).toBe(false);
    expect([...sel]).toEqual(["A"]);
  });

  it("refuses a non-approvable add", () => {
    expect(toggleSelection(rows, new Set(["A"]), "D").has("D")).toBe(false);
  });

  it("accumulates same-type rows", () => {
    let sel = toggleSelection(rows, new Set(), "A");
    sel = toggleSelection(rows, sel, "B");
    expect([...sel].sort()).toEqual(["A", "B"]);
  });

  it("unlocks the type once the selection empties, freeing other types", () => {
    let sel = toggleSelection(rows, new Set(), "A");
    sel = toggleSelection(rows, sel, "A"); // deselect
    expect(selectedType(rows, sel)).toBeNull();
    expect(rowSelectability(rows[2], null).selectable).toBe(true);
  });

  it("ignores an unknown id rather than throwing", () => {
    expect(toggleSelection(rows, new Set(), "does-not-exist").size).toBe(0);
  });
});

describe("select all", () => {
  it("takes only approvable rows of the locked type", () => {
    const all = selectAllOfLockedType(rows, new Set(["A"]));
    expect([...all].sort()).toEqual(["A", "B"]); // not C (budget), not D/E/F (non-approvable)
  });

  it("returns an empty set when nothing is approvable", () => {
    const none = [row("X", "negation", "verified"), row("Y", "budget", "executed")];
    expect(selectAllOfLockedType(none, new Set()).size).toBe(0);
  });
});
