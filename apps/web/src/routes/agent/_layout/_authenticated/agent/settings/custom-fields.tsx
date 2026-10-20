import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WorkspaceCustomFieldsScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/custom-fields",
)({
  component: WorkspaceCustomFieldsRouteComponent,
});

function WorkspaceCustomFieldsRouteComponent() {
  const location = useLocation();
  if (location.pathname.startsWith("/agent/settings/custom-fields/")) {
    return <Outlet />;
  }
  return <WorkspaceCustomFieldsScreen />;
}
