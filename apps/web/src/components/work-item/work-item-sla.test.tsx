import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import WorkItemSla, { formatSlaInstant } from "./work-item-sla";

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

  it("marks an at-risk bar and shows the due instant with its timezone", () => {
    mocks.query = {
      isLoading: false,
      isError: false,
      data: {
        key: "HELP-7",
        metrics: [
          {
            metric: "first_response",
            state: "none",
            dueAt: null,
            consumedPct: 0,
            remainingMinutes: null,
          },
          {
            metric: "resolution",
            state: "at_risk",
            dueAt: "2026-09-16T10:30:00.000Z",
            consumedPct: 83,
            remainingMinutes: 240,
          },
        ],
      },
    };
    render(<WorkItemSla workItemKey="HELP-7" />);
    expect(screen.getByTestId("work-item-sla-at-risk")).toBeTruthy();
    expect(screen.queryByTestId("work-item-sla-paused")).toBeNull();
    const instant = formatSlaInstant("2026-09-16T10:30:00.000Z");
    expect(instant).toMatch(/\d{1,2}:\d{2}/u);
    // The last token is the viewer's zone (`UTC`, `GMT+7`, `PDT`...), never omitted.
    expect(instant.split(" ").at(-1)?.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the open pause with its reason and start once the API returns pauses", () => {
    mocks.query = {
      isLoading: false,
      isError: false,
      data: {
        key: "HELP-7",
        pauses: [
          {
            metric: "resolution",
            startedAt: "2026-09-15T08:00:00.000Z",
            endedAt: null,
            reason: "waiting_customer",
          },
          {
            metric: "first_response",
            startedAt: "2026-09-14T08:00:00.000Z",
            endedAt: "2026-09-14T09:00:00.000Z",
            reason: "manual",
          },
        ],
        metrics: [
          {
            metric: "first_response",
            state: "ok",
            dueAt: null,
            consumedPct: 10,
            remainingMinutes: 100,
          },
          {
            metric: "resolution",
            state: "ok",
            dueAt: null,
            consumedPct: 10,
            remainingMinutes: 100,
          },
        ],
      },
    };
    render(<WorkItemSla workItemKey="HELP-7" />);
    expect(screen.getAllByTestId("work-item-sla-paused")).toHaveLength(1);
  });

  it("shows the calendar name and a positional at-risk marker on the track (SLA-13, SLA-19)", () => {
    mocks.query = {
      isLoading: false,
      isError: false,
      data: {
        key: "HELP-7",
        calendarName: "Support hours",
        atRiskThresholdPct: 75,
        pauses: [],
        metrics: [
          {
            metric: "first_response",
            state: "ok",
            dueAt: null,
            consumedPct: 10,
            remainingMinutes: 100,
          },
          {
            metric: "resolution",
            state: "ok",
            dueAt: null,
            consumedPct: 20,
            remainingMinutes: 100,
          },
        ],
      },
    };
    render(<WorkItemSla workItemKey="HELP-7" />);
    expect(screen.getByTestId("work-item-sla-calendar").textContent).toBe(
      "workItems:detail.sla.calendar",
    );
    const markers = screen.getAllByTestId("work-item-sla-threshold-marker");
    expect(markers).toHaveLength(2);
    expect((markers[0] as HTMLElement).style.left).toBe("75%");
    // Not at risk yet: the marker is there, the warning line is not.
    expect(screen.queryByTestId("work-item-sla-at-risk")).toBeNull();
  });

  it("renders the clocks alone when the extra fields are absent or null", () => {
    mocks.query = {
      isLoading: false,
      isError: false,
      data: {
        key: "HELP-7",
        calendarName: null,
        atRiskThresholdPct: null,
        metrics: [
          {
            metric: "first_response",
            state: "ok",
            dueAt: null,
            consumedPct: 10,
            remainingMinutes: 100,
          },
          {
            metric: "resolution",
            state: "at_risk",
            dueAt: null,
            consumedPct: 80,
            remainingMinutes: 10,
          },
        ],
      },
    };
    render(<WorkItemSla workItemKey="HELP-7" />);
    expect(screen.queryByTestId("work-item-sla-calendar")).toBeNull();
    expect(screen.queryByTestId("work-item-sla-threshold-marker")).toBeNull();
    expect(screen.queryByTestId("work-item-sla-paused")).toBeNull();
    expect(screen.getByTestId("work-item-sla-at-risk")).toBeTruthy();
  });

  it("is not shown at all when the route answers 404 (feature.sla off, P4R1-M2)", () => {
    mocks.query = {
      isLoading: false,
      isError: true,
      error: new HttpError(404, "Failed to load the work item SLA"),
      data: undefined,
    };
    const { container } = render(<WorkItemSla workItemKey="HELP-7" />);
    expect(container.querySelector("[data-testid='work-item-sla']")).toBeNull();
  });

  it("says when no SLA data is available", () => {
    mocks.query = { isLoading: false, isError: true, data: undefined };
    render(<WorkItemSla workItemKey="HELP-7" />);
    expect(screen.getByText("workItems:detail.sla.unavailable")).toBeTruthy();
  });
});
