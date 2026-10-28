import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import ScheduleViewState, { scheduleViewStatus } from "./schedule-view-state";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(cleanup);

describe("scheduleViewStatus (VW-7)", () => {
  it("never reports empty while loading or after an error", () => {
    expect(
      scheduleViewStatus({ isLoading: true, isError: false, isEmpty: true }),
    ).toBe("loading");
    expect(
      scheduleViewStatus({ isLoading: false, isError: true, isEmpty: true }),
    ).toBe("error");
    expect(
      scheduleViewStatus({ isLoading: false, isError: false, isEmpty: true }),
    ).toBe("empty");
    expect(
      scheduleViewStatus({ isLoading: false, isError: false, isEmpty: false }),
    ).toBe("ready");
  });
});

describe("ScheduleViewState", () => {
  it("shapes the calendar skeleton like a grid, not a list", () => {
    render(
      <ScheduleViewState
        layout="calendar"
        status="loading"
        isFiltered={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("calendar-loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("offers a retry on error", () => {
    const onRetry = vi.fn();
    render(
      <ScheduleViewState
        layout="calendar"
        status="error"
        isFiltered={false}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses layout copy for an empty project and filter copy for a filtered one", () => {
    const { rerender } = render(
      <ScheduleViewState
        layout="calendar"
        status="empty"
        isFiltered={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("calendar-empty")).toHaveTextContent(
      translate("tasks:calendar.noTasks"),
    );
    rerender(
      <ScheduleViewState
        layout="calendar"
        status="empty"
        isFiltered
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("calendar-empty")).toHaveTextContent(
      translate("workItems:list.emptyFilteredTitle"),
    );
  });
});
