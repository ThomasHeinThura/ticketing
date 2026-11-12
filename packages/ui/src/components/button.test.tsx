import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { mountCompiledMotionStyles } from "../test/compile-motion-css";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a named button without accessibility violations", async () => {
    const { baseElement } = render(<Button>Save changes</Button>);

    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
  });

  it("shows instantaneous press feedback on Enter and Space and ignores disabled or loading buttons", async () => {
    const styles = await mountCompiledMotionStyles([
      "press-feedback",
      "transition-[box-shadow,scale]",
      "data-pressed:bg-primary/90",
    ]);

    try {
      const { rerender } = render(<Button>Save changes</Button>);
      const button = screen.getByRole("button", { name: "Save changes" });

      expect(getComputedStyle(button).scale).toBe("none");
      expect(
        getComputedStyle(button).getPropertyValue("--tw-duration").trim(),
      ).toBe("var(--duration-fast)");

      fireEvent.keyDown(button, { key: "Enter" });
      expect(button).toHaveAttribute("data-pressed", "");
      expect(button).toHaveAttribute("data-keyboard-press", "");
      expect(getComputedStyle(button).scale).toMatch(
        /^var\(--press-scale,\s*0?\.97\)$/,
      );
      expect(
        getComputedStyle(button).getPropertyValue("--tw-duration").trim(),
      ).toMatch(/^0m?s$/);

      fireEvent.keyUp(button, { key: "Enter" });
      expect(button).not.toHaveAttribute("data-pressed");
      expect(getComputedStyle(button).scale).toBe("none");
      // Release stays 0 ms for keyboard activation (plan rule 8: no keyboard animation).
      expect(
        getComputedStyle(button).getPropertyValue("--tw-duration").trim(),
      ).toMatch(/^0m?s$/);

      // A subsequent pointer interaction restores --duration-fast for pointer release.
      fireEvent.pointerDown(button);
      expect(button).not.toHaveAttribute("data-keyboard-press");
      expect(
        getComputedStyle(button).getPropertyValue("--tw-duration").trim(),
      ).toBe("var(--duration-fast)");

      fireEvent.keyDown(button, { key: " " });
      expect(button).toHaveAttribute("data-pressed", "");
      fireEvent.blur(button);
      expect(button).not.toHaveAttribute("data-pressed");

      // Preserves external data-pressed from Base UI popup triggers when idle.
      rerender(<Button data-pressed="">Open menu</Button>);
      expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute(
        "data-pressed",
        "",
      );

      // Disabled and loading controls never activate press feedback.
      rerender(<Button disabled>Save changes</Button>);
      const disabledButton = screen.getByRole("button", {
        name: "Save changes",
      });
      fireEvent.keyDown(disabledButton, { key: "Enter" });
      fireEvent.keyDown(disabledButton, { key: " " });
      expect(disabledButton).not.toHaveAttribute("data-pressed");
      expect(getComputedStyle(disabledButton).scale).toBe("none");

      rerender(<Button loading>Save changes</Button>);
      const loadingButton = screen.getByRole("button", {
        name: /Save changes/,
      });
      fireEvent.keyDown(loadingButton, { key: "Enter" });
      fireEvent.keyDown(loadingButton, { key: " " });
      expect(loadingButton).not.toHaveAttribute("data-pressed");
      expect(getComputedStyle(loadingButton).scale).toBe("none");
    } finally {
      styles.cleanup();
    }
  });
});
