import { cn, ScrollArea } from "@taskdesk/ui";
import { MoveHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReportChartData } from "@/fetchers/report";
import { useElementWidth } from "@/lib/use-element-width";

/**
 * `RP-11`: charts are inline SVG drawn with design tokens only (`fill-chart-*`, `stroke-border`,
 * `fill-muted-foreground`). Every chart has a table equivalent next to it (the report screen's
 * "Table" tab), so a chart alone is never the only way to read a number. A `null` point is a gap,
 * never a zero (`RP-1`).
 *
 * Fit (Thomas, 3 Nov): the chart is drawn at the width of its container, in real pixels, so its
 * text never shrinks. When the categories need more room than the container has, the drawing is
 * wider and scrolls inside its own named frame, with a visible hint; the page never scrolls
 * sideways. Axis labels are never shortened: labels of several words wrap under their bar, and
 * single-word labels (dates, buckets) turn 45 degrees. In a fixed-height frame (a dashboard
 * widget) the plot gives up height so the whole figure fits.
 */

/** Height of the plotting area, in pixels; axis labels add to it. */
export const PLOT_HEIGHT = 200;
/** Width used before the container has been measured (and in tests without layout). */
export const FALLBACK_WIDTH = 640;
const PAD_TOP = 12;
const PAD_RIGHT = 12;
/** Average width of one character of the 10 px axis text, rounded up. */
const CHAR_WIDTH = 6;
/** Height of one line of axis text. */
const LINE_HEIGHT = 14;
const COS_45 = Math.SQRT1_2;
/** Wrapped category labels: the most lines, and the distance between them. */
const MAX_LABEL_LINES = 4;
const WRAP_LINE = 12;
/** The smallest plot a fitted chart shrinks to; below it the frame scrolls instead. */
export const MIN_PLOT_HEIGHT = 80;
/** The scroll hint line and the gap under it. */
const HINT_HEIGHT = 24;
/** Room the frame keeps under a sideways-scrolling drawing for its scrollbar. */
const SCROLLBAR_GUTTER = 10;
/** Legend text (12 px): average character width, line height and the gaps between items. */
const LEGEND_CHAR_WIDTH = 7;
const LEGEND_LINE = 16;
const LEGEND_ROW_GAP = 4;
const LEGEND_ITEM_GAP = 16;
/** The swatch and its gap before the legend text. */
const LEGEND_SWATCH = 16;

/**
 * Height of a wrapping legend (with the gap above it) in a container `width` pixels wide: items
 * are packed left to right, as the flex-wrap legend lays them out. No legend for one series.
 */
export function legendHeight(labels: readonly string[], width: number): number {
  if (labels.length < 2) return 0;
  let lines = 1;
  let used = 0;
  for (const label of labels) {
    const item = LEGEND_SWATCH + Math.ceil(label.length * LEGEND_CHAR_WIDTH);
    const next = used === 0 ? item : used + LEGEND_ITEM_GAP + item;
    if (used > 0 && next > width) {
      lines += 1;
      used = item;
    } else used = next;
  }
  return 8 + lines * LEGEND_LINE + (lines - 1) * LEGEND_ROW_GAP;
}

export type ChartLayout = {
  /** The drawing's width; more than the container's when it scrolls. */
  width: number;
  height: number;
  /** Height of the plotting area: `PLOT_HEIGHT`, or less to fit a fixed frame. */
  plotHeight: number;
  padLeft: number;
  padBottom: number;
  /** Horizontal room per category. */
  slot: number;
  /** Label every `every`-th category (1 labels all of them). */
  every: number;
  /** Category labels are turned 45 degrees to fit. */
  rotate: boolean;
  /** The drawing is wider than the container and scrolls inside its frame. */
  scrolls: boolean;
  /** Category labels wrapped onto lines under their bar, or `null` (upright or turned). */
  lines: string[][] | null;
};

/**
 * `label` broken at spaces into lines of at most `maxChars` characters. A word longer than the
 * line stays whole on its own line: a label is never cut.
 */
export function wrapLabel(label: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of label.split(/\s+/u).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [label];
}

/** Estimated width of a line of axis text, in pixels. */
export function textWidth(text: string): number {
  return Math.ceil(text.length * CHAR_WIDTH);
}

