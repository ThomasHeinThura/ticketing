import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("renders no wrapper and no helper without the helper prop", () => {
    const { container } = render(<Switch aria-label="Enable notifications" />);
    expect(container.querySelector('[data-slot="switch-field"]')).toBeNull();
    expect(container.querySelector('[data-slot="switch-helper"]')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("data-slot", "switch");
  });

  it("uses the spring for the thumb and the duration tokens for the track", () => {
    render(<Switch aria-label="Enable notifications" />);
    const thumb = document.querySelector('[data-slot="switch-thumb"]');
    expect(thumb?.className).toContain("var(--ease-spring)");
    expect(thumb?.className).toContain("translate_var(--duration-base)");
    expect(thumb?.className).not.toMatch(/\.15s/);
    expect(screen.getByRole("switch").className).toContain("duration-base");
  });
});

describe("Switch helper text", () => {
  const helper = { checked: "God Mode is on", unchecked: "God Mode is off" };

  it("renders both lines in one grid cell so the height is reserved", () => {
    render(<Switch aria-label="God Mode" helper={helper} />);
    const lines = document.querySelectorAll('[data-slot="switch-helper-line"]');
    expect(lines).toHaveLength(2);
    expect(document.querySelector('[data-slot="switch-helper"]')).toHaveClass(
      "grid",
    );
    for (const line of lines) {
      expect(line).toHaveClass("col-start-1", "row-start-1");
    }
  });

  it("shows the unchecked line first and describes the switch with it", () => {
    render(<Switch aria-label="God Mode" helper={helper} />);
    const toggle = screen.getByRole("switch", { name: "God Mode" });
    const off = screen.getByText("God Mode is off");
    const on = screen.getByText("God Mode is on");
    expect(off).toHaveAttribute("data-active");
    expect(off).not.toHaveAttribute("inert");
    expect(on).not.toHaveAttribute("data-active");
    expect(on).toHaveAttribute("inert");
    expect(toggle).toHaveAttribute("aria-describedby", off.id);
  });

  it("swaps the active line and the description when toggled (uncontrolled)", () => {
    render(<Switch aria-label="God Mode" helper={helper} />);
    const toggle = screen.getByRole("switch", { name: "God Mode" });
    fireEvent.click(toggle);
    const on = screen.getByText("God Mode is on");
    const off = screen.getByText("God Mode is off");
    expect(on).toHaveAttribute("data-active");
    expect(off).toHaveAttribute("inert");
    expect(toggle).toHaveAttribute("aria-describedby", on.id);
  });

  it("follows a controlled checked prop and still forwards onCheckedChange", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Switch
        aria-label="God Mode"
        checked={false}
        helper={helper}
        onCheckedChange={onCheckedChange}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "God Mode" });
    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange.mock.calls[0][0]).toBe(true);
    // The parent refused the change, so the helper stays on the "off" line.
    expect(screen.getByText("God Mode is off")).toHaveAttribute("data-active");
    rerender(
      <Switch
        aria-label="God Mode"
        checked
        helper={helper}
        onCheckedChange={onCheckedChange}
      />,
    );
    expect(screen.getByText("God Mode is on")).toHaveAttribute("data-active");
  });

  it("starts on the checked line for defaultChecked and keeps a caller description", () => {
    render(
      <>
        <span id="extra">Extra</span>
        <Switch
          aria-describedby="extra"
          aria-label="God Mode"
          defaultChecked
          helper={helper}
        />
      </>,
    );
    const on = screen.getByText("God Mode is on");
    expect(on).toHaveAttribute("data-active");
    expect(screen.getByRole("switch")).toHaveAttribute(
      "aria-describedby",
      `extra ${on.id}`,
    );
  });

  it("keeps the uncontrolled switch and helper line in sync when onCheckedChange cancels the change", () => {
    const onCheckedChange = vi.fn(
      (_next: boolean, eventDetails: { cancel: () => void }) => {
        eventDetails.cancel();
      },
    );
    render(
      <Switch
        aria-label="God Mode"
        helper={helper}
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "God Mode" });
    const off = screen.getByText("God Mode is off");
    const on = screen.getByText("God Mode is on");

    fireEvent.click(toggle);

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange.mock.calls[0][0]).toBe(true);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(off).toHaveAttribute("data-active");
    expect(off).not.toHaveAttribute("inert");
    expect(on).not.toHaveAttribute("data-active");
    expect(on).toHaveAttribute("inert");
    expect(toggle).toHaveAttribute("aria-describedby", off.id);
  });

  it("describes nothing when the active state has no helper text", () => {
    render(<Switch aria-label="God Mode" helper={{ checked: "On" }} />);
    expect(screen.getByRole("switch")).not.toHaveAttribute("aria-describedby");
  });
});
