import { useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import Layout from "@/components/common/layout";

type AuthenticatedRouteContentProps = {
  children: ReactNode;
};

/** Add the existing shared navigation shell to agent project work and saved-view routes. */
export function AuthenticatedRouteContent({
  children,
}: AuthenticatedRouteContentProps) {
  const { pathname } = useLocation();
  const hasWorkspaceNavigation =
    pathname.startsWith("/agent/projects/") ||
    pathname === "/agent/views" ||
    pathname.startsWith("/agent/views/");

  return hasWorkspaceNavigation ? <Layout>{children}</Layout> : children;
}
