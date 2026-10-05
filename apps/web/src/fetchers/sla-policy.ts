import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type SlaPolicyPage = InferResponseType<
  (typeof client)["sla-policies"]["$get"],
  200
>;
export type SlaPolicy = InferResponseType<
  (typeof client)["sla-policies"][":id"]["$get"],
  200
>;
export type SlaPolicyGoal = SlaPolicy["draftVersion"] extends infer T
  ? T extends { goals: Array<infer G> }
    ? G
    : never
  : never;
export type SlaPolicyInput = {
  name: string;
  description?: string | null;
  calendarId: string;
  atRiskThresholdPct: number;
  goals: SlaPolicyGoal[];
};
export type SlaPolicyPatch = Partial<SlaPolicyInput>;

async function throwPolicyError(
  response: Response,
  fallback: string,
): Promise<never> {
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      assertedVersion?: number;
      currentVersion?: number;
    } | null;
    throw new HttpError(409, body?.message ?? fallback);
  }
  throw new HttpError(response.status, (await response.text()) || fallback);
}

export async function getSlaPolicies(
  workspaceId: string,
  cursor?: string,
): Promise<SlaPolicyPage> {
  const response = await client["sla-policies"].$get({
    query: { workspaceId, cursor, limit: "50" },
  });
  if (!response.ok)
    return throwPolicyError(response, "Failed to load SLA policies");
  return response.json();
}

export async function getSlaPolicy(id: string): Promise<SlaPolicy> {
  const response = await client["sla-policies"][":id"].$get({ param: { id } });
  if (!response.ok)
    return throwPolicyError(response, "Failed to load SLA policy");
  return response.json();
}

export async function createSlaPolicy(
  workspaceId: string,
  data: SlaPolicyInput,
): Promise<SlaPolicy> {
  const response = await client["sla-policies"].$post({
    query: { workspaceId },
    json: data,
  });
  if (!response.ok)
    return throwPolicyError(response, "Failed to create SLA policy");
  return response.json();
}

export async function updateSlaPolicy(input: {
  id: string;
  version: number;
  data: SlaPolicyPatch;
}): Promise<SlaPolicy> {
  const response = await client["sla-policies"][":id"].$patch({
    param: { id: input.id },
    header: { "if-match": `"${input.version}"` },
    json: input.data,
  });
  if (!response.ok)
    return throwPolicyError(response, "Failed to save SLA policy");
  return response.json();
}

export async function publishSlaPolicy(input: {
  id: string;
  version: number;
}): Promise<SlaPolicy> {
  const response = await client["sla-policies"][":id"].publish.$post({
    param: { id: input.id },
    header: { "if-match": `"${input.version}"` },
  });
  if (!response.ok)
    return throwPolicyError(response, "Failed to publish SLA policy");
  return response.json();
}
