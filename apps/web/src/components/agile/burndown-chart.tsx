import {
  Alert,
  AlertDescription,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { Burndown } from "@/fetchers/agile";
import { formatCalendarDate, formatScopeAmount } from "./agile-format";

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 40 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((n) => n * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * `CY-7`: the burndown of a cycle drawn as inline SVG with design tokens only, with the same
 * numbers in a table below it (the accessible equivalent). "No scope" is stated, never drawn as
 * a flat line, and a change of estimate system mid-cycle is noted instead of hidden. A cycle
 * completed with everything incomplete simply shows the remaining line where it ended.
 */
export function BurndownChart({ burndown }: { burndown: Burndown }) {
  const { t, i18n } = useTranslation("agile");
  const locale = i18n.language;
  if (burndown.noScope)
    return (
      <Empty data-testid="burndown-no-scope">
        <EmptyHeader>
          <EmptyTitle>{t("burndown.noScopeTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("burndown.noScopeDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  const { points, unit } = burndown;
  const peak = points.reduce(
    (max, point) => Math.max(max, point.scope, point.remaining, point.ideal),
    0,
  );
  const top = niceMax(peak);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left +
    (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) =>
    PAD.top + plotHeight - (value / top) * plotHeight;
  const path = (pick: (point: (typeof points)[number]) => number) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(pick(point)).toFixed(1)}`,
      )
      .join(" ");
  const ticks = [0, 0.5, 1].map((fraction) => top * fraction);
  const description = t("burndown.chartDescription", {
    start: formatCalendarDate(burndown.startDate, locale),
    end: formatCalendarDate(burndown.endDate, locale),
    unit: t(`units.${unit}`),
  });
  const last = points.at(-1);

  return (
    <div className="flex flex-col gap-3" data-testid="burndown">
      {burndown.discontinuities.length > 0 ? (
        <Alert variant="warning" data-testid="burndown-discontinuity">
          <AlertDescription>
            {burndown.discontinuities
              .map((entry) =>
                t("burndown.discontinuity", {
                  date: formatCalendarDate(entry.date, locale),
                  from: entry.fromSystem
                    ? t(`systems.${entry.fromSystem}`)
                    : t("systems.none"),
                  to: entry.toSystem
                    ? t(`systems.${entry.toSystem}`)
                    : t("systems.none"),
                }),
              )
              .join(" ")}
          </AlertDescription>
        </Alert>
      ) : null}
      {burndown.unestimated.count > 0 && unit !== "count" ? (
        <p className="text-muted-foreground text-xs">
          {t("burndown.unestimated", {
            count: burndown.unestimated.count,
            percent: Math.round(burndown.unestimated.share * 100),
          })}
        </p>
      ) : null}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={description}
        className="h-auto w-full max-w-3xl text-muted-foreground"
        data-testid="burndown-svg"
      >
        <title>{description}</title>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {formatScopeAmount(tick, unit)}
            </text>
          </g>
        ))}
        <path
          d={path((point) => point.ideal)}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          data-testid="burndown-ideal"
        />
        <path
          d={path((point) => point.scope)}
          fill="none"
          className="stroke-warning"
          strokeWidth={1.5}
          data-testid="burndown-scope"
        />
        <path
          d={path((point) => point.remaining)}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          data-testid="burndown-remaining"
        />
        {points.length > 0 ? (
          <>
            <text
              x={PAD.left}
              y={HEIGHT - 8}
              className="fill-muted-foreground text-[10px]"
            >
              {formatCalendarDate(points[0]?.date ?? "", locale)}
            </text>
            <text
              x={WIDTH - PAD.right}
              y={HEIGHT - 8}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {formatCalendarDate(last?.date ?? "", locale)}
            </text>
          </>
        ) : null}
      </svg>
      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4 bg-primary"
          />
          {t("burndown.legend.remaining")}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4 bg-warning"
          />
          {t("burndown.legend.scope")}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4 bg-muted-foreground"
          />
          {t("burndown.legend.ideal")}
        </li>
      </ul>
      <div className="max-h-56 overflow-auto rounded-md border">
        <Table data-testid="burndown-table">
          <TableCaption className="sr-only">{description}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("burndown.columns.date")}</TableHead>
              <TableHead className="text-end">
                {t("burndown.columns.scope")}
              </TableHead>
              <TableHead className="text-end">
                {t("burndown.columns.completed")}
              </TableHead>
              <TableHead className="text-end">
                {t("burndown.columns.remaining")}
              </TableHead>
              <TableHead className="text-end">
                {t("burndown.columns.ideal")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((point) => (
              <TableRow key={point.date}>
                <TableCell>{formatCalendarDate(point.date, locale)}</TableCell>
                <TableCell className="text-end">
                  {formatScopeAmount(point.scope, unit)}
                </TableCell>
                <TableCell className="text-end">
                  {formatScopeAmount(point.completed, unit)}
                </TableCell>
                <TableCell className="text-end">
                  {formatScopeAmount(point.remaining, unit)}
                </TableCell>
                <TableCell className="text-end">
                  {formatScopeAmount(point.ideal, unit)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
