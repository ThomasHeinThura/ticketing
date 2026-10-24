import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { RolesList } from "@/components/settings/roles/roles-list";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/roles",
)({
  component: RolesRoute,
});

function RolesRoute() {
  const { pathname } = useLocation();
  if (pathname.startsWith(`${routes.workspaceRoles.path}/`)) return <Outlet />;
  return <RolesList />;
}
