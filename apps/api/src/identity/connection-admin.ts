import { createId } from "@paralleldrive/cuid2";
import {
  DEFAULT_IDENTITY_CLAIM_MAPPING,
  parseIdentityClaimMapping,
  parseIdentityJitPolicy,
} from "@taskdesk/domain";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { appendStepUpAudit } from "../auth/step-up-audit";
import {
  consumeIdentityConnectionProof,
  IDENTITY_CONNECTION_CONFIGURE_OPERATION,
  IDENTITY_CONNECTION_CREATE_OPERATION,
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
import { requireSessionOnly } from "../utils/require-session-only";
import { invalidateNativeAuthorization } from "../ws";
import { encryptIdentityClientSecret } from "./client-secret";
import {
  type IdentityConnectionConfigureRequest,
  type IdentityConnectionCreateRequest,
  identityConnectionConfigureRequestSchema,
  identityConnectionCreateRequestSchema,
} from "./connection-contract";
import {
  lockScimGrantClosure,
  retireConnectionGrantSources,
  retireConnectionGrantsAboveRoleRank,
  retireConnectionJitGrants,
  retryIdentityGrantClosure,
} from "./membership-projection";
import { loadEntraDiscovery } from "./oidc-provider";
import {
  findIdentityConnectionForOrganisation,
  getIdentityConnection,
  getIdentityConnectionConfiguration,
  getIdentityConnectionIdForOrganisation,
  getIdentityConnectionPresence,
  getIdentityPersonForUser,
  getOrganisationPresence,
  getWorkspaceOrganisation,
  listIdentityConnectionEvents,
  listIdentityConnections,
  listIdentityDomainBindings,
  lockActiveInternalWorkspace,
  lockCustomerOrganisation,
  lockIdentityConnection,
  lockIdentityDefaultRole,
} from "./repository";

const connectionShape = z.object({
  id: z.string(),
  providerType: z.literal("entra"),
  portalScope: z.enum(["agent", "customer"]),
  organisationId: z.string().nullable(),
  defaultWorkspaceId: z.string().nullable(),
  displayName: z.string(),
  issuer: z.string(),
  tenantId: z.string().nullable(),
  clientId: z.string(),
  clientSecretConfigured: z.boolean(),
  redirectUri: z.string(),
  scopes: z.array(z.string()),
  claimMapping: z
    .object({ version: z.literal(1), displayName: z.literal("name") })
    .nullable(),
  claimMappingState: z.enum(["default", "valid", "invalid"]),
  domainBindings: z.array(z.string()),
  jitPolicy: z.object({
    enabled: z.boolean(),
    default_role_id: z.string().nullable(),
    required_entra_app_role: z.string().min(1),
  }),
  maxRoleRank: z.number().nullable(),
  mfaUpstreamMode: z.enum(["claim", "static", "off"]),
  enabled: z.boolean(),
  configVersion: z.number().int().positive(),
  healthState: z.enum(["unknown", "healthy", "degraded", "invalid"]),
  healthCheckedAt: z.string().nullable(),
});

const connectionListRoute = createRoute({
  method: "get",
  path: "/identity-connections",
  operationId: "listIdentityConnections",
  tags: ["Identity connections"],
  summary: "List configured identity connections without secret material",
  responses: {
    200: jsonResponse(
      "Identity connections",
      z.object({ data: z.array(connectionShape) }),
    ),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    503: jsonResponse(
      "Stored identity configuration is invalid",
      z.object({ message: z.string() }),
    ),
  },
});

const eventKinds = [
  "user.created",
  "user.updated",
  "user.deactivated",
  "user.reactivated",
  "group.directory_changed",
  "group.mapping_changed",
  "group.member_added",
  "group.member_removed",
  "request.denied",
  "auth.failed",
  "token.rotated",
  "token.revoked",
  "connection.changed",
  "sync.failed",
] as const;

const eventHistoryLimit = z.coerce.number().int().min(1).max(100).default(25);
const eventHistoryQuery = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: eventHistoryLimit,
  })
  .strict();
