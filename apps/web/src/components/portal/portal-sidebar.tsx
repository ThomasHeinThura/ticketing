import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@taskdesk/ui";
import {
  Bell,
  Headset,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Settings,
} from "lucide-react";
import { ActionTooltip } from "@/components/common/action-tooltip";
import { getPortalKb } from "@/fetchers/kb/portal";
import { getPortalReleases } from "@/fetchers/portal/releases";
import {
  getDefaultPortalTerm,
  usePortalTranslation,
} from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/routes";
import {
  isPortalNavigationActive,
  type PortalNavigationMatch,
  portalAriaCurrent,
  portalSupportMatch,
} from "./portal-navigation";

type NavigationEntry = PortalNavigationMatch & {
  label: string;
  icon: LucideIcon;
  children?: Array<{ to: string; label: string; title?: string }>;
};

/** Customer navigation uses Kaneo's sidebar/inset composition, without agent imports. */
export default function PortalSidebar() {
  const { t, i18n } = usePortalTranslation("portal");
  const pathname = useLocation({ select: (location) => location.pathname });
  // The knowledge base entry only appears when the portal has something to show (KB flag on,
  // at least one published, customer-visible article within the organisation's reach).
  const knowledgeBase = useQuery({
    queryKey: ["portal", "kb-navigation"],
    queryFn: () => getPortalKb({ limit: 1 }),
    retry: false,
    staleTime: 60_000,
  });
  // Announcements lists portal release notes; it appears only where that feature answers.
  const releases = useQuery({
    queryKey: ["portal", "release-navigation"],
    queryFn: () => getPortalReleases({ limit: 1 }),
    retry: false,
    staleTime: 60_000,
  });
  const navigation: NavigationEntry[] = [
    {
      to: routes.portalHome.path,
      exact: true,
      label: t("navigation.dashboard"),
      icon: LayoutDashboard,
    },
    {
      ...portalSupportMatch,
      label: t("navigation.support"),
      icon: Headset,
      children: [
        {
          to: routes.portalRequests.path,
          label: t("navigation.requests"),
          // A renamed request noun keeps the shipped word as a tooltip.
          title: getDefaultPortalTerm(i18n, "request", 2),
        },
        { to: routes.portalCatalogue.path, label: t("navigation.catalogue") },
        { to: routes.portalApprovals.path, label: t("navigation.approvals") },
        ...((knowledgeBase.data?.total ?? 0) > 0
          ? [{ to: routes.portalKb.path, label: t("navigation.knowledgeBase") }]
          : []),
      ],
    },
    {
      to: routes.portalInbox.path,
      label: t("navigation.updates"),
      icon: Bell,
    },
    ...(releases.isSuccess
      ? [
          {
            to: routes.portalReleases.path,
            label: t("navigation.announcements"),
            icon: Megaphone,
          },
        ]
      : []),
    {
      to: routes.portalAccount.path,
      label: t("navigation.settings"),
      icon: Settings,
    },
  ];
  return (
    <Sidebar
      variant="inset"
      collapsible="offcanvas"
      className="border-none pt-1.5"
      closeLabel={t("common:actions.close")}
      mobileTitle={t("navigation.title")}
      mobileDescription={t("navigation.description")}
    >
      <SidebarHeader className="pt-1 pb-1.5">
        <Link
          to={routes.portalHome.path}
          className="flex h-8 items-center rounded-md px-2 font-medium text-sm"
        >
          {t("navigation.title")}
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-1 py-1" nativeScroll>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((entry) => {
                const Icon = entry.icon;
                return (
                  <SidebarMenuItem key={entry.to}>
                    <SidebarMenuButton
                      isActive={isPortalNavigationActive(pathname, entry)}
                      render={
                        <Link
                          to={entry.to}
                          aria-current={portalAriaCurrent(pathname, entry.to)}
                        />
                      }
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      <span>{entry.label}</span>
                    </SidebarMenuButton>
                    {entry.children ? (
                      <SidebarMenuSub>
                        {entry.children.map((child) => {
                          const button = (
                            <SidebarMenuSubButton
                              isActive={isPortalNavigationActive(pathname, {
                                to: child.to,
                                prefixes:
                                  child.to === routes.portalRequests.path
                                    ? ["/submissions"]
                                    : undefined,
                              })}
                              render={
                                <Link
                                  to={child.to}
                                  aria-current={portalAriaCurrent(
                                    pathname,
                                    child.to,
                                  )}
                                />
                              }
                            >
                              <span>{child.label}</span>
                            </SidebarMenuSubButton>
                          );
                          return (
                            <SidebarMenuSubItem key={child.to}>
                              {child.title ? (
                                <ActionTooltip label={child.title}>
                                  {button}
                                </ActionTooltip>
                              ) : (
                                button
                              )}
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
