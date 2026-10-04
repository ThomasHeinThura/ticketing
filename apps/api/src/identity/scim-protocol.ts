import { and, eq, count as sqlCount } from "drizzle-orm";
import db, { schema } from "../database";
import type { BaseVariables } from "../openapi";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import {
  resolveScimBearer,
  type ScimRequestAuthority,
} from "./scim-authentication";

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

const scimListSchema = z.record(z.string(), z.unknown());
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
        Resources: z.array(z.record(z.string(), z.unknown())),
      }),
    ),
  },
});

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
