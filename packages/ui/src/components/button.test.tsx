import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a named button without accessibility violations", async () => {
    const { baseElement } = render(<Button>Save changes</Button>);

    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
  });
});
