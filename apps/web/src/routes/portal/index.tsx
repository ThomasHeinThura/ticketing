import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import type { PortalCaseFilterPatch } from "@/components/portal/cases/portal-case-filters";
import { PortalOutstandingCases } from "@/components/portal/cases/portal-outstanding-cases";
import { PortalHomeKpis } from "@/components/portal/portal-home-kpis";
import { PortalOrientation } from "@/components/portal/portal-orientation";
import { PortalProjectsCards } from "@/components/portal/projects/portal-projects-cards";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import {
  type PortalHomeSearch,
  parsePortalHomeSearch,
  portalProjectSearchMiddlewares,
  routes,
} from "@/lib/routes";

export const Route = createFileRoute("/")({
  validateSearch: parsePortalHomeSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
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
  const update = (patch: PortalCaseFilterPatch) =>
    void navigate({
      search: (previous: PortalHomeSearch) => ({ ...previous, ...patch }),
      replace: true,
    });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
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
        portalUserId={portalUserId}
        project={project}
        label={t("home.dashboardTitle")}
      />
      <PortalProjectsCards projectKey={project} />
      <PortalOutstandingCases
        portalUserId={portalUserId}
        filters={search}
        project={project}
        onChange={update}
      />
    </div>
  );
}
