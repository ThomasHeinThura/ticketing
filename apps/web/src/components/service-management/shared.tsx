import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChangeRisk, ServiceStatus } from "@/fetchers/service-management";
import { isFeatureDisabled } from "@/hooks/queries/service-management";
import { routes } from "@/lib/routes";

const STATUS_VARIANT = {
  operational: "success",
  degraded: "warning",
  outage: "destructive",
} as const satisfies Record<
  ServiceStatus,
  "success" | "warning" | "destructive"
>;

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
  const { t } = useTranslation("serviceManagement");
  return (
    <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>
  );
}

const RISK_VARIANT = {
  low: "success",
  medium: "warning",
  high: "destructive",
} as const satisfies Record<ChangeRisk, "success" | "warning" | "destructive">;

export function RiskBadge({ risk }: { risk: ChangeRisk | null }) {
  const { t } = useTranslation("serviceManagement");
  return risk ? (
    <Badge variant={RISK_VARIANT[risk]}>{t(`risk.${risk}`)}</Badge>
  ) : (
    <Badge variant="outline">{t("risk.unset")}</Badge>
  );
}

/** The page frame every service-management screen shares: title, description, actions. */
export function PageFrame({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function LoadingRows() {
  const { t } = useTranslation("serviceManagement");
  return (
    <div role="status" aria-label={t("common.loading")} className="space-y-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

/** A failed read: a disabled feature gets its own explanation, anything else offers a retry. */
export function QueryFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useTranslation("serviceManagement");
  if (isFeatureDisabled(error))
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("disabled.title")}</EmptyTitle>
          <EmptyDescription>{t("disabled.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <Alert variant="error">
      <AlertTitle>{t("common.loadErrorTitle")}</AlertTitle>
      <AlertDescription>
        {t("common.loadErrorDescription")}
        <Button className="w-fit" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          {t("common.retry")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function MutationError({ error }: { error: unknown }) {
  const { t } = useTranslation("serviceManagement");
  if (!error) return null;
  return (
    <Alert variant="error">
      <AlertDescription>
        {error instanceof Error && error.message
          ? error.message
          : t("common.requestFailed")}
      </AlertDescription>
    </Alert>
  );
}

/** `datetime-local` input value from an ISO instant, in the viewer's timezone. */
export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO instant from a `datetime-local` input value; null when empty or invalid. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const SECTIONS = [
  { key: "services", route: routes.serviceManagementServices },
  { key: "changes", route: routes.serviceManagementChanges },
  { key: "releases", route: routes.serviceManagementReleases },
] as const;

/** The three service-management screens, as links so each keeps its own URL. */
export function SectionNav({
  active,
}: {
  active: (typeof SECTIONS)[number]["key"];
}) {
  const { t } = useTranslation("serviceManagement");
  return (
    <nav aria-label={t("nav.title")} className="flex flex-wrap gap-1">
      {SECTIONS.map((section) => (
        <Button
          key={section.key}
          size="sm"
          variant={active === section.key ? "secondary" : "ghost"}
          aria-current={active === section.key ? "page" : undefined}
          render={<Link to={section.route.path} />}
        >
          {t(`nav.${section.key}`)}
        </Button>
      ))}
    </nav>
  );
}
