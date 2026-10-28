import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeEntry, TimeEntryList } from "@/fetchers/time-tracking";

const mocks = vi.hoisted(() => ({
  getTimeEntries: vi.fn(),
  getTimer: vi.fn(),
  getTimeActivities: vi.fn(),
  createTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  requestTimeEntryDeletion: vi.fn(),
  openPendingAction: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "item" in options ? `${options.item} ${options.day}` : key,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/format", () => ({
  formatDate: (value: string) => value.slice(0, 10),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" }, isLoading: false }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({ default: vi.fn() }));
vi.mock("@/fetchers/time-tracking", () => {
  class TimeTrackingDisabledError extends Error {}
  class TimeRuleError extends Error {
    code = "x";
  }
  return {
    TimeTrackingDisabledError,
    TimeRuleError,
    getTimeEntries: (...args: unknown[]) => mocks.getTimeEntries(...args),
    getTimer: (...args: unknown[]) => mocks.getTimer(...args),
    getTimeActivities: (...args: unknown[]) => mocks.getTimeActivities(...args),
    createTimeEntry: (...args: unknown[]) => mocks.createTimeEntry(...args),
    updateTimeEntry: (...args: unknown[]) => mocks.updateTimeEntry(...args),
    requestTimeEntryDeletion: (...args: unknown[]) =>
      mocks.requestTimeEntryDeletion(...args),
    stopTimer: vi.fn(),
  };
});

import { Timesheet } from "./timesheet";

function entry(over: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "e1",
    workspaceId: "w1",
    projectId: "p1",
    workItemId: "wi1",
    workItemKey: "HELP-1",
    workItemTitle: "First",
    personId: "me",
    personName: "Me",
    date: "2026-10-19",
    minutes: 90,
    activityId: "dev",
    activityName: "Development",
    description: null,
    billable: true,
    source: "manual",
    needsReview: false,
    createdAt: "2026-10-19T08:00:00Z",
    updatedAt: "2026-10-19T08:00:00Z",
    ...over,
  };
}

function list(
  entries: TimeEntry[],
  over: Partial<TimeEntryList> = {},
): TimeEntryList {
  return {
    data: entries,
    totalMinutes: entries.reduce((sum, e) => sum + e.minutes, 0),
    callerPersonId: "me",
    canReadAny: false,
    canUpdateAny: false,
    canDeleteAny: false,
    canLogBackdated: false,
    backdateLimitDays: 30,
    timeZone: "UTC",
    today: "2026-10-21",
    ...over,
  } as TimeEntryList;
}

function renderSheet(search = { week: "2026-10-19" }) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Timesheet search={search} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

const cell = (item: string, day: string) =>
  screen.getByLabelText(`${item} ${day}`) as HTMLInputElement;

beforeEach(() => {
  mocks.getTimer.mockResolvedValue({
    timer: null,
    serverNow: "2026-10-21T10:00:00Z",
    capMinutes: 720,
  });
  mocks.getTimeActivities.mockResolvedValue([
    {
      id: "dev",
      workspaceId: "w1",
      name: "Development",
      position: 0,
      archived: false,
    },
  ]);
  mocks.getTimeEntries.mockImplementation(async (filter: { from?: string }) =>
    filter.from === "2026-10-19"
      ? list([entry(), entry({ id: "e2", date: "2026-10-20", minutes: 30 })])
      : list([]),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Timesheet grid", () => {
  it("shows the week's minutes per cell with day and week totals", async () => {
    renderSheet();
    await waitFor(() =>
      expect(cell("HELP-1", "2026-10-19").value).toBe("1:30"),
    );
    expect(cell("HELP-1", "2026-10-20").value).toBe("0:30");
    expect(cell("HELP-1", "2026-10-21").value).toBe("");
    const days = screen
      .getAllByTestId("timesheet-day-total")
      .map((node) => node.textContent);
    expect(days.slice(0, 3)).toEqual(["1:30", "0:30", "0:00"]);
    expect(screen.getByTestId("timesheet-week-total").textContent).toBe("2:00");
  });

  it("creates an entry from a typed duration and saves with Enter", async () => {
    mocks.createTimeEntry.mockResolvedValue(entry());
    renderSheet();
    await waitFor(() => cell("HELP-1", "2026-10-21"));
    const input = cell("HELP-1", "2026-10-21");
    fireEvent.change(input, { target: { value: "1h15" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.createTimeEntry).toHaveBeenCalledTimes(1));
    expect(mocks.createTimeEntry).toHaveBeenCalledWith({
      workspaceId: "w1",
      workItemId: "wi1",
      date: "2026-10-21",
      minutes: 75,
      activityId: "dev",
    });
  });

  it("updates a single entry with the new minutes and leaves an unchanged cell alone", async () => {
    mocks.updateTimeEntry.mockResolvedValue(entry());
    renderSheet();
    await waitFor(() => cell("HELP-1", "2026-10-19"));
    const input = cell("HELP-1", "2026-10-19");
    fireEvent.change(input, { target: { value: "2:00" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mocks.updateTimeEntry).toHaveBeenCalledWith("e1", {
        minutes: 120,
      }),
    );
    mocks.updateTimeEntry.mockClear();
    const same = cell("HELP-1", "2026-10-20");
    fireEvent.change(same, { target: { value: "30" } });
    fireEvent.blur(same);
    expect(mocks.updateTimeEntry).not.toHaveBeenCalled();
  });

  it("asks for a deletion, which still needs approval, when a logged cell is cleared", async () => {
    mocks.requestTimeEntryDeletion.mockResolvedValue({
      pendingActionId: "pa1",
    });
    renderSheet();
    await waitFor(() => cell("HELP-1", "2026-10-19"));
    const input = cell("HELP-1", "2026-10-19");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mocks.requestTimeEntryDeletion).toHaveBeenCalledWith("e1"),
    );
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa1",
      }),
    );
    expect(mocks.updateTimeEntry).not.toHaveBeenCalled();
  });

  it("refuses text that is not a duration without calling the API", async () => {
    renderSheet();
    await waitFor(() => cell("HELP-1", "2026-10-21"));
    const input = cell("HELP-1", "2026-10-21");
    fireEvent.change(input, { target: { value: "lots" } });
    fireEvent.blur(input);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "timeTracking:timesheet.invalid",
    );
    expect(mocks.createTimeEntry).not.toHaveBeenCalled();
  });

  it("moves between cells with the arrow keys", async () => {
    renderSheet();
    await waitFor(() => cell("HELP-1", "2026-10-19"));
    const first = cell("HELP-1", "2026-10-19");
    first.focus();
    // ArrowRight at the end of the text moves to the next day.
    first.setSelectionRange(first.value.length, first.value.length);
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell("HELP-1", "2026-10-20"));
  });

  it("does not take input for a day in the future or beyond the backdating window", async () => {
    renderSheet();
    await waitFor(() => cell("HELP-1", "2026-10-19"));
    expect(cell("HELP-1", "2026-10-22").disabled).toBe(true);
    expect(cell("HELP-1", "2026-10-21").disabled).toBe(false);
  });

  it("explains a feature that is switched off instead of an empty grid", async () => {
    const { TimeTrackingDisabledError } = await import(
      "@/fetchers/time-tracking"
    );
    mocks.getTimeEntries.mockRejectedValue(new TimeTrackingDisabledError());
    renderSheet();
    expect(
      await screen.findByText("timeTracking:timesheet.disabledTitle"),
    ).toBeTruthy();
  });
});
