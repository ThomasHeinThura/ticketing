import {
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { formatDate } from "@/lib/format";

/** `YYYY-MM-DD` to a local-midnight `Date` (so the calendar highlights the same day it shows). */
function toDay(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function fromDay(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
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
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Earliest and latest selectable day, `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = toDay(value);
  const before = min ? toDay(min) : undefined;
  const after = max ? toDay(max) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={label}
          disabled={disabled}
          className="w-full justify-start gap-2 font-normal tabular-nums"
        >
          <CalendarDays aria-hidden="true" />
          {selected ? formatDate(selected, { dateStyle: "medium" }) : value}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(day) => {
            if (!day) return;
            onChange(fromDay(day));
            setOpen(false);
          }}
          disabled={[
            ...(before ? [{ before }] : []),
            ...(after ? [{ after }] : []),
          ]}
          className="w-full bg-popover"
        />
      </PopoverContent>
    </Popover>
  );
}
