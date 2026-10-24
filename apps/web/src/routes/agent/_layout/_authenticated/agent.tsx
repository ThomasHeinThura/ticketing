import {
  createFileRoute,
  Navigate,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetWorkspaces from "@/hooks/queries/workspace/use-get-workspaces";

// `/agent` home is kaneo's own projects page, and every other `/agent/*` page renders inside
// kaneo's layout (AppSidebar + SidebarInset + breadcrumb header), the same shell as
// `/dashboard/*` — docs/02-design/design-principles.md § Integrate, don't add.
// Project controls are needed only after the project resolves. Keep them out of
// unrelated agent pages; the inherited frame loads alongside project data.
const loadProjectLayout = () => import("@/components/common/project-layout");
const ProjectLayout = lazy(loadProjectLayout);
// UI chunks may download during the session check; data access still waits for it.
if (
  typeof window !== "undefined" &&
  /^\/agent\/projects\/[^/]+\/(work|backlog)\/?$/u.test(
    window.location.pathname,
  )
) {
  void loadProjectLayout().catch(() => {
    // Rendering the lazy component surfaces a failed chunk through the route boundary.
  });
}

const ProjectsPage = lazy(
  () => import("@/components/project-list/projects-page"),
);

// Not split: every /agent page renders inside this shell, so on a direct visit its code
// must arrive with the entry rather than after the router resolves it (G11 work-list LCP).
export const Route = createFileRoute("/_layout/_authenticated/agent")({
  component: AgentRootRoute,
  codeSplitGroupings: [],
});

const SECTION_TITLE_KEYS: Record<string, string> = {
  inbox: "navigation:sidebar.inbox",
  "my-work": "navigation:sidebar.myWork",
  triage: "navigation:sidebar.triage",
  projects: "navigation:sidebar.projects",
  views: "navigation:sidebar.savedViews",
  search: "navigation:sidebar.search",
  settings: "navigation:sidebar.settings",
  "god-mode": "navigation:sidebar.godMode",
  "service-management": "navigation:sidebar.serviceManagement",
  "work-items": "navigation:sidebar.workItem",
};

function agentSectionTitleKey(pathname: string): string {
  const section = pathname.replace(/^\/agent\/?/, "").split("/")[0] ?? "";
  return SECTION_TITLE_KEYS[section] ?? "navigation:sidebar.overview";
}

function AgentHome() {
  const { t } = useTranslation();
  const { data: activeWorkspace, isLoading } = useActiveWorkspace();
  const { data: workspaces, isLoading: isWorkspacesLoading } =
    useGetWorkspaces();
  const fallback = (
    <WorkspaceLayout title={t("navigation:sidebar.projects")}>
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </WorkspaceLayout>
  );
  // No active workspace yet (activation still landing): show the first one. No workspace at
  // all: onboarding, as /dashboard does. Never bounce back to /dashboard, which would loop.
  const workspace = activeWorkspace ?? workspaces?.[0];
  if (!workspace) {
    if (isLoading || isWorkspacesLoading) return fallback;
    return <Navigate to="/onboarding" />;
  }
  return (
    <Suspense fallback={fallback}>
      <ProjectsPage workspaceId={workspace.id} />
    </Suspense>
  );
}

function AgentSectionTitle({ pathname }: { pathname: string }) {
  const { t } = useTranslation();
  return t(agentSectionTitleKey(pathname));
}

function CanonicalProjectFrame({
  projectKey,
  view,
}: {
  projectKey: string;
  view: "work" | "backlog" | "cycles" | "modules" | "pages";
}) {
  const backlog = view === "backlog";
  const agile = view === "cycles" || view === "modules" || view === "pages";
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const project = projects?.find((candidate) => candidate.slug === projectKey);
  return (
    <Suspense
      fallback={
        <WorkspaceLayout title={projectKey}>
          <Skeleton className="h-10 w-full" />
        </WorkspaceLayout>
      }
    >
      <ProjectLayout
        projectId={project?.id ?? ""}
        workspaceId={project?.workspaceId ?? workspace?.id ?? ""}
        showViewSwitcher={Boolean(project)}
        activeView={
          backlog
            ? "backlog"
            : view === "cycles" || view === "modules" || view === "pages"
              ? view
              : "board"
        }
        realtimeMode={backlog ? "canonical" : "page"}
      >
        {agile ? (
          <div className="h-full overflow-y-auto">
            <Outlet />
          </div>
        ) : (
          <Outlet />
        )}
      </ProjectLayout>
    </Suspense>
  );
}

// No `useTranslation` here: a translation load would re-render this route and with it the
// whole page under `<Outlet />` (500 work-list rows, G11 LCP). Only the title subscribes.
function AgentRootRoute() {
  const location = useLocation();
  if (location.pathname === "/agent" || location.pathname === "/agent/") {
    return <AgentHome />;
  }
  // Settings use kaneo's full-page settings shell, as /dashboard/settings does.
  if (
    location.pathname.startsWith("/agent/settings") ||
    location.pathname.startsWith("/agent/god-mode") ||
    /^\/agent\/work-items\/[^/]+\/?$/u.test(location.pathname)
  ) {
    return <Outlet />;
  }
  // P5 agile and pages: the cycles, modules and pages screens (list and one level of detail) share the frame.
  const projectPath =
    /^\/agent\/projects\/([^/]+)\/(?:(work|backlog)|(cycles|modules|pages)(?:\/[^/]+)?)\/?$/u.exec(
      location.pathname,
    );
  if (projectPath) {
    let projectKey = projectPath[1] ?? "";
    try {
      projectKey = decodeURIComponent(projectKey);
    } catch {
      /* The route handles malformed identifiers. */
    }
    return (
      <CanonicalProjectFrame
        projectKey={projectKey}
        view={
          (projectPath[2] ?? projectPath[3]) as
            | "work"
            | "backlog"
            | "cycles"
            | "modules"
            | "pages"
        }
      />
    );
  }
  return (
    <WorkspaceLayout title={<AgentSectionTitle pathname={location.pathname} />}>
      <div className="h-full overflow-y-auto">
        <Outlet />
      </div>
    </WorkspaceLayout>
  );
}
