import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertTitle,
  Button,
  Skeleton,
} from "@taskdesk/ui";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import PageTitle from "@/components/page-title";
import { CalendarDetailsCard } from "@/components/service-calendar/calendar-details-card";
import { CoveragePreviewCard } from "@/components/service-calendar/coverage-preview-card";
import { HolidayListCard } from "@/components/service-calendar/holiday-list-card";
import { WeeklyCoverCard } from "@/components/service-calendar/weekly-cover-card";
import type { ServiceCalendar } from "@/fetchers/service-calendar";
import type {
  CalendarMetadata,
  useServiceCalendarEditor,
} from "@/hooks/use-service-calendar-editor";
import { routes } from "@/lib/routes";

type EditorState = ReturnType<typeof useServiceCalendarEditor>;

export function ServiceCalendarEditorView({
  state,
  isNew,
  year,
  form,
  onYearChange,
}: {
  state: EditorState;
  isNew: boolean;
  year: number;
  form: UseFormReturn<CalendarMetadata>;
  onYearChange: (year: number) => void;
}) {
  const { calendar, loading, isCalendarError, refetchCalendar, saving } = state;

  if (loading) {
    return (
      <main className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title="Service calendar" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-72 w-full" />
      </main>
    );
  }

  if (isCalendarError) {
    return (
      <main className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title="Service calendar" />
        <Alert variant="error">
          <AlertTitle>Calendar could not be loaded</AlertTitle>
          <AlertDescription>
            The calendar may be unavailable or outside your workspace access.
            <Button className="w-fit" onClick={() => void refetchCalendar()}>
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
            <Button
              className="w-fit"
              render={<Link to={routes.serviceCalendars.path} />}
              variant="outline"
            >
              Back to calendars
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <>
      <PageTitle
        title={
          isNew
            ? "New service calendar"
            : (calendar?.name ?? "Service calendar")
        }
      />
      <main className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Button
              render={<Link to={routes.serviceCalendars.path} />}
              variant="ghost"
              size="sm"
            >
              <ArrowLeft aria-hidden="true" />
              All calendars
            </Button>
            <h1 className="text-2xl font-semibold">
              {isNew ? "New service calendar" : calendar?.name}
            </h1>
          </div>
          <Button
            type="submit"
            form="service-calendar-form"
            disabled={
              saving ||
              !state.workspace ||
              !state.canManageCalendars ||
              state.isCheckingPermissions
            }
          >
            {saving ? "Saving…" : isNew ? "Create calendar" : "Save changes"}
          </Button>
        </div>

        <EditorNotices
          isNew={isNew}
          calendar={calendar}
          hasCover={state.hasCover}
        />
        {!state.canManageCalendars && !state.isCheckingPermissions ? (
          <Alert variant="info">
            <AlertTitle>Read-only access</AlertTitle>
            <AlertDescription>
              Your workspace role does not allow creating or editing service
              calendars. Contact a workspace administrator if you need access.
            </AlertDescription>
          </Alert>
        ) : null}

        <form
          id="service-calendar-form"
          className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]"
          onSubmit={form.handleSubmit(state.handleSave)}
        >
          <fieldset
            disabled={!state.canManageCalendars || state.isCheckingPermissions}
            className="m-0 min-w-0 border-0 p-0"
          >
            <legend className="sr-only">
              Editable service calendar settings
            </legend>
            <div className="space-y-6">
              <CalendarDetailsCard form={form} />
              <WeeklyCoverCard
                windows={state.windows}
                windowIds={state.windowIds}
                windowError={state.windowError}
                onDragEnd={state.handleWindowDragEnd}
                onChange={state.updateWindow}
                onAdd={state.addWindow}
                onRemove={state.removeWindow}
              />
              <HolidayListCard
                holidays={state.holidays}
                holidayIds={state.holidayIds}
                onAdd={state.addHoliday}
                onChange={state.replaceHoliday}
                onPatch={state.patchHoliday}
                onRemove={state.removeHoliday}
              />
            </div>
          </fieldset>
          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <CoveragePreviewCard
              calendar={calendar}
              isNew={isNew}
              year={year}
              preview={state.preview}
              onYearChange={onYearChange}
            />
          </aside>
        </form>
        <AlertDialog
          open={state.timezoneConfirmationOpen}
          onOpenChange={(open) => {
            if (!open) state.cancelTimezoneChange();
          }}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Confirm calendar timezone change
              </AlertDialogTitle>
              <AlertDialogDescription className="text-foreground">
                Changing the calendar timezone immediately changes how SLA
                deadlines are calculated for work items using this calendar.
              </AlertDialogDescription>
              <p className="text-sm text-foreground">
                The affected open-item count is not available yet. The calendar
                usage count is not available yet. Confirm to continue without
                that count.
              </p>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                render={
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                }
              />
              <Button
                type="button"
                disabled={saving}
                onClick={() => void state.confirmTimezoneChange()}
              >
                Confirm and save
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </main>
    </>
  );
}

function EditorNotices({
  isNew,
  calendar,
  hasCover,
}: {
  isNew: boolean;
  calendar?: ServiceCalendar;
  hasCover: boolean;
}) {
  return (
    <>
      <Alert variant="warning">
        <AlertTitle>Changes affect SLA deadlines immediately</AlertTitle>
        <AlertDescription className="text-foreground">
          Editing cover or holidays recalculates SLA state on the next read. The
          affected-item count is not available in this slice because the usage
          endpoint depends on project calendar references (#437) and the
          sla_policy table.
        </AlertDescription>
      </Alert>
      {!isNew && calendar && !hasCover ? (
        <Alert variant="warning">
          <AlertTitle>This calendar provides zero weekly cover</AlertTitle>
          <AlertDescription className="text-foreground">
            With no windows, SLA clocks using this calendar never advance.
          </AlertDescription>
        </Alert>
      ) : null}
      {isNew && !hasCover ? (
        <Alert variant="warning">
          <AlertTitle>This calendar currently provides zero cover</AlertTitle>
          <AlertDescription className="text-foreground">
            Add at least one window before saving if this calendar should move
            SLA clocks.
          </AlertDescription>
        </Alert>
      ) : null}
      <Alert variant="info">
        <AlertTitle>Limited calendar tools</AlertTitle>
        <AlertDescription>
          Configure windows and holidays manually. Presets, cloning, country
          holidays, .ics import, reference counts, and safe deletion are not
          available in the current API slice.
        </AlertDescription>
      </Alert>
    </>
  );
}
