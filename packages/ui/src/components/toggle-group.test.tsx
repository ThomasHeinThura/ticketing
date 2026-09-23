import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

afterEach(() => {
  cleanup();
});

describe("ToggleGroup", () => {
  it("tracks which item is pressed in single-selection mode", () => {
    const values: string[] = [];
    render(
      <ToggleGroup
        defaultValue={["left"]}
        onValueChange={(value) => values.push(...(value as string[]))}
        toggleMultiple={false}
      >
        <ToggleGroupItem aria-label="Align left" value="left">
          L
        </ToggleGroupItem>
        <ToggleGroupItem aria-label="Align right" value="right">
          R
        </ToggleGroupItem>
      </ToggleGroup>,
    );

    const left = screen.getByRole("button", { name: "Align left" });
    const right = screen.getByRole("button", { name: "Align right" });
    expect(left).toHaveAttribute("aria-pressed", "true");
    expect(right).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(right);
    expect(right).toHaveAttribute("aria-pressed", "true");
    expect(left).toHaveAttribute("aria-pressed", "false");
  });
});
