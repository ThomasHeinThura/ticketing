import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { lazy, Suspense } from "react";

// Loaded only on the Overview itself, so the work list and board (children of this route)
// never download it (G11).
const ProjectOverviewPage = lazy(
  () => import("@/components/project/overview/project-overview-page"),
);

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey",
)({
  component: ProjectRootRoute,
});

// S3: a project opens on its Overview. Every child URL (/work, /backlog, ...) still renders
// its own screen through the outlet, so old links keep working.
function ProjectRootRoute() {
  const { projectKey } = Route.useParams();
  const location = useLocation();
  const encodedBase = `/agent/projects/${encodeURIComponent(projectKey)}`;
  const rawBase = `/agent/projects/${projectKey}`;
  if (
    ![encodedBase, `${encodedBase}/`, rawBase, `${rawBase}/`].includes(
      location.pathname,
    )
  )
    return <Outlet />;
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
        </div>
      }
    >
      <ProjectOverviewPage projectKey={projectKey} />
    </Suspense>
  );
}
