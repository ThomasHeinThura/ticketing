import { resolveFeatureFlag } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
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
import {
  acceptSubmission,
  claimSubmission,
  createRequestType,
  createSubmission,
  declineSubmission,
  deleteRequestType,
  findPortalSubmission,
  findSubmission,
  getRequestType,
  listOwnSubmissions,
  listRequestTypes,
  listSubmissions,
  markSubmissionDuplicate,
  portalCatalogue,
  portalIdentity,
  postSubmissionMessage,
  publishRequestType,
  requestTypeWorkspace,
  setRequestTypePublished,
  suggestDuplicateWorkItems,
  updateRequestType,
  withdrawSubmission,
} from "./repository";
import {
  acceptBody,
  createRequestTypeBody,
  declineBody,
  duplicateBody,
  messageBody,
  requestTypeIdParam,
  requestTypeKeyParam,
  submissionBody,
  submissionRefParam,
  updateRequestTypeBody,
  workspaceQuery,
} from "./schema";

type IntakeVariables = BaseVariables & {
  workspaceId: string;
  workspaceIdSource: "request" | "row";
  portalPredicateSatisfied: boolean;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
};
type IntakeContext = Context<{ Variables: IntakeVariables }>;
const requestTypeSchema = z.object({
  id: z.string(),
  key: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  group: z.string(),
  workItemTypeId: z.string(),
  defaultProjectId: z.string().nullable(),
  formSchema: z.unknown(),
  slaPolicyId: z.string().nullable(),
  defaultAssigneeId: z.string().nullable(),
  autoAccept: z.boolean(),
  customerVisible: z.boolean(),
  forcePrivate: z.boolean(),
  published: z.boolean(),
  position: z.number(),
  version: z.number(),
});
const savedRequestTypeSchema = requestTypeSchema.extend({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const submissionMessageSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  actorType: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
});
const submissionResponseSchema = z.object({
  submission: z.unknown(),
  requestType: z.unknown(),
  version: z.unknown(),
  messages: z.array(submissionMessageSchema),
  ref: z.string(),
});
const portalSubmissionResponseSchema = z.object({
  ref: z.string(),
  submission: z.object({
    state: z.string(),
    formData: z.record(z.string(), z.unknown()),
    customerVisibility: z.string(),
    createdAt: z.string().datetime(),
  }),
  canWithdraw: z.boolean(),
  requestType: z.object({
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    group: z.string(),
  }),
  version: z.object({
    formSchema: z.object({
      fields: z.array(
        z.object({
          key: z.string(),
          type: z.string(),
          label: z.string(),

          multiple: z.boolean().optional(),
        }),
      ),
    }),
  }),
  workItem: z
    .object({ key: z.string(), title: z.string(), state: z.string() })
    .nullable(),
  messages: z.array(
    z.object({
      id: z.string(),
      actorType: z.string(),
      body: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
});
const portalSubmissionListResponseSchema = z.object({
  submissions: z.array(
    z.object({
      ref: z.string(),
      state: z.string(),
      createdAt: z.string().datetime(),
      customerVisibility: z.string(),
      requestTypeName: z.string(),
    }),
  ),
  page: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
  meta: z.object({ total: z.number() }),
});
const createdSubmissionSchema = z.object({
  id: z.string(),
  number: z.number(),
  ref: z.string(),
  state: z.string(),
  createdAt: z.string().datetime(),
});
const queryList = workspaceQuery.extend({
  state: z
    .enum([
      "new",
      "clarifying",
      "accepted",
      "declined",
      "duplicate",
      "withdrawn",
    ])
    .optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.string().optional(),
});
const portalListQuery = z.object({
  cursor: z.string().max(2048).optional(),
  limit: z.string().optional(),
});
const searchQuery = z.object({ q: z.string().trim().max(200).default("") });

function notFound(message: string): never {
  throw new HTTPException(404, { message });
}

function parseCollectionLimit(value?: string) {
  if (value === undefined) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new HTTPException(400, {
      message: "Limit must be an integer from 1 to 200",
    });
  return limit;
}

function requestTypeResponse(
  row: Awaited<ReturnType<typeof createRequestType>>,
) {
  return {
    ...row,
    formSchema: row.formSchema as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requestTypeReach(c: IntakeContext, next: Next) {
  const id = c.req.param("id");
  if (!id)
    throw new HTTPException(400, { message: "Request type id is required" });
  const row = await requestTypeWorkspace(id);
  if (!row) return notFound("Request type not found");
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      row.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      return notFound("Request type not found");
    throw error;
  }
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

async function submissionReach(c: IntakeContext, next: Next) {
  const ref = c.req.param("ref");
  if (!ref)
    throw new HTTPException(400, {
      message: "Submission reference is required",
    });
  const row = await findSubmission(ref);
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      row.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      return notFound("Submission not found");
    throw error;
  }
  await requireIntakeEnabled(row.workspaceId);
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

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

async function requestTypeCollectionScope(c: IntakeContext, next: Next) {
  const query = c.req.query("workspaceId");
  if (!query)
    throw new HTTPException(400, { message: "workspaceId is required" });
  await requireIntakeEnabled(query);
  c.set("workspaceId", query);
  c.set("workspaceIdSource", "request");
  await next();
}

async function portalOrganisation(c: IntakeContext, next: Next) {
  const identity = await portalIdentity(c.get("userId"));
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", identity.organisationId);
  c.set("policyOrganisationIdSource", "row");
  await next();
}

async function portalOwnSubmission(c: IntakeContext, next: Next) {
  const identity = await portalIdentity(c.get("userId"));
  const ref = c.req.param("ref");
  if (!ref) return notFound("Submission not found");
  const row = await findSubmission(ref, undefined, identity.personId);
  await requireIntakeEnabled(row.workspaceId);
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", identity.organisationId);
  c.set("policyOrganisationIdSource", "row");
  // The query above constrains this request to its requester; the reference is never a credential.
  void row;
  await next();
}

const listRoute = createRoute({
  method: "get",
  operationId: "listRequestTypes",
  path: "/request-types",
  tags: ["Request types"],
  summary: "List request types",
  middleware: [
    requestTypeCollectionScope,
    requireApiKeyPermissionScope({ request_type: ["read"] }),
    requireWorkspaceCapability("request_type:read"),
  ] as const,
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "Request types",
      z.object({ requestTypes: z.array(savedRequestTypeSchema) }),
    ),
    403: errorResponse("Missing request type read capability"),
  },
});
const createRouteDef = createRoute({
  method: "post",
  operationId: "createRequestType",
  path: "/request-types",
  tags: ["Request types"],
  summary: "Create a request type",
  middleware: [
    requestTypeCollectionScope,
    requireApiKeyPermissionScope({ request_type: ["manage"] }),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: {
    query: workspaceQuery,
    body: {
      required: true,
      content: { "application/json": { schema: createRequestTypeBody } },
    },
  },
  responses: {
    200: jsonResponse("Created request type", savedRequestTypeSchema),
    403: errorResponse("Missing request type manage capability"),
  },
});
const detailRoute = createRoute({
  method: "get",
  operationId: "getRequestType",
  path: "/request-types/{id}",
  tags: ["Request types"],
  summary: "Get a request type and published history",
  middleware: [
    requestTypeReach,
    requireApiKeyPermissionScope({ request_type: ["read"] }),
    requireWorkspaceCapability("request_type:read"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    200: jsonResponse(
      "Request type and versions",
      z.object({
        ...savedRequestTypeSchema.shape,
        versions: z.array(z.unknown()),
      }),
    ),
    404: errorResponse("Request type not found"),
  },
});
const patchRoute = createRoute({
  method: "patch",
  operationId: "updateRequestType",
  path: "/request-types/{id}",
  tags: ["Request types"],
  summary: "Update a request type draft",
  middleware: [
    requestTypeReach,
    requireApiKeyPermissionScope({ request_type: ["manage"] }),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: {
    params: requestTypeIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateRequestTypeBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated request type", savedRequestTypeSchema),
    404: errorResponse("Request type not found"),
    409: errorResponse("Request type changed"),
  },
});
const publishRoute = createRoute({
  method: "post",
  operationId: "publishRequestType",
  path: "/request-types/{id}/publish",
  tags: ["Request types"],
  summary: "Publish an immutable form version",
  middleware: [
    requestTypeReach,
    requireApiKeyPermissionScope({ request_type: ["manage"] }),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    200: jsonResponse(
      "Published request type",
      z.object({ requestType: savedRequestTypeSchema, version: z.unknown() }),
    ),
    404: errorResponse("Request type not found"),
    422: errorResponse("Request type form is not publishable"),
  },
});
const unpublishRoute = createRoute({
  method: "post",
  operationId: "unpublishRequestType",
  path: "/request-types/{id}/unpublish",
  tags: ["Request types"],
  summary: "Unpublish a request type",
  middleware: [
    requestTypeReach,
    requireApiKeyPermissionScope({ request_type: ["manage"] }),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    200: jsonResponse("Unpublished request type", savedRequestTypeSchema),
    404: errorResponse("Request type not found"),
  },
});
const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteRequestType",
  path: "/request-types/{id}",
  tags: ["Request types"],
  summary: "Delete an unpublished request type without submissions",
  middleware: [
    requestTypeReach,
    requireApiKeyPermissionScope({ request_type: ["manage"] }),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    200: jsonResponse("Deleted", z.object({ deleted: z.literal(true) })),
    404: errorResponse("Request type not found"),
    409: errorResponse("Request type cannot be deleted"),
  },
});
const catalogueRoute = createRoute({
  method: "get",
  operationId: "getPortalCatalogue",
  path: "/portal/catalogue",
  tags: ["Portal catalogue"],
  summary: "List the caller organisation's request types",
  middleware: [portalOrganisation] as const,
  request: { query: searchQuery },
  responses: {
    200: jsonResponse(
      "Visible catalogue",
      z.object({
        defaultCustomerVisibility: z.enum(["private", "organisation"]),
        requestTypes: z.array(
          z.object({
            key: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            icon: z.string().nullable(),
            group: z.string(),
            position: z.number(),
            forcePrivate: z.boolean(),
            formSchema: z.unknown(),
            version: z.number(),
          }),
        ),
      }),
    ),
  },
});
const catalogueDetailRoute = createRoute({
  method: "get",
  operationId: "getPortalRequestType",
  path: "/portal/catalogue/{key}",
  tags: ["Portal catalogue"],
  summary: "Get a visible request type form",
  middleware: [portalOrganisation] as const,
  request: { params: requestTypeKeyParam },
  responses: {
    200: jsonResponse(
      "Versioned request form",
      z.object({
        key: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        formSchema: z.unknown(),
        version: z.number(),
      }),
    ),
    404: errorResponse("Request type not found"),
  },
});
const createSubmissionRoute = createRoute({
  method: "post",
  operationId: "createPortalSubmission",
  path: "/portal/submissions",
  tags: ["Portal submissions"],
  summary: "Submit a request",
  middleware: [portalOrganisation] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: submissionBody } },
    },
  },
  responses: {
    200: jsonResponse("Created submission", createdSubmissionSchema),
    404: errorResponse(
      "Request type not found in this organisation's catalogue",
    ),
    422: errorResponse("Form answers do not match the published form"),
  },
});
const listSubmissionsRoute = createRoute({
  method: "get",
  operationId: "listSubmissions",
  path: "/submissions",
  tags: ["Intake"],
  summary: "List submissions for triage",
  middleware: [
    requestTypeCollectionScope,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { query: queryList },
  responses: {
    200: jsonResponse(
      "Submission queue",
      z.object({
        submissions: z.array(z.unknown()),
        page: z.object({
          nextCursor: z.string().nullable(),
          hasMore: z.boolean(),
        }),
        meta: z.object({ total: z.number() }),
      }),
    ),
    403: errorResponse("Missing triage capability"),
  },
});
const submissionDetailRoute = createRoute({
  method: "get",
  operationId: "getSubmission",
  path: "/submissions/{ref}",
  tags: ["Intake"],
  summary: "Get a submission and its thread",
  middleware: [
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse("Submission detail", submissionResponseSchema),
    404: errorResponse("Submission not found"),
  },
});
const claimRoute = createRoute({
  method: "post",
  operationId: "claimSubmission",
  path: "/submissions/{ref}/claim",
  tags: ["Intake"],
  summary: "Claim a submission for triage",
  middleware: [
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse(
      "Claimed submission",
      z.object({
        id: z.string(),
        ref: z.string(),
        state: z.string(),
        claimedBy: z.string().nullable(),
        claimedAt: z.date().nullable(),
      }),
    ),
    409: errorResponse("Submission is no longer claimable"),
  },
});
const acceptRoute = createRoute({
  method: "post",
  operationId: "acceptSubmission",
  path: "/submissions/{ref}/accept",
  tags: ["Intake"],
  summary: "Convert a submission into a work item",
  middleware: [
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: acceptBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Accepted submission",
      z.object({
        ref: z.string(),
        state: z.literal("accepted"),
        workItem: z.unknown(),
      }),
    ),
    409: errorResponse("Submission is no longer open"),
    422: errorResponse("Destination unavailable"),
  },
});
const duplicateRoute = createRoute({
  method: "post",
  operationId: "markSubmissionDuplicate",
  path: "/submissions/{ref}/duplicate",
  tags: ["Intake"],
  summary: "Link a submission to an existing work item",
  middleware: [
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: duplicateBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Linked duplicate",
      z.object({ ref: z.string(), state: z.string(), workItem: z.unknown() }),
    ),
    409: errorResponse("Submission is no longer open"),
    404: errorResponse("Work item not found"),
  },
});
const duplicateSuggestionsRoute = createRoute({
  method: "get",
  operationId: "suggestSubmissionDuplicates",
  path: "/submissions/{ref}/duplicates",
  tags: ["Intake"],
  summary: "Suggest similar work items in the same organisation",
  middleware: [
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse(
      "Potential duplicate work items",
      z.object({
        suggestions: z.array(
          z.object({
            id: z.string(),
            key: z.string(),
            title: z.string(),
            score: z.number(),
          }),
        ),
      }),
    ),
  },
});
const declineRoute = createRoute({
  method: "post",
  operationId: "declineSubmission",
  path: "/submissions/{ref}/decline",
  tags: ["Intake"],
  summary: "Decline with a customer-visible reason",
  middleware: [
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: declineBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Declined submission",
      z.object({
        ref: z.string(),
        state: z.string(),
        reason: z.string(),
        message: z.unknown(),
      }),
    ),
    409: errorResponse("Submission is no longer open"),
  },
});
const staffMessageRoute = createRoute({
  method: "post",
  operationId: "askSubmissionClarification",
  path: "/submissions/{ref}/messages",
  tags: ["Intake"],
  summary: "Ask for clarification",
  middleware: [
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: messageBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Clarification posted",
      z.object({
        id: z.string(),
        ref: z.string(),
        state: z.string(),
        message: submissionMessageSchema,
      }),
    ),
  },
});
const portalListRoute = createRoute({
  method: "get",
  operationId: "listOwnPortalSubmissions",
  path: "/portal/submissions",
  tags: ["Portal submissions"],
  summary: "List the caller's submissions",
  middleware: [portalOrganisation] as const,
  request: { query: portalListQuery },
  responses: {
    200: jsonResponse("Submissions", portalSubmissionListResponseSchema),
  },
});
const portalDetailRoute = createRoute({
  method: "get",
  operationId: "getOwnPortalSubmission",
  path: "/portal/submissions/{ref}",
  tags: ["Portal submissions"],
  summary: "Get the caller's durable submission page",
  middleware: [portalOwnSubmission] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse("Submission page", portalSubmissionResponseSchema),
    404: errorResponse("Submission not found"),
  },
});
const portalMessageRoute = createRoute({
  method: "post",
  operationId: "replyToPortalSubmission",
  path: "/portal/submissions/{ref}/messages",
  tags: ["Portal submissions"],
  summary: "Reply to a clarification",
  middleware: [portalOwnSubmission] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: messageBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Reply posted",
      z.object({
        id: z.string(),
        ref: z.string(),
        state: z.string(),
        message: submissionMessageSchema,
      }),
    ),
    409: errorResponse("Submission cannot receive a reply"),
  },
});
const withdrawRoute = createRoute({
  method: "post",
  operationId: "withdrawPortalSubmission",
  path: "/portal/submissions/{ref}/withdraw",
  tags: ["Portal submissions"],
  summary: "Withdraw an unclaimed submission",
  middleware: [portalOwnSubmission] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse(
      "Withdrawn submission",
      z.object({ ref: z.string(), state: z.string(), version: z.number() }),
    ),
    409: errorResponse("Triage has already started"),
  },
});

