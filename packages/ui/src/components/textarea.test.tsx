import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Textarea } from "./textarea";

afterEach(cleanup);

describe("Textarea", () => {
  it("renders a labeled text field without accessibility violations", async () => {
    const { baseElement } = render(
      <Textarea aria-label="Description" placeholder="Add a description" />,
    );

    expect(
      screen.getByRole("textbox", { name: "Description" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
  });
});
