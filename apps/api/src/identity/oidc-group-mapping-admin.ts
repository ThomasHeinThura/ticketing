import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { appendStepUpAudit } from "../auth/step-up-audit";
import { consumeOidcGroupMappingProof } from "../auth/step-up-service";
import db, { schema } from "../database";
import {
  isCurrentInstanceAdmin,
  notifyCurrentInstanceAdminsOfAuditFailure,
} from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireSessionOnly } from "../utils/require-session-only";
import { invalidateNativeAuthorization } from "../ws";
import {
  lockScimGrantClosure,
  retryIdentityGrantClosure,
} from "./membership-projection";
import {
  OIDC_GROUP_MAPPING_CREATE_OPERATION,
  OIDC_GROUP_MAPPING_UPDATE_OPERATION,
  type OidcGroupMappingCreateRequest,
  type OidcGroupMappingUpdateRequest,
  oidcGroupMappingCreateRequestSchema,
  oidcGroupMappingUpdateRequestSchema,
} from "./oidc-group-mapping-contract";
import {
  findOidcGroupMapping,
  getCurrentInstanceAdminPersonInTransaction,
  getIdentityConnection,
  getIdentityPersonForUser,
  getOidcGroupMappingSnapshot,
  listOidcGroupMappings,
  listOidcMappingAffectedUserIds,
  lockFullIdentityConnection,
  lockOidcGroupMappingById,
  retireOidcGroupGrants,
  validateOidcMappingRole,
} from "./repository";

