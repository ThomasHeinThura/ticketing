import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { PortalCaseFilterPatch } from "@/components/portal/cases/portal-case-filters";
import { PortalProjectDetails } from "@/components/portal/projects/portal-project-details";
import {
  type PortalHomeSearch,
  parsePortalHomeSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

/**
 * `docs/screens.md` portal "Project detail" (S4c): one project's customer view. U-11: its cases
 * table keeps the dashboard's `scope`, `status` and `priority` filters in the URL.
 */
export const Route = createFileRoute("/projects_/$projectKey")({
  validateSearch: parsePortalHomeSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalProject,
});

function PortalProject() {
  const { projectKey } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = (patch: PortalCaseFilterPatch) =>
    void navigate({
      search: (previous: PortalHomeSearch) => ({ ...previous, ...patch }),
      replace: true,
    });
  return (
    <PortalProjectDetails
      projectKey={projectKey}
      portalUserId={portalUserId}
      caseFilters={search}
      onCaseFiltersChange={update}
    />
  );
}
