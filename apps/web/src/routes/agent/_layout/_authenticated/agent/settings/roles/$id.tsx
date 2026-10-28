import { createFileRoute } from "@tanstack/react-router";
import { RoleDetailView } from "@/components/settings/roles/role-detail";
import { parseRoleDetailSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/roles/$id",
)({
  validateSearch: parseRoleDetailSearch,
  component: RoleDetailRoute,
});

function RoleDetailRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RoleDetailView
      roleId={id}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
