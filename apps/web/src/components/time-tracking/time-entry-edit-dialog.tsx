import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type TimeActivity,
  type TimeEntry,
  updateTimeEntry,
} from "@/fetchers/time-tracking";
import { formatMinutes, parseMinutes } from "@/lib/time-minutes";
import {
  ActivitySelect,
  useInvalidateTime,
  useTimeErrorMessage,
} from "./time-shared";

/** Edit one entry: duration, activity, billable and what was done. Saving answers a review prompt. */
export function TimeEntryEditDialog({
  entry,
  activities,
  onClose,
}: {
  entry: TimeEntry;
  activities: TimeActivity[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [duration, setDuration] = useState(formatMinutes(entry.minutes));
  const [activityId, setActivityId] = useState(entry.activityId);
  const [billable, setBillable] = useState(entry.billable);
  const [description, setDescription] = useState(entry.description ?? "");
  const minutes = parseMinutes(duration);
  const save = useMutation({
    mutationFn: () =>
      updateTimeEntry(entry.id, {
        ...(minutes !== null && minutes !== entry.minutes ? { minutes } : {}),
        ...(activityId !== entry.activityId ? { activityId } : {}),
        ...(billable !== entry.billable ? { billable } : {}),
        ...(description !== (entry.description ?? "")
          ? { description: description.trim() || null }
          : {}),
        // An empty change set is refused by the API; touching the description keeps a pure
        // "yes, that is what happened" confirmation of a capped entry valid.
        ...(minutes === entry.minutes &&
        activityId === entry.activityId &&
        billable === entry.billable &&
        description === (entry.description ?? "")
          ? { billable: entry.billable }
          : {}),
      }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("timeTracking:edit.title")}</DialogTitle>
          <DialogDescription>
            {entry.workItemKey ?? t("timeTracking:entry.noWorkItem")} ·{" "}
            {entry.date}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (minutes !== null && !save.isPending) save.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            {entry.needsReview ? (
              <Alert variant="warning">
                <AlertDescription>
                  {t("timeTracking:review.dialogHint")}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="time-edit-duration">
                {t("timeTracking:fields.duration")}
              </Label>
              <Input
                id="time-edit-duration"
                autoFocus
                inputMode="text"
                value={duration}
                aria-invalid={minutes === null}
                disabled={save.isPending}
                onChange={(event) => setDuration(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("timeTracking:fields.durationHelp")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="time-edit-activity">
                {t("timeTracking:fields.activity")}
              </Label>
              <ActivitySelect
                id="time-edit-activity"
                activities={activities}
                value={activityId}
                onChange={setActivityId}
                disabled={save.isPending}
                label={t("timeTracking:fields.activity")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time-edit-description">
                {t("timeTracking:fields.description")}
              </Label>
              <Input
                id="time-edit-description"
                maxLength={2000}
                value={description}
                disabled={save.isPending}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="time-edit-billable"
                checked={billable}
                disabled={save.isPending}
                onCheckedChange={setBillable}
              />
              <Label htmlFor="time-edit-billable">
                {t("timeTracking:fields.billable")}
              </Label>
            </div>
            {save.error ? (
              <Alert variant="error">
                <AlertDescription>{message(save.error)}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={save.isPending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || minutes === null}>
              {t("timeTracking:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