/**
 * Where everything goes for a chart in a container `containerWidth` pixels wide. Pure, so the
 * fit rules are unit-tested without a browser.
 */
export function chartLayout({
  containerWidth,
  categories,
  seriesCount,
  type,
  tickLabels,
  fitHeight,
  legendLabels = [],
}: {
  containerWidth: number;
  categories: readonly string[];
  seriesCount: number;
  type: ReportChartData["type"];
  tickLabels: readonly string[];
  /** The whole figure must fit this height (a dashboard widget); unbounded when omitted. */
  fitHeight?: number | undefined;
  /** The legend's entries (shown when there is more than one series). */
  legendLabels?: readonly string[];
}): ChartLayout {
  const count = Math.max(1, categories.length);
  const container = Math.max(0, Math.floor(containerWidth));
  // Bars need room to stay distinguishable; points need less.
  const minSlot =
    type === "bar" ? Math.max(20, Math.max(1, seriesCount) * 8 + 8) : 16;
  const axisWidth = Math.max(
    32,
    ...tickLabels.map((label) => textWidth(label) + 10),
  );
  const longest = Math.max(0, ...categories.map(textWidth));

  const place = (padLeft: number) => {
    const natural = (container - padLeft - PAD_RIGHT) / count;
    const scrolls = natural < minSlot;
    return { slot: scrolls ? minSlot : natural, scrolls };
  };
  // In a fixed-height frame (a dashboard widget) the plot gives up height so the whole figure,
  // labels, hint and legend included, fits without scrolling or a fade over the labels.
  const finish = (
    placed: Omit<ChartLayout, "width" | "height" | "plotHeight">,
  ): ChartLayout => {
    const width = placed.scrolls
      ? Math.ceil(placed.padLeft + PAD_RIGHT + placed.slot * count)
      : Math.max(container, placed.padLeft + PAD_RIGHT + count);
    const reserved =
      (placed.scrolls ? HINT_HEIGHT + SCROLLBAR_GUTTER : 0) +
      legendHeight(legendLabels, container);
    const plotHeight =
      fitHeight === undefined
        ? PLOT_HEIGHT
        : Math.min(
            PLOT_HEIGHT,
            Math.max(
              MIN_PLOT_HEIGHT,
              Math.floor(fitHeight - PAD_TOP - placed.padBottom - reserved),
            ),
          );
    return {
      ...placed,
      width,
      height: PAD_TOP + plotHeight + placed.padBottom,
      plotHeight,
    };
  };
  let padLeft = axisWidth;
  let { slot, scrolls } = place(padLeft);
  // Labels of several words ("Infrastructure managed services platform") wrap under their bar;
  // the slot widens to the longest word if it must, and the chart then scrolls sideways.
  // Single-word labels (dates, buckets) that do not fit are turned instead.
  if (longest + 6 > slot && categories.some((label) => label.includes(" "))) {
    const longestWord = Math.max(
      0,
      ...categories.flatMap((label) => label.split(/\s+/u).map(textWidth)),
    );
    const wrapSlot = Math.max(slot, longestWord + 6);
    const lines = categories.map((label) =>
      wrapLabel(label, Math.floor((wrapSlot - 6) / CHAR_WIDTH)),
    );
    const most = Math.max(1, ...lines.map((label) => label.length));
    if (most <= MAX_LABEL_LINES) {
      const widened = wrapSlot > slot;
      const drawn = widened ? wrapSlot : slot;
      return finish({
        padLeft,
        slot: drawn,
        scrolls: scrolls || widened,
        every: 1,
        rotate: false,
        lines,
        padBottom: LINE_HEIGHT + (most - 1) * WRAP_LINE + 14,
      });
    }
  }
  let rotate = longest + 6 > slot;
  // The first rotated label reaches left of its category by its own width times cos 45, plus the
  // turned height of the text. Widening the left edge narrows every slot a little, so settle it
  // over a few rounds (each round moves the edge by at most 1/(2 x categories) of the last).
  for (let round = 0; rotate && round < 8; round += 1) {
    const reach = Math.ceil(longest * COS_45 - slot / 2 + 10);
    if (reach <= padLeft) break;
    padLeft = reach;
    ({ slot, scrolls } = place(padLeft));
    rotate = longest + 6 > slot;
  }
  return finish({
    padLeft,
    slot,
    scrolls,
    every: rotate ? Math.max(1, Math.ceil(LINE_HEIGHT / slot)) : 1,
    rotate,
    lines: null,
    padBottom: rotate
      ? Math.ceil(longest * COS_45 + LINE_HEIGHT * COS_45 + 12)
      : LINE_HEIGHT + 14,
  });
}

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
  fitHeight,
}: {
  chart: ReportChartData;
  /** The accessible name: what the chart shows. */
  label: string;
  className?: string;
  /** Fit the whole figure into this height (a dashboard widget); natural height when omitted. */
  fitHeight?: number | undefined;
}) {
  const { t } = useTranslation();
  const { width: measured, measureRef } = useElementWidth();
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
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max);
  const tickText = (tick: number) =>
    formatChartValue(Math.round(tick * 10) / 10, chart.unit);
  const layout = chartLayout({
    containerWidth: measured ?? FALLBACK_WIDTH,
    categories: chart.categories,
    seriesCount: chart.series.length,
    type: chart.type,
    tickLabels: ticks.map(tickText),
    fitHeight,
    legendLabels: chart.series.map(seriesLabel),
  });
  const { width, height, plotHeight, padLeft, slot, every, rotate, lines } =
    layout;
  const plotBottom = PAD_TOP + plotHeight;
  const y = (value: number) => plotBottom - (value / max) * plotHeight;
  const bar = chart.type === "bar";
  const groupWidth = Math.min(slot * 0.8, 72);
  const barWidth = groupWidth / Math.max(1, chart.series.length);
  const centre = (index: number) => padLeft + slot * index + slot / 2;
  return (
    <figure className={cn("w-full min-w-0 space-y-2", className)}>
      {layout.scrolls ? (
        <p
          className="flex items-center gap-1.5 text-muted-foreground text-xs"
          data-testid="chart-scroll-hint"
        >
          <MoveHorizontal aria-hidden="true" className="size-3.5 shrink-0" />
          {t("reports:chartScroll.hint", { count: chart.categories.length })}
        </p>
      ) : null}
      <div
        ref={measureRef}
        className="w-full min-w-0"
        data-slot="chart-frame"
        // Named as a region only while it scrolls, so a fitting chart adds no landmark.
        {...(layout.scrolls
          ? {
              role: "region",
              "aria-label": t("reports:chartScroll.region", { label }),
            }
          : {})}
      >
        <ScrollArea className="h-auto" scrollFade scrollbarGutter>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={label}
            className="block"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={padLeft}
                  x2={width - PAD_RIGHT}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={padLeft - 6}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {tickText(tick)}
                </text>
              </g>
            ))}
            {chart.categories.map((category, index) =>
              index % every === 0 ? (
                <text
                  // biome-ignore lint/suspicious/noArrayIndexKey: categories are positional and may repeat
                  key={`${category}-${index}`}
                  x={centre(index)}
                  y={plotBottom + 14}
                  textAnchor={rotate ? "end" : "middle"}
                  transform={
                    rotate
                      ? `rotate(-45 ${centre(index)} ${plotBottom + 14})`
                      : undefined
                  }
                  className="fill-muted-foreground text-[10px]"
                >
                  {lines?.[index]
                    ? lines[index].map((line, lineIndex) => (
                        <tspan
                          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
                          key={lineIndex}
                          x={centre(index)}
                          dy={lineIndex === 0 ? 0 : WRAP_LINE}
                        >
                          {line}
                        </tspan>
                      ))
                    : category}
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
                      padLeft +
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
                        height={Math.max(0, plotBottom - top)}
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
                                `${centre(point.index)},${y(point.value)}`,
                            )
                            .join(" ")}
                        />
                      ))}
                      {series.values.map((value, index) =>
                        value === null ? null : (
                          <circle
                            // biome-ignore lint/suspicious/noArrayIndexKey: positional marks
                            key={`${series.key}-${index}`}
                            cx={centre(index)}
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
        </ScrollArea>
      </div>
      {chart.series.length > 1 ? (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          {chart.series.map((series, index) => (
            <span key={series.key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-sm",
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
