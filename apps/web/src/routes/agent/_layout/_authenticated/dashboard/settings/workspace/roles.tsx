import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { RolesList } from "@/components/settings/roles/roles-list";
import { parseRolesListSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/roles",
)({
  validateSearch: parseRolesListSearch,
  component: RolesRoute,
});

function RolesRoute() {
  const { pathname } = useLocation();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (pathname.startsWith(`${routes.workspaceRoles.path}/`)) return <Outlet />;
  return (
    <RolesList
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
