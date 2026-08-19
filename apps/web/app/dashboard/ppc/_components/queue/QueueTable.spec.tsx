import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PpcQueueRow } from "../../_lib/ppc-queue-api";
import { QueueTable } from "./QueueTable";

function row(over: Partial<PpcQueueRow> & { id: string }): PpcQueueRow {
  return {
    title: "Zero-sale term — negate “x”", clientId: "c1", clientName: "Acme",
    ruleId: "W1", band: "W", type: "negation", status: "pending", confidence: "high",
    priorityScore: 10, impactMonthlyUsd: 100, impactBarFraction: 1, estMinutes: 4,
    blockedBy: null, assignee: null, createdAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function renderTable(rows: PpcQueueRow[], selected: string[] = []) {
  const onToggle = jest.fn();
  const onRowClick = jest.fn();
  const utils = render(
    <QueueTable rows={rows} selectedIds={new Set(selected)} onToggle={onToggle} onRowClick={onRowClick} />,
  );
  return { ...utils, onToggle, onRowClick };
}

// Locate by the checkbox's aria-label: it always carries the task id, while
// the visible sub-line does not (a blocked row shows its dependency instead).
function rowFor(id: string): HTMLElement {
  return screen.getByLabelText(new RegExp(id)).closest("tr") as HTMLElement;
}

describe("task sub-line", () => {
  it("reads 'TSK-… · N min · <confidence> confidence' normally", () => {
    renderTable([row({ id: "TSK-0412", estMinutes: 2, confidence: "high" })]);
    expect(screen.getByText(/TSK-0412 · 2 min · high confidence/)).toBeInTheDocument();
  });

  it("reads 'waits on TSK-…' for a blocked task instead of the metadata", () => {
    // NOTE: no real blocked task can exist yet — nothing in the codebase
    // sets blocked_by — so this contract is only covered here, never
    // demonstrated against live data.
    renderTable([row({ id: "TSK-0500", status: "blocked", blockedBy: "TSK-0421" })]);
    expect(screen.getByText("waits on TSK-0421")).toBeInTheDocument();
    expect(screen.queryByText(/· 4 min ·/)).not.toBeInTheDocument();
  });

  it("falls back to the normal sub-line if a blocked task has no blocked_by", () => {
    renderTable([row({ id: "TSK-0501", status: "blocked", blockedBy: null })]);
    expect(screen.getByText(/TSK-0501 · 4 min/)).toBeInTheDocument();
  });
});

describe("checkbox selectability", () => {
  it("enables approvable rows when nothing is selected", () => {
    renderTable([row({ id: "TSK-1" })]);
    expect(within(rowFor("TSK-1")).getByRole("checkbox")).toBeEnabled();
  });

  it("disables rows whose status can't be approved", () => {
    renderTable([
      row({ id: "TSK-V", status: "verified" }),
      row({ id: "TSK-B", status: "blocked", blockedBy: "TSK-1" }),
      row({ id: "TSK-D", status: "dismissed" }),
    ]);
    for (const id of ["TSK-V", "TSK-B", "TSK-D"]) {
      expect(within(rowFor(id)).getByRole("checkbox")).toBeDisabled();
    }
  });

  it("disables different-type rows once a selection locks a type", () => {
    renderTable(
      [row({ id: "TSK-N", type: "negation" }), row({ id: "TSK-BU", type: "budget" })],
      ["TSK-N"],
    );
    expect(within(rowFor("TSK-N")).getByRole("checkbox")).toBeChecked();
    expect(within(rowFor("TSK-BU")).getByRole("checkbox")).toBeDisabled();
  });

  it("re-enables other types when the selection is empty", () => {
    renderTable([row({ id: "TSK-N", type: "negation" }), row({ id: "TSK-BU", type: "budget" })]);
    expect(within(rowFor("TSK-BU")).getByRole("checkbox")).toBeEnabled();
  });

  it("explains why a row is unselectable rather than just greying it out", () => {
    renderTable(
      [row({ id: "TSK-N", type: "negation" }), row({ id: "TSK-BU", type: "budget" })],
      ["TSK-N"],
    );
    expect(within(rowFor("TSK-BU")).getByRole("checkbox")).toHaveAttribute(
      "title",
      expect.stringContaining("one task type at a time"),
    );
  });
});

describe("row interaction", () => {
  it("toggling a checkbox does not also trigger the row click", async () => {
    const user = userEvent.setup();
    const { onToggle, onRowClick } = renderTable([row({ id: "TSK-1" })]);
    await user.click(within(rowFor("TSK-1")).getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith("TSK-1");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("clicking the row body triggers the row click", async () => {
    const user = userEvent.setup();
    const { onRowClick } = renderTable([row({ id: "TSK-1" })]);
    await user.click(screen.getByText(/Zero-sale term/));
    expect(onRowClick).toHaveBeenCalledWith("TSK-1");
  });
});

describe("ordering", () => {
  it("renders rows in the exact order received, never re-sorting", () => {
    // A D-band $0 task above a W-band $214 one is the API's tier at work;
    // any client-side sort would flip these.
    renderTable([
      row({ id: "TSK-D", band: "D", ruleId: "D5", type: "investigate", impactMonthlyUsd: 0, impactBarFraction: 0 }),
      row({ id: "TSK-W", band: "W", ruleId: "W1", impactMonthlyUsd: 214.58, impactBarFraction: 1 }),
    ]);
    const ids = screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("checkbox").getAttribute("aria-label"));
    expect(ids[0]).toContain("TSK-D");
    expect(ids[1]).toContain("TSK-W");
  });
});
