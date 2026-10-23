import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Button,
  KbdSequence,
  SidebarTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useIsMobile,
} from "@taskdesk/ui";
import {
  CalendarDays,
  CalendarRange,
  SquareKanban,
  SquircleDashed,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import ProjectCrumbSelect from "@/components/common/header/project-crumb-select";
import WorkspaceCrumbSelect from "@/components/common/header/workspace-crumb-select";
import Layout from "@/components/common/layout";
import RealtimeUnavailableNotice from "@/components/common/realtime-unavailable-notice";

const CreateProjectModal = lazy(
  () => import("@/components/shared/modals/create-project-modal"),
);
const MobileProjectNav = lazy(
  () => import("@/components/common/header/mobile-project-nav"),
);

import { shortcuts } from "@/constants/shortcuts";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { buildProjectViewSwitchUrl } from "@/lib/project-layout-navigation";
import { routes } from "@/lib/routes";

type ProjectLayoutProps = {
  projectId: string;
  workspaceId: string;
  headerActions?: ReactNode;
  children: ReactNode;
  showViewSwitcher?: boolean;
  activeView?: "backlog" | "board" | "calendar" | "gantt";
  realtimeMode?: "legacy" | "canonical" | "page";
};

export default function ProjectLayout({
  projectId,
  workspaceId,
  headerActions,
  children,
  showViewSwitcher = true,
  activeView,
  realtimeMode = "legacy",
}: ProjectLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const location = useLocation();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const permissions = useWorkspacePermission(workspaceId);
  const canCreateProject =
    !permissions.isCheckingPermissions && permissions.canCreateProjects();
  const { data: workspaceProjects } = useGetProjects({ workspaceId });
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);

  const { status: socketStatus } = useProjectWebSocket(
    realtimeMode === "legacy" ? projectId : "",
  );

  const resolvedView =
    activeView ??
    (location.pathname.includes("/backlog")
      ? "backlog"
      : location.pathname.includes("/calendar")
        ? "calendar"
        : location.pathname.includes("/gantt")
          ? "gantt"
          : "board");
  const handleNavigateToBacklog = () => {
    if (project)
      void navigate({
        href: buildProjectViewSwitchUrl(
          "backlog",
          { workspaceId, projectId, projectKey: project.slug },
          location.searchStr,
        ),
      });
  };
  const handleNavigateToBoard = () => {
    if (project)
      void navigate({
        href: buildProjectViewSwitchUrl(
          "board",
          { workspaceId, projectId, projectKey: project.slug },
          location.searchStr,
        ),
      });
  };

  const handleNavigateToCalendar = () => {
    navigate({
      to: buildProjectViewSwitchUrl(
        "calendar",
        { workspaceId, projectId },
        location.searchStr,
      ),
    });
  };

  const handleNavigateToGantt = () => {
    navigate({
      to: buildProjectViewSwitchUrl(
        "gantt",
        { workspaceId, projectId },
        location.searchStr,
      ),
    });
  };

  const handleProjectSwitch = (nextProjectId: string) => {
    const nextProject = workspaceProjects?.find(
      (candidate) => candidate.id === nextProjectId,
    );
    if (!nextProject) return;
    if (resolvedView === "board" || resolvedView === "backlog") {
      void navigate({
        href:
          resolvedView === "backlog"
            ? routes.projectBacklog.build({ projectKey: nextProject.slug })
            : routes.workItemList.build(
                { projectKey: nextProject.slug },
                { layout: "board" },
              ),
      });
      return;
    }
    void navigate({
      to:
        resolvedView === "calendar"
          ? "/dashboard/workspace/$workspaceId/project/$projectId/calendar"
          : "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
      params: { workspaceId, projectId: nextProjectId },
    });
  };

  return (
    <Layout>
      <Layout.Header className="h-11 border-border/80 px-2">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger
                    className="-ml-1 h-7 w-7 cursor-pointer text-foreground hover:text-foreground"
                    toggleLabel={t("common:a11y.toggleSidebar")}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="flex items-center gap-2 text-[10px]">
                    Toggle sidebar
                    <KbdSequence
                      keys={[
                        shortcuts.sidebar.prefix,
                        shortcuts.sidebar.toggle,
                      ]}
                    />
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="h-4 w-px shrink-0 bg-border/80" />

            <div className="hidden min-w-0 items-center gap-1 md:flex">
              <WorkspaceCrumbSelect />
              <span className="text-foreground text-xs">/</span>
              <ProjectCrumbSelect
                workspaceId={workspaceId}
                projectId={projectId}
                projectName={project?.name}
                onSelectProject={handleProjectSwitch}
                onAddProject={
                  canCreateProject
                    ? () => setIsCreateProjectModalOpen(true)
                    : undefined
                }
              />
            </div>

            {isMobile && projectId && workspaceId ? (
              <div className="md:hidden">
                <Suspense fallback={null}>
                  <MobileProjectNav
                    workspaceId={workspaceId}
                    projectId={projectId}
                    activeView={resolvedView}
                    onSelectBacklog={handleNavigateToBacklog}
                    onSelectBoard={handleNavigateToBoard}
                    onSelectCalendar={handleNavigateToCalendar}
                    onSelectGantt={handleNavigateToGantt}
                    onSelectProject={handleProjectSwitch}
                    onAddProject={
                      canCreateProject
                        ? () => setIsCreateProjectModalOpen(true)
                        : undefined
                    }
                  />
                </Suspense>
              </div>
            ) : null}

            {showViewSwitcher && (
              <div className="hidden h-8 items-center gap-0.5 rounded-lg border border-border/80 bg-background p-0.5 sm:inline-flex">
                <Button
                  variant={resolvedView === "backlog" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToBacklog}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "backlog" && "text-muted-foreground",
                  )}
                >
                  <SquircleDashed className="size-3.5" />
                  Backlog
                </Button>
                <Button
                  variant={resolvedView === "board" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToBoard}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "board" && "text-muted-foreground",
                  )}
                >
                  <SquareKanban className="size-3.5" />
                  {t("navigation:projectViews.workItems")}
                </Button>
                <Button
                  variant={resolvedView === "calendar" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToCalendar}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "calendar" && "text-muted-foreground",
                  )}
                >
                  <CalendarRange className="size-3.5" />
                  {t("navigation:projectViews.calendar")}
                </Button>
                <Button
                  variant={resolvedView === "gantt" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={handleNavigateToGantt}
                  className={cn(
                    "h-6 gap-1.5 rounded-md px-2 text-xs",
                    resolvedView !== "gantt" && "text-muted-foreground",
                  )}
                >
                  <CalendarDays className="size-3.5" />
                  Gantt
                </Button>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {headerActions}
          </div>
        </div>
      </Layout.Header>

      {realtimeMode === "canonical" ? (
        <CanonicalProjectRealtime projectId={projectId} />
      ) : realtimeMode === "legacy" ? (
        <RealtimeUnavailableNotice status={socketStatus} />
      ) : null}
      <Layout.Content>{children}</Layout.Content>

      {isCreateProjectModalOpen ? (
        <Suspense fallback={null}>
          <CreateProjectModal
            open={isCreateProjectModalOpen}
            onClose={() => setIsCreateProjectModalOpen(false)}
          />
        </Suspense>
      ) : null}
    </Layout>
  );
}

function CanonicalProjectRealtime({ projectId }: { projectId: string }) {
  const { status } = useNativeWorkItemRealtime(
    projectId ? [`project:${projectId}`] : [],
  );
  return (
    <RealtimeUnavailableNotice
      status={
        status === "available"
          ? "live"
          : status === "unavailable"
            ? "unavailable"
            : "connecting"
      }
    />
  );
}
