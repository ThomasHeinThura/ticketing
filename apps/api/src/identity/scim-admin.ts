import { randomBytes } from "node:crypto";
import {
  DEFAULT_SCIM_PROFILE_MAPPING,
  validateScimAdminRequest,
} from "@taskdesk/domain";
import { isCapability } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { appendStepUpAudit } from "../auth/step-up-audit";
import {
  consumeScimAdminProof,
  consumeScimTokenProof,
  SCIM_TOKEN_REVOKE_OPERATION,
  SCIM_TOKEN_ROTATE_OPERATION,
  sha256,
} from "../auth/step-up-service";
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
import {
  lockScimGrantClosure,
  retireScimGroupGrants,
  retryIdentityGrantClosure,
} from "./membership-projection";

const versionSchema = z.number().int().positive().safe();
function canonicalAllowedResources(
  value: unknown,
): Array<"users" | "groups"> | null {
  if (
    !Array.isArray(value) ||
    value.some((item) => item !== "users" && item !== "groups") ||
    !value.includes("users") ||
    new Set(value).size !== value.length
  )
    return null;
  return ["users", ...(value.includes("groups") ? (["groups"] as const) : [])];
}

const profileMappingSchema = z
  .object({
    version: z.literal(1),
    name: z.enum(["displayName", "name.formatted"]),
    email: z.enum(["emails.primary.value", "userName"]),
    jobTitle: z.enum(["title", "unmapped"]),
    locale: z.enum(["preferredLanguage", "locale", "unmapped"]),
  })
  .strict();
const requestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      configVersion: versionSchema,
      kind: z.literal("settings"),
      enabled: z.boolean().optional(),
      allowedResources: z.array(z.enum(["users", "groups"])).optional(),
      lifecyclePolicy: z
        .enum(["end_memberships", "keep_memberships"])
        .optional(),
    })
    .strict(),
  z
    .object({
      configVersion: versionSchema,
      kind: z.literal("mapping_create"),
      externalGroupId: z.string().min(1).max(255),
      externalGroupNameSnapshot: z.string().max(255).nullable().optional(),
      roleId: z.string().min(1),
      scope: z.enum(["organisation", "workspace"]),
      scopeId: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      configVersion: versionSchema,
      kind: z.literal("mapping_update"),
      mappingId: z.string().min(1),
      externalGroupNameSnapshot: z.string().max(255).nullable().optional(),
      roleId: z.string().min(1).optional(),
      scopeId: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      configVersion: versionSchema,
      kind: z.literal("attribute_mapping"),
      attributeMapping: profileMappingSchema,
    })
    .strict(),
]);
const safeResponseSchema = z.object({
  data: z.object({
    enabled: z.boolean(),
    allowedResources: z.array(z.enum(["users", "groups"])),
    lifecyclePolicy: z.enum(["end_memberships", "keep_memberships"]),
    attributeMapping: profileMappingSchema,
    mappings: z.array(
      z.object({
        id: z.string(),
        externalGroupId: z.string(),
        externalGroupNameSnapshot: z.string().nullable(),
        roleId: z.string(),
        scope: z.enum(["organisation", "workspace"]),
        scopeId: z.string(),
        enabled: z.boolean(),
      }),
    ),
  }),
  configVersion: versionSchema,
});

function error(status: number, message: string) {
  return { type: "about:blank", title: message, status };
}

