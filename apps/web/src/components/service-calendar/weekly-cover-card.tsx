import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { WindowFields } from "@/components/service-calendar/window-fields";
import type { CalendarWindow, Weekday } from "@/fetchers/service-calendar";
import type { CalendarWindowsForm } from "@/lib/service-calendar-form";
import { WEEKDAYS } from "@/lib/service-calendar-form";

export function WeeklyCoverCard({
  windows,
  windowIds,
  windowError,
  onDragEnd,
  onChange,
  onAdd,
  onRemove,
}: {
  windows: CalendarWindowsForm;
  windowIds: Record<Weekday, string[]>;
  windowError: string;
  onDragEnd: (event: DragEndEvent) => void;
  onChange: (
    day: Weekday,
    index: number,
    patch: Partial<CalendarWindow>,
  ) => void;
  onAdd: (day: Weekday) => void;
  onRemove: (day: Weekday, index: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly cover</CardTitle>
        <CardDescription>
          Windows use local wall-clock times in the selected timezone. Add
          separate windows around breaks; a window cannot cross midnight.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DndContext
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={onDragEnd}
          sensors={sensors}
        >
          {WEEKDAYS.map(({ key, label }) => (
            <section
              key={key}
              aria-labelledby={`calendar-day-${key}`}
              className="grid gap-3 border-b border-border pb-4 last:border-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start"
            >
              <h3
                id={`calendar-day-${key}`}
                className="pt-2 text-sm font-medium"
              >
                {label}
              </h3>
              <div className="space-y-2">
                {windows[key].length ? (
                  windows[key].map((window, index) => (
                    <WindowFields
                      key={windowIds[key][index]}
                      id={windowIds[key][index]}
                      day={key}
                      index={index}
                      window={window}
                      onChange={(patch) => onChange(key, index, patch)}
                      onRemove={() => onRemove(key, index)}
                    />
                  ))
                ) : (
                  <p className="py-2 text-sm text-muted-foreground">No cover</p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAdd(key)}
                aria-label={`Add window on ${label}`}
              >
                <Plus aria-hidden="true" />
                Add window
              </Button>
            </section>
          ))}
        </DndContext>
        {windowError ? (
          <p className="text-sm text-destructive" role="alert">
            {windowError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
