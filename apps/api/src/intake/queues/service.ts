import { createId } from "@paralleldrive/cuid2";
import { HTTPException } from "hono/http-exception";
import type { schema } from "../../database";
import { publishEvent } from "../../events";
import type { ApiKey, z } from "../../openapi";
import { withWorkspaceDeletionAccessLifecycle } from "../../pending-action/workspace-access-invalidation";
import { assertCanShareView } from "../../view/assert-can-share-view";
import {
  type SavedViewAuditActor,
  savedViewAuditState,
  writeSavedViewAudit,
} from "../../view/audit";
import {
  executableQuery,
  executeSavedViewQuery as executeViewQuery,
  requireIntakeEnabled,
} from "../../view/controllers/run-view";
import {
  enqueueSavedViewUpdatedEvent,
  insertSavedViewPairInTransaction,
  type SavedViewTransaction,
  teamMemberInWorkspace,
  updateSavedView,
} from "../../view/repository";
import { parseFilterText } from "../../work-item/search/query";
import {
  findQueuePairRows,
  listReachableQueuePairs,
  lockQueuePairRows,
  queuePairFromRows,
} from "./repository";
import {
  type queuePairBody,
  type queuePairPatchBody,
  queueSubmissionOverridesSchema,
} from "./schema";

type QueuePairBody = z.infer<typeof queuePairBody>;
type QueuePairPatchBody = z.infer<typeof queuePairPatchBody>;
type QueueActor = {
  personId: string;
  userId: string;
  apiKey?: ApiKey;
  auditActor: SavedViewAuditActor;
};

function notFound(): never {
  throw new HTTPException(404, { message: "Intake queue not found" });
}

function conflict(message: string): never {
  throw new HTTPException(409, { message });
}

async function assertQueueVisibleToViewer(
  pair: NonNullable<ReturnType<typeof queuePairFromRows>>,
  personId: string,
  userId: string,
  tx?: SavedViewTransaction,
) {
  if (pair.visibility === "private") {
    if (pair.createdBy !== personId) notFound();
    return;
  }
  if (
    !pair.sharedWithTeamId ||
    !(await teamMemberInWorkspace(
      pair.sharedWithTeamId,
      userId,
      pair.workspaceId,
      tx,
    ))
  ) {
    notFound();
  }
}

function toPairResponse(
  pair: NonNullable<ReturnType<typeof queuePairFromRows>>,
) {
  return {
    id: pair.id,
    workspaceId: pair.workspaceId,
    createdBy: pair.createdBy,
    name: pair.name,
    visibility: pair.visibility,
    sharedWithTeamId: pair.sharedWithTeamId,
    versions: {
      submission: pair.submissionView.queueVersion,
      workItem: pair.workItemView.queueVersion,
    },
    submissionView: {
      id: pair.submissionView.id,
      query: pair.submissionView.query,
      updatedAt: pair.submissionView.updatedAt.toISOString(),
    },
    workItemView: {
      id: pair.workItemView.id,
      query: pair.workItemView.query,
      updatedAt: pair.workItemView.updatedAt.toISOString(),
    },
  };
}

function assertQueueVisibility(
  visibility: "private" | "team",
  sharedWithTeamId: string | null | undefined,
) {
  if (visibility === "team" && !sharedWithTeamId) {
    throw new HTTPException(400, {
      message: "sharedWithTeamId is required for a team queue",
    });
  }
  if (visibility === "private" && sharedWithTeamId) {
    throw new HTTPException(400, {
      message: "sharedWithTeamId is only valid for a team queue",
    });
  }
}

async function assertTeamAudience(
  workspaceId: string,
  teamId: string | null | undefined,
  actor: QueueActor,
  tx?: SavedViewTransaction,
  requireShareCapability = true,
) {
  if (!teamId) return;
  if (requireShareCapability)
    await assertCanShareView(workspaceId, actor.userId, actor.apiKey);
  const member = await (tx
    ? teamMemberInWorkspace(teamId, actor.userId, workspaceId, tx)
    : teamMemberInWorkspace(teamId, actor.userId, workspaceId));
  if (!member) {
    throw new HTTPException(403, {
      message: "Not a member of the team this queue would be shared with",
    });
  }
}

