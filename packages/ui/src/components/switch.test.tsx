import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Switch } from "./switch";

afterEach(() => {
  cleanup();
});

describe("Switch", () => {
  it("renders unchecked by default", () => {
    render(<Switch aria-label="Enable notifications" />);
    const toggle = screen.getByRole("switch", { name: "Enable notifications" });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("toggles checked state on click", () => {
    render(<Switch aria-label="Enable notifications" />);
    const toggle = screen.getByRole("switch", { name: "Enable notifications" });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("respects disabled", () => {
    render(<Switch aria-label="Enable notifications" disabled />);
    expect(
      screen.getByRole("switch", { name: "Enable notifications" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
