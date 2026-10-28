import { resolveFeatureFlag } from "@taskdesk/permissions";
import { and, asc, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import type { DbTransaction } from "../events/outbox";
import { getActiveStaffPerson } from "../instance/users/repository";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { appendIntakeAudit, intakeAuditContext } from "./audit";
import { workspaceQuery } from "./schema";

type GroupOrderVariables = BaseVariables & {
  workspaceId: string;
  workspaceIdSource: "request";
};
type GroupOrderContext = Context<{ Variables: GroupOrderVariables }>;

const groupOrderResponse = z.object({
  groupOrder: z.object({
    groups: z.array(z.string()),
    version: z.number().int(),
  }),
});
const groupOrderBody = z
  .object({
    groups: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .refine((value) => value.trim().length > 0),
      )
      .max(500),
    version: z.number().int().positive(),
  })
  .strict();

async function requireIntakeEnabled(workspaceId: string) {
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
    throw new HTTPException(404, { message: "Intake is not enabled" });
}

async function groupOrderScope(c: GroupOrderContext, next: Next) {
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId)
    throw new HTTPException(400, { message: "workspaceId is required" });
  await requireIntakeEnabled(workspaceId);
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, {
        message: "Request type group order not found",
      });
    throw error;
  }
  c.set("workspaceId", workspaceId);
  c.set("workspaceIdSource", "request");
  await next();
}

async function currentGroups(executor: Executor, workspaceId: string) {
  const rows = await executor
    .select({
      id: schema.requestTypeTable.id,
      name: schema.requestTypeTable.group,
      position: schema.requestTypeTable.position,
    })
    .from(schema.requestTypeTable)
    .where(eq(schema.requestTypeTable.workspaceId, workspaceId))
    .orderBy(
      asc(schema.requestTypeTable.position),
      asc(schema.requestTypeTable.id),
    );
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const row of rows) {
    if (!seen.has(row.name)) {
      seen.add(row.name);
      groups.push(row.name);
    }
  }
  return groups;
}

function reconcileGroups(stored: readonly string[], active: readonly string[]) {
  const activeSet = new Set(active);
  const result = stored.filter(
    (group, index) => activeSet.has(group) && stored.indexOf(group) === index,
  );
  const included = new Set(result);
  for (const group of active) {
    if (!included.has(group)) {
      result.push(group);
      included.add(group);
    }
  }
  return result;
}

function sameGroups(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((group, index) => group === right[index])
  );
}

async function readStoredOrder(executor: Executor, workspaceId: string) {
  const [row] = await executor
    .select()
    .from(schema.requestTypeGroupOrderTable)
    .where(eq(schema.requestTypeGroupOrderTable.workspaceId, workspaceId))
    .limit(1);
  return row;
}

/** Locks the workspace before group-order/type rows; shared by every group-set writer. */
export async function lockRequestTypeGroupOrder(
  tx: DbTransaction,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .for("update")
    .limit(1);
  if (!workspace)
    throw new HTTPException(404, { message: "Workspace not found" });

  const [stored] = await tx
    .select()
    .from(schema.requestTypeGroupOrderTable)
    .where(eq(schema.requestTypeGroupOrderTable.workspaceId, workspaceId))
    .for("update")
    .limit(1);
  const active = await currentGroups(tx, workspaceId);
  if (!stored) {
    const [created] = await tx
      .insert(schema.requestTypeGroupOrderTable)
      .values({
        workspaceId,
        orderedGroups: active,
        version: 1,
        updatedAt: new Date(),
      })
      .returning();
    if (!created)
      throw new HTTPException(500, {
        message: "Could not initialize request type group order",
      });
    return created;
  }
  const reconciled = reconcileGroups(stored.orderedGroups, active);
  if (sameGroups(stored.orderedGroups, reconciled)) return stored;
  const [updated] = await tx
    .update(schema.requestTypeGroupOrderTable)
    .set({
      orderedGroups: reconciled,
      version: stored.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.requestTypeGroupOrderTable.workspaceId, workspaceId),
        eq(schema.requestTypeGroupOrderTable.version, stored.version),
      ),
    )
    .returning();
  if (!updated)
    throw new HTTPException(409, {
      message: "Request type groups changed; reload before saving",
    });
  return updated;
}

/** Reconciles membership after a caller already holds the workspace/order locks. */
export async function synchronizeRequestTypeGroupOrder(
  tx: DbTransaction,
  workspaceId: string,
) {
  const stored = await readStoredOrder(tx, workspaceId);
  if (!stored) return lockRequestTypeGroupOrder(tx, workspaceId);
  const active = await currentGroups(tx, workspaceId);
  const reconciled = reconcileGroups(stored.orderedGroups, active);
  if (sameGroups(stored.orderedGroups, reconciled)) return stored;
  const [updated] = await tx
    .update(schema.requestTypeGroupOrderTable)
    .set({
      orderedGroups: reconciled,
      version: stored.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.requestTypeGroupOrderTable.workspaceId, workspaceId),
        eq(schema.requestTypeGroupOrderTable.version, stored.version),
      ),
    )
    .returning();
  if (!updated)
    throw new HTTPException(409, {
      message: "Request type groups changed; reload before saving",
    });
  return updated;
}

async function getGroupOrder(workspaceId: string) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId))
      .for("share")
      .limit(1);
    const [stored, active] = await Promise.all([
      readStoredOrder(tx, workspaceId),
      currentGroups(tx, workspaceId),
    ]);
    return {
      groups: reconcileGroups(stored?.orderedGroups ?? [], active),
      version: stored?.version ?? 1,
    };
  });
}

