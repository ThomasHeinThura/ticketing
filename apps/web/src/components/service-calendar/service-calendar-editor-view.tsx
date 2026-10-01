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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("serviceCalendars");
  const { calendar, loading, isCalendarError, refetchCalendar, saving } = state;

  if (loading) {
    return (
      <main className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title={t("editor.pageTitle")} />
        <div role="status" aria-label={t("editor.loading")}>
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="mt-4 h-72 w-full" />
        </div>
      </main>
    );
  }

  if (isCalendarError) {
    return (
      <main className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <PageTitle title={t("editor.pageTitle")} />
        <Alert variant="error">
          <AlertTitle>{t("editor.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("editor.loadErrorDescription")}
            <Button className="w-fit" onClick={() => void refetchCalendar()}>
              <RefreshCw aria-hidden="true" />
              {t("editor.retry")}
            </Button>
            <Button
              className="w-fit"
              render={<Link to={routes.serviceCalendars.path} />}
              variant="outline"
            >
              {t("editor.back")}
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
            ? t("editor.newTitle")
            : (calendar?.name ?? t("editor.pageTitle"))
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
              {t("editor.allCalendars")}
            </Button>
            <h1 className="text-2xl font-semibold">
              {isNew ? t("editor.newTitle") : calendar?.name}
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
            {saving
              ? t("editor.saving")
              : isNew
                ? t("editor.create")
                : t("editor.save")}
          </Button>
        </div>

        {state.calendarConflict ? (
          <Alert variant="error" role="alert">
            <AlertTitle>{t("editor.conflictTitle")}</AlertTitle>
            <AlertDescription>
              {t("editor.conflictDescription", {
                version: state.calendarConflict.currentVersion,
              })}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={state.reloadLatest}
                >
                  {t("editor.discardReload")}
                </Button>
                <Button type="button" onClick={state.keepDraft}>
                  {t("editor.keepDraft")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        <EditorNotices
          isNew={isNew}
          calendar={calendar}
          hasCover={state.hasCover}
        />
        {!state.canManageCalendars && !state.isCheckingPermissions ? (
          <Alert variant="info">
            <AlertTitle>{t("editor.readOnlyTitle")}</AlertTitle>
            <AlertDescription>
              {t("editor.readOnlyDescription")}
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
            <legend className="sr-only">{t("editor.editableLegend")}</legend>
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
              <AlertDialogTitle>{t("editor.timezoneTitle")}</AlertDialogTitle>
              <AlertDialogDescription className="text-foreground">
                {t("editor.timezoneDescription")}
              </AlertDialogDescription>
              <p className="text-sm text-foreground">
                {t("editor.timezoneCount")}
              </p>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                render={
                  <Button type="button" variant="outline">
                    {t("editor.cancel")}
                  </Button>
                }
              />
              <Button
                type="button"
                disabled={saving}
                onClick={() => void state.confirmTimezoneChange()}
              >
                {t("editor.confirmSave")}
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
  const { t } = useTranslation("serviceCalendars");
  return (
    <>
      <Alert variant="warning">
        <AlertTitle>{t("editor.changesTitle")}</AlertTitle>
        <AlertDescription className="text-foreground">
          {t("editor.changesDescription")}
        </AlertDescription>
      </Alert>
      {!isNew && calendar && !hasCover ? (
        <Alert variant="warning">
          <AlertTitle>{t("editor.zeroWeeklyTitle")}</AlertTitle>
          <AlertDescription className="text-foreground">
            {t("editor.zeroWeeklyDescription")}
          </AlertDescription>
        </Alert>
      ) : null}
      {isNew && !hasCover ? (
        <Alert variant="warning">
          <AlertTitle>{t("editor.zeroTitle")}</AlertTitle>
          <AlertDescription className="text-foreground">
            {t("editor.zeroDescription")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Alert variant="info">
        <AlertTitle>{t("editor.limitedTitle")}</AlertTitle>
        <AlertDescription>{t("editor.limitedDescription")}</AlertDescription>
      </Alert>
    </>
  );
}
