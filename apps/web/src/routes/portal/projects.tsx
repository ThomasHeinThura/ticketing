import { createFileRoute } from "@tanstack/react-router";
import { PortalProjectsList } from "@/components/portal/projects/portal-projects-list";
import {
  parsePortalProjectsSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

/** `docs/screens.md` portal "Projects list" (S4c): the organisation's projects and services. */
export const Route = createFileRoute("/projects")({
  validateSearch: parsePortalProjectsSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalProjects,
});

function PortalProjects() {
  const search = Route.useSearch();
  return <PortalProjectsList search={search} />;
}
