import { formatSubmissionReference } from "@taskdesk/domain";
import { resolveFeatureFlag } from "@taskdesk/permissions";
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  min,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import db, { schema } from "../database";
import type { Transaction } from "../database/executor";
import {
  hasDenseRankPositions,
  lockRankPartition,
  rebalancePositionPartition,
} from "../scheduler/position-rebalance";
import { assertProjectStillLive } from "../work-item/assert-work-item-live";
import { loadPortalViewer, type PortalViewer } from "./repository";

const {
  projectTable,
  requestParticipantTable,
  stateTable,
  stateTemplateTable,
  submissionTable,
  workItemTable,
} = schema;

export const PORTAL_BACKLOG_LIMIT = 50;
const MAX_CURSOR_LENGTH = 2048;

export const portalBacklogItemSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  projectId: z.string(),
  projectKey: z.string(),
  projectName: z.string(),
  stateId: z.string(),
  stateName: z.string(),
  statePosition: z.number().int(),
  position: z.string(),
  version: z.number().int(),
  sourceRef: z.string(),
});

export const portalBacklogPageSchema = z.object({
  items: z.array(portalBacklogItemSchema),
  page: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});

export const portalBacklogQuerySchema = z.object({
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
});

export const rankPortalBacklogBodySchema = z
  .object({
    key: z.string().min(1).max(200),
    beforeId: z.string().min(1).max(200).optional(),
    afterId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((body) => Boolean(body.beforeId) || Boolean(body.afterId), {
    message: "A rank neighbour is required",
  });

export const rankPortalBacklogResponseSchema = z.object({
  key: z.string(),
  position: z.string(),
  version: z.number().int(),
});

export type PortalBacklogRow = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  stateId: string;
  stateName: string;
  statePosition: number;
  position: string;
  version: number;
  sourceRef: string;
};

export type PortalBacklogPage = {
  items: PortalBacklogRow[];
  page: { nextCursor: string | null; hasMore: boolean };
};

type BacklogCursor = {
  v: 1;
  scope: string;
  projectId: string;
  statePosition: number;
  stateId: string;
  position: string;
  id: string;
};

function cursorScope(viewer: PortalViewer) {
  return `portal-backlog:${viewer.organisationId}:${viewer.personId}:${PORTAL_BACKLOG_LIMIT}`;
}

export function decodePortalBacklogCursor(
  cursor: string | undefined,
  scope: string,
): BacklogCursor | undefined {
  if (!cursor) return undefined;
  if (cursor.length > MAX_CURSOR_LENGTH)
    throw new HTTPException(400, { message: "Invalid backlog cursor" });
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as BacklogCursor;
    if (
      decoded.v !== 1 ||
      decoded.scope !== scope ||
      typeof decoded.projectId !== "string" ||
      !Number.isInteger(decoded.statePosition) ||
      typeof decoded.stateId !== "string" ||
      typeof decoded.position !== "string" ||
      !/^-?\d+(?:\.\d+)?$/.test(decoded.position) ||
      typeof decoded.id !== "string"
    )
      throw new Error("invalid cursor");
    return decoded;
  } catch {
    throw new HTTPException(400, { message: "Invalid backlog cursor" });
  }
}

function encodePortalBacklogCursor(cursor: BacklogCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function privateSubmissionVisible(viewer: PortalViewer) {
  return or(
    eq(submissionTable.requesterId, viewer.personId),
    exists(
      db
        .select({ one: sql`1` })
        .from(requestParticipantTable)
        .where(
          and(
            eq(requestParticipantTable.submissionId, submissionTable.id),
            eq(requestParticipantTable.personId, viewer.personId),
          ),
        ),
    ),
  );
}

function privateWorkItemVisible(viewer: PortalViewer) {
  return or(
    eq(workItemTable.requesterId, viewer.personId),
    exists(
      db
        .select({ one: sql`1` })
        .from(requestParticipantTable)
        .where(
          and(
            eq(requestParticipantTable.workItemId, workItemTable.id),
            eq(requestParticipantTable.personId, viewer.personId),
          ),
        ),
    ),
  );
}

/** CP-16 audience intersection for an accepted work item and its linked submission. */
function portalBacklogReach(viewer: PortalViewer) {
  return and(
    eq(projectTable.organisationId, viewer.organisationId),
    eq(submissionTable.organisationId, viewer.organisationId),
    inArray(submissionTable.state, ["accepted", "duplicate"]),
    or(
      eq(submissionTable.customerVisibility, "organisation"),
      privateSubmissionVisible(viewer),
    ),
    or(
      eq(workItemTable.customerVisibility, "organisation"),
      privateWorkItemVisible(viewer),
    ),
  );
}

async function enabledBacklogWorkspaceIds(viewer: PortalViewer) {
  const rows = await db
    .selectDistinct({ workspaceId: workItemTable.workspaceId })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(
      submissionTable,
      eq(submissionTable.workItemId, workItemTable.id),
    )
    .where(
      and(
        portalBacklogReach(viewer),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    );
  const workspaceIds = rows.map((row) => row.workspaceId);
  if (!workspaceIds.length) return [];
  const [[instance], workspaceFlags] = await Promise.all([
    db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    db
      .select({
        workspaceId: schema.workspaceFeatureFlagTable.workspaceId,
        enabled: schema.workspaceFeatureFlagTable.enabled,
      })
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          inArray(schema.workspaceFeatureFlagTable.workspaceId, workspaceIds),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      ),
  ]);
  return workspaceIds.filter(
    (workspaceId) =>
      resolveFeatureFlag({
        feature: "feature.intake",
        instance: instance ?? null,
        workspace:
          workspaceFlags.find((flag) => flag.workspaceId === workspaceId)
            ?.enabled ?? null,
      }).enabled,
  );
}

async function requireBacklogWorkspaceEnabled(workspaceId: string) {
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
  )
    throw new HTTPException(404, { message: "Backlog item not found" });
}

