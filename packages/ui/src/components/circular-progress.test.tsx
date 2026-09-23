import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CircularProgress } from "./circular-progress";

afterEach(() => {
  cleanup();
});

describe("CircularProgress", () => {
  it("draws only the track circle when there is nothing to track (total 0)", () => {
    const { container } = render(<CircularProgress completed={0} total={0} />);
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(1);
  });

  it("draws a fully-offset progress circle when nothing is completed yet", () => {
    const { container } = render(<CircularProgress completed={0} total={4} />);
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(2);
    const progress = circles[1];
    const circumference = 2 * Math.PI * ((16 - 2) / 2);
    expect(Number(progress.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      circumference,
      5,
    );
  });

  it("draws a progress circle sized to the completed fraction", () => {
    const { container } = render(<CircularProgress completed={2} total={4} />);
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(2);

    const [track, progress] = circles;
    const circumference = 2 * Math.PI * ((16 - 2) / 2);
    expect(progress.getAttribute("stroke-dasharray")).toBe(
      String(circumference),
    );
    expect(Number(progress.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      circumference * 0.5,
      5,
    );
    expect(progress).toHaveClass("text-primary");
    expect(track).not.toHaveClass("text-primary");
  });

  it("marks the progress circle complete when completed equals total", () => {
    const { container } = render(<CircularProgress completed={3} total={3} />);
    const progress = container.querySelectorAll("circle")[1];
    expect(progress).toHaveClass("text-success-foreground");
    expect(Number(progress.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      0,
      5,
    );
  });
});
