import { createFileRoute } from "@tanstack/react-router";
import { AgentInviteAcceptScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/_layout/_authenticated/agent/invite")({
  component: AgentInviteAcceptScreen,
});