async function readSafeSettings(connectionId: string) {
  const [row] = await db
    .select({
      id: schema.identityConnectionTable.id,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      configVersion: schema.identityConnectionTable.configVersion,
      enabled: schema.scimConnectionTable.enabled,
      allowedResources: schema.scimConnectionTable.allowedResources,
      lifecyclePolicy: schema.scimConnectionTable.lifecyclePolicy,
      attributeMapping: schema.scimConnectionTable.attributeMapping,
    })
    .from(schema.identityConnectionTable)
    .innerJoin(
      schema.scimConnectionTable,
      eq(
        schema.scimConnectionTable.identityConnectionId,
        schema.identityConnectionTable.id,
      ),
    )
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
  if (!row) return null;
  const allowedResources = canonicalAllowedResources(row.allowedResources);
  if (!allowedResources)
    throw new HTTPException(503, {
      message: "SCIM configuration unavailable",
    });
  const mappings = await db
    .select({
      id: schema.scimGroupMappingTable.id,
      externalGroupId: schema.scimGroupMappingTable.externalGroupId,
      externalGroupNameSnapshot:
        schema.scimGroupMappingTable.externalGroupNameSnapshot,
      roleId: schema.scimGroupMappingTable.roleId,
      scope: schema.scimGroupMappingTable.scope,
      scopeId: schema.scimGroupMappingTable.scopeId,
      enabled: schema.scimGroupMappingTable.enabled,
    })
    .from(schema.scimGroupMappingTable)
    .where(eq(schema.scimGroupMappingTable.scimConnectionId, connectionId))
    .orderBy(
      schema.scimGroupMappingTable.externalGroupId,
      schema.scimGroupMappingTable.id,
    );
  const resolvedMappings = mappings.map((mapping) => ({
    ...mapping,
    scopeId:
      row.portalScope === "customer" && mapping.scope === "organisation"
        ? (row.organisationId ?? "")
        : mapping.scopeId,
  }));
  return safeResponseSchema.parse({
    data: {
      enabled: row.enabled,
      allowedResources,
      lifecyclePolicy: row.lifecyclePolicy,
      attributeMapping: row.attributeMapping ?? DEFAULT_SCIM_PROFILE_MAPPING,
      mappings: resolvedMappings,
    },
    configVersion: row.configVersion,
  });
}

export async function validateScimMappingRole(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    portalScope: string;
    organisationId: string | null;
    maxRoleRank: number | null;
    scope: "organisation" | "workspace";
    scopeId?: string;
    roleId: string;
  },
) {
  if (input.portalScope === "customer") {
    if (input.scope !== "organisation" || !input.organisationId) return false;
    const [org] = await tx
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(
        and(
          eq(schema.organisationTable.id, input.organisationId),
          eq(schema.organisationTable.active, true),
          eq(schema.organisationTable.portalAccess, true),
          eq(schema.organisationTable.isInternal, false),
          sql`${schema.organisationTable.deletedAt} is null`,
        ),
      )
      .limit(1);
    if (!org) return false;
  } else if (input.portalScope === "agent") {
    if (
      input.scope !== "workspace" ||
      !input.scopeId ||
      input.maxRoleRank === null
    )
      return false;
    const [workspace] = await tx
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .innerJoin(
        schema.organisationTable,
        eq(schema.organisationTable.id, schema.workspaceTable.organisationId),
      )
      .where(
        and(
          eq(schema.workspaceTable.id, input.scopeId),
          sql`${schema.workspaceTable.deletedAt} is null`,
          eq(schema.organisationTable.isInternal, true),
          eq(schema.organisationTable.active, true),
          sql`${schema.organisationTable.deletedAt} is null`,
        ),
      )
      .limit(1);
    if (!workspace) return false;
  } else return false;

  const [role] = await tx
    .select({
      scope: schema.roleTable.scope,
      roleKey: schema.roleTable.key,
      rank: schema.roleTable.rank,
      capabilities: schema.roleTable.capabilities,
      workspaceId: schema.roleTable.workspaceId,
    })
    .from(schema.roleTable)
    .where(eq(schema.roleTable.id, input.roleId))
    .limit(1);
  if (!role || role.scope !== input.scope) return false;
  if (input.portalScope === "customer") return role.roleKey === "customer";
  if (input.maxRoleRank === null || role.rank > input.maxRoleRank) return false;
  if (role.workspaceId !== null && role.workspaceId !== input.scopeId)
    return false;
  if (
    !Array.isArray(role.capabilities) ||
    !role.capabilities.every(
      (capability): capability is string =>
        typeof capability === "string" && isCapability(capability),
    )
  )
    return false;
  const capabilities = role.capabilities;
  return !capabilities.some(
    (capability) =>
      typeof capability === "string" &&
      (capability === "instance:admin" || capability.startsWith("instance:")),
  );
}

