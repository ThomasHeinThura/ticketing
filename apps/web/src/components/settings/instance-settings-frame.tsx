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
  Activity,
  Bell,
  FileClock,
  Settings,
  Shield,
  ToggleRight,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import SettingsSidebar from "@/components/SettingsSidebar";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
export function InstanceSettingsFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items = [
    {
      title: t("godModeHealth:title"),
      path: routes.godModeHealth.path,
      icon: Activity,
      // The landing page: its path is the prefix of every other God Mode page.
      exact: true,
    },
    {
      title: t("godModeSettings:title"),
      path: routes.godModeGeneral.path,
      icon: Settings,
    },
    {
      title: t("navigation:workspaceSwitcher.instanceUsers"),
      path: routes.godModeUsers.path,
      icon: Users,
    },
    {
      title: t("identityConnections:list.title"),
      path: routes.identityConnections.path,
      icon: Shield,
    },
    {
      title: t("notificationProvider:title"),
      path: routes.notificationProvider.path,
      icon: Bell,
    },
    {
      title: t("featureFlags:page.godModeTitle"),
      path: routes.godModeFeatures.path,
      icon: ToggleRight,
    },
    {
      title: t("common:navigation.auditLog", { defaultValue: "Audit log" }),
      path: routes.godModeAudit.path,
      icon: FileClock,
    },
  ];
  return (
    <div className="flex h-full gap-6">
      <SettingsSidebar>
        <SidebarGroup className="gap-1 p-1">
          <SidebarGroupLabel className="h-7 px-2 text-xs uppercase tracking-wide text-sidebar-foreground">
            {t("navigation:sidebar.godMode")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <Button
                    render={<Link to={item.path} />}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-full justify-start gap-2 rounded-lg px-2 text-sm font-normal text-sidebar-foreground",
                      (pathname === item.path ||
                        pathname === `${item.path}/` ||
                        (!("exact" in item) &&
                          pathname.startsWith(`${item.path}/`))) &&
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
      </SettingsSidebar>
      {children}
    </div>
  );
}