/**
 * Read only linked, visible work items in concrete states whose configured category is
 * `backlog`. Ranking remains partitioned by the existing `(project_id, state_id)` key.
 */
export async function listPortalBacklog(
  personId: string,
  cursor?: string,
): Promise<PortalBacklogPage> {
  const viewer = await loadPortalViewer(personId);
  const scope = cursorScope(viewer);
  const after = decodePortalBacklogCursor(cursor, scope);
  const workspaceIds = await enabledBacklogWorkspaceIds(viewer);
  if (!workspaceIds.length)
    return { items: [], page: { nextCursor: null, hasMore: false } };
  const predicates = [
    portalBacklogReach(viewer),
    inArray(workItemTable.workspaceId, workspaceIds),
    isNull(workItemTable.deletedAt),
    isNull(workItemTable.archivedAt),
    isNull(projectTable.archivedAt),
    isNull(projectTable.deletedAt),
    isNull(stateTable.archivedAt),
    isNull(stateTemplateTable.archivedAt),
    eq(stateTemplateTable.group, "backlog"),
  ];

  const rows = await db
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      projectId: projectTable.id,
      projectKey: projectTable.slug,
      projectName: projectTable.name,
      stateId: stateTable.id,
      stateName: stateTemplateTable.name,
      statePosition: stateTable.position,
      position: workItemTable.position,
      version: workItemTable.version,
      sourceNumber: min(submissionTable.number),
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .innerJoin(
      submissionTable,
      eq(submissionTable.workItemId, workItemTable.id),
    )
    .where(
      after
        ? and(
            ...predicates,
            sql`(${projectTable.id}, ${stateTable.position}, ${stateTable.id}, ${workItemTable.position}, ${workItemTable.id}) > (${after.projectId}, ${after.statePosition}, ${after.stateId}, ${after.position}::numeric, ${after.id})`,
          )
        : and(...predicates),
    )
    .groupBy(
      workItemTable.id,
      projectTable.id,
      stateTable.id,
      stateTemplateTable.id,
    )
    .orderBy(
      asc(projectTable.id),
      asc(stateTable.position),
      asc(stateTable.id),
      asc(workItemTable.position),
      asc(workItemTable.id),
    )
    .limit(PORTAL_BACKLOG_LIMIT + 1);

  const hasMore = rows.length > PORTAL_BACKLOG_LIMIT;
  const pageRows = rows.slice(0, PORTAL_BACKLOG_LIMIT);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => ({
      id: row.id,
      key: row.key,
      title: row.title,
      projectId: row.projectId,
      projectKey: row.projectKey,
      projectName: row.projectName,
      stateId: row.stateId,
      stateName: row.stateName,
      statePosition: row.statePosition,
      position: String(row.position),
      version: row.version,
      sourceRef: formatSubmissionReference(Number(row.sourceNumber)),
    })),
    page: {
      hasMore,
      nextCursor:
        hasMore && last
          ? encodePortalBacklogCursor({
              v: 1,
              scope,
              projectId: last.projectId,
              statePosition: last.statePosition,
              stateId: last.stateId,
              position: String(last.position),
              id: last.id,
            })
          : null,
    },
  };
}

export type RankPortalBacklogInput = {
  key: string;
  beforeId?: string;
  afterId?: string;
};

async function findReachableBacklogItem(
  tx: Transaction,
  viewer: PortalViewer,
  id: string,
) {
  const [row] = await tx
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      stateId: workItemTable.stateId,
      position: workItemTable.position,
      version: workItemTable.version,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .innerJoin(
      submissionTable,
      eq(submissionTable.workItemId, workItemTable.id),
    )
    .where(
      and(
        eq(workItemTable.id, id),
        portalBacklogReach(viewer),
        eq(stateTemplateTable.group, "backlog"),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(stateTable.archivedAt),
        isNull(stateTemplateTable.archivedAt),
      ),
    )
    .limit(1)
    .for("update", { of: workItemTable });
  if (!row) throw new HTTPException(404, { message: "Backlog item not found" });
  return row;
}

