import { createFileRoute } from "@tanstack/react-router";
import { PortalProjectDetails } from "@/components/portal/projects/portal-project-details";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/routes";

/** `docs/screens.md` portal "Project detail" (S4c): one project's customer view. */
export const Route = createFileRoute("/projects_/$projectKey")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalProject,
});

function PortalProject() {
  const { projectKey } = Route.useParams();
  return <PortalProjectDetails projectKey={projectKey} />;
}
