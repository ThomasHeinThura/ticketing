import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Skeleton } from "./skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("keeps decorative loading placeholders out of the accessibility tree", async () => {
    const { baseElement } = render(
      <Skeleton aria-hidden="true" data-testid="loading-placeholder" />,
    );

    expect(screen.getByTestId("loading-placeholder")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expectNoA11yViolations(baseElement);
  });
});
