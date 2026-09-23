import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
