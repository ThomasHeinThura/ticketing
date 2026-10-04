import { createId } from "@paralleldrive/cuid2";
import {
  applyScimPatchOps,
  DEFAULT_SCIM_PROFILE_MAPPING,
  mapScimProfile,
  parseScimProfileAttributeMapping,
  parseScimUser,
  validateScimPutExternalId,
} from "@taskdesk/domain";
import { and, eq, isNull, sql, count as sqlCount } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import type { BaseVariables } from "../openapi";
import {
  apiRouter,
  createRoute,
  jsonResponse,
  jsonValueSchema,
  z,
} from "../openapi";
import {
  IdentityGrantClosureChangedError,
  retryIdentityGrantClosure,
} from "./membership-projection";
import {
  lockAndVerifyScimMutation,
  resolveScimBearer,
  type ScimRequestAuthority,
} from "./scim-authentication";
import { ScimGroupWriteError, writeScimGroup } from "./scim-group-sync";
import { setScimIdentityActiveInTransaction } from "./scim-lifecycle";

type ScimVariables = BaseVariables & { scimAuthority: ScimRequestAuthority };
const scim = apiRouter<ScimVariables>();

scim.use("*", async (c, next) => {
  const authority = await resolveScimBearer(c.req.header("Authorization"));
  c.set("scimAuthority", authority);
  await next();
});

function scimResponse<T extends Response>(response: T): T {
  response.headers.set("Content-Type", "application/scim+json; charset=utf-8");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function scimErrorBody(status: number, detail: string, scimType?: string) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

scim.onError((error, c) => {
  if (!(error instanceof HTTPException)) throw error;
  const status = error.status;
  if (status === 401)
    return scimResponse(c.json(scimErrorBody(401, "Unauthorized"), 401));
  if (status === 403)
    return scimResponse(
      c.json(
        scimErrorBody(
          403,
          error.message === "Resource is not allowed"
            ? "Resource is not allowed for this connection"
            : "Connection disabled",
        ),
        403,
      ),
    );
  if (status === 503)
    return scimResponse(
      c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
    );
  throw error;
});

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

function parseUserFilter(value: string | undefined) {
  if (value === undefined) return null;
  const match = value.match(
    /^\s*(userName|externalId)\s+eq\s+"((?:\\.|[^"\\])*)"\s*$/iu,
  );
  if (!match) return false;
  const field = match[1]?.toLowerCase();
  const raw = match[2];
  if (!field || raw === undefined) return false;
  const unescaped = raw.replace(/\\(["\\])/gu, "$1");
  if (unescaped.includes("\\")) return false;
  return {
    field: field === "username" ? "userName" : "externalId",
    value: unescaped,
  } as const;
}

const userProjection = {
  id: schema.externalIdentityTable.id,
  externalId: schema.externalIdentityTable.scimExternalId,
  userName: schema.externalIdentityTable.userNameSnapshot,
  email: schema.externalIdentityTable.emailSnapshot,
  active: schema.personTable.active,
  displayName: schema.personTable.displayName,
  title: schema.personTable.jobTitle,
  locale: schema.personTable.locale,
  createdAt: schema.externalIdentityTable.firstSeenAt,
  updatedAt: schema.personTable.updatedAt,
} as const;

function scimUserPredicates(authority: ScimRequestAuthority) {
  return [
    eq(
      schema.externalIdentityTable.identityConnectionId,
      authority.connectionId,
    ),
    eq(schema.externalIdentityTable.provisionedVia, "scim"),
  ];
}

type ScimUserRow = {
  id: string;
  externalId: string | null;
  userName: string | null;
  email: string | null;
  active: boolean;
  displayName: string | null;
  title: string | null;
  locale: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toScimUser(row: ScimUserRow) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    userName: row.userName ?? "",
    active: row.active,
    ...(row.displayName
      ? { displayName: row.displayName, name: { formatted: row.displayName } }
      : {}),
    ...(row.email ? { emails: [{ value: row.email, primary: true }] } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(row.locale ? { preferredLanguage: row.locale } : {}),
    meta: {
      resourceType: "User",
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
    },
  };
}

const serviceProviderConfig = z.object({
  schemas: z.array(z.string()),
  documentationUri: z.string().optional(),
  patch: z.object({ supported: z.boolean() }),
  bulk: z.object({
    supported: z.boolean(),
    maxOperations: z.number(),
    maxPayloadSize: z.number(),
  }),
  filter: z.object({ supported: z.boolean(), maxResults: z.number() }),
  changePassword: z.object({ supported: z.boolean() }),
  sort: z.object({ supported: z.boolean() }),
  etag: z.object({ supported: z.boolean() }),
  authenticationSchemes: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      description: z.string(),
      specUri: z.string().optional(),
      documentationUri: z.string().optional(),
      primary: z.boolean(),
    }),
  ),
});

