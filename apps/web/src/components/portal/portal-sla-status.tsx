import { Badge } from "@taskdesk/ui";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { describeDue, type PortalSla } from "@/lib/portal-request";

const BADGE = {
  on_track: "success",
  at_risk: "warning",
  breached: "error",
  met: "success",
  missed: "error",
} as const;

/**
 * CP-6: the customer's due time and a plain-language state ("Resolution due by 2:00 PM today"),
 * never a percentage or a policy name. Renders nothing when the request has no service target.
 */
export function PortalSlaStatus({
  sla,
  now = new Date(),
}: {
  sla: PortalSla | null;
  now?: Date;
}) {
  const { t, i18n } = usePortalTranslation("portal");
  if (!sla) return null;
  const finished = sla.state === "met" || sla.state === "missed";
  const late = sla.state === "breached" || sla.state === "missed";
  const due =
    sla.dueAt && !finished ? describeDue(sla.dueAt, now, i18n.language) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={BADGE[sla.state]}>
        {t(`request.sla.state.${sla.state}`)}
      </Badge>
      {due ? (
        <span className="text-sm">
          {t(
            `request.sla.${late ? "wasDue" : "due"}.${sla.metric ?? "resolution"}.${due.day}`,
            {
              time: due.time,
              date: due.date,
            },
          )}
        </span>
      ) : null}
    </div>
  );
}
