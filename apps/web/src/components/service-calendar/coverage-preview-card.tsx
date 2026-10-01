import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ServiceCalendar } from "@/fetchers/service-calendar";
import type { useServiceCalendarPreview } from "@/hooks/queries/service-calendar/use-service-calendar-preview";
import { weeklyCoverHours } from "@/lib/service-calendar-form";

export function CoveragePreviewCard({
  calendar,
  isNew,
  year,
  preview,
  onYearChange,
}: {
  calendar?: ServiceCalendar;
  isNew: boolean;
  year: number;
  preview: ReturnType<typeof useServiceCalendarPreview>;
  onYearChange: (year: number) => void;
}) {
  const { t } = useTranslation("serviceCalendars");
  const [yearDraft, setYearDraft] = useState(String(year));

  useEffect(() => setYearDraft(String(year)), [year]);

  function commitYear(value: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9998) {
      setYearDraft(String(year));
      return;
    }
    onYearChange(parsed);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("preview.title")}</CardTitle>
          <CardDescription>{t("preview.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="preview-year">{t("preview.year")}</Label>
            <Input
              id="preview-year"
              type="number"
              min={1}
              max={9998}
              step={1}
              value={yearDraft}
              onChange={(event) => setYearDraft(event.target.value)}
              onBlur={() => commitYear(yearDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitYear(yearDraft);
                }
              }}
              aria-describedby="preview-year-help"
            />
            <p id="preview-year-help" className="text-xs text-muted-foreground">
              {t("preview.yearHelp")}
            </p>
          </div>
          {isNew ? (
            <p className="text-sm text-muted-foreground">
              {t("preview.saveToCalculate")}
            </p>
          ) : preview.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : preview.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                {t("preview.unavailable")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void preview.refetch()}
              >
                <RefreshCw aria-hidden="true" />
                {t("preview.retry")}
              </Button>
            </div>
          ) : preview.data ? (
            <div className="space-y-3">
              <p className="text-sm">
                <strong className="text-lg tabular-nums">
                  {weeklyCoverHours(preview.data.weeklyCoverMinutes)}
                </strong>{" "}
                {t("preview.weeklyHours")}
              </p>
              <p className="text-sm">
                <strong className="text-lg tabular-nums">
                  {weeklyCoverHours(preview.data.annualCoverMinutes)}
                </strong>{" "}
                {t("preview.annualHours", { year: preview.data.year })}
              </p>
              {!preview.data.hasCover ? (
                <p className="text-sm text-warning-foreground">
                  {t("preview.zeroCover")}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      {!isNew && calendar ? (
        <p className="text-xs text-muted-foreground">
          {t("preview.calendar", { name: calendar.name })}
        </p>
      ) : null}
    </>
  );
}