const scimListSchema = z.record(z.string(), jsonValueSchema);
const userListRoute = createRoute({
  method: "get",
  path: "/Users",
  operationId: "listScimUsers",
  tags: ["SCIM"],
  summary: "List users provisioned by this SCIM connection",
  request: {
    query: z.object({
      filter: z.string().max(512).optional(),
      startIndex: z.coerce.number().int().min(1).max(100_000).optional(),
      count: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: jsonResponse("SCIM users", scimListSchema),
    400: jsonResponse("Invalid SCIM filter", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
  },
});

const userReadRoute = createRoute({
  method: "get",
  path: "/Users/{id}",
  operationId: "getScimUser",
  tags: ["SCIM"],
  summary: "Read a user provisioned by this SCIM connection",
  request: { params: z.object({ id: z.string().min(1).max(128) }) },
  responses: {
    200: jsonResponse("SCIM user", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    404: jsonResponse("SCIM user not found", scimListSchema),
  },
});

const userCreateRoute = createRoute({
  method: "post",
  path: "/Users",
  operationId: "createScimUser",
  tags: ["SCIM"],
  summary: "Create a user in this SCIM connection's directory",
  request: {
    body: { content: { "application/scim+json": { schema: scimListSchema } } },
  },
  responses: {
    201: jsonResponse("Created SCIM user", scimListSchema),
    400: jsonResponse("Invalid SCIM user", scimListSchema),
    409: jsonResponse("Identity conflict", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    503: jsonResponse("SCIM configuration unavailable", scimListSchema),
  },
});

const userReplaceRoute = createRoute({
  method: "put",
  path: "/Users/{id}",
  operationId: "replaceScimUser",
  tags: ["SCIM"],
  summary: "Replace a SCIM user profile",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    body: { content: { "application/scim+json": { schema: scimListSchema } } },
  },
  responses: {
    200: jsonResponse("Updated SCIM user", scimListSchema),
    400: jsonResponse("Invalid SCIM user", scimListSchema),
    404: jsonResponse("SCIM user not found", scimListSchema),
    409: jsonResponse("Identity conflict", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    503: jsonResponse("SCIM configuration unavailable", scimListSchema),
  },
});

const userPatchRoute = createRoute({
  method: "patch",
  path: "/Users/{id}",
  operationId: "patchScimUser",
  tags: ["SCIM"],
  summary: "Update mapped SCIM user attributes",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    body: { content: { "application/scim+json": { schema: scimListSchema } } },
  },
  responses: {
    200: jsonResponse("Updated SCIM user", scimListSchema),
    400: jsonResponse("Invalid SCIM patch", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    404: jsonResponse("SCIM user not found", scimListSchema),
    503: jsonResponse("SCIM configuration unavailable", scimListSchema),
  },
});

const userDeleteRoute = createRoute({
  method: "delete",
  path: "/Users/{id}",
  operationId: "deactivateScimUser",
  tags: ["SCIM"],
  summary: "Deactivate a SCIM user without deleting its history",
  request: { params: z.object({ id: z.string().min(1).max(128) }) },
  responses: {
    204: { description: "User deactivated" },
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    404: jsonResponse("SCIM user not found", scimListSchema),
    503: jsonResponse("SCIM lifecycle unavailable", scimListSchema),
  },
});

const groupListRoute = createRoute({
  method: "get",
  path: "/Groups",
  operationId: "listScimGroups",
  tags: ["SCIM"],
  summary: "List groups in this SCIM connection's directory",
  request: {
    query: z.object({
      startIndex: z.coerce.number().int().min(1).max(100_000).optional(),
      count: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: jsonResponse("SCIM groups", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
  },
});

const groupReadRoute = createRoute({
  method: "get",
  path: "/Groups/{id}",
  operationId: "getScimGroup",
  tags: ["SCIM"],
  summary: "Read a group in this SCIM connection's directory",
  request: { params: z.object({ id: z.string().min(1).max(128) }) },
  responses: {
    200: jsonResponse("SCIM group", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    404: jsonResponse("SCIM group not found", scimListSchema),
  },
});

const groupCreateRoute = createRoute({
  method: "post",
  path: "/Groups",
  operationId: "createScimGroup",
  tags: ["SCIM"],
  summary: "Create a directory group and reconcile mapped memberships",
  request: {
    body: { content: { "application/scim+json": { schema: scimListSchema } } },
  },
  responses: {
    201: jsonResponse("Created SCIM group", scimListSchema),
    400: jsonResponse("Invalid SCIM group", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    409: jsonResponse("SCIM group already exists", scimListSchema),
    503: jsonResponse("SCIM configuration unavailable", scimListSchema),
  },
});

const groupReplaceRoute = createRoute({
  method: "put",
  path: "/Groups/{id}",
  operationId: "replaceScimGroup",
  tags: ["SCIM"],
  summary: "Replace directory group metadata and membership",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    body: { content: { "application/scim+json": { schema: scimListSchema } } },
  },
  responses: {
    200: jsonResponse("Updated SCIM group", scimListSchema),
    400: jsonResponse("Invalid SCIM group", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    404: jsonResponse("SCIM group not found", scimListSchema),
    503: jsonResponse("SCIM configuration unavailable", scimListSchema),
  },
});

const groupPatchRoute = createRoute({
  method: "patch",
  path: "/Groups/{id}",
  operationId: "patchScimGroup",
  tags: ["SCIM"],
  summary: "Update directory group attributes and membership",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    body: { content: { "application/scim+json": { schema: scimListSchema } } },
  },
  responses: {
    200: jsonResponse("Updated SCIM group", scimListSchema),
    400: jsonResponse("Invalid SCIM group patch", scimListSchema),
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    404: jsonResponse("SCIM group not found", scimListSchema),
    503: jsonResponse("SCIM configuration unavailable", scimListSchema),
  },
});

const groupDeleteRoute = createRoute({
  method: "delete",
  path: "/Groups/{id}",
  operationId: "deactivateScimGroup",
  tags: ["SCIM"],
  summary: "Soft deactivate a SCIM directory group",
  request: { params: z.object({ id: z.string().min(1).max(128) }) },
  responses: {
    204: { description: "Group deactivated" },
    403: jsonResponse("SCIM resource is not allowed", scimListSchema),
    404: jsonResponse("SCIM group not found", scimListSchema),
    503: jsonResponse("SCIM configuration unavailable", scimListSchema),
  },
});

async function applyScimActiveState(
  authority: ScimRequestAuthority,
  connectionId: string,
  identityId: string,
  active: boolean,
) {
  return retryIdentityGrantClosure(async () =>
    db.transaction(async (tx) => {
      const [scimConnection] = await tx
        .select({ lifecyclePolicy: schema.scimConnectionTable.lifecyclePolicy })
        .from(schema.scimConnectionTable)
        .where(
          eq(schema.scimConnectionTable.identityConnectionId, connectionId),
        )
        .limit(1);
      if (
        !scimConnection ||
        (scimConnection.lifecyclePolicy !== "end_memberships" &&
          scimConnection.lifecyclePolicy !== "keep_memberships")
      )
        return false;
      const changed = await setScimIdentityActiveInTransaction(
        tx,
        identityId,
        connectionId,
        active,
        scimConnection.lifecyclePolicy,
      );
      if (!changed) return false;
      const { scim } = await lockAndVerifyScimMutation(tx, authority, "users");
      if (scim.lifecyclePolicy !== scimConnection.lifecyclePolicy)
        throw new IdentityGrantClosureChangedError();
      return true;
    }),
  );
}

async function applyScimActiveStateInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  authority: ScimRequestAuthority,
  connectionId: string,
  identityId: string,
  active: boolean,
) {
  const [scimConnection] = await tx
    .select({ lifecyclePolicy: schema.scimConnectionTable.lifecyclePolicy })
    .from(schema.scimConnectionTable)
    .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId))
    .limit(1);
  if (
    !scimConnection ||
    (scimConnection.lifecyclePolicy !== "end_memberships" &&
      scimConnection.lifecyclePolicy !== "keep_memberships")
  )
    return false;
  const changed = await setScimIdentityActiveInTransaction(
    tx,
    identityId,
    connectionId,
    active,
    scimConnection.lifecyclePolicy,
  );
  if (!changed) return false;
  const { scim } = await lockAndVerifyScimMutation(tx, authority, "users");
  if (scim.lifecyclePolicy !== scimConnection.lifecyclePolicy)
    throw new IdentityGrantClosureChangedError();
  return true;
}

async function lockScimProfilePerson(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  personId: string,
  expectedOrganisationId: string,
) {
  await tx
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.id, expectedOrganisationId))
    .for("update");
  const [person] = await tx
    .select({ organisationId: schema.personTable.organisationId })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, personId))
    .for("update");
  return person?.organisationId === expectedOrganisationId;
}

async function readScimGroup(connectionId: string, groupId: string) {
  const [group] = await db
    .select({
      id: schema.scimGroupTable.id,
      externalId: schema.scimGroupTable.externalId,
      displayName: schema.scimGroupTable.displayName,
      active: schema.scimGroupTable.active,
      createdAt: schema.scimGroupTable.createdAt,
      updatedAt: schema.scimGroupTable.updatedAt,
    })
    .from(schema.scimGroupTable)
    .where(
      and(
        eq(schema.scimGroupTable.scimConnectionId, connectionId),
        eq(schema.scimGroupTable.id, groupId),
      ),
    )
    .limit(1);
  if (!group) return null;
  const members = await db
    .select({
      value: schema.externalIdentityTable.id,
      display: schema.personTable.displayName,
    })
    .from(schema.scimGroupDirectoryMemberTable)
    .innerJoin(
      schema.externalIdentityTable,
      eq(
        schema.externalIdentityTable.id,
        schema.scimGroupDirectoryMemberTable.externalIdentityId,
      ),
    )
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.id, schema.externalIdentityTable.personId),
    )
    .where(
      and(
        eq(schema.scimGroupDirectoryMemberTable.scimConnectionId, connectionId),
        eq(schema.scimGroupDirectoryMemberTable.scimGroupId, group.id),
        eq(schema.scimGroupDirectoryMemberTable.active, true),
        eq(schema.externalIdentityTable.active, true),
      ),
    )
    .orderBy(schema.externalIdentityTable.id);
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: group.id,
    externalId: group.externalId,
    displayName: group.displayName,
    active: group.active,
    members: members.map((member) => ({
      value: member.value,
      type: "User",
      ...(member.display ? { display: member.display } : {}),
    })),
    meta: {
      resourceType: "Group",
      created: group.createdAt.toISOString(),
      lastModified: group.updatedAt.toISOString(),
    },
  };
}

