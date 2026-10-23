import { Badge } from "@taskdesk/ui";
import { CircleAlert, CircleCheck, CircleX, Clock } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

export type WorkItemSlaBadgeValue = {
  metric: "first_response" | "resolution";
  state: "ok" | "at_risk" | "breached" | "met" | "missed";
  remainingMinutes: number | null;
};

const STATES: Record<
  WorkItemSlaBadgeValue["state"],
  {
    variant: "success" | "warning" | "destructive" | "secondary";
    Icon: ComponentType<{ className?: string; "aria-hidden"?: "true" }>;
  }
> = {
  ok: { variant: "success", Icon: Clock },
  at_risk: { variant: "warning", Icon: CircleAlert },
  breached: { variant: "destructive", Icon: CircleX },
  met: { variant: "secondary", Icon: CircleCheck },
  missed: { variant: "destructive", Icon: CircleX },
};

/** Covered (calendar-window) minutes as the shortest unit: `45m`, `3h`, `2d`. */
export function formatSlaRemaining(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

/**
 * `VW-16` / `SLA-18` / `SLA-20`: the compact SLA badge on a list row: colour, icon and
 * remaining time, and never colour alone (the icon and the word carry the state too).
 * Renders nothing for a row with no SLA, or a producer that does not resolve it. Kaneo
 * `Badge`.
 */
export function WorkItemSlaBadge({
  sla,
  className,
}: {
  sla: WorkItemSlaBadgeValue | undefined | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!sla) return null;
  const { variant, Icon } = STATES[sla.state] ?? STATES.ok;
  const open = sla.state === "ok" || sla.state === "at_risk";
  const label =
    open && sla.remainingMinutes !== null
      ? t("workItems:sla.remaining", {
          time: formatSlaRemaining(sla.remainingMinutes),
        })
      : t(`workItems:sla.state.${sla.state}`);
  return (
    <Badge
      variant={variant}
      className={className}
      data-testid="work-item-sla-badge"
      data-sla-state={sla.state}
      title={t("workItems:sla.title", {
        metric: t(`workItems:sla.metric.${sla.metric}`),
        state: t(`workItems:sla.state.${sla.state}`),
      })}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </Badge>
  );
}

export default WorkItemSlaBadge;
