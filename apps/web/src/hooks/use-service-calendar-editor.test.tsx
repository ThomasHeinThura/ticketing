import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceCalendarConflictError } from "@/fetchers/service-calendar";
import { useServiceCalendarEditor } from "./use-service-calendar-editor";

const mocks = vi.hoisted(() => ({
  calendar: {
    id: "calendar-1",
    workspaceId: "calendar-workspace",
    name: "Original",
    timezone: "UTC",
    windows: { mon: [{ from: 540, to: 1020 }] },
    holidays: [],
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  } as Record<string, unknown>,
  refetchCalendar: vi.fn(),
  previewRefetch: vi.fn(),
  mutateAsync: vi.fn(),
  permissionWorkspaceIds: [] as Array<string | null>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({
    data: { id: "different-active-workspace" },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/queries/service-calendar/use-service-calendar", () => ({
  useServiceCalendar: () => ({
    data: mocks.calendar,
    isLoading: false,
    isError: false,
    refetch: mocks.refetchCalendar,
  }),
}));
vi.mock(
  "@/hooks/queries/service-calendar/use-service-calendar-preview",
  () => ({
    useServiceCalendarPreview: () => ({ refetch: mocks.previewRefetch }),
  }),
);
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (workspaceId: string | null) => {
    mocks.permissionWorkspaceIds.push(workspaceId);
    return {
      canManageServiceCalendars: () => true,
      isCheckingPermissions: false,
    };
  },
}));
vi.mock(
  "@/hooks/mutations/service-calendar/use-create-service-calendar",
  () => ({
    useCreateServiceCalendar: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  }),
);
vi.mock(
  "@/hooks/mutations/service-calendar/use-update-service-calendar",
  () => ({
    useUpdateServiceCalendar: () => ({
      mutateAsync: mocks.mutateAsync,
      isPending: false,
    }),
  }),
);
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function renderEditor() {
  return renderHook(() =>
    useServiceCalendarEditor({
      calendarId: "calendar-1",
      isNew: false,
      year: 2026,
      onCreated: vi.fn(),
    }),
  );
}

describe("service calendar editor optimistic-concurrency recovery", () => {
  beforeEach(() => {
    Object.assign(mocks.calendar, {
      name: "Original",
      version: 1,
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 1020 }] },
      holidays: [],
    });
    mocks.refetchCalendar.mockReset();
    mocks.previewRefetch.mockReset().mockResolvedValue({});
    mocks.mutateAsync.mockReset();
    mocks.permissionWorkspaceIds = [];
  });

  it("uses the row workspace, refreshes preview, and preserves/retries the draft with the new version", async () => {
    mocks.refetchCalendar.mockImplementation(async () => {
      Object.assign(mocks.calendar, { name: "Changed elsewhere", version: 2 });
      return { data: mocks.calendar };
    });
    mocks.mutateAsync
      .mockRejectedValueOnce(
        new ServiceCalendarConflictError("Version mismatch", 1, 2),
      )
      .mockResolvedValueOnce({
        ...mocks.calendar,
        name: "My draft",
        version: 3,
      });

    const { result } = renderEditor();
    await waitFor(() =>
      expect(result.current.form.getValues("name")).toBe("Original"),
    );
    expect(mocks.permissionWorkspaceIds).toContain("calendar-workspace");
    expect(mocks.permissionWorkspaceIds).not.toContain(
      "different-active-workspace",
    );

    act(() => result.current.form.setValue("name", "My draft"));
    await act(async () => {
      await result.current.handleSave({ name: "My draft", timezone: "UTC" });
    });
    expect(mocks.refetchCalendar).toHaveBeenCalledTimes(1);
    expect(mocks.previewRefetch).toHaveBeenCalledTimes(1);
    expect(result.current.calendarConflict).toEqual({
      assertedVersion: 1,
      currentVersion: 2,
    });
    expect(result.current.form.getValues("name")).toBe("My draft");

    act(() => result.current.keepDraft());
    expect(result.current.calendarConflict).toBeNull();
    await act(async () => {
      await result.current.handleSave({
        name: result.current.form.getValues("name"),
        timezone: "UTC",
      });
    });
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "calendar-1",
        version: 2,
        data: expect.objectContaining({ name: "My draft" }),
      }),
    );
  });

  it("reloads the latest values when the user discards the draft", async () => {
    mocks.refetchCalendar.mockImplementation(async () => {
      Object.assign(mocks.calendar, { name: "Latest saved", version: 2 });
      return { data: mocks.calendar };
    });
    mocks.mutateAsync.mockRejectedValueOnce(
      new ServiceCalendarConflictError("Version mismatch", 1, 2),
    );
    const { result } = renderEditor();
    await waitFor(() =>
      expect(result.current.form.getValues("name")).toBe("Original"),
    );
    act(() => result.current.form.setValue("name", "Draft"));
    await act(async () => {
      await result.current.handleSave({ name: "Draft", timezone: "UTC" });
    });
    act(() => result.current.reloadLatest());
    expect(result.current.form.getValues("name")).toBe("Latest saved");
    expect(result.current.calendarConflict).toBeNull();
  });
});
