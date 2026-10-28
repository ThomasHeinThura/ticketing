import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type WorkflowSummary = InferResponseType<
  (typeof client)["workflows"]["$get"],
  200
>[number];
export type WorkflowDetail = InferResponseType<
  (typeof client)["workflows"][":id"]["$get"],
  200
>;
export type WorkflowVersion = WorkflowDetail["versions"][number];
export type WorkflowTransition = WorkflowVersion["transitions"][number];
export type WorkflowValidation = InferResponseType<
  (typeof client)["workflows"][":id"]["versions"][":number"]["validate"]["$post"],
  200
>;

/** The request-side transition: a stored one without its id, version and timestamps. */
export type WorkflowTransitionInput = Omit<
  WorkflowTransition,
  "id" | "versionId" | "createdAt" | "updatedAt"
>;

/** A stored transition as the request body wants it (guards and effects kept as stored). */
export function toTransitionInput(
  transition: WorkflowTransition,
): WorkflowTransitionInput {
  return {
    fromStateTemplateId: transition.fromStateTemplateId,
    toStateTemplateId: transition.toStateTemplateId,
    roleId: transition.roleId,
    notePolicy: transition.notePolicy,
    noteVisibility: transition.noteVisibility,
    requiresApproval: transition.requiresApproval,
    approvalPolicy: transition.approvalPolicy,
    requiresCab: transition.requiresCab,
    isReopen: transition.isReopen,
    guards: transition.guards,
    effects: transition.effects,
  };
}

async function fail(response: Response, fallback: string): Promise<never> {
  const text = await response.text().catch(() => "");
  let message = text || fallback;
  try {
    const parsed = JSON.parse(text) as { message?: string };
    if (parsed.message) message = parsed.message;
  } catch {
    // The body was not JSON; the raw text stands.
  }
  throw new HttpError(response.status, message);
}

/** `GET /api/workflows` (`workflow:read`). */
export async function getWorkflows(workspaceId: string) {
  const response = await client.workflows.$get({ query: { workspaceId } });
  if (!response.ok) return fail(response, "Failed to load workflows");
  return response.json();
}

/** `GET /api/workflows/{id}`: every version with its transitions. */
export async function getWorkflow(id: string) {
  const response = await client.workflows[":id"].$get({ param: { id } });
  if (!response.ok) return fail(response, "Failed to load the workflow");
  return response.json();
}

/** `POST /api/workflows` (`workflow:manage`); 409 when the key is taken. */
export async function createWorkflow(input: {
  workspaceId: string;
  key: string;
  name: string;
}) {
  const response = await client.workflows.$post({ json: input });
  if (!response.ok) return fail(response, "Failed to create the workflow");
  return response.json();
}

/** `POST /api/workflows/{id}/versions`: a new draft from the full transition set. */
export async function createWorkflowVersion(input: {
  id: string;
  transitions: WorkflowTransitionInput[];
}) {
  const response = await client.workflows[":id"].versions.$post({
    param: { id: input.id },
    json: { transitions: input.transitions },
  });
  if (!response.ok) return fail(response, "Failed to save the draft");
  return response.json();
}

/** `POST /api/workflows/{id}/versions/{n}/validate`: read-only (WF-9 stuck items). */
export async function validateWorkflowVersion(input: {
  id: string;
  number: number;
}) {
  const response = await client.workflows[":id"].versions[
    ":number"
  ].validate.$post({
    param: { id: input.id, number: String(input.number) },
  });
  if (!response.ok) return fail(response, "Failed to validate the version");
  return response.json();
}

/** `POST /api/workflows/{id}/versions/{n}/publish?dryRun=true`: impact plus WF-9 checks. */
export async function previewWorkflowPublication(input: {
  id: string;
  number: number;
}): Promise<WorkflowValidation> {
  const response = await client.workflows[":id"].versions[
    ":number"
  ].publish.$post({
    param: { id: input.id, number: String(input.number) },
    query: { dryRun: "true" },
  });
  if (!response.ok) return fail(response, "Failed to preview publishing");
  const result = await response.json();
  if (!("affected" in result)) {
    throw new Error("Workflow publish dry-run returned a published version");
  }
  return result;
}

/** `POST /api/workflows/{id}/versions/{n}/publish`: in-flight items are not migrated. */
export async function publishWorkflowVersion(input: {
  id: string;
  number: number;
}): Promise<WorkflowVersion> {
  const response = await client.workflows[":id"].versions[
    ":number"
  ].publish.$post({
    param: { id: input.id, number: String(input.number) },
    query: {},
  });
  if (!response.ok) return fail(response, "Failed to publish the version");
  const result = await response.json();
  if (!("number" in result)) {
    throw new Error("Workflow publish returned a dry-run validation report");
  }
  return result;
}