const versionSchema = z.number().int().positive().safe();
const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
});
const mappingDtoSchema = z.object({
  id: z.string(),
  externalGroupId: z.string(),
  externalGroupNameSnapshot: z.string().nullable(),
  roleId: z.string(),
  scope: z.enum(["organisation", "workspace"]),
  scopeId: z.string(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const getResponseSchema = z.object({
  data: z.array(mappingDtoSchema),
  configVersion: versionSchema,
});
const mutationResponseSchema = z.object({
  data: mappingDtoSchema,
  configVersion: versionSchema,
});

function problem(status: number, title: string) {
  return { type: "about:blank", title, status };
}

function dto(
  mapping: {
    id: string;
    externalGroupId: string;
    externalGroupNameSnapshot: string | null;
    roleId: string;
    scope: string;
    scopeId: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  connection: { portalScope: string; organisationId: string | null },
) {
  return mappingDtoSchema.parse({
    ...mapping,
    scopeId:
      connection.portalScope === "customer" && mapping.scope === "organisation"
        ? (connection.organisationId ?? "")
        : mapping.scopeId,
    createdAt: mapping.createdAt.toISOString(),
    updatedAt: mapping.updatedAt.toISOString(),
  });
}

async function reportAuditFailure() {
  recordAuditWriteFailure("mutation");
  await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
}

const getRoute = createRoute({
  method: "get",
  operationId: "getOidcGroupMappings",
  path: "/identity-connections/{id}/oidc-group-mappings",
  tags: ["Instance"],
  summary: "List safe OIDC group mappings for a connection",
  middleware: [requireSessionOnly()] as const,
  request: { params: z.object({ id: z.string().min(1).max(128) }) },
  responses: {
    200: jsonResponse(
      "Safe OIDC group mapping configuration",
      getResponseSchema,
    ),
    404: jsonResponse("Connection unavailable", problemSchema),
    503: jsonResponse("Stored mapping configuration is invalid", problemSchema),
  },
});

const postRoute = createRoute({
  method: "post",
  operationId: "createOidcGroupMapping",
  path: "/identity-connections/{id}/oidc-group-mappings",
  tags: ["Instance"],
  summary: "Create an OIDC group mapping",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    headers: z.object({
      "x-taskdesk-step-up-token": z.string().min(1).max(128),
    }),
    body: {
      required: true,
      content: {
        "application/json": { schema: oidcGroupMappingCreateRequestSchema },
      },
    },
  },
  responses: {
    201: jsonResponse("Created OIDC group mapping", mutationResponseSchema),
    403: jsonResponse("Step-up unavailable", problemSchema),
    404: jsonResponse("Connection unavailable", problemSchema),
    409: jsonResponse(
      "Mapping or version conflict",
      problemSchema.extend({ currentVersion: versionSchema.optional() }),
    ),
    422: jsonResponse("Invalid mapping", problemSchema),
  },
});

const patchRoute = createRoute({
  method: "patch",
  operationId: "updateOidcGroupMapping",
  path: "/identity-connections/{id}/oidc-group-mappings/{mappingId}",
  tags: ["Instance"],
  summary: "Update an OIDC group mapping",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({
      id: z.string().min(1).max(128),
      mappingId: z.string().min(1).max(128),
    }),
    headers: z.object({
      "x-taskdesk-step-up-token": z.string().min(1).max(128),
    }),
    body: {
      required: true,
      content: {
        "application/json": { schema: oidcGroupMappingUpdateRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated OIDC group mapping", mutationResponseSchema),
    403: jsonResponse("Step-up unavailable", problemSchema),
    404: jsonResponse("Mapping unavailable", problemSchema),
    409: jsonResponse(
      "Version conflict",
      problemSchema.extend({ currentVersion: versionSchema.optional() }),
    ),
    422: jsonResponse("Invalid mapping", problemSchema),
  },
});

async function mappingTargetIsValid(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  connection: {
    providerType: string;
    portalScope: string;
    organisationId: string | null;
    maxRoleRank: number | null;
  },
  target: {
    scope: "organisation" | "workspace";
    scopeId: string;
    roleId: string;
  },
) {
  return validateOidcMappingRole(tx, { ...connection, ...target });
}

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    await requireCurrentInstanceAdmin(
      c,
      "GET",
      "/api/instance/identity-connections/{id}/oidc-group-mappings",
    );
    setShadowLegacyAuthorization(c, "allowed");
    const { id } = c.req.valid("param");
    const [connection] = await getIdentityConnection(id);
    if (!connection) return c.json(problem(404, "Not found"), 404);
    const mappings = await listOidcGroupMappings(id);
    const valid = await db.transaction(async (tx) => {
      for (const mapping of mappings) {
        if (
          !(await mappingTargetIsValid(tx, connection, {
            scope: mapping.scope as "organisation" | "workspace",
            scopeId: mapping.scopeId,
            roleId: mapping.roleId,
          }))
        )
          return false;
      }
      return true;
    });
    if (!valid)
      return c.json(
        problem(503, "Stored mapping configuration unavailable"),
        503,
      );
    return c.json(
      getResponseSchema.parse({
        data: mappings.map((mapping) => dto(mapping, connection)),
        configVersion: connection.configVersion,
      }),
      200,
    );
  })
  .openapi(postRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const userId = c.get("userId");
    if (!(await isCurrentInstanceAdmin(userId)))
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(
      c,
      "POST",
      "/api/instance/identity-connections/{id}/oidc-group-mappings",
    );
    setShadowLegacyAuthorization(c, "allowed");
    const { id } = c.req.valid("param");
    const request = c.req.valid("json");
    const session = c.get("session") as { id: string } | null;
    if (!session) throw new HTTPException(403, { message: "session_required" });
    const [actor] = await getIdentityPersonForUser(userId);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    const traceId = normaliseTraceId(c.req.header("x-request-id"));
    const targetScopeId =
      request.scope === "organisation" ? undefined : request.scopeId;
    if (request.scope === "workspace" && !targetScopeId)
      return c.json(problem(422, "Invalid mapping target"), 422);
    let auditFailed = false;
    const result = await retryIdentityGrantClosure(() =>
      db.transaction(async (tx) => {
        auditFailed = false;
        await lockScimGrantClosure(tx, {
          connectionId: id,
          sourceKinds: ["oidc_group"],
          actorPersonId: actor.id,
          proposedRoleId: request.roleId,
          proposedScope: request.scope,
          ...(targetScopeId ? { proposedScopeId: targetScopeId } : {}),
          ...(request.scope === "organisation"
            ? {
                proposedOrganisationId:
                  (await getIdentityConnection(id))[0]?.organisationId ??
                  undefined,
              }
            : {}),
        });
        const [connection] = await lockFullIdentityConnection(tx, id);
        if (!connection) return { kind: "not_found" as const };
        const [currentActor] = await getCurrentInstanceAdminPersonInTransaction(
          tx,
          userId,
        );
        if (!currentActor || currentActor.id !== actor.id)
          return { kind: "forbidden" as const };
        if (connection.configVersion !== request.configVersion)
          return {
            kind: "conflict" as const,
            version: connection.configVersion,
          };
        const scopeId =
          connection.portalScope === "customer"
            ? (connection.organisationId ?? "")
            : (request.scopeId ?? "");
        if (
          (connection.portalScope === "customer" &&
            request.scopeId !== undefined) ||
          !(await mappingTargetIsValid(tx, connection, {
            scope: request.scope,
            scopeId,
            roleId: request.roleId,
          }))
        )
          return { kind: "invalid" as const };
        const [duplicate] = await findOidcGroupMapping(
          tx,
          id,
          request.externalGroupId,
        );
        if (duplicate) return { kind: "duplicate" as const };
        const proof = await consumeOidcGroupMappingProof(tx, {
          token: c.req.valid("header")["x-taskdesk-step-up-token"],
          personId: actor.id,
          sessionId: session.id,
          connectionId: id,
          request: request as OidcGroupMappingCreateRequest,
          operation: OIDC_GROUP_MAPPING_CREATE_OPERATION,
        });
        if (!proof) return { kind: "proof" as const };
        const mappingId = createId();
        const [created] = await tx
          .insert(schema.oidcGroupMappingTable)
          .values({
            id: mappingId,
            identityConnectionId: id,
            externalGroupId: request.externalGroupId,
            externalGroupNameSnapshot: request.externalGroupNameSnapshot,
            roleId: request.roleId,
            scope: request.scope,
            scopeId,
            enabled: request.enabled,
            createdBy: actor.id,
          })
          .returning();
        if (!created) throw new Error("OIDC mapping insert failed");
        const nextVersion = request.configVersion + 1;
        const [versionRow] = await tx
          .update(schema.identityConnectionTable)
          .set({
            configVersion: nextVersion,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(
            and(
              eq(schema.identityConnectionTable.id, id),
              eq(
                schema.identityConnectionTable.configVersion,
                request.configVersion,
              ),
            ),
          )
          .returning({
            configVersion: schema.identityConnectionTable.configVersion,
          });
        if (!versionRow) throw new Error("OIDC mapping version CAS failed");
        await writeMappingEvidence(tx, {
          actorId: userId,
          connectionId: id,
          mappingId,
          changedFields: ["created"],
          configVersion: nextVersion,
          traceId,
        }).then((result) => {
          auditFailed = !result;
        });
        await appendStepUpAudit(tx, {
          action: "auth.step_up_consumed",
          actorId: userId,
          personId: actor.id,
          operation: OIDC_GROUP_MAPPING_CREATE_OPERATION,
          traceId,
        });
        return { kind: "created" as const, mapping: created, connection };
      }),
    );
    if (auditFailed) await reportAuditFailure();
    if (result.kind === "not_found")
      return c.json(problem(404, "Not found"), 404);
    if (result.kind === "forbidden")
      throw new HTTPException(403, { message: "Forbidden" });
    if (result.kind === "conflict")
      return c.json(
        { ...problem(409, "Version conflict"), currentVersion: result.version },
        409,
      );
    if (result.kind === "duplicate")
      return c.json(problem(409, "Mapping already exists"), 409);
    if (result.kind === "invalid")
      return c.json(problem(422, "Invalid mapping"), 422);
    if (result.kind === "proof")
      throw new HTTPException(403, { message: "step_up_unavailable" });
    return c.json(
      mutationResponseSchema.parse({
        data: dto(result.mapping, result.connection),
        configVersion: result.connection.configVersion + 1,
      }),
      201,
    );
  })
  .openapi(patchRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const userId = c.get("userId");
    if (!(await isCurrentInstanceAdmin(userId)))
      throw new HTTPException(403, { message: "Forbidden" });
    await requireCurrentInstanceAdmin(
      c,
      "PATCH",
      "/api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}",
    );
    setShadowLegacyAuthorization(c, "allowed");
    const { id, mappingId } = c.req.valid("param");
    const request = c.req.valid("json");
    const session = c.get("session") as { id: string } | null;
    if (!session) throw new HTTPException(403, { message: "session_required" });
    const [actor] = await getIdentityPersonForUser(userId);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    const traceId = normaliseTraceId(c.req.header("x-request-id"));
    let auditFailed = false;
    const result = await retryIdentityGrantClosure(() =>
      db.transaction(async (tx) => {
        auditFailed = false;
        const [initial] = await getOidcGroupMappingSnapshot(id, mappingId);
        if (!initial) return { kind: "not_found" as const };
        const [connectionSnapshot] = await getIdentityConnection(id);
        if (!connectionSnapshot) return { kind: "not_found" as const };
        const targetScopeId = request.scopeId ?? initial.scopeId;
        await lockScimGrantClosure(tx, {
          connectionId: id,
          sourceKinds: ["oidc_group"],
          actorPersonId: actor.id,
          mappingId,
          proposedRoleId: request.roleId ?? initial.roleId,
          proposedScope: initial.scope,
          proposedScopeId: targetScopeId,
          ...(initial.scope === "organisation"
            ? {
                proposedOrganisationId:
                  connectionSnapshot.organisationId ?? undefined,
              }
            : {}),
        });
        const [connection] = await lockFullIdentityConnection(tx, id);
        const [mapping] = await lockOidcGroupMappingById(tx, id, mappingId);
        if (!connection || !mapping) return { kind: "not_found" as const };
        const [currentActor] = await getCurrentInstanceAdminPersonInTransaction(
          tx,
          userId,
        );
        if (!currentActor || currentActor.id !== actor.id)
          return { kind: "forbidden" as const };
        if (connection.configVersion !== request.configVersion)
          return {
            kind: "conflict" as const,
            version: connection.configVersion,
          };
        const nextScopeId = request.scopeId ?? mapping.scopeId;
        const nextRoleId = request.roleId ?? mapping.roleId;
        if (
          (connection.portalScope === "customer" &&
            request.scopeId !== undefined) ||
          !(await mappingTargetIsValid(tx, connection, {
            scope: mapping.scope as "organisation" | "workspace",
            scopeId: nextScopeId,
            roleId: nextRoleId,
          }))
        )
          return { kind: "invalid" as const };
        const changedFields = [
          ...(request.externalGroupNameSnapshot !== undefined &&
          request.externalGroupNameSnapshot !==
            mapping.externalGroupNameSnapshot
            ? ["externalGroupNameSnapshot"]
            : []),
          ...(nextRoleId !== mapping.roleId ? ["roleId"] : []),
          ...(nextScopeId !== mapping.scopeId ? ["scopeId"] : []),
          ...(request.enabled !== undefined &&
          request.enabled !== mapping.enabled
            ? ["enabled"]
            : []),
        ];
        if (!changedFields.length) return { kind: "invalid" as const };
        const proof = await consumeOidcGroupMappingProof(tx, {
          token: c.req.valid("header")["x-taskdesk-step-up-token"],
          personId: actor.id,
          sessionId: session.id,
          connectionId: id,
          mappingId,
          request: request as OidcGroupMappingUpdateRequest,
          operation: OIDC_GROUP_MAPPING_UPDATE_OPERATION,
        });
        if (!proof) return { kind: "proof" as const };
        const [updated] = await tx
          .update(schema.oidcGroupMappingTable)
          .set({
            externalGroupNameSnapshot:
              request.externalGroupNameSnapshot !== undefined
                ? request.externalGroupNameSnapshot
                : mapping.externalGroupNameSnapshot,
            roleId: nextRoleId,
            scopeId: nextScopeId,
            enabled: request.enabled ?? mapping.enabled,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.oidcGroupMappingTable.id, mappingId),
              eq(schema.oidcGroupMappingTable.identityConnectionId, id),
            ),
          )
          .returning();
        if (!updated) return { kind: "not_found" as const };
        const authorityChanged =
          changedFields.includes("roleId") ||
          changedFields.includes("scopeId") ||
          changedFields.includes("enabled");
        const retiredGrants = authorityChanged
          ? await retireOidcGroupGrants(tx, mappingId)
          : [];
        const personIds = [
          ...new Set(retiredGrants.map(({ personId }) => personId)),
        ];
        const affectedUserIds = personIds.length
          ? [
              ...new Set(
                (await listOidcMappingAffectedUserIds(tx, personIds)).flatMap(
                  ({ userId }) => (userId ? [userId] : []),
                ),
              ),
            ]
          : [];
        const nextVersion = request.configVersion + 1;
        const [versionRow] = await tx
          .update(schema.identityConnectionTable)
          .set({
            configVersion: nextVersion,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(
            and(
              eq(schema.identityConnectionTable.id, id),
              eq(
                schema.identityConnectionTable.configVersion,
                request.configVersion,
              ),
            ),
          )
          .returning({
            configVersion: schema.identityConnectionTable.configVersion,
          });
        if (!versionRow) throw new Error("OIDC mapping version CAS failed");
        const evidenceWritten = await writeMappingEvidence(tx, {
          actorId: userId,
          connectionId: id,
          mappingId,
          changedFields,
          configVersion: nextVersion,
          traceId,
        });
        auditFailed = !evidenceWritten;
        await appendStepUpAudit(tx, {
          action: "auth.step_up_consumed",
          actorId: userId,
          personId: actor.id,
          operation: OIDC_GROUP_MAPPING_UPDATE_OPERATION,
          traceId,
        });
        return {
          kind: "updated" as const,
          mapping: updated,
          connection,
          nextVersion,
          affectedUserIds,
        };
      }),
    );
    if (result.kind === "updated") {
      for (const affectedUserId of result.affectedUserIds) {
        await invalidateNativeAuthorization({ userId: affectedUserId });
      }
    }
    if (auditFailed) await reportAuditFailure();
    if (result.kind === "not_found")
      return c.json(problem(404, "Not found"), 404);
    if (result.kind === "forbidden")
      throw new HTTPException(403, { message: "Forbidden" });
    if (result.kind === "conflict")
      return c.json(
        { ...problem(409, "Version conflict"), currentVersion: result.version },
        409,
      );
    if (result.kind === "invalid")
      return c.json(problem(422, "Invalid mapping"), 422);
    if (result.kind === "proof")
      throw new HTTPException(403, { message: "step_up_unavailable" });
    return c.json(
      mutationResponseSchema.parse({
        data: dto(result.mapping, result.connection),
        configVersion: result.nextVersion,
      }),
      200,
    );
  });

async function writeMappingEvidence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    actorId: string;
    connectionId: string;
    mappingId: string;
    changedFields: string[];
    configVersion: number;
    traceId?: string;
  },
) {
  let auditOk = true;
  try {
    await tx.transaction(async (auditTx) => {
      await appendAuditLog(auditTx, {
        action: "identity_connection.changed",
        actorId: input.actorId,
        actorType: "person",
        traceId: input.traceId,
        workspaceId: null,
        entityType: "identity_connection",
        entityId: input.connectionId,
        after: {
          changes: ["oidcGroupMapping"],
          configVersion: input.configVersion,
        },
      });
    });
  } catch {
    auditOk = false;
  }
  await tx.insert(schema.provisioningEventTable).values({
    identityConnectionId: input.connectionId,
    kind: "group.mapping_changed",
    outcome: "succeeded",
    detail: {
      mappingId: input.mappingId,
      changes: input.changedFields,
      configVersion: input.configVersion,
    },
    actorType: "person",
    traceId: input.traceId ?? null,
  });
  return auditOk;
}

export { routes as oidcGroupMappingAdminRouter };
