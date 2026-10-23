import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import type { Transaction } from "../database/executor";
import type { workItemRelationTable } from "../database/schema";
import {
  type ActivityActorType,
  recordWorkItemActivity,
} from "../work-item/activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../work-item/assert-work-item-live";
import { recordWorkItemEvent } from "../work-item/native-event";
import { broadcastNativeWorkItemHint } from "../ws";
import {
  emitUnblockedTargets,
  isOpenBlocker,
  lockRelationGraph,
} from "./blockers";
import {
  findEndpoint,
  findExisting,
  findRelation,
  hasBlockingCycle,
  insertRelation,
  listCandidateRows,
  listRelationRows,
  lockEndpoints,
  removeRelation,
} from "./repository";

export type RelationEndpoint = {
  id: string;
  key: string;
  projectId: string;
  workspaceId: string;
  organisationId?: string | null;
};
export type RelationAuthorizer = (row: RelationEndpoint) => Promise<void>;
export type WorkItemRelation = typeof workItemRelationTable.$inferSelect;
const inverse: Record<string, string> = {
  relates: "relates",
  blocks: "blocked_by",
  duplicates: "duplicated_by",
  precedes: "follows",
  requires: "required_by",
};

async function lockedPair(
  tx: Transaction,
  sourceId: string,
  targetId: string,
  workspaceId: string,
  authorize: RelationAuthorizer,
) {
  const endpoints = await lockEndpoints(tx, [sourceId, targetId]);
  if (endpoints.length !== new Set([sourceId, targetId]).size)
    throw new HTTPException(404, { message: "Work item not found" });
  for (const row of endpoints) {
    assertWorkItemStillLive(row);
    if (row.workspaceId !== workspaceId)
      throw new HTTPException(404, { message: "Work item not found" });
  }
  for (const projectId of [
    ...new Set(endpoints.map((row) => row.projectId)),
  ].sort())
    await assertProjectStillLive(tx, projectId);
  for (const row of endpoints) await authorize(row);
  return endpoints;
}
async function recordMutation(
  tx: Transaction,
  endpoints: RelationEndpoint[],
  relation: WorkItemRelation,
  actorId: string,
  actorType: ActivityActorType,
  removed: boolean,
) {
  // Relations are declared internal activity. Use the existing generic audit action,
  // without inventing a relation-specific semantic event.
  for (const endpoint of endpoints) {
    const value = {
      type: relation.type,
      direction: relation.sourceId === endpoint.id ? "outgoing" : "incoming",
    };
    await recordWorkItemActivity(tx, [
      {
        workspaceId: endpoint.workspaceId,
        workItemId: endpoint.id,
        actorId,
        actorType,
        verb: "updated",
        field: "relation",
        oldValue: removed ? value : null,
        newValue: removed ? null : value,
        visibility: "internal",
      },
    ]);
    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId: endpoint.workspaceId,
      projectId: endpoint.projectId,
      action: "work_item.updated",
      entityType: "work_item",
      entityId: endpoint.id,
      before: removed ? { relation: value } : null,
      after: removed ? null : { relation: value },
    });
    await recordWorkItemEvent(tx, {
      kind: "work_item.updated",
      workItemId: endpoint.id,
      key: endpoint.key,
      workspaceId: endpoint.workspaceId,
      projectId: endpoint.projectId,
      actorId,
      actorType,
      customerVisible: false,
      payload: {
        workItemId: endpoint.id,
        changes: [
          {
            field: "relation",
            from: removed ? value : null,
            to: removed ? null : value,
            visibility: "internal",
          },
        ],
      },
    });
  }
}
export async function publishRelationHints(endpoints: RelationEndpoint[]) {
  await Promise.all(
    endpoints.map((endpoint) =>
      broadcastNativeWorkItemHint({
        projectId: endpoint.projectId,
        topics: [`project:${endpoint.projectId}`, `work_item:${endpoint.key}`],
        eventId: `hint_${randomUUID()}`,
        eventType: "work_item.updated",
        at: new Date().toISOString(),
        key: endpoint.key,
        customerVisible: false,
      }),
    ),
  );
}
export async function createWorkItemRelation(input: {
  key: string;
  targetKey: string;
  type: string;
  workspaceId: string;
  actorId: string;
  actorType: ActivityActorType;
  authorize: RelationAuthorizer;
}) {
  const source = await findEndpoint(input.key, input.workspaceId);
  const target = await findEndpoint(input.targetKey, input.workspaceId);
  if (!source || !target)
    throw new HTTPException(404, { message: "Work item not found" });
  const result = await db.transaction(async (tx) => {
    await lockRelationGraph(tx, input.workspaceId);
    const endpoints = await lockedPair(
      tx,
      source.id,
      target.id,
      input.workspaceId,
      input.authorize,
    );
    if (source.id === target.id)
      throw new HTTPException(422, {
        message: "A work item cannot relate to itself",
      });
    const existing = await findExisting(tx, source.id, target.id, input.type);
    if (existing) return { relation: existing, endpoints, created: false };
    const relation = await insertRelation(tx, source.id, target.id, input.type);
    await recordMutation(
      tx,
      endpoints,
      relation,
      input.actorId,
      input.actorType,
      false,
    );
    return { relation, endpoints, created: true };
  });
  if (result.created) await publishRelationHints(result.endpoints);
  return result.relation;
}
export async function deleteWorkItemRelationInTransaction(
  tx: Transaction,
  input: {
    relationId: string;
    key: string;
    workspaceId: string;
    actorId: string;
    actorType: ActivityActorType;
    authorize: RelationAuthorizer;
  },
) {
  await lockRelationGraph(tx, input.workspaceId);
  const relation = await findRelation(input.relationId, tx);
  if (!relation)
    throw new HTTPException(404, { message: "Relation not found" });
  const endpoints = await lockedPair(
    tx,
    relation.sourceId,
    relation.targetId,
    input.workspaceId,
    input.authorize,
  );
  if (!endpoints.some((row) => row.key === input.key))
    throw new HTTPException(404, { message: "Relation not found" });
  const wasOpen =
    relation.type === "blocks" && (await isOpenBlocker(tx, relation.sourceId));
  const removed = await removeRelation(tx, relation);
  if (!removed) throw new HTTPException(404, { message: "Relation not found" });
  await recordMutation(
    tx,
    endpoints,
    removed,
    input.actorId,
    input.actorType,
    true,
  );
  if (wasOpen)
    await emitUnblockedTargets(tx, {
      targetIds: [relation.targetId],
      formerBlockerId: relation.sourceId,
      actorId: input.actorId,
      actorType: input.actorType,
    });
  return removed;
}
export async function listWorkItemRelations(input: {
  key: string;
  workspaceId: string;
  canRead: (row: RelationEndpoint) => Promise<boolean>;
  canUpdate: (row: RelationEndpoint) => Promise<boolean>;
}) {
  const source = await findEndpoint(input.key, input.workspaceId);
  assertWorkItemStillLive(source);
  const rows = await listRelationRows(source.id, input.workspaceId);
  const sourceUpdate = await input.canUpdate(source);
  const data = [];
  let hiddenCount = 0;
  for (const row of rows) {
    if (
      !(await input.canRead({
        ...row.peer,
        organisationId: row.organisationId,
      } as RelationEndpoint))
    ) {
      hiddenCount++;
      continue;
    }
    const relation = row.relation;
    data.push({
      id: relation.id,
      type: relation.type,
      label:
        relation.sourceId === source.id
          ? relation.type
          : (inverse[relation.type] ?? relation.type),
      item: {
        id: row.peer.id,
        key: row.peer.key,
        title: row.peer.title,
        projectId: row.peer.projectId,
        stateName: row.stateName,
        stateCategory: row.stateCategory,
        assigneeName: row.assigneeMember ? row.assigneeName : null,
      },
      blockingCycle:
        relation.type === "blocks"
          ? await hasBlockingCycle(relation.sourceId, relation.targetId)
          : false,
      canRemove:
        sourceUpdate &&
        (await input.canUpdate({
          ...row.peer,
          organisationId: row.organisationId,
        } as RelationEndpoint)),
    });
  }
  return { data, hiddenCount };
}

