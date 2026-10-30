import { createFileRoute } from "@tanstack/react-router";
import { PendingActionApproval } from "@/components/pending-action/pending-action-approval";
import { PendingActionTerminologyBoundary } from "@/components/pending-action/pending-action-terminology-boundary";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/pending-actions/$id",
)({ component: PendingActionDetailRoute });

/**
 * Full-page approval, kept for API-key, MCP and notification approvals and for old links.
 * Web deletions open the same body in place (`PendingActionApprovalDialog`).
 */
function PendingActionDetailRoute() {
  const { id } = Route.useParams();
  return (
    <PendingActionTerminologyBoundary id={id}>
      <PendingActionApproval id={id} layout="page" />
    </PendingActionTerminologyBoundary>
  );
}