function validateQueueQueries(input: {
  submissionQuery: unknown;
  workItemQuery: unknown;
}) {
  const submission = executableQuery(input.submissionQuery);
  const workItem = executableQuery(input.workItemQuery);
  if (submission.entity !== "submission" || workItem.entity !== "work_item") {
    throw new HTTPException(422, {
      message: "An intake queue requires one submission and one work-item view",
    });
  }
  return { submission, workItem };
}

export async function listIntakeQueues(input: {
  workspaceId: string;
  personId: string;
  userId: string;
}) {
  await requireIntakeEnabled(input.workspaceId);
  const pairs = await listReachableQueuePairs(input);
  return pairs.map((pair) => ({
    id: pair.id,
    workspaceId: pair.workspaceId,
    name: pair.name,
    visibility: pair.visibility,
    sharedWithTeamId: pair.sharedWithTeamId,
    versions: {
      submission: pair.submissionView.queueVersion,
      workItem: pair.workItemView.queueVersion,
    },
  }));
}

export async function getIntakeQueue(input: {
  workspaceId: string;
  id: string;
  personId: string;
  userId: string;
}) {
  await requireIntakeEnabled(input.workspaceId);
  const rows = await findQueuePairRows(input.workspaceId, input.id);
  const pair = queuePairFromRows(rows);
  if (!pair) notFound();
  await assertQueueVisibleToViewer(pair, input.personId, input.userId);
  return toPairResponse(pair);
}

export async function createIntakeQueue(
  input: QueuePairBody,
  actor: QueueActor,
) {
  await requireIntakeEnabled(input.workspaceId);
  const { submission, workItem } = validateQueueQueries(input);
  if (
    input.submissionQuery.entity !== "submission" ||
    input.workItemQuery.entity !== "work_item"
  ) {
    throw new HTTPException(422, {
      message: "An intake queue requires one submission and one work-item view",
    });
  }
  assertQueueVisibility(input.visibility, input.sharedWithTeamId);
  await assertTeamAudience(input.workspaceId, input.sharedWithTeamId, actor);

  const pairId = createId();
  const visibility = input.visibility;
  const sharedWithTeamId =
    visibility === "team" ? input.sharedWithTeamId : null;
  const rows = await withWorkspaceDeletionAccessLifecycle(
    input.workspaceId,
    async (tx) => {
      if (sharedWithTeamId) {
        await assertTeamAudience(
          input.workspaceId,
          sharedWithTeamId,
          actor,
          tx,
        );
      }
      return insertSavedViewPairInTransaction(
        tx,
        [
          {
            workspaceId: input.workspaceId,
            createdBy: actor.personId,
            name: input.name,
            scope: "workspace",
            scopeId: input.workspaceId,
            visibility,
            sharedWithTeamId,
            layout: "list",
            query: input.submissionQuery,
            queuePairId: pairId,
            queueVersion: 1,
          },
          {
            workspaceId: input.workspaceId,
            createdBy: actor.personId,
            name: input.name,
            scope: "workspace",
            scopeId: input.workspaceId,
            visibility,
            sharedWithTeamId,
            layout: "list",
            query: input.workItemQuery,
            queuePairId: pairId,
            queueVersion: 1,
          },
        ],
        {
          personId: actor.personId,
          userId: actor.userId,
          apiKeyId: actor.apiKey?.id,
        },
      );
    },
  );

  for (const view of rows) {
    await writeSavedViewAudit({
      actor: actor.auditActor,
      action: "saved_view.created",
      workspaceId: view.workspaceId,
      entityId: view.id,
      before: null,
      after: savedViewAuditState(view),
    });
    await publishEvent("saved_view.created", {
      savedViewId: view.id,
      workspaceId: view.workspaceId,
      visibility,
      userId: actor.userId,
    });
  }
  const pair = queuePairFromRows(rows);
  if (!pair) throw new Error("Created intake queue pair is incomplete");
  // The preflight and persisted query schemas must agree; this assertion also makes
  // accidental entity swaps fail inside the transaction's success boundary.
  if (submission.entity !== "submission" || workItem.entity !== "work_item")
    throw new Error("Created intake queue entity mismatch");
  return toPairResponse(pair);
}

