import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/mfa")({
  component: MfaRouteLayout,
});

function MfaRouteLayout() {
  return <Outlet />;
}
