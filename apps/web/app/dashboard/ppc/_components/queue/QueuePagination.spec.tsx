import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueuePagination } from "./QueuePagination";

const noop = () => {};

describe("QueuePagination", () => {
  it("states the visible range and the filtered total", () => {
    render(<QueuePagination total={1453} limit={50} offset={0} isBusy={false} onChange={noop} />);
    expect(screen.getByText("1–50 of 1,453")).toBeInTheDocument();
  });

  it("reports the range correctly on a later page", () => {
    render(<QueuePagination total={1453} limit={50} offset={100} isBusy={false} onChange={noop} />);
    expect(screen.getByText("101–150 of 1,453")).toBeInTheDocument();
  });

  it("clamps the last page's range to the total rather than overshooting", () => {
    render(<QueuePagination total={120} limit={50} offset={100} isBusy={false} onChange={noop} />);
    expect(screen.getByText("101–120 of 120")).toBeInTheDocument();
  });

  it("hides the controls when everything fits on one page", () => {
    render(<QueuePagination total={12} limit={50} offset={0} isBusy={false} onChange={noop} />);
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByText("1–12 of 12")).toBeInTheDocument();
  });

  it("says 'No tasks' rather than '0–0 of 0'", () => {
    render(<QueuePagination total={0} limit={50} offset={0} isBusy={false} onChange={noop} />);
    expect(screen.getByText("No tasks")).toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(
      <QueuePagination total={100} limit={50} offset={0} isBusy={false} onChange={noop} />,
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    rerender(<QueuePagination total={100} limit={50} offset={50} isBusy={false} onChange={noop} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("advances and rewinds by exactly one page", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const { rerender } = render(
      <QueuePagination total={1453} limit={50} offset={50} isBusy={false} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onChange).toHaveBeenCalledWith(100);

    rerender(<QueuePagination total={1453} limit={50} offset={50} isBusy={false} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("never rewinds past zero", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    // A limit larger than the current offset would compute a negative one.
    render(<QueuePagination total={200} limit={50} offset={20} isBusy={false} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("locks both controls while a refetch is in flight", () => {
    render(<QueuePagination total={1453} limit={50} offset={50} isBusy onChange={noop} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
