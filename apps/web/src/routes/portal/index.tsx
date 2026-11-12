import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { PageLoading } from "@/components/page-loading";
import type { PortalCaseFilterPatch } from "@/components/portal/cases/portal-case-filters";
import { PortalOutstandingCases } from "@/components/portal/cases/portal-outstanding-cases";
import { PortalHomeKpis } from "@/components/portal/portal-home-kpis";
import { PortalOrientation } from "@/components/portal/portal-orientation";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { PortalProjectsCards } from "@/components/portal/projects/portal-projects-cards";
import { outstandingCasesQuery } from "@/hooks/queries/portal/outstanding-cases-query";
import { portalProjectsOptions } from "@/hooks/queries/portal/portal-projects-options";
import {
  usePortalCases,
  usePortalHome,
} from "@/hooks/queries/portal/use-portal-cases";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/portal-route-builders";
import {
  type PortalHomeSearch,
  parsePortalHomeSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

import queryClient from "@/query-client";

export const Route = createFileRoute("/")({
  validateSearch: parsePortalHomeSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  loaderDeps: ({ search }) => ({
    project: search.project,
    scope: search.scope,
    status: search.status,
    priority: search.priority,
  }),
  loader: async ({ context, deps, cause }) => {
    const { portalUserId, portalState } = context as unknown as {
      portalUserId?: string;
      portalState?: unknown;
    };
    if (cause === "enter" && portalUserId && !portalState) {
      const { prefetchPortalHome } = await import(
        "@/hooks/queries/portal/prefetch-portal-home"
      );
      prefetchPortalHome(queryClient, portalUserId, deps);
    }
  },
  component: PortalHome,
});

/**
 * The organisation's dashboard (S4b). The top-bar project selector writes `?project=KEY`; the
 * figures, the project cards and the outstanding cases then all show that project only, the
 * same numbers as its Project Details (U-11).
 */
function PortalHome() {
  const { t } = usePortalTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { project } = search;
  const home = usePortalHome(portalUserId, project, true);
  const projects = useQuery({
    ...portalProjectsOptions(),
    refetchOnMount: false,
  });
  const cases = usePortalCases(
    portalUserId,
    outstandingCasesQuery(search, project),
    { prefetched: true },
  );
  const update = (patch: PortalCaseFilterPatch) =>
    void navigate({
      search: (previous: PortalHomeSearch) => ({ ...previous, ...patch }),
      replace: true,
    });

  if (home.isLoading || projects.isLoading || cases.isLoading)
    return <PageLoading portal />;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <PortalPageTitle title={t("home.dashboardTitle")} />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-semibold text-xl">{t("home.dashboardTitle")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("home.dashboardDescription")}
          </p>
        </div>
        <Button render={<Link to={routes.portalCatalogue.path} />}>
          {t("requests.newRequest")}
        </Button>
      </header>
      <PortalOrientation portalUserId={portalUserId} />
      <PortalHomeKpis
        prefetched
        portalUserId={portalUserId}
        project={project}
        label={t("home.dashboardTitle")}
      />
      <PortalProjectsCards projectKey={project} prefetched />
      <PortalOutstandingCases
        prefetched
        portalUserId={portalUserId}
        filters={search}
        project={project}
        onChange={update}
      />
    </div>
  );
}
