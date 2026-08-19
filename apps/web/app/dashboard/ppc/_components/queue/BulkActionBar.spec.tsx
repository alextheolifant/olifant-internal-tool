import { render, screen } from "@testing-library/react";
import type { BulkApproveResponse } from "../../_lib/ppc-queue-api";
import { BulkActionBar, BulkResultBanner } from "./BulkActionBar";

const noop = () => {};

describe("BulkActionBar", () => {
  it("stays hidden with nothing selected", () => {
    const { container } = render(
      <BulkActionBar count={0} lockedType="negation" isSubmitting={false} onApprove={noop} onClear={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the locked type and pluralises the count", () => {
    render(<BulkActionBar count={1} lockedType="negation" isSubmitting={false} onApprove={noop} onClear={noop} />);
    expect(screen.getByText("1 negation selected")).toBeInTheDocument();
  });

  it("pluralises correctly above one", () => {
    render(<BulkActionBar count={5} lockedType="bid_change" isSubmitting={false} onApprove={noop} onClear={noop} />);
    expect(screen.getByText("5 bid changes selected")).toBeInTheDocument();
  });

  it("disables the button while submitting so a batch can't be double-sent", () => {
    render(<BulkActionBar count={2} lockedType="negation" isSubmitting onApprove={noop} onClear={noop} />);
    expect(screen.getByRole("button", { name: /Approving/ })).toBeDisabled();
  });
});

function result(over: Partial<BulkApproveResponse> = {}): BulkApproveResponse {
  return { approved: 2, failed: 0, results: [], ...over };
}

describe("BulkResultBanner", () => {
  it("reports a clean success", () => {
    render(<BulkResultBanner result={result()} onDismiss={noop} />);
    expect(screen.getByText("Approved 2 tasks.")).toBeInTheDocument();
  });

  it("reports a total failure without claiming anything was approved", () => {
    render(
      <BulkResultBanner
        result={result({ approved: 0, failed: 2, results: [
          { id: "TSK-1", ok: false, status: "verified", error: "Invalid task status transition: verified → approved" },
          { id: "TSK-2", ok: false, status: null, error: "not found" },
        ] })}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText("Nothing was approved — 2 tasks failed.")).toBeInTheDocument();
  });

  it("shows a PARTIAL outcome as partial, listing each failure", () => {
    // The case the brief singles out: a blanket success/failure message
    // would leave the user unsure which rows actually moved.
    render(
      <BulkResultBanner
        result={result({ approved: 1, failed: 2, results: [
          { id: "TSK-OK", ok: true, status: "approved", error: null },
          { id: "TSK-BAD", ok: false, status: "verified", error: "Invalid task status transition: verified → approved" },
          { id: "TSK-GONE", ok: false, status: null, error: "not found" },
        ] })}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText("Approved 1, 2 failed.")).toBeInTheDocument();
    expect(screen.getByText(/TSK-BAD/)).toBeInTheDocument();
    expect(screen.getByText(/verified → approved/)).toBeInTheDocument();
    expect(screen.getByText(/TSK-GONE/)).toBeInTheDocument();
    // Successful ids aren't listed — only what needs attention.
    expect(screen.queryByText(/TSK-OK/)).not.toBeInTheDocument();
  });
});
