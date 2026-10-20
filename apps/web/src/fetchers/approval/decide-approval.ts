import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type DecideApprovalInput = {
  id: string;
  action: "approve" | "reject";
  /** Required by the server when rejecting (422 otherwise). */
  note?: string | null;
};

/**
 * `POST /api/approvals/{id}/decide` (`approval:decide`, plus `approval:decide_cab` and CAB
 * membership for CAB approvals). 409 means it is no longer pending.
 */
async function decideApproval({ id, action, note }: DecideApprovalInput) {
  const response = await client.approvals[":id"].decide.$post({
    param: { id },
    json: { action, note: note ?? null },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to record the decision"),
    );
  }
  return response.json();
}

export default decideApproval;
