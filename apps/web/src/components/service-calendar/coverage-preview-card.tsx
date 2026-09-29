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
          <CardTitle>Coverage preview</CardTitle>
          <CardDescription>
            Calculated by the server with its timezone database. Values reflect
            the last saved settings; save changes to recalculate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="preview-year">Preview year</Label>
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
              The year is saved in this page URL.
            </p>
          </div>
          {isNew ? (
            <p className="text-sm text-muted-foreground">
              Save this calendar to calculate its annual cover.
            </p>
          ) : preview.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : preview.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                Coverage preview is unavailable.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void preview.refetch()}
              >
                <RefreshCw aria-hidden="true" />
                Retry preview
              </Button>
            </div>
          ) : preview.data ? (
            <div className="space-y-3">
              <p className="text-sm">
                <strong className="text-lg tabular-nums">
                  {weeklyCoverHours(preview.data.weeklyCoverMinutes)}
                </strong>{" "}
                hours of cover per week
              </p>
              <p className="text-sm">
                <strong className="text-lg tabular-nums">
                  {weeklyCoverHours(preview.data.annualCoverMinutes)}
                </strong>{" "}
                hours in {preview.data.year} after holidays
              </p>
              {!preview.data.hasCover ? (
                <p className="text-sm text-warning-foreground">
                  This calendar has no cover windows.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      {!isNew && calendar ? (
        <p className="text-xs text-muted-foreground">
          Calendar: {calendar.name}. Changes take effect immediately for SLAs
          that use it.
        </p>
      ) : null}
    </>
  );
}
