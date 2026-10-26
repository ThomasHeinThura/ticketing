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
  Clock,
  Inbox,
  Languages,
  LayoutTemplate,
  MessageSquareText,
  PiggyBank,
  Settings,
  Shield,
  SlidersHorizontal,
  Tag,
  Timer,
  UserPlus,
  Users,
  Webhook,
  Workflow,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import SettingsSidebar from "@/components/SettingsSidebar";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";
import { routes } from "@/lib/routes";

export function WorkspaceSettingsFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const {
    workspace,
    role,
    canManageWorkspaceSettings,
    canManageServiceCalendars,
    canManageRoles,
    canManageWebhooks,
    canManageCustomFields,
    canInviteUsers,
    canManageRates,
    canManageWorkflows,
  } = useWorkspacePermission();
  const location = useLocation();
  const canSettings = canManageWorkspaceSettings();
  const canCalendars = canManageServiceCalendars();
  const canRoles = canManageRoles();
  const canWebhooks = canManageWebhooks();
  const canFields = canManageCustomFields();
  const canInvite = canInviteUsers();
  const canRates = canManageRates();
  const canWorkflows = canManageWorkflows();
  // Every entry is shown only to people the server would let into it, using the capability the
  // API of that area enforces: `workspace:manage_roles`, `webhook:manage`, `custom_field:manage`,
  // `sla_policy:manage` (service calendars), `time_entry:manage_rates` (rates), `workflow:manage`
  // (workflows and the CAB template) and otherwise `workspace:manage_settings`. A direct
  // URL still reaches the page, which shows the API's access-denied error.
  const allMenuItems = [
    {
      title: t("settings:workspaceGeneral.title"),
      url: "/dashboard/settings/workspace/general",
      icon: Settings,
      visible: true,
    },
    {
      title: t("settings:workspaceFeatures.title"),
      url: routes.workspaceFeatures.path,
      icon: SlidersHorizontal,
      visible: canSettings,
    },
    {
      title: t("settings:terminology.title", { defaultValue: "Terminology" }),
      url: routes.workspaceTerminology.path,
      icon: Languages,
      visible: canSettings,
    },
    {
      title: t("settings:workspaceRoles.title", { defaultValue: "Roles" }),
      url: "/agent/settings/roles",
      icon: Shield,
      visible: canRoles,
    },
    {
      title: t("settings:workspaceLabels.title", { defaultValue: "Labels" }),
      url: "/dashboard/settings/workspace/labels",
      icon: Tag,
      visible: true,
    },
    {
      title: t("settings:cannedResponses.title"),
      url: "/agent/settings/canned-responses",
      icon: MessageSquareText,
      visible: canSettings,
    },
    {
      title: t("settings:workItemTemplates.title"),
      url: "/agent/settings/work-item-templates",
      icon: LayoutTemplate,
      visible: canSettings,
    },
    {
      title: t("serviceCalendars:list.title"),
      url: "/agent/settings/calendars",
      icon: CalendarDays,
      visible: canCalendars,
    },
    {
      title: t("slaPolicies:list.title"),
      url: "/agent/settings/sla-policies",
      icon: Timer,
      visible: canCalendars,
    },
    {
      title: t("requestTypes:title"),
      url: "/agent/settings/request-types",
      icon: Inbox,
      visible: canSettings,
    },
    {
      title: t("settings:workflows.title"),
      url: "/agent/settings/workflows",
      icon: Workflow,
      visible: canWorkflows,
    },
    {
      title: t("teams:list.title"),
      url: "/agent/settings/teams",
      icon: Users,
      visible: canSettings,
    },
    {
      title: t("timeTracking:activities.title"),
      url: "/agent/settings/time-activities",
      icon: Clock,
      visible: canSettings,
    },
    {
      title: t("timeTracking:rates.title"),
      url: "/agent/settings/rates",
      icon: PiggyBank,
      visible: canRates,
    },
    {
      title: t("customFields:list.title"),
      url: "/agent/settings/custom-fields",
      icon: SlidersHorizontal,
      visible: canFields,
    },
    {
      title: t("customerInvitations:title"),
      url: "/agent/settings/customer-invitations",
      icon: UserPlus,
      visible: canInvite,
    },
    {
      title: t("automations:workspace.title"),
      url: "/agent/settings/automations",
      icon: Zap,
      visible: canSettings,
    },
    {
      title: t("webhooks:list.title"),
      url: "/agent/settings/webhooks",
      icon: Webhook,
      visible: canWebhooks,
    },
  ];
  const menuItems = allMenuItems.filter((item) => item.visible);
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