const eventSummary = z.object({
  kind: z.enum(eventKinds),
  outcome: z.string().min(1).max(64),
  actorType: z.enum(["person", "scim", "oidc"]),
  createdAt: z.string().datetime(),
});
const eventHistoryRoute = createRoute({
  method: "get",
  path: "/identity-connections/{id}/events",
  operationId: "listIdentityConnectionEvents",
  tags: ["Identity connections"],
  summary: "List safe provisioning event summaries for an identity connection",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    query: eventHistoryQuery,
  },
  responses: {
    200: jsonResponse(
      "Provisioning event summaries",
      z.object({
        data: z.array(eventSummary),
        page: z.object({
          nextCursor: z.string().nullable(),
          hasMore: z.boolean(),
        }),
      }),
    ),
    400: jsonResponse(
      "Invalid cursor or limit",
      z.object({ message: z.string() }),
    ),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    404: jsonResponse(
      "Connection unavailable",
      z.object({ message: z.string() }),
    ),
  },
});

type EventHistoryCursor = {
  v: 1;
  connectionId: string;
  /** PostgreSQL UTC timestamp with six fractional digits, preserving the ordering key. */
  createdAt: string;
  id: string;
};

function encodeEventHistoryCursor(cursor: EventHistoryCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeEventHistoryCursor(
  value: string | undefined,
  connectionId: string,
): EventHistoryCursor | null | false {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) return false;
    const candidate: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return false;
    const cursor = candidate as Record<string, unknown>;
    if (
      Object.keys(cursor).sort().join(",") !== "connectionId,createdAt,id,v" ||
      cursor.v !== 1 ||
      cursor.connectionId !== connectionId ||
      typeof cursor.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(
        cursor.createdAt,
      ) ||
      typeof cursor.id !== "string" ||
      cursor.id.length < 1 ||
      cursor.id.length > 128
    )
      return false;
    const createdAt = new Date(cursor.createdAt);
    const parsed: EventHistoryCursor = {
      v: 1,
      connectionId,
      createdAt: cursor.createdAt,
      id: cursor.id,
    };
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString().slice(0, 23) !== cursor.createdAt.slice(0, 23) ||
      encodeEventHistoryCursor(parsed) !== value
    )
      return false;
    return parsed;
  } catch {
    return false;
  }
}

const organisationIdentityRoute = createRoute({
  method: "get",
  path: "/organisations/{id}/identity",
  operationId: "getOrganisationIdentityConnection",
  tags: ["Identity connections"],
  summary: "Read the configured identity connection for an organisation",
  request: { params: z.object({ id: z.string().min(1).max(128) }) },
  responses: {
    200: jsonResponse(
      "Organisation identity connection",
      z.object({ data: connectionShape.nullable() }),
    ),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    404: jsonResponse(
      "Organisation not found",
      z.object({ message: z.string() }),
    ),
    503: jsonResponse(
      "Stored identity configuration is invalid",
      z.object({ message: z.string() }),
    ),
  },
});

const operationHeader = z.object({
  "x-taskdesk-step-up-token": z.string().min(1).max(128),
});

const createConnectionRoute = createRoute({
  method: "post",
  path: "/identity-connections",
  operationId: "createIdentityConnection",
  tags: ["Identity connections"],
  summary: "Create a disabled Entra identity connection",
  middleware: [requireSessionOnly()] as const,
  request: {
    headers: operationHeader,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: identityConnectionCreateRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      "Created identity connection",
      z.object({ data: connectionShape }),
    ),
    403: jsonResponse(
      "Forbidden or step-up unavailable",
      z.object({ message: z.string() }),
    ),
    409: jsonResponse(
      "Identity connection already exists",
      z.object({ message: z.string() }),
    ),
    422: jsonResponse(
      "Invalid identity configuration",
      z.object({ message: z.string() }),
    ),
  },
});

