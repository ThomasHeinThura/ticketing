import {
  createFileRoute,
  Navigate,
  Outlet,
  useLocation,
} from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey",
)({
  component: ProjectRootRoute,
});

// A project opens on its work view; there is no separate overview screen.
function ProjectRootRoute() {
  const { projectKey } = Route.useParams();
  const location = useLocation();
  const encodedBase = `/agent/projects/${encodeURIComponent(projectKey)}`;
  const rawBase = `/agent/projects/${projectKey}`;
  if (
    [encodedBase, `${encodedBase}/`, rawBase, `${rawBase}/`].includes(
      location.pathname,
    )
  ) {
    return (
      <Navigate
        to="/agent/projects/$projectKey/work"
        params={{ projectKey }}
        replace
      />
    );
  }
  return <Outlet />;
}
