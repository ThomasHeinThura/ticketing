import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Timeline,
  TimelineContent,
  TimelineItem,
  TimelineTitle,
} from "./timeline";

afterEach(() => {
  cleanup();
});

describe("Timeline", () => {
  it("marks items up to the active step as completed", () => {
    render(
      <Timeline value={2}>
        <TimelineItem step={1} data-testid="step-1">
          <TimelineTitle>Step 1</TimelineTitle>
        </TimelineItem>
        <TimelineItem step={2} data-testid="step-2">
          <TimelineTitle>Step 2</TimelineTitle>
        </TimelineItem>
        <TimelineItem step={3} data-testid="step-3">
          <TimelineTitle>Step 3</TimelineTitle>
        </TimelineItem>
      </Timeline>,
    );

    expect(screen.getByTestId("step-1")).toHaveAttribute("data-completed");
    expect(screen.getByTestId("step-2")).toHaveAttribute("data-completed");
    expect(screen.getByTestId("step-3")).not.toHaveAttribute("data-completed");
  });

  it("throws when a Timeline part renders outside a Timeline", () => {
    // TimelineItem calls useTimeline(), which throws outside a <Timeline> provider.
    expect(() =>
      render(
        <TimelineItem step={1}>
          <TimelineContent>orphan</TimelineContent>
        </TimelineItem>,
      ),
    ).toThrow(/must be used within a Timeline/);
  });

  it("has no accessibility violations for a titled timeline", async () => {
    const { baseElement } = render(
      <section aria-labelledby="activity-title">
        <h2 id="activity-title">Activity</h2>
        <Timeline value={1}>
          <TimelineItem step={1}>
            <TimelineTitle>Request created</TimelineTitle>
            <TimelineContent>Initial details were added.</TimelineContent>
          </TimelineItem>
          <TimelineItem step={2}>
            <TimelineTitle>Assigned</TimelineTitle>
            <TimelineContent>The support team is reviewing it.</TimelineContent>
          </TimelineItem>
        </Timeline>
      </section>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
