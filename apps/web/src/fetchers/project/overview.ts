import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

/**
 * The project Overview and its tabs (S3/S3b): overview counts, summary, contract, and the
 * existing engagement routes (milestones, prerequisites, stakeholders, document links) that had
 * no screen until now. Every write is decided by the server; a refusal surfaces as an HttpError.
 */

type ProjectRoute = (typeof client)["project"][":id"];

export type ProjectOverview = InferResponseType<
  ProjectRoute["overview"]["$get"],
  200
>;
export type ProjectSummary = InferResponseType<
  ProjectRoute["summary"]["$patch"],
  200
>;
export type ProjectContract = InferResponseType<
  ProjectRoute["contract"]["$get"],
  200
>;
export type Milestone = InferResponseType<
  ProjectRoute["milestones"]["$get"],
  200
>[number];
export type Prerequisite = InferResponseType<
  ProjectRoute["prerequisites"]["$get"],
  200
>[number];
export type Stakeholder = InferResponseType<
  ProjectRoute["stakeholders"]["$get"],
  200
>[number];
export type DocumentLink = InferResponseType<
  ProjectRoute["document-links"]["$get"],
  200
>[number];
export type ProjectRoster = InferResponseType<
  (typeof client)["projects"][":projectId"]["members"]["$get"],
  200
>;
export type PendingDeletion = { pendingActionId: string };

export type ProjectStatus = "planning" | "active" | "on_hold" | "closed";
export type ContractCoverage = "9x5" | "12x5" | "24x7";
export type KickoffStatus = "pending" | "scheduled" | "completed";

export type SummaryInput = {
  objective?: string | null;
  inScope?: string | null;
  outOfScope?: string | null;
  successCriteria?: string | null;
  statusNote?: string | null;
  status?: ProjectStatus;
};

export type ContractInput = {
  startDate: string;
  endDate: string;
  contractedMinutes: number;
  coverage: ContractCoverage;
  kickoffStatus: KickoffStatus;
  kickoffDate: string | null;
};

export const projectOverviewKeys = {
  all: ["project-overview"] as const,
  overview: (projectId: string) =>
    ["project-overview", projectId, "overview"] as const,
  contract: (projectId: string) =>
    ["project-overview", projectId, "contract"] as const,
  milestones: (projectId: string) =>
    ["project-overview", projectId, "milestones"] as const,
  prerequisites: (projectId: string) =>
    ["project-overview", projectId, "prerequisites"] as const,
  stakeholders: (projectId: string) =>
    ["project-overview", projectId, "stakeholders"] as const,
  documentLinks: (projectId: string) =>
    ["project-overview", projectId, "document-links"] as const,
  roster: (projectId: string) =>
    ["project-overview", projectId, "roster"] as const,
};

async function failWith(response: Response, fallback: string): Promise<never> {
  const detail = await response.text().catch(() => "");
  throw new HttpError(response.status, detail || fallback);
}

export async function getProjectOverview(id: string) {
  const response = await client.project[":id"].overview.$get({
    param: { id },
  });
  if (!response.ok) return failWith(response, "Failed to load the overview");
  return response.json();
}

export async function updateProjectSummary(id: string, json: SummaryInput) {
  const response = await client.project[":id"].summary.$patch({
    param: { id },
    json,
  });
  if (!response.ok) return failWith(response, "Failed to save the summary");
  return response.json();
}

export async function getProjectContract(id: string) {
  const response = await client.project[":id"].contract.$get({
    param: { id },
  });
  if (!response.ok) return failWith(response, "Failed to load the contract");
  return response.json();
}

export async function putProjectContract(id: string, json: ContractInput) {
  const response = await client.project[":id"].contract.$put({
    param: { id },
    json,
  });
  if (!response.ok) return failWith(response, "Failed to save the contract");
  return response.json();
}

export async function listMilestones(id: string) {
  const response = await client.project[":id"].milestones.$get({
    param: { id },
  });
  if (!response.ok) return failWith(response, "Failed to load milestones");
  return response.json();
}

export async function createMilestone(
  id: string,
  json: { name: string; date: string },
) {
  const response = await client.project[":id"].milestones.$post({
    param: { id },
    json,
  });
  if (!response.ok) return failWith(response, "Failed to add the milestone");
  return response.json();
}

