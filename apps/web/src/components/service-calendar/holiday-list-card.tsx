import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("serviceCalendars");
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{t("holidays.title")}</CardTitle>
          <CardDescription>{t("holidays.description")}</CardDescription>
          <p className="text-xs text-muted-foreground">
            {t("holidays.pastWarning")}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" />
          {t("holidays.add")}
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
          <p className="text-sm text-muted-foreground">{t("holidays.none")}</p>
        )}
      </CardContent>
    </Card>
  );
}
