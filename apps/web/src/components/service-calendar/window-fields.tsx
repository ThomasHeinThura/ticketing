import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button, Checkbox, Input, Label } from "@taskdesk/ui";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CalendarWindow, Weekday } from "@/fetchers/service-calendar";
import { formatClockTime, parseClockTime } from "@/lib/service-calendar-form";

const TIME_MARKERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export function WindowFields({
  id,
  day,
  index,
  window,
  onChange,
  onRemove,
}: {
  id: string;
  day: Weekday;
  index: number;
  window: CalendarWindow;
  onChange: (patch: Partial<CalendarWindow>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("serviceCalendars");
  const weekdayLabel = t(`weekdays.${day}`);
  const trackRef = useRef<HTMLFieldSetElement>(null);
  const [lastEnd, setLastEnd] = useState(window.to === 1440 ? 1020 : window.to);
  const endAtDayBoundary = window.to === 1440;
  const timeLabel = t("window.label", { day: weekdayLabel, count: index + 1 });
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id,
      disabled: window.from >= window.to,
      data: {
        day,
        index,
        from: window.from,
        to: window.to,
        getTrackWidth: () =>
          trackRef.current?.getBoundingClientRect().width ?? 0,
      },
    });
  const left = (window.from / 1440) * 100;
  const width = Math.max(((window.to - window.from) / 1440) * 100, 0.2);

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <div className="space-y-1.5 sm:col-span-3">
        <div
          className="flex justify-between px-1 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
        <fieldset ref={trackRef} className="relative m-0 min-w-0 border-0 p-0">
          <legend className="sr-only">
            {t("window.timeline", { day: weekdayLabel })}
          </legend>
          <div className="relative h-9 overflow-hidden rounded-md border border-border bg-muted/40">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 grid grid-cols-12"
            >
              {TIME_MARKERS.map((hour) => (
                <span
                  key={hour}
                  className="border-l border-border/70 first:border-0"
                />
              ))}
            </div>
            <Button
              ref={setNodeRef}
              type="button"
              variant="default"
              size="sm"
              className={`absolute top-0.5 z-10 h-8 min-w-0 justify-start gap-1 overflow-hidden px-1.5 text-xs ${isDragging ? "opacity-70" : ""}`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                transform: CSS.Translate.toString(transform),
                touchAction: "none",
              }}
              aria-label={t("window.move", {
                label: timeLabel,
                from: formatClockTime(window.from),
                to: formatClockTime(window.to),
              })}
              {...attributes}
              {...listeners}
            >
              {formatClockTime(window.from)}–{formatClockTime(window.to)}
            </Button>
          </div>
        </fieldset>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${day}-${index}-from`}>{t("window.starts")}</Label>
        <Input
          id={`${day}-${index}-from`}
          type="time"
          step={60}
          required
          value={formatClockTime(window.from)}
          onChange={(event) => {
            const minutes = parseClockTime(event.target.value, false);
            if (minutes !== null) onChange({ from: minutes });
          }}
          aria-label={t("window.startLabel", { label: timeLabel })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${day}-${index}-to`}>{t("window.ends")}</Label>
        {endAtDayBoundary ? (
          <Input
            id={`${day}-${index}-to`}
            type="text"
            value="24:00"
            readOnly
            aria-label={t("window.endLabel", { label: timeLabel })}
          />
        ) : (
          <Input
            id={`${day}-${index}-to`}
            type="time"
            step={60}
            required
            value={formatClockTime(window.to)}
            onChange={(event) => {
              const minutes = parseClockTime(event.target.value, false);
              if (minutes !== null) {
                setLastEnd(minutes);
                onChange({ to: minutes });
              }
            }}
            aria-label={t("window.endLabel", { label: timeLabel })}
          />
        )}
        <div className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={endAtDayBoundary}
            onCheckedChange={(checked) => {
              if (checked) {
                setLastEnd(window.to);
                onChange({ to: 1440 });
              } else {
                onChange({
                  to:
                    lastEnd > window.from
                      ? lastEnd
                      : Math.min(1439, window.from + 1),
                });
              }
            }}
            aria-label={t("window.endBoundaryLabel", { label: timeLabel })}
          />
          <span>{t("window.endBoundary")}</span>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        aria-label={t("window.removeWindow", { label: timeLabel })}
      >
        <Trash2 aria-hidden="true" />
        <span className="sm:sr-only">{t("window.remove")}</span>
      </Button>
    </div>
  );
}