type ScimGroupInput = {
  externalId: string;
  displayName: string;
  active: boolean;
  memberIds: string[];
};

type ScimGroupPatchOperation = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseScimGroupResource(raw: unknown): ScimGroupInput | null {
  if (!isRecord(raw)) return null;
  const allowed = new Set([
    "schemas",
    "externalId",
    "displayName",
    "active",
    "members",
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  if (
    !Array.isArray(raw.schemas) ||
    raw.schemas.length !== 1 ||
    !raw.schemas.includes("urn:ietf:params:scim:schemas:core:2.0:Group") ||
    raw.schemas.some(
      (item) => item !== "urn:ietf:params:scim:schemas:core:2.0:Group",
    ) ||
    typeof raw.externalId !== "string" ||
    raw.externalId.trim().length === 0 ||
    raw.externalId.length > 255 ||
    typeof raw.displayName !== "string" ||
    raw.displayName.trim().length === 0 ||
    raw.displayName.length > 255 ||
    (raw.active !== undefined && typeof raw.active !== "boolean")
  )
    return null;
  const memberIds: string[] = [];
  if (raw.members !== undefined) {
    if (!Array.isArray(raw.members)) return null;
    for (const member of raw.members) {
      if (
        !isRecord(member) ||
        Object.keys(member).some(
          (key) => !["value", "type", "display"].includes(key),
        ) ||
        typeof member.value !== "string" ||
        member.value.length === 0 ||
        (member.type !== undefined && member.type !== "User") ||
        (member.display !== undefined && typeof member.display !== "string")
      )
        return null;
      memberIds.push(member.value);
    }
  }
  if (new Set(memberIds).size !== memberIds.length) return null;
  return {
    externalId: raw.externalId,
    displayName: raw.displayName,
    active: raw.active ?? true,
    memberIds,
  };
}

function parseScimGroupPatch(raw: unknown): ScimGroupPatchOperation[] | null {
  if (
    !isRecord(raw) ||
    Object.keys(raw).some((key) => !["schemas", "Operations"].includes(key)) ||
    !Array.isArray(raw.schemas) ||
    raw.schemas.length !== 1 ||
    raw.schemas[0] !== "urn:ietf:params:scim:api:messages:2.0:PatchOp" ||
    !Array.isArray(raw.Operations) ||
    raw.Operations.length < 1 ||
    raw.Operations.length > 100
  )
    return null;
  const operations: ScimGroupPatchOperation[] = [];
  for (const item of raw.Operations) {
    if (
      !isRecord(item) ||
      Object.keys(item).some((key) => !["op", "path", "value"].includes(key))
    )
      return null;
    const op = typeof item.op === "string" ? item.op.toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") return null;
    if (item.path === undefined && op !== "remove" && isRecord(item.value)) {
      if (
        Object.keys(item.value).some(
          (key) => !["displayName", "active", "members"].includes(key),
        )
      )
        return null;
      for (const [path, value] of Object.entries(item.value))
        operations.push({ op, path, value });
      continue;
    }
    if (typeof item.path !== "string" || item.path.length > 512) return null;
    const path = item.path.trim();
    const lowerPath = path.toLowerCase();
    const canonicalPath =
      lowerPath === "displayname"
        ? "displayName"
        : lowerPath === "active"
          ? "active"
          : lowerPath === "members"
            ? "members"
            : path;
    if (
      !["displayName", "active", "members"].includes(canonicalPath) &&
      !/^members\[value\s+eq\s+"[A-Za-z0-9_-]{1,128}"\]$/iu.test(path)
    )
      return null;
    operations.push({
      op,
      path: canonicalPath,
      ...(Object.hasOwn(item, "value") ? { value: item.value } : {}),
    });
  }
  return operations;
}

const serviceProviderConfigRoute = createRoute({
  method: "get",
  path: "/ServiceProviderConfig",
  operationId: "getScimServiceProviderConfig",
  tags: ["SCIM"],
  summary: "Read SCIM service provider capabilities",
  responses: { 200: jsonResponse("SCIM capabilities", serviceProviderConfig) },
});

const resourceTypes = z.object({
  schemas: z.array(z.string()),
  totalResults: z.number(),
  startIndex: z.number(),
  itemsPerPage: z.number(),
  Resources: z.array(
    z.object({
      schemas: z.array(z.string()),
      id: z.string(),
      name: z.string(),
      endpoint: z.string(),
      schema: z.string(),
      meta: z.object({ resourceType: z.string() }).optional(),
    }),
  ),
});

const resourceTypesRoute = createRoute({
  method: "get",
  path: "/ResourceTypes",
  operationId: "listScimResourceTypes",
  tags: ["SCIM"],
  summary: "List supported SCIM resource types",
  responses: { 200: jsonResponse("SCIM resource types", resourceTypes) },
});

const schemasRoute = createRoute({
  method: "get",
  path: "/Schemas",
  operationId: "listScimSchemas",
  tags: ["SCIM"],
  summary: "List supported SCIM schemas",
  responses: {
    200: jsonResponse(
      "SCIM schemas",
      z.object({
        schemas: z.array(z.string()),
        totalResults: z.number(),
        startIndex: z.number(),
        itemsPerPage: z.number(),
        Resources: z.array(z.record(z.string(), jsonValueSchema)),
      }),
    ),
  },
});

async function readScimProfileMapping(connectionId: string) {
  const [row] = await db
    .select({ mapping: schema.scimConnectionTable.attributeMapping })
    .from(schema.scimConnectionTable)
    .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId))
    .limit(1);
  if (!row) return null;
  const raw: unknown = row.mapping ?? DEFAULT_SCIM_PROFILE_MAPPING;
  const parsed = parseScimProfileAttributeMapping(raw);
  return parsed.ok ? parsed.value : null;
}

