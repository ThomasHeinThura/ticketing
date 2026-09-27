import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Spinner } from "./spinner";

afterEach(cleanup);

describe("Spinner", () => {
  it("announces its loading status without accessibility violations", async () => {
    const { baseElement } = render(<Spinner />);

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
  });
});
