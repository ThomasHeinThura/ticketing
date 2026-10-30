import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/time-tracking/date-field";
import {
  type Cycle,
  CycleOverlapError,
  createCycle,
  updateCycle,
} from "@/fetchers/agile";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { formatCalendarDate } from "./agile-format";

/**
 * Create or edit a cycle (`CY-1`). Overlapping a sibling cycle is refused by the API (`CY-2`) and
 * the refusal names the conflicting cycle, which this dialog shows beside the dates so the
 * planner can move them. Status is never an input (`CY-3`).
 */
export function CycleFormDialog({
  projectKey,
  cycle,
  onClose,
}: {
  projectKey: string;
  /** Present when editing. */
  cycle?: Cycle;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("agile");
  const cache = useQueryClient();
  const [name, setName] = useState(cycle?.name ?? "");
  const [startDate, setStartDate] = useState(cycle?.startDate ?? "");
  const [endDate, setEndDate] = useState(cycle?.endDate ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<CycleOverlapError | null>(null);

  const dateError =
    startDate && endDate && endDate < startDate
      ? t("cycles.form.endBeforeStart")
      : null;
  const valid =
    name.trim().length > 0 && startDate !== "" && endDate !== "" && !dateError;

  const save = useMutation({
    mutationFn: () =>
      cycle
        ? updateCycle(cycle.id, {
            name: name.trim(),
            startDate,
            endDate,
            version: cycle.version,
          })
        : createCycle(projectKey, {
            name: name.trim(),
            startDate,
            endDate,
          }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["agile"] });
      toast.success(t(cycle ? "cycles.form.saved" : "cycles.form.created"));
      onClose();
    },
    onError: (error) => {
      setConflict(error instanceof CycleOverlapError ? error : null);
      setProblem(
        error instanceof CycleOverlapError
          ? null
          : error instanceof HttpError && error.status === 409
            ? t("cycles.form.versionConflict")
            : error instanceof Error && error.message
              ? error.message
              : t("cycles.form.saveFailed"),
      );
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {cycle ? t("cycles.form.editTitle") : t("cycles.form.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("cycles.form.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cycle-name">{t("cycles.form.name")}</Label>
            <Input
              id="cycle-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cycle-start">{t("cycles.form.start")}</Label>
              <DateField
                id="cycle-start"
                label={t("cycles.form.start")}
                placeholder={t("customFields:value.notSet")}
                clearLabel={t("customFields:value.clear")}
                value={startDate}
                onChange={setStartDate}
                disabled={save.isPending}
                dateEntry={{
                  label: t("common.dateEntry", {
                    label: t("cycles.form.start"),
                  }),
                  invalidLabel: t("common.invalidDate"),
                  saveLabel: t("common.save"),
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cycle-end">{t("cycles.form.end")}</Label>
              <DateField
                id="cycle-end"
                label={t("cycles.form.end")}
                placeholder={t("customFields:value.notSet")}
                clearLabel={t("customFields:value.clear")}
                value={endDate}
                onChange={setEndDate}
                disabled={save.isPending}
                dateEntry={{
                  label: t("common.dateEntry", { label: t("cycles.form.end") }),
                  invalidLabel: t("common.invalidDate"),
                  saveLabel: t("common.save"),
                }}
              />
            </div>
          </div>
          {dateError ? (
            <p className="text-destructive-foreground text-xs" role="alert">
              {dateError}
            </p>
          ) : null}
          {conflict ? (
            <Alert variant="error" data-testid="cycle-overlap-error">
              <AlertTitle>{t("cycles.form.overlapTitle")}</AlertTitle>
              <AlertDescription>
                {t("cycles.form.overlap", {
                  name: conflict.conflictingCycle.name,
                  start: formatCalendarDate(
                    conflict.conflictingCycle.startDate,
                    i18n.language,
                  ),
                  end: formatCalendarDate(
                    conflict.conflictingCycle.endDate,
                    i18n.language,
                  ),
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          {problem ? (
            <Alert variant="error">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => {
              setConflict(null);
              setProblem(null);
              save.mutate();
            }}
          >
            {cycle ? t("common.save") : t("cycles.form.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
