import { createFileRoute } from "@tanstack/react-router";
import { PendingActionApproval } from "@/components/pending-action/pending-action-approval";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/pending-actions/$id",
)({ component: PendingActionDetailRoute });

/**
 * Full-page approval, kept for API-key, MCP and notification approvals and for old links.
 * Web deletions open the same body in place (`PendingActionApprovalDialog`).
 */
function PendingActionDetailRoute() {
  const { id } = Route.useParams();
  return <PendingActionApproval id={id} layout="page" />;
}
