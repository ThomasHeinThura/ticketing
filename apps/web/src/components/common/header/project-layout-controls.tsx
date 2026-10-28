import { useLocation, useNavigate } from "@tanstack/react-router";
import { Button, ScrollArea, useIsMobile } from "@taskdesk/ui";
import {
  CalendarDays,
  CalendarRange,
  FileText,
  Layers,
  Repeat,
  SquareKanban,
  SquircleDashed,
} from "lucide-react";
import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import ProjectCrumbSelect from "@/components/common/header/project-crumb-select";
import useAgileFeatures from "@/hooks/queries/agile/use-agile-features";
import useProjectPagesFeature, {
  useProjectFeature,
} from "@/hooks/queries/feature-flag/use-project-pages-feature";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { buildProjectViewSwitchUrl } from "@/lib/project-layout-navigation";
import { routes } from "@/lib/routes";

const MobileProjectNav = lazy(
  () => import("@/components/common/header/mobile-project-nav"),
);

type ProjectView =
  | "backlog"
  | "board"
  | "calendar"
  | "gantt"
  | "cycles"
  | "modules"
  | "pages";

type ProjectLayoutControlsProps = {
  projectId: string;
  workspaceId: string;
  projectName?: string;
  projectSlug?: string;
  showViewSwitcher: boolean;
  activeView?: ProjectView;
  onAddProject?: () => void;
};

