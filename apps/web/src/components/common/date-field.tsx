import {
  Button,
  Calendar,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { CalendarDays } from "lucide-react";
import { type AriaAttributes, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

const calendarDate = z.iso.date();

/** `YYYY-MM-DD` to a local-midnight `Date` (so the calendar highlights the same day it shows). */
function toDay(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}

function fromDay(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${String(day.getFullYear()).padStart(4, "0")}-${month}-${date}`;
}

/**
 * A date as a calendar date: Kaneo's Popover with its Calendar, exactly the control the task
 * properties use for due dates, holding `YYYY-MM-DD` so no time zone enters the value.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  label,
  placeholder,
  clearLabel,
  dateEntry,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Earliest and latest selectable day, `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  /** Optional clear action; required-date callers retain their existing behavior. */
  clearLabel?: string;
  /** Optional library text entry for distant dates; validation stays date-only. */
  dateEntry?: { label: string; invalidLabel: string; saveLabel: string };
  "aria-invalid"?: AriaAttributes["aria-invalid"];
  "aria-describedby"?: string;
}) {
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage || i18n?.language || "en-US";
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const selected = toDay(value);
  const before = min ? toDay(min) : undefined;
  const after = max ? toDay(max) : undefined;
  const [entry, setEntry] = useState(value);
  const [month, setMonth] = useState(() => selected ?? new Date());
  const generatedId = useId();
  const entryId = `${id ?? generatedId}-date-entry`;
  const entryValue = entry.trim();
  const entryValid =
    calendarDate.safeParse(entryValue).success &&
    (!min || entryValue >= min) &&
    (!max || entryValue <= max);

  function saveEntry() {
    if (disabled || !entryValid) return;
    onChange(entryValue);
    setOpen(false);
  }
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        if (next) {
          setEntry(value);
          setMonth(selected ?? new Date());
        }
        setOpen(next && !disabled);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={label}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          className="w-full justify-start gap-2 font-normal tabular-nums"
        >
          <CalendarDays aria-hidden="true" />
          {selected
            ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                selected,
              )
            : (placeholder ?? value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" aria-label={label}>
        {dateEntry ? (
          <div className="space-y-2 border-b border-border p-3">
            <Label htmlFor={entryId}>{dateEntry.label}</Label>
            <div className="flex gap-2">
              <Input
                id={entryId}
                type="text"
                placeholder="YYYY-MM-DD"
                autoComplete="off"
                value={entry}
                disabled={disabled}
                aria-invalid={Boolean(entry && !entryValid)}
                aria-describedby={
                  entry && !entryValid ? `${entryId}-error` : undefined
                }
                onChange={(event) => {
                  setEntry(event.target.value);
                  const day = toDay(event.target.value.trim());
                  if (day) setMonth(day);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.stopPropagation();
                  saveEntry();
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={disabled || !entryValid}
                onClick={saveEntry}
              >
                {dateEntry.saveLabel}
              </Button>
            </div>
            {entry && !entryValid ? (
              <p
                id={`${entryId}-error`}
                className="text-sm text-destructive"
                role="alert"
              >
                {dateEntry.invalidLabel}
              </p>
            ) : null}
          </div>
        ) : null}
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          {...(dateEntry ? { month, onMonthChange: setMonth } : {})}
          onSelect={(day) => {
            if (!day || disabled) return;
            onChange(fromDay(day));
            setOpen(false);
          }}
          disabled={[
            ...(before ? [{ before }] : []),
            ...(after ? [{ after }] : []),
          ]}
          className="w-full bg-popover"
        />
        {clearLabel ? (
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={disabled || !value}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {clearLabel}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
