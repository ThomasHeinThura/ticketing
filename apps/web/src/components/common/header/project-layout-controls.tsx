import { useLocation, useNavigate } from "@tanstack/react-router";
import { Button, ScrollArea, useIsMobile } from "@taskdesk/ui";
import {
  CalendarDays,
  CalendarRange,
  Files,
  FileText,
  Layers,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Repeat,
  SquareKanban,
  SquircleDashed,
  Users,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useLayoutEffect, useRef } from "react";
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
  | "overview"
  | "backlog"
  | "board"
  | "calendar"
  | "gantt"
  | "cycles"
  | "modules"
  | "pages"
  | "prerequisites"
  | "team"
  | "documents";

/** S3 Overview tabs live at `/agent/projects/{key}[/prerequisites|/team|/documents]`. */
const OVERVIEW_TAB_PATH =
  /^\/agent\/projects\/[^/]+(?:\/(prerequisites|team|documents))?\/?$/u;

/** The current view from the URL, when the route does not say it. Exported for tests. */
export function projectViewFromPath(pathname: string): ProjectView {
  const overviewTab = OVERVIEW_TAB_PATH.exec(pathname);
  if (overviewTab)
    return (overviewTab[1] as ProjectView | undefined) ?? "overview";
  if (pathname.includes("/backlog")) return "backlog";
  if (pathname.includes("/cycles")) return "cycles";
  if (pathname.includes("/modules")) return "modules";
  if (pathname.includes("/pages")) return "pages";
  if (pathname.includes("/calendar")) return "calendar";
  if (pathname.includes("/gantt")) return "gantt";
  return "board";
}

const OVERVIEW_VIEW_ROUTES = {
  overview: routes.projectOverview,
  prerequisites: routes.projectPrerequisites,
  team: routes.projectTeam,
  documents: routes.projectDocuments,
} as const;

function ViewTab({
  active,
  icon: Icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="xs"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "h-6 scroll-mx-1 gap-1.5 rounded-md px-2 text-xs",
        !active && "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </Button>
  );
}

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
  const resolvedView = activeView ?? projectViewFromPath(location.pathname);
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
  const handleNavigateToOverviewView = (
    view: keyof typeof OVERVIEW_VIEW_ROUTES,
  ) => {
    if (projectSlug)
      void navigate({
        href: OVERVIEW_VIEW_ROUTES[view].build({ projectKey: projectSlug }),
      });
  };
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
    if (resolvedView in OVERVIEW_VIEW_ROUTES) {
      void navigate({
        href: OVERVIEW_VIEW_ROUTES[
          resolvedView as keyof typeof OVERVIEW_VIEW_ROUTES
        ].build({ projectKey: nextProject.slug }),
      });
      return;
    }
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
              onSelectOverview={() => handleNavigateToOverviewView("overview")}
              onSelectPrerequisites={() =>
                handleNavigateToOverviewView("prerequisites")
              }
              onSelectTeam={() => handleNavigateToOverviewView("team")}
              onSelectDocuments={() =>
                handleNavigateToOverviewView("documents")
              }
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
              onOpenProjectSettings={() =>
                void navigate({
                  to: routes.projectSettingsGeneral.path,
                  params: { projectId },
                })
              }
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
            <ViewTab
              active={resolvedView === "overview"}
              icon={LayoutDashboard}
              onClick={() => handleNavigateToOverviewView("overview")}
            >
              {t("navigation:projectViews.overview")}
            </ViewTab>
            <ViewTab
              active={resolvedView === "backlog"}
              icon={SquircleDashed}
              onClick={handleNavigateToBacklog}
            >
              {t("navigation:projectViews.backlog")}
            </ViewTab>
            <ViewTab
              active={resolvedView === "board"}
              icon={SquareKanban}
              onClick={handleNavigateToBoard}
            >
              {t("navigation:projectViews.workItems")}
            </ViewTab>
            {calendarOn ? (
              <ViewTab
                active={resolvedView === "calendar"}
                icon={CalendarRange}
                onClick={handleNavigateToCalendar}
              >
                {t("navigation:projectViews.calendar")}
              </ViewTab>
            ) : null}
            {ganttOn ? (
              <ViewTab
                active={resolvedView === "gantt"}
                icon={CalendarDays}
                onClick={handleNavigateToGantt}
              >
                {t("navigation:projectViews.timeline")}
              </ViewTab>
            ) : null}
            {agileFeatures.cycles ? (
              <ViewTab
                active={resolvedView === "cycles"}
                icon={Repeat}
                onClick={handleNavigateToCycles}
              >
                {t("navigation:projectViews.cycles")}
              </ViewTab>
            ) : null}
            {agileFeatures.modules ? (
              <ViewTab
                active={resolvedView === "modules"}
                icon={Layers}
                onClick={handleNavigateToModules}
              >
                {t("navigation:projectViews.modules")}
              </ViewTab>
            ) : null}
            {pagesOn ? (
              <ViewTab
                active={resolvedView === "pages"}
                icon={FileText}
                onClick={handleNavigateToPages}
              >
                {t("navigation:projectViews.pages")}
              </ViewTab>
            ) : null}
            <ViewTab
              active={resolvedView === "prerequisites"}
              icon={ListChecks}
              onClick={() => handleNavigateToOverviewView("prerequisites")}
            >
              {t("navigation:projectViews.prerequisites")}
            </ViewTab>
            <ViewTab
              active={resolvedView === "team"}
              icon={Users}
              onClick={() => handleNavigateToOverviewView("team")}
            >
              {t("navigation:projectViews.team")}
            </ViewTab>
            <ViewTab
              active={resolvedView === "documents"}
              icon={Files}
              onClick={() => handleNavigateToOverviewView("documents")}
            >
              {t("navigation:projectViews.documents")}
            </ViewTab>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
