import { useLocation, useNavigate } from "@tanstack/react-router";
import { Button, useIsMobile } from "@taskdesk/ui";
import { ChevronLeft, PanelLeftIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import PageTitle from "@/components/page-title";
import { SettingsSidebarProvider } from "@/components/SettingsSidebar";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { isGodModePath } from "@/lib/god-mode-paths";
import { routes } from "@/lib/routes";

export type SettingsScope = "account" | "workspace" | "project" | "instance";

/** The scope a settings URL belongs to; the shared `/dashboard/settings` layout spans three. */
export function settingsScopeFromPath(pathname: string): SettingsScope {
  if (pathname.startsWith("/dashboard/settings/account")) return "account";
  if (pathname.startsWith("/dashboard/settings/projects")) return "project";
  if (isGodModePath(pathname)) return "instance";
  return "workspace";
}

const scopeTitleKeys: Record<SettingsScope, string> = {
  account: "settings:account",
  workspace: "navigation:page.settingsWorkspaceTab",
  project: "navigation:projectList.projectSettings",
  instance: "navigation:sidebar.godMode",
};

/** Kaneo settings chrome shared by its existing account, workspace, project and instance areas. */
export function SettingsShell({
  children,
  scope,
}: {
  children: ReactNode;
  /** The settings scope; without it the scope follows the URL. */
  scope?: SettingsScope;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const { data: workspace } = useActiveWorkspace();
  const resolvedScope = scope ?? settingsScopeFromPath(location.pathname);
  const title = t(scopeTitleKeys[resolvedScope]);
  // Project settings go back to that project's board; the other scopes go back to the workspace.
  const settingsProjectId =
    resolvedScope === "project"
      ? location.pathname.match(
          /^\/dashboard\/settings\/projects\/([^/]+)/,
        )?.[1]
      : undefined;
  const { data: settingsProject } = useGetProjects(
    { workspaceId: workspace?.id ?? "" },
    Boolean(settingsProjectId),
    (projects) =>
      projects?.find(
        (project) => project.id === decodeURIComponent(settingsProjectId ?? ""),
      ),
  );
  const backToProject = settingsProject?.slug
    ? routes.workItemList.build(
        { projectKey: settingsProject.slug },
        { layout: "board", sort: "position", dir: "asc" },
      )
    : undefined;

  useEffect(() => {
    if (location.pathname) setSettingsMenuOpen(false);
  }, [location.pathname]);

  useLayoutEffect(() => {
    if (!isMobile) setSettingsMenuOpen(false);
  }, [isMobile]);

  return (
    <>
      <PageTitle title={title} />

      <div className="flex h-full w-full flex-col bg-sidebar p-2 sm:p-4">
        <div className="relative flex h-full min-h-0 flex-col gap-6 overflow-hidden rounded-md border border-border bg-card p-3 md:gap-4 sm:p-4">
          <div className="shrink-0">
            <div className="flex items-center">
              <ActionTooltip label="Open settings menu">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 md:hidden"
                  aria-label="Open settings menu"
                  onClick={() => setSettingsMenuOpen(true)}
                >
                  <PanelLeftIcon className="size-4" />
                </Button>
              </ActionTooltip>

              <div className="flex items-center gap-1 md:hidden">
                <ChevronLeft className="size-4 text-muted-foreground" />
                <h1 className="text-lg font-semibold">{title}</h1>
              </div>

              <Button
                variant="ghost"
                size="sm"
                disabled={!workspace?.id}
                className="hidden md:inline-flex"
                onClick={() => {
                  if (!workspace?.id) return;
                  if (backToProject) navigate({ href: backToProject });
                  else navigate({ to: "/agent" });
                }}
              >
                <ChevronLeft />
                {backToProject
                  ? t("navigation:page.backToProject")
                  : t("navigation:page.backToWorkspace")}
              </Button>
            </div>

            <h1 className="mt-4 hidden pl-1 text-2xl font-semibold md:block">
              {title}
            </h1>
          </div>

          {/* Each settings area owns its existing sidebar; mobile opens that same scoped menu. */}
          <main className="min-h-0 flex-1 overflow-y-auto">
            <SettingsSidebarProvider
              workspaceId={workspace?.id}
              menuOpen={settingsMenuOpen}
              setMenuOpen={setSettingsMenuOpen}
            >
              {children}
            </SettingsSidebarProvider>
          </main>
        </div>
      </div>
    </>
  );
}
