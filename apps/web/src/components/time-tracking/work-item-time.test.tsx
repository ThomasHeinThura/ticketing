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
import type { WorkItemDetailRow } from "@/types/work-item";

const mocks = vi.hoisted(() => ({
  getTimeEntries: vi.fn(),
  getTimer: vi.fn(),
  getTimeActivities: vi.fn(),
  createTimeEntry: vi.fn(),
  startTimer: vi.fn(),
  requestTimeEntryDeletion: vi.fn(),
  openPendingAction: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: unknown) => String(value),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/fetchers/time-tracking", () => {
  class TimeRuleError extends Error {
    code = "x";
  }
  return {
    TimeRuleError,
    TimeTrackingDisabledError: class extends Error {},
    getTimeEntries: (...args: unknown[]) => mocks.getTimeEntries(...args),
    getTimer: (...args: unknown[]) => mocks.getTimer(...args),
    getTimeActivities: (...args: unknown[]) => mocks.getTimeActivities(...args),
    createTimeEntry: (...args: unknown[]) => mocks.createTimeEntry(...args),
    startTimer: (...args: unknown[]) => mocks.startTimer(...args),
    requestTimeEntryDeletion: (...args: unknown[]) =>
      mocks.requestTimeEntryDeletion(...args),
    updateTimeEntry: vi.fn(),
    stopTimer: vi.fn(),
  };
});

import WorkItemTime from "./work-item-time";

const item = {
  id: "wi1",
  workspaceId: "w1",
  key: "HELP-1",
} as WorkItemDetailRow;

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
    date: "2026-10-21",
    minutes: 90,
    activityId: "dev",
    activityName: "Development",
    description: "Reproduced it",
    billable: true,
    source: "manual",
    needsReview: false,
    createdAt: "2026-10-21T08:00:00Z",
    updatedAt: "2026-10-21T08:00:00Z",
    ...over,
  };
}

function list(entries: TimeEntry[], over: Partial<TimeEntryList> = {}) {
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

function renderSection() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WorkItemTime item={item} />
    </QueryClientProvider>,
  );
}

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
  mocks.getTimeEntries.mockResolvedValue(list([entry()]));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkItemTime", () => {
  it("lists the entries with the total in h:mm", async () => {
    renderSection();
    expect(await screen.findAllByTestId("time-entry-row")).toHaveLength(1);
    expect(screen.getAllByText("1:30").length).toBeGreaterThan(0);
    expect(screen.getByText("Reproduced it")).toBeTruthy();
  });

  it("logs time from a typed duration against this work item", async () => {
    mocks.createTimeEntry.mockResolvedValue(entry());
    renderSection();
    const duration = await screen.findByLabelText(
      "timeTracking:fields.duration",
    );
    fireEvent.change(duration, { target: { value: "45m" } });
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:section.add" }),
    );
    await waitFor(() => expect(mocks.createTimeEntry).toHaveBeenCalledTimes(1));
    expect(mocks.createTimeEntry).toHaveBeenCalledWith({
      workspaceId: "w1",
      workItemId: "wi1",
      date: "2026-10-21",
      minutes: 45,
      activityId: "dev",
    });
  });

  it("will not log text that is not a duration", async () => {
    renderSection();
    const duration = await screen.findByLabelText(
      "timeTracking:fields.duration",
    );
    fireEvent.change(duration, { target: { value: "soon" } });
    const add = screen.getByRole("button", {
      name: "timeTracking:section.add",
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });

  it("starts the timer on this item", async () => {
    mocks.startTimer.mockResolvedValue({
      timer: null,
      serverNow: "",
      capMinutes: 720,
    });
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "timeTracking:timer.start" }),
    );
    await waitFor(() => expect(mocks.startTimer).toHaveBeenCalledTimes(1));
    expect(mocks.startTimer.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "w1",
      workItemId: "wi1",
      activityId: "dev",
    });
  });

  it("offers edit and delete on someone else's entry only with the _any capabilities", async () => {
    const theirs = entry({ id: "e2", personId: "other", personName: "Other" });
    mocks.getTimeEntries.mockResolvedValue(
      list([theirs], { canReadAny: true }),
    );
    const view = renderSection();
    await screen.findAllByTestId("time-entry-row");
    expect(screen.queryByLabelText("timeTracking:entry.edit")).toBeNull();
    expect(screen.queryByLabelText("timeTracking:entry.delete")).toBeNull();
    view.unmount();
    mocks.getTimeEntries.mockResolvedValue(
      list([theirs], {
        canReadAny: true,
        canUpdateAny: true,
        canDeleteAny: true,
      }),
    );
    renderSection();
    expect(
      await screen.findByLabelText("timeTracking:entry.edit"),
    ).toBeTruthy();
    expect(screen.getByLabelText("timeTracking:entry.delete")).toBeTruthy();
  });

  it("deleting an entry opens the pending-action approval rather than removing it", async () => {
    mocks.requestTimeEntryDeletion.mockResolvedValue({
      pendingActionId: "pa1",
    });
    renderSection();
    fireEvent.click(await screen.findByLabelText("timeTracking:entry.delete"));
    await waitFor(() =>
      expect(mocks.requestTimeEntryDeletion).toHaveBeenCalledWith("e1"),
    );
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa1",
      }),
    );
  });

  it("flags a capped entry for review", async () => {
    mocks.getTimeEntries.mockResolvedValue(
      list([entry({ needsReview: true })]),
    );
    renderSection();
    expect(await screen.findByText("timeTracking:review.badge")).toBeTruthy();
  });
});
