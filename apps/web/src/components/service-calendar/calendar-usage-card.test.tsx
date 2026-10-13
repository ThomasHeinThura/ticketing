import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarUsageCard, usageIsInUse } from "./calendar-usage-card";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  mutateAsync: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock(
  "@/hooks/mutations/service-calendar/use-request-service-calendar-deletion",
  () => ({
    useRequestServiceCalendarDeletion: () => ({
      mutateAsync: mocks.mutateAsync,
      isPending: false,
    }),
  }),
);
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo },
}));

const unused = {
  projects: 0,
  slaPolicyVersions: 0,
  currentSlaPolicies: 0,
  workItems: 0,
};

function usageQuery(counts: typeof unused | undefined, isError = false) {
  return {
    data: counts ? { calendarId: "cal-1", counts } : undefined,
    isLoading: false,
    isError,
    refetch: vi.fn(),
  } as never;
}

describe("usageIsInUse", () => {
  it("is true when any live reference remains", () => {
    expect(usageIsInUse(unused)).toBe(false);
    expect(usageIsInUse({ ...unused, workItems: 1 })).toBe(true);
    expect(usageIsInUse({ ...unused, slaPolicyVersions: 1 })).toBe(true);
  });
});

describe("CalendarUsageCard", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.mutateAsync.mockReset();
    mocks.toastError.mockReset();
    mocks.toastInfo.mockReset();
  });

  it("blocks the deletion request while the calendar is referenced (CAL-9)", () => {
    render(
      <CalendarUsageCard
        calendarId="cal-1"
        usage={usageQuery({ ...unused, projects: 2 })}
        canManage
      />,
    );
    expect(screen.getByText("usage.inUse")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "usage.requestDeletion",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps deletion blocked when usage could not be loaded", () => {
    render(
      <CalendarUsageCard
        calendarId="cal-1"
        usage={usageQuery(undefined, true)}
        canManage
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("usage.loadError");
    expect(
      (
        screen.getByRole("button", {
          name: "usage.requestDeletion",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("hides deletion for readers", () => {
    render(
      <CalendarUsageCard
        calendarId="cal-1"
        usage={usageQuery(unused)}
        canManage={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "usage.requestDeletion" }),
    ).toBeNull();
  });

  it("requests deletion and opens the pending-action approval page", async () => {
    mocks.mutateAsync.mockResolvedValue({ pendingActionId: "pa 1" });
    render(
      <CalendarUsageCard
        calendarId="cal-1"
        usage={usageQuery(unused)}
        canManage
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "usage.requestDeletion" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "usage.confirmRequest" }),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/agent/settings/profile/pending-actions/$id",
        params: { id: "pa 1" },
      }),
    );
    expect(mocks.mutateAsync).toHaveBeenCalledWith("cal-1");
  });

  it("reports a refused request without navigating", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("Calendar is in use"));
    render(
      <CalendarUsageCard
        calendarId="cal-1"
        usage={usageQuery(unused)}
        canManage
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "usage.requestDeletion" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "usage.confirmRequest" }),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Calendar is in use"),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
