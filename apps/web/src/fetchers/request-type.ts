import type { IntakeQueueDto, IntakeSubmissionDto } from "@taskdesk/libs";
import { intakeApiCall, requestTypeClient } from "@taskdesk/libs";

export type RequestTypeList = Awaited<
  ReturnType<typeof requestTypeClient.list>
>;
export type RequestType = RequestTypeList["items"][number];
export type RequestTypeInput = Parameters<typeof requestTypeClient.create>[0];
export type RequestTypePatch = Parameters<typeof requestTypeClient.update>[1];
export type IntakeQueuePage = IntakeQueueDto;
export type IntakeSubmission = IntakeSubmissionDto;
export type IntakeReceipt = Pick<
  IntakeSubmissionDto,
  "ref" | "state" | "workItemKey" | "createdAt"
>;

export function getRequestTypeErrorMessage(
  cause: unknown,
  fallback: string,
): string {
  if (!(cause instanceof Error) || !cause.message) return fallback;
  try {
    const parsed: unknown = JSON.parse(cause.message);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string" &&
      parsed.message.trim()
    ) {
      return parsed.message;
    }
  } catch {
    // The typed clients also receive plain-text error bodies; retain those.
  }
  return cause.message;
}

export async function getIntakeQueue(input: {
  workspaceId: string;
  state?: string;
  before?: string;
}) {
  const query = new URLSearchParams({ workspaceId: input.workspaceId });
  if (input.state) query.set("state", input.state);
  if (input.before) query.set("before", input.before);
  return intakeApiCall<IntakeQueuePage>(`/submissions?${query.toString()}`);
}

export async function getIntakeSubmission(ref: string) {
  return intakeApiCall<IntakeSubmission>(
    `/submissions/${encodeURIComponent(ref)}`,
  );
}

export async function claimIntakeSubmission(ref: string) {
  return intakeApiCall(`/submissions/${encodeURIComponent(ref)}/claim`, {
    method: "POST",
  });
}

export async function sendIntakeMessage(ref: string, body: string) {
  return intakeApiCall(`/submissions/${encodeURIComponent(ref)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function declineIntakeSubmission(ref: string, reason: string) {
  return intakeApiCall(`/submissions/${encodeURIComponent(ref)}/decline`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function acceptIntakeSubmission(
  ref: string,
  input: { projectId: string; typeId: string },
) {
  return intakeApiCall<IntakeReceipt>(
    `/submissions/${encodeURIComponent(ref)}/accept`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function markIntakeSubmissionDuplicate(
  ref: string,
  workItemKey: string,
) {
  return intakeApiCall<IntakeReceipt>(
    `/submissions/${encodeURIComponent(ref)}/duplicate`,
    {
      method: "POST",
      body: JSON.stringify({ workItemKey }),
    },
  );
}

export async function getRequestTypes(
  workspaceId: string,
): Promise<RequestTypeList> {
  return requestTypeClient.list({ workspaceId });
}

export async function createRequestType(input: RequestTypeInput) {
  return requestTypeClient.create(input);
}

export async function updateRequestType(id: string, input: RequestTypePatch) {
  return requestTypeClient.update(id, input);
}

export async function publishRequestType(id: string) {
  return requestTypeClient.publish(id);
}

export async function unpublishRequestType(id: string) {
  return requestTypeClient.unpublish(id);
}

export async function deleteRequestType(id: string) {
  return requestTypeClient.delete(id);
}
