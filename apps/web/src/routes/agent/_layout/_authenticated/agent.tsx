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
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetWorkspaces from "@/hooks/queries/workspace/use-get-workspaces";

// `/agent` home is kaneo's own projects page, and every other `/agent/*` page renders inside
// kaneo's layout (AppSidebar + SidebarInset + breadcrumb header), the same shell as
// `/dashboard/*` — docs/02-design/design-principles.md § Integrate, don't add.
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

// No `useTranslation` here: a translation load would re-render this route and with it the
// whole page under `<Outlet />` (500 work-list rows, G11 LCP). Only the title subscribes.
function AgentRootRoute() {
  const location = useLocation();
  if (location.pathname === "/agent" || location.pathname === "/agent/") {
    return <AgentHome />;
  }
  return (
    <WorkspaceLayout title={<AgentSectionTitle pathname={location.pathname} />}>
      <div className="h-full overflow-y-auto">
        <Outlet />
      </div>
    </WorkspaceLayout>
  );
}
