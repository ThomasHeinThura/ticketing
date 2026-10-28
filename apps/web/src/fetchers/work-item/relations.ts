import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import type { RelationPickerType } from "@/lib/work-item-relations-search";

export type CanonicalRelationType =
  | "relates"
  | "blocks"
  | "duplicates"
  | "precedes"
  | "requires";
export type WorkItemRelation = {
  id: string;
  type: CanonicalRelationType;
  label: RelationPickerType;
  item: {
    id: string;
    key: string;
    title: string;
    stateName: string;
    stateCategory: string;
    assigneeName: string | null;
  };
  blockingCycle: boolean;
  canRemove: boolean;
};
export type WorkItemRelationsResult = {
  data: WorkItemRelation[];
  hiddenCount: number;
};
const relationPath = (key: string) =>
  `/work-items/${encodeURIComponent(key)}/relations`;
export function relationRequest(
  sourceKey: string,
  targetKey: string,
  type: RelationPickerType,
) {
  const inverse = {
    blocked_by: "blocks",
    duplicated_by: "duplicates",
    follows: "precedes",
    required_by: "requires",
  } as const;
  if (type in inverse)
    return {
      sourceKey: targetKey,
      targetKey: sourceKey,
      type: inverse[type as keyof typeof inverse],
    };
  return { sourceKey, targetKey, type: type as CanonicalRelationType };
}
export async function getWorkItemRelations(
  key: string,
): Promise<WorkItemRelationsResult> {
  const response = await apiFetch(getApiUrl(relationPath(key)));
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to load relations"),
    );
  return response.json();
}
export async function createWorkItemRelation(input: {
  sourceKey: string;
  targetKey: string;
  type: RelationPickerType;
}) {
  const request = relationRequest(input.sourceKey, input.targetKey, input.type);
  const response = await apiFetch(getApiUrl(relationPath(request.sourceKey)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetKey: request.targetKey, type: request.type }),
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to link work item"),
    );
  return response.json();
}
export async function requestWorkItemRelationRemoval(input: {
  key: string;
  id: string;
}): Promise<{ pendingActionId: string }> {
  const response = await apiFetch(
    getApiUrl(`${relationPath(input.key)}/${encodeURIComponent(input.id)}`),
    { method: "DELETE" },
  );
  return readPendingDeletion(response, "Failed to request relation removal");
}
export type RelationCandidate = WorkItemRelation["item"] & {
  projectId: string;
};
export async function getRelationCandidates(input: {
  key: string;
  q: string;
  cursor?: string;
}): Promise<{
  data: RelationCandidate[];
  page: { hasMore: boolean; nextCursor: string | null };
}> {
  const query = new URLSearchParams({ q: input.q, limit: "25" });
  if (input.cursor) query.set("cursor", input.cursor);
  const response = await apiFetch(
    getApiUrl(
      `/work-items/${encodeURIComponent(input.key)}/relation-candidates?${query}`,
    ),
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to search relation candidates"),
    );
  return response.json();
}
