import { Badge } from "@taskdesk/ui";
import { formatDate } from "@/lib/format";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";

type BadgeVariant = "info" | "success" | "warning" | "error" | "secondary";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  planning: "info",
  active: "success",
  on_hold: "warning",
  closed: "secondary",
};

const HEALTH_VARIANT: Record<string, BadgeVariant> = {
  green: "success",
  amber: "warning",
  red: "error",
};

const KNOWN_STATUSES = new Set(Object.keys(STATUS_VARIANT));
const KNOWN_HEALTH = new Set(Object.keys(HEALTH_VARIANT));

/** The project's lifecycle status (planning, active, on hold, closed). */
export function PortalProjectStatusBadge({ status }: { status: string }) {
  const { t } = usePortalTranslation("portal");
  if (!KNOWN_STATUSES.has(status)) return null;
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
      {t(`projects.status.${status}`)}
    </Badge>
  );
}

/** Red/amber/green health, labelled in words so colour is never the only signal. */
export function PortalProjectHealthBadge({
  health,
}: {
  health: string | null;
}) {
  const { t } = usePortalTranslation("portal");
  if (!health || !KNOWN_HEALTH.has(health)) return null;
  return (
    <Badge variant={HEALTH_VARIANT[health] ?? "secondary"}>
      <span className="sr-only">{t("projects.health.label")}: </span>
      {t(`projects.health.${health}`)}
    </Badge>
  );
}

/**
 * A calendar day (`YYYY-MM-DD`) or a midnight-UTC timestamp, shown as that day everywhere: the
 * date is formatted in UTC so a viewer west of Greenwich never sees the previous day.
 */
export function formatPortalCalendarDate(value: string) {
  const instant = /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  return formatDate(instant, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Minutes as hours with at most one decimal, in the reader's locale. */
export function formatPortalHours(minutes: number, locale?: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    minutes / 60,
  );
}
