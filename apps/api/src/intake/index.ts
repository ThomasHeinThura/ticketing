import { resolveFeatureFlag } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { getActiveStaffPerson } from "../instance/users/repository";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import {
  listReachOf,
  requireReachContext,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import {
  apiKeyScopeSatisfies,
  requireApiKeyPermissionScope,
} from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { intakeAuditContext } from "./audit";
import {
  REQUEST_TYPE_DELETION_ROUTE,
  requestTypeDeletionBlockers,
  requestTypeDeletionRefusal,
} from "./deletion-target";
import { suggestDuplicatesForQueueRows } from "./duplicate-suggestions";
import { parseSubmissionListFilters } from "./list-filters";
import {
  escalatePortalPriority,
  ratePortalSubmission,
  reopenPortalSubmission,
} from "./portal-actions";
import {
  listPortalBacklog,
  portalBacklogPageSchema,
  portalBacklogQuerySchema,
  rankPortalBacklog,
  rankPortalBacklogBodySchema,
  rankPortalBacklogResponseSchema,
} from "./portal-backlog";
import { PORTAL_CUSTOMER_STATUSES } from "./portal-status";
import {
  acceptSubmission,
  claimSubmission,
  createRequestType,
  createSubmission,
  declineSubmission,
  findPortalSubmission,
  findSubmission,
  findSubmissionSatisfaction,
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
  requestTypeVersionSchema,
  staffQueueRowSchema,
  staffRequestTypeRefSchema,
  staffSubmissionSchema,
  submissionMessageSchema,
  submissionWorkItemSchema,
  toRequestTypeVersion,
  toStaffRequestTypeRef,
  toStaffSubmission,
  toSubmissionMessage,
  toSubmissionWorkItem,
} from "./response";
import {
  acceptBody,
  createRequestTypeBody,
  declineBody,
  duplicateBody,
  escalatePriorityBody,
  messageBody,
  requestTypeIdParam,
  requestTypeKeyParam,
  satisfactionBody,
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
const submissionResponseSchema = z.object({
  submission: staffSubmissionSchema,
  requestType: staffRequestTypeRefSchema,
  version: requestTypeVersionSchema,
  messages: z.array(submissionMessageSchema),
  ref: z.string(),
  /** CP-9: the requester's rating of the resolution, for staff; null until rated. */
  satisfaction: z
    .object({
      rating: z.number().int(),
      comment: z.string().nullable(),
      ratedAt: z.string().datetime(),
    })
    .nullable(),
});
const portalSlaSchema = z.object({
  state: z.enum(["on_track", "at_risk", "breached", "met", "missed"]),
  dueAt: z.string().datetime().nullable(),
  /** Which target `dueAt` describes: a first staff response, or the resolution. */
  metric: z.enum(["first_response", "resolution"]),
});
const portalCustomerStatusSchema = z.enum(PORTAL_CUSTOMER_STATUSES);
const portalSubmissionResponseSchema = z.object({
  ref: z.string(),
  submission: z.object({
    state: z.string(),
    formData: z.record(z.string(), z.unknown()),
    customerVisibility: z.string(),
    createdAt: z.string().datetime(),
  }),
  /** CP-5: the customer-safe status; the only status the portal renders. */
  customerStatus: portalCustomerStatusSchema,
  /** CP-16: true for the requester; a colleague or participant has a read-only view. */
  isRequester: z.boolean(),
  /** CP-16: attachments stay requester-only (list, download, upload); other readers get false so the UI hides them. */
  canViewAttachments: z.boolean(),
  canUpload: z.boolean(),
  canWithdraw: z.boolean(),
  /** CP-7: the requester may still raise the priority (open request, a higher priority exists). */
  canEscalate: z.boolean(),
  /** CP-8 / IQ-15: reopen is available (auto-declined submission, or resolved inside the window). */
  canReopen: z.boolean(),
  /** CP-9: a rating can be given (resolved) or changed (inside the window). */
  canRate: z.boolean(),
  satisfaction: z
    .object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().nullable(),
      ratedAt: z.string().datetime(),
    })
    .nullable(),
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
    .object({
      title: z.string(),
      description: z.string(),
      priority: z.string().nullable(),
      resolvedAt: z.string().datetime().nullable(),
      /** SLA-21: customer-safe projection; null when no SLA applies. */
      sla: portalSlaSchema.nullable(),
    })
    .nullable(),
  /**
   * CF-11: the customer-visible custom fields of the linked work item that currently hold a
   * value. A label and a value only: no ids, options, conditions or staff people.
   */
  customFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      format: z.string(),
      helpText: z.string().nullable(),
      value: z.unknown(),
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string(),
      /** `customer`, `triager` (staff) or `system` (IQ-15 auto-decline); never a person id. */
      actorType: z.enum(["customer", "triager", "system"]),
      /** CP-4: only staff who act publicly are named; always null for a customer. */
      authorName: z.string().nullable(),
      /** True for the viewer's own message. */
      mine: z.boolean(),
      body: z.string(),
      /** A system message's stable reason (`P2R1-05`), rendered in the customer's locale. */
      reasonCode: z.string().nullable(),
      reasonParams: z.record(z.string(), z.unknown()).nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
});
type PortalSubmissionResponse = z.infer<typeof portalSubmissionResponseSchema>;
const portalSubmissionListResponseSchema = z.object({
  submissions: z.array(
    z.object({
      ref: z.string(),
      state: z.string(),
      createdAt: z.string().datetime(),
      customerVisibility: z.string(),
      requestTypeName: z.string(),
      /** CP-16: false for an organisation colleague's request. */
      isRequester: z.boolean(),
      /** CP-5: the customer-safe status. */
      customerStatus: portalCustomerStatusSchema,
      /** CP-6: customer-safe due time and plain state; null with no work item or no SLA. */
      sla: portalSlaSchema.nullable(),
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
  // IQ-21: server-side queue filters (see ./list-filters).
  requestTypeKey: z.string().max(200).optional(),
  assignee: z.string().max(200).optional(),
  olderThanDays: z.string().max(4).optional(),
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
): z.infer<typeof savedRequestTypeSchema> {
  return {
    ...row,
    formSchema: row.formSchema as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Triage writes record the acting STAFF PERSON, not the auth user: `submission.claimed_by`
 * and the comment author reference `person.id`, so passing `c.get("userId")` violated the
 * foreign key and surfaced as a 500. An API key acts as its owning user's staff person.
 */
async function triagerPersonId(c: IntakeContext): Promise<string> {
  const [person] = await getActiveStaffPerson(c.get("userId"));
  if (!person)
    throw new HTTPException(403, { message: "Active staff person required" });
  return person.id;
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
  await requireIntakeEnabled(row.workspaceId);
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
  const identity = await resolveCallerIdentity(c, c.get("userId"));
  if (!identity) return notFound("Submission not found");
  const row = await findSubmission(ref, undefined, undefined, identity);
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

/**
 * `CP-16`: read access. The requester, a participant, or (for an organisation-visible request)
 * a customer of the same organisation; every other caller gets the constant 404. Write actions
 * keep `portalOwnSubmission` (requester only).
 */
async function portalReadableSubmission(c: IntakeContext, next: Next) {
  const identity = await portalIdentity(c.get("userId"));
  const ref = c.req.param("ref");
  if (!ref) return notFound("Submission not found");
  const row = await findSubmission(ref, undefined, undefined, undefined, {
    personId: identity.personId,
    organisationId: identity.organisationId,
  });
  await requireIntakeEnabled(row.workspaceId);
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", identity.organisationId);
  c.set("policyOrganisationIdSource", "row");
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
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
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
        versions: z.array(requestTypeVersionSchema),
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
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
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
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
    requestTypeReach,
    requireApiKeyPermissionScope({ request_type: ["manage"] }),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    200: jsonResponse(
      "Published request type",
      z.object({
        requestType: savedRequestTypeSchema,
        version: requestTypeVersionSchema,
      }),
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
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
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
const deleteRequestTypeRoute = createRoute({
  method: "delete",
  operationId: "deleteRequestType",
  path: "/request-types/{id}",
  tags: ["Request types"],
  summary: "Delete an unpublished, unused request type",
  description:
    "Request deletion (202 pending action, click approval). Refused while the request type is published or has any submission.",
  middleware: [
    requestTypeReach,
    requireApiKeyPermissionScope({ request_type: ["manage"] }),
    requireWorkspaceCapability("request_type:manage"),
  ] as const,
  request: { params: requestTypeIdParam },
  responses: {
    202: jsonResponse(
      "Deletion awaiting approval",
      registeredDeletionRequestSchema,
    ),
    404: errorResponse("Request type not found"),
    409: errorResponse("Request type is published or has submissions"),
  },
});
const portalCatalogueResponseSchema = z.object({
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
});
const portalCatalogueDetailResponseSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  formSchema: z.unknown(),
  version: z.number(),
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
    200: jsonResponse("Visible catalogue", portalCatalogueResponseSchema),
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
      portalCatalogueDetailResponseSchema,
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
  middleware: [intakeAuditContext, portalOrganisation] as const,
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
async function duplicateReadableProjectIds(c: Context): Promise<string[]> {
  if (!apiKeyScopeSatisfies(c.get("apiKey"), { work_item: ["read"] }))
    return [];
  const workspaceId = c.get("workspaceId");
  const reach = listReachOf(c);
  const reachable = new Set(await reach.reachableProjectIds([workspaceId]));
  const candidates = (await reach.projectFactsFor([workspaceId])).filter(
    (project) =>
      reachable.has(project.id) && !project.deleted && !project.archived,
  );
  return (
    await Promise.all(
      candidates.map(async (project) =>
        (await reach.can("work_item:read", {
          projectId: project.id,
          workspaceId,
          organisationId: project.organisationId,
        }))
          ? project.id
          : null,
      ),
    )
  ).filter((id): id is string => id !== null);
}

const listSubmissionsRoute = createRoute({
  method: "get",
  operationId: "listSubmissions",
  path: "/submissions",
  tags: ["Intake"],
  summary: "List submissions for triage",
  middleware: [
    requestTypeCollectionScope,
    requireReachFilteredList,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { query: queryList },
  responses: {
    200: jsonResponse(
      "Submission queue",
      z.object({
        submissions: z.array(staffQueueRowSchema),
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
    requireReachContext,
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
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
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
        claimedAt: z.string().datetime().nullable(),
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
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
    requireReachContext,
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
        workItem: submissionWorkItemSchema,
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
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
    submissionReach,
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
    requireReachContext,
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
      z.object({
        ref: z.string(),
        state: z.string(),
        workItem: submissionWorkItemSchema,
      }),
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
    requireReachFilteredList,
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
    404: errorResponse("Submission not found"),
  },
});
const declineRoute = createRoute({
  method: "post",
  operationId: "declineSubmission",
  path: "/submissions/{ref}/decline",
  tags: ["Intake"],
  summary: "Decline with a customer-visible reason",
  middleware: [
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
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
        message: submissionMessageSchema,
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
    // AU-14: audit rows carry the request context and never fail the action.
    intakeAuditContext,
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
    404: errorResponse("Submission not found"),
    409: errorResponse("Submission cannot receive a message"),
  },
});
const portalBacklogRoute = createRoute({
  method: "get",
  operationId: "listPortalOrganisationBacklog",
  path: "/portal/requests/backlog",
  tags: ["Portal submissions"],
  summary: "List visible backlog items in the caller's organisation",
  middleware: [portalOrganisation] as const,
  request: { query: portalBacklogQuerySchema },
  responses: {
    200: jsonResponse("Organisation backlog", portalBacklogPageSchema),
    400: errorResponse("Invalid backlog cursor"),
    404: errorResponse("Backlog not found"),
  },
});
const portalBacklogRankRoute = createRoute({
  method: "post",
  operationId: "rankPortalOrganisationBacklog",
  path: "/portal/requests/rank",
  tags: ["Portal submissions"],
  summary: "Reorder a visible item within its organisation backlog partition",
  middleware: [portalOrganisation] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: rankPortalBacklogBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Backlog rank", rankPortalBacklogResponseSchema),
    400: errorResponse("Invalid rank neighbours"),
    404: errorResponse("Backlog item not found"),
    409: errorResponse("Backlog changed"),
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
  middleware: [portalReadableSubmission] as const,
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
  middleware: [intakeAuditContext, portalOwnSubmission] as const,
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
  middleware: [intakeAuditContext, portalOwnSubmission] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse(
      "Withdrawn submission",
      z.object({ ref: z.string(), state: z.string(), version: z.number() }),
    ),
    409: errorResponse("Triage has already started"),
  },
});

const portalEscalateRoute = createRoute({
  method: "post",
  operationId: "escalatePortalSubmissionPriority",
  path: "/portal/submissions/{ref}/escalate-priority",
  tags: ["Portal submissions"],
  summary: "Raise the priority of the caller's request (never lower it)",
  middleware: [intakeAuditContext, portalOwnSubmission] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: escalatePriorityBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated submission page",
      portalSubmissionResponseSchema,
    ),
    403: errorResponse("cannot_deescalate: a decrease is refused"),
    404: errorResponse("Submission not found"),
    409: errorResponse(
      "not_escalatable, no_change or conflict: the request cannot be escalated now",
    ),
  },
});
const portalReopenRoute = createRoute({
  method: "post",
  operationId: "reopenPortalSubmission",
  path: "/portal/submissions/{ref}/reopen",
  tags: ["Portal submissions"],
  summary: "Reopen the caller's resolved or auto-declined request",
  middleware: [intakeAuditContext, portalOwnSubmission] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse(
      "Updated submission page",
      portalSubmissionResponseSchema,
    ),
    404: errorResponse("Submission not found"),
    409: errorResponse(
      "not_reopenable, reopen_pending_review or conflict: the request was not reopened",
    ),
  },
});
const portalSatisfactionRoute = createRoute({
  method: "post",
  operationId: "ratePortalSubmission",
  path: "/portal/submissions/{ref}/satisfaction",
  tags: ["Portal submissions"],
  summary: "Rate (or change the rating of) a resolved request",
  middleware: [intakeAuditContext, portalOwnSubmission] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: satisfactionBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated submission page",
      portalSubmissionResponseSchema,
    ),
    404: errorResponse("Submission not found"),
    409: errorResponse(
      "not_rateable or rating_locked: the request cannot be rated now",
    ),
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
          await triagerPersonId(c),
        ),
      ),
      200,
    ),
  )
  .openapi(detailRoute, async (c) => {
    const detail = await getRequestType(c.req.valid("param").id);
    return c.json(
      {
        ...requestTypeResponse(detail),
        versions: detail.versions.map(toRequestTypeVersion),
      },
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
          await triagerPersonId(c),
        ),
      ),
      200,
    );
  })
  .openapi(publishRoute, async (c) => {
    const published = await publishRequestType(
      c.req.valid("param").id,
      await triagerPersonId(c),
    );
    return c.json(
      {
        requestType: requestTypeResponse(published.requestType),
        version: toRequestTypeVersion(published.version),
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
          await triagerPersonId(c),
        ),
      ),
      200,
    ),
  )
  .openapi(deleteRequestTypeRoute, async (c) => {
    const id = c.req.valid("param").id;
    const blockers = await requestTypeDeletionBlockers(db, id);
    if (blockers.length > 0) throw requestTypeDeletionRefusal(blockers);
    const pending = await requestRegisteredDeletion(c, {
      routeKey: REQUEST_TYPE_DELETION_ROUTE,
      targetType: "request_type",
      id,
      workspaceId: c.get("workspaceId"),
    });
    return c.json(pending, 202);
  })
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
    const response: z.infer<typeof portalCatalogueResponseSchema> = {
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
    };
    return c.json(response, 200);
  })
  .openapi(catalogueDetailRoute, async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    const found = (await portalCatalogue(identity.organisationId)).find(
      (row) => row.type.key === c.req.valid("param").key,
    );
    if (!found) notFound("Request type not found");
    const response: z.infer<typeof portalCatalogueDetailResponseSchema> = {
      key: found.type.key,
      name: found.type.name,
      description: found.type.description,
      formSchema: found.version.formSchema,
      version: found.version.number,
    };
    return c.json(response, 200);
  })
  .openapi(createSubmissionRoute, async (c) => {
    const body = c.req.valid("json");
    const created = await createSubmission({
      userId: c.get("userId"),
      ...body,
    });
    // Customer-facing: return only the declared fields, never the stored row.
    return c.json(
      {
        id: created.id,
        number: created.number,
        ref: created.ref,
        state: created.state,
        createdAt: created.createdAt.toISOString(),
      },
      200,
    );
  });

const intakeSubmissionRouter = apiRouter<IntakeVariables>()
  .openapi(listSubmissionsRoute, async (c) => {
    const query = c.req.valid("query");
    const result = await listSubmissions(
      query.workspaceId,
      query.state ? [query.state] : undefined,
      query.cursor,
      parseCollectionLimit(query.limit),
      parseSubmissionListFilters(query),
    );
    const duplicates = await suggestDuplicatesForQueueRows(
      query.workspaceId,
      result.submissions.map((row) => ({
        ref: row.ref,
        summary: row.summary,
        organisationId: row.organisation.id,
      })),
      await duplicateReadableProjectIds(c),
    );
    return c.json(
      {
        submissions: result.submissions.map((row) => ({
          ref: row.ref,
          summary: row.summary,
          suggestedDuplicates: duplicates.get(row.ref) ?? [],
          submission: {
            id: row.submission.id,
            number: row.submission.number,
            state: row.submission.state,
            customerVisibility: row.submission.customerVisibility,
            claimedBy: row.submission.claimedBy,
            claimedAt: row.submission.claimedAt?.toISOString() ?? null,
            createdAt: row.submission.createdAt.toISOString(),
          },
          requestType: toStaffRequestTypeRef(row.requestType),
          requester: {
            id: row.requester.id,
            displayName: row.requester.displayName,
          },
          organisation: {
            id: row.organisation.id,
            name: row.organisation.name,
          },
        })),
        page: result.page,
        meta: result.meta,
      },
      200,
    );
  })
  .openapi(submissionDetailRoute, async (c) => {
    const identity = await resolveCallerIdentity(c, c.get("userId"));
    if (!identity) return notFound("Submission not found");
    const detail = await findSubmission(
      c.req.valid("param").ref,
      c.get("workspaceId"),
      undefined,
      identity,
    );
    return c.json(
      {
        ref: detail.ref,
        submission: toStaffSubmission(detail.submission),
        requestType: toStaffRequestTypeRef(detail.requestType),
        version: toRequestTypeVersion(detail.version),
        messages: detail.messages.map(toSubmissionMessage),
        // `workItemId` is already null when the caller cannot reach the linked work item.
        satisfaction: await findSubmissionSatisfaction(
          detail.submission.workItemId,
        ),
      },
      200,
    );
  })
  .openapi(claimRoute, async (c) => {
    const claimed = await claimSubmission(
      c.req.valid("param").ref,
      c.get("workspaceId"),
      await triagerPersonId(c),
    );
    return c.json(
      {
        id: claimed.id,
        ref: claimed.ref,
        state: claimed.state,
        claimedBy: claimed.claimedBy,
        claimedAt: claimed.claimedAt?.toISOString() ?? null,
      },
      200,
    );
  })
  .openapi(acceptRoute, async (c) => {
    // #741: triage happens within reach. The destination project must be one the triager
    // reaches; one they do not is answered exactly like a missing project.
    const reach = listReachOf(c);
    const accepted = await acceptSubmission(
      c.req.valid("param").ref,
      c.get("workspaceId"),
      await triagerPersonId(c),
      c.req.valid("json").projectId,
      c.req.valid("json").workItemTypeId,
      (project) =>
        reach.reaches({
          projectId: project.id,
          workspaceId: project.workspaceId,
          organisationId: project.organisationId,
        }),
    );
    return c.json(
      {
        ref: accepted.ref,
        state: accepted.state,
        workItem: toSubmissionWorkItem(accepted.workItem),
      },
      200,
    );
  });

const triageActionRouter = apiRouter<IntakeVariables>()
  .openapi(duplicateRoute, async (c) => {
    const linked = await markSubmissionDuplicate(
      c.req.valid("param").ref,
      c.get("workspaceId"),
      await triagerPersonId(c),
      c.req.valid("json").workItemId,
      (project) =>
        listReachOf(c).reaches({
          projectId: project.id,
          workspaceId: project.workspaceId,
          organisationId: project.organisationId,
        }),
    );
    return c.json(
      {
        ref: linked.ref,
        state: linked.state,
        workItem: toSubmissionWorkItem(linked.workItem),
      },
      200,
    );
  })
  .openapi(duplicateSuggestionsRoute, async (c) =>
    c.json(
      {
        suggestions: await suggestDuplicateWorkItems(
          c.req.valid("param").ref,
          c.get("workspaceId"),
          await duplicateReadableProjectIds(c),
        ),
      },
      200,
    ),
  )
  .openapi(declineRoute, async (c) => {
    const declined = await declineSubmission(
      c.req.valid("param").ref,
      c.get("workspaceId"),
      await triagerPersonId(c),
      c.req.valid("json").reason,
    );
    return c.json(
      {
        ref: declined.ref,
        state: declined.state,
        reason: declined.reason,
        message: toSubmissionMessage(declined.message),
      },
      200,
    );
  })
  .openapi(staffMessageRoute, async (c) => {
    const posted = await postSubmissionMessage({
      ref: c.req.valid("param").ref,
      workspaceId: c.get("workspaceId"),
      actorId: await triagerPersonId(c),
      actorType: "triager",
      body: c.req.valid("json").body,
    });
    return c.json(
      {
        id: posted.id,
        ref: posted.ref,
        state: posted.state,
        message: toSubmissionMessage(posted.message),
      },
      200,
    );
  });

const portalBacklogRouter = apiRouter<IntakeVariables>()
  .openapi(portalBacklogRoute, async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    return c.json(
      await listPortalBacklog(identity.personId, c.req.valid("query").cursor),
      200,
    );
  })
  .openapi(portalBacklogRankRoute, async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    return c.json(
      await rankPortalBacklog(identity.personId, c.req.valid("json")),
      200,
    );
  });

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
          ({
            submission,
            requestType,
            ref,
            isRequester,
            sla,
            customerStatus,
          }) => ({
            ref,
            state: submission.state,
            createdAt: submission.createdAt.toISOString(),
            customerVisibility: submission.customerVisibility,
            requestTypeName: requestType.name,
            isRequester,
            customerStatus,
            sla,
          }),
        ),
      },
      200,
    );
  },
);

