import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { HolidayFields } from "@/components/service-calendar/holiday-fields";
import type { Holiday } from "@/fetchers/service-calendar";

export function HolidayListCard({
  holidays,
  holidayIds,
  onAdd,
  onChange,
  onPatch,
  onRemove,
}: {
  holidays: Holiday[];
  holidayIds: string[];
  onAdd: () => void;
  onChange: (index: number, holiday: Holiday) => void;
  onPatch: (index: number, patch: Partial<Holiday>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Holidays</CardTitle>
          <CardDescription>
            A holiday removes all cover for that calendar-local date. Annual
            rules stay recurring without yearly expansion.
          </CardDescription>
          <p className="text-xs text-muted-foreground">
            Adding a past holiday can move deadlines later. The affected item
            count is unavailable until calendar usage is implemented.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add holiday
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {holidays.length ? (
          holidays.map((holiday, index) => (
            <HolidayFields
              key={holidayIds[index]}
              holiday={holiday}
              index={index}
              onChange={(next) => onChange(index, next)}
              onPatch={(patch) => onPatch(index, patch)}
              onRemove={() => onRemove(index)}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No holidays configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
