import { cn } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { ReportChartData } from "@/fetchers/report";

/**
 * `RP-11`: charts are inline SVG drawn with design tokens only (`fill-chart-*`, `stroke-border`,
 * `fill-muted-foreground`). Every chart has a table equivalent next to it (the report screen's
 * "Table" tab), so a chart alone is never the only way to read a number. A `null` point is a gap,
 * never a zero (`RP-1`).
 */

const WIDTH = 640;
const HEIGHT = 260;
const PAD = { left: 48, right: 12, top: 12, bottom: 56 };
const INNER_W = WIDTH - PAD.left - PAD.right;
const INNER_H = HEIGHT - PAD.top - PAD.bottom;

const SERIES_CLASSES = [
  { fill: "fill-chart-1", stroke: "stroke-chart-1", swatch: "bg-chart-1" },
  { fill: "fill-chart-2", stroke: "stroke-chart-2", swatch: "bg-chart-2" },
  { fill: "fill-chart-3", stroke: "stroke-chart-3", swatch: "bg-chart-3" },
  { fill: "fill-chart-4", stroke: "stroke-chart-4", swatch: "bg-chart-4" },
  { fill: "fill-chart-5", stroke: "stroke-chart-5", swatch: "bg-chart-5" },
] as const;

/** A readable axis maximum above `value`: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * exponent) return step * exponent;
  }
  return 10 * exponent;
}

/** Runs of consecutive non-null points: a gap in the data breaks the line. */
export function lineSegments(
  values: ReadonlyArray<number | null>,
): Array<Array<{ index: number; value: number }>> {
  const segments: Array<Array<{ index: number; value: number }>> = [];
  let current: Array<{ index: number; value: number }> = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ index, value });
  });
  if (current.length) segments.push(current);
  return segments;
}

export function formatChartValue(
  value: number,
  unit: ReportChartData["unit"],
): string {
  if (unit === "percent") return `${value}%`;
  if (unit === "hours") return `${value} h`;
  if (unit === "days") return `${value} d`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shorten(label: string, max = 14) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** The i18n key part of a server-sent series label ("8-30 days" becomes "8_30_days"). */
export function seriesKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function ReportChart({
  chart,
  label,
  className,
}: {
  chart: ReportChartData;
  /** The accessible name: what the chart shows. */
  label: string;
  className?: string;
}) {
  const { t } = useTranslation();
  // Series labels are English strings from the server; known ones are translated and an unknown
  // one (an organisation name, a priority) keeps its own text.
  const seriesLabel = (series: { label: string }) =>
    t(`reports:series.${seriesKey(series.label)}`, {
      defaultValue: series.label,
    });
  const present = chart.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null),
  );
  const max = niceMax(Math.max(0, ...present));
  const count = Math.max(1, chart.categories.length);
  const slot = INNER_W / count;
  const y = (value: number) => PAD.top + INNER_H - (value / max) * INNER_H;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max);
  const every = Math.ceil(count / 12);
  const bar = chart.type === "bar";
  const groupWidth = Math.min(slot * 0.8, 72);
  const barWidth = groupWidth / Math.max(1, chart.series.length);
  return (
    <figure className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
      >
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
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {formatChartValue(Math.round(tick * 10) / 10, chart.unit)}
            </text>
          </g>
        ))}
        {chart.categories.map((category, index) =>
          index % every === 0 ? (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: categories are positional and may repeat
              key={`${category}-${index}`}
              x={PAD.left + slot * index + slot / 2}
              y={HEIGHT - PAD.bottom + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {shorten(category)}
            </text>
          ) : null,
        )}
        {bar
          ? chart.series.map((series, seriesIndex) => {
              const classes =
                SERIES_CLASSES[seriesIndex % SERIES_CLASSES.length] ??
                SERIES_CLASSES[0];
              return series.values.map((value, index) => {
                if (value === null) return null;
                const x =
                  PAD.left +
                  slot * index +
                  (slot - groupWidth) / 2 +
                  barWidth * seriesIndex;
                const top = y(value);
                return (
                  <rect
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional marks
                    key={`${series.key}-${index}`}
                    x={x}
                    y={top}
                    width={Math.max(1, barWidth - 2)}
                    height={Math.max(0, PAD.top + INNER_H - top)}
                    rx={2}
                    className={classes.fill}
                  >
                    <title>
                      {`${seriesLabel(series)}, ${chart.categories[index]}: ${formatChartValue(value, chart.unit)}`}
                    </title>
                  </rect>
                );
              });
            })
          : chart.series.map((series, seriesIndex) => {
              const classes =
                SERIES_CLASSES[seriesIndex % SERIES_CLASSES.length] ??
                SERIES_CLASSES[0];
              return (
                <g key={series.key}>
                  {lineSegments(series.values).map((segment) => (
                    <polyline
                      key={`${series.key}-${segment[0]?.index}`}
                      fill="none"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className={classes.stroke}
                      points={segment
                        .map(
                          (point) =>
                            `${PAD.left + slot * point.index + slot / 2},${y(point.value)}`,
                        )
                        .join(" ")}
                    />
                  ))}
                  {series.values.map((value, index) =>
                    value === null ? null : (
                      <circle
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional marks
                        key={`${series.key}-${index}`}
                        cx={PAD.left + slot * index + slot / 2}
                        cy={y(value)}
                        r={3}
                        className={classes.fill}
                      >
                        <title>
                          {`${seriesLabel(series)}, ${chart.categories[index]}: ${formatChartValue(value, chart.unit)}`}
                        </title>
                      </circle>
                    ),
                  )}
                </g>
              );
            })}
      </svg>
      {chart.series.length > 1 ? (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          {chart.series.map((series, index) => (
            <span key={series.key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 rounded-sm",
                  SERIES_CLASSES[index % SERIES_CLASSES.length]?.swatch,
                )}
              />
              {seriesLabel(series)}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