async function portalProjection(
  userId: string,
  ref: string,
): Promise<PortalSubmissionResponse> {
  const identity = await portalIdentity(userId);
  const detail = await findPortalSubmission(ref, identity.personId);
  return {
    ...detail,
    submission: {
      ...detail.submission,
      formData: detail.submission.formData as Record<string, unknown>,
    },
  };
}

const portalDetailRouter = apiRouter<IntakeVariables>().openapi(
  portalDetailRoute,
  async (c) =>
    c.json(
      await portalProjection(c.get("userId"), c.req.valid("param").ref),
      200,
    ),
);

const portalMessageRouter = apiRouter<IntakeVariables>().openapi(
  portalMessageRoute,
  async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    const posted = await postSubmissionMessage({
      ref: c.req.valid("param").ref,
      requesterId: identity.personId,
      actorId: identity.personId,
      actorType: "customer",
      body: c.req.valid("json").body,
    });
    return c.json(
      {
        id: posted.id,
        ref: posted.ref,
        state: posted.state,
        message: toSubmissionMessage(posted.message),
      },
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

// CP-7 / CP-8 / CP-9: requester-only lifecycle actions; each answers with the updated projection.
const portalLifecycleRouter = apiRouter<IntakeVariables>()
  .openapi(portalEscalateRoute, async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    const { ref } = c.req.valid("param");
    await escalatePortalPriority({
      ref,
      personId: identity.personId,
      userId: c.get("userId"),
      priority: c.req.valid("json").priority,
    });
    return c.json(await portalProjection(c.get("userId"), ref), 200);
  })
  .openapi(portalReopenRoute, async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    const { ref } = c.req.valid("param");
    await reopenPortalSubmission({ ref, personId: identity.personId });
    return c.json(await portalProjection(c.get("userId"), ref), 200);
  })
  .openapi(portalSatisfactionRoute, async (c) => {
    const identity = await portalIdentity(c.get("userId"));
    const { ref } = c.req.valid("param");
    const { rating, comment } = c.req.valid("json");
    await ratePortalSubmission({
      ref,
      personId: identity.personId,
      rating,
      ...(comment === undefined ? {} : { comment }),
    });
    return c.json(await portalProjection(c.get("userId"), ref), 200);
  });

const router = requestTypeRouter
  .route("/", intakeSubmissionRouter)
  .route("/", triageActionRouter)
  .route("/", portalSubmissionRouter)
  .route("/", portalBacklogRouter)
  .route("/", portalDetailRouter)
  .route("/", portalMessageRouter)
  .route("/", portalWithdrawRouter)
  .route("/", portalLifecycleRouter);

export default router;
