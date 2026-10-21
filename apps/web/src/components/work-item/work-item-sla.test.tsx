import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkItemSla from "./work-item-sla";

const mocks = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-sla", () => ({
  default: () => mocks.query,
}));

describe("WorkItemSla", () => {
  it("shows both clocks with their states", () => {
    mocks.query = {
      isLoading: false,
      isError: false,
      data: {
        key: "HELP-7",
        metrics: [
          {
            metric: "first_response",
            state: "met",
            dueAt: null,
            consumedPct: 20,
            remainingMinutes: null,
          },
          {
            metric: "resolution",
            state: "at_risk",
            dueAt: "2026-09-16T00:00:00.000Z",
            consumedPct: 83,
            remainingMinutes: 240,
          },
        ],
      },
    };
    render(<WorkItemSla workItemKey="HELP-7" />);
    expect(screen.getByText("workItems:detail.sla.state.met")).toBeTruthy();
    expect(screen.getByText("workItems:detail.sla.state.at_risk")).toBeTruthy();
  });

  it("says when no SLA data is available", () => {
    mocks.query = { isLoading: false, isError: true, data: undefined };
    render(<WorkItemSla workItemKey="HELP-7" />);
    expect(screen.getByText("workItems:detail.sla.unavailable")).toBeTruthy();
  });
});