const getRoute = createRoute({
  method: "get",
  operationId: "getScimAdministration",
  path: "/identity-connections/{id}/scim",
  tags: ["Instance"],
  summary: "Get safe SCIM connection settings",
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: jsonResponse("Safe SCIM configuration", safeResponseSchema),
    404: jsonResponse(
      "Not found",
      z.object({ type: z.string(), title: z.string(), status: z.number() }),
    ),
    503: jsonResponse(
      "Stored SCIM configuration unavailable",
      z.object({ message: z.string() }),
    ),
  },
});

const patchRoute = createRoute({
  method: "patch",
  operationId: "patchScimAdministration",
  path: "/identity-connections/{id}/scim",
  tags: ["Instance"],
  summary: "Update SCIM settings or group/profile mapping",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ id: z.string().min(1) }),
    headers: z.object({
      "x-taskdesk-step-up-token": z.string().min(1).max(128),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: requestSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated safe SCIM configuration", safeResponseSchema),
    403: jsonResponse(
      "Forbidden",
      z.object({ type: z.string(), title: z.string(), status: z.number() }),
    ),
    404: jsonResponse(
      "Not found",
      z.object({ type: z.string(), title: z.string(), status: z.number() }),
    ),
    409: jsonResponse(
      "Conflict",
      z.object({
        type: z.string(),
        title: z.string(),
        status: z.number(),
        currentVersion: versionSchema.optional(),
      }),
    ),
    422: jsonResponse(
      "Invalid or no-op configuration",
      z.object({ type: z.string(), title: z.string(), status: z.number() }),
    ),
  },
});

