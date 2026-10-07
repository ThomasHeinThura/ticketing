import { client } from "@taskdesk/libs";

export async function getSubmissions(workspaceId: string, state?: string) {
  const response = await client.submissions.$get({
    query: {
      workspaceId,
      ...(state
        ? {
            state: state as
              | "new"
              | "clarifying"
              | "accepted"
              | "declined"
              | "duplicate"
              | "withdrawn",
          }
        : {}),
    },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to load submissions");
  return response.json();
}

export async function getRequestTypes(workspaceId: string) {
  const response = await client["request-types"].$get({
    query: { workspaceId },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to load request types");
  return response.json();
}

export async function getRequestType(id: string) {
  const response = await client["request-types"][":id"].$get({ param: { id } });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to load request type");
  return response.json();
}

export async function saveRequestType(input: {
  workspaceId: string;
  id?: string;
  version?: number;
  data: Record<string, unknown>;
}) {
  const response = input.id
    ? await client["request-types"][":id"].$patch({
        param: { id: input.id },
        json: { ...input.data, version: input.version ?? 1 } as never,
      })
    : await client["request-types"].$post({
        query: { workspaceId: input.workspaceId },
        json: input.data as never,
      });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to save request type");
  return response.json();
}

export async function publishRequestType(id: string) {
  const response = await client["request-types"][":id"].publish.$post({
    param: { id },
  });
  if (!response.ok)
    throw new Error(
      (await response.text()) || "Unable to publish request type",
    );
  return response.json();
}

export async function unpublishRequestType(id: string) {
  const response = await client["request-types"][":id"].unpublish.$post({
    param: { id },
  });
  if (!response.ok)
    throw new Error(
      (await response.text()) || "Unable to unpublish request type",
    );
  return response.json();
}

export async function deleteRequestType(id: string) {
  const response = await client["request-types"][":id"].$delete({
    param: { id },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to delete request type");
  return response.json();
}

export async function getSubmission(ref: string) {
  const response = await client.submissions[":ref"].$get({ param: { ref } });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to load submission");
  return response.json();
}

export async function claimSubmission(ref: string) {
  const response = await client.submissions[":ref"].claim.$post({
    param: { ref },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to claim submission");
  return response.json();
}

export async function acceptSubmission(input: {
  ref: string;
  projectId: string;
  workItemTypeId: string;
}) {
  const response = await client.submissions[":ref"].accept.$post({
    param: { ref: input.ref },
    json: { projectId: input.projectId, workItemTypeId: input.workItemTypeId },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to accept submission");
  return response.json();
}

export async function declineSubmission(input: {
  ref: string;
  reason: string;
}) {
  const response = await client.submissions[":ref"].decline.$post({
    param: { ref: input.ref },
    json: { reason: input.reason },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to decline submission");
  return response.json();
}

export async function askSubmissionClarification(input: {
  ref: string;
  body: string;
}) {
  const response = await client.submissions[":ref"].messages.$post({
    param: { ref: input.ref },
    json: { body: input.body },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to send clarification");
  return response.json();
}

export async function getPortalCatalogue(q?: string) {
  const response = await client.portal.catalogue.$get({
    query: q ? { q } : {},
  });
  if (!response.ok)
    throw new Error(
      (await response.text()) || "Unable to load the request catalogue",
    );
  return response.json();
}

export async function submitPortalRequest(input: {
  key: string;
  formData: Record<string, unknown>;
  customerVisibility?: "private" | "organisation";
}) {
  const response = await client.portal.submissions.$post({
    json: {
      key: input.key,
      formData: input.formData,
      customerVisibility: input.customerVisibility,
    },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to submit the request");
  return response.json();
}

export async function getPortalSubmission(ref: string) {
  const response = await client.portal.submissions[":ref"].$get({
    param: { ref },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to load the submission");
  return response.json();
}

export async function replyPortalSubmission(input: {
  ref: string;
  body: string;
}) {
  const response = await client.portal.submissions[":ref"].messages.$post({
    param: { ref: input.ref },
    json: { body: input.body },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to reply");
  return response.json();
}

export async function withdrawPortalSubmission(ref: string) {
  const response = await client.portal.submissions[":ref"].withdraw.$post({
    param: { ref },
  });
  if (!response.ok)
    throw new Error(
      (await response.text()) || "Unable to withdraw the request",
    );
  return response.json();
}

export async function getPortalSubmissionAttachments(ref: string) {
  const response = await client.portal.submissions[":ref"].attachments.$get({
    param: { ref },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to load attachments");
  return response.json();
}

export async function getSubmissionAttachments(ref: string) {
  const response = await client.submissions[":ref"].attachments.$get({
    param: { ref },
  });
  if (!response.ok)
    throw new Error(
      (await response.text()) || "Unable to load submission attachments",
    );
  return response.json();
}

export async function downloadSubmissionAttachment(input: {
  ref: string;
  id: string;
}) {
  const response = await client.submissions[":ref"].attachments[":id"].$get({
    param: input,
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to download attachment");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = input.id;
  link.click();
  URL.revokeObjectURL(url);
}

export async function getDuplicateSuggestions(ref: string) {
  const response = await client.submissions[":ref"].duplicates.$get({
    param: { ref },
  });
  if (!response.ok)
    throw new Error(
      (await response.text()) || "Unable to load duplicate suggestions",
    );
  return response.json();
}

export async function markSubmissionDuplicate(input: {
  ref: string;
  workItemId: string;
}) {
  const response = await client.submissions[":ref"].duplicate.$post({
    param: { ref: input.ref },
    json: { workItemId: input.workItemId },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to link duplicate");
  return response.json();
}

export async function presignPortalSubmissionAttachment(input: {
  ref: string;
  fieldKey: string;
  filename: string;
  contentType: string;
  size: number;
}) {
  const response = await client.portal.submissions[
    ":ref"
  ].attachments.presign.$post({
    param: { ref: input.ref },
    json: {
      fieldKey: input.fieldKey,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
    },
  });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to start upload");
  return response.json();
}

export async function downloadPortalSubmissionAttachment(input: {
  ref: string;
  id: string;
}) {
  const response = await client.portal.submissions[":ref"].attachments[
    ":id"
  ].$get({ param: input });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to download attachment");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = input.id;
  link.click();
  URL.revokeObjectURL(url);
}

export async function completePortalSubmissionAttachment(input: {
  ref: string;
  id: string;
}) {
  const response = await client.portal.submissions[":ref"].attachments[
    ":id"
  ].complete.$post({ param: { ref: input.ref, id: input.id } });
  if (!response.ok)
    throw new Error((await response.text()) || "Unable to complete upload");
  return response.json();
}
