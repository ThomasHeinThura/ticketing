import { Link, useLocation } from "@tanstack/react-router";
import {
  Button,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@taskdesk/ui";
import {
  CalendarDays,
  Inbox,
  MessageSquareText,
  Settings,
  Shield,
  Tag,
  Timer,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import SettingsSidebar from "@/components/SettingsSidebar";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

export function WorkspaceSettingsFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { workspace, role, canManageWorkspaceSettings } =
    useWorkspacePermission();
  const location = useLocation();
  const menuItems = [
    {
      title: t("settings:workspaceGeneral.title"),
      url: "/dashboard/settings/workspace/general",
      icon: Settings,
    },
    {
      title: t("settings:workspaceRoles.title", { defaultValue: "Roles" }),
      url: "/dashboard/settings/workspace/roles",
      icon: Shield,
    },
    {
      title: t("settings:workspaceLabels.title", { defaultValue: "Labels" }),
      url: "/dashboard/settings/workspace/labels",
      icon: Tag,
    },
    ...(canManageWorkspaceSettings()
      ? [
          {
            title: t("settings:cannedResponses.title"),
            url: "/agent/settings/canned-responses",
            icon: MessageSquareText,
          },
        ]
      : []),
    {
      title: t("serviceCalendars:list.title"),
      url: "/agent/settings/calendars",
      icon: CalendarDays,
    },
    {
      title: t("slaPolicies:list.title"),
      url: "/agent/settings/sla-policies",
      icon: Timer,
    },
    {
      title: t("requestTypes:title"),
      url: "/agent/settings/request-types",
      icon: Inbox,
    },
  ];
  const isActivePath = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);
  const workspaceInitials = getInitials(workspace?.name, "WS");

  return (
    <div className="flex gap-6 h-full">
      <SettingsSidebar>
        <div className="p-2">
          <div className="mb-1 flex items-center gap-3 rounded-md px-2 py-2">
            <Avatar className="h-8 w-8">
              <AvatarImage
                src={workspace?.logo ?? ""}
                alt={workspace?.name || ""}
              />
              <AvatarFallback className="border border-sidebar-border/70 bg-sidebar-accent/70 text-xs font-medium text-sidebar-accent-foreground">
                {workspaceInitials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col md:min-w-fit">
              <p className="truncate text-sm md:overflow-visible md:text-clip md:whitespace-normal">
                {workspace?.name}
              </p>
              <p className="truncate text-xs text-sidebar-foreground capitalize md:overflow-visible md:text-clip md:whitespace-normal">
                {t(`team:roles.${role}`, { defaultValue: role })}
              </p>
            </div>
          </div>

          <SidebarGroup className="gap-1 p-1">
            <SidebarGroupLabel className="h-7 px-2 text-xs uppercase tracking-wide text-sidebar-foreground">
              {t("navigation:page.settingsWorkspaceTab")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {menuItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <Button
                      render={<Link to={item.url} />}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 w-full justify-start gap-2 rounded-lg px-2 text-sm font-normal text-sidebar-foreground",
                        isActivePath(item.url) &&
                          "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Button>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </SettingsSidebar>

      <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
    </div>
  );
}
