import { useLocation, useNavigate } from "@tanstack/react-router";
import { Button, useIsMobile } from "@taskdesk/ui";
import { ChevronLeft, PanelLeftIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { SettingsSidebarProvider } from "@/components/SettingsSidebar";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

function scopedSettingsTitle(
  t: (key: string) => string,
  pathname: string,
  instance: boolean,
) {
  if (instance) return t("navigation:sidebar.godMode");
  if (pathname.startsWith("/dashboard/settings/account"))
    return t("settings:account");
  if (pathname.startsWith("/agent/settings/profile"))
    return t("settings:account");
  if (pathname.startsWith("/dashboard/settings/projects"))
    return t("navigation:projectList.projectSettings");
  if (pathname.startsWith("/dashboard/settings/workspace"))
    return t("navigation:page.settingsWorkspaceTab");
  if (pathname.startsWith("/agent/settings"))
    return t("navigation:page.settingsWorkspaceTab");
  return t("navigation:page.settingsWorkspaceTab");
}

/** Kaneo settings chrome shared by its existing account, workspace, project and instance areas. */
export function SettingsShell({
  children,
  instance = false,
}: {
  children: ReactNode;
  instance?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const { data: workspace } = useActiveWorkspace();
  const title = scopedSettingsTitle(t, location.pathname, instance);

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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 md:hidden"
                aria-label="Open settings menu"
                title="Open settings menu"
                onClick={() => setSettingsMenuOpen(true)}
              >
                <PanelLeftIcon className="size-4" />
              </Button>

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
                  navigate({ to: "/agent" });
                }}
              >
                <ChevronLeft />
                {t("navigation:page.backToWorkspace")}
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
