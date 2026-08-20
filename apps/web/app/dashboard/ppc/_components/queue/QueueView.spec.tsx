import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchPpcQueue } from "../../_lib/ppc-queue-api";
import { usePpcClientFilter } from "../../_lib/ppc-client-filter-context";
import { QueueView } from "./QueueView";

jest.mock("../../_lib/ppc-queue-api", () => ({
  ...jest.requireActual("../../_lib/ppc-queue-api"),
  fetchPpcQueue: jest.fn(),
  bulkApproveTasks: jest.fn(),
}));
jest.mock("../../_lib/ppc-client-filter-context", () => ({ usePpcClientFilter: jest.fn() }));
// The drawer fetches on open; it isn't under test here.
jest.mock("../drawer/TaskDrawer", () => ({ TaskDrawer: () => null }));

const mockFetch = fetchPpcQueue as jest.MockedFunction<typeof fetchPpcQueue>;
const mockClientFilter = usePpcClientFilter as jest.MockedFunction<typeof usePpcClientFilter>;

function page(offset: number, total = 1387) {
  return {
    rows: [
      {
        id: `TSK-${offset}`, title: "A task", clientId: "c1", clientName: "Acme",
        ruleId: "D5", band: "D", type: "investigate", status: "pending", confidence: "high",
        priorityScore: 1, impactMonthlyUsd: 10, impactBarFraction: 1, estMinutes: 15,
        blockedBy: null, assignee: null, createdAt: "2026-08-01T00:00:00Z",
      },
    ],
    total, limit: 50, offset,
  };
}

/** The offset the component asked the API for, on its most recent call. */
function lastRequestedOffset(): number | undefined {
  const calls = mockFetch.mock.calls;
  return calls[calls.length - 1]?.[0]?.offset;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockClientFilter.mockReturnValue({ clientId: "all" } as ReturnType<typeof usePpcClientFilter>);
});

describe("paging resets", () => {
  it("advances the requested offset when Next is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(page(0));
    render(<QueueView />);
    await waitFor(() => expect(screen.getByText("1–50 of 1,387")).toBeInTheDocument());

    mockFetch.mockResolvedValue(page(50));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastRequestedOffset()).toBe(50));
  });

  it("returns to page one when a dropdown filter changes", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(page(0));
    render(<QueueView />);
    await waitFor(() => expect(screen.getByText("1–50 of 1,387")).toBeInTheDocument());

    mockFetch.mockResolvedValue(page(50));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastRequestedOffset()).toBe(50));

    mockFetch.mockResolvedValue(page(0, 66));
    await user.selectOptions(screen.getByLabelText("Filter by type"), "negation");
    await waitFor(() => expect(lastRequestedOffset()).toBe(0));
  });

  it("returns to page one when the CLIENT filter changes", async () => {
    // The client filter comes from the top bar's context rather than the
    // dropdowns, so it bypasses applyFilters entirely — without its own
    // reset, switching client on page 5 strands you past the end.
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(page(0));
    const { rerender } = render(<QueueView />);
    await waitFor(() => expect(screen.getByText("1–50 of 1,387")).toBeInTheDocument());

    mockFetch.mockResolvedValue(page(50));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastRequestedOffset()).toBe(50));

    // Top bar switches client.
    mockClientFilter.mockReturnValue({ clientId: "client-2" } as ReturnType<typeof usePpcClientFilter>);
    mockFetch.mockResolvedValue(page(0, 20));
    rerender(<QueueView />);

    await waitFor(() => expect(lastRequestedOffset()).toBe(0));
  });
});

describe("empty states", () => {
  it("distinguishes an out-of-range page from a genuinely clear queue", async () => {
    mockFetch.mockResolvedValue({ rows: [], total: 1387, limit: 50, offset: 5000 });
    render(<QueueView />);
    await waitFor(() => expect(screen.getByText("Nothing on this page")).toBeInTheDocument());
    expect(screen.queryByText("Queue is clear")).not.toBeInTheDocument();
  });

  it("shows the clear-queue state only when the total really is zero", async () => {
    mockFetch.mockResolvedValue({ rows: [], total: 0, limit: 50, offset: 0 });
    render(<QueueView />);
    await waitFor(() => expect(screen.getByText("Queue is clear")).toBeInTheDocument());
  });

  it("offers to clear filters when a filtered set has no matches", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(page(0));
    render(<QueueView />);
    await waitFor(() => expect(screen.getByText("1–50 of 1,387")).toBeInTheDocument());

    mockFetch.mockResolvedValue({ rows: [], total: 0, limit: 50, offset: 0 });
    await user.selectOptions(screen.getByLabelText("Filter by type"), "budget");
    await waitFor(() => expect(screen.getByText("No tasks match these filters")).toBeInTheDocument());
  });
});
