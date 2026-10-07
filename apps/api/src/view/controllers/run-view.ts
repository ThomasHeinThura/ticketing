import { HTTPException } from "hono/http-exception";
import type { ApiKey } from "../../openapi";
import { validateWorkItemSearchQuery } from "../../work-item/search/query";
import {
  resolveWorkItemSearchAccess,
  searchWorkItems,
} from "../../work-item/search/repository";
import {
  getCachedSavedViewCount,
  savedViewCountCacheKey,
  setCachedSavedViewCount,
} from "../count-cache";
import getView from "./get-view";

export function executableQuery(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HTTPException(422, {
      message: "Saved view query is not executable",
    });
  const stored = value as Record<string, unknown>;
  const sort = Array.isArray(stored.sort)
    ? stored.sort.map((item) => {
        if (!item || typeof item !== "object") return item;
        const entry = item as Record<string, unknown>;
        return { field: entry.field, order: entry.direction };
      })
    : undefined;
  return validateWorkItemSearchQuery({
    entity: stored.entity ?? "work_item",
    ...(stored.filter === undefined ? {} : { filter: stored.filter }),
    ...(sort ? { sort } : {}),
    ...(stored.columns ? { columns: stored.columns } : {}),
    ...(stored.groupBy === undefined ? {} : { groupBy: stored.groupBy }),
    ...(stored.aggregate === undefined ? {} : { aggregate: stored.aggregate }),
  });
}

export async function runSavedView(input: {
  id: string;
  personId: string;
  userId: string;
  apiKey?: ApiKey;
  impersonatedBy?: string | null;
  limit: number;
  cursor?: string;
}) {
  const view = await getView(input.id, input.personId, input.userId);
  return searchWorkItems({
    userId: input.userId,
    apiKey: input.apiKey,
    impersonatedBy: input.impersonatedBy,
    workspaceId: view.workspaceId,
    query: executableQuery(view.query),
    limit: input.limit,
    cursor: input.cursor,
    ...(view.scope === "project" ? { projectScopeId: view.scopeId } : {}),
  });
}

export async function countSavedView(input: {
  id: string;
  personId: string;
  userId: string;
  apiKey?: ApiKey;
  impersonatedBy?: string | null;
}) {
  const view = await getView(input.id, input.personId, input.userId);
  const query = executableQuery(view.query);
  const projectScopeId = view.scope === "project" ? view.scopeId : undefined;
  const access = await resolveWorkItemSearchAccess({
    userId: input.userId,
    apiKey: input.apiKey,
    impersonatedBy: input.impersonatedBy,
    workspaceId: view.workspaceId,
    query,
  });
  const definitionVersion =
    view.updatedAt instanceof Date
      ? view.updatedAt.toISOString()
      : String(view.updatedAt);
  const key = savedViewCountCacheKey({
    viewId: view.id,
    workspaceId: view.workspaceId,
    scope: view.scope,
    scopeId: view.scopeId,
    definitionVersion,
    query,
    viewerId: input.userId,
    identity: access.identity,
    reachableProjectIds: access.projectIds,
    ...(input.apiKey ? { apiKeyId: input.apiKey.id } : {}),
  });
  const cached = await getCachedSavedViewCount(key);
  if (cached !== undefined) return { count: cached };

  const result = await searchWorkItems({
    userId: input.userId,
    apiKey: input.apiKey,
    impersonatedBy: input.impersonatedBy,
    workspaceId: view.workspaceId,
    query,
    limit: 1,
    countOnly: true,
    ...(projectScopeId ? { projectScopeId } : {}),
  });
  await setCachedSavedViewCount(key, result.meta.total);
  return { count: result.meta.total };
}