const configureConnectionRoute = createRoute({
  method: "patch",
  path: "/identity-connections/{id}",
  operationId: "configureIdentityConnection",
  tags: ["Identity connections"],
  summary: "Update identity connection configuration with versioned step-up",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    headers: operationHeader,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: identityConnectionConfigureRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated identity connection",
      z.object({ data: connectionShape }),
    ),
    403: jsonResponse(
      "Forbidden or step-up unavailable",
      z.object({ message: z.string() }),
    ),
    404: jsonResponse(
      "Connection unavailable",
      z.object({ message: z.string() }),
    ),
    409: jsonResponse(
      "Configuration changed",
      z.object({ message: z.string(), currentVersion: z.number() }),
    ),
    422: jsonResponse(
      "Invalid identity configuration",
      z.object({ message: z.string() }),
    ),
  },
});

type ConnectionProjection = {
  id: string;
  providerType: string;
  portalScope: string;
  organisationId: string | null;
  defaultWorkspaceId: string | null;
  displayName: string;
  issuer: string;
  tenantId: string | null;
  clientId: string;
  clientSecret: Buffer;
  redirectUri: string;
  scopes: string[];
  claimMapping: unknown;
  domainBindings: string[];
  jitPolicy: unknown;
  maxRoleRank: number | null;
  mfaUpstreamMode: string;
  enabled: boolean;
  configVersion: number;
  healthState: string;
  healthCheckedAt: Date | null;
};

function toSafeConnection(row: ConnectionProjection) {
  const mapping = parseIdentityClaimMapping(row.claimMapping);
  const jitPolicy = parseIdentityJitPolicy(row.jitPolicy);
  if (
    row.providerType !== "entra" ||
    (row.portalScope !== "agent" && row.portalScope !== "customer") ||
    (row.healthState !== "unknown" &&
      row.healthState !== "healthy" &&
      row.healthState !== "degraded" &&
      row.healthState !== "invalid") ||
    (row.mfaUpstreamMode !== "claim" &&
      row.mfaUpstreamMode !== "static" &&
      row.mfaUpstreamMode !== "off") ||
    !jitPolicy.ok
  )
    throw new HTTPException(503, {
      message: "Identity configuration unavailable",
    });
  return connectionShape.parse({
    id: row.id,
    providerType: "entra",
    portalScope: row.portalScope,
    organisationId: row.organisationId,
    defaultWorkspaceId: row.defaultWorkspaceId,
    displayName: row.displayName,
    issuer: row.issuer,
    tenantId: row.tenantId,
    clientId: row.clientId,
    clientSecretConfigured: row.clientSecret.length > 0,
    redirectUri: row.redirectUri,
    scopes: row.scopes,
    claimMapping: mapping.ok ? mapping.value : null,
    claimMappingState:
      row.claimMapping === null ? "default" : mapping.ok ? "valid" : "invalid",
    domainBindings: row.domainBindings,
    jitPolicy: {
      enabled: jitPolicy.value.enabled,
      default_role_id: jitPolicy.value.default_role_id,
      required_entra_app_role: jitPolicy.value.required_entra_app_role,
    },
    maxRoleRank: row.maxRoleRank,
    mfaUpstreamMode: row.mfaUpstreamMode,
    enabled: row.enabled,
    configVersion: row.configVersion,
    healthState: row.healthState,
    healthCheckedAt: row.healthCheckedAt?.toISOString() ?? null,
  });
}

type ConnectionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

