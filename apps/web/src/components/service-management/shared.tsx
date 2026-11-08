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
  FeatureOff,
  PageContainer,
  PageHeader,
  Skeleton,
} from "@taskdesk/ui";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChangeRisk, ServiceStatus } from "@/fetchers/service-management";
import { isFeatureDisabled } from "@/hooks/queries/service-management";
import { HttpError } from "@/lib/http-error";
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

/**
 * The page frame every service-management screen shares: title, description, actions. Built on
 * the shared `PageContainer` and `PageHeader` (UX-1a) with the same gutter and title size.
 */
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
    <PageContainer className="h-full overflow-y-auto">
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </PageContainer>
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
/**
 * The one "Service catalogue is off" state a catalogue page shows instead of its list: the shared
 * `FeatureOff` (UX-1a, SR-02), with "Turn on in Features" when the viewer can manage workspace
 * settings (`canManageFeatures`, which each page reads from its capabilities).
 */
export function CatalogueOff({
  canManageFeatures = false,
}: {
  canManageFeatures?: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  return (
    <FeatureOff
      data-testid="service-catalogue-off"
      title={t("disabled.title")}
      description={
        canManageFeatures
          ? t("disabled.manageDescription")
          : t("disabled.description")
      }
      action={
        canManageFeatures
          ? {
              label: t("common:featureOff.turnOn"),
              render: <Link to={routes.workspaceFeatures.path} />,
            }
          : undefined
      }
    />
  );
}

export function QueryFailure({
  error,
  onRetry,
  notFoundDescription,
}: {
  error: unknown;
  onRetry: () => void;
  /** A detail page's "does not exist or you cannot reach it" text; a 404 then shows it, not Retry. */
  notFoundDescription?: string;
}) {
  const { t } = useTranslation("serviceManagement");
  if (notFoundDescription && error instanceof HttpError && error.status === 404)
    return (
      <Empty data-testid="service-management-not-found">
        <EmptyHeader>
          <EmptyTitle>{t("common.notFoundTitle")}</EmptyTitle>
          <EmptyDescription>{notFoundDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  if (isFeatureDisabled(error)) return <CatalogueOff />;
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
  { key: "announcements", route: routes.serviceManagementAnnouncements },
] as const;

/** The service-management screens, as links so each keeps its own URL. */
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