export async function updateIntakeQueue(input: {
  id: string;
  workspaceId: string;
  patch: QueuePairPatchBody;
  actor: QueueActor;
}) {
  await requireIntakeEnabled(input.workspaceId);
  const { patch, actor } = input;
  const loadedRows = await findQueuePairRows(input.workspaceId, input.id);
  const loadedPair = queuePairFromRows(loadedRows);
  if (!loadedPair) notFound();

  const nextVisibility = patch.visibility ?? loadedPair.visibility;
  const nextTeamId =
    patch.sharedWithTeamId !== undefined
      ? patch.sharedWithTeamId
      : patch.visibility !== undefined &&
          patch.visibility !== loadedPair.visibility
        ? null
        : loadedPair.sharedWithTeamId;
  if (nextVisibility !== "private" && nextVisibility !== "team") {
    throw new HTTPException(400, {
      message: "Invalid intake queue visibility",
    });
  }
  assertQueueVisibility(nextVisibility, nextTeamId);
  if (patch.submissionQuery || patch.workItemQuery) {
    const queries = validateQueueQueries({
      submissionQuery: patch.submissionQuery ?? loadedPair.submissionView.query,
      workItemQuery: patch.workItemQuery ?? loadedPair.workItemView.query,
    });
    if (
      queries.submission.entity !== "submission" ||
      queries.workItem.entity !== "work_item"
    )
      throw new HTTPException(422, {
        message: "Intake queue entities cannot be changed",
      });
  }

  const updatedRows = await withWorkspaceDeletionAccessLifecycle(
    input.workspaceId,
    async (tx) => {
      const rows = await lockQueuePairRows(tx, input.workspaceId, input.id);
      const pair = queuePairFromRows(rows);
      if (!pair) notFound();
      await assertQueueVisibleToViewer(pair, actor.personId, actor.userId, tx);
      const currentVersions = {
        submission: pair.submissionView.queueVersion,
        workItem: pair.workItemView.queueVersion,
      };
      if (
        currentVersions.submission !== patch.expectedVersions.submission ||
        currentVersions.workItem !== patch.expectedVersions.workItem
      ) {
        conflict("The intake queue changed; reload it before saving");
      }
      if (nextVisibility === "team" && nextTeamId) {
        const audienceChanged =
          pair.visibility !== "team" || pair.sharedWithTeamId !== nextTeamId;
        await assertTeamAudience(
          input.workspaceId,
          nextTeamId,
          actor,
          tx,
          audienceChanged,
        );
      }

      const sharedValues: Partial<typeof schema.savedViewTable.$inferInsert> = {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        visibility: nextVisibility,
        sharedWithTeamId: nextVisibility === "team" ? nextTeamId : null,
      };
      const submissionValues: Partial<
        typeof schema.savedViewTable.$inferInsert
      > = {
        ...sharedValues,
        ...(patch.submissionQuery === undefined
          ? {}
          : { query: patch.submissionQuery }),
      };
      const workValues: Partial<typeof schema.savedViewTable.$inferInsert> = {
        ...sharedValues,
        ...(patch.workItemQuery === undefined
          ? {}
          : { query: patch.workItemQuery }),
      };
      const submissionView = await updateSavedView(
        tx,
        pair.submissionView.id,
        submissionValues,
      );
      if (!submissionView)
        conflict("The intake queue changed; reload it before saving");
      const workItemView = await updateSavedView(
        tx,
        pair.workItemView.id,
        workValues,
      );
      if (!workItemView)
        conflict("The intake queue changed; reload it before saving");
      await Promise.all(
        [submissionView, workItemView].map((view) =>
          enqueueSavedViewUpdatedEvent(tx, view, {
            personId: actor.personId,
            userId: actor.userId,
            apiKeyId: actor.apiKey?.id,
          }),
        ),
      );
      return {
        before: rows.map((row) => ({ row, state: savedViewAuditState(row) })),
        after: [submissionView, workItemView] as const,
      };
    },
  );

  for (const view of updatedRows.after) {
    const previous = updatedRows.before.find(({ row }) => row.id === view.id);
    await writeSavedViewAudit({
      actor: actor.auditActor,
      action: "saved_view.updated",
      workspaceId: view.workspaceId,
      entityId: view.id,
      before: previous?.state ?? null,
      after: savedViewAuditState(view),
    });
    await publishEvent("saved_view.updated", {
      savedViewId: view.id,
      workspaceId: view.workspaceId,
      userId: actor.userId,
    });
  }
  const result = queuePairFromRows(updatedRows.after);
  if (!result) throw new Error("Updated intake queue pair is incomplete");
  return toPairResponse(result);
}

