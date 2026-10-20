import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ProjectSettingsRedirect } from "@/components/agent/kaneo-redirects";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings",
)({
  component: ProjectSettingsRootRoute,
});

// The real project settings screen is kaneo's; child URLs redirect there too.
function ProjectSettingsRootRoute() {
  const { projectKey } = Route.useParams();
  const location = useLocation();
  const base = `/agent/projects/${projectKey}/settings`;
  const encodedBase = `/agent/projects/${encodeURIComponent(projectKey)}/settings`;
  const isRoot = [base, `${base}/`, encodedBase, `${encodedBase}/`].includes(
    location.pathname,
  );
  if (!isRoot) return <Outlet />;
  return <ProjectSettingsRedirect projectKey={projectKey} section="general" />;
}
