import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
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
import { isForbiddenError } from "@/components/settings/settings-access";
import useWorkspaceFeatures from "@/hooks/queries/feature-flag/use-workspace-features";
import { usePendingInvitations } from "@/hooks/queries/invitation/use-pending-invitations";
import { useCatalogueStatus } from "@/hooks/queries/service-management";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
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
  const router = useRouter();
  // Hover or keyboard focus starts loading the destination's code and route checks before the
  // click (S7b). The route checks reuse the cached session, so this sends no extra session read.
  const preload = (to: string, params?: Record<string, string>) => {
    void router.preloadRoute({ to, params } as never).catch(() => {});
  };
  // The highlight follows the router. `window.location` read during render goes stale, because
  // a navigation does not re-render the sidebar. Selecting only the path skips search changes.
  const path = useLocation({ select: (location) => location.pathname });
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
  // `feature.knowledge_base` off: the entry is gone (P5, `docs/technical/architecture-and-experience.md`).
  // The resolved read is open to every workspace member; the admin switch list is not.
  const features = useWorkspaceFeatures(workspace?.id, shellPainted);
  const knowledgeBaseOn = features.isOn("feature.knowledge_base");
  // `feature.time_tracking` off: the Timesheet entry is gone (P5 time and cost).
  // The time APIs need time_entry:create (the built-in Viewer role lacks it), so the entry also
  // follows the strict `logTime` capability.
  const { canLogTime, canTriageIntake } = useWorkspacePermission();
  // Triage needs intake:triage (permissions.md); members and viewers would only meet a 403 (A-04).
  // `feature.intake` off (the default): the entry is gone, as every intake read answers 404.
  const triageOn = canTriageIntake() && features.isOn("feature.intake");
  const timeTrackingOn = features.isOn("feature.time_tracking") && canLogTime();
  // The capabilities response has no report:read flag. The catalogue is the existing
  // authoritative report read, shared with the Reports page and deferred until after paint.
  const reportsEnabled = features.isOn("feature.reports");
  const reportAccess = useQuery({
    queryKey: ["reports", workspace?.id ?? "", "catalogue"],
    queryFn: async () => {
      const { getReportCatalogue } = await import("@/fetchers/report");
      return getReportCatalogue(workspace?.id ?? "");
    },
    enabled: Boolean(shellPainted && workspace?.id && reportsEnabled),
    retry: false,
  });
  const reportStatus = (reportAccess.error as { status?: unknown } | null)
    ?.status;
  const reportsOn =
    reportsEnabled &&
    (reportAccess.isSuccess ||
      (reportAccess.isError &&
        !isForbiddenError(reportAccess.error) &&
        reportStatus !== 404));
  // `feature.service_catalogue` off: the service management entry is gone (P5). The status read
  // is open to everyone who can read projects, unlike the switch list.
  const catalogue = useCatalogueStatus(
    shellPainted ? (workspace?.id ?? "") : "",
  );
  const serviceManagementOn = catalogue.data?.enabled === true;
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
      title: t("navigation:sidebar.inbox"),
      url: routes.agentInbox.path,
      isActive: path === routes.agentInbox.path,
      badge: null,
    },
    {
      title: t("navigation:sidebar.myWork"),
      url: routes.agentMyWork.path,
      isActive: path === routes.agentMyWork.path,
      badge: null,
    },
    ...(triageOn
      ? [
          {
            title: t("navigation:sidebar.triage"),
            url: routes.intakeQueue.path,
            isActive: path.startsWith(routes.intakeQueue.path),
            badge: null,
          },
        ]
      : []),
    {
      title: t("navigation:sidebar.projects"),
      url: routes.agentHome.path,
      isActive:
        path === routes.agentHome.path ||
        path === `/dashboard/workspace/${workspace.id}`,
      badge: null,
    },
    {
      title: t("navigation:sidebar.savedViews"),
      url: routes.savedViews.path,
      isActive: path === routes.savedViews.path,
      badge: null,
    },
    ...(knowledgeBaseOn
      ? [
          {
            title: t("navigation:sidebar.knowledgeBase"),
            url: routes.kb.path,
            isActive: path.startsWith(routes.kb.path),
            badge: null,
          },
        ]
      : []),
    ...(timeTrackingOn
      ? [
          {
            title: t("navigation:sidebar.timesheet"),
            url: routes.timesheet.path,
            isActive: path.startsWith(routes.timesheet.path),
            badge: null,
          },
        ]
      : []),
    ...(reportsOn
      ? [
          {
            title: t("navigation:sidebar.reports"),
            url: routes.reports.path,
            isActive: path.startsWith(routes.reports.path),
            badge: null,
          },
          {
            title: t("navigation:sidebar.dashboard"),
            url: routes.agentDashboard.path,
            isActive: path.startsWith(routes.agentDashboard.path),
            badge: null,
          },
        ]
      : []),
    ...(serviceManagementOn
      ? [
          {
            title: t("navigation:sidebar.serviceManagement"),
            url: routes.serviceManagementServices.path,
            isActive: path.startsWith("/agent/service-management"),
            badge: null,
          },
        ]
      : []),
    {
      title: t("navigation:sidebar.members"),
      // L-03: the canonical members page is in workspace settings; an old per-workspace URL
      // naming another workspace still renders the old page, so it keeps the highlight too.
      url: routes.workspaceMembers.path,
      isActive:
        path === routes.workspaceMembers.path ||
        /^\/dashboard\/workspace\/[^/]+\/members$/u.test(path),
      badge: null,
    },
    {
      title: t("navigation:sidebar.invitations"),
      url: "/dashboard/invitations",
      isActive: path === "/dashboard/invitations",
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
                      onMouseEnter={() => preload(item.url)}
                      onFocus={() => preload(item.url)}
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
                              path ===
                              routes.savedView
                                .build({ id: view.id })
                                .split("?")[0]
                            }
                            size="default"
                            className="h-8 ps-6 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                            onMouseEnter={() =>
                              preload(routes.savedView.path, { id: view.id })
                            }
                            onFocus={() =>
                              preload(routes.savedView.path, { id: view.id })
                            }
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
