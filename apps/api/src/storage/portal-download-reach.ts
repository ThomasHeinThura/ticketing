import { parseSubmissionReference } from "@taskdesk/domain";
import {
  findLiveLinkedWorkItemId,
  findReachableSubmissionAttachment,
  findSubmissionAttachmentContent,
  findSubmissionAttachmentParent,
} from "../attachment/repository";
import { assertIntakeEnabled } from "../attachment/require-submission-attachment-reach";
import db from "../database";
import { customerPortalStateForSubmission } from "../feature-flag/enforce";
import { resolvePortalRequestDownload } from "../intake/portal-requests";
import { hasPortalSubmissionProjectAccess } from "../intake/repository";
import { resolveIdentity } from "../permissions/resolve-identity";

export type PortalDownloadScope = "request" | "submission";

/** Resolve current access and the stored key, without exposing it in the signed URL. */
export async function resolvePortalDownload(input: {
  scope: PortalDownloadScope;
  ref: string;
  id: string;
  personId: string;
  userId: string;
}) {
  const identity = await resolveIdentity({
    userId: input.userId,
    credential: "session",
  });
  if (identity?.side !== "customer" || identity.personId !== input.personId)
    return null;
  if (input.scope === "request")
    return resolvePortalRequestDownload(input.personId, input.ref, input.id);
  const number = parseSubmissionReference(input.ref);
  if (number === null) return null;
  const [parent] = await findSubmissionAttachmentParent(db, {
    number,
    requesterId: input.personId,
  });
  if (!parent) return null;
  if (
    !(await hasPortalSubmissionProjectAccess(
      parent.id,
      {
        personId: identity.personId,
        organisationId: identity.organisationId,
      },
      db,
    ))
  )
    return null;
  if ((await customerPortalStateForSubmission(number)) !== "on") return null;
  await assertIntakeEnabled(parent.workspaceId);
  const linked =
    parent.state === "accepted"
      ? await findLiveLinkedWorkItemId(
          db,
          parent.workItemId,
          parent.requesterId,
        )
      : null;
  const [attachment] = await findReachableSubmissionAttachment(db, {
    id: input.id,
    identity,
    workspaceId: parent.workspaceId,
    submissionId: parent.id,
    linkedWorkItemId: linked,
    accepted: parent.state === "accepted",
    portalDownload: true,
    download: true,
    completion: false,
  });
  const attachedToSubmission = attachment?.submissionId === parent.id;
  const attachedToAcceptedWorkItem =
    parent.state === "accepted" &&
    linked !== null &&
    (attachment?.workItemId === linked || attachment?.onPublicComment === true);
  if (
    attachment?.state !== "ready" ||
    (!attachedToSubmission && !attachedToAcceptedWorkItem)
  )
    return null;
  const [row] = await findSubmissionAttachmentContent(db, identity, {
    id: input.id,
    workspaceId: parent.workspaceId,
    submissionId: parent.id,
    linkedWorkItemId: linked,
    portal: true,
  });
  return row ?? null;
}
