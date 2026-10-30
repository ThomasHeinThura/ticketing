import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/time-tracking/date-field";
import type { Holiday } from "@/fetchers/service-calendar";

export function HolidayFields({
  holiday,
  index,
  onChange,
  onPatch,
  onRemove,
  disabled = false,
}: {
  holiday: Holiday;
  index: number;
  onChange: (holiday: Holiday) => void;
  onPatch: (patch: Partial<Holiday>) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("serviceCalendars");
  const kind =
    "date" in holiday ? "date" : "from" in holiday ? "range" : "annual";
  const dateEntry = (label: string) => ({
    label: t("holidays.dateEntry", { label }),
    invalidLabel: t("holidays.invalidDate"),
    saveLabel: t("common:actions.save"),
  });

  return (
    <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <legend className="px-1 text-sm font-medium">
        {t("holidays.item", { count: index + 1 })}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`holiday-${index}-kind`}>
            {t("holidays.pattern")}
          </Label>
          <Select
            value={kind}
            disabled={disabled}
            onValueChange={(value) => {
              const name = holiday.name;
              if (value === "range") {
                onChange({ from: "", to: "", name });
              } else if (value === "annual") {
                onChange({ recurs: "annually", month: 0, day: 0, name });
              } else {
                onChange({ date: "", name });
              }
            }}
          >
            <SelectTrigger id={`holiday-${index}-kind`}>
              <SelectValue>{t(`holidays.${kind}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent aria-label={t("holidays.pattern")}>
              <SelectItem value="date">{t("holidays.date")}</SelectItem>
              <SelectItem value="range">{t("holidays.range")}</SelectItem>
              <SelectItem value="annual">{t("holidays.annual")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {kind === "date" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`holiday-${index}-date`}>
              {t("holidays.dateLabel")}
            </Label>
            <DateField
              id={`holiday-${index}-date`}
              label={t("holidays.dateLabel")}
              dateEntry={dateEntry(t("holidays.dateLabel"))}
              placeholder={t("customFields:value.notSet")}
              disabled={disabled}
              value={"date" in holiday ? holiday.date : ""}
              onChange={(date) => onPatch({ date })}
            />
          </div>
        ) : kind === "range" && "from" in holiday ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`holiday-${index}-from`}>
                {t("holidays.from")}
              </Label>
              <DateField
                id={`holiday-${index}-from`}
                label={t("holidays.from")}
                dateEntry={dateEntry(t("holidays.from"))}
                placeholder={t("customFields:value.notSet")}
                disabled={disabled}
                value={holiday.from}
                onChange={(from) => onPatch({ from })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`holiday-${index}-to`}>
                {t("holidays.through")}
              </Label>
              <DateField
                id={`holiday-${index}-to`}
                label={t("holidays.through")}
                dateEntry={dateEntry(t("holidays.through"))}
                placeholder={t("customFields:value.notSet")}
                disabled={disabled}
                value={holiday.to}
                onChange={(to) => onPatch({ to })}
              />
            </div>
          </>
        ) : kind === "annual" && "recurs" in holiday ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`holiday-${index}-month`}>
                {t("holidays.month")}
              </Label>
              <Input
                id={`holiday-${index}-month`}
                type="number"
                min={1}
                max={12}
                required
                value={holiday.month || ""}
                onChange={(event) =>
                  onPatch({ month: Number(event.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`holiday-${index}-day`}>
                {t("holidays.day")}
              </Label>
              <Input
                id={`holiday-${index}-day`}
                type="number"
                min={1}
                max={31}
                required
                value={holiday.day || ""}
                onChange={(event) =>
                  onPatch({ day: Number(event.target.value) || 0 })
                }
              />
            </div>
          </>
        ) : null}

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`holiday-${index}-name`}>
            {t("holidays.nameOptional")}
          </Label>
          <Input
            id={`holiday-${index}-name`}
            value={holiday.name ?? ""}
            onChange={(event) => onPatch({ name: event.target.value })}
          />
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={onRemove}
        aria-label={t("holidays.removeHoliday", { count: index + 1 })}
      >
        <Trash2 aria-hidden="true" />
        <span className="sm:sr-only">{t("holidays.remove")}</span>
      </Button>
    </fieldset>
  );
}
