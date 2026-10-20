import { createFileRoute } from "@tanstack/react-router";
import { PortalAccountScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/account")({
  component: PortalAccountScreen,
});
