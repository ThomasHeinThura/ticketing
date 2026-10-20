import { createFileRoute } from "@tanstack/react-router";
import { PortalNotFoundScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/$")({
  component: PortalNotFoundScreen,
});
