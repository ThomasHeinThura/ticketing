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
import type { Holiday } from "@/fetchers/service-calendar";

export function HolidayFields({
  holiday,
  index,
  onChange,
  onPatch,
  onRemove,
}: {
  holiday: Holiday;
  index: number;
  onChange: (holiday: Holiday) => void;
  onPatch: (patch: Partial<Holiday>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("serviceCalendars");
  const kind =
    "date" in holiday ? "date" : "from" in holiday ? "range" : "annual";

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
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
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
            <Input
              id={`holiday-${index}-date`}
              type="date"
              required
              value={"date" in holiday ? holiday.date : ""}
              onChange={(event) => onPatch({ date: event.target.value })}
            />
          </div>
        ) : kind === "range" && "from" in holiday ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`holiday-${index}-from`}>
                {t("holidays.from")}
              </Label>
              <Input
                id={`holiday-${index}-from`}
                type="date"
                required
                value={holiday.from}
                onChange={(event) => onPatch({ from: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`holiday-${index}-to`}>
                {t("holidays.through")}
              </Label>
              <Input
                id={`holiday-${index}-to`}
                type="date"
                required
                value={holiday.to}
                onChange={(event) => onPatch({ to: event.target.value })}
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
