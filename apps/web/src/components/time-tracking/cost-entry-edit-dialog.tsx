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
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type CostEntry, updateCostEntry } from "@/fetchers/time-tracking";
import { parseMinor } from "@/lib/money-minor";
import { shiftDate } from "@/lib/time-minutes";
import { parseUnits, plainMajor } from "./cost-queries";
import { DateField } from "./date-field";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

/** Edit one cost entry: units, date, the rate it captured and the note (`TC-13`). */
export function CostEntryEditDialog({
  entry,
  today,
  earliestDate,
  onClose,
}: {
  entry: CostEntry;
  today: string;
  earliestDate?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [units, setUnits] = useState(String(entry.units));
  const [date, setDate] = useState(entry.date);
  const [note, setNote] = useState(entry.note ?? "");
  const [rate, setRate] = useState(
    entry.rateMinor === undefined
      ? ""
      : plainMajor(entry.rateMinor, entry.currency),
  );
  const parsedUnits = parseUnits(units);
  const parsedRate =
    rate.trim() === "" ? null : parseMinor(rate, entry.currency);
  const valid = parsedUnits !== null && parsedRate !== null;
  const changes = {
    ...(parsedUnits !== null && parsedUnits !== entry.units
      ? { units: parsedUnits }
      : {}),
    ...(date !== entry.date ? { date } : {}),
    ...(note.trim() !== (entry.note ?? "")
      ? { note: note.trim() || null }
      : {}),
    ...(parsedRate !== null && parsedRate !== entry.rateMinor
      ? { rateMinor: parsedRate }
      : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  const save = useMutation({
    mutationFn: () => updateCostEntry(entry.id, changes),
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
          <DialogTitle>{t("timeTracking:costs.editTitle")}</DialogTitle>
          <DialogDescription>
            {entry.costTypeName} · {entry.date}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && dirty && !save.isPending) save.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="cost-edit-units">
                {t("timeTracking:costs.units", { unit: entry.unit })}
              </Label>
              <Input
                id="cost-edit-units"
                autoFocus
                inputMode="numeric"
                value={units}
                aria-invalid={parsedUnits === null}
                disabled={save.isPending}
                onChange={(event) => setUnits(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-edit-rate">
                {t("timeTracking:costs.rate", { currency: entry.currency })}
              </Label>
              <Input
                id="cost-edit-rate"
                inputMode="decimal"
                value={rate}
                aria-invalid={parsedRate === null}
                disabled={save.isPending}
                onChange={(event) => setRate(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("timeTracking:costs.rateNote")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-edit-date">
                {t("timeTracking:fields.date")}
              </Label>
              <DateField
                id="cost-edit-date"
                value={date}
                max={today}
                min={earliestDate}
                disabled={save.isPending}
                onChange={setDate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cost-edit-note">
                {t("timeTracking:costs.note")}
              </Label>
              <Input
                id="cost-edit-note"
                maxLength={2000}
                value={note}
                disabled={save.isPending}
                onChange={(event) => setNote(event.target.value)}
              />
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
            <Button type="submit" disabled={!valid || !dirty || save.isPending}>
              {t("timeTracking:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function earliestCostDate(
  canLogBackdated: boolean,
  today: string,
  limitDays: number,
) {
  return canLogBackdated ? undefined : shiftDate(today, -limitDays);
}
