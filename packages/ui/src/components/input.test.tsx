import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Input } from "./input";

afterEach(() => {
  cleanup();
});

describe("Input", () => {
  it("forwards typing through onChange", () => {
    let value = "";
    render(
      <Input
        aria-label="Full name"
        onChange={(event) => {
          value = event.target.value;
        }}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Full name" }), {
      target: { value: "Jane Doe" },
    });
    expect(value).toBe("Jane Doe");
  });

  it("disables the control when disabled", () => {
    render(<Input aria-label="Full name" disabled />);
    expect(screen.getByRole("textbox", { name: "Full name" })).toBeDisabled();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Input aria-label="Full name" placeholder="Jane Doe" />,
    );

    await expectNoA11yViolations(baseElement);
  });
});
