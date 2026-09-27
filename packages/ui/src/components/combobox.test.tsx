import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxInput,
} from "./combobox";

afterEach(() => {
  cleanup();
});

describe("Combobox", () => {
  it("renders the clear button with the caller-supplied accessible name", () => {
    render(
      <Combobox defaultValue="Apple" items={["Apple", "Banana"]}>
        <ComboboxInput
          aria-label="Fruit"
          clearLabel="Clear selection"
          showClear
        />
      </Combobox>,
    );

    expect(
      screen.getByRole("button", { name: "Clear selection" }),
    ).toBeInTheDocument();
  });

  it("renders the trigger button with a default accessible name", () => {
    render(
      <Combobox items={["Apple", "Banana"]}>
        <ComboboxInput aria-label="Fruit" showTrigger />
      </Combobox>,
    );

    expect(
      screen.getByRole("button", { name: "Toggle options" }),
    ).toBeInTheDocument();
  });

  it("renders each chip's remove button with the caller-supplied accessible name", () => {
    render(
      <Combobox defaultValue={["Apple"]} items={["Apple", "Banana"]} multiple>
        <ComboboxChips>
          <ComboboxChip removeLabel="Remove Apple">Apple</ComboboxChip>
        </ComboboxChips>
      </Combobox>,
    );

    expect(
      screen.getByRole("button", { name: "Remove Apple" }),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Combobox defaultValue="Apple" items={["Apple", "Banana"]}>
        <ComboboxInput
          aria-label="Fruit"
          clearLabel="Clear selection"
          showClear
        />
      </Combobox>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
