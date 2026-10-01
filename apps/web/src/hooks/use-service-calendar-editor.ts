import type { DragEndEvent } from "@dnd-kit/core";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type {
  CalendarWindow,
  Holiday,
  Weekday,
} from "@/fetchers/service-calendar";
import { ServiceCalendarConflictError } from "@/fetchers/service-calendar";
import { useCreateServiceCalendar } from "@/hooks/mutations/service-calendar/use-create-service-calendar";
import { useUpdateServiceCalendar } from "@/hooks/mutations/service-calendar/use-update-service-calendar";
import { useServiceCalendar } from "@/hooks/queries/service-calendar/use-service-calendar";
import { useServiceCalendarPreview } from "@/hooks/queries/service-calendar/use-service-calendar-preview";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  type CalendarWindowsForm,
  copyCalendarWindows,
  emptyCalendarWindows,
  isValidIanaTimezone,
  timezoneChangeNeedsConfirmation,
  WEEKDAYS,
} from "@/lib/service-calendar-form";
import { toast } from "@/lib/toast";

export type CalendarMetadata = {
  name: string;
  timezone: string;
};

let nextFieldId = 0;

function createFieldId(): string {
  nextFieldId += 1;
  return `calendar-field-${nextFieldId}`;
}

export function useServiceCalendarEditor({
  calendarId,
  isNew,
  year,
  onCreated,
}: {
  calendarId: string;
  isNew: boolean;
  year: number;
  onCreated: (id: string, year: number) => Promise<void>;
}) {
  const { t } = useTranslation("serviceCalendars");
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const {
    data: calendar,
    isLoading: isCalendarLoading,
    isError: isCalendarError,
    refetch: refetchCalendar,
  } = useServiceCalendar(isNew ? "" : calendarId);
  const { canManageServiceCalendars, isCheckingPermissions } =
    useWorkspacePermission(
      isNew ? (workspace?.id ?? null) : (calendar?.workspaceId ?? null),
    );
  const preview = useServiceCalendarPreview(isNew ? "" : calendarId, year);
  const createCalendar = useCreateServiceCalendar();
  const updateCalendar = useUpdateServiceCalendar();
  const [windows, setWindows] =
    useState<CalendarWindowsForm>(emptyCalendarWindows);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [windowIds, setWindowIds] = useState<Record<Weekday, string[]>>({
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  });
  const [holidayIds, setHolidayIds] = useState<string[]>([]);
  const [windowError, setWindowError] = useState("");
  const [timezoneConfirmationOpen, setTimezoneConfirmationOpen] =
    useState(false);
  const [pendingSaveValues, setPendingSaveValues] =
    useState<CalendarMetadata | null>(null);
  const hydratedCalendarId = useRef<string | null>(null);
  const [calendarConflict, setCalendarConflict] = useState<{
    assertedVersion: number;
    currentVersion: number;
  } | null>(null);

  const metadataSchema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("details.nameRequired")).max(120),
        timezone: z
          .string()
          .trim()
          .min(1, t("details.timezoneRequired"))
          .refine(isValidIanaTimezone, t("details.timezoneInvalid")),
      }),
    [t],
  );
  const form = useForm<CalendarMetadata>({
    resolver: standardSchemaResolver(metadataSchema),
    mode: "onChange",
    defaultValues: { name: "", timezone: "" },
  });

  useEffect(() => {
    if (!calendar || hydratedCalendarId.current === calendar.id) return;
    hydratedCalendarId.current = calendar.id;
    form.reset({ name: calendar.name, timezone: calendar.timezone });
    setWindows(copyCalendarWindows(calendar.windows));
    setHolidays(calendar.holidays.map((holiday) => ({ ...holiday })));
    setWindowIds(
      Object.fromEntries(
        WEEKDAYS.map(({ key }) => [
          key,
          (calendar.windows[key] ?? []).map(() => createFieldId()),
        ]),
      ) as Record<Weekday, string[]>,
    );
    setHolidayIds(calendar.holidays.map(() => createFieldId()));
  }, [calendar, form]);

  async function persist(values: CalendarMetadata) {
    if (!canManageServiceCalendars()) {
      toast.error(t("editor.readOnlyDescription"));
      return;
    }
    const invalidWindow = WEEKDAYS.some(({ key }) =>
      windows[key].some((window) => window.from >= window.to),
    );
    if (invalidWindow) {
      setWindowError(t("weekly.windowInvalid"));
      return;
    }
    setWindowError("");

    const data = {
      name: values.name.trim(),
      timezone: values.timezone.trim(),
      windows,
      holidays,
    };

    try {
      if (isNew) {
        if (!workspace?.id) throw new Error(t("weekly.chooseWorkspace"));
        const created = await createCalendar.mutateAsync({
          workspaceId: workspace.id,
          ...data,
        });
        toast.success(t("weekly.created"));
        await onCreated(created.id, year);
      } else {
        const updated = await updateCalendar.mutateAsync({
          id: calendarId,
          version: calendar?.version ?? 1,
          data,
        });
        form.reset({ name: updated.name, timezone: updated.timezone });
        setCalendarConflict(null);
        toast.success(t("weekly.saved"));
      }
    } catch (error) {
      if (error instanceof ServiceCalendarConflictError) {
        setCalendarConflict({
          assertedVersion: error.assertedVersion,
          currentVersion: error.currentVersion,
        });
        await Promise.all([refetchCalendar(), preview.refetch()]);
        return;
      }
      toast.error(
        error instanceof Error ? error.message : t("weekly.saveFailed"),
      );
    }
  }

  async function handleSave(values: CalendarMetadata) {
    if (!canManageServiceCalendars()) {
      toast.error(t("editor.readOnlyDescription"));
      return;
    }
    if (
      timezoneChangeNeedsConfirmation(
        isNew,
        calendar?.timezone,
        values.timezone,
      )
    ) {
      setPendingSaveValues(values);
      setTimezoneConfirmationOpen(true);
      return;
    }
    await persist(values);
  }

  async function confirmTimezoneChange() {
    const values = pendingSaveValues;
    setTimezoneConfirmationOpen(false);
    setPendingSaveValues(null);
    if (values) await persist(values);
  }

  function cancelTimezoneChange() {
    setTimezoneConfirmationOpen(false);
    setPendingSaveValues(null);
  }

  function reloadLatest() {
    const latest = calendar;
    if (!latest) return;
    hydratedCalendarId.current = null;
    form.reset({ name: latest.name, timezone: latest.timezone });
    setWindows(copyCalendarWindows(latest.windows));
    setHolidays(latest.holidays.map((holiday) => ({ ...holiday })));
    setWindowIds(
      Object.fromEntries(
        WEEKDAYS.map(({ key }) => [
          key,
          (latest.windows[key] ?? []).map(() => createFieldId()),
        ]),
      ) as Record<Weekday, string[]>,
    );
    setHolidayIds(latest.holidays.map(() => createFieldId()));
    setCalendarConflict(null);
  }

  function keepDraft() {
    if (
      calendar &&
      calendar.version >=
        (calendarConflict?.currentVersion ?? Number.POSITIVE_INFINITY)
    )
      setCalendarConflict(null);
  }

  function updateWindow(
    day: Weekday,
    index: number,
    patch: Partial<CalendarWindow>,
  ) {
    setWindows((current) => ({
      ...current,
      [day]: current[day].map((window, itemIndex) =>
        itemIndex === index ? { ...window, ...patch } : window,
      ),
    }));
  }

  function handleWindowDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as
      | {
          day: Weekday;
          index: number;
          from: number;
          to: number;
          getTrackWidth: () => number;
        }
      | undefined;
    const trackWidth = data?.getTrackWidth();
    if (!data || !trackWidth || data.to <= data.from) return;

    const duration = data.to - data.from;
    const shift = Math.round((event.delta.x / trackWidth) * 1440);
    const from = Math.max(0, Math.min(1440 - duration, data.from + shift));
    updateWindow(data.day, data.index, { from, to: from + duration });
  }

  function addWindow(day: Weekday) {
    setWindows((current) => ({
      ...current,
      [day]: [...current[day], { from: 0, to: 0 }],
    }));
    setWindowIds((current) => ({
      ...current,
      [day]: [...current[day], createFieldId()],
    }));
  }

  function removeWindow(day: Weekday, index: number) {
    setWindows((current) => ({
      ...current,
      [day]: current[day].filter((_, itemIndex) => itemIndex !== index),
    }));
    setWindowIds((current) => ({
      ...current,
      [day]: current[day].filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function replaceHoliday(index: number, holiday: Holiday) {
    setHolidays((current) =>
      current.map((existing, itemIndex) =>
        itemIndex === index ? holiday : existing,
      ),
    );
  }

  function patchHoliday(index: number, patch: Partial<Holiday>) {
    setHolidays((current) =>
      current.map((holiday, itemIndex) =>
        itemIndex === index ? ({ ...holiday, ...patch } as Holiday) : holiday,
      ),
    );
  }

  function addHoliday() {
    setHolidays((current) => [...current, { date: "" }]);
    setHolidayIds((current) => [...current, createFieldId()]);
  }

  function removeHoliday(index: number) {
    setHolidays((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setHolidayIds((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  return {
    workspace,
    calendar,
    calendarConflict,
    reloadLatest,
    keepDraft,
    preview,
    form,
    windows,
    holidays,
    windowIds,
    holidayIds,
    windowError,
    saving: createCalendar.isPending || updateCalendar.isPending,
    canManageCalendars: canManageServiceCalendars(),
    isCheckingPermissions,
    loading: isWorkspaceLoading || (!isNew && isCalendarLoading),
    isCalendarError,
    refetchCalendar,
    handleSave,
    timezoneConfirmationOpen,
    confirmTimezoneChange,
    cancelTimezoneChange,
    handleWindowDragEnd,
    updateWindow,
    addWindow,
    removeWindow,
    addHoliday,
    replaceHoliday,
    patchHoliday,
    removeHoliday,
    hasCover: WEEKDAYS.some(({ key }) => windows[key].length > 0),
  };
}
