import {
  parseIdentityClaimMapping,
  parseIdentityJitPolicy,
} from "@taskdesk/domain";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";

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

const connectionProjection = {
  id: schema.identityConnectionTable.id,
  providerType: schema.identityConnectionTable.providerType,
  portalScope: schema.identityConnectionTable.portalScope,
  organisationId: schema.identityConnectionTable.organisationId,
  defaultWorkspaceId: schema.identityConnectionTable.defaultWorkspaceId,
  displayName: schema.identityConnectionTable.displayName,
  issuer: schema.identityConnectionTable.issuer,
  tenantId: schema.identityConnectionTable.tenantId,
  clientId: schema.identityConnectionTable.clientId,
  clientSecret: schema.identityConnectionTable.clientSecret,
  redirectUri: schema.identityConnectionTable.redirectUri,
  scopes: schema.identityConnectionTable.scopes,
  claimMapping: schema.identityConnectionTable.claimMapping,
  domainBindings: schema.identityConnectionTable.domainBindings,
  jitPolicy: schema.identityConnectionTable.jitPolicy,
  maxRoleRank: schema.identityConnectionTable.maxRoleRank,
  mfaUpstreamMode: schema.identityConnectionTable.mfaUpstreamMode,
  enabled: schema.identityConnectionTable.enabled,
  configVersion: schema.identityConnectionTable.configVersion,
  healthState: schema.identityConnectionTable.healthState,
  healthCheckedAt: schema.identityConnectionTable.healthCheckedAt,
} as const;

const router = apiRouter();

router.openapi(connectionListRoute, async (c) => {
  await requireCurrentInstanceAdmin(
    c,
    "GET",
    "/api/instance/identity-connections",
  );
  const rows = await db
    .select(connectionProjection)
    .from(schema.identityConnectionTable)
    .orderBy(
      schema.identityConnectionTable.portalScope,
      schema.identityConnectionTable.id,
    );
  return c.json({ data: rows.map((row) => toSafeConnection(row)) }, 200);
});

router.openapi(organisationIdentityRoute, async (c) => {
  await requireCurrentInstanceAdmin(
    c,
    "GET",
    "/api/instance/organisations/{id}/identity",
  );
  const { id } = c.req.valid("param");
  const [organisation] = await db
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.id, id))
    .limit(1);
  if (!organisation) return c.json({ message: "Not found" }, 404);
  const [row] = await db
    .select(connectionProjection)
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.organisationId, id))
    .limit(1);
  return c.json({ data: row ? toSafeConnection(row) : null }, 200);
});

export default router;
