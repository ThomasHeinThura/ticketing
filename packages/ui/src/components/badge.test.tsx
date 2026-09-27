import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Badge } from "./badge";

afterEach(() => {
  cleanup();
});

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>3</Badge>);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders as the element passed via render", () => {
    render(<Badge render={<a href="/labels">Bug</a>} />);
    expect(screen.getByRole("link", { name: "Bug" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(<Badge variant="success">Done</Badge>);
    await expectNoA11yViolations(baseElement);
  });
});
