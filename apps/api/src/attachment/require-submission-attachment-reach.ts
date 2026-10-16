import { parseSubmissionReference } from "@taskdesk/domain";
import { resolveFeatureFlag } from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { portalIdentity } from "../intake/repository";
import { reachableLinkedWorkItemId } from "../intake/submission-linked-work-item";
import type { BaseVariables } from "../openapi";
import { callerReach } from "../utils/caller-reach";
import { markReach } from "../utils/reach-mark";
import {
  findIntakeFeatureFlags,
  findReachableSubmissionAttachment,
  findSubmissionAttachmentParent,
} from "./repository";

type SubmissionAttachmentVariables = BaseVariables & {
  workspaceId: string;
  workspaceIdSource: "row";
  submissionId: string;
  submissionWorkItemId: string | null;
  requesterId: string;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
  portalPredicateSatisfied: boolean;
  attachmentId?: string;
};
type SubmissionAttachmentContext = Context<{
  Variables: SubmissionAttachmentVariables;
}>;

async function assertIntakeEnabled(workspaceId: string) {
  const [[instance], [workspace]] = await findIntakeFeatureFlags(
    db,
    workspaceId,
  );
  if (
    !resolveFeatureFlag({
      feature: "feature.intake",
      instance: instance ?? null,
      workspace: workspace?.enabled ?? null,
    }).enabled
  )
    throw new HTTPException(404, { message: "Submission not found" });
}

export function requireSubmissionAttachmentReach(
  mode:
    | "portal_upload"
    | "portal_complete"
    | "portal_download"
    | "staff_list"
    | "staff_download",
) {
  const middleware = async (c: SubmissionAttachmentContext, next: Next) => {
    const ref = c.req.param("ref");
    const number = ref ? parseSubmissionReference(ref) : null;
    if (number === null)
      throw new HTTPException(404, { message: "Submission not found" });
    const [person] = mode.startsWith("portal_")
      ? [await portalIdentity(c.get("userId"))]
      : [null];
    const [row] = await findSubmissionAttachmentParent(db, {
      number,
      ...(person ? { requesterId: person.personId } : {}),
    });
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    await assertIntakeEnabled(row.workspaceId);
    // #740: the staff list and download expose the converted work item's attachments only to a
    // caller who reaches its project; otherwise the link is treated as absent. The portal
    // requester's own view is unchanged.
    const linkedWorkItemId = mode.startsWith("portal_")
      ? row.submission.workItemId
      : await reachableLinkedWorkItemId(
          await callerReach(c as unknown as Context, c.get("userId")),
          row.submission.workItemId,
        );
    const organisationId =
      person?.organisationId ?? row.submission.organisationId;
    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("submissionId", row.submission.id);
    // A duplicate (or any non-accepted) submission may carry a work item link to ANOTHER
    // requester's item: only an accepted submission owns its work item's attachments
    // (CP-16, same rule as download below).
    c.set(
      "submissionWorkItemId",
      row.submission.state === "accepted" ? linkedWorkItemId : null,
    );
    c.set("requesterId", row.submission.requesterId);
    c.set("policyOrganisationId", organisationId);
    c.set("policyOrganisationIdSource", "row");
    c.set("portalPredicateSatisfied", mode.startsWith("portal_"));
    const id = c.req.param("id");
    if (mode.endsWith("download") || mode === "portal_complete") {
      if (!id)
        throw new HTTPException(400, { message: "Missing attachment id" });
      const [attachment] = await findReachableSubmissionAttachment(db, {
        id,
        workspaceId: row.workspaceId,
        submissionId: row.submission.id,
        linkedWorkItemId,
        accepted: row.submission.state === "accepted",
        portalDownload: mode.startsWith("portal_") && mode.endsWith("download"),
        download: mode.endsWith("download"),
        completion: mode === "portal_complete",
      });
      const attachedToSubmission =
        attachment?.submissionId === row.submission.id;
      const attachedToAcceptedWorkItem =
        row.submission.state === "accepted" &&
        linkedWorkItemId !== null &&
        attachment?.workItemId === linkedWorkItemId;
      if (
        !attachment ||
        (!attachedToSubmission && !attachedToAcceptedWorkItem) ||
        (mode === "portal_complete" &&
          (attachment.state !== "pending" ||
            attachment.uploadedBy !== row.submission.requesterId ||
            !attachment.customerVisible ||
            (!attachedToSubmission && !attachedToAcceptedWorkItem))) ||
        (mode.endsWith("download") && attachment.state !== "ready")
      )
        throw new HTTPException(404, { message: "Attachment not found" });
      c.set("attachmentId", attachment.id);
    }
    await next();
  };
  // The staff modes carry project reach for the converted work item (see above); the portal
  // modes are the requester's own request, decided by the portal predicate.
  return markReach(
    middleware,
    mode.startsWith("portal_")
      ? {
          projectReach: false,
          workspaceReachOnlyReason:
            "portal requester's own submission and its own work item, decided by the portal predicate",
        }
      : { projectReach: true },
  );
}
