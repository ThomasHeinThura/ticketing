import { Badge } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { ModuleForecast } from "@/fetchers/agile";
import {
  FORECAST_VARIANT,
  formatCalendarDate,
  hasForecastRange,
} from "./agile-format";

/**
 * `MO-4`: whether the current rate will meet the target date, as a range ("between X and Y"),
 * never a single date. Without enough recent completions it says so instead of guessing.
 */
export function ModuleForecastText({ forecast }: { forecast: ModuleForecast }) {
  const { t, i18n } = useTranslation("agile");
  if (hasForecastRange(forecast))
    return (
      <span
        className="flex flex-wrap items-center gap-2"
        data-testid="forecast"
      >
        <Badge variant={FORECAST_VARIANT[forecast.status as "on_track"]}>
          {t(`modules.forecast.${forecast.status}`)}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {t("modules.forecast.range", {
            earliest: formatCalendarDate(forecast.earliest, i18n.language),
            latest: formatCalendarDate(forecast.latest, i18n.language),
            target: formatCalendarDate(forecast.targetDate, i18n.language),
          })}
        </span>
      </span>
    );
  return (
    <span className="text-muted-foreground text-xs" data-testid="forecast">
      {t(`modules.forecast.${forecast.status}`, {
        completed:
          forecast.status === "insufficient_data"
            ? forecast.completedInWindow
            : 0,
      })}
    </span>
  );
}
