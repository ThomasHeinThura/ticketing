import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { projectOverviewOptions } from "@/hooks/queries/project/project-overview-options";
import { projectOptions } from "@/hooks/queries/project/use-get-project";
import { resolveRouteProject } from "@/lib/route-project-prefetch";

// Loaded only on the Overview itself, so the work list and board (children of this route)
// never download it (G11).
const ProjectOverviewPage = lazy(
  () => import("@/components/project/overview/project-overview-page"),
);

function startOverviewReads(
  context: {
    queryClient: import("@tanstack/react-query").QueryClient;
    session: { session?: unknown } | null | undefined;
  },
  projectKey: string,
) {
  void resolveRouteProject(context.queryClient, context.session, projectKey)
    .then((result) => {
      if (!result) return;
      const { project, workspaceId } = result;
      void context.queryClient.prefetchQuery(
        projectOverviewOptions(project.id),
      );
      void context.queryClient.prefetchQuery(
        projectOptions(project.id, project.workspaceId ?? workspaceId),
      );
    })
    .catch(() => {});
}

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey",
)({
  // Parent matches can stay mounted when returning from a child route. Refresh the overview
  // there too, since its mount deliberately reuses route-started reads.
  beforeLoad: ({ context, params, cause, location }) => {
    if (
      cause === "stay" &&
      /^\/agent\/projects\/[^/]+\/?$/.test(location.pathname)
    )
      startOverviewReads(context, params.projectKey);
  },
  loader: ({ context, params, cause, location }) => {
    if (
      cause !== "enter" ||
      !/^\/agent\/projects\/[^/]+\/?$/.test(location.pathname)
    )
      return;
    startOverviewReads(context, params.projectKey);
  },
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
    <Suspense fallback={<PageLoading />}>
      <ProjectOverviewPage projectKey={projectKey} prefetched />
    </Suspense>
  );
}
