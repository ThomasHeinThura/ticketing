import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

// `/agent` home is kaneo's own projects page, and every other `/agent/*` page renders inside
// kaneo's layout (AppSidebar + SidebarInset + breadcrumb header), the same shell as
// `/dashboard/*` — docs/02-design/design-principles.md § Integrate, don't add.
const ProjectsPage = lazy(
  () => import("@/components/project-list/projects-page"),
);

export const Route = createFileRoute("/_layout/_authenticated/agent")({
  component: AgentRootRoute,
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
  "work-items": "navigation:sidebar.workItem",
};

export function agentSectionTitleKey(pathname: string): string {
  const section = pathname.replace(/^\/agent\/?/, "").split("/")[0] ?? "";
  return SECTION_TITLE_KEYS[section] ?? "navigation:sidebar.overview";
}

function AgentHome() {
  const { data: workspace, isLoading } = useActiveWorkspace();
  const fallback = (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
  if (!workspace) return isLoading ? fallback : null;
  return (
    <Suspense fallback={fallback}>
      <ProjectsPage workspaceId={workspace.id} />
    </Suspense>
  );
}

function AgentRootRoute() {
  const { t } = useTranslation();
  const location = useLocation();
  if (location.pathname === "/agent" || location.pathname === "/agent/") {
    return <AgentHome />;
  }
  return (
    <WorkspaceLayout title={t(agentSectionTitleKey(location.pathname))}>
      <div className="h-full overflow-y-auto">
        <Outlet />
      </div>
    </WorkspaceLayout>
  );
}
