import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@taskdesk/ui";
import { ChevronLeft, ChevronRight, Copy, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  createTimeEntry,
  requestTimeEntryDeletion,
  type TimeActivity,
  type TimeEntry,
  TimeTrackingDisabledError,
  updateTimeEntry,
} from "@/fetchers/time-tracking";
import getWorkItem from "@/fetchers/work-item/get-work-item";
import {
  useTimeActivities,
  useTimeEntries,
  useTimer,
} from "@/hooks/queries/time-tracking/use-time-tracking";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { formatDate } from "@/lib/format";
import type { TimesheetSearch } from "@/lib/routes";
import {
  formatMinutes,
  shiftDate,
  weekDays,
  weekStart,
} from "@/lib/time-minutes";
import { toast } from "@/lib/toast";
import { TimeEntryEditDialog } from "./time-entry-edit-dialog";
import {
  ActivitySelect,
  ReviewNotice,
  RunningTimerBar,
  useInvalidateTime,
  useTimeErrorMessage,
} from "./time-shared";
import {
  buildRows,
  cellEntries,
  cellMinutes,
  dayEditable,
  dayTotals,
  decideCellAction,
  personRows,
  rowKeyOf,
  type SheetRow,
} from "./timesheet-model";

type Props = {
  search: TimesheetSearch;
  onSearchChange: (next: TimesheetSearch) => void;
};

