import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type CreateApprovalInput = {
  key: string;
  transitionId: string;
  kind: "customer" | "cab";
  approverId: string;
};

/**
 * `POST /api/work-items/{key}/approvals` (staff, `approval:request`, plus
 * `approval:request_cab` for CAB). 422 carries the contract the request broke.
 */
async function createApproval({
  key,
  transitionId,
  kind,
  approverId,
}: CreateApprovalInput) {
  const response = await client["work-items"][":key"].approvals.$post({
    param: { key },
    json: { transitionId, kind, approverId },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to request approval"),
    );
  }
  return response.json();
}

export default createApproval;