const tokenOperationRequest = z.object({ version: versionSchema }).strict();
const tokenRotateRoute = createRoute({
  method: "post",
  operationId: "rotateScimToken",
  path: "/identity-connections/{id}/scim/rotate-token",
  tags: ["Instance"],
  summary: "Rotate the SCIM bearer token",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ id: z.string().min(1) }),
    headers: z.object({
      "x-taskdesk-step-up-token": z.string().min(1).max(128),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: tokenOperationRequest } },
    },
  },
  responses: {
    200: jsonResponse(
      "New SCIM bearer token, returned once",
      z.object({
        configVersion: versionSchema,
        token: z.string().length(43),
        tokenRotatedAt: z.string().datetime(),
      }),
    ),
    403: jsonResponse("Step-up unavailable", z.object({ message: z.string() })),
    404: jsonResponse(
      "Connection unavailable",
      z.object({ message: z.string() }),
    ),
    409: jsonResponse(
      "Configuration changed",
      z.object({ message: z.string(), currentVersion: versionSchema }),
    ),
    422: jsonResponse(
      "Token operation is unavailable",
      z.object({ message: z.string() }),
    ),
  },
});
const tokenRevokeRoute = createRoute({
  method: "post",
  operationId: "revokeScimToken",
  path: "/identity-connections/{id}/scim/revoke-token",
  tags: ["Instance"],
  summary: "Revoke the SCIM bearer token",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ id: z.string().min(1) }),
    headers: z.object({
      "x-taskdesk-step-up-token": z.string().min(1).max(128),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: tokenOperationRequest } },
    },
  },
  responses: {
    200: jsonResponse(
      "SCIM bearer token revoked",
      z.object({ configVersion: versionSchema, revoked: z.literal(true) }),
    ),
    403: jsonResponse("Step-up unavailable", z.object({ message: z.string() })),
    404: jsonResponse(
      "Connection unavailable",
      z.object({ message: z.string() }),
    ),
    409: jsonResponse(
      "Configuration changed",
      z.object({ message: z.string(), currentVersion: versionSchema }),
    ),
    422: jsonResponse(
      "Token operation is unavailable",
      z.object({ message: z.string() }),
    ),
  },
});

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "GET",
      "/api/instance/identity-connections/{id}/scim",
    );
    setShadowLegacyAuthorization(c, "allowed");
    const { id } = c.req.valid("param");
    const response = await readSafeSettings(id);
    if (!response) return c.json(error(404, "Not found"), 404);
    c.header("Cache-Control", "no-store");
    return c.json(response, 200);
  })
  .openapi(patchRoute, async (c) => {
    const userId = c.get("userId");
    if (!(await isCurrentInstanceAdmin(userId))) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    await requireCurrentInstanceAdmin(
      c,
      "PATCH",
      "/api/instance/identity-connections/{id}/scim",
    );
    setShadowLegacyAuthorization(c, "allowed");
    const { id } = c.req.valid("param");
    const validated = validateScimAdminRequest(c.req.valid("json"));
    if (!validated.ok) return c.json(error(422, "Invalid request"), 422);
    const session = c.get("session") as { id: string } | null;
    if (!session) throw new HTTPException(403, { message: "Session required" });
    const traceId = normaliseTraceId(c.req.header("x-request-id"));
    const [actor] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1);
    if (!actor) throw new HTTPException(403, { message: "Forbidden" });
    let auditFailed = false;
    const result = await retryIdentityGrantClosure(() =>
      db.transaction(async (tx) => {
        auditFailed = false;
        await lockScimGrantClosure(tx, {
          connectionId: id,
          actorPersonId: actor.id,
          ...(validated.value.kind === "mapping_create"
            ? {
                proposedRoleId: validated.value.roleId,
                proposedScope: validated.value.scope,
                ...(validated.value.scopeId
                  ? { proposedScopeId: validated.value.scopeId }
                  : {}),
              }
            : validated.value.kind === "mapping_update"
              ? {
                  mappingId: validated.value.mappingId,
                  ...(validated.value.roleId
                    ? { proposedRoleId: validated.value.roleId }
                    : {}),
                  ...(validated.value.scopeId
                    ? { proposedScopeId: validated.value.scopeId }
                    : {}),
                }
              : {}),
        });
        const [connection] = await tx
          .select()
          .from(schema.identityConnectionTable)
          .where(eq(schema.identityConnectionTable.id, id))
          .for("update")
          .limit(1);
        const [scim] = await tx
          .select()
          .from(schema.scimConnectionTable)
          .where(eq(schema.scimConnectionTable.identityConnectionId, id))
          .for("update")
          .limit(1);
        if (!connection || !scim) return { kind: "not_found" as const };
        if (connection.configVersion !== validated.value.configVersion)
          return {
            kind: "conflict" as const,
            version: connection.configVersion,
          };

        const changedKeys: string[] = [];
        let mappingEventDetail: Record<string, unknown> | undefined;
        if (validated.value.kind === "settings") {
          const currentAllowed = canonicalAllowedResources(
            scim.allowedResources,
          );
          if (!currentAllowed)
            return {
              kind: "invalid" as const,
              message: "Stored SCIM configuration is invalid",
            };
          const nextEnabled = validated.value.enabled ?? scim.enabled;
          const nextAllowed =
            validated.value.allowedResources ?? currentAllowed;
          const nextPolicy =
            validated.value.lifecyclePolicy ?? scim.lifecyclePolicy;
          if (nextEnabled && !scim.tokenHash)
            return {
              kind: "invalid" as const,
              message: "A token must be configured before enabling SCIM",
            };
          if (
            nextEnabled === scim.enabled &&
            JSON.stringify(nextAllowed) === JSON.stringify(currentAllowed) &&
            nextPolicy === scim.lifecyclePolicy
          )
            return { kind: "invalid" as const, message: "No changes" };
          const removesScimGrantEligibility =
            (!nextEnabled && scim.enabled) ||
            (currentAllowed.includes("groups") &&
              !nextAllowed.includes("groups"));
          if (removesScimGrantEligibility) {
            await retireScimGroupGrants(tx, {
              connectionId: id,
              reason: !nextEnabled ? "connection_disabled" : "mapping_changed",
            });
          }
          if (nextEnabled !== scim.enabled) changedKeys.push("enabled");
          if (JSON.stringify(nextAllowed) !== JSON.stringify(currentAllowed))
            changedKeys.push("allowedResources");
          if (nextPolicy !== scim.lifecyclePolicy)
            changedKeys.push("lifecyclePolicy");
          await tx
            .update(schema.scimConnectionTable)
            .set({
              enabled: nextEnabled,
              allowedResources: [...nextAllowed],
              lifecyclePolicy: nextPolicy,
            })
            .where(eq(schema.scimConnectionTable.identityConnectionId, id));
        } else if (validated.value.kind === "attribute_mapping") {
          const current = scim.attributeMapping ?? DEFAULT_SCIM_PROFILE_MAPPING;
          if (
            JSON.stringify(current) ===
            JSON.stringify(validated.value.attributeMapping)
          )
            return { kind: "invalid" as const, message: "No changes" };
          changedKeys.push("attributeMapping");
          await tx
            .update(schema.scimConnectionTable)
            .set({
              attributeMapping: validated.value.attributeMapping,
            })
            .where(eq(schema.scimConnectionTable.identityConnectionId, id));
        } else if (validated.value.kind === "mapping_create") {
          const map = validated.value;
          if (
            connection.portalScope === "customer" &&
            map.scopeId !== undefined
          )
            return {
              kind: "invalid" as const,
              message: "Customer mapping scope is selected by its connection",
            };
          const scopeId =
            connection.portalScope === "customer"
              ? (connection.organisationId ?? undefined)
              : map.scopeId;
          if (
            !(await validateScimMappingRole(tx, {
              portalScope: connection.portalScope,
              organisationId: connection.organisationId,
              maxRoleRank: connection.maxRoleRank,
              scope: map.scope,
              scopeId,
              roleId: map.roleId,
            }))
          )
            return {
              kind: "invalid" as const,
              message: "Invalid mapping target or role",
            };
          const duplicate = await tx
            .select({ id: schema.scimGroupMappingTable.id })
            .from(schema.scimGroupMappingTable)
            .where(
              and(
                eq(schema.scimGroupMappingTable.scimConnectionId, id),
                eq(
                  schema.scimGroupMappingTable.externalGroupId,
                  map.externalGroupId,
                ),
              ),
            )
            .limit(1);
          if (duplicate.length) return { kind: "duplicate" as const };
          await tx.insert(schema.scimGroupMappingTable).values({
            scimConnectionId: id,
            externalGroupId: map.externalGroupId,
            externalGroupNameSnapshot: map.externalGroupNameSnapshot ?? null,
            roleId: map.roleId,
            scope: map.scope,
            scopeId: scopeId ?? "",
            enabled: map.enabled,
            createdBy:
              (
                await tx
                  .select({ id: schema.personTable.id })
                  .from(schema.personTable)
                  .where(eq(schema.personTable.userId, userId))
                  .limit(1)
              )[0]?.id ?? null,
          });
          mappingEventDetail = {
            externalGroupId: map.externalGroupId,
            roleId: map.roleId,
            scope: map.scope,
            scopeId: scopeId ?? "",
          };
          changedKeys.push("groupMapping");
        } else {
          const map = validated.value;
          const [existing] = await tx
            .select()
            .from(schema.scimGroupMappingTable)
            .where(
              and(
                eq(schema.scimGroupMappingTable.id, map.mappingId),
                eq(schema.scimGroupMappingTable.scimConnectionId, id),
              ),
            )
            .for("update")
            .limit(1);
          if (!existing) return { kind: "not_found" as const };
          const roleId = map.roleId ?? existing.roleId;
          if (
            connection.portalScope === "customer" &&
            (existing.scopeId !== connection.organisationId ||
              (map.scopeId !== undefined &&
                map.scopeId !== connection.organisationId))
          )
            return {
              kind: "invalid" as const,
              message: "Customer mapping scope is selected by its connection",
            };
          const scopeId =
            connection.portalScope === "customer"
              ? (connection.organisationId ?? "")
              : (map.scopeId ?? existing.scopeId);
          if (
            !(await validateScimMappingRole(tx, {
              portalScope: connection.portalScope,
              organisationId: connection.organisationId,
              maxRoleRank: connection.maxRoleRank,
              scope: existing.scope as "organisation" | "workspace",
              scopeId,
              roleId,
            }))
          )
            return {
              kind: "invalid" as const,
              message: "Invalid mapping target or role",
            };
          const patch = {
            roleId,
            scopeId,
            externalGroupNameSnapshot:
              map.externalGroupNameSnapshot === undefined
                ? existing.externalGroupNameSnapshot
                : map.externalGroupNameSnapshot,
            enabled: map.enabled ?? existing.enabled,
            updatedAt: new Date(),
          };
          if (
            patch.roleId === existing.roleId &&
            patch.scopeId === existing.scopeId &&
            patch.externalGroupNameSnapshot ===
              existing.externalGroupNameSnapshot &&
            patch.enabled === existing.enabled
          )
            return { kind: "invalid" as const, message: "No changes" };
          const mappingChangedFields: string[] = [];
          if (patch.roleId !== existing.roleId)
            mappingChangedFields.push("roleId");
          if (patch.scopeId !== existing.scopeId)
            mappingChangedFields.push("scopeId");
          if (
            patch.externalGroupNameSnapshot !==
            existing.externalGroupNameSnapshot
          )
            mappingChangedFields.push("externalGroupNameSnapshot");
          if (patch.enabled !== existing.enabled)
            mappingChangedFields.push("enabled");
          if (
            (patch.roleId !== existing.roleId ||
              patch.scopeId !== existing.scopeId) &&
            existing.enabled
          ) {
            await retireScimGroupGrants(tx, {
              mappingIds: [existing.id],
              reason: "mapping_changed",
            });
          } else if (existing.enabled && !patch.enabled) {
            await retireScimGroupGrants(tx, {
              mappingIds: [existing.id],
              reason: "mapping_disabled",
            });
          }
          await tx
            .update(schema.scimGroupMappingTable)
            .set(patch)
            .where(eq(schema.scimGroupMappingTable.id, existing.id));
          mappingEventDetail = {
            mappingId: existing.id,
            roleId: patch.roleId,
            scope: existing.scope,
            scopeId: patch.scopeId,
            enabled: patch.enabled,
          };
          changedKeys.push(...mappingChangedFields);
        }

        await tx
          .update(schema.identityConnectionTable)
          .set({
            configVersion: sql`${schema.identityConnectionTable.configVersion} + 1`,
            updatedAt: new Date(),
            updatedBy:
              (
                await tx
                  .select({ id: schema.personTable.id })
                  .from(schema.personTable)
                  .where(eq(schema.personTable.userId, userId))
                  .limit(1)
              )[0]?.id ?? null,
          })
          .where(
            and(
              eq(schema.identityConnectionTable.id, id),
              eq(
                schema.identityConnectionTable.configVersion,
                validated.value.configVersion,
              ),
            ),
          );
        const [updated] = await tx
          .select({ version: schema.identityConnectionTable.configVersion })
          .from(schema.identityConnectionTable)
          .where(eq(schema.identityConnectionTable.id, id))
          .limit(1);
        if (!updated) return { kind: "not_found" as const };
        try {
          await tx.transaction(async (auditTx) => {
            await appendAuditLog(auditTx, {
              action: "identity_connection.changed",
              actorId: userId,
              actorType: "person",
              traceId,
              workspaceId: null,
              entityType: "identity_connection",
              entityId: id,
              after: { changes: changedKeys, configVersion: updated.version },
            });
          });
        } catch {
          auditFailed = true;
        }
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: id,
          scimConnectionId: id,
          kind: mappingEventDetail
            ? "group.mapping_changed"
            : "connection.changed",
          outcome: "succeeded",
          detail: {
            changes: changedKeys,
            configVersion: updated.version,
            ...(mappingEventDetail ?? {}),
          },
          actorType: "person",
          traceId,
        });
        const proof = await consumeScimAdminProof(tx, {
          token: c.req.valid("header")["x-taskdesk-step-up-token"],
          personId:
            (
              await tx
                .select({ id: schema.personTable.id })
                .from(schema.personTable)
                .where(eq(schema.personTable.userId, userId))
                .limit(1)
            )[0]?.id ?? "",
          sessionId: session.id,
          connectionId: id,
          request: validated.value,
        });
        if (!proof)
          throw new HTTPException(403, { message: "step_up_unavailable" });
        await appendStepUpAudit(tx, {
          action: "auth.step_up_consumed",
          actorId: userId,
          personId:
            (
              await tx
                .select({ id: schema.personTable.id })
                .from(schema.personTable)
                .where(eq(schema.personTable.userId, userId))
                .limit(1)
            )[0]?.id ?? "",
          operation: "scim_admin_update",
          traceId,
        });
        return { kind: "updated" as const };
      }),
    );

    if (result.kind === "not_found")
      return c.json(error(404, "Not found"), 404);
    if (result.kind === "conflict")
      return c.json(
        { ...error(409, "Version conflict"), currentVersion: result.version },
        409,
      );
    if (result.kind === "duplicate")
      return c.json(error(409, "Duplicate group mapping"), 409);
    if (result.kind === "invalid")
      return c.json(error(422, result.message), 422);
    if (auditFailed) {
      recordAuditWriteFailure("mutation");
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    }
    c.header("Cache-Control", "no-store");
    const response = await readSafeSettings(id);
    if (!response) return c.json(error(404, "Not found"), 404);
    return c.json(response, 200);
  })
  .openapi(tokenRotateRoute, async (c) => {
    const result = await mutateScimToken(
      c,
      SCIM_TOKEN_ROTATE_OPERATION,
      c.req.valid("param"),
      c.req.valid("json"),
      c.req.valid("header"),
    );
    if (result.kind === "not_found")
      return c.json({ message: "Connection unavailable" }, 404);
    if (result.kind === "conflict")
      return c.json(
        { message: "version_conflict", currentVersion: result.version },
        409,
      );
    if (result.kind === "invalid")
      return c.json({ message: "SCIM token is unavailable" }, 422);
    if (result.kind !== "rotated")
      throw new HTTPException(500, { message: "SCIM token operation failed" });
    return c.json(
      {
        configVersion: result.version,
        token: result.token,
        tokenRotatedAt: result.rotatedAt,
      },
      200,
    );
  })
  .openapi(tokenRevokeRoute, async (c) => {
    const result = await mutateScimToken(
      c,
      SCIM_TOKEN_REVOKE_OPERATION,
      c.req.valid("param"),
      c.req.valid("json"),
      c.req.valid("header"),
    );
    if (result.kind === "not_found")
      return c.json({ message: "Connection unavailable" }, 404);
    if (result.kind === "conflict")
      return c.json(
        { message: "version_conflict", currentVersion: result.version },
        409,
      );
    if (result.kind === "invalid")
      return c.json({ message: "SCIM token is already revoked" }, 422);
    return c.json(
      { configVersion: result.version, revoked: true as const },
      200,
    );
  });