export default scim
  .openapi(userListRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("users"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const query = c.req.valid("query");
    const filter = parseUserFilter(query.filter);
    if (filter === false)
      return scimResponse(
        c.json(scimErrorBody(400, "Unsupported filter", "invalidFilter"), 400),
      );
    const predicates = scimUserPredicates(authority);
    if (filter)
      predicates.push(
        filter.field === "userName"
          ? eq(schema.externalIdentityTable.userNameSnapshot, filter.value)
          : eq(schema.externalIdentityTable.scimExternalId, filter.value),
      );
    const startIndex = query.startIndex ?? 1;
    const pageCount = query.count ?? 100;
    const where = and(...predicates);
    const [total] = await db
      .select({ totalResults: sqlCount() })
      .from(schema.externalIdentityTable)
      .where(where);
    const rows = await db
      .select(userProjection)
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .where(where)
      .orderBy(schema.externalIdentityTable.id)
      .limit(pageCount)
      .offset(startIndex - 1);
    const resources = rows.map(toScimUser);
    return scimResponse(
      c.json(
        {
          schemas: [SCIM_LIST_SCHEMA],
          totalResults: total?.totalResults ?? 0,
          startIndex,
          itemsPerPage: resources.length,
          Resources: resources,
        },
        200,
      ),
    );
  })
  .openapi(userReadRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("users"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const id = c.req.valid("param").id;
    const [row] = await db
      .select(userProjection)
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .where(
        and(
          ...scimUserPredicates(authority),
          eq(schema.externalIdentityTable.id, id),
        ),
      )
      .limit(1);
    return row
      ? scimResponse(c.json(toScimUser(row) as never, 200))
      : scimResponse(c.json(scimErrorBody(404, "Resource not found"), 404));
  })
  .openapi(userCreateRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("users"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const raw: unknown = c.req.valid("json");
    const parsed = parseScimUser(raw);
    const parsedExternalId = parsed.ok ? parsed.value.externalId : undefined;
    if (!parsed.ok || !parsedExternalId || !parsed.value.userName)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM user resource"), 400),
      );
    const attrs = parsed.value;
    const userName = attrs.userName;
    if (!userName)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM user resource"), 400),
      );
    const now = new Date();
    const identityId = createId();
    const personId = createId();
    try {
      const created = await db.transaction(async (tx) => {
        // Serialize user admission with connection disable, token rotation, and
        // attribute-map changes. Credential resolution at request entry alone is
        // insufficient because an administrator can revoke it before this write.
        const { connection, scim } = await lockAndVerifyScimMutation(
          tx,
          authority,
          "users",
        );
        const mappingResult = parseScimProfileAttributeMapping(
          scim.attributeMapping ?? DEFAULT_SCIM_PROFILE_MAPPING,
        );
        if (!mappingResult.ok) return { unavailable: true as const };
        const profile = mapScimProfile(raw, mappingResult.value, {
          complete: true,
        });
        if (!profile.ok) return { invalid: true as const };
        const admissionLocks = [
          `taskdesk:scim-user-create:${authority.connectionId}:external-id:${parsedExternalId}`,
          `taskdesk:scim-user-create:${authority.connectionId}:user-name:${userName.toLowerCase()}`,
          `taskdesk:scim-user-create:email:${profile.value.email.toLowerCase()}`,
        ].sort();
        for (const lockKey of admissionLocks)
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
          );
        const [sameConnection] = await tx
          .select({ id: schema.externalIdentityTable.id })
          .from(schema.externalIdentityTable)
          .where(
            and(
              eq(
                schema.externalIdentityTable.identityConnectionId,
                authority.connectionId,
              ),
              sql`(${schema.externalIdentityTable.scimExternalId} = ${parsedExternalId} or lower(${schema.externalIdentityTable.userNameSnapshot}) = ${userName.toLowerCase()})`,
            ),
          )
          .limit(1);
        if (sameConnection) return { conflict: true as const };
        const [emailConflict] = await tx
          .select({ id: schema.externalIdentityTable.id })
          .from(schema.externalIdentityTable)
          .innerJoin(
            schema.personTable,
            eq(schema.personTable.id, schema.externalIdentityTable.personId),
          )
          .leftJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.personTable.userId),
          )
          .where(
            sql`lower(${schema.externalIdentityTable.emailSnapshot}) = lower(${profile.value.email}) or lower(${schema.userTable.email}) = lower(${profile.value.email})`,
          )
          .limit(1);
        if (emailConflict) return { conflict: true as const };
        let organisationId = connection.organisationId;
        if (connection.portalScope === "agent") {
          const [internal] = await tx
            .select({ id: schema.organisationTable.id })
            .from(schema.organisationTable)
            .where(
              and(
                eq(schema.organisationTable.isInternal, true),
                eq(schema.organisationTable.active, true),
                isNull(schema.organisationTable.deletedAt),
              ),
            )
            .limit(1);
          organisationId = internal?.id ?? null;
        }
        if (!organisationId) return { unavailable: true as const };
        await tx.insert(schema.personTable).values({
          id: personId,
          organisationId,
          side: connection.portalScope === "agent" ? "staff" : "customer",
          isPlaceholder: true,
          active: attrs.active ?? true,
          displayName: profile.value.name,
          jobTitle: profile.value.jobTitle ?? null,
          locale: profile.value.locale ?? null,
        });
        await tx.insert(schema.externalIdentityTable).values([
          {
            id: identityId,
            identityConnectionId: authority.connectionId,
            personId,
            issuer: connection.issuer,
            subject: parsedExternalId,
            scimExternalId: parsedExternalId,
            userNameSnapshot: userName,
            emailSnapshot: profile.value.email,
            active: attrs.active ?? true,
            deactivatedAt: attrs.active === false ? now : null,
            provisionedVia: "scim",
            firstSeenAt: now,
          },
        ]);
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: authority.connectionId,
          scimConnectionId: authority.connectionId,
          externalIdentityId: identityId,
          kind: attrs.active === false ? "user.deactivated" : "user.created",
          outcome: "success",
          detail: { personId, active: attrs.active ?? true },
          actorType: "scim",
        });
        return { created: true as const };
      });
      if ("conflict" in created)
        return scimResponse(
          c.json(
            scimErrorBody(
              409,
              "A matching identity already exists.",
              "uniqueness",
            ),
            409,
          ),
        );
      if ("unavailable" in created)
        return scimResponse(
          c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
        );
      if ("invalid" in created)
        return scimResponse(
          c.json(scimErrorBody(400, "Invalid SCIM user resource"), 400),
        );
      const [row] = await db
        .select(userProjection)
        .from(schema.externalIdentityTable)
        .innerJoin(
          schema.personTable,
          eq(schema.personTable.id, schema.externalIdentityTable.personId),
        )
        .where(
          and(
            eq(schema.externalIdentityTable.id, identityId),
            eq(
              schema.externalIdentityTable.identityConnectionId,
              authority.connectionId,
            ),
          ),
        )
        .limit(1);
      return scimResponse(c.json(toScimUser(row as ScimUserRow) as never, 201));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return scimResponse(
        c.json(
          scimErrorBody(
            409,
            "A matching identity already exists.",
            "uniqueness",
          ),
          409,
        ),
      );
    }
  })
  .openapi(userReplaceRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("users"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const { id } = c.req.valid("param");
    const raw: unknown = c.req.valid("json");
    const parsed = parseScimUser(raw);
    const mapping = await readScimProfileMapping(authority.connectionId);
    if (!mapping)
      return scimResponse(
        c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
      );
    const profile = mapScimProfile(raw, mapping, { complete: true });
    if (!parsed.ok || !profile.ok)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM user resource"), 400),
      );
    const [current] = await db
      .select({
        id: schema.externalIdentityTable.id,
        externalId: schema.externalIdentityTable.scimExternalId,
        personId: schema.externalIdentityTable.personId,
        organisationId: schema.personTable.organisationId,
        userName: schema.externalIdentityTable.userNameSnapshot,
        email: schema.externalIdentityTable.emailSnapshot,
        active: schema.personTable.active,
        displayName: schema.personTable.displayName,
        title: schema.personTable.jobTitle,
        locale: schema.personTable.locale,
      })
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .where(
        and(
          ...scimUserPredicates(authority),
          eq(schema.externalIdentityTable.id, id),
        ),
      )
      .limit(1);
    if (!current)
      return scimResponse(
        c.json(scimErrorBody(404, "Resource not found"), 404),
      );
    const externalIdResult = validateScimPutExternalId(
      current.externalId ?? undefined,
      parsed.value.externalId,
    );
    if (!externalIdResult.ok)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM user resource"), 400),
      );
    const nextActive = parsed.value.active ?? true;
    const [emailConflict] = await db
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .leftJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .where(
        and(
          sql`lower(${schema.externalIdentityTable.emailSnapshot}) = lower(${profile.value.email}) or lower(${schema.userTable.email}) = lower(${profile.value.email})`,
          sql`${schema.externalIdentityTable.id} <> ${id}`,
        ),
      )
      .limit(1);
    if (emailConflict)
      return scimResponse(
        c.json(
          scimErrorBody(
            409,
            "A matching identity already exists.",
            "uniqueness",
          ),
          409,
        ),
      );
    const updateSucceeded = await retryIdentityGrantClosure(async () =>
      db.transaction(async (tx) => {
        if (
          !(await lockScimProfilePerson(
            tx,
            current.personId,
            current.organisationId,
          ))
        )
          return false;
        if (
          nextActive !== current.active &&
          !(await applyScimActiveStateInTransaction(
            tx,
            authority,
            authority.connectionId,
            id,
            nextActive,
          ))
        )
          return false;
        await lockAndVerifyScimMutation(tx, authority, "users");
        await tx
          .update(schema.personTable)
          .set({
            displayName: profile.value.name,
            jobTitle: profile.value.jobTitle ?? null,
            locale: profile.value.locale ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.personTable.id, current.personId));
        await tx
          .update(schema.externalIdentityTable)
          .set({
            userNameSnapshot: parsed.value.userName,
            emailSnapshot: profile.value.email,
          })
          .where(
            and(
              eq(schema.externalIdentityTable.id, id),
              eq(
                schema.externalIdentityTable.identityConnectionId,
                authority.connectionId,
              ),
            ),
          );
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: authority.connectionId,
          scimConnectionId: authority.connectionId,
          externalIdentityId: id,
          kind: "user.updated",
          outcome: "success",
          detail: { personId: current.personId, profileUpdated: true },
          actorType: "scim",
        });
        return true;
      }),
    );
    if (!updateSucceeded)
      return scimResponse(
        c.json(scimErrorBody(503, "Lifecycle operation unavailable"), 503),
      );
    const [row] = await db
      .select(userProjection)
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .where(
        and(
          ...scimUserPredicates(authority),
          eq(schema.externalIdentityTable.id, id),
        ),
      )
      .limit(1);
    return scimResponse(c.json(toScimUser(row as ScimUserRow) as never, 200));
  })
  .openapi(userPatchRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("users"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const { id } = c.req.valid("param");
    const raw: unknown = c.req.valid("json");
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      !Array.isArray((raw as { Operations?: unknown }).Operations) ||
      Object.keys(raw).some((key) => !["schemas", "Operations"].includes(key))
    )
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM patch"), 400),
      );
    const operations = (
      raw as {
        Operations: Array<{ op: string; path?: string; value: unknown }>;
      }
    ).Operations;
    const [current] = await db
      .select({
        id: schema.externalIdentityTable.id,
        personId: schema.externalIdentityTable.personId,
        organisationId: schema.personTable.organisationId,
        userName: schema.externalIdentityTable.userNameSnapshot,
        email: schema.externalIdentityTable.emailSnapshot,
        active: schema.personTable.active,
        displayName: schema.personTable.displayName,
        title: schema.personTable.jobTitle,
        locale: schema.personTable.locale,
      })
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .where(
        and(
          ...scimUserPredicates(authority),
          eq(schema.externalIdentityTable.id, id),
        ),
      )
      .limit(1);
    if (!current)
      return scimResponse(
        c.json(scimErrorBody(404, "Resource not found"), 404),
      );
    const currentResource = {
      userName: current.userName ?? undefined,
      email: current.email ?? undefined,
      active: current.active,
      ...(current.displayName
        ? {
            displayName: current.displayName,
            name: { formatted: current.displayName },
          }
        : {}),
      ...(current.title ? { title: current.title } : {}),
      ...(current.locale ? { preferredLanguage: current.locale } : {}),
    };
    const patched = applyScimPatchOps(currentResource, operations);
    if (!patched.ok)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM patch", patched.reason), 400),
      );
    const nextActive = patched.value.active ?? current.active;
    const mapping = await readScimProfileMapping(authority.connectionId);
    if (!mapping)
      return scimResponse(
        c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
      );
    const profile = mapScimProfile(patched.value, mapping, {
      complete: false,
      current: {
        name: current.displayName ?? undefined,
        email: current.email ?? undefined,
        jobTitle: current.title ?? undefined,
        locale: current.locale ?? undefined,
      },
    });
    if (!profile.ok)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM patch", profile.reason), 400),
      );
    const updateSucceeded = await retryIdentityGrantClosure(async () =>
      db.transaction(async (tx) => {
        if (
          !(await lockScimProfilePerson(
            tx,
            current.personId,
            current.organisationId,
          ))
        )
          return false;
        if (
          nextActive !== current.active &&
          !(await applyScimActiveStateInTransaction(
            tx,
            authority,
            authority.connectionId,
            id,
            nextActive,
          ))
        )
          return false;
        await lockAndVerifyScimMutation(tx, authority, "users");
        await tx
          .update(schema.personTable)
          .set({
            displayName: profile.value.name || current.displayName,
            jobTitle: profile.value.jobTitle ?? null,
            locale: profile.value.locale ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.personTable.id, current.personId));
        await tx
          .update(schema.externalIdentityTable)
          .set({
            userNameSnapshot: patched.value.userName ?? current.userName,
            emailSnapshot: profile.value.email || current.email,
          })
          .where(
            and(
              eq(schema.externalIdentityTable.id, id),
              eq(
                schema.externalIdentityTable.identityConnectionId,
                authority.connectionId,
              ),
            ),
          );
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: authority.connectionId,
          scimConnectionId: authority.connectionId,
          externalIdentityId: id,
          kind: "user.updated",
          outcome: "success",
          detail: { personId: current.personId, profileUpdated: true },
          actorType: "scim",
        });
        return true;
      }),
    );
    if (!updateSucceeded)
      return scimResponse(
        c.json(scimErrorBody(503, "Lifecycle operation unavailable"), 503),
      );
    const [row] = await db
      .select(userProjection)
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .where(
        and(
          ...scimUserPredicates(authority),
          eq(schema.externalIdentityTable.id, id),
        ),
      )
      .limit(1);
    return scimResponse(c.json(toScimUser(row as ScimUserRow) as never, 200));
  })
  .openapi(userDeleteRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("users"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const { id } = c.req.valid("param");
    const changed = await applyScimActiveState(
      authority,
      authority.connectionId,
      id,
      false,
    );
    if (!changed)
      return scimResponse(
        c.json(scimErrorBody(404, "Resource not found"), 404),
      );
    return scimResponse(c.body(null, 204));
  })
  .openapi(groupListRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("groups"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const query = c.req.valid("query");
    const startIndex = query.startIndex ?? 1;
    const pageCount = query.count ?? 100;
    const where = eq(
      schema.scimGroupTable.scimConnectionId,
      authority.connectionId,
    );
    const [total] = await db
      .select({ totalResults: sqlCount() })
      .from(schema.scimGroupTable)
      .where(where);
    const groups = await db
      .select({ id: schema.scimGroupTable.id })
      .from(schema.scimGroupTable)
      .where(where)
      .orderBy(schema.scimGroupTable.id)
      .limit(pageCount)
      .offset(startIndex - 1);
    const resources = await Promise.all(
      groups.map((group) => readScimGroup(authority.connectionId, group.id)),
    );
    const found = resources.filter((group) => group !== null);
    return scimResponse(
      c.json(
        {
          schemas: [SCIM_LIST_SCHEMA],
          totalResults: total?.totalResults ?? 0,
          startIndex,
          itemsPerPage: found.length,
          Resources: found,
        },
        200,
      ),
    );
  })
  .openapi(groupReadRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("groups"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const group = await readScimGroup(
      authority.connectionId,
      c.req.valid("param").id,
    );
    return group
      ? scimResponse(c.json(group as never, 200))
      : scimResponse(c.json(scimErrorBody(404, "Resource not found"), 404));
  })
  .openapi(groupCreateRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("groups"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const input = parseScimGroupResource(c.req.valid("json"));
    if (!input)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM group resource"), 400),
      );
    try {
      const id = await writeScimGroup({
        authority,
        connectionId: authority.connectionId,
        ...input,
      });
      if (!id)
        return scimResponse(
          c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
        );
      const resource = await readScimGroup(authority.connectionId, id);
      return resource
        ? scimResponse(c.json(resource as never, 201))
        : scimResponse(
            c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
          );
    } catch (error) {
      if (error instanceof ScimGroupWriteError) {
        if (error.status === 400)
          return scimResponse(
            c.json(scimErrorBody(400, "Invalid SCIM group resource"), 400),
          );
        if (error.status === 409)
          return scimResponse(
            c.json(
              scimErrorBody(409, "Resource already exists", "uniqueness"),
              409,
            ),
          );
        return scimResponse(
          c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
        );
      }
      if (isUniqueViolation(error))
        return scimResponse(
          c.json(
            scimErrorBody(409, "Resource already exists", "uniqueness"),
            409,
          ),
        );
      throw error;
    }
  })
  .openapi(groupReplaceRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("groups"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const { id } = c.req.valid("param");
    const input = parseScimGroupResource(c.req.valid("json"));
    if (!input)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM group resource"), 400),
      );
    try {
      const groupId = await writeScimGroup({
        authority,
        connectionId: authority.connectionId,
        groupId: id,
        ...input,
      });
      if (!groupId)
        return scimResponse(
          c.json(scimErrorBody(404, "Resource not found"), 404),
        );
      const resource = await readScimGroup(authority.connectionId, groupId);
      return resource
        ? scimResponse(c.json(resource as never, 200))
        : scimResponse(c.json(scimErrorBody(404, "Resource not found"), 404));
    } catch (error) {
      if (error instanceof ScimGroupWriteError) {
        if (error.status === 404)
          return scimResponse(
            c.json(scimErrorBody(404, "Resource not found"), 404),
          );
        if (error.status === 400)
          return scimResponse(
            c.json(scimErrorBody(400, "Invalid SCIM group resource"), 400),
          );
        return scimResponse(
          c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
        );
      }
      throw error;
    }
  })
  .openapi(groupPatchRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("groups"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const { id } = c.req.valid("param");
    const current = await readScimGroup(authority.connectionId, id);
    if (!current)
      return scimResponse(
        c.json(scimErrorBody(404, "Resource not found"), 404),
      );
    const operations = parseScimGroupPatch(c.req.valid("json"));
    if (!operations)
      return scimResponse(
        c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
      );
    let displayName = current.displayName;
    let active = current.active;
    const members = new Set<string>(
      current.members.map((member) => member.value),
    );
    for (const operation of operations) {
      const path = operation.path.toLowerCase();
      if (path === "displayname") {
        if (
          operation.op === "remove" ||
          typeof operation.value !== "string" ||
          !operation.value.trim() ||
          operation.value.length > 255
        )
          return scimResponse(
            c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
          );
        displayName = operation.value;
      } else if (path === "active") {
        if (operation.op === "remove" || typeof operation.value !== "boolean")
          return scimResponse(
            c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
          );
        active = operation.value;
      } else if (path === "members") {
        if (operation.op === "remove") {
          if (operation.value !== undefined)
            return scimResponse(
              c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
            );
          members.clear();
        } else {
          if (!Array.isArray(operation.value))
            return scimResponse(
              c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
            );
          const next = new Set<string>();
          for (const member of operation.value) {
            if (
              !isRecord(member) ||
              Object.keys(member).some(
                (key) => !["value", "type", "display"].includes(key),
              ) ||
              typeof member.value !== "string" ||
              member.value.length === 0 ||
              (member.type !== undefined && member.type !== "User") ||
              (member.display !== undefined &&
                typeof member.display !== "string")
            )
              return scimResponse(
                c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
              );
            next.add(member.value);
          }
          if (next.size !== operation.value.length)
            return scimResponse(
              c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
            );
          if (operation.op === "replace") {
            members.clear();
            for (const memberId of next) members.add(memberId);
          } else for (const memberId of next) members.add(memberId);
        }
      } else {
        const match = path.match(
          /^members\[value\s+eq\s+"([a-z0-9_-]{1,128})"\]$/iu,
        );
        if (!match?.[1])
          return scimResponse(
            c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
          );
        const memberId = match[1];
        if (operation.op === "remove") {
          if (operation.value !== undefined)
            return scimResponse(
              c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
            );
          members.delete(memberId);
        } else {
          if (
            !isRecord(operation.value) ||
            Object.keys(operation.value).some(
              (key) => !["value", "type", "display"].includes(key),
            ) ||
            operation.value.value !== memberId ||
            (operation.value.type !== undefined &&
              operation.value.type !== "User") ||
            (operation.value.display !== undefined &&
              typeof operation.value.display !== "string")
          )
            return scimResponse(
              c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
            );
          members.add(memberId);
        }
      }
    }
    try {
      const groupId = await writeScimGroup({
        authority,
        connectionId: authority.connectionId,
        groupId: id,
        externalId: current.externalId,
        displayName,
        active,
        memberIds: [...members],
      });
      const resource = groupId
        ? await readScimGroup(authority.connectionId, groupId)
        : null;
      return resource
        ? scimResponse(c.json(resource as never, 200))
        : scimResponse(c.json(scimErrorBody(404, "Resource not found"), 404));
    } catch (error) {
      if (error instanceof ScimGroupWriteError) {
        if (error.status === 404)
          return scimResponse(
            c.json(scimErrorBody(404, "Resource not found"), 404),
          );
        if (error.status === 400)
          return scimResponse(
            c.json(scimErrorBody(400, "Invalid SCIM group patch"), 400),
          );
        return scimResponse(
          c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
        );
      }
      throw error;
    }
  })
  .openapi(groupDeleteRoute, async (c) => {
    const authority = c.get("scimAuthority");
    if (!authority.allowedResources.includes("groups"))
      return scimResponse(
        c.json(
          scimErrorBody(403, "Resource is not allowed for this connection"),
          403,
        ),
      );
    const { id } = c.req.valid("param");
    const current = await readScimGroup(authority.connectionId, id);
    if (!current)
      return scimResponse(
        c.json(scimErrorBody(404, "Resource not found"), 404),
      );
    try {
      await writeScimGroup({
        authority,
        connectionId: authority.connectionId,
        groupId: id,
        externalId: current.externalId,
        displayName: current.displayName,
        active: false,
        memberIds: [],
      });
      return scimResponse(c.body(null, 204));
    } catch (error) {
      if (error instanceof ScimGroupWriteError) {
        if (error.status === 404)
          return scimResponse(
            c.json(scimErrorBody(404, "Resource not found"), 404),
          );
        return scimResponse(
          c.json(scimErrorBody(503, "SCIM configuration unavailable"), 503),
        );
      }
      throw error;
    }
  })
  .openapi(serviceProviderConfigRoute, (c) => {
    c.header("Content-Type", "application/scim+json; charset=utf-8");
    c.header("Cache-Control", "no-store");
    const response = c.json(
      {
        schemas: [
          "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
        ],
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 100 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [
          {
            type: "oauthbearertoken",
            name: "Bearer Token",
            description: "Per-connection SCIM bearer token",
            specUri: "https://www.rfc-editor.org/rfc/rfc6750",
            primary: true,
          },
        ],
      },
      200,
    );
    response.headers.set(
      "Content-Type",
      "application/scim+json; charset=utf-8",
    );
    return response;
  })
  .openapi(resourceTypesRoute, (c) => {
    const resources = [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "User",
        name: "User",
        endpoint: "/Users",
        schema: "urn:ietf:params:scim:schemas:core:2.0:User",
        meta: { resourceType: "ResourceType" },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "Group",
        name: "Group",
        endpoint: "/Groups",
        schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
        meta: { resourceType: "ResourceType" },
      },
    ];
    c.header("Content-Type", "application/scim+json; charset=utf-8");
    c.header("Cache-Control", "no-store");
    const response = c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: resources.length,
        startIndex: 1,
        itemsPerPage: resources.length,
        Resources: resources,
      },
      200,
    );
    response.headers.set(
      "Content-Type",
      "application/scim+json; charset=utf-8",
    );
    return response;
  })
  .openapi(schemasRoute, (c) => {
    const resources = [
      {
        id: "urn:ietf:params:scim:schemas:core:2.0:User",
        name: "User",
        description: "SCIM user resource",
        attributes: [],
        meta: { resourceType: "Schema" },
      },
      {
        id: "urn:ietf:params:scim:schemas:core:2.0:Group",
        name: "Group",
        description: "SCIM group resource",
        attributes: [],
        meta: { resourceType: "Schema" },
      },
    ];
    c.header("Content-Type", "application/scim+json; charset=utf-8");
    c.header("Cache-Control", "no-store");
    const response = c.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: resources.length,
        startIndex: 1,
        itemsPerPage: resources.length,
        Resources: resources,
      },
      200,
    );
    response.headers.set(
      "Content-Type",
      "application/scim+json; charset=utf-8",
    );
    return response;
  });
