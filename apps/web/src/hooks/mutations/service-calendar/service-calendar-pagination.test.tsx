import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceCalendar } from "@/fetchers/service-calendar";
import { useCreateServiceCalendar } from "./use-create-service-calendar";
import { useUpdateServiceCalendar } from "./use-update-service-calendar";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/fetchers/service-calendar", () => ({
  createServiceCalendar: mocks.create,
  updateServiceCalendar: mocks.update,
}));

const calendar: ServiceCalendar = {
  id: "calendar-1",
  workspaceId: "workspace-1",
  name: "Coverage",
  timezone: "UTC",
  windows: { mon: [{ from: 540, to: 1020 }] },
  holidays: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  version: 1,
};

function wrapperWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, Wrapper };
}

describe("service-calendar paginated list cache", () => {
  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue(calendar);
    mocks.update.mockReset().mockResolvedValue(calendar);
  });

  it("invalidates every page after create or update", async () => {
    const { queryClient, Wrapper } = wrapperWithClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const created = renderHook(() => useCreateServiceCalendar(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await created.result.current.mutateAsync({
        workspaceId: calendar.workspaceId,
        name: calendar.name,
        timezone: calendar.timezone,
        windows: calendar.windows,
        holidays: calendar.holidays,
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["service-calendars", calendar.workspaceId],
    });

    invalidate.mockClear();
    const updated = renderHook(() => useUpdateServiceCalendar(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await updated.result.current.mutateAsync({
        id: calendar.id,
        version: calendar.version,
        data: {
          name: calendar.name,
          timezone: calendar.timezone,
          windows: calendar.windows,
          holidays: calendar.holidays,
        },
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["service-calendars", calendar.workspaceId],
    });
  });
});
