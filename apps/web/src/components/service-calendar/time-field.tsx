import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatClockTime } from "@/lib/service-calendar-form";

const HOURS = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);

/** Calendar-local minutes, with no date, instant, or timezone conversion. */
export function TimeField({
  id,
  label,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({ id, value });
  const [hour, setHour] = useState("00");
  const [minute, setMinute] = useState("00");
  const active =
    open && !disabled && snapshot.id === id && snapshot.value === value;
  useEffect(() => {
    if (disabled || snapshot.id !== id || snapshot.value !== value)
      setOpen(false);
  }, [id, value, disabled, snapshot.id, snapshot.value]);
  return (
    <Popover
      open={active}
      onOpenChange={(next) => {
        if (next && !disabled) {
          setSnapshot({ id, value });
          setHour(HOURS[Math.floor(value / 60)] ?? "00");
          setMinute(MINUTES[value % 60] ?? "00");
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
          disabled={disabled}
          className="w-full min-w-0 justify-start gap-2 font-normal tabular-nums"
        >
          <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
          {formatClockTime(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={label} className="w-64 p-0">
        <div className="grid grid-cols-2 gap-3 p-3">
          {[
            { name: "hour", value: hour, values: HOURS, change: setHour },
            {
              name: "minute",
              value: minute,
              values: MINUTES,
              change: setMinute,
            },
          ].map((part) => (
            <div key={part.name} className="flex flex-col gap-1">
              <Label htmlFor={`${id}-${part.name}`}>
                {t(`customFields:value.${part.name}`)}
              </Label>
              <Select
                value={part.value}
                disabled={disabled}
                onValueChange={(next) => {
                  if (active && next !== null && part.values.includes(next))
                    part.change(next);
                }}
              >
                <SelectTrigger
                  id={`${id}-${part.name}`}
                  className="w-full min-w-0"
                >
                  <SelectValue>{part.value}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  aria-label={t(`customFields:value.${part.name}`)}
                >
                  {part.values.map((choice) => (
                    <SelectItem key={choice} value={choice}>
                      {choice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => {
              if (!active) return;
              setOpen(false);
              const next = Number(hour) * 60 + Number(minute);
              if (next !== value) onChange(next);
            }}
          >
            {t("common:actions.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
