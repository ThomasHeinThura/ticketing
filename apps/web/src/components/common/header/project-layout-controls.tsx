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
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import ProjectCrumbSelect from "@/components/common/header/project-crumb-select";
// Loaded with the strip, not lazily: the "More" menu then paints in the same commit as the
// measurement that shows it, so the header never settles without it and shifts afterwards.
import ProjectViewOverflowMenu from "@/components/common/header/project-view-overflow-menu";
import useAgileFeatures from "@/hooks/queries/agile/use-agile-features";
import useProjectPagesFeature, {
  useProjectFeature,
} from "@/hooks/queries/feature-flag/use-project-pages-feature";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { buildProjectViewSwitchUrl } from "@/lib/project-layout-navigation";
import {
  PROJECT_BACKLOG_PATH,
  PROJECT_BOARD_PATH,
  PROJECT_CALENDAR_PATH,
  PROJECT_GANTT_PATH,
  routes,
} from "@/lib/routes";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";

const MobileProjectNav = lazy(
  () => import("@/components/common/header/mobile-project-nav"),
);

/** Below `lg` the header has no room for the tab strip; the project menu lists the views. */
const TAB_STRIP_BREAKPOINT = 1024;

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

/** The canonical project Timeline lives at `/agent/projects/{key}/timeline`. */
const TIMELINE_PATH = /^\/agent\/projects\/[^/]+\/timeline\/?$/u;

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
  if (pathname.includes("/gantt") || TIMELINE_PATH.test(pathname))
    return "gantt";
  return "board";
}

const OVERVIEW_VIEW_ROUTES = {
  overview: routes.projectOverview,
  prerequisites: routes.projectPrerequisites,
  team: routes.projectTeam,
  documents: routes.projectDocuments,
} as const;