export async function updateMilestone(
  id: string,
  milestoneId: string,
  json: { name?: string; date?: string; reached?: boolean },
) {
  const response = await client.project[":id"].milestones[
    ":milestoneId"
  ].$patch({ param: { id, milestoneId }, json });
  if (!response.ok) return failWith(response, "Failed to save the milestone");
  return response.json();
}

export async function deleteMilestone(
  id: string,
  milestoneId: string,
): Promise<PendingDeletion> {
  const response = await client.project[":id"].milestones[
    ":milestoneId"
  ].$delete({ param: { id, milestoneId } });
  if (response.status !== 202)
    return failWith(response, "Failed to request the deletion");
  return (await response.json()) as PendingDeletion;
}

export async function listPrerequisites(id: string) {
  const response = await client.project[":id"].prerequisites.$get({
    param: { id },
  });
  if (!response.ok) return failWith(response, "Failed to load prerequisites");
  return response.json();
}

export async function createPrerequisite(
  id: string,
  json: {
    title: string;
    ownerSide: "us" | "customer" | "both";
    dueDate?: string | null;
    isBlocking?: boolean;
  },
) {
  const response = await client.project[":id"].prerequisites.$post({
    param: { id },
    json,
  });
  if (!response.ok) return failWith(response, "Failed to add the prerequisite");
  return response.json();
}

export async function updatePrerequisite(
  id: string,
  prerequisiteId: string,
  json: {
    title?: string;
    ownerSide?: "us" | "customer" | "both";
    dueDate?: string | null;
    isBlocking?: boolean;
    completed?: boolean;
  },
) {
  const response = await client.project[":id"].prerequisites[
    ":prerequisiteId"
  ].$patch({ param: { id, prerequisiteId }, json });
  if (!response.ok)
    return failWith(response, "Failed to save the prerequisite");
  return response.json();
}

export async function deletePrerequisite(
  id: string,
  prerequisiteId: string,
): Promise<PendingDeletion> {
  const response = await client.project[":id"].prerequisites[
    ":prerequisiteId"
  ].$delete({ param: { id, prerequisiteId } });
  if (response.status !== 202)
    return failWith(response, "Failed to request the deletion");
  return (await response.json()) as PendingDeletion;
}

export async function listStakeholders(id: string) {
  const response = await client.project[":id"].stakeholders.$get({
    param: { id },
  });
  if (!response.ok) return failWith(response, "Failed to load stakeholders");
  return response.json();
}

export async function addStakeholder(
  id: string,
  json: {
    personId: string;
    role: string;
    escalationOrder: number;
    escalationWaitMinutes?: number;
  },
) {
  const response = await client.project[":id"].stakeholders.$post({
    param: { id },
    json,
  });
  if (!response.ok) return failWith(response, "Failed to add the stakeholder");
  return response.json();
}

export async function standDownStakeholder(id: string, stakeholderId: string) {
  const response = await client.project[":id"].stakeholders[":stakeholderId"][
    "stand-down"
  ].$post({ param: { id, stakeholderId } });
  if (!response.ok)
    return failWith(response, "Failed to stand down the stakeholder");
  return response.json();
}

export async function listDocumentLinks(id: string) {
  const response = await client.project[":id"]["document-links"].$get({
    param: { id },
  });
  if (!response.ok) return failWith(response, "Failed to load documents");
  return response.json();
}

export async function addDocumentLink(
  id: string,
  json: { url: string; title: string; customerVisible?: boolean },
) {
  const response = await client.project[":id"]["document-links"].$post({
    param: { id },
    json,
  });
  if (!response.ok) return failWith(response, "Failed to add the document");
  return response.json();
}

export async function deleteDocumentLink(
  id: string,
  documentLinkId: string,
): Promise<PendingDeletion> {
  const response = await client.project[":id"]["document-links"][
    ":documentLinkId"
  ].$delete({ param: { id, documentLinkId } });
  if (response.status !== 202)
    return failWith(response, "Failed to request the deletion");
  return (await response.json()) as PendingDeletion;
}

export async function getProjectRoster(projectId: string) {
  const response = await client.projects[":projectId"].members.$get({
    param: { projectId },
  });
  if (!response.ok) return failWith(response, "Failed to load the team");
  return response.json();
}