export async function listWorkItemRelationCandidates(input: {
  key: string;
  workspaceId: string;
  q?: string;
  cursor?: string;
  limit: number;
  canUpdate: (row: RelationEndpoint) => Promise<boolean>;
  canRead: (row: RelationEndpoint) => Promise<boolean>;
}) {
  const source = await findEndpoint(input.key, input.workspaceId);
  assertWorkItemStillLive(source);
  let after: { key: string; id: string } | undefined;
  if (input.cursor) {
    try {
      const parsed = JSON.parse(
        Buffer.from(input.cursor, "base64url").toString("utf8"),
      );
      if (
        typeof parsed.key !== "string" ||
        typeof parsed.id !== "string" ||
        !parsed.id ||
        parsed.key.includes("\u0000") ||
        parsed.id.includes("\u0000") ||
        parsed.q !== (input.q ?? "") ||
        parsed.source !== source.id
      )
        throw new Error("Cursor mismatch");
      after = { key: parsed.key, id: parsed.id };
    } catch {
      throw new HTTPException(400, {
        message: "Invalid relation candidate cursor",
      });
    }
  }
  const data = [];
  let lastVisible: { key: string; id: string } | undefined;
  while (data.length <= input.limit) {
    const rows = await listCandidateRows({
      workspaceId: input.workspaceId,
      sourceId: source.id,
      q: input.q ?? "",
      after,
      limit: 100,
    });
    if (!rows.length) break;
    for (const row of rows) {
      after = { key: row.item.key, id: row.item.id };
      const endpoint = { ...row.item, organisationId: row.organisationId };
      if (
        !(await input.canRead(endpoint)) ||
        !(await input.canUpdate(endpoint))
      )
        continue;
      data.push({
        id: row.item.id,
        key: row.item.key,
        title: row.item.title,
        projectId: row.item.projectId,
        stateName: row.stateName,
        stateCategory: row.stateCategory,
        assigneeName: row.assigneeMember ? row.assigneeName : null,
      });
      if (data.length === input.limit) lastVisible = after;
      if (data.length > input.limit) break;
    }
    if (data.length > input.limit || rows.length < 100) break;
  }
  const hasMore = data.length > input.limit;
  return {
    data: data.slice(0, input.limit),
    page: {
      hasMore,
      nextCursor:
        hasMore && lastVisible
          ? Buffer.from(
              JSON.stringify({
                ...lastVisible,
                q: input.q ?? "",
                source: source.id,
              }),
            ).toString("base64url")
          : null,
    },
  };
}
