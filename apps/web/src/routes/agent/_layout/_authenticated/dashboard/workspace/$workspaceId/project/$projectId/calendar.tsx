import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Alert, AlertDescription } from "@taskdesk/ui";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import ProjectCalendarView from "@/components/calendar/project-calendar-view";
import Layout from "@/components/common/layout";
import ProjectViewFeatureGate from "@/components/common/project-view-feature-gate";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { authClient } from "@/lib/auth-client";
import {
  isAuthorizedLegacyProject,
  withLocationSuffix,
} from "@/lib/legacy-project-view";
import {
  type ProjectCalendarSearch,
  parseProjectCalendarSearch,
} from "@/lib/project-board-search";
import { PROJECT_CALENDAR_PATH, routes } from "@/lib/routes";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";

/**
 * Kaneo's calendar URL, kept so old links and bookmarks still open the project Calendar.
 * `/agent/projects/{key}/calendar` resolves projects in the session's active workspace only, so we
 * redirect there (preserving both query parameters and hash fragment) only when the project belongs
 * to the active workspace and `useProjectByKey` resolves the exact same project ID. Authorized
 * projects in another workspace (or shadowed by a key collision) render their own calendar in place
 * instead of landing on not-found or another project.
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
  const search = Route.useSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const activeWorkspaceId = getActiveOrganizationId(session);
  const isActiveWorkspace = Boolean(
    activeWorkspaceId && activeWorkspaceId === workspaceId,
  );
  const project = useGetProject({ id: projectId, workspaceId });
  const workspaceProjects = useGetProjects({
    workspaceId: isActiveWorkspace ? workspaceId : "",
  });

  const authorized =
    project.isSuccess &&
    isAuthorizedLegacyProject(project.data, projectId, workspaceId);
  const canonicalProject =
    authorized && isActiveWorkspace
      ? workspaceProjects.data?.find(
          (candidate) => candidate.slug === project.data.slug,
        )
      : undefined;
  const resolvesSameCanonicalProject = Boolean(
    canonicalProject &&
      canonicalProject.id === projectId &&
      canonicalProject.workspaceId === workspaceId,
  );
  const waitingForCanonicalLookup =
    authorized &&
    !isSessionPending &&
    isActiveWorkspace &&
    workspaceProjects.isLoading;
  const href =
    authorized && !isSessionPending && resolvesSameCanonicalProject
      ? withLocationSuffix(
          routes.projectCalendar.build({ projectKey: project.data.slug }),
          location,
        )
      : undefined;

  useEffect(() => {
    if (href) void navigate({ href, replace: true });
  }, [href, navigate]);

  const handleLegacySearchChange = useCallback(
    (
      update: (previous: ProjectCalendarSearch) => ProjectCalendarSearch,
      options?: { replace?: boolean },
    ) => {
      void navigate({
        to: PROJECT_CALENDAR_PATH,
        params: { workspaceId, projectId },
        search: update,
        replace: options?.replace,
      });
    },
    [navigate, projectId, workspaceId],
  );

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

  if (
    project.isLoading ||
    isSessionPending ||
    waitingForCanonicalLookup ||
    href
  )
    return (
      <Layout.Content>
        <p>{t("workItems:legacyView.opening")}</p>
      </Layout.Content>
    );

  return (
    <ProjectViewFeatureGate
      projectId={projectId}
      workspaceId={workspaceId}
      view="calendar"
    >
      <ProjectCalendarView
        projectId={projectId}
        workspaceId={workspaceId}
        search={search}
        onSearchChange={handleLegacySearchChange}
      />
    </ProjectViewFeatureGate>
  );
}
