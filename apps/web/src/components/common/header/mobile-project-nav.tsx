import { Button, Popover, PopoverContent, PopoverTrigger } from "@taskdesk/ui";
import {
  CalendarDays,
  CalendarRange,
  Check,
  Files,
  FileText,
  Layers,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Menu,
  Plus,
  Repeat,
  Settings,
  SquareKanban,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import icons from "@/constants/project-icons";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { cn } from "@/lib/cn";

type MobileProjectNavProps = {
  workspaceId: string;
  projectId: string;
  activeView:
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
  /** S3 Overview and its tabs. */
  onSelectOverview?: () => void;
  onSelectPrerequisites?: () => void;
  onSelectTeam?: () => void;
  onSelectDocuments?: () => void;
  onSelectBoard: () => void;
  onSelectBacklog: () => void;
  /** Offered only while `feature.calendar` / `feature.timeline` is on. */
  onSelectCalendar?: () => void;
  onSelectGantt?: () => void;
  /** Present only when `feature.cycles` resolves on for the project. */
  onSelectCycles?: () => void;
  /** Present only when `feature.modules` resolves on for the project. */
  onSelectModules?: () => void;
  /** Project pages are staff-only and always offered to the agent surface. */
  onSelectPages?: () => void;
  onSelectProject: (projectId: string) => void;
  onAddProject?: () => void;
  /** Opens the current project's settings (L-03). */
  onOpenProjectSettings?: () => void;
};

function MobileViewButton({
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
      variant="ghost"
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-border bg-secondary text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </Button>
  );
}

export default function MobileProjectNav({
  workspaceId,
  projectId,
  activeView,
  onSelectOverview,
  onSelectPrerequisites,
  onSelectTeam,
  onSelectDocuments,
  onSelectBoard,
  onSelectBacklog,
  onSelectCalendar,
  onSelectGantt,
  onSelectCycles,
  onSelectModules,
  onSelectPages,
  onSelectProject,
  onAddProject,
  onOpenProjectSettings,
}: MobileProjectNavProps) {
  const { t } = useTranslation();
  const { data: projects = [] } = useGetProjects({ workspaceId });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("navigation:mobileProjectNav.menuLabel")}
            className="size-7 border border-transparent"
          />
        }
      >
        <Menu className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              View
            </p>
            <div className="grid grid-cols-3 gap-1">
              {onSelectOverview ? (
                <MobileViewButton
                  active={activeView === "overview"}
                  icon={LayoutDashboard}
                  onClick={onSelectOverview}
                >
                  {t("navigation:projectViews.overview")}
                </MobileViewButton>
              ) : null}
              <Button
                variant="ghost"
                type="button"
                onClick={onSelectBacklog}
                className={cn(
                  "flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                  activeView === "backlog"
                    ? "border-border bg-secondary text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent",
                )}
              >
                Backlog
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={onSelectBoard}
                className={cn(
                  "flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                  activeView === "board"
                    ? "border-border bg-secondary text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent",
                )}
              >
                <SquareKanban className="size-3.5" />
                Board
              </Button>
              {onSelectCalendar ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={onSelectCalendar}
                  className={cn(
                    "flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                    activeView === "calendar"
                      ? "border-border bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  <CalendarRange className="size-3.5" />
                  {t("navigation:projectViews.calendar")}
                </Button>
              ) : null}
              {onSelectGantt ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={onSelectGantt}
                  className={cn(
                    "flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                    activeView === "gantt"
                      ? "border-border bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  <CalendarDays className="size-3.5" />
                  {t("navigation:projectViews.timeline")}
                </Button>
              ) : null}
              {onSelectCycles ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={onSelectCycles}
                  className={cn(
                    "flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                    activeView === "cycles"
                      ? "border-border bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  <Repeat className="size-3.5" />
                  {t("navigation:projectViews.cycles")}
                </Button>
              ) : null}
              {onSelectModules ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={onSelectModules}
                  className={cn(
                    "flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                    activeView === "modules"
                      ? "border-border bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  <Layers className="size-3.5" />
                  {t("navigation:projectViews.modules")}
                </Button>
              ) : null}
              {onSelectPages ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={onSelectPages}
                  className={cn(
                    "flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                    activeView === "pages"
                      ? "border-border bg-secondary text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  <FileText className="size-3.5" />
                  {t("navigation:projectViews.pages")}
                </Button>
              ) : null}
              {onSelectPrerequisites ? (
                <MobileViewButton
                  active={activeView === "prerequisites"}
                  icon={ListChecks}
                  onClick={onSelectPrerequisites}
                >
                  {t("navigation:projectViews.prerequisites")}
                </MobileViewButton>
              ) : null}
              {onSelectTeam ? (
                <MobileViewButton
                  active={activeView === "team"}
                  icon={Users}
                  onClick={onSelectTeam}
                >
                  {t("navigation:projectViews.team")}
                </MobileViewButton>
              ) : null}
              {onSelectDocuments ? (
                <MobileViewButton
                  active={activeView === "documents"}
                  icon={Files}
                  onClick={onSelectDocuments}
                >
                  {t("navigation:projectViews.documents")}
                </MobileViewButton>
              ) : null}
            </div>
          </div>

          <div className="space-y-1">
            <p className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Projects
            </p>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {(projects ?? []).map((project) => {
                const Icon =
                  icons[project.icon as keyof typeof icons] || icons.Layout;
                const isCurrentProject = project.id === projectId;

                return (
                  <Button
                    variant="ghost"
                    key={project.id}
                    type="button"
                    onClick={() => onSelectProject(project.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      isCurrentProject
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span className="flex-1 truncate">{project.name}</span>
                    {isCurrentProject && <Check className="size-3.5" />}
                  </Button>
                );
              })}
            </div>
          </div>

          {onAddProject ? (
            <Button
              variant="ghost"
              type="button"
              onClick={onAddProject}
              className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Plus className="size-3.5" />
              Add project
            </Button>
          ) : null}

          {onOpenProjectSettings ? (
            <Button
              variant="ghost"
              type="button"
              onClick={onOpenProjectSettings}
              className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Settings className="size-3.5" />
              {t("navigation:projectList.projectSettings")}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
