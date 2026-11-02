import { Link } from "@tanstack/react-router";
import { Card, cn } from "@taskdesk/ui";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Icon chip colours, from the same status tokens as `Badge`. */
const tones = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/8 text-info-foreground dark:bg-info/16",
  warning: "bg-warning/8 text-warning-foreground dark:bg-warning/16",
  success: "bg-success/8 text-success-foreground dark:bg-success/16",
  error: "bg-destructive/8 text-destructive-foreground dark:bg-destructive/16",
} as const;

export type PortalKpiTone = keyof typeof tones;

/**
 * One dashboard figure (WSO2-style KPI tile) on Kaneo's `Card`: label, value, an optional hint
 * line, and an optional link to the list the figure counts. The value is announced with its
 * label because both sit in one element.
 */
export function PortalKpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: PortalKpiTone;
  /** A registered portal path built with `routes.*`. */
  to?: string;
}) {
  return (
    <Card
      render={to ? <Link to={to} /> : undefined}
      className={cn(
        "flex-row items-start gap-3 p-4",
        to &&
          "outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
      )}
      data-slot="portal-kpi-card"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          tones[tone],
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-muted-foreground text-sm">{label}</span>
        <span className="font-semibold text-2xl text-foreground tabular-nums leading-tight">
          {value}
        </span>
        {hint ? (
          <span className="truncate text-muted-foreground text-xs">{hint}</span>
        ) : null}
      </span>
    </Card>
  );
}
