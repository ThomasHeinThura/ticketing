import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { formatSlaRemaining, WorkItemSlaBadge } from "./work-item-sla-badge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(cleanup);

describe("formatSlaRemaining", () => {
  it("uses the shortest unit", () => {
    expect(formatSlaRemaining(0)).toBe("0m");
    expect(formatSlaRemaining(45)).toBe("45m");
    expect(formatSlaRemaining(59.6)).toBe("60m");
    expect(formatSlaRemaining(180)).toBe("3h");
    expect(formatSlaRemaining(60 * 24 * 2)).toBe("2d");
  });
});

describe("WorkItemSlaBadge (VW-16)", () => {
  it("renders nothing without an SLA", () => {
    const { container } = render(<WorkItemSlaBadge sla={undefined} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const second = render(<WorkItemSlaBadge sla={null} />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it("shows the remaining time for an open item and names the metric in the title", () => {
    render(
      <WorkItemSlaBadge
        sla={{ metric: "resolution", state: "at_risk", remainingMinutes: 90 }}
      />,
    );
    const badge = screen.getByTestId("work-item-sla-badge");
    expect(badge).toHaveTextContent("2h left");
    expect(badge).toHaveAttribute("data-sla-state", "at_risk");
    expect(badge).toHaveAttribute("title", "SLA resolution: At risk");
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("says the state in words when there is no clock to show", () => {
    for (const [state, text] of [
      ["breached", "Breached"],
      ["met", "Met"],
      ["missed", "Missed"],
    ] as const) {
      render(
        <WorkItemSlaBadge
          sla={{ metric: "first_response", state, remainingMinutes: 0 }}
        />,
      );
      expect(screen.getByTestId("work-item-sla-badge")).toHaveTextContent(text);
      cleanup();
    }
  });

  it("falls back to the state word for an open item with no remaining time", () => {
    render(
      <WorkItemSlaBadge
        sla={{ metric: "resolution", state: "ok", remainingMinutes: null }}
      />,
    );
    expect(screen.getByTestId("work-item-sla-badge")).toHaveTextContent(
      "On track",
    );
  });
});
