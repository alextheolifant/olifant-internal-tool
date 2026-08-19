import { render, screen } from "@testing-library/react";
import { ImpactCell } from "./ImpactCell";

// The bar element is the only child with an inline width, so it's addressable
// without a test id polluting the component.
function barEl(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[style*='width']");
}

describe("ImpactCell", () => {
  it("renders an em-dash and NO bar when impact is null", () => {
    // The distinction that matters: a null impact must not draw a
    // zero-width bar, which would read as "measured, and it's nothing".
    const { container } = render(<ImpactCell impactMonthlyUsd={null} barFraction={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(barEl(container)).toBeNull();
  });

  it("renders a zero-width bar for a real zero impact", () => {
    // Genuinely $0 IS a measurement, so the bar exists at width 0.
    const { container } = render(<ImpactCell impactMonthlyUsd={0} barFraction={0} />);
    expect(barEl(container)).toHaveStyle({ width: "0%" });
  });

  it("uses the API's fraction verbatim rather than recomputing it", () => {
    const { container } = render(<ImpactCell impactMonthlyUsd={250} barFraction={0.42} />);
    expect(barEl(container)).toHaveStyle({ width: "42%" });
  });

  it("renders the figure with a /mo suffix", () => {
    render(<ImpactCell impactMonthlyUsd={1234} barFraction={1} />);
    expect(screen.getByText(/\/mo$/)).toBeInTheDocument();
  });

  it("clamps a fraction outside 0..1 so the fill can't overflow its track", () => {
    const { container: over } = render(<ImpactCell impactMonthlyUsd={10} barFraction={1.8} />);
    expect(barEl(over)).toHaveStyle({ width: "100%" });
    const { container: under } = render(<ImpactCell impactMonthlyUsd={10} barFraction={-0.5} />);
    expect(barEl(under)).toHaveStyle({ width: "0%" });
  });

  it("treats a missing fraction on a real figure as zero width, not a crash", () => {
    const { container } = render(<ImpactCell impactMonthlyUsd={10} barFraction={null} />);
    expect(barEl(container)).toHaveStyle({ width: "0%" });
  });
});