/** `docs/screens.md` "Timesheet" (P5, `TC-*`): the week as a Kaneo table, typed straight into the cells. */
export function Timesheet({ search, onSearchChange }: Props) {
  const { t } = useTranslation();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const everyone = search.scope === "everyone";
  const probe = useTimeEntries(
    workspaceId ? { workspaceId, needsReview: true } : null,
  );
  const clockToday = probe.data?.today;
  const start = search.week ?? (clockToday ? weekStart(clockToday) : undefined);
  const days = useMemo(() => (start ? weekDays(start) : []), [start]);
  const last = days[6];
  const entries = useTimeEntries(
    workspaceId && start && last
      ? {
          workspaceId,
          from: start,
          to: last,
          ...(everyone ? { person: "all" } : {}),
        }
      : null,
  );
  const timer = useTimer(workspaceId);
  const activities = useTimeActivities(workspaceId);

  if (workspaceLoading || probe.isLoading || (start && entries.isLoading))
    return (
      <TimesheetFrame>
        <TimesheetLoading />
      </TimesheetFrame>
    );
  if (probe.error instanceof TimeTrackingDisabledError)
    return (
      <TimesheetFrame>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("timeTracking:timesheet.disabledTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("timeTracking:timesheet.disabledDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TimesheetFrame>
    );
  if (
    !workspaceId ||
    !start ||
    !entries.data ||
    probe.isError ||
    entries.isError
  )
    return (
      <TimesheetFrame>
        <Alert variant="error">
          <AlertTitle>{t("timeTracking:timesheet.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {t("timeTracking:timesheet.loadErrorDescription")}
            <Button
              className="w-fit"
              onClick={() => {
                void probe.refetch();
                void entries.refetch();
              }}
            >
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </TimesheetFrame>
    );

  const list = entries.data;
  const today = list.today;
  const earliest = list.canLogBackdated
    ? undefined
    : shiftDate(today, -list.backdateLimitDays);
  const currentWeek = weekStart(today);
  const setWeek = (week: string) =>
    onSearchChange({
      ...(week === currentWeek ? {} : { week }),
      ...(everyone ? { scope: "everyone" as const } : {}),
    });

  return (
    <TimesheetFrame>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label={t("timeTracking:timesheet.previousWeek")}
          onClick={() => setWeek(shiftDate(start, -7))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label={t("timeTracking:timesheet.nextWeek")}
          onClick={() => setWeek(shiftDate(start, 7))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          disabled={start === currentWeek}
          onClick={() => setWeek(currentWeek)}
        >
          {t("timeTracking:timesheet.thisWeek")}
        </Button>
        <span className="font-medium text-sm" data-testid="timesheet-week">
          {formatDate(`${start}T00:00:00Z`, {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          })}
          {" – "}
          {formatDate(`${last}T00:00:00Z`, {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}
        </span>
        {list.canReadAny ? (
          <ToggleGroup
            className="ml-auto"
            value={[everyone ? "everyone" : "mine"]}
            onValueChange={(value) => {
              const next = value[0];
              if (!next) return;
              onSearchChange({
                ...(search.week ? { week: search.week } : {}),
                ...(next === "everyone" ? { scope: "everyone" as const } : {}),
              });
            }}
          >
            <ToggleGroupItem value="mine">
              {t("timeTracking:timesheet.scopeMine")}
            </ToggleGroupItem>
            <ToggleGroupItem value="everyone">
              {t("timeTracking:timesheet.scopeEveryone")}
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        {t("timeTracking:timesheet.timeZone", { zone: list.timeZone })}
      </p>

      {timer.data?.timer ? (
        <RunningTimerBar
          state={timer.data}
          dataUpdatedAt={timer.dataUpdatedAt}
        />
      ) : null}

      {everyone ? (
        <EveryoneGrid entries={list.data} days={days} today={today} />
      ) : (
        <>
          <ReviewNotice
            count={list.data.filter((entry) => entry.needsReview).length}
          />
          <MyGrid
            workspaceId={workspaceId}
            entries={list.data}
            days={days}
            today={today}
            earliest={earliest}
            weekStartDate={start}
            activities={activities.data ?? []}
            list={list}
          />
        </>
      )}
    </TimesheetFrame>
  );
}

function TimesheetFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <PageTitle title={t("timeTracking:timesheet.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-4 overflow-y-auto p-6">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl">
            {t("timeTracking:timesheet.title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            {t("timeTracking:timesheet.description")}
          </p>
        </div>
        {children}
      </div>
    </>
  );
}

function TimesheetLoading() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t("timeTracking:timesheet.loading")}
      className="space-y-3"
    >
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function DayHeads({ days, today }: { days: string[]; today: string }) {
  return (
    <>
      {days.map((day) => (
        <TableHead
          key={day}
          className={`w-24 text-center ${day === today ? "text-foreground" : ""}`}
        >
          <span className="block text-xs">
            {formatDate(`${day}T00:00:00Z`, {
              weekday: "short",
              timeZone: "UTC",
            })}
          </span>
          <span className="block font-normal text-muted-foreground text-xs">
            {formatDate(`${day}T00:00:00Z`, {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            })}
          </span>
        </TableHead>
      ))}
    </>
  );
}

function EveryoneGrid({
  entries,
  days,
  today,
}: {
  entries: TimeEntry[];
  days: string[];
  today: string;
}) {
  const { t } = useTranslation();
  const rows = personRows(entries, days);
  const totals = dayTotals(entries, days);
  if (rows.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        {t("timeTracking:timesheet.emptyEveryone")}
      </p>
    );
  return (
    <Table data-testid="timesheet-everyone">
      <TableHeader>
        <TableRow>
          <TableHead>{t("timeTracking:fields.person")}</TableHead>
          <DayHeads days={days} today={today} />
          <TableHead className="w-24 text-right">
            {t("timeTracking:timesheet.total")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.personId}>
            <TableCell>{row.name}</TableCell>
            {row.byDay.map((minutes, index) => (
              <TableCell key={days[index]} className="text-center tabular-nums">
                {minutes ? formatMinutes(minutes) : ""}
              </TableCell>
            ))}
            <TableCell className="text-right font-medium tabular-nums">
              {formatMinutes(row.total)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>{t("timeTracking:timesheet.total")}</TableCell>
          {totals.map((minutes, index) => (
            <TableCell key={days[index]} className="text-center tabular-nums">
              {formatMinutes(minutes)}
            </TableCell>
          ))}
          <TableCell className="text-right tabular-nums">
            {formatMinutes(totals.reduce((sum, minutes) => sum + minutes, 0))}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function MyGrid({
  workspaceId,
  entries,
  days,
  today,
  earliest,
  weekStartDate,
  activities,
  list,
}: {
  workspaceId: string;
  entries: TimeEntry[];
  days: string[];
  today: string;
  earliest: string | undefined;
  weekStartDate: string;
  activities: TimeActivity[];
  list: { callerPersonId: string };
}) {
  const { t } = useTranslation();
  const message = useTimeErrorMessage();
  const invalidate = useInvalidateTime();
  const openPendingAction = useOpenPendingAction();
  const [extra, setExtra] = useState<SheetRow[]>([]);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const mine = useMemo(
    () => entries.filter((entry) => entry.personId === list.callerPersonId),
    [entries, list.callerPersonId],
  );
  const rows = useMemo(() => buildRows(mine, extra), [mine, extra]);
  const totals = dayTotals(mine, days);
  const previousStart = shiftDate(weekStartDate, -7);
  const previous = useTimeEntries({
    workspaceId,
    from: previousStart,
    to: shiftDate(weekStartDate, -1),
  });

  const create = useMutation({
    mutationFn: (input: { row: SheetRow; date: string; minutes: number }) =>
      createTimeEntry({
        workspaceId,
        workItemId: input.row.workItemId as string,
        date: input.date,
        minutes: input.minutes,
        activityId: input.row.activityId,
      }),
    onSuccess: invalidate,
    onError: (error) => toast.error(message(error)),
  });
  const update = useMutation({
    mutationFn: (input: { entryId: string; minutes: number }) =>
      updateTimeEntry(input.entryId, { minutes: input.minutes }),
    onSuccess: invalidate,
    onError: (error) => toast.error(message(error)),
  });
  const remove = useMutation({
    mutationFn: (entryId: string) => requestTimeEntryDeletion(entryId),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(message(error)),
  });

  function focusCell(row: number, column: number) {
    tableRef.current
      ?.querySelector<HTMLInputElement>(
        `[data-timesheet-cell="${row}:${column}"]:not([disabled])`,
      )
      ?.focus();
  }

  const copyLastWeek = () => {
    const seen = new Set(rows.map((row) => row.key));
    const added: SheetRow[] = [];
    for (const entry of previous.data?.data ?? []) {
      if (!entry.workItemId || entry.personId !== list.callerPersonId) continue;
      const key = rowKeyOf(entry.workItemId, entry.activityId);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({
        key,
        workItemId: entry.workItemId,
        workItemKey: entry.workItemKey,
        workItemTitle: entry.workItemTitle,
        projectId: entry.projectId,
        activityId: entry.activityId,
        activityName: entry.activityName,
      });
    }
    if (added.length === 0)
      toast.info(t("timeTracking:timesheet.nothingToCopy"));
    setExtra((current) => [...current, ...added]);
  };

  return (
    <div className="space-y-3" ref={tableRef}>
      <div className="flex flex-wrap items-end gap-2">
        <AddRow
          activities={activities.filter((activity) => !activity.archived)}
          onAdd={(row) => setExtra((current) => [...current, row])}
        />
        <Button
          variant="outline"
          disabled={!previous.data?.data.length}
          onClick={copyLastWeek}
        >
          <Copy aria-hidden="true" />
          {t("timeTracking:timesheet.copyLastWeek")}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("timeTracking:timesheet.empty")}
        </p>
      ) : (
        <Table data-testid="timesheet-grid">
          <TableHeader>
            <TableRow>
              <TableHead>{t("timeTracking:timesheet.workItem")}</TableHead>
              <DayHeads days={days} today={today} />
              <TableHead className="w-24 text-right">
                {t("timeTracking:timesheet.total")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => {
              const rowTotal = cellMinutes(
                mine.filter(
                  (entry) =>
                    entry.workItemId === row.workItemId &&
                    entry.activityId === row.activityId,
                ),
              );
              return (
                <TableRow key={row.key}>
                  <TableCell className="min-w-56">
                    {row.workItemKey ? (
                      <Link
                        to="/agent/work-items/$key"
                        params={{ key: row.workItemKey }}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {row.workItemKey}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("timeTracking:entry.noWorkItem")}
                      </span>
                    )}
                    <span className="block text-muted-foreground text-xs">
                      {row.workItemTitle} · {row.activityName}
                    </span>
                  </TableCell>
                  {days.map((day, columnIndex) => {
                    const existing = cellEntries(mine, row.key, day);
                    return (
                      <TableCell key={day} className="p-1 text-center">
                        <SheetCell
                          row={rowIndex}
                          column={columnIndex}
                          label={t("timeTracking:timesheet.cellLabel", {
                            item: row.workItemKey ?? "",
                            day,
                          })}
                          entries={existing}
                          disabled={
                            !row.workItemId ||
                            !dayEditable(day, today, earliest) ||
                            create.isPending ||
                            update.isPending
                          }
                          onMove={focusCell}
                          onEditEntries={() => setEditing(existing[0] ?? null)}
                          onCommit={(text) => {
                            const action = decideCellAction(existing, text);
                            if (action.kind === "invalid")
                              toast.error(t("timeTracking:timesheet.invalid"));
                            if (action.kind === "create")
                              create.mutate({
                                row,
                                date: day,
                                minutes: action.minutes,
                              });
                            if (action.kind === "update")
                              update.mutate({
                                entryId: action.entryId,
                                minutes: action.minutes,
                              });
                            if (action.kind === "delete")
                              remove.mutate(action.entryId);
                          }}
                        />
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right tabular-nums">
                    {rowTotal ? formatMinutes(rowTotal) : ""}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>{t("timeTracking:timesheet.total")}</TableCell>
              {totals.map((minutes, index) => (
                <TableCell
                  key={days[index]}
                  className="text-center tabular-nums"
                  data-testid="timesheet-day-total"
                >
                  {formatMinutes(minutes)}
                </TableCell>
              ))}
              <TableCell
                className="text-right font-semibold tabular-nums"
                data-testid="timesheet-week-total"
              >
                {formatMinutes(
                  totals.reduce((sum, minutes) => sum + minutes, 0),
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
      <p className="text-muted-foreground text-xs">
        {t("timeTracking:timesheet.keyboardHelp")}
      </p>
      {editing ? (
        <TimeEntryEditDialog
          entry={editing}
          activities={activities}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/** One grid cell: the minutes of a work item and activity on a day, typed in place. */
function SheetCell({
  row,
  column,
  label,
  entries,
  disabled,
  onMove,
  onCommit,
  onEditEntries,
}: {
  row: number;
  column: number;
  label: string;
  entries: TimeEntry[];
  disabled: boolean;
  onMove: (row: number, column: number) => void;
  /** The typed value is acted on (create, update, delete request); the cell then shows what is stored. */
  onCommit: (text: string) => void;
  onEditEntries: () => void;
}) {
  const stored = cellMinutes(entries);
  const shown = stored ? formatMinutes(stored) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const readonly = entries.length > 1;
  const value = draft ?? shown;
  const commit = () => {
    if (draft === null || readonly) return;
    onCommit(draft);
    setDraft(null);
  };
  return (
    <Input
      aria-label={label}
      data-timesheet-cell={`${row}:${column}`}
      className="h-8 w-20 text-center tabular-nums"
      inputMode="text"
      value={value}
      readOnly={readonly}
      disabled={disabled}
      title={readonly ? `${entries.length}` : undefined}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onDoubleClick={readonly ? onEditEntries : undefined}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "Enter") {
          event.preventDefault();
          commit();
          onMove(row + 1, column);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          commit();
          onMove(row - 1, column);
        } else if (
          event.key === "ArrowLeft" &&
          event.currentTarget.selectionStart === 0 &&
          event.currentTarget.selectionEnd === 0
        ) {
          event.preventDefault();
          commit();
          onMove(row, column - 1);
        } else if (
          event.key === "ArrowRight" &&
          event.currentTarget.selectionStart ===
            event.currentTarget.value.length
        ) {
          event.preventDefault();
          commit();
          onMove(row, column + 1);
        } else if (event.key === "Escape") {
          setDraft(null);
        }
      }}
    />
  );
}

/** Adds a row to the grid: the key of a work item (as printed on cards) and an activity. */
function AddRow({
  activities,
  onAdd,
}: {
  activities: Array<{ id: string; name: string }>;
  onAdd: (row: SheetRow) => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [activityPick, setActivityPick] = useState<string | null>(null);
  const activityId = activityPick ?? activities[0]?.id ?? null;
  const find = useMutation({
    mutationFn: () => getWorkItem(key.trim()),
    onSuccess: (item) => {
      const activity = activities.find((entry) => entry.id === activityId);
      if (!activity) return;
      onAdd({
        key: rowKeyOf(item.id, activity.id),
        workItemId: item.id,
        workItemKey: item.key,
        workItemTitle: item.title,
        projectId: item.projectId,
        activityId: activity.id,
        activityName: activity.name,
      });
      setKey("");
    },
    onError: () => toast.error(t("timeTracking:timesheet.workItemNotFound")),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim() && activityId && !find.isPending) find.mutate();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="timesheet-add-key" className="text-xs">
          {t("timeTracking:timesheet.addKey")}
        </Label>
        <Input
          id="timesheet-add-key"
          className="w-40"
          placeholder={t("timeTracking:timesheet.addKeyPlaceholder")}
          value={key}
          disabled={find.isPending}
          onChange={(event) => setKey(event.target.value)}
        />
      </div>
      <div className="w-44 space-y-1">
        <Label htmlFor="timesheet-add-activity" className="text-xs">
          {t("timeTracking:fields.activity")}
        </Label>
        <ActivitySelect
          id="timesheet-add-activity"
          activities={activities.map((activity) => ({
            ...activity,
            workspaceId: "",
            position: 0,
            archived: false,
          }))}
          value={activityId}
          onChange={setActivityPick}
          label={t("timeTracking:fields.activity")}
        />
      </div>
      <Button
        type="submit"
        disabled={!key.trim() || !activityId || find.isPending}
      >
        <Plus aria-hidden="true" />
        {t("timeTracking:timesheet.addRow")}
      </Button>
    </form>
  );
}

export default Timesheet;
