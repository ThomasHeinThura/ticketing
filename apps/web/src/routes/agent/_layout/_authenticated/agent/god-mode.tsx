import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { GodModeHomeScreen } from "@/components/agent/p4-god-mode-screens";

export const Route = createFileRoute("/_layout/_authenticated/agent/god-mode")({
  component: GodModeRouteComponent,
});

function GodModeRouteComponent() {
  const location = useLocation();
  if (
    location.pathname !== "/agent/god-mode" &&
    location.pathname !== "/agent/god-mode/"
  ) {
    return <Outlet />;
  }
  return <GodModeHomeScreen />;
}
