import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
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
      <Card render={<article />}>
        <CardContent>Static summary</CardContent>
      </Card>,
    );

    const card = container.querySelector('[data-slot="card"]');
    expect(card?.tagName).toBe("ARTICLE");
    expect(card).not.toHaveClass("press-feedback", "cursor-pointer");
    expect(card).not.toHaveAttribute("data-interactive");
  });

  it("adds shared press feedback to explicitly interactive cards and suppresses press scale while dragging", async () => {
    const style = document.createElement("style");
    style.textContent = `
      .press-feedback {
        --tw-duration: 120ms;
      }
      .press-feedback[data-pressed] {
        --tw-duration: 0ms;
        scale: var(--press-scale, 0.97);
      }
      .press-feedback[data-dragging] {
        scale: none;
      }
    `;
    document.head.appendChild(style);

    try {
      const { baseElement, rerender } = render(
        <Card
          interactive
          data-pressed=""
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
      expect(getComputedStyle(link).scale).toBe("var(--press-scale, 0.97)");

      rerender(
        <Card
          interactive
          data-dragging=""
          data-pressed=""
          render={<a href="/requests">Open requests</a>}
        />,
      );
      expect(getComputedStyle(link).scale).toBe("none");

      await expectNoA11yViolations(baseElement);
    } finally {
      style.remove();
    }
  });
});