const getGroupOrderRoute = createRoute({
  method: "get",
  operationId: "getRequestTypeGroupOrder",
  path: "/request-type-groups/order",
  tags: ["Request types"],
  summary: "Get request type catalogue group order",
  middleware: [
    groupOrderScope,
    requireApiKeyPermissionScope({ request_type: ["read"] }),
    requireWorkspaceCapability("request_type:read"),
  ] as const,
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse("Request type group order", groupOrderResponse),
    403: errorResponse("Missing request type read capability"),
    404: errorResponse("Request type group order not found"),
  },
});
const putGroupOrderRoute = createRoute({
  method: "put",
  operationId: "replaceRequestTypeGroupOrder",
  path: "/request-type-groups/order",
  tags: ["Request types"],
  summary: "Replace request type catalogue group order",
  middleware: [
    // AU-14: audit rows carry the request context and never fail the action. Resolved at
    // request time: `./audit` -> api-key/enforce -> ... -> intake/deletion-target imports
    // this module back, so a direct reference is in its TDZ when `./audit` loads first
    // (e.g. the seed script entry).
    (c: Context, next: Next) => intakeAuditContext(c, next),
    groupOrderScope,
    requireApiKeyPermissionScope({ request_type: ["manage"] }),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: {
    query: workspaceQuery,
    body: {
      required: true,
      content: { "application/json": { schema: groupOrderBody } },
    },
  },
  responses: {
    200: jsonResponse("Request type group order", groupOrderResponse),
    403: errorResponse("Missing request type manage capability"),
    404: errorResponse("Request type group order not found"),
    409: errorResponse("Request type group order changed"),
    422: errorResponse(
      "Group order must contain every current group exactly once",
    ),
  },
});

export const requestTypeGroupOrderRouter = apiRouter<GroupOrderVariables>()
  .openapi(getGroupOrderRoute, async (c) =>
    c.json({ groupOrder: await getGroupOrder(c.get("workspaceId")) }, 200),
  )
  .openapi(putGroupOrderRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = c.req.valid("json");
    const actorUserId = c.get("userId");
    const [actor] = await getActiveStaffPerson(actorUserId);
    if (!actor)
      throw new HTTPException(403, { message: "Active staff person required" });
    const apiKey = c.get("apiKey");

    const result = await db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId))
        .for("update")
        .limit(1);
      if (!workspace)
        throw new HTTPException(404, { message: "Workspace not found" });

      const [stored] = await tx
        .select()
        .from(schema.requestTypeGroupOrderTable)
        .where(eq(schema.requestTypeGroupOrderTable.workspaceId, workspaceId))
        .for("update")
        .limit(1);
      const active = await currentGroups(tx, workspaceId);
      const current = reconcileGroups(stored?.orderedGroups ?? [], active);
      const currentVersion = stored?.version ?? 1;
      if (body.version !== currentVersion)
        throw new HTTPException(409, {
          message: "Request type group order changed; reload before saving",
        });
      if (
        body.groups.length !== active.length ||
        new Set(body.groups).size !== body.groups.length ||
        body.groups.some((group) => !active.includes(group))
      )
        throw new HTTPException(422, {
          message: "Group order must contain every current group exactly once",
        });
      if (sameGroups(body.groups, current))
        return { groups: current, version: currentVersion, changed: false };

      const [saved] = stored
        ? await tx
            .update(schema.requestTypeGroupOrderTable)
            .set({
              orderedGroups: body.groups,
              version: currentVersion + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.requestTypeGroupOrderTable.workspaceId, workspaceId),
                eq(schema.requestTypeGroupOrderTable.version, currentVersion),
              ),
            )
            .returning()
        : await tx
            .insert(schema.requestTypeGroupOrderTable)
            .values({
              workspaceId,
              orderedGroups: body.groups,
              version: currentVersion + 1,
              updatedAt: new Date(),
            })
            .returning();
      if (!saved)
        throw new HTTPException(409, {
          message: "Request type group order changed; reload before saving",
        });
      await appendIntakeAudit(tx, {
        actorId: actor.id,
        actorType: apiKey ? "api_key" : "person",
        apiKeyId: apiKey?.id ?? null,
        workspaceId,
        action: "request_type.group_order_updated",
        entityType: "request_type_group_order",
        entityId: workspaceId,
        before: { version: currentVersion, groupCount: current.length },
        after: {
          version: saved.version,
          groupCount: saved.orderedGroups.length,
          changedFields: ["groupOrder"],
        },
      });
      return {
        groups: saved.orderedGroups,
        version: saved.version,
        changed: true,
      };
    });
    return c.json(
      { groupOrder: { groups: result.groups, version: result.version } },
      200,
    );
  });

/**
 * Portal catalogues can span workspaces and merge same-named groups. Workspace order is
 * local, so choose the lexically earliest contributing workspace as the deterministic
 * precedence for each merged group; then order that workspace's labels by its saved rank.
 */
export function orderPortalCatalogueGroups(
  sources: readonly { workspaceId: string; groups: readonly string[] }[],
) {
  const precedence = new Map<string, { workspaceId: string; rank: number }>();
  for (const source of sources) {
    source.groups.forEach((group, rank) => {
      const current = precedence.get(group);
      if (!current || source.workspaceId < current.workspaceId)
        precedence.set(group, { workspaceId: source.workspaceId, rank });
    });
  }
  return [...precedence.entries()]
    .sort(
      ([groupA, a], [groupB, b]) =>
        (a.workspaceId < b.workspaceId
          ? -1
          : a.workspaceId > b.workspaceId
            ? 1
            : 0) ||
        a.rank - b.rank ||
        (groupA < groupB ? -1 : groupA > groupB ? 1 : 0),
    )
    .map(([group]) => group);
}
