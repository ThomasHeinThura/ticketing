import { useLocation } from "@tanstack/react-router";
import { SidebarTrigger } from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";

type AuthenticatedRouteContentProps = {
  children: ReactNode;
};

/** Add the existing shared navigation shell to agent project work and saved-view routes. */
export function AuthenticatedRouteContent({
  children,
}: AuthenticatedRouteContentProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const hasWorkspaceNavigation =
    pathname.startsWith("/agent/projects/") ||
    pathname === "/agent/views" ||
    pathname.startsWith("/agent/views/");

  return hasWorkspaceNavigation ? (
    <Layout>
      <Layout.Header>
        <SidebarTrigger toggleLabel={t("common:a11y.toggleSidebar")} />
      </Layout.Header>
      {children}
    </Layout>
  ) : (
    children
  );
}
