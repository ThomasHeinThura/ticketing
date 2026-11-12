import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Alert, AlertDescription } from "@taskdesk/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { isAuthorizedLegacyProject } from "@/lib/legacy-project-view";
import { parseProjectCalendarSearch } from "@/lib/project-board-search";
import { routes } from "@/lib/routes";

/**
 * Kaneo's calendar URL, kept so old links and bookmarks still open the project Calendar. The
 * canonical screen is `/agent/projects/{key}/calendar`; the whole query (month, view, filters,
 * open item) carries over. The project is read by ID and must belong to the workspace in the URL
 * before its key is used, as for the other legacy project views.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/calendar",
)({
  component: RouteComponent,
  validateSearch: parseProjectCalendarSearch,
});

function RouteComponent() {
  const { t } = useTranslation(["workItems"]);
  const { projectId, workspaceId } = Route.useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const project = useGetProject({ id: projectId, workspaceId });
  const authorized =
    project.isSuccess &&
    isAuthorizedLegacyProject(project.data, projectId, workspaceId);
  const href = authorized
    ? `${routes.projectCalendar.build({ projectKey: project.data.slug })}${location.searchStr}`
    : undefined;
  useEffect(() => {
    if (href) void navigate({ href, replace: true });
  }, [href, navigate]);
  if (project.isError || (project.isSuccess && !authorized))
    return (
      <Layout.Content>
        <Alert>
          <AlertDescription>
            {t("workItems:legacyView.unavailable")}
          </AlertDescription>
        </Alert>
      </Layout.Content>
    );
  return (
    <Layout.Content>
      <p>{t("workItems:legacyView.opening")}</p>
    </Layout.Content>
  );
}
