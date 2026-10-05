import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuSkeleton,
  useSidebar,
} from "@taskdesk/ui";
import type * as React from "react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { NavMain } from "@/components/nav-main";
import { ThemeToggleDropdown } from "@/components/theme-toggle-dropdown";
import { VersionDisplay } from "@/components/version-display";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { shortcuts } from "@/constants/shortcuts";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import Search from "./search";

const NavProjects = lazy(() =>
  import("@/components/nav-projects").then((module) => ({
    default: module.NavProjects,
  })),
);

type AppSidebarProps = Omit<
  React.ComponentProps<typeof Sidebar>,
  "closeLabel" | "mobileDescription" | "mobileTitle"
>;

export function AppSidebar({ ...props }: AppSidebarProps) {
  const { t } = useTranslation();
  const { toggleSidebar } = useSidebar();

  useRegisterShortcuts({
    modifierShortcuts: {
      [shortcuts.sidebar.prefix]: {
        [shortcuts.sidebar.toggle]: toggleSidebar,
      },
    },
  });

  return (
    <Sidebar
      closeLabel={t("common:actions.close")}
      collapsible="offcanvas"
      mobileDescription={t("common:sidebar.mobileDescription")}
      mobileTitle={t("common:sidebar.title")}
      variant="inset"
      className="border-none pt-1.5"
      {...props}
    >
      <SidebarHeader className="pt-1 pb-1.5">
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent className="overflow-hidden gap-1 py-1" nativeScroll>
        <Search />
        <NavMain />
        <Suspense
          fallback={
            <SidebarGroup className="group-data-[collapsible=icon]:hidden gap-1 p-2 pt-1">
              <SidebarMenu>
                <SidebarMenuSkeleton />
                <SidebarMenuSkeleton />
              </SidebarMenu>
            </SidebarGroup>
          }
        >
          <NavProjects />
        </Suspense>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between">
          <VersionDisplay />
          <ThemeToggleDropdown />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
