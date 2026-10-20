import { createFileRoute } from "@tanstack/react-router";
import { PortalApprovalsScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/approvals")({
  component: PortalApprovalsScreen,
});