const requestTypeRouter = apiRouter<IntakeVariables>()
  .openapi(listRoute, async (c) =>
    c.json(
      {
        requestTypes: (
          await listRequestTypes(c.req.valid("query").workspaceId)
        ).map(requestTypeResponse),
      },
      200,
    ),
  )
  .openapi(createRouteDef, async (c) =>
    c.json(
      requestTypeResponse(
        await createRequestType(
          {
            ...c.req.valid("json"),
            workspaceId: c.req.valid("query").workspaceId,
          } as Parameters<typeof createRequestType>[0],
          c.get("userId"),
        ),
      ),
      200,
    ),
  )
  .openapi(detailRoute, async (c) => {
    const detail = await getRequestType(c.req.valid("param").id);
    return c.json(
      { ...requestTypeResponse(detail), versions: detail.versions },
      200,
    );
  })
  .openapi(patchRoute, async (c) => {
    const { version, ...body } = c.req.valid("json");
    return c.json(
      requestTypeResponse(
        await updateRequestType(
          c.req.valid("param").id,
          body as Parameters<typeof updateRequestType>[1],
          version,
          c.get("userId"),
        ),
      ),
      200,
    );
  })
  .openapi(publishRoute, async (c) => {
    const published = await publishRequestType(
      c.req.valid("param").id,
      c.get("userId"),
    );
    return c.json(
      {
        requestType: requestTypeResponse(published.requestType),
        version: published.version,
      },
      200,
    );
  })
  .openapi(unpublishRoute, async (c) =>
    c.json(
      requestTypeResponse(
        await setRequestTypePublished(
          c.req.valid("param").id,
          false,
          c.get("userId"),
        ),
      ),
      200,
    ),
  )
  .openapi(deleteRoute, async (c) =>
    c.json(
      await deleteRequestType(c.req.valid("param").id, c.get("userId")),
      200,
    ),
  )
  .openapi(catalogueRoute, async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    const rows = await portalCatalogue(
      identity.organisationId,
      c.req.valid("query").q,
    );
    const [organisation] = await db
      .select({
        defaultCustomerVisibility:
          schema.organisationTable.defaultCustomerVisibility,
      })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.id, identity.organisationId))
      .limit(1);
    return c.json(
      {
        defaultCustomerVisibility:
          organisation?.defaultCustomerVisibility === "private"
            ? ("private" as const)
            : ("organisation" as const),
        requestTypes: rows.map(({ type, version }) => ({
          key: type.key,
          name: type.name,
          description: type.description,
          icon: type.icon,
          group: type.group,
          position: type.position,
          forcePrivate: type.forcePrivate,
          formSchema: version.formSchema,
          version: version.number,
        })),
      },
      200,
    );
  })
  .openapi(catalogueDetailRoute, async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    const found = (await portalCatalogue(identity.organisationId)).find(
      (row) => row.type.key === c.req.valid("param").key,
    );
    if (!found) notFound("Request type not found");
    return c.json(
      {
        key: found.type.key,
        name: found.type.name,
        description: found.type.description,
        formSchema: found.version.formSchema,
        version: found.version.number,
      },
      200,
    );
  })
  .openapi(createSubmissionRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createSubmission({ userId: c.get("userId"), ...body }),
      200,
    );
  });