async function mutateScimToken(
  c: Context,
  operation:
    | typeof SCIM_TOKEN_ROTATE_OPERATION
    | typeof SCIM_TOKEN_REVOKE_OPERATION,
  params: { id: string },
  body: { version: number },
  headers: Record<string, string>,
): Promise<
  | { kind: "not_found" }
  | { kind: "conflict"; version: number }
  | { kind: "invalid" }
  | { kind: "rotated"; version: number; token: string; rotatedAt: string }
  | { kind: "revoked"; version: number }
> {
  const userId = c.get("userId");
  if (!(await isCurrentInstanceAdmin(userId)))
    throw new HTTPException(403, { message: "Forbidden" });
  const method = "POST";
  const path =
    operation === SCIM_TOKEN_ROTATE_OPERATION
      ? "/api/instance/identity-connections/{id}/scim/rotate-token"
      : "/api/instance/identity-connections/{id}/scim/revoke-token";
  await requireCurrentInstanceAdmin(c, method, path);
  setShadowLegacyAuthorization(c, "allowed");
  const { id } = params;
  const { version } = body;
  const sessionValue = c.get("session");
  const session =
    typeof sessionValue === "object" &&
    sessionValue !== null &&
    "id" in sessionValue &&
    typeof sessionValue.id === "string"
      ? { id: sessionValue.id }
      : null;
  if (!session) throw new HTTPException(403, { message: "Session required" });
  const traceId = normaliseTraceId(c.req.header("x-request-id"));
  const rawToken =
    operation === SCIM_TOKEN_ROTATE_OPERATION
      ? randomBytes(32).toString("base64url")
      : null;
  let auditFailed = false;
  const result = await db.transaction(async (tx) => {
    const [connection] = await tx
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, id))
      .for("update")
      .limit(1);
    const [scim] = await tx
      .select()
      .from(schema.scimConnectionTable)
      .where(eq(schema.scimConnectionTable.identityConnectionId, id))
      .for("update")
      .limit(1);
    if (!connection || !scim) return { kind: "not_found" as const };
    if (connection.configVersion !== version)
      return { kind: "conflict" as const, version: connection.configVersion };
    if (operation === SCIM_TOKEN_REVOKE_OPERATION && !scim.tokenHash)
      return { kind: "invalid" as const };
    const [person] = await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1);
    if (!person)
      throw new HTTPException(403, { message: "step_up_unavailable" });
    const proof = await consumeScimTokenProof(tx, {
      token: headers["x-taskdesk-step-up-token"] as string,
      personId: person.id,
      sessionId: session.id,
      connectionId: id,
      version,
      operation,
    });
    if (!proof)
      throw new HTTPException(403, { message: "step_up_unavailable" });
    const nextVersion = version + 1;
    const now = new Date();
    await tx
      .update(schema.scimConnectionTable)
      .set(
        operation === SCIM_TOKEN_ROTATE_OPERATION
          ? {
              enabled: false,
              tokenHash: sha256(rawToken as string),
              tokenPrefix: (rawToken as string).slice(0, 8),
              tokenCreatedAt: scim.tokenCreatedAt ?? now,
              tokenRotatedAt: now,
            }
          : {
              enabled: false,
              tokenHash: null,
              tokenPrefix: null,
              tokenRotatedAt: now,
            },
      )
      .where(eq(schema.scimConnectionTable.identityConnectionId, id));
    await tx
      .update(schema.identityConnectionTable)
      .set({
        configVersion: nextVersion,
        updatedAt: now,
        updatedBy: person.id,
      })
      .where(
        and(
          eq(schema.identityConnectionTable.id, id),
          eq(schema.identityConnectionTable.configVersion, version),
        ),
      );
    try {
      await tx.transaction(async (auditTx) => {
        await appendAuditLog(auditTx, {
          action: "identity_connection.changed",
          actorId: userId,
          actorType: "person",
          traceId,
          workspaceId: null,
          entityType: "identity_connection",
          entityId: id,
          after: {
            changes: ["scimToken", "enabled"],
            configVersion: nextVersion,
          },
        });
      });
    } catch {
      auditFailed = true;
    }
    await tx.insert(schema.provisioningEventTable).values({
      identityConnectionId: id,
      scimConnectionId: id,
      kind:
        operation === SCIM_TOKEN_ROTATE_OPERATION
          ? "token.rotated"
          : "token.revoked",
      outcome: "succeeded",
      detail: { configVersion: nextVersion },
      actorType: "person",
      traceId,
    });
    await appendStepUpAudit(tx, {
      action: "auth.step_up_consumed",
      actorId: userId,
      personId: person.id,
      operation,
      traceId,
    });
    return {
      kind: "updated" as const,
      version: nextVersion,
      rotatedAt: now.toISOString(),
    };
  });
  if (result.kind !== "updated") return result;
  if (auditFailed) {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
  c.header("Cache-Control", "no-store");
  return operation === SCIM_TOKEN_ROTATE_OPERATION
    ? {
        kind: "rotated",
        version: result.version,
        token: rawToken as string,
        rotatedAt: result.rotatedAt,
      }
    : { kind: "revoked", version: result.version };
}

export default routes;