export async function rankPortalBacklog(
  personId: string,
  input: RankPortalBacklogInput,
) {
  if (!input.beforeId && !input.afterId)
    throw new HTTPException(400, { message: "A rank neighbour is required" });
  if (input.beforeId === input.afterId && input.beforeId)
    throw new HTTPException(400, {
      message: "Rank neighbours must be distinct",
    });
  const viewer = await loadPortalViewer(personId);
  const result = await db.transaction(async (tx) => {
    const targetRows = await tx
      .select({
        id: workItemTable.id,
        workspaceId: workItemTable.workspaceId,
        projectId: workItemTable.projectId,
        stateId: workItemTable.stateId,
      })
      .from(workItemTable)
      .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
      .innerJoin(
        submissionTable,
        eq(submissionTable.workItemId, workItemTable.id),
      )
      .where(and(eq(workItemTable.key, input.key), portalBacklogReach(viewer)))
      .limit(1);
    const targetAnchor = targetRows[0];
    if (!targetAnchor)
      throw new HTTPException(404, { message: "Backlog item not found" });
    await requireBacklogWorkspaceEnabled(targetAnchor.workspaceId);
    const partition = {
      workspaceId: targetAnchor.workspaceId,
      projectId: targetAnchor.projectId,
      stateId: targetAnchor.stateId,
    };
    await lockRankPartition(tx, partition);
    const target = await findReachableBacklogItem(tx, viewer, targetAnchor.id);
    if (
      target.key !== input.key ||
      target.projectId !== partition.projectId ||
      target.stateId !== partition.stateId
    )
      throw new HTTPException(409, {
        message: "Backlog item changed; refresh and retry",
      });
    await assertProjectStillLive(tx, partition.projectId);

    const neighbourIds = [input.beforeId, input.afterId].filter(
      (id): id is string => Boolean(id),
    );
    if (neighbourIds.includes(target.id))
      throw new HTTPException(400, {
        message: "Rank neighbours must differ from the item",
      });
    const neighbourRows = await Promise.all(
      neighbourIds.map((id) => findReachableBacklogItem(tx, viewer, id)),
    );
    if (
      neighbourRows.some(
        (row) =>
          row.projectId !== target.projectId ||
          row.stateId !== target.stateId ||
          row.workspaceId !== target.workspaceId,
      )
    )
      throw new HTTPException(404, { message: "Backlog item not found" });
    const byId = new Map(neighbourRows.map((row) => [row.id, row.position]));
    const beforePosition = input.beforeId
      ? byId.get(input.beforeId)
      : undefined;
    const afterPosition = input.afterId ? byId.get(input.afterId) : undefined;
    const newPosition =
      beforePosition !== undefined && afterPosition !== undefined
        ? sql`(${beforePosition}::numeric + ${afterPosition}::numeric) / 2`
        : beforePosition !== undefined
          ? sql`${beforePosition}::numeric + 1`
          : sql`${afterPosition}::numeric - 1`;
    const computed = await tx.execute<{
      position: string | null;
      ordered: boolean;
    }>(sql`
      WITH raw_position AS (SELECT (${newPosition})::numeric AS value),
      candidate AS (SELECT CASE WHEN value BETWEEN -9999999999.9999999999::numeric AND 9999999999.9999999999::numeric
        THEN value::numeric(20,10) END AS position FROM raw_position)
      SELECT position::text, position IS NOT NULL
        AND ${beforePosition !== undefined ? sql`position > ${beforePosition}::numeric` : sql`true`}
        AND ${afterPosition !== undefined ? sql`position < ${afterPosition}::numeric` : sql`true`} AS ordered FROM candidate
    `);
    const candidate = computed.rows[0];
    if (!candidate?.ordered || candidate.position === null)
      return {
        updated: null,
        partition,
        dense: await hasDenseRankPositions(tx, partition),
      };
    const [updated] = await tx
      .update(workItemTable)
      .set({
        position: candidate.position,
        version: sql`${workItemTable.version} + 1`,
      })
      .where(eq(workItemTable.id, target.id))
      .returning({
        key: workItemTable.key,
        position: workItemTable.position,
        version: workItemTable.version,
      });
    if (!updated)
      throw new HTTPException(404, { message: "Backlog item not found" });
    return {
      updated,
      partition,
      dense: await hasDenseRankPositions(tx, partition),
    };
  });
  if (result.dense) await rebalancePositionPartition(result.partition);
  if (!result.updated)
    throw new HTTPException(409, {
      message: "Refresh the backlog and retry ranking",
    });
  await requireBacklogWorkspaceEnabled(result.partition.workspaceId);
  const [current] = await db
    .select({
      key: workItemTable.key,
      position: workItemTable.position,
      version: workItemTable.version,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .innerJoin(
      submissionTable,
      eq(submissionTable.workItemId, workItemTable.id),
    )
    .where(
      and(
        eq(workItemTable.key, input.key),
        eq(workItemTable.workspaceId, result.partition.workspaceId),
        portalBacklogReach(viewer),
        eq(stateTemplateTable.group, "backlog"),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(stateTable.archivedAt),
        isNull(stateTemplateTable.archivedAt),
      ),
    );
  if (!current)
    throw new HTTPException(404, { message: "Backlog item not found" });
  return current;
}