const intakeSubmissionRouter = apiRouter<IntakeVariables>()
  .openapi(listSubmissionsRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await listSubmissions(
        query.workspaceId,
        query.state ? [query.state] : undefined,
        query.cursor,
        parseCollectionLimit(query.limit),
      ),
      200,
    );
  })
  .openapi(submissionDetailRoute, async (c) =>
    c.json(
      await findSubmission(c.req.valid("param").ref, c.get("workspaceId")),
      200,
    ),
  )
  .openapi(claimRoute, async (c) =>
    c.json(
      await claimSubmission(
        c.req.valid("param").ref,
        c.get("workspaceId"),
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(acceptRoute, async (c) =>
    c.json(
      await acceptSubmission(
        c.req.valid("param").ref,
        c.get("workspaceId"),
        c.get("userId"),
        c.req.valid("json").projectId,
        c.req.valid("json").workItemTypeId,
      ),
      200,
    ),
  );

const triageActionRouter = apiRouter<IntakeVariables>()
  .openapi(duplicateRoute, async (c) =>
    c.json(
      await markSubmissionDuplicate(
        c.req.valid("param").ref,
        c.get("workspaceId"),
        c.get("userId"),
        c.req.valid("json").workItemId,
      ),
      200,
    ),
  )
  .openapi(duplicateSuggestionsRoute, async (c) =>
    c.json(
      {
        suggestions: await suggestDuplicateWorkItems(
          c.req.valid("param").ref,
          c.get("workspaceId"),
        ),
      },
      200,
    ),
  )
  .openapi(declineRoute, async (c) =>
    c.json(
      await declineSubmission(
        c.req.valid("param").ref,
        c.get("workspaceId"),
        c.get("userId"),
        c.req.valid("json").reason,
      ),
      200,
    ),
  )
  .openapi(staffMessageRoute, async (c) =>
    c.json(
      await postSubmissionMessage({
        ref: c.req.valid("param").ref,
        workspaceId: c.get("workspaceId"),
        actorId: c.get("userId"),
        actorType: "triager",
        body: c.req.valid("json").body,
      }),
      200,
    ),
  );

const portalSubmissionRouter = apiRouter<IntakeVariables>().openapi(
  portalListRoute,
  async (c) => {
    const query = c.req.valid("query");
    const result = await listOwnSubmissions(
      c.get("userId"),
      query.cursor,
      parseCollectionLimit(query.limit),
    );
    return c.json(
      {
        ...result,
        submissions: result.submissions.map(
          ({ submission, requestType, ref }) => ({
            ref,
            state: submission.state,
            createdAt: submission.createdAt.toISOString(),
            customerVisibility: submission.customerVisibility,
            requestTypeName: requestType.name,
          }),
        ),
      },
      200,
    );
  },
);

const portalDetailRouter = apiRouter<IntakeVariables>().openapi(
  portalDetailRoute,
  async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    return c.json(
      await findPortalSubmission(c.req.valid("param").ref, identity.personId),
      200,
    );
  },
);

const portalMessageRouter = apiRouter<IntakeVariables>().openapi(
  portalMessageRoute,
  async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    return c.json(
      await postSubmissionMessage({
        ref: c.req.valid("param").ref,
        requesterId: identity.personId,
        actorId: identity.personId,
        actorType: "customer",
        body: c.req.valid("json").body,
      }),
      200,
    );
  },
);

const portalWithdrawRouter = apiRouter<IntakeVariables>().openapi(
  withdrawRoute,
  async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    return c.json(
      await withdrawSubmission(c.req.valid("param").ref, identity.personId),
      200,
    );
  },
);

const router = requestTypeRouter
  .route("/", intakeSubmissionRouter)
  .route("/", triageActionRouter)
  .route("/", portalSubmissionRouter)
  .route("/", portalDetailRouter)
  .route("/", portalMessageRouter)
  .route("/", portalWithdrawRouter);

export default router;
