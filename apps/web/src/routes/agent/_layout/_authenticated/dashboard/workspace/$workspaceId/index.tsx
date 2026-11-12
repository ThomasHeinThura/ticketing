import { createFileRoute, redirect } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";

const ProjectsPage = lazy(
  () => import("@/components/project-list/projects-page"),
);

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/",
)({
  // The projects list lives at `/agent`. This old address opens it when the workspace in the
  // URL is the session's active one; a link to any other workspace still shows that
  // workspace's list here, because `/agent` only ever shows the active workspace.
  beforeLoad: ({ context, params }) => {
    const activeWorkspaceId = getActiveOrganizationId(
      context.session as Parameters<typeof getActiveOrganizationId>[0],
    );
    if (activeWorkspaceId && activeWorkspaceId === params.workspaceId)
      throw redirect({ to: "/agent", replace: true });
  },
  component: RouteComponent,
  pendingComponent: ProjectsRouteLoading,
  pendingMs: 0,
  pendingMinMs: 0,
});

function ProjectsRouteLoading() {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("common:empty.loading")}
      className="flex h-full flex-col gap-4 overflow-y-auto p-6"
      data-testid="workspace-projects-route-pending"
      role="status"
    >
      <h1>{t("workspace:projects.pageTitle")}</h1>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();

  return (
    <>
      <PageTitle title={t("workspace:projects.pageTitle")} />
      <Suspense fallback={<ProjectsRouteLoading />}>
        <ProjectsPage workspaceId={workspaceId} />
      </Suspense>
    </>
  );
}
