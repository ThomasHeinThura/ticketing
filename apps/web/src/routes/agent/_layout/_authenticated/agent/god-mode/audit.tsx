import { createFileRoute } from "@tanstack/react-router";
import { GodModeAuditLogScreen } from "@/components/agent/p2-service-desk-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/audit",
)({
  component: GodModeAuditLogScreen,
});