export default function ProjectLayoutControls({
  projectId,
  workspaceId,
  projectName,
  projectSlug,
  showViewSwitcher,
  activeView,
  onAddProject,
}: ProjectLayoutControlsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { data: workspaceProjects } = useGetProjects({ workspaceId });
  const permissions = useWorkspacePermission(workspaceId);
  const canCreateProject =
    !permissions.isCheckingPermissions && permissions.canCreateProjects();
  const addProject = canCreateProject ? onAddProject : undefined;
  const { features: agileFeatures } = useAgileFeatures(projectId);
  const pagesOn = useProjectPagesFeature(projectId);
  // P4R1-M2: Calendar and Gantt are offered only while their flags are on (features.md).
  const calendarOn = useProjectFeature(projectId, "feature.calendar");
  const ganttOn = useProjectFeature(projectId, "feature.timeline");
  const tabsRef = useRef<HTMLDivElement>(null);
  const resolvedView =
    activeView ??
    (location.pathname.includes("/backlog")
      ? "backlog"
      : location.pathname.includes("/cycles")
        ? "cycles"
        : location.pathname.includes("/modules")
          ? "modules"
          : location.pathname.includes("/pages")
            ? "pages"
            : location.pathname.includes("/calendar")
              ? "calendar"
              : location.pathname.includes("/gantt")
                ? "gantt"
                : "board");
  useLayoutEffect(() => {
    if (
      !showViewSwitcher ||
      (resolvedView === "cycles" && !agileFeatures.cycles) ||
      (resolvedView === "modules" && !agileFeatures.modules) ||
      (resolvedView === "pages" && !pagesOn) ||
      (resolvedView === "calendar" && !calendarOn) ||
      (resolvedView === "gantt" && !ganttOn)
    )
      return;
    const tabs = tabsRef.current;
    if (!tabs) return;
    const revealCurrentView = () => {
      tabs
        .querySelector<HTMLElement>('[aria-current="page"]')
        ?.scrollIntoView?.({
          block: "nearest",
          inline: "nearest",
        });
    };
    revealCurrentView();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(revealCurrentView);
    if (tabs.parentElement) observer?.observe(tabs.parentElement);
    return () => observer?.disconnect();
  }, [
    resolvedView,
    showViewSwitcher,
    agileFeatures.cycles,
    agileFeatures.modules,
    pagesOn,
    calendarOn,
    ganttOn,
  ]);
  const handleNavigateToBacklog = () => {
    if (projectSlug)
      void navigate({
        href: buildProjectViewSwitchUrl(
          "backlog",
          { workspaceId, projectId, projectKey: projectSlug },
          location.searchStr,
        ),
      });
  };
  const handleNavigateToBoard = () => {
    if (projectSlug)
      void navigate({
        href: buildProjectViewSwitchUrl(
          "board",
          { workspaceId, projectId, projectKey: projectSlug },
          location.searchStr,
        ),
      });
  };
  const handleNavigateToCycles = () => {
    if (projectSlug)
      void navigate({
        href: routes.projectCycles.build({ projectKey: projectSlug }),
      });
  };
  const handleNavigateToPages = () => {
    if (projectSlug)
      void navigate({
        href: routes.projectPages.build({ projectKey: projectSlug }),
      });
  };
  const handleNavigateToModules = () => {
    if (projectSlug)
      void navigate({
        href: routes.projectModules.build({ projectKey: projectSlug }),
      });
  };
  const handleNavigateToCalendar = () => {
    void navigate({
      to: buildProjectViewSwitchUrl(
        "calendar",
        { workspaceId, projectId },
        location.searchStr,
      ),
    });
  };
  const handleNavigateToGantt = () => {
    void navigate({
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
    if (
      resolvedView === "board" ||
      resolvedView === "backlog" ||
      resolvedView === "cycles" ||
      resolvedView === "modules" ||
      resolvedView === "pages"
    ) {
      void navigate({
        href:
          resolvedView === "backlog"
            ? routes.projectBacklog.build({ projectKey: nextProject.slug })
            : resolvedView === "cycles"
              ? routes.projectCycles.build({ projectKey: nextProject.slug })
              : resolvedView === "pages"
                ? routes.projectPages.build({ projectKey: nextProject.slug })
                : resolvedView === "modules"
                  ? routes.projectModules.build({
                      projectKey: nextProject.slug,
                    })
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
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="hidden min-w-0 shrink items-center gap-1 md:flex [&>button]:max-w-40 [&>button]:min-w-0 [&>button]:shrink">
        <ProjectCrumbSelect
          workspaceId={workspaceId}
          projectId={projectId}
          projectName={projectName}
          onSelectProject={handleProjectSwitch}
          onAddProject={addProject}
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
              onSelectCalendar={
                calendarOn ? handleNavigateToCalendar : undefined
              }
              onSelectGantt={ganttOn ? handleNavigateToGantt : undefined}
              onSelectCycles={
                agileFeatures.cycles ? handleNavigateToCycles : undefined
              }
              onSelectModules={
                agileFeatures.modules ? handleNavigateToModules : undefined
              }
              onSelectPages={pagesOn ? handleNavigateToPages : undefined}
              onSelectProject={handleProjectSwitch}
              onAddProject={addProject}
            />
          </Suspense>
        </div>
      ) : null}

      {showViewSwitcher && (
        <ScrollArea
          aria-label={t("navigation:projectViews.workItems")}
          className="hidden h-8 min-w-0 w-max max-w-full shrink rounded-lg border border-border/80 bg-background sm:block"
          onFocusCapture={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLElement &&
              tabsRef.current?.contains(target)
            )
              target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          }}
        >
          <div
            ref={tabsRef}
            className="inline-flex h-full w-max min-w-max items-center gap-0.5 p-0.5"
          >
            <Button
              variant={resolvedView === "backlog" ? "secondary" : "ghost"}
              size="xs"
              onClick={handleNavigateToBacklog}
              aria-current={resolvedView === "backlog" ? "page" : undefined}
              className={cn(
                "h-6 scroll-mx-1 gap-1.5 rounded-md px-2 text-xs",
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
              aria-current={resolvedView === "board" ? "page" : undefined}
              className={cn(
                "h-6 scroll-mx-1 gap-1.5 rounded-md px-2 text-xs",
                resolvedView !== "board" && "text-muted-foreground",
              )}
            >
              <SquareKanban className="size-3.5" />
              {t("navigation:projectViews.workItems")}
            </Button>
            {calendarOn ? (
              <Button
                variant={resolvedView === "calendar" ? "secondary" : "ghost"}
                size="xs"
                onClick={handleNavigateToCalendar}
                aria-current={resolvedView === "calendar" ? "page" : undefined}
                className={cn(
                  "h-6 scroll-mx-1 gap-1.5 rounded-md px-2 text-xs",
                  resolvedView !== "calendar" && "text-muted-foreground",
                )}
              >
                <CalendarRange className="size-3.5" />
                {t("navigation:projectViews.calendar")}
              </Button>
            ) : null}
            {ganttOn ? (
              <Button
                variant={resolvedView === "gantt" ? "secondary" : "ghost"}
                size="xs"
                onClick={handleNavigateToGantt}
                aria-current={resolvedView === "gantt" ? "page" : undefined}
                className={cn(
                  "h-6 scroll-mx-1 gap-1.5 rounded-md px-2 text-xs",
                  resolvedView !== "gantt" && "text-muted-foreground",
                )}
              >
                <CalendarDays className="size-3.5" />
                Gantt
              </Button>
            ) : null}
            {agileFeatures.cycles ? (
              <Button
                variant={resolvedView === "cycles" ? "secondary" : "ghost"}
                size="xs"
                onClick={handleNavigateToCycles}
                aria-current={resolvedView === "cycles" ? "page" : undefined}
                className={cn(
                  "h-6 scroll-mx-1 gap-1.5 rounded-md px-2 text-xs",
                  resolvedView !== "cycles" && "text-muted-foreground",
                )}
              >
                <Repeat className="size-3.5" />
                {t("navigation:projectViews.cycles")}
              </Button>
            ) : null}
            {agileFeatures.modules ? (
              <Button
                variant={resolvedView === "modules" ? "secondary" : "ghost"}
                size="xs"
                onClick={handleNavigateToModules}
                aria-current={resolvedView === "modules" ? "page" : undefined}
                className={cn(
                  "h-6 scroll-mx-1 gap-1.5 rounded-md px-2 text-xs",
                  resolvedView !== "modules" && "text-muted-foreground",
                )}
              >
                <Layers className="size-3.5" />
                {t("navigation:projectViews.modules")}
              </Button>
            ) : null}
            {pagesOn ? (
              <Button
                variant={resolvedView === "pages" ? "secondary" : "ghost"}
                size="xs"
                onClick={handleNavigateToPages}
                aria-current={resolvedView === "pages" ? "page" : undefined}
                className={cn(
                  "h-6 scroll-mx-1 gap-1.5 rounded-md px-2 text-xs",
                  resolvedView !== "pages" && "text-muted-foreground",
                )}
              >
                <FileText className="size-3.5" />
                {t("navigation:projectViews.pages")}
              </Button>
            ) : null}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
