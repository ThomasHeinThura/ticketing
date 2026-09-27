import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { Kbd, KbdGroup, KbdSequence } from "./kbd";

afterEach(() => {
  cleanup();
});

describe("Kbd", () => {
  it("renders a sequence of keys with a separator", () => {
    render(<KbdSequence description="Save shortcut" keys={["Ctrl", "S"]} />);

    expect(screen.getByLabelText("Save shortcut")).toBeInTheDocument();
    expect(screen.getByText("Ctrl")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <KbdGroup aria-label="Command K">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>,
    );

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
