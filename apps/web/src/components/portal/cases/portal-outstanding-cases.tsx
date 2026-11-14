import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  FramePanel,
  Skeleton,
} from "@taskdesk/ui";
import {
  type PortalCaseFilterPatch,
  PortalCaseFilters,
} from "@/components/portal/cases/portal-case-filters";
import { PortalCaseTable } from "@/components/portal/cases/portal-case-table";
import { outstandingCasesQuery } from "@/hooks/queries/portal/outstanding-cases-query";
import { usePortalCases } from "@/hooks/queries/portal/use-portal-cases";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/portal-route-builders";
import {
  PORTAL_OUTSTANDING_STATUSES,
  type PortalHomeSearch,
} from "@/lib/portal-route-search";

const OUTSTANDING = PORTAL_OUTSTANDING_STATUSES.join(",");

/**
 * The dashboard's outstanding cases (S4b): My/All, Status and Severity filters kept in the URL,
 * the first rows of `GET /api/portal/requests` and a link to the full list with the same
 * filters. With `project` the list and its link are scoped to that project (U-11 Project
 * Details); the link names the project itself because Project Details keeps its key in the path.
 */
export function PortalOutstandingCases({
  portalUserId,
  filters,
  project,
  onChange,
  prefetched = false,
}: {
  portalUserId: string;
  filters: Pick<PortalHomeSearch, "scope" | "status" | "priority">;
  project?: string;
  onChange: (patch: PortalCaseFilterPatch) => void;
  prefetched?: boolean;
}) {
  const { t } = usePortalTranslation("portal");
  const { scope, priority } = filters;
  const status = filters.status ?? OUTSTANDING;
  const cases = usePortalCases(
    portalUserId,
    outstandingCasesQuery(filters, project),
    { prefetched },
  );
  const listSearch = {
    ...(scope ? { scope } : {}),
    status,
    ...(priority ? { priority } : {}),
    ...(project ? { project } : {}),
  };

  return (
    // Not a named region: the table below is the landmark carrying this title (axe
    // landmark-unique), and Project Details has a second figures region above it.
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold text-base">
            {t("cases.outstandingTitle")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("cases.outstandingDescription")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to={routes.portalRequests.path} search={listSearch} />}
        >
          {t("cases.viewAll")}
        </Button>
      </div>
      <PortalCaseFilters
        filters={filters}
        statuses={PORTAL_OUTSTANDING_STATUSES}
        onChange={onChange}
      />
      {cases.isError ? (
        <Alert variant="error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("cases.loadFailed")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void cases.refetch()}
            >
              {t("common:actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !cases.data ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : cases.data.cases.length === 0 ? (
        <Frame>
          <FramePanel className="p-8">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("cases.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("cases.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FramePanel>
        </Frame>
      ) : (
        <>
          <PortalCaseTable
            cases={cases.data.cases}
            caption={t("cases.outstandingTitle")}
          />
          {cases.data.meta.total > cases.data.cases.length ? (
            <p className="text-muted-foreground text-xs">
              {t("cases.summary", {
                shown: cases.data.cases.length,
                total: cases.data.meta.total,
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
