import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { LabelCatalogue } from "@/components/settings/label-catalogue";
import getProject from "@/fetchers/project/get-project";
import { parseLabelCatalogueSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/labels",
)({
  validateSearch: parseLabelCatalogueSearch,
  component: RouteComponent,
});
function RouteComponent() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t } = useTranslation();
  const project = useQuery({
    queryKey: ["project-label-context", projectId],
    queryFn: () => getProject({ id: projectId, workspaceId: "" }),
  });
  if (project.isPending) return <Skeleton className="h-16 w-full" />;
  if (project.isError)
    return (
      <div role="alert" className="space-y-2">
        <p>{project.error.message}</p>
        <Button variant="outline" onClick={() => void project.refetch()}>
          {t("common:actions.retry")}
        </Button>
      </div>
    );
  return (
    <LabelCatalogue
      key={projectId}
      projectId={projectId}
      targetWorkspaceId={project.data.workspaceId}
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
    />
  );
}
