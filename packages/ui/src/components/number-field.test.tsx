import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "./number-field";

afterEach(() => {
  cleanup();
});

describe("NumberField", () => {
  it("increments and decrements the value via the group buttons", () => {
    const { container } = render(
      <NumberField aria-label="Quantity" defaultValue={5}>
        <NumberFieldGroup>
          <NumberFieldDecrement />
          <NumberFieldInput />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </NumberField>,
    );

    const input = container.querySelector<HTMLInputElement>(
      '[data-slot="number-field-input"]',
    );
    if (!input) throw new Error("number field input not found");

    fireEvent.click(screen.getByRole("button", { name: /increase/i }));
    expect(input).toHaveValue("6");

    fireEvent.click(screen.getByRole("button", { name: /decrease/i }));
    fireEvent.click(screen.getByRole("button", { name: /decrease/i }));
    expect(input).toHaveValue("4");
  });
});