function ViewTab({
  view,
  active,
  icon: Icon,
  onClick,
  children,
}: {
  view: ProjectView;
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
      data-project-view={view}
      aria-current={active ? "page" : undefined}
      className={cn(
        // The scroll margin matches the strip's 1.5rem edge fade, so a focused or
        // active tab scrolled into view is never left under the fade.
        "h-6 scroll-mx-6 gap-1.5 rounded-md px-2 text-xs",
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
  const showsProjectMenu = useIsMobile(TAB_STRIP_BREAKPOINT);
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const activeWorkspaceId = getActiveOrganizationId(session);
  const isActiveWorkspace = Boolean(
    !isSessionPending && activeWorkspaceId && activeWorkspaceId === workspaceId,
  );
  const { data: workspaceProjects } = useGetProjects({ workspaceId });
  const canonicalProjectSlug = (
    targetProjectId: string,
    candidateSlug: string | undefined,
  ): string | undefined => {
    if (!candidateSlug || !isActiveWorkspace) return undefined;
    const canonical = workspaceProjects?.find(
      (candidate) => candidate.slug === candidateSlug,
    );
    if (
      !canonical ||
      canonical.id !== targetProjectId ||
      (canonical.workspaceId !== undefined &&
        canonical.workspaceId !== workspaceId)
    ) {
      return undefined;
    }
    return candidateSlug;
  };
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
  // Tabs that are not fully inside the strip's visible frame (scrolled away or under the edge
  // fade) are listed in the "More" menu, so none is out of reach at a glance. Every tab stays
  // in the strip. The menu appears only while the strip overflows, and the room it takes can only
  // hide more tabs, never bring them all back, so it cannot cause a resize loop.
  const [hiddenViews, setHiddenViews] = useState<string[]>([]);
  // The widest tab's width in px, measured in the user's language: the strip's slot never gets
  // narrower than that tab plus its 24 px scroll margin on each side, so every tab can be
  // scrolled clear of the edge fade. Tab widths do not depend on the slot, so this cannot loop.
  const [widestTab, setWidestTab] = useState(0);
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const viewport = tabs?.parentElement;
    if (!showViewSwitcher || !tabs || !viewport) {
      setHiddenViews((current) => (current.length ? [] : current));
      return;
    }
    const measure = () => {
      const frame = viewport.getBoundingClientRect();
      const hidden: string[] = [];
      let widest = 0;
      if (frame.width > 0)
        for (const tab of tabs.querySelectorAll<HTMLElement>(
          "[data-project-view]",
        )) {
          const box = tab.getBoundingClientRect();
          widest = Math.max(widest, Math.ceil(box.width));
          if (box.left < frame.left - 1 || box.right > frame.right + 1)
            hidden.push(tab.dataset.projectView ?? "");
        }
      if (widest > 0) setWidestTab(widest);
      setHiddenViews((current) =>
        current.length === hidden.length &&
        current.every((view, index) => view === hidden[index])
          ? current
          : hidden,
      );
    };
    measure();
    viewport.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(tabs);
    return () => {
      viewport.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
    // Feature tabs appearing or going change the strip's size, which the observer reports.
  }, [showViewSwitcher]);
  // A vertical mouse wheel over the strip scrolls it sideways while it can still move that
  // way; at either end the page scrolls as usual. React's wheel handler is passive, so this is
  // a native listener that may cancel the vertical scroll.
  useEffect(() => {
    const viewport = tabsRef.current?.parentElement;
    if (!showViewSwitcher || !viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const maxScroll = viewport.scrollWidth - viewport.clientWidth;
      if (maxScroll <= 0) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (
        (delta < 0 && viewport.scrollLeft <= 0) ||
        (delta > 0 && viewport.scrollLeft >= maxScroll)
      )
        return;
      event.preventDefault();
      viewport.scrollLeft += delta;
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [showViewSwitcher]);
  const handleNavigateToOverviewView = (
    view: keyof typeof OVERVIEW_VIEW_ROUTES,
  ) => {
    const resolvedSlug = canonicalProjectSlug(projectId, projectSlug);
    if (resolvedSlug)
      void navigate({
        href: OVERVIEW_VIEW_ROUTES[view].build({ projectKey: resolvedSlug }),
      });
  };
  const handleNavigateToBacklog = () => {
    const resolvedSlug = canonicalProjectSlug(projectId, projectSlug);
    if (!projectSlug && !resolvedSlug) return;
    if (!resolvedSlug && (!workspaceId || !projectId)) return;
    void navigate({
      href: buildProjectViewSwitchUrl(
        "backlog",
        { workspaceId, projectId, projectKey: resolvedSlug },
        location.searchStr,
      ),
    });
  };
  const handleNavigateToBoard = () => {
    const resolvedSlug = canonicalProjectSlug(projectId, projectSlug);
    if (!projectSlug && !resolvedSlug) return;
    if (!resolvedSlug && (!workspaceId || !projectId)) return;
    void navigate({
      href: buildProjectViewSwitchUrl(
        "board",
        { workspaceId, projectId, projectKey: resolvedSlug },
        location.searchStr,
      ),
    });
  };
  const handleNavigateToCycles = () => {
    const resolvedSlug = canonicalProjectSlug(projectId, projectSlug);
    if (resolvedSlug)
      void navigate({
        href: routes.projectCycles.build({ projectKey: resolvedSlug }),
      });
  };
  const handleNavigateToPages = () => {
    const resolvedSlug = canonicalProjectSlug(projectId, projectSlug);
    if (resolvedSlug)
      void navigate({
        href: routes.projectPages.build({ projectKey: resolvedSlug }),
      });
  };
  const handleNavigateToModules = () => {
    const resolvedSlug = canonicalProjectSlug(projectId, projectSlug);
    if (resolvedSlug)
      void navigate({
        href: routes.projectModules.build({ projectKey: resolvedSlug }),
      });
  };
  const handleNavigateToCalendar = () => {
    // Use the canonical `/agent` Calendar only when this workspace is active and its project
    // key resolves back to this exact project; otherwise keep workspace/project identity via
    // Kaneo's ID-scoped calendar URL and its guarded redirect.
    const resolvedSlug = canonicalProjectSlug(projectId, projectSlug);
    const calendarUrl = buildProjectViewSwitchUrl(
      "calendar",
      { workspaceId, projectId, projectKey: resolvedSlug },
      location.searchStr,
    );
    void navigate(
      resolvedSlug || calendarUrl.includes("?")
        ? { href: calendarUrl }
        : { to: calendarUrl },
    );
  };
  const handleNavigateToGantt = () => {
    // Use the canonical `/agent` Timeline only when this workspace is active and its project
    // key resolves back to this exact project; otherwise keep workspace/project identity via
    // Kaneo's ID-scoped Gantt URL.
    const resolvedSlug = canonicalProjectSlug(projectId, projectSlug);
    const timelineUrl = buildProjectViewSwitchUrl(
      "gantt",
      { workspaceId, projectId, projectKey: resolvedSlug },
      location.searchStr,
    );
    void navigate(
      resolvedSlug || timelineUrl.includes("?")
        ? { href: timelineUrl }
        : { to: timelineUrl },
    );
  };
  const handleProjectSwitch = (nextProjectId: string) => {
    const nextProject = workspaceProjects?.find(
      (candidate) => candidate.id === nextProjectId,
    );
    if (!nextProject) return;
    const nextCanonicalSlug = canonicalProjectSlug(
      nextProject.id,
      nextProject.slug,
    );
    if (resolvedView in OVERVIEW_VIEW_ROUTES) {
      if (nextCanonicalSlug) {
        void navigate({
          href: OVERVIEW_VIEW_ROUTES[
            resolvedView as keyof typeof OVERVIEW_VIEW_ROUTES
          ].build({ projectKey: nextCanonicalSlug }),
        });
      } else {
        void navigate({
          to: PROJECT_BOARD_PATH,
          params: { workspaceId, projectId: nextProject.id },
        });
      }
      return;
    }
    if (resolvedView === "gantt") {
      if (nextCanonicalSlug) {
        void navigate({
          href: routes.projectTimeline.build({ projectKey: nextCanonicalSlug }),
        });
      } else {
        void navigate({
          to: PROJECT_GANTT_PATH,
          params: { workspaceId, projectId: nextProject.id },
        });
      }
      return;
    }
    if (resolvedView === "calendar") {
      if (nextCanonicalSlug) {
        void navigate({
          href: routes.projectCalendar.build({ projectKey: nextCanonicalSlug }),
        });
      } else {
        void navigate({
          to: PROJECT_CALENDAR_PATH,
          params: { workspaceId, projectId: nextProject.id },
        });
      }
      return;
    }
    if (
      resolvedView === "board" ||
      resolvedView === "backlog" ||
      resolvedView === "cycles" ||
      resolvedView === "modules" ||
      resolvedView === "pages"
    ) {
      if (!nextCanonicalSlug) {
        void navigate({
          to:
            resolvedView === "backlog"
              ? PROJECT_BACKLOG_PATH
              : PROJECT_BOARD_PATH,
          params: { workspaceId, projectId: nextProject.id },
        });
        return;
      }
      void navigate({
        href:
          resolvedView === "backlog"
            ? routes.projectBacklog.build({ projectKey: nextCanonicalSlug })
            : resolvedView === "cycles"
              ? routes.projectCycles.build({ projectKey: nextCanonicalSlug })
              : resolvedView === "pages"
                ? routes.projectPages.build({ projectKey: nextCanonicalSlug })
                : resolvedView === "modules"
                  ? routes.projectModules.build({
                      projectKey: nextCanonicalSlug,
                    })
                  : routes.workItemList.build(
                      { projectKey: nextCanonicalSlug },
                      { layout: "board" },
                    ),
      });
      return;
    }
  };

  // One list drives the strip and its "More" menu, in the strip's order.
  const viewTabs: Array<{
    view: ProjectView;
    icon: LucideIcon;
    label: string;
    onSelect: () => void;
  }> = [
    {
      view: "overview",
      icon: LayoutDashboard,
      label: t("navigation:projectViews.overview"),
      onSelect: () => handleNavigateToOverviewView("overview"),
    },
    {
      view: "backlog",
      icon: SquircleDashed,
      label: t("navigation:projectViews.backlog"),
      onSelect: handleNavigateToBacklog,
    },
    {
      view: "board",
      icon: SquareKanban,
      label: t("navigation:projectViews.workItems"),
      onSelect: handleNavigateToBoard,
    },
    ...(calendarOn
      ? [
          {
            view: "calendar" as const,
            icon: CalendarRange,
            label: t("navigation:projectViews.calendar"),
            onSelect: handleNavigateToCalendar,
          },
        ]
      : []),
    ...(ganttOn
      ? [
          {
            view: "gantt" as const,
            icon: CalendarDays,
            label: t("navigation:projectViews.timeline"),
            onSelect: handleNavigateToGantt,
          },
        ]
      : []),
    ...(agileFeatures.cycles
      ? [
          {
            view: "cycles" as const,
            icon: Repeat,
            label: t("navigation:projectViews.cycles"),
            onSelect: handleNavigateToCycles,
          },
        ]
      : []),
    ...(agileFeatures.modules
      ? [
          {
            view: "modules" as const,
            icon: Layers,
            label: t("navigation:projectViews.modules"),
            onSelect: handleNavigateToModules,
          },
        ]
      : []),
    ...(pagesOn
      ? [
          {
            view: "pages" as const,
            icon: FileText,
            label: t("navigation:projectViews.pages"),
            onSelect: handleNavigateToPages,
          },
        ]
      : []),
    {
      view: "prerequisites",
      icon: ListChecks,
      label: t("navigation:projectViews.prerequisites"),
      onSelect: () => handleNavigateToOverviewView("prerequisites"),
    },
    {
      view: "team",
      icon: Users,
      label: t("navigation:projectViews.team"),
      onSelect: () => handleNavigateToOverviewView("team"),
    },
    {
      view: "documents",
      icon: Files,
      label: t("navigation:projectViews.documents"),
      onSelect: () => handleNavigateToOverviewView("documents"),
    },
  ];
  const overflowItems = viewTabs
    .filter((tab) => hiddenViews.includes(tab.view))
    .map((tab) => ({ ...tab, active: resolvedView === tab.view }));

  return (
    // No min-w-0 here: the project crumb and the strip's minimum width hold their room, so on a
    // narrow header the workspace crumb before them truncates instead.
    <div className="flex flex-1 items-center gap-2">
      {/* Kaneo keeps the project crumb's label (up to max-w-40); it never shrinks to the chevron. */}
      <div className="hidden min-w-0 shrink-0 items-center gap-1 md:flex [&>button]:max-w-40 [&>button]:min-w-0">
        <ProjectCrumbSelect
          workspaceId={workspaceId}
          projectId={projectId}
          projectName={projectName}
          onSelectProject={handleProjectSwitch}
          onAddProject={addProject}
        />
      </div>

      {showsProjectMenu && projectId && workspaceId ? (
        <div className="lg:hidden">
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
        // The "More" menu sits beside the strip's slot, not inside it, so its width is added to
        // the header's minimum size instead of being taken from the strip's.
        <div className="hidden flex-1 items-center gap-1 lg:flex">
          {/* The slot takes the room left after the crumb and the "More" menu but never less
              than the widest tab plus its 24 px scroll margin on each side (3rem) and the
              strip's 1 px borders, so every tab can sit clear of the fade; min-w-44 holds that
              room until the tabs are measured. Inline-size containment keeps the tabs' full
              width out of the header's minimum size, so the workspace crumb truncates first.
              The strip itself stays as wide as its tabs; the menu shows only while the strip
              overflows, so it always sits right after the strip. */}
          <div
            className="flex min-w-44 flex-1 items-center contain-inline-size"
            style={
              widestTab > 0
                ? { minWidth: `calc(${widestTab}px + 3rem + 2px)` }
                : undefined
            }
          >
            {/* The fade's mask clips anything drawn outside the scroll frame, so the frame's
              focus ring is drawn on the strip's root instead. */}
            <ScrollArea
              scrollFade
              aria-label={t("navigation:projectViews.workItems")}
              className="h-8 w-max min-w-0 max-w-full shrink rounded-lg border border-border/80 bg-background has-[[data-slot=scroll-area-viewport]:focus-visible]:ring-2 has-[[data-slot=scroll-area-viewport]:focus-visible]:ring-ring has-[[data-slot=scroll-area-viewport]:focus-visible]:ring-offset-1 has-[[data-slot=scroll-area-viewport]:focus-visible]:ring-offset-background"
              onFocusCapture={(event) => {
                const target = event.target;
                if (
                  target instanceof HTMLElement &&
                  tabsRef.current?.contains(target)
                )
                  target.scrollIntoView?.({
                    block: "nearest",
                    inline: "nearest",
                  });
              }}
            >
              <div
                ref={tabsRef}
                className="inline-flex h-full w-max min-w-max items-center gap-0.5 p-0.5"
              >
                {viewTabs.map((tab) => (
                  <ViewTab
                    key={tab.view}
                    view={tab.view}
                    active={resolvedView === tab.view}
                    icon={tab.icon}
                    onClick={tab.onSelect}
                  >
                    {tab.label}
                  </ViewTab>
                ))}
              </div>
            </ScrollArea>
          </div>
          {overflowItems.length > 0 ? (
            <ProjectViewOverflowMenu items={overflowItems} />
          ) : null}
        </div>
      )}
    </div>
  );
}
