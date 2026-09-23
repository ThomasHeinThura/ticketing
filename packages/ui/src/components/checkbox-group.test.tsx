import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";
import { CheckboxGroup } from "./checkbox-group";

afterEach(() => {
  cleanup();
});

describe("CheckboxGroup", () => {
  it("tracks which checkboxes are checked via onValueChange", () => {
    const values: string[][] = [];
    render(
      <CheckboxGroup
        defaultValue={[]}
        onValueChange={(value) => values.push(value as string[])}
      >
        <Checkbox aria-label="Alpha" value="alpha" />
        <Checkbox aria-label="Beta" value="beta" />
      </CheckboxGroup>,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(values.at(-1)).toEqual(["alpha"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
    expect(values.at(-1)).toEqual(["alpha", "beta"]);
  });
});
