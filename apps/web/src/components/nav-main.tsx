import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@taskdesk/ui";
import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { usePendingInvitations } from "@/hooks/queries/invitation/use-pending-invitations";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { afterFirstPaint } from "@/lib/i18n/after-first-paint";
import { routes } from "@/lib/routes";
import { savedViewKeys } from "@/lib/saved-view-keys";

type SavedViewFetchers = typeof import("@/fetchers/saved-views");

let savedViewFetchersPromise: Promise<SavedViewFetchers> | undefined;

/** The saved-view fetchers load once, with the first read, and are shared by every query (G11). */
function loadSavedViewFetchers(): Promise<SavedViewFetchers> {
  if (!savedViewFetchersPromise) {
    savedViewFetchersPromise = import("@/fetchers/saved-views").catch(
      (error: unknown) => {
        savedViewFetchersPromise = undefined;
        throw error;
      },
    );
  }
  return savedViewFetchersPromise;
}

export function NavMain() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const navigate = useNavigate();
  const { data: invitations = [] } = usePendingInvitations();
  const { user } = useAuth();
  // Pinned views and their counts are not needed to paint the shell (G11), so they are read
  // once the page has painted. The list and each count are keyed by viewer (SV-20, SV-22).
  const [shellPainted, setShellPainted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void afterFirstPaint().then(() => {
      if (!cancelled) setShellPainted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const savedViews = useQuery({
    queryKey: savedViewKeys.list(workspace?.id, user?.id),
    queryFn: async () => {
      const { getSavedViews } = await loadSavedViewFetchers();
      return getSavedViews(workspace?.id ?? "");
    },
    enabled: Boolean(workspace?.id && user?.id && shellPainted),
  });
  const pinnedViews = (savedViews.data ?? []).filter((view) => view.isPinned);
  const pinnedCounts = useQueries({
    queries: pinnedViews.map((view) => ({
      queryKey: savedViewKeys.count(user?.id, view.id, view.updatedAt),
      queryFn: async () => {
        const { countSavedView } = await loadSavedViewFetchers();
        return countSavedView(view.id);
      },
      staleTime: 30_000,
      // An unexecutable view answers 422; it keeps its link and simply shows no badge.
      retry: false,
    })),
  });

  if (!workspace) return null;

  const pendingCount = invitations.length;

  const navItems = [
    {
      title: t("navigation:sidebar.projects"),
      url: `/dashboard/workspace/${workspace.id}`,
      isActive:
        window.location.pathname === `/dashboard/workspace/${workspace.id}`,
      badge: null,
    },
    {
      title: t("navigation:sidebar.members"),
      url: `/dashboard/workspace/${workspace.id}/members`,
      isActive:
        window.location.pathname ===
        `/dashboard/workspace/${workspace.id}/members`,
      badge: null,
    },
    {
      title: t("navigation:sidebar.savedViews"),
      url: routes.savedViews.path,
      isActive: window.location.pathname === routes.savedViews.path,
      badge: null,
    },
    {
      title: t("navigation:sidebar.invitations"),
      url: "/dashboard/invitations",
      isActive: window.location.pathname === "/dashboard/invitations",
      badge: pendingCount > 0 ? pendingCount : null,
    },
  ];

  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup className="gap-1 p-2">
        <CollapsibleTrigger
          className="data-panel-open:[&_svg]:rotate-90"
          render={
            <SidebarGroupLabel className="h-7 cursor-pointer justify-between px-0 text-sidebar-accent-foreground" />
          }
        >
          <span>{t("navigation:sidebar.overview")}</span>
          <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map((item) => (
                <Fragment key={item.url}>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={item.isActive}
                      size="default"
                      className="h-8 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                      onClick={() => navigate({ to: item.url })}
                    >
                      <span>{item.title}</span>
                      {item.badge !== null && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-sm border border-sidebar-border/60 px-1 text-[11px] font-medium text-sidebar-foreground">
                          {item.badge}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {/* Pinned views sit directly under the Saved views entry (SV-20). */}
                  {item.url === routes.savedViews.path
                    ? pinnedViews.map((view, index) => (
                        <SidebarMenuItem key={view.id}>
                          <SidebarMenuButton
                            tooltip={view.name}
                            isActive={
                              window.location.pathname ===
                              routes.savedView
                                .build({ id: view.id })
                                .split("?")[0]
                            }
                            size="default"
                            className="h-8 ps-6 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                            onClick={() =>
                              // The screen replaces a bare URL with the view's definition.
                              navigate({
                                to: routes.savedView.path,
                                params: { id: view.id },
                              })
                            }
                          >
                            <span className="truncate">{view.name}</span>
                            {pinnedCounts[index]?.data !== undefined && (
                              <span
                                className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-sm border border-sidebar-border/60 px-1 font-medium text-[11px] text-sidebar-foreground"
                                data-testid="saved-view-count-badge"
                              >
                                {pinnedCounts[index]?.data}
                              </span>
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))
                    : null}
                </Fragment>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}
