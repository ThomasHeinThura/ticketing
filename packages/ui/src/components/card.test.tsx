import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { mountCompiledMotionStyles } from "../test/compile-motion-css";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

afterEach(() => {
  cleanup();
});

describe("Card", () => {
  it("renders header, content and footer together", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Work item #42</CardTitle>
          <CardDescription>Fix the login redirect</CardDescription>
        </CardHeader>
        <CardContent>Assigned to Priya.</CardContent>
        <CardFooter>Updated 2 hours ago</CardFooter>
      </Card>,
    );

    expect(screen.getByText("Work item #42")).toBeInTheDocument();
    expect(screen.getByText("Fix the login redirect")).toBeInTheDocument();
    expect(screen.getByText("Assigned to Priya.")).toBeInTheDocument();
    expect(screen.getByText("Updated 2 hours ago")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Card>
        <CardHeader>
          <CardTitle>Work item #42</CardTitle>
          <CardDescription>Fix the login redirect</CardDescription>
          <CardAction>
            <button type="button">Archive</button>
          </CardAction>
        </CardHeader>
        <CardContent>Assigned to Priya.</CardContent>
      </Card>,
    );

    await expectNoA11yViolations(baseElement);
  });

  it("leaves non-interactive cards unchanged even when rendered with a semantic tag", () => {
    const { container } = render(
      <Card render={<article />} tabIndex={0}>
        <CardContent>Static summary</CardContent>
      </Card>,
    );

    const card = container.querySelector('[data-slot="card"]');
    expect(card?.tagName).toBe("ARTICLE");
    expect(card).not.toHaveClass("press-feedback", "cursor-pointer");
    expect(card).not.toHaveAttribute("data-interactive");
    if (card) {
      fireEvent.keyDown(card, { key: "Enter" });
      fireEvent.keyDown(card, { key: " " });
      expect(card).not.toHaveAttribute("data-pressed");
    }
  });

  it("adds shared pointer and keyboard press feedback to interactive cards and suppresses scale when disabled or dragging", async () => {
    const styles = await mountCompiledMotionStyles([
      "press-feedback",
      "[--press-scale:0.98]",
      "transition-[color,background-color,border-color,box-shadow,scale]",
    ]);

    try {
      const { baseElement, rerender } = render(
        <Card
          interactive
          onKeyDown={(event) => {
            if (event.key === " ") event.preventDefault();
          }}
          render={<a href="/requests">Open requests</a>}
        />,
      );

      const link = screen.getByRole("link", { name: "Open requests" });
      expect(link).toHaveAttribute("data-slot", "card");
      expect(link).toHaveAttribute("data-interactive", "");
      expect(link).toHaveClass(
        "press-feedback",
        "[--press-scale:0.98]",
        "cursor-pointer",
      );
      expect(getComputedStyle(link).scale).toBe("none");
      expect(
        getComputedStyle(link).getPropertyValue("--tw-duration").trim(),
      ).toBe("var(--duration-fast)");
      expect(
        getComputedStyle(link).getPropertyValue("--press-scale").trim(),
      ).toMatch(/^0?\.98$/);

      // Keyboard Enter and Space activate instant press feedback and release in 0 ms.
      fireEvent.keyDown(link, { key: "Enter" });
      expect(link).toHaveAttribute("data-pressed", "");
      expect(getComputedStyle(link).scale).toMatch(
        /^var\(--press-scale,\s*0?\.97\)$/,
      );
      expect(
        getComputedStyle(link).getPropertyValue("--tw-duration").trim(),
      ).toMatch(/^0m?s$/);

      fireEvent.keyUp(link, { key: "Enter" });
      expect(link).not.toHaveAttribute("data-pressed");
      expect(getComputedStyle(link).scale).toBe("none");
      expect(
        getComputedStyle(link).getPropertyValue("--tw-duration").trim(),
      ).toMatch(/^0m?s$/);

      fireEvent.keyDown(link, { key: " " });
      expect(link).toHaveAttribute("data-pressed", "");
      fireEvent.blur(link);
      expect(link).not.toHaveAttribute("data-pressed");

      // Active drags suppress pressed scale against real compiled motion.css.
      rerender(
        <Card
          interactive
          data-dragging=""
          data-pressed=""
          render={<a href="/requests">Open requests</a>}
        />,
      );
      expect(getComputedStyle(link).scale).toBe("none");

      // Disabled interactive cards ignore keyboard activation and never scale.
      rerender(
        <Card
          interactive
          aria-disabled="true"
          render={<a href="/requests">Open requests</a>}
        />,
      );
      fireEvent.keyDown(link, { key: "Enter" });
      fireEvent.keyDown(link, { key: " " });
      expect(link).not.toHaveAttribute("data-pressed");
      expect(getComputedStyle(link).scale).toBe("none");

      await expectNoA11yViolations(baseElement);
    } finally {
      styles.cleanup();
    }
  });
});
