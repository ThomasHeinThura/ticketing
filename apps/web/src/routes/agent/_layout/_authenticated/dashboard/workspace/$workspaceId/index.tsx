import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";

const ProjectsPage = lazy(
  () => import("@/components/project-list/projects-page"),
);

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();

  return (
    <>
      <PageTitle title={t("workspace:projects.pageTitle")} />
      <Suspense
        fallback={
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
        }
      >
        <ProjectsPage workspaceId={workspaceId} />
      </Suspense>
    </>
  );
}
