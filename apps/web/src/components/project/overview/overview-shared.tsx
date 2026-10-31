import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { projectOverviewKeys } from "@/fetchers/project/overview";
import { HttpError } from "@/lib/http-error";

export type BadgeVariant =
  | "default"
  | "destructive"
  | "error"
  | "info"
  | "outline"
  | "secondary"
  | "success"
  | "warning";

export const HEALTH_VARIANT: Record<string, BadgeVariant> = {
  green: "success",
  amber: "warning",
  red: "error",
};

export const STATUS_VARIANT: Record<string, BadgeVariant> = {
  planning: "info",
  active: "success",
  on_hold: "warning",
  closed: "secondary",
};

export const CONTRACT_STATE_VARIANT: Record<string, BadgeVariant> = {
  expired: "error",
  kickoff_pending: "warning",
  expiring: "warning",
  active: "success",
};

export function HealthBadge({ health }: { health: string | null }) {
  const { t } = useTranslation("projectOverview");
  return (
    <Badge variant={health ? (HEALTH_VARIANT[health] ?? "outline") : "outline"}>
      {t(`health.${health ?? "unset"}`)}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("projectOverview");
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"}>
      {t(`status.${status}`)}
    </Badge>
  );
}

/** A Kaneo card with a compact header row: title on the left, actions on the right. */
export function Panel({
  title,
  actions,
  children,
  testId,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId} className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3">
        <CardTitle className="font-semibold text-sm">{title}</CardTitle>
        {actions ? (
          <div className="flex items-center gap-1">{actions}</div>
        ) : null}
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 py-3 text-sm sm:px-6">
        {children}
      </div>
    </Card>
  );
}

/** `YYYY-MM-DD` (or an ISO timestamp) as a medium local date, without a timezone shift. */
export function formatDate(value: string, locale?: string): string {
  const day = value.slice(0, 10);
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(year, month - 1, date),
  );
}

/** Today's calendar day in the viewer's own time zone, `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * True once a stored due day (`YYYY-MM-DD…`, sent as midnight UTC) is before the viewer's
 * local today. Comparing calendar days, not instants, keeps an item on time for its whole
 * due day in every time zone.
 */
export function isPastDay(value: string, now: Date = new Date()): boolean {
  return value.slice(0, 10) < localToday(now);
}

/** Minutes as hours, at most one decimal (`7.5`). */
export function formatHours(minutes: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    minutes / 60,
  );
}

/** The message a refused or failed write shows: the server's 4xx text, else a generic line. */
export function useFailureMessage() {
  const { t } = useTranslation("projectOverview");
  return (error: unknown) => {
    if (error instanceof HttpError) {
      if (error.status === 403) return t("common.forbidden");
      if (error.status === 404) return t("common.notFound");
      if (error.status < 500 && error.message) return error.message;
    }
    return t("common.failed");
  };
}

/** Refresh every Overview query for one project (counts, panels, tabs) after a write. */
export function useRefreshOverview(projectId: string) {
  const cache = useQueryClient();
  return () =>
    Promise.all([
      cache.invalidateQueries({
        queryKey: [projectOverviewKeys.all[0], projectId],
      }),
      cache.invalidateQueries({ queryKey: ["projects"] }),
    ]);
}

/** Kaneo's Select popover over a fixed list of options (never a native select). */
export function OptionSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  id: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      items={[...options]}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const match = options.find((option) => option.value === next);
        if (match) onChange(match.value);
      }}
    >
      <SelectTrigger id={id} className={className ?? "w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