async function lockIdentityDomainBindings(tx: ConnectionTransaction) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('taskdesk:identity-domain-bindings'), 0)`,
  );
}

async function domainBindingsAreUnique(
  tx: ConnectionTransaction,
  domains: readonly string[],
  exceptConnectionId?: string,
) {
  const existing = await listIdentityDomainBindings(tx);
  const requested = new Set(domains.map((domain) => domain.toLowerCase()));
  return existing.every(
    (row) =>
      row.id === exceptConnectionId ||
      row.domains.every((domain) => !requested.has(domain.toLowerCase())),
  );
}

function safeRoleCapabilities(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((capability) =>
      typeof capability === "string"
        ? capability !== "instance:admin" && capability !== "sees_all"
        : false,
    )
  );
}

async function validateConnectionReferences(
  tx: ConnectionTransaction,
  value: {
    portalScope: "agent" | "customer";
    organisationId: string | null;
    defaultWorkspaceId: string | null;
    maxRoleRank: number | null;
    jitPolicy: unknown;
  },
  options: { allowDormantDefaultRole?: boolean } = {},
) {
  const jit = parseIdentityJitPolicy(value.jitPolicy);
  if (!jit.ok) return false;
  if (
    (value.portalScope === "agent" &&
      (value.organisationId !== null || value.maxRoleRank === null)) ||
    (value.portalScope === "customer" &&
      (value.defaultWorkspaceId !== null || value.maxRoleRank !== null))
  )
    return false;
  if (value.portalScope === "customer") {
    if (!value.organisationId) return false;
    const [organisation] = await lockCustomerOrganisation(
      tx,
      value.organisationId,
    );
    if (!organisation) return false;
  }
  if (value.defaultWorkspaceId) {
    const [workspace] = await lockActiveInternalWorkspace(
      tx,
      value.defaultWorkspaceId,
    );
    if (!workspace || value.portalScope !== "agent") return false;
  }
  if (!jit.value.enabled) return true;
  const [role] = await lockIdentityDefaultRole(
    tx,
    jit.value.default_role_id ?? "",
  );
  if (!role) return false;
  if (value.portalScope === "agent")
    return Boolean(
      value.defaultWorkspaceId &&
        value.maxRoleRank !== null &&
        role.scope === "workspace" &&
        role.workspaceId === value.defaultWorkspaceId &&
        role.rank >= 0 &&
        (options.allowDormantDefaultRole || role.rank <= value.maxRoleRank) &&
        role.key !== "admin" &&
        role.key !== "owner" &&
        safeRoleCapabilities(role.capabilities),
    );
  return Boolean(
    role.scope === "organisation" &&
      role.workspaceId === null &&
      role.key === "customer" &&
      role.rank >= 0 &&
      safeRoleCapabilities(role.capabilities),
  );
}

async function reportAuditFailure() {
  recordAuditWriteFailure("mutation");
  await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
}

async function writeConnectionAudit(
  tx: ConnectionTransaction,
  input: {
    actorId: string;
    personId: string;
    connectionId: string;
    traceId?: string | null;
    changes: string[];
    configVersion: number;
  },
) {
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
          changes: input.changes,
          configVersion: input.configVersion,
        },
      });
    });
    return true;
  } catch {
    return false;
  }
}

const router = apiRouter();

router.openapi(connectionListRoute, async (c) => {
  await requireCurrentInstanceAdmin(
    c,
    "GET",
    "/api/instance/identity-connections",
  );
  const rows = await listIdentityConnections();
  return c.json({ data: rows.map((row) => toSafeConnection(row)) }, 200);
});

router.openapi(eventHistoryRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  await requireCurrentInstanceAdmin(
    c,
    "GET",
    "/api/instance/identity-connections/{id}/events",
  );
  const { id: connectionId } = c.req.valid("param");
  const { cursor: cursorValue, limit } = c.req.valid("query");
  const [connection] = await getIdentityConnectionPresence(connectionId);
  if (!connection) return c.json({ message: "Connection unavailable" }, 404);

  const cursor = decodeEventHistoryCursor(cursorValue, connectionId);
  if (cursor === false)
    return c.json({ message: "Invalid cursor or limit" }, 400);
  const after = cursor
    ? or(
        lt(
          schema.provisioningEventTable.createdAt,
          sql`${cursor.createdAt}::timestamptz`,
        ),
        and(
          eq(
            schema.provisioningEventTable.createdAt,
            sql`${cursor.createdAt}::timestamptz`,
          ),
          lt(schema.provisioningEventTable.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await listIdentityConnectionEvents(connectionId, after, limit);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return c.json(
    {
      data: pageRows.map((row) => ({
        kind: row.kind as (typeof eventKinds)[number],
        outcome: row.outcome,
        actorType: row.actorType as "person" | "scim" | "oidc",
        createdAt: row.createdAt.toISOString(),
      })),
      page: {
        nextCursor:
          hasMore && last
            ? encodeEventHistoryCursor({
                v: 1,
                connectionId,
                createdAt: last.cursorCreatedAt,
                id: last.id,
              })
            : null,
        hasMore,
      },
    },
    200,
  );
});

router.openapi(organisationIdentityRoute, async (c) => {
  await requireCurrentInstanceAdmin(
    c,
    "GET",
    "/api/instance/organisations/{id}/identity",
  );
  const { id } = c.req.valid("param");
  const [organisation] = await getOrganisationPresence(id);
  if (!organisation) return c.json({ message: "Not found" }, 404);
  const [row] = await getIdentityConnectionIdForOrganisation(id);
  return c.json({ data: row ? toSafeConnection(row) : null }, 200);
});

router.openapi(createConnectionRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  await requireCurrentInstanceAdmin(
    c,
    "POST",
    "/api/instance/identity-connections",
  );
  const userId = c.get("userId");
  const session = c.get("session") as {
    id: string;
    impersonatedBy?: string | null;
  } | null;
  if (
    !session ||
    session.impersonatedBy ||
    !(await isCurrentInstanceAdmin(userId))
  )
    throw new HTTPException(403, { message: "Forbidden" });
  const request = c.req.valid("json") as IdentityConnectionCreateRequest;
  let discovery: Awaited<ReturnType<typeof loadEntraDiscovery>>;
  try {
    discovery = await loadEntraDiscovery(request.tenantId);
  } catch {
    throw new HTTPException(422, {
      message: "Identity provider configuration is invalid",
    });
  }
  const [actor] = await getIdentityPersonForUser(userId);
  if (!actor) throw new HTTPException(403, { message: "Forbidden" });
  const connectionId = createId();
  const redirectOrigin =
    request.portalScope === "agent"
      ? new URL(process.env.TASKDESK_AGENT_URL || "http://localhost:5173")
          .origin
      : new URL(process.env.TASKDESK_PORTAL_URL || "http://localhost:5174")
          .origin;
  const redirectUri = `${redirectOrigin}/api/auth/identity/${connectionId}/callback`;
  const token = c.req.valid("header")["x-taskdesk-step-up-token"];
  const result = await db.transaction(async (tx) => {
    await lockIdentityDomainBindings(tx);
    if (request.organisationId) {
      const [existing] = await findIdentityConnectionForOrganisation(
        tx,
        request.organisationId,
      );
      if (existing) return { kind: "duplicate" as const };
    }
    if (!(await domainBindingsAreUnique(tx, request.domainBindings)))
      return { kind: "invalid" as const };
    const [targetWorkspace] = request.defaultWorkspaceId
      ? await getWorkspaceOrganisation(tx, request.defaultWorkspaceId)
      : [];
    await lockScimGrantClosure(tx, {
      connectionId,
      proposedRoleId: request.jitPolicy.default_role_id ?? undefined,
      proposedScope:
        request.jitPolicy.default_role_id === null
          ? undefined
          : request.portalScope === "agent"
            ? "workspace"
            : "organisation",
      proposedScopeId:
        request.jitPolicy.default_role_id === null
          ? undefined
          : request.portalScope === "agent"
            ? (request.defaultWorkspaceId ?? undefined)
            : (request.organisationId ?? undefined),
      proposedOrganisationId:
        request.portalScope === "agent"
          ? targetWorkspace?.organisationId
          : (request.organisationId ?? undefined),
    });
    if (
      !(await validateConnectionReferences(tx, {
        portalScope: request.portalScope,
        organisationId: request.organisationId,
        defaultWorkspaceId: request.defaultWorkspaceId,
        maxRoleRank: request.maxRoleRank,
        jitPolicy: request.jitPolicy,
      }))
    )
      return { kind: "invalid" as const };
    const proof = await consumeIdentityConnectionProof(tx, {
      token,
      personId: actor.id,
      sessionId: session.id,
      operation: IDENTITY_CONNECTION_CREATE_OPERATION,
      request: request as unknown as Record<string, unknown>,
    });
    if (!proof) return { kind: "proof" as const };
    await tx.insert(schema.identityConnectionTable).values({
      id: connectionId,
      providerType: "entra",
      portalScope: request.portalScope,
      organisationId: request.organisationId,
      defaultWorkspaceId: request.defaultWorkspaceId,
      displayName: request.displayName,
      issuer: discovery.issuer,
      tenantId: request.tenantId,
      clientId: request.clientId,
      clientSecret: encryptIdentityClientSecret(
        connectionId,
        request.clientSecret,
      ),
      redirectUri,
      scopes: request.scopes,
      claimMapping: request.claimMapping ?? DEFAULT_IDENTITY_CLAIM_MAPPING,
      domainBindings: request.domainBindings,
      jitPolicy: request.jitPolicy,
      maxRoleRank: request.maxRoleRank,
      enabled: false,
      configVersion: 1,
      createdBy: actor.id,
      updatedBy: actor.id,
    });
    const auditOk = await writeConnectionAudit(tx, {
      actorId: userId,
      personId: actor.id,
      connectionId,
      traceId: c.req.header("x-request-id"),
      changes: ["created"],
      configVersion: 1,
    });
    await tx.insert(schema.provisioningEventTable).values({
      identityConnectionId: connectionId,
      kind: "connection.changed",
      outcome: "succeeded",
      detail: { changes: ["created"], configVersion: 1 },
      actorType: "person",
      traceId: c.req.header("x-request-id") ?? null,
    });
    await appendStepUpAudit(tx, {
      action: "auth.step_up_consumed",
      actorId: userId,
      personId: actor.id,
      operation: IDENTITY_CONNECTION_CREATE_OPERATION,
      traceId: c.req.header("x-request-id"),
    });
    return { kind: "created" as const, auditOk };
  });
  if (result.kind === "proof") {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "step_up_unavailable" });
  }
  if (result.kind === "duplicate")
    return c.json({ message: "Identity connection already exists" }, 409);
  if (result.kind === "invalid")
    throw new HTTPException(422, {
      message: "Identity configuration is invalid",
    });
  if (!result.auditOk) await reportAuditFailure();
  setShadowLegacyAuthorization(c, "allowed");
  const [created] = await getIdentityConnection(connectionId);
  if (!created)
    throw new HTTPException(500, {
      message: "Identity configuration unavailable",
    });
  return c.json({ data: toSafeConnection(created) }, 201);
});

router.openapi(configureConnectionRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  const { id } = c.req.valid("param");
  await requireCurrentInstanceAdmin(
    c,
    "PATCH",
    "/api/instance/identity-connections/{id}",
  );
  const userId = c.get("userId");
  const session = c.get("session") as {
    id: string;
    impersonatedBy?: string | null;
  } | null;
  if (
    !session ||
    session.impersonatedBy ||
    !(await isCurrentInstanceAdmin(userId))
  )
    throw new HTTPException(403, { message: "Forbidden" });
  const request = c.req.valid("json") as IdentityConnectionConfigureRequest;
  const token = c.req.valid("header")["x-taskdesk-step-up-token"];
  const [actor] = await getIdentityPersonForUser(userId);
  if (!actor) throw new HTTPException(403, { message: "Forbidden" });
  const [before] = await getIdentityConnectionConfiguration(id);
  let discovery: Awaited<ReturnType<typeof loadEntraDiscovery>> | null = null;
  if (request.enabled === true) {
    if (!before?.tenantId)
      throw new HTTPException(404, { message: "Connection unavailable" });
    try {
      discovery = await loadEntraDiscovery(before.tenantId);
    } catch {
      throw new HTTPException(422, {
        message: "Identity provider configuration is invalid",
      });
    }
  }
  const result = await retryIdentityGrantClosure(() =>
    db.transaction(async (tx) => {
      await lockIdentityDomainBindings(tx);
      const candidateWorkspaceId =
        request.defaultWorkspaceId === undefined
          ? before?.defaultWorkspaceId
          : request.defaultWorkspaceId;
      const [targetWorkspace] = candidateWorkspaceId
        ? await getWorkspaceOrganisation(tx, candidateWorkspaceId)
        : [];
      const currentJit = parseIdentityJitPolicy(before?.jitPolicy);
      const candidateJit =
        request.jitPolicy ?? (currentJit.ok ? currentJit.value : null);
      const grantClosure = await lockScimGrantClosure(tx, {
        connectionId: id,
        sourceKinds: ["jit_default", "oidc_group", "scim_group"],
        proposedRoleId: candidateJit?.default_role_id ?? undefined,
        proposedScope:
          candidateJit?.default_role_id === null || !candidateJit
            ? undefined
            : before?.portalScope === "agent"
              ? "workspace"
              : "organisation",
        proposedScopeId:
          candidateJit?.default_role_id === null || !candidateJit
            ? undefined
            : before?.portalScope === "agent"
              ? (candidateWorkspaceId ?? undefined)
              : (before?.organisationId ?? undefined),
        proposedOrganisationId:
          before?.portalScope === "agent"
            ? targetWorkspace?.organisationId
            : (before?.organisationId ?? undefined),
      });
      const [current] = await lockIdentityConnection(tx, id);
      if (!current) return { kind: "not_found" as const };
      if (current.configVersion !== request.configVersion)
        return { kind: "conflict" as const, version: current.configVersion };
      const claimMapping =
        request.claimMapping === undefined
          ? current.claimMapping
          : (request.claimMapping ?? DEFAULT_IDENTITY_CLAIM_MAPPING);
      const domainBindings = request.domainBindings ?? current.domainBindings;
      const jitPolicy = request.jitPolicy ?? current.jitPolicy;
      const config = {
        portalScope: current.portalScope as "agent" | "customer",
        organisationId: current.organisationId,
        defaultWorkspaceId:
          request.defaultWorkspaceId === undefined
            ? current.defaultWorkspaceId
            : request.defaultWorkspaceId,
        maxRoleRank:
          request.maxRoleRank === undefined
            ? current.maxRoleRank
            : request.maxRoleRank,
        jitPolicy,
      };
      const preservingExistingJitPolicy =
        request.jitPolicy === undefined &&
        request.defaultWorkspaceId === undefined;
      if (
        !parseIdentityClaimMapping(claimMapping).ok ||
        !(await domainBindingsAreUnique(tx, domainBindings, id)) ||
        !(await validateConnectionReferences(tx, config, {
          allowDormantDefaultRole: preservingExistingJitPolicy,
        }))
      )
        return { kind: "invalid" as const };
      if (request.enabled === true && discovery?.issuer !== current.issuer)
        return { kind: "invalid" as const };
      const proof = await consumeIdentityConnectionProof(tx, {
        token,
        personId: actor.id,
        sessionId: session.id,
        connectionId: id,
        operation: IDENTITY_CONNECTION_CONFIGURE_OPERATION,
        request: request as unknown as Record<string, unknown>,
      });
      if (!proof) return { kind: "proof" as const };
      const nextVersion = current.configVersion + 1;
      const now = new Date();
      const update: Partial<
        typeof schema.identityConnectionTable.$inferInsert
      > = {
        configVersion: nextVersion,
        updatedAt: now,
        updatedBy: actor.id,
      };
      if (request.displayName !== undefined)
        update.displayName = request.displayName;
      if (request.clientId !== undefined) update.clientId = request.clientId;
      if (request.clientSecret !== undefined)
        update.clientSecret = encryptIdentityClientSecret(
          id,
          request.clientSecret,
        );
      if (request.scopes !== undefined) update.scopes = request.scopes;
      if (request.claimMapping !== undefined)
        update.claimMapping = claimMapping;
      if (request.domainBindings !== undefined)
        update.domainBindings = domainBindings;
      if (request.defaultWorkspaceId !== undefined)
        update.defaultWorkspaceId = request.defaultWorkspaceId;
      if (request.jitPolicy !== undefined) update.jitPolicy = request.jitPolicy;
      if (request.maxRoleRank !== undefined)
        update.maxRoleRank = request.maxRoleRank;
      if (request.enabled !== undefined) update.enabled = request.enabled;
      const [updated] = await tx
        .update(schema.identityConnectionTable)
        .set(update)
        .where(
          and(
            eq(schema.identityConnectionTable.id, id),
            eq(
              schema.identityConnectionTable.configVersion,
              request.configVersion,
            ),
          ),
        )
        .returning({ version: schema.identityConnectionTable.configVersion });
      if (!updated)
        return { kind: "conflict" as const, version: current.configVersion };
      const disabling = current.enabled && request.enabled === false;
      let affectedUserIds: string[] = [];
      if (disabling) {
        await retireConnectionGrantSources(tx, id);
        await tx
          .delete(schema.sessionTable)
          .where(eq(schema.sessionTable.identityConnectionId, id));
        await tx
          .update(schema.scimConnectionTable)
          .set({ enabled: false })
          .where(eq(schema.scimConnectionTable.identityConnectionId, id));
      } else if (
        request.maxRoleRank !== undefined &&
        request.maxRoleRank !== null &&
        (current.maxRoleRank === null ||
          request.maxRoleRank < current.maxRoleRank)
      ) {
        const retired = await retireConnectionGrantsAboveRoleRank(
          tx,
          id,
          request.maxRoleRank,
          grantClosure,
        );
        affectedUserIds = retired.userIds;
      }
      const nextJit = parseIdentityJitPolicy(jitPolicy);
      const lockedJit = parseIdentityJitPolicy(current.jitPolicy);
      const jitTransition =
        !disabling &&
        ((lockedJit.ok &&
          lockedJit.value.enabled &&
          request.jitPolicy !== undefined &&
          nextJit.ok &&
          !nextJit.value.enabled) ||
          (request.jitPolicy !== undefined &&
            lockedJit.ok &&
            nextJit.ok &&
            nextJit.value.default_role_id !==
              lockedJit.value.default_role_id) ||
          (request.defaultWorkspaceId !== undefined &&
            request.defaultWorkspaceId !== current.defaultWorkspaceId));
      if (jitTransition) {
        const retiredJit = await retireConnectionJitGrants(
          tx,
          id,
          grantClosure,
        );
        affectedUserIds = [
          ...new Set([...affectedUserIds, ...retiredJit.userIds]),
        ];
      }
      const changedKeys = Object.keys(request).filter(
        (key) => key !== "configVersion",
      );
      const auditOk = await writeConnectionAudit(tx, {
        actorId: userId,
        personId: actor.id,
        connectionId: id,
        traceId: c.req.header("x-request-id"),
        changes: changedKeys,
        configVersion: updated.version,
      });
      await tx.insert(schema.provisioningEventTable).values({
        identityConnectionId: id,
        kind: "connection.changed",
        outcome: "succeeded",
        detail: { changes: changedKeys, configVersion: updated.version },
        actorType: "person",
        traceId: c.req.header("x-request-id") ?? null,
      });
      await appendStepUpAudit(tx, {
        action: "auth.step_up_consumed",
        actorId: userId,
        personId: actor.id,
        operation: IDENTITY_CONNECTION_CONFIGURE_OPERATION,
        traceId: c.req.header("x-request-id"),
      });
      return { kind: "updated" as const, auditOk, affectedUserIds };
    }),
  );
  if (result.kind === "not_found")
    return c.json({ message: "Connection unavailable" }, 404);
  if (result.kind === "conflict")
    return c.json(
      { message: "version_conflict", currentVersion: result.version },
      409,
    );
  if (result.kind === "invalid")
    return c.json({ message: "Identity configuration is invalid" }, 422);
  if (result.kind === "proof") {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "step_up_unavailable" });
  }
  if (!result.auditOk) await reportAuditFailure();
  for (const affectedUserId of result.affectedUserIds)
    await invalidateNativeAuthorization({ userId: affectedUserId });
  setShadowLegacyAuthorization(c, "allowed");
  const [updated] = await getIdentityConnection(id);
  if (!updated)
    throw new HTTPException(404, { message: "Connection unavailable" });
  return c.json({ data: toSafeConnection(updated) }, 200);
});

export default router;
