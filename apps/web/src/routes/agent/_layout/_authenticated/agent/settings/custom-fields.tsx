import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { CustomFieldsList } from "@/components/settings/custom-fields/custom-fields-list";
import { parseCustomFieldListSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/custom-fields",
)({
  validateSearch: parseCustomFieldListSearch,
  component: CustomFieldsRoute,
});

function CustomFieldsRoute() {
  const { pathname } = useLocation();
  const { deleted } = Route.useSearch();
  if (pathname.startsWith(`${routes.workspaceCustomFields.path}/`))
    return <Outlet />;
  return <CustomFieldsList showDeleted={deleted === true} />;
}
