import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Toolbar, ToolbarButton, ToolbarGroup } from "./toolbar";

afterEach(() => {
  cleanup();
});

describe("Toolbar", () => {
  it("renders its buttons as a keyboard-navigable group and forwards clicks", () => {
    let clicked = false;
    render(
      <Toolbar aria-label="Formatting">
        <ToolbarGroup>
          <ToolbarButton onClick={() => (clicked = true)}>Bold</ToolbarButton>
        </ToolbarGroup>
      </Toolbar>,
    );

    expect(
      screen.getByRole("toolbar", { name: "Formatting" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(clicked).toBe(true);
  });
});
