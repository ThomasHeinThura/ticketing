import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Holiday } from "@/fetchers/service-calendar";
import { ServiceCalendarConflictError } from "@/fetchers/service-calendar";
import { useServiceCalendarEditor } from "./use-service-calendar-editor";

const mocks = vi.hoisted(() => ({
  calendar: {
    id: "calendar-1",
    workspaceId: "calendar-workspace",
    key: "support-hours",
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
  createCalendar: vi.fn(),
  permissionWorkspaceIds: [] as Array<string | undefined>,
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
vi.mock("@/hooks/queries/service-calendar/use-service-calendar-usage", () => ({
  useServiceCalendarUsage: () => ({ data: undefined, isLoading: true }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (workspaceId?: string) => {
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
      mutateAsync: mocks.createCalendar,
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

function renderEditor(isNew = false) {
  return renderHook(() =>
    useServiceCalendarEditor({
      calendarId: isNew ? "new" : "calendar-1",
      isNew,
      year: 2026,
      onCreated: vi.fn(),
    }),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("service calendar editor optimistic-concurrency recovery", () => {
  it.each<Holiday>([
    { date: "" },
    { from: "2026-12-31", to: "2026-12-30" },
    { recurs: "annually", month: 2, day: 30 },
  ])(
    "blocks invalid holiday drafts before confirmation or persistence: %j",
    async (holiday) => {
      const { result } = renderEditor();
      await waitFor(() =>
        expect(result.current.form.getValues("name")).toBe("Original"),
      );
      act(() => result.current.addHoliday());
      act(() => result.current.replaceHoliday(0, holiday));
      await act(async () => {
        await result.current.handleSave({
          key: "support-hours",
          name: "Original",
          timezone: "Europe/London",
        });
      });
      expect(result.current.holidayError).toBe("holidays.invalid");
      expect(result.current.timezoneConfirmationOpen).toBe(false);
      expect(mocks.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.createCalendar).not.toHaveBeenCalled();
    },
  );

  it("persists date-only holiday shapes unchanged with the current version", async () => {
    const { result } = renderEditor();
    await waitFor(() =>
      expect(result.current.form.getValues("name")).toBe("Original"),
    );
    const holidays: Holiday[] = [
      { date: "2028-02-29" },
      { from: "2026-12-31", to: "2027-01-01" },
      { recurs: "annually", month: 2, day: 29 },
    ];
    for (const [index, holiday] of holidays.entries()) {
      act(() => result.current.addHoliday());
      act(() => result.current.replaceHoliday(index, holiday));
    }
    mocks.mutateAsync.mockResolvedValue({
      ...mocks.calendar,
      holidays,
      version: 2,
    });
    await act(async () => {
      await result.current.handleSave({
        key: "support-hours",
        name: "Original",
        timezone: "UTC",
      });
    });
    expect(mocks.mutateAsync).toHaveBeenCalledExactlyOnceWith({
      id: "calendar-1",
      version: 1,
      data: expect.objectContaining({ holidays, timezone: "UTC" }),
    });
    expect(result.current.holidayError).toBe("");
  });
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
    mocks.createCalendar.mockReset().mockResolvedValue({
      ...mocks.calendar,
      id: "created-calendar",
    });
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
      await result.current.handleSave({
        key: "support-hours",
        name: "My draft",
        timezone: "UTC",
      });
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
        key: "support-hours",
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
    expect(mocks.mutateAsync.mock.calls[1]?.[0].data).not.toHaveProperty("key");
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
      await result.current.handleSave({
        key: "support-hours",
        name: "Draft",
        timezone: "UTC",
      });
    });
    act(() => result.current.reloadLatest());
    expect(result.current.form.getValues("name")).toBe("Latest saved");
    expect(result.current.calendarConflict).toBeNull();
  });

  it("keeps recovery actions blocked until a deferred conflict refresh returns fresh data", async () => {
    const refresh = deferred<{
      data: Record<string, unknown>;
      isError: boolean;
    }>();
    mocks.refetchCalendar.mockReturnValue(refresh.promise);
    mocks.mutateAsync.mockRejectedValueOnce(
      new ServiceCalendarConflictError("Version mismatch", 1, 2),
    );

    const { result } = renderEditor();
    await waitFor(() =>
      expect(result.current.form.getValues("name")).toBe("Original"),
    );
    act(() => result.current.form.setValue("name", "Keep this draft"));
    let saving: Promise<void> | undefined;
    act(() => {
      saving = result.current.handleSave({
        key: "support-hours",
        name: "Keep this draft",
        timezone: "UTC",
      });
    });
    await waitFor(() =>
      expect(result.current.conflictRefreshState).toBe("refreshing"),
    );

    act(() => {
      result.current.reloadLatest();
      result.current.keepDraft();
    });
    expect(result.current.calendarConflict).not.toBeNull();
    expect(result.current.form.getValues("name")).toBe("Keep this draft");

    const latest = {
      ...mocks.calendar,
      name: "Fresh from server",
      version: 2,
    };
    await act(async () => {
      refresh.resolve({ data: latest, isError: false });
      await saving;
    });
    expect(result.current.conflictRefreshState).toBe("ready");
    act(() => result.current.reloadLatest());
    expect(result.current.form.getValues("name")).toBe("Fresh from server");
    expect(result.current.calendarConflict).toBeNull();
  });

  it("keeps the draft and conflict after a failed refresh, then retries successfully", async () => {
    mocks.refetchCalendar
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        data: {
          ...mocks.calendar,
          name: "Fresh after retry",
          version: 2,
        },
        isError: false,
      });
    mocks.mutateAsync.mockRejectedValueOnce(
      new ServiceCalendarConflictError("Version mismatch", 1, 2),
    );

    const { result } = renderEditor();
    await waitFor(() =>
      expect(result.current.form.getValues("name")).toBe("Original"),
    );
    act(() => result.current.form.setValue("name", "Unsent draft"));
    await act(async () => {
      await result.current.handleSave({
        key: "support-hours",
        name: "Unsent draft",
        timezone: "UTC",
      });
    });

    expect(result.current.conflictRefreshState).toBe("error");
    expect(result.current.calendarConflict).not.toBeNull();
    act(() => {
      result.current.reloadLatest();
      result.current.keepDraft();
    });
    expect(result.current.calendarConflict).not.toBeNull();
    expect(result.current.form.getValues("name")).toBe("Unsent draft");

    await act(async () => {
      await result.current.refreshConflictState();
    });
    expect(result.current.conflictRefreshState).toBe("ready");
    act(() => result.current.reloadLatest());
    expect(result.current.form.getValues("name")).toBe("Fresh after retry");
    expect(result.current.calendarConflict).toBeNull();
  });

  it("requires a valid stable key on create and persists it only for creation", async () => {
    const { result } = renderEditor(true);
    await waitFor(() => expect(result.current.form).toBeDefined());

    act(() => {
      result.current.form.setValue("name", "Support hours");
      result.current.form.setValue("timezone", "UTC");
      result.current.form.setValue("key", "Invalid_Key");
    });
    await act(async () => {
      await result.current.form.handleSubmit(result.current.handleSave)();
    });
    expect(mocks.createCalendar).not.toHaveBeenCalled();
    expect(result.current.form.getFieldState("key").error?.message).toBe(
      "details.stableKeyInvalid",
    );

    act(() => result.current.form.setValue("key", "support_hours"));
    await act(async () => {
      await result.current.form.handleSubmit(result.current.handleSave)();
    });
    expect(mocks.createCalendar).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "different-active-workspace",
        key: "support_hours",
        name: "Support hours",
        timezone: "UTC",
      }),
    );
  });
});
