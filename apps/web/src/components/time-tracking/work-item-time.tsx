import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createTimeEntry,
  requestTimeEntryDeletion,
  startTimer,
  type TimeEntry,
} from "@/fetchers/time-tracking";
import {
  useTimeActivities,
  useTimeEntries,
  useTimer,
} from "@/hooks/queries/time-tracking/use-time-tracking";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { formatMinor } from "@/lib/money-minor";
import { formatMinutes, parseMinutes, shiftDate } from "@/lib/time-minutes";
import { toast } from "@/lib/toast";
import type { WorkItemDetailRow } from "@/types/work-item";
import { DateField } from "./date-field";
import { TimeEntryEditDialog } from "./time-entry-edit-dialog";
import {
  ActivitySelect,
  ReviewNotice,
  RunningTimerBar,
  useInvalidateTime,
  useTimeErrorMessage,
} from "./time-shared";

/**
 * The work item's Time section (`TC-1`..`TC-7`, screens.md "Time entries"): the entries on this
 * item, the total, a quick-add and the timer. Your own entries by default; with
 * `time_entry:read_any` the section can show everyone's.
 */
export default function WorkItemTime({ item }: { item: WorkItemDetailRow }) {
  const { t } = useTranslation();
  const message = useTimeErrorMessage();
  const invalidate = useInvalidateTime();
  const openPendingAction = useOpenPendingAction();
  const workspaceId = item.workspaceId;
  const [everyone, setEveryone] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const entries = useTimeEntries({
    workspaceId,
    workItemId: item.id,
    ...(everyone ? { person: "all" } : {}),
  });
  const reviews = useTimeEntries({ workspaceId, needsReview: true });
  const timer = useTimer(workspaceId);
  const activities = useTimeActivities(workspaceId);
  const [duration, setDuration] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState<boolean | null>(null);
  const [activityPick, setActivityPick] = useState<string | null>(null);
  const activityId = activityPick ?? activities.data?.[0]?.id ?? null;
  const list = entries.data;
  const today = list?.today ?? "";
  const minutes = parseMinutes(duration);
  const earliest =
    list && !list.canLogBackdated
      ? shiftDate(list.today, -list.backdateLimitDays)
      : undefined;

  const add = useMutation({
    mutationFn: () =>
      createTimeEntry({
        workspaceId,
        workItemId: item.id,
        date: date || today,
        minutes: minutes as number,
        activityId: activityId as string,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(billable === null ? {} : { billable }),
      }),
    onSuccess: async () => {
      setDuration("");
      setDescription("");
      await invalidate();
    },
    onError: (error) => toast.error(message(error)),
  });
  const start = useMutation({
    mutationFn: () =>
      startTimer({
        workspaceId,
        workItemId: item.id,
        ...(activityId ? { activityId } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: invalidate,
    onError: (error) => toast.error(message(error)),
  });
  const remove = useMutation({
    mutationFn: (entry: TimeEntry) => requestTimeEntryDeletion(entry.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(message(error)),
  });

  if (entries.isLoading || activities.isLoading)
    return <Skeleton className="h-16 w-full" />;
  if (entries.isError || !list)
    return (
      <Alert variant="error">
        <AlertDescription>
          {t("timeTracking:section.loadError")}
        </AlertDescription>
      </Alert>
    );

  const running = timer.data?.timer;
  const runningHere = running?.workItemId === item.id;
  const canSubmit = minutes !== null && activityId !== null && !add.isPending;

  return (
    <div className="space-y-3 text-sm" data-testid="work-item-time">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t("timeTracking:section.total")}</span>
        <Badge variant="outline" className="tabular-nums">
          {formatMinutes(list.totalMinutes)}
        </Badge>
        {list.canReadAny ? (
          <div className="ml-auto flex items-center gap-2">
            <Switch
              id="time-everyone"
              checked={everyone}
              onCheckedChange={setEveryone}
            />
            <Label htmlFor="time-everyone" className="text-xs">
              {t("timeTracking:section.everyone")}
            </Label>
          </div>
        ) : null}
      </div>

      <ReviewNotice count={reviews.data?.data.length ?? 0} />
      {timer.data && running ? (
        <RunningTimerBar
          state={timer.data}
          dataUpdatedAt={timer.dataUpdatedAt}
        />
      ) : null}

      <form
        className="grid grid-cols-2 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) add.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="time-duration" className="text-xs">
            {t("timeTracking:fields.duration")}
          </Label>
          <Input
            id="time-duration"
            placeholder={t("timeTracking:fields.durationPlaceholder")}
            value={duration}
            aria-invalid={duration !== "" && minutes === null}
            disabled={add.isPending}
            onChange={(event) => setDuration(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="time-activity" className="text-xs">
            {t("timeTracking:fields.activity")}
          </Label>
          <ActivitySelect
            id="time-activity"
            activities={activities.data ?? []}
            value={activityId}
            onChange={setActivityPick}
            disabled={add.isPending}
            label={t("timeTracking:fields.activity")}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="time-date" className="text-xs">
            {t("timeTracking:fields.date")}
          </Label>
          <DateField
            id="time-date"
            value={date || today}
            max={today}
            min={earliest}
            disabled={add.isPending}
            onChange={setDate}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="time-description" className="text-xs">
            {t("timeTracking:fields.description")}
          </Label>
          <Input
            id="time-description"
            maxLength={2000}
            value={description}
            disabled={add.isPending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch
              id="time-billable"
              checked={billable ?? true}
              onCheckedChange={setBillable}
            />
            <Label htmlFor="time-billable" className="text-xs">
              {t("timeTracking:fields.billable")}
            </Label>
          </div>
          <Button
            type="submit"
            size="sm"
            className="ml-auto"
            disabled={!canSubmit}
          >
            {t("timeTracking:section.add")}
          </Button>
          {!running ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={start.isPending || activityId === null}
              onClick={() => start.mutate()}
            >
              <Play aria-hidden="true" />
              {t("timeTracking:timer.start")}
            </Button>
          ) : runningHere ? null : (
            <span className="text-muted-foreground text-xs">
              {t("timeTracking:timer.runningElsewhere")}
            </span>
          )}
        </div>
      </form>

      {list.data.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("timeTracking:section.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("timeTracking:fields.date")}</TableHead>
              {everyone ? (
                <TableHead>{t("timeTracking:fields.person")}</TableHead>
              ) : null}
              <TableHead>{t("timeTracking:fields.activity")}</TableHead>
              <TableHead className="text-right">
                {t("timeTracking:fields.duration")}
              </TableHead>
              <TableHead className="w-20">
                <span className="sr-only">
                  {t("timeTracking:entry.actions")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.map((entry) => {
              const own = entry.personId === list.callerPersonId;
              const canEdit = own || list.canUpdateAny;
              const canDelete = own || list.canDeleteAny;
              return (
                <TableRow key={entry.id} data-testid="time-entry-row">
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {entry.date}
                  </TableCell>
                  {everyone ? <TableCell>{entry.personName}</TableCell> : null}
                  <TableCell>
                    <span>{entry.activityName}</span>
                    {!entry.billable ? (
                      <Badge variant="outline" className="ml-1">
                        {t("timeTracking:entry.nonBillable")}
                      </Badge>
                    ) : null}
                    {entry.needsReview ? (
                      <Badge variant="warning" className="ml-1">
                        {t("timeTracking:review.badge")}
                      </Badge>
                    ) : null}
                    {entry.description ? (
                      <span className="block text-muted-foreground text-xs">
                        {entry.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMinutes(entry.minutes)}
                    {entry.rate?.costMinor != null && entry.rate.currency ? (
                      <span className="block text-muted-foreground text-xs">
                        {formatMinor(entry.rate.costMinor, entry.rate.currency)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canEdit ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("timeTracking:entry.edit")}
                          onClick={() => setEditing(entry)}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("timeTracking:entry.delete")}
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(entry)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {editing ? (
        <TimeEntryEditDialog
          entry={editing}
          activities={activities.data ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
