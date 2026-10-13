import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export type WithdrawApprovalInput = {
  id: string;
  /**
   * AP-7: an instance-admin session withdraws through the session-only admin route; every
   * other session uses the requester route. The affordance (`canWithdraw`) is a hint only;
   * each route rechecks its own authority.
   */
  asInstanceAdmin: boolean;
};

/**
 * `POST /api/approvals/{id}/withdraw` (`approval:request`, the actual requester) or
 * `POST /api/admin/approvals/{id}/withdraw` (`instance:admin`, session-only, audited).
 * Failures keep their status on the `HttpError`: 409 means the approval is no longer
 * pending, 403/404 mean the caller's authority or reach changed.
 */
async function withdrawApproval({
  id,
  asInstanceAdmin,
}: WithdrawApprovalInput) {
  const response = asInstanceAdmin
    ? await client.admin.approvals[":id"].withdraw.$post({ param: { id } })
    : await client.approvals[":id"].withdraw.$post({ param: { id } });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to withdraw approval");
  }
  return response.json();
}

export default withdrawApproval;
