import { resolveFeatureFlag } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { suggestDuplicatesForQueueRows } from "../../intake/duplicate-suggestions";
import type { SubmissionListFilters } from "../../intake/list-filters";
import { submissionSavedViewQuerySchema } from "../../intake/queues/schema";
import { listSubmissions } from "../../intake/repository";
import { toStaffRequestTypeRef } from "../../intake/response";
import type { ApiKey, z } from "../../openapi";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "../../utils/require-workspace-capability";
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

type SubmissionSavedViewQuery = z.infer<typeof submissionSavedViewQuerySchema>;
type WorkItemSavedViewQuery = ReturnType<typeof validateWorkItemSearchQuery>;
export type ExecutableSavedViewQuery =
  | SubmissionSavedViewQuery
  | WorkItemSavedViewQuery;

function invalidQuery(): never {
  throw new HTTPException(422, {
    message: "Saved view query contains unsupported properties",
  });
}

export function executableQuery(value: unknown): ExecutableSavedViewQuery {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HTTPException(422, {
      message: "Saved view query is not executable",
    });
  const stored = value as Record<string, unknown>;

  if (stored.entity === "submission") {
    const parsed = submissionSavedViewQuerySchema.safeParse(stored);
    if (!parsed.success) invalidQuery();
    return parsed.data;
  }

  const supportedKeys = new Set([
    "entity",
    "filter",
    "sort",
    "groupBy",
    "columns",
    "aggregate",
  ]);
  if (
    Object.keys(stored).some((key) => !supportedKeys.has(key)) ||
    (stored.entity !== undefined && stored.entity !== "work_item")
  ) {
    invalidQuery();
  }
  if (
    Array.isArray(stored.sort) &&
    stored.sort.some(
      (item) =>
        item &&
        typeof item === "object" &&
        Object.keys(item).some((key) => !["field", "direction"].includes(key)),
    )
  ) {
    invalidQuery();
  }
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

export async function requireIntakeEnabled(workspaceId: string) {
  const [[instance], [workspace]] = await Promise.all([
    db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    db
      .select({ enabled: schema.workspaceFeatureFlagTable.enabled })
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      )
      .limit(1),
  ]);
  if (
    !resolveFeatureFlag({
      feature: "feature.intake",
      instance: instance ?? null,
      workspace: workspace?.enabled ?? null,
    }).enabled
  ) {
    throw new HTTPException(404, { message: "Intake is not enabled" });
  }
}

async function runSubmissionSavedView(input: {
  workspaceId: string;
  userId: string;
  apiKey?: ApiKey;
  query: SubmissionSavedViewQuery;
  limit: number;
  cursor?: string;
  includeSuggestions?: boolean;
}) {
  await assertCallerHasCapability(
    input.workspaceId,
    input.userId,
    "intake:triage",
    capabilityCredential(input.apiKey),
  );
  await requireIntakeEnabled(input.workspaceId);

  const filter = input.query.filter ?? {};
  const filters: SubmissionListFilters = {
    ...(filter.requestTypeKey ? { requestTypeKey: filter.requestTypeKey } : {}),
    ...(filter.assignee ? { assignee: filter.assignee } : {}),
    ...(filter.olderThanDays === undefined
      ? {}
      : { olderThanDays: filter.olderThanDays }),
  };
  const result = await listSubmissions(
    input.workspaceId,
    filter.state ? [filter.state] : undefined,
    input.cursor,
    input.limit,
    filters,
  );
  let suggestions: Awaited<ReturnType<typeof suggestDuplicatesForQueueRows>> =
    new Map();
  if (input.includeSuggestions !== false) {
    let readableProjectIds: readonly string[] = [];
    try {
      const itemAccess = await resolveWorkItemSearchAccess({
        userId: input.userId,
        apiKey: input.apiKey,
        workspaceId: input.workspaceId,
        query: { entity: "work_item" },
      });
      readableProjectIds = itemAccess.projectIds;
    } catch (error) {
      if (!(error instanceof HTTPException) || error.status !== 403)
        throw error;
    }
    suggestions = await suggestDuplicatesForQueueRows(
      input.workspaceId,
      result.submissions.map((row) => ({
        ref: row.ref,
        summary: row.summary,
        organisationId: row.organisation.id,
      })),
      readableProjectIds,
    );
  }
  return {
    submissions: result.submissions.map((row) => ({
      ref: row.ref,
      summary: row.summary,
      submission: {
        id: row.submission.id,
        number: row.submission.number,
        state: row.submission.state,
        customerVisibility: row.submission.customerVisibility,
        claimedBy: row.submission.claimedBy,
        claimedAt: row.submission.claimedAt?.toISOString() ?? null,
        createdAt: row.submission.createdAt.toISOString(),
      },
      requestType: toStaffRequestTypeRef(row.requestType),
      requester: {
        id: row.requester.id,
        displayName: row.requester.displayName,
      },
      organisation: {
        id: row.organisation.id,
        name: row.organisation.name,
      },
      suggestedDuplicates: suggestions.get(row.ref) ?? [],
    })),
    page: result.page,
    meta: result.meta,
  };
}

/** One entity-dispatch point shared by ordinary saved views and paired intake queues. */
export async function executeSavedViewQuery(input: {
  workspaceId: string;
  userId: string;
  apiKey?: ApiKey;
  impersonatedBy?: string | null;
  query: unknown;
  limit: number;
  cursor?: string;
  projectScopeId?: string;
  includeSuggestions?: boolean;
}) {
  const query = executableQuery(input.query);
  if (query.entity === "submission") {
    if (input.projectScopeId)
      throw new HTTPException(422, {
        message: "Submission views must use workspace scope",
      });
    return runSubmissionSavedView({
      workspaceId: input.workspaceId,
      userId: input.userId,
      apiKey: input.apiKey,
      query,
      limit: input.limit,
      cursor: input.cursor,
      includeSuggestions: input.includeSuggestions,
    });
  }

  return searchWorkItems({
    userId: input.userId,
    apiKey: input.apiKey,
    impersonatedBy: input.impersonatedBy,
    workspaceId: input.workspaceId,
    query,
    limit: input.limit,
    cursor: input.cursor,
    ...(input.projectScopeId ? { projectScopeId: input.projectScopeId } : {}),
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
  return executeSavedViewQuery({
    userId: input.userId,
    apiKey: input.apiKey,
    impersonatedBy: input.impersonatedBy,
    workspaceId: view.workspaceId,
    query: view.query,
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

  if (query.entity === "submission") {
    if (projectScopeId)
      throw new HTTPException(422, {
        message: "Submission views must use workspace scope",
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
      identity: {
        userId: input.userId,
        impersonatedBy: input.impersonatedBy ?? null,
        capability: "intake:triage",
      },
      reachableProjectIds: [],
      ...(input.apiKey ? { apiKeyId: input.apiKey.id } : {}),
    });
    const cached = await getCachedSavedViewCount(key);
    if (cached !== undefined) return { count: cached };

    const result = await runSubmissionSavedView({
      workspaceId: view.workspaceId,
      userId: input.userId,
      apiKey: input.apiKey,
      query,
      limit: 1,
      includeSuggestions: false,
    });
    await setCachedSavedViewCount(key, result.meta.total);
    return { count: result.meta.total };
  }

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