export async function runIntakeQueue(input: {
  id: string;
  workspaceId: string;
  personId: string;
  userId: string;
  apiKey?: ApiKey;
  impersonatedBy?: string | null;
  limit: number;
  submissionCursor?: string;
  workItemCursor?: string;
  overrides?: unknown;
  workItemFilter?: string;
  workItemSorts?: string;
  workItemColumns?: string;
}) {
  await requireIntakeEnabled(input.workspaceId);
  const pairRows = await findQueuePairRows(input.workspaceId, input.id);
  const pair = queuePairFromRows(pairRows);
  if (!pair) notFound();
  await assertQueueVisibleToViewer(pair, input.personId, input.userId);
  const submissionView = pair.submissionView;
  const workItemView = pair.workItemView;
  const overrides = queueSubmissionOverridesSchema.parse(input.overrides ?? {});
  const submissionBase = executableQuery(submissionView.query);
  const workItemBase = executableQuery(workItemView.query);
  if (
    submissionBase.entity !== "submission" ||
    workItemBase.entity !== "work_item"
  )
    notFound();

  const submissionFilter = {
    ...(submissionBase.filter ?? {}),
    ...overrides,
  };
  const submissionQuery = {
    entity: "submission" as const,
    ...(Object.keys(submissionFilter).length > 0
      ? { filter: submissionFilter }
      : {}),
  };
  let workItemQuery: unknown = workItemView.query;
  if (
    input.workItemFilter !== undefined ||
    input.workItemSorts !== undefined ||
    input.workItemColumns !== undefined
  ) {
    const stored = workItemView.query as Record<string, unknown>;
    const filter =
      input.workItemFilter === undefined
        ? stored.filter
        : parseWorkItemFilter(input.workItemFilter);
    const sort =
      input.workItemSorts === undefined
        ? stored.sort
        : parseQueueSorts(input.workItemSorts);
    const columns =
      input.workItemColumns === undefined
        ? stored.columns
        : input.workItemColumns.split(",");
    const merged = {
      ...stored,
      entity: "work_item",
      ...(filter === undefined ? {} : { filter }),
      ...(sort === undefined ? {} : { sort }),
      ...(columns === undefined ? {} : { columns }),
    };
    executableQuery(merged);
    workItemQuery = merged;
  }

  const [submissionResult, workItemResult] = await Promise.all([
    executeViewQuery({
      workspaceId: input.workspaceId,
      userId: input.userId,
      apiKey: input.apiKey,
      impersonatedBy: input.impersonatedBy,
      query: submissionQuery,
      limit: input.limit,
      cursor: input.submissionCursor,
    }),
    executeViewQuery({
      workspaceId: input.workspaceId,
      userId: input.userId,
      apiKey: input.apiKey,
      impersonatedBy: input.impersonatedBy,
      query: workItemQuery,
      limit: input.limit,
      cursor: input.workItemCursor,
    }).catch((error: unknown) => {
      if (error instanceof HTTPException && error.status === 403) {
        return {
          data: [],
          page: { nextCursor: null, hasMore: false },
          meta: { total: 0 },
        };
      }
      throw error;
    }),
  ]);
  if (!("submissions" in submissionResult) || !("data" in workItemResult))
    throw new Error("Intake queue entity dispatch mismatch");
  return {
    queue: {
      id: pair.id,
      name: pair.name,
      visibility: pair.visibility,
      versions: {
        submission: pair.submissionView.queueVersion,
        workItem: pair.workItemView.queueVersion,
      },
    },
    submissions: submissionResult,
    workItems: workItemResult,
  };
}

function parseWorkItemFilter(value: string) {
  // Keep queue URL filters on the existing work-item structured-filter codec.
  return parseFilterText(value);
}

function parseQueueSorts(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new HTTPException(400, { message: "Invalid work-item sorts" });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > 5 ||
    !parsed.every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return false;
      const sort = entry as Record<string, unknown>;
      return (
        Object.keys(sort).length === 2 &&
        typeof sort.field === "string" &&
        (sort.order === "asc" || sort.order === "desc")
      );
    })
  ) {
    throw new HTTPException(400, { message: "Invalid work-item sorts" });
  }
  return parsed.map((entry) => {
    const sort = entry as { field: string; order: "asc" | "desc" };
    return { field: sort.field, direction: sort.order };
  });
}
