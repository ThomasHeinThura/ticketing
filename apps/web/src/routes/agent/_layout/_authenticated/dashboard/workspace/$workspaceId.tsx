import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId",
)({
  component: RouteComponent,
  codeSplitGroupings: [],
});

function RouteComponent() {
  return <Outlet />;
}
