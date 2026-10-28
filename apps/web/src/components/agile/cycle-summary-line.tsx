import { Progress } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { CycleSummary } from "@/fetchers/agile";
import { formatScopeAmount } from "./agile-format";

/** Completed of total, in the cycle's unit, with a progress bar (`CY-7`). */
export function CycleSummaryLine({ summary }: { summary: CycleSummary }) {
  const { t } = useTranslation("agile");
  const done = summary.completed.points;
  const total = summary.total.points;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Progress value={percent} aria-label={t("summary.progress")} />
      <p className="text-muted-foreground text-xs">
        {summary.unit === "count"
          ? t("summary.countLine", {
              done: summary.completed.count,
              total: summary.total.count,
            })
          : t("summary.amountLine", {
              done: formatScopeAmount(done, summary.unit),
              total: formatScopeAmount(total, summary.unit),
              unit: t(`units.${summary.unit}`),
            })}
      </p>
    </div>
  );
}
