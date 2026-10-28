import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Holiday, ServiceCalendar } from "@/fetchers/service-calendar";
import {
  applyHolidayPreset,
  type HolidayPresetResult,
} from "@/fetchers/service-management";
import { useHolidayPresets } from "@/hooks/queries/service-management";
import { formatDateMedium } from "@/lib/format";
import { useServerToday } from "@/lib/server-clock";

/**
 * `CAL-10`, `CAL-11`: generate a country's holidays for a year from the dataset bundled with the
 * release. Always previewed first; it is a starting point the administrator confirms, never
 * authority, and each preset says what it leaves out.
 */
export function HolidayPresetPanel({
  calendar,
  onImported,
}: {
  calendar: ServiceCalendar;
  onImported: (holidays: Holiday[]) => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const presets = useHolidayPresets(calendar.id);
  const [country, setCountry] = useState("");
  // Until the administrator types a year, the preset year is the server's current year.
  const serverYear = useServerToday().getFullYear();
  const [yearDraft, setYear] = useState<string | null>(null);
  const year = yearDraft ?? String(serverYear);
  const [preview, setPreview] = useState<HolidayPresetResult | null>(null);
  const [applied, setApplied] = useState<HolidayPresetResult | null>(null);
  const yearNumber = Number(year);
  const yearValid =
    Number.isInteger(yearNumber) && yearNumber >= 1900 && yearNumber <= 2200;
  const generate = useMutation({
    mutationFn: () =>
      applyHolidayPreset(calendar.id, {
        country,
        year: yearNumber,
        preview: true,
      }),
    onSuccess: (result) => {
      setApplied(null);
      setPreview(result);
    },
  });
  const confirm = useMutation({
    mutationFn: () =>
      applyHolidayPreset(
        calendar.id,
        { country, year: yearNumber, preview: false },
        calendar.version,
      ),
    onSuccess: (result) => {
      setPreview(null);
      setApplied(result);
      if (result.calendar) onImported(result.calendar.holidays);
    },
  });
  const countryItems = (presets.data?.presets ?? []).map((preset) => ({
    value: preset.country,
    label: `${preset.name} (${preset.country})`,
  }));
  const error = generate.error ?? confirm.error;
  return (
    <section
      className="space-y-3 rounded-md border p-4"
      aria-label={t("presets.title")}
    >
      <div>
        <h3 className="font-medium">{t("presets.title")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("presets.description")}
        </p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (country && yearValid && !generate.isPending) generate.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="preset-country">{t("presets.country")}</Label>
          <Select
            items={countryItems}
            value={country}
            onValueChange={(value) => {
              setCountry(value ?? "");
              setPreview(null);
            }}
          >
            <SelectTrigger id="preset-country">
              <SelectValue placeholder={t("presets.choose")} />
            </SelectTrigger>
            <SelectContent>
              {countryItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="preset-year">{t("presets.year")}</Label>
          <Input
            id="preset-year"
            type="number"
            min={1900}
            max={2200}
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
              setPreview(null);
            }}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={!country || !yearValid || generate.isPending}
        >
          {t("presets.preview")}
        </Button>
      </form>
      {error ? (
        <Alert variant="error" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      {preview ? (
        <div className="space-y-3" aria-live="polite">
          <Alert variant="info">
            <AlertTitle>{t("presets.startingPointTitle")}</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>{t("presets.startingPoint")}</p>
              <p>{t("presets.notIncluded", { text: preview.notIncluded })}</p>
              <p className="text-xs">
                {t("presets.dataset", { version: preview.datasetVersion })}
              </p>
            </AlertDescription>
          </Alert>
          <ul className="space-y-1 text-sm">
            {preview.holidays.map((holiday) => (
              <li
                key={holiday.date}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="tabular-nums">
                  {formatDateMedium(holiday.date)}
                </span>
                <span>{holiday.name}</span>
                {holiday.existing ? (
                  <Badge variant="secondary">{t("presets.existing")}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {t("presets.confirm", {
              count: preview.holidays.filter((holiday) => !holiday.existing)
                .length,
            })}
          </Button>
        </div>
      ) : null}
      {applied ? (
        <div className="space-y-2" role="status">
          <Alert variant="info">
            <AlertTitle>{t("presets.appliedTitle")}</AlertTitle>
            <AlertDescription>
              {t("presets.applied", {
                imported: applied.importedCount,
                duplicates: applied.duplicateCount,
              })}
            </AlertDescription>
          </Alert>
          {applied.affectedWorkItemCount > 0 ? (
            <Alert variant="warning">
              <AlertDescription>
                {t("presets.retroactive", {
                  count: applied.affectedWorkItemCount,
                })}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
