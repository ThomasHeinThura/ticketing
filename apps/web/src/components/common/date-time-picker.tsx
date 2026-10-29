import {
  Alert,
  AlertDescription,
  Button,
  Calendar,
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
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUserPreferencesStore } from "@/store/user-preferences";

const HOURS = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);

function validDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Calendar and time choices edit browser-local time, just like datetime-local. */
export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({ id, value });
  const [day, setDay] = useState<Date>();
  const [hour, setHour] = useState("00");
  const [minute, setMinute] = useState("00");
  const [invalidTime, setInvalidTime] = useState(false);
  const current = validDate(value);
  const active =
    open && !disabled && snapshot.id === id && snapshot.value === value;

  function changeOpen(next: boolean) {
    if (next) {
      setSnapshot({ id, value });
      setInvalidTime(false);
      setDay(current);
      setHour(current ? String(current.getHours()).padStart(2, "0") : "00");
      setMinute(current ? String(current.getMinutes()).padStart(2, "0") : "00");
    }
    setOpen(next);
  }

  function save() {
    if (!active || !day) return;
    const next = new Date(day.getTime());
    next.setHours(Number(hour), Number(minute), 0, 0);
    // A clock-forward gap has no matching instant; never silently move the choice.
    if (
      next.getHours() !== Number(hour) ||
      next.getMinutes() !== Number(minute)
    ) {
      setInvalidTime(true);
      return;
    }
    // During a repeated hour, retain the stored occurrence when both are valid.
    if (current && current.getTimezoneOffset() !== next.getTimezoneOffset()) {
      const sameOffset = new Date(
        next.getTime() +
          (current.getTimezoneOffset() - next.getTimezoneOffset()) * 60000,
      );
      if (
        sameOffset.getFullYear() === next.getFullYear() &&
        sameOffset.getMonth() === next.getMonth() &&
        sameOffset.getDate() === next.getDate() &&
        sameOffset.getHours() === next.getHours() &&
        sameOffset.getMinutes() === next.getMinutes()
      ) {
        next.setTime(sameOffset.getTime());
      }
    }
    // Opening and saving an unchanged minute must not discard existing seconds.
    const unchanged =
      current &&
      current.getFullYear() === next.getFullYear() &&
      current.getMonth() === next.getMonth() &&
      current.getDate() === next.getDate() &&
      current.getHours() === next.getHours() &&
      current.getMinutes() === next.getMinutes();
    setOpen(false);
    if (!unchanged) onChange(next.toISOString());
  }

  return (
    <Popover open={active} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size="sm"
          aria-label={label || t("customFields:formats.datetime")}
          className="w-full min-w-0 max-w-full justify-start font-normal"
          disabled={disabled}
        >
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="min-w-0 truncate">
            {current
              ? current.toLocaleString()
              : t("customFields:value.notSet")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        aria-label={label || t("customFields:formats.datetime")}
      >
        <Calendar
          mode="single"
          selected={day}
          defaultMonth={day}
          onSelect={(selected) => {
            setDay(selected);
            setInvalidTime(false);
          }}
          weekStartsOn={weekStartsOn}
          className="w-full bg-popover"
        />
        <div className="grid grid-cols-2 gap-3 border-t border-border p-3">
          {[
            { name: "hour", value: hour, values: HOURS, change: setHour },
            {
              name: "minute",
              value: minute,
              values: MINUTES,
              change: setMinute,
            },
          ].map((part) => (
            <div className="flex flex-col gap-1" key={part.name}>
              <Label htmlFor={`${id}-${part.name}`}>
                {t(`customFields:value.${part.name}`)}
              </Label>
              <Select
                value={part.value}
                onValueChange={(next) => {
                  if (next !== null && part.values.includes(next)) {
                    part.change(next);
                    setInvalidTime(false);
                  }
                }}
              >
                <SelectTrigger id={`${id}-${part.name}`} className="w-full">
                  <SelectValue>{part.value}</SelectValue>
                </SelectTrigger>
                <SelectContent>
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
        {invalidTime ? (
          <div className="px-3 pb-3">
            <Alert variant="error">
              <AlertDescription>
                {t("customFields:value.invalidLocalTime")}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={value === null}
            onClick={() => {
              if (!active) return;
              setOpen(false);
              onChange(null);
            }}
          >
            {t("customFields:value.clear")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="button" size="sm" disabled={!day} onClick={save}>
              {t("common:actions.save")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
