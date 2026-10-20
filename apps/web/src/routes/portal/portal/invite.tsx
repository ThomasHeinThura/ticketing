import { createFileRoute } from "@tanstack/react-router";
import { PortalInviteAcceptScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/invite")({
  component: PortalInviteAcceptScreen,
});
