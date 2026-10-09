import { createId } from "@paralleldrive/cuid2";
import {
  type FormSchema,
  type FormValue,
  validateSubmissionData,
} from "@taskdesk/domain/intake";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import completeAttachment from "../attachment/controllers/complete-attachment";
import presignAttachment from "../attachment/controllers/presign-attachment";
import { presignAttachmentResponseSchema } from "../attachment/response";
import {
  attachmentIdParam,
  presignSubmissionAttachmentBody,
} from "../attachment/schema";
import { portalForHost } from "../auth";
import db, { schema } from "../database";
import { publishEvent } from "../events";
import { isFeatureEnabled } from "../feature-flags/runtime";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import {
  publishWorkItemHint,
  recordWorkItemEvent,
} from "../work-item/native-event";
import {
  getSubmissionEventScope,
  notifySubmissionEvent,
  recordSubmissionEvent,
} from "./events";
import {
  portalCatalogueSchema,
  portalRequestTypeSchema,
  submissionListItemSchema,
  submissionReceiptSchema,
} from "./response";
import {
  createSubmissionDraftBody,
  finalizeSubmissionDraftBody,
  requestTypeKeyParam,
  submissionMessageBody,
  submissionRefParam,
  submitRequestBody,
} from "./schema";
import {
  acceptSubmissionWorkItem,
  assertSubmissionFileAnswers,
  validateSubmissionAnswers,
} from "./triage";

const missing = () => new HTTPException(404, { message: "Not found" });
const portalSubmissionAttachmentResponseSchema =
  presignAttachmentResponseSchema.extend({ fieldKey: z.string().min(1) });

async function customerContext(
  c: Context<{
    Variables: BaseVariables & {
      portalOrganisationId: string;
      portalPersonId: string;
      portalPredicateSatisfied?: boolean;
    };
  }>,
  next: Next,
) {
  if (portalForHost(c.req.header("Host")) !== "customer") throw missing();
  const userId = c.get("userId") as string | undefined;
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const [person] = await db
    .select({
      id: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .innerJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.personTable.organisationId),
    )
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
        eq(schema.organisationTable.active, true),
        eq(schema.organisationTable.portalAccess, true),
        isNull(schema.organisationTable.deletedAt),
      ),
    )
    .limit(1);
  if (!person) throw missing();
  c.set("portalOrganisationId", person.organisationId);
  c.set("portalPersonId", person.id);
  c.set("portalPredicateSatisfied", true);
  await next();
}

const portalSubmission = submissionListItemSchema.extend({
  requestTypeName: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      actorType: z.enum(["customer", "triager"]),
      body: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
});
const portalSubmissionList = z.object({ items: z.array(portalSubmission) });

async function ownSubmissionContext(c: Context, next: Next) {
  const number = Number(c.req.param("ref")?.replace(/^SUB-/, ""));
  const organisationId = c.get("portalOrganisationId") as string;
  const personId = c.get("portalPersonId") as string;
  if (!Number.isSafeInteger(number) || number < 1) throw missing();
  const [row] = await db
    .select({
      id: schema.submissionTable.id,
      number: schema.submissionTable.number,
      requesterId: schema.submissionTable.requesterId,
      customerVisibility: schema.submissionTable.customerVisibility,
      workItemId: schema.submissionTable.workItemId,
      state: schema.submissionTable.state,
      organisationId: schema.submissionTable.organisationId,
      workspaceId: schema.requestTypeTable.workspaceId,
    })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(
      and(
        eq(schema.submissionTable.number, number),
        eq(schema.submissionTable.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) throw missing();
  const participant =
    row.requesterId === personId || row.customerVisibility === "organisation"
      ? true
      : Boolean(
          (
            await db
              .select({ id: schema.requestParticipantTable.id })
              .from(schema.requestParticipantTable)
              .where(
                and(
                  eq(schema.requestParticipantTable.submissionId, row.id),
                  eq(schema.requestParticipantTable.personId, personId),
                ),
              )
              .limit(1)
          )[0],
        );
  if (
    !participant ||
    !(await isFeatureEnabled("feature.customer_portal", {
      workspaceId: row.workspaceId,
    })) ||
    !(await isFeatureEnabled("feature.intake", {
      workspaceId: row.workspaceId,
    }))
  )
    throw missing();
  c.set("portalPredicateSatisfied", true);
  c.set("portalSubmissionId", row.id);
  c.set("portalSubmissionNumber", row.number);
  c.set("portalSubmissionRequesterId", row.requesterId);
  c.set("portalSubmissionWorkItemId", row.workItemId);
  c.set("portalSubmissionState", row.state);
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

const catalogueRoute = createRoute({
  method: "get",
  path: "/portal/catalogue",
  operationId: "getPortalCatalogue",
  tags: ["Portal"],
  summary: "List request types assigned to the current organisation",
  middleware: [customerContext] as const,
  responses: {
    200: jsonResponse("Request catalogue", portalCatalogueSchema),
    404: errorResponse("Not found"),
  },
});
const detailRoute = createRoute({
  method: "get",
  path: "/portal/catalogue/{key}",
  operationId: "getPortalRequestType",
  tags: ["Portal"],
  summary: "Read a published request form",
  middleware: [customerContext] as const,
  request: { params: requestTypeKeyParam },
  responses: {
    200: jsonResponse("Request type form", portalRequestTypeSchema),
    404: errorResponse("Not found"),
  },
});
const submitRoute = createRoute({
  method: "post",
  path: "/portal/submissions",
  operationId: "createPortalSubmission",
  tags: ["Portal"],
  summary: "Submit a request to the intake queue",
  middleware: [customerContext] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: submitRequestBody } },
    },
  },
  responses: {
    200: jsonResponse("Submission receipt", submissionReceiptSchema),
    400: errorResponse("Form data is invalid"),
    404: errorResponse("Not found"),
    409: errorResponse("Published mapping is unavailable"),
  },
});
const submissionsRoute = createRoute({
  method: "get",
  path: "/portal/submissions",
  operationId: "listPortalSubmissions",
  tags: ["Portal"],
  summary: "List the current organisation's submissions",
  middleware: [customerContext] as const,
  responses: {
    200: jsonResponse("Portal submissions", portalSubmissionList),
    404: errorResponse("Not found"),
  },
});
const createDraftRoute = createRoute({
  method: "post",
  path: "/portal/submissions/drafts",
  operationId: "createPortalSubmissionDraft",
  tags: ["Portal"],
  summary: "Prepare a file-backed request submission",
  middleware: [customerContext] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createSubmissionDraftBody } },
    },
  },
  responses: {
    200: jsonResponse("Submission draft", submissionReceiptSchema),
    404: errorResponse("Not found"),
  },
});
const submissionAttachmentPresignRoute = createRoute({
  method: "post",
  path: "/portal/submissions/{ref}/attachments/presign",
  operationId: "presignPortalSubmissionAttachment",
  tags: ["Attachments", "Portal"],
  summary: "Presign an upload owned by a portal submission draft",
  middleware: [customerContext, ownSubmissionContext] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: presignSubmissionAttachmentBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The presigned submission upload",
      portalSubmissionAttachmentResponseSchema,
    ),
    400: errorResponse("File violates configured upload policy"),
    404: errorResponse("Not found"),
  },
});
const submissionAttachmentCompleteRoute = createRoute({
  method: "post",
  path: "/portal/submissions/{ref}/attachments/{id}/complete",
  operationId: "completePortalSubmissionAttachment",
  tags: ["Attachments", "Portal"],
  summary: "Validate and complete a portal submission upload",
  middleware: [customerContext, ownSubmissionContext] as const,
  request: { params: submissionRefParam.extend(attachmentIdParam.shape) },
  responses: {
    200: jsonResponse(
      "Completed attachment",
      z.object({ id: z.string(), state: z.literal("ready") }),
    ),
    400: errorResponse("Upload is missing or failed content validation"),
    404: errorResponse("Not found"),
    409: errorResponse("Upload is no longer pending"),
  },
});
const finalizeDraftRoute = createRoute({
  method: "post",
  path: "/portal/submissions/{ref}/submit",
  operationId: "finalizePortalSubmissionDraft",
  tags: ["Portal"],
  summary: "Submit a completed file-backed request",
  middleware: [customerContext, ownSubmissionContext] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: finalizeSubmissionDraftBody } },
    },
  },
  responses: {
    200: jsonResponse("Submission receipt", submissionReceiptSchema),
    400: errorResponse("Required answers or uploads are invalid"),
    404: errorResponse("Not found"),
    409: errorResponse("Draft is no longer editable"),
  },
});
const submissionDetailRoute = createRoute({
  method: "get",
  path: "/portal/submissions/{ref}",
  operationId: "getPortalSubmission",
  tags: ["Portal"],
  summary: "Read a durable submission thread",
  middleware: [customerContext, ownSubmissionContext] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse("Submission and thread", portalSubmission),
    404: errorResponse("Not found"),
  },
});
const submissionMessageRoute = createRoute({
  method: "post",
  path: "/portal/submissions/{ref}/messages",
  operationId: "replyToPortalSubmission",
  tags: ["Portal"],
  summary: "Reply to a submission or accepted work item",
  middleware: [customerContext, ownSubmissionContext] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: submissionMessageBody } },
    },
  },
  responses: {
    200: jsonResponse("Submission reply", submissionReceiptSchema),
    404: errorResponse("Not found"),
    409: errorResponse("Submission is closed"),
  },
});
const withdrawRoute = createRoute({
  method: "post",
  path: "/portal/submissions/{ref}/withdraw",
  operationId: "withdrawPortalSubmission",
  tags: ["Portal"],
  summary: "Withdraw an unclaimed submission",
  middleware: [customerContext, ownSubmissionContext] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse("Withdrawn submission", submissionReceiptSchema),
    404: errorResponse("Not found"),
    409: errorResponse("Submission can no longer be withdrawn"),
  },
});

const routes = apiRouter<
  BaseVariables & {
    portalOrganisationId: string;
    portalPersonId: string;
    portalSubmissionId?: string;
    portalSubmissionNumber?: number;
    portalSubmissionRequesterId?: string;
    portalSubmissionWorkItemId?: string;
    portalSubmissionState?: string;
    workspaceId?: string;
    workspaceIdSource?: "row" | "request" | "relationship" | "system" | "none";
  }
>()
  .openapi(catalogueRoute, async (c) => {
    const organisationId = c.get("portalOrganisationId");
    const rows = await db
      .select({
        key: schema.requestTypeTable.key,
        name: schema.requestTypeTable.name,
        description: schema.requestTypeTable.description,
        icon: schema.requestTypeTable.icon,
        group: schema.requestTypeTable.group,
        position: schema.requestTypeTable.position,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.organisationRequestTypeTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(
          schema.requestTypeTable.id,
          schema.organisationRequestTypeTable.requestTypeId,
        ),
      )
      .where(
        and(
          eq(
            schema.organisationRequestTypeTable.organisationId,
            organisationId,
          ),
          eq(schema.requestTypeTable.published, true),
          eq(schema.requestTypeTable.customerVisible, true),
        ),
      );
    const items = [];
    for (const row of rows) {
      if (
        !(await isFeatureEnabled("feature.customer_portal", {
          workspaceId: row.workspaceId,
        }))
      )
        continue;
      if (
        !(await isFeatureEnabled("feature.intake", {
          workspaceId: row.workspaceId,
        }))
      )
        continue;
      items.push({
        key: row.key,
        name: row.name,
        description: row.description,
        icon: row.icon,
        group: row.group,
        position: row.position,
      });
    }
    items.sort(
      (a, b) => a.group.localeCompare(b.group) || a.position - b.position,
    );
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "private, no-store");
    return c.json({ items }, 200);
  })
  .openapi(detailRoute, async (c) => {
    const { key } = c.req.valid("param");
    const organisationId = c.get("portalOrganisationId");
    const [row] = await db
      .select({
        id: schema.requestTypeTable.id,
        key: schema.requestTypeTable.key,
        name: schema.requestTypeTable.name,
        description: schema.requestTypeTable.description,
        icon: schema.requestTypeTable.icon,
        group: schema.requestTypeTable.group,
        position: schema.requestTypeTable.position,
        workspaceId: schema.requestTypeTable.workspaceId,
        version: schema.requestTypeTable.version,
        formSchema: schema.requestTypeTable.formSchema,
      })
      .from(schema.organisationRequestTypeTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(
          schema.requestTypeTable.id,
          schema.organisationRequestTypeTable.requestTypeId,
        ),
      )
      .where(
        and(
          eq(
            schema.organisationRequestTypeTable.organisationId,
            organisationId,
          ),
          eq(schema.requestTypeTable.key, key),
          eq(schema.requestTypeTable.published, true),
          eq(schema.requestTypeTable.customerVisible, true),
        ),
      )
      .limit(1);
    if (
      !row ||
      !(await isFeatureEnabled("feature.customer_portal", {
        workspaceId: row.workspaceId,
      })) ||
      !(await isFeatureEnabled("feature.intake", {
        workspaceId: row.workspaceId,
      }))
    )
      throw missing();
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "private, no-store");
    const [publishedVersion] = await db
      .select({ autoAccept: schema.requestTypeVersionTable.autoAccept })
      .from(schema.requestTypeVersionTable)
      .where(
        and(
          eq(schema.requestTypeVersionTable.requestTypeId, row.id),
          eq(schema.requestTypeVersionTable.number, row.version),
        ),
      )
      .limit(1);
    if (!publishedVersion)
      throw new HTTPException(409, {
        message: "Published mapping is unavailable",
      });
    return c.json(
      portalRequestTypeSchema.parse({
        key: row.key,
        name: row.name,
        description: row.description,
        icon: row.icon,
        group: row.group,
        position: row.position,
        version: row.version,
        autoAccept: publishedVersion.autoAccept,
        formSchema: row.formSchema,
      }),
      200,
    );
  })
  .openapi(submitRoute, async (c) => {
    const { requestTypeKey, formData } = c.req.valid("json");
    const organisationId = c.get("portalOrganisationId");
    const userId = c.get("userId");
    const [type] = await db
      .select({
        id: schema.requestTypeTable.id,
        workspaceId: schema.requestTypeTable.workspaceId,
        version: schema.requestTypeTable.version,
        published: schema.requestTypeTable.published,
        customerVisible: schema.requestTypeTable.customerVisible,
      })
      .from(schema.organisationRequestTypeTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(
          schema.requestTypeTable.id,
          schema.organisationRequestTypeTable.requestTypeId,
        ),
      )
      .where(
        and(
          eq(
            schema.organisationRequestTypeTable.organisationId,
            organisationId,
          ),
          eq(schema.requestTypeTable.key, requestTypeKey),
        ),
      )
      .limit(1);
    if (!type || !type.published || !type.customerVisible) throw missing();
    if (
      !(await isFeatureEnabled("feature.customer_portal", {
        workspaceId: type.workspaceId,
      })) ||
      !(await isFeatureEnabled("feature.intake", {
        workspaceId: type.workspaceId,
      }))
    )
      throw missing();
    const [version] = await db
      .select()
      .from(schema.requestTypeVersionTable)
      .where(
        and(
          eq(schema.requestTypeVersionTable.requestTypeId, type.id),
          eq(schema.requestTypeVersionTable.number, type.version),
        ),
      )
      .limit(1);
    if (!version)
      throw new HTTPException(409, {
        message: "Published mapping is unavailable",
      });
    if (
      version.autoAccept ||
      (version.formSchema as FormSchema).fields.some(
        (field) => field.type === "file",
      )
    ) {
      throw new HTTPException(409, {
        message: "This request must be finalized through a draft",
      });
    }
    const errors = validateSubmissionData(
      version.formSchema as FormSchema,
      formData as Record<string, FormValue>,
    );
    if (errors.length)
      throw new HTTPException(400, { message: "Form data is invalid" });
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, userId),
          eq(schema.personTable.side, "customer"),
          eq(schema.personTable.active, true),
        ),
      )
      .limit(1);
    if (!person) throw missing();
    const afterCommit: Array<() => Promise<void>> = [];
    const created = await db.transaction(async (tx) => {
      const [submission] = await tx
        .insert(schema.submissionTable)
        .values({
          id: createId(),
          organisationId,
          requesterId: person.id,
          requestTypeId: type.id,
          requestTypeVersionId: version.id,
          formData,
          submittedAt: new Date(),
          customerVisibility: "private",
        })
        .returning();
      if (!submission)
        throw new HTTPException(503, { message: "Submission unavailable" });
      await recordSubmissionEvent(tx, {
        kind: "submission.received",
        workspaceId: type.workspaceId,
        organisationId,
        actorId: person.id,
        actorType: "person",
        payload: {
          ref: `SUB-${submission.number}`,
          requestTypeId: type.id,
          organisationId,
        },
      });
      if (!version.autoAccept)
        return { submission, workItemKey: null, accepted: false };
      if (!version.defaultProjectId)
        throw new HTTPException(409, {
          message: "Auto-accept configuration is unavailable",
        });
      const accepted = await acceptSubmissionWorkItem(
        {
          number: submission.number,
          workspaceId: type.workspaceId,
          actorId: person.id,
          projectId: version.defaultProjectId,
          typeId: version.workItemTypeId,
        },
        { transaction: tx, afterCommit },
      );
      return { submission, workItemKey: accepted.workItemKey, accepted: true };
    });
    for (const after of afterCommit) await after();
    await notifySubmissionEvent({
      kind: "submission.received",
      payload: {
        ref: `SUB-${created.submission.number}`,
        requestTypeId: type.id,
        organisationId,
      },
    });
    if (created.accepted)
      await notifySubmissionEvent({
        kind: "submission.accepted",
        payload: {
          ref: `SUB-${created.submission.number}`,
          workItemKey: created.workItemKey!,
        },
      });
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${created.submission.number}`,
        state: created.accepted ? "accepted" : created.submission.state,
        workItemKey: created.workItemKey,
        createdAt: created.submission.createdAt,
      }),
      200,
    );
  })
  .openapi(createDraftRoute, async (c) => {
    const { requestTypeKey, formData } = c.req.valid("json");
    const organisationId = c.get("portalOrganisationId");
    const [type] = await db
      .select({
        id: schema.requestTypeTable.id,
        workspaceId: schema.requestTypeTable.workspaceId,
        version: schema.requestTypeTable.version,
        published: schema.requestTypeTable.published,
        customerVisible: schema.requestTypeTable.customerVisible,
      })
      .from(schema.organisationRequestTypeTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(
          schema.requestTypeTable.id,
          schema.organisationRequestTypeTable.requestTypeId,
        ),
      )
      .where(
        and(
          eq(
            schema.organisationRequestTypeTable.organisationId,
            organisationId,
          ),
          eq(schema.requestTypeTable.key, requestTypeKey),
        ),
      )
      .limit(1);
    if (!type || !type.published || !type.customerVisible) throw missing();
    if (
      !(await isFeatureEnabled("feature.customer_portal", {
        workspaceId: type.workspaceId,
      })) ||
      !(await isFeatureEnabled("feature.intake", {
        workspaceId: type.workspaceId,
      }))
    )
      throw missing();
    const [version] = await db
      .select()
      .from(schema.requestTypeVersionTable)
      .where(
        and(
          eq(schema.requestTypeVersionTable.requestTypeId, type.id),
          eq(schema.requestTypeVersionTable.number, type.version),
        ),
      )
      .limit(1);
    if (!version)
      throw new HTTPException(409, {
        message: "Published mapping is unavailable",
      });
    const formSchema = version.formSchema as FormSchema;
    const draftSchema = {
      ...formSchema,
      fields: formSchema.fields.map((field) =>
        field.type === "file" ? { ...field, required: false } : field,
      ),
    } as FormSchema;
    if (
      validateSubmissionData(draftSchema, formData as Record<string, FormValue>)
        .length
    )
      throw new HTTPException(400, { message: "Form data is invalid" });
    const personId = c.get("portalPersonId");
    const draft = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.submissionTable)
        .values({
          id: createId(),
          organisationId,
          requesterId: personId,
          requestTypeId: type.id,
          requestTypeVersionId: version.id,
          formData,
          state: "draft",
          submittedAt: null,
          customerVisibility: "private",
        })
        .returning();
      if (!row)
        throw new HTTPException(503, { message: "Submission unavailable" });
      return row;
    });
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${draft.number}`,
        state: "draft",
        workItemKey: null,
        createdAt: draft.createdAt,
      }),
      200,
    );
  })
  .openapi(submissionAttachmentPresignRoute, async (c) => {
    const submissionId = c.get("portalSubmissionId") as string;
    const workspaceId = c.get("workspaceId") as string | undefined;
    const { filename, contentType, size, fieldKey } = c.req.valid("json");
    if (
      !workspaceId ||
      c.get("portalSubmissionRequesterId") !== c.get("portalPersonId") ||
      c.get("portalSubmissionWorkItemId") ||
      c.get("portalSubmissionState") !== "draft"
    )
      throw missing();
    const upload = await presignAttachment({
      submissionId,
      submissionFieldKey: fieldKey,
      workspaceId,
      filename,
      contentType,
      size,
      customerVisible: true,
      userId: c.get("userId") as string,
      // The portal and agent may be separate origins. The short-lived filesystem
      // upload credential is served by the agent API host; returning the portal
      // origin would send the raw PUT through the portal host boundary.
      apiBaseUrl: process.env.TASKDESK_AGENT_URL || new URL(c.req.url).origin,
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ ...upload, fieldKey }, 200);
  })
  .openapi(submissionAttachmentCompleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const submissionId = c.get("portalSubmissionId") as string;
    const workspaceId = c.get("workspaceId") as string | undefined;
    if (
      !workspaceId ||
      c.get("portalSubmissionRequesterId") !== c.get("portalPersonId") ||
      c.get("portalSubmissionWorkItemId") ||
      c.get("portalSubmissionState") !== "draft"
    )
      throw missing();
    const result = await completeAttachment({
      attachmentId: id,
      workspaceId,
      submissionId,
      actorId: c.get("portalPersonId") as string,
      actorType: "person",
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ id: result.id, state: "ready" as const }, 200);
  })
  .openapi(finalizeDraftRoute, async (c) => {
    const submissionId = c.get("portalSubmissionId") as string;
    const personId = c.get("portalPersonId");
    const { formData } = c.req.valid("json");
    const afterCommit: Array<() => Promise<void>> = [];
    const result = await db.transaction(async (tx) => {
      const [submission] = await tx
        .select()
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.id, submissionId))
        .for("update")
        .limit(1);
      if (
        !submission ||
        submission.requesterId !== personId ||
        submission.state !== "draft"
      )
        throw new HTTPException(409, {
          message: "Draft is no longer editable",
        });
      const [version] = await tx
        .select()
        .from(schema.requestTypeVersionTable)
        .where(
          and(
            eq(
              schema.requestTypeVersionTable.id,
              submission.requestTypeVersionId,
            ),
            eq(
              schema.requestTypeVersionTable.requestTypeId,
              submission.requestTypeId,
            ),
          ),
        )
        .limit(1);
      if (!version)
        throw new HTTPException(409, {
          message: "Published mapping is unavailable",
        });
      const formSchema = version.formSchema as FormSchema;
      if (
        validateSubmissionAnswers(
          formSchema,
          formData as Record<string, FormValue>,
        ).length
      )
        throw new HTTPException(400, { message: "Form data is invalid" });
      await assertSubmissionFileAnswers(
        tx,
        submissionId,
        formSchema,
        formData as Record<string, FormValue>,
      );
      const storedFormData = { ...formData };
      for (const field of formSchema.fields) {
        if (field.type === "file") delete storedFormData[field.key];
      }
      const submittedAt = new Date();
      const [updated] = await tx
        .update(schema.submissionTable)
        .set({
          // File answers are represented only by attachment rows. Persisting signed
          // upload IDs in form_data would create a second, non-authoritative link.
          formData: storedFormData,
          state: "new",
          submittedAt,
          version: submission.version + 1,
          updatedAt: submittedAt,
        })
        .where(
          and(
            eq(schema.submissionTable.id, submission.id),
            eq(schema.submissionTable.state, "draft"),
          ),
        )
        .returning();
      if (!updated)
        throw new HTTPException(409, {
          message: "Draft is no longer editable",
        });
      const scope = await getSubmissionEventScope(tx, submission.id);
      if (!scope) throw missing();
      await recordSubmissionEvent(tx, {
        kind: "submission.received",
        ...scope,
        actorId: personId,
        actorType: "person",
        payload: {
          ref: `SUB-${updated.number}`,
          requestTypeId: updated.requestTypeId,
          organisationId: updated.organisationId,
        },
      });
      if (!version.autoAccept)
        return { submission: updated, workItemKey: null, accepted: false };
      if (!version.defaultProjectId)
        throw new HTTPException(409, {
          message: "Auto-accept configuration is unavailable",
        });
      const accepted = await acceptSubmissionWorkItem(
        {
          number: updated.number,
          workspaceId: scope.workspaceId,
          actorId: personId,
          projectId: version.defaultProjectId,
          typeId: version.workItemTypeId,
        },
        { transaction: tx, afterCommit },
      );
      return {
        submission: updated,
        workItemKey: accepted.workItemKey,
        accepted: true,
      };
    });
    for (const after of afterCommit) await after();
    await notifySubmissionEvent({
      kind: "submission.received",
      payload: {
        ref: `SUB-${result.submission.number}`,
        requestTypeId: result.submission.requestTypeId,
        organisationId: result.submission.organisationId,
      },
    });
    if (result.accepted)
      await notifySubmissionEvent({
        kind: "submission.accepted",
        payload: {
          ref: `SUB-${result.submission.number}`,
          workItemKey: result.workItemKey!,
        },
      });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${result.submission.number}`,
        state: result.accepted ? "accepted" : result.submission.state,
        workItemKey: result.workItemKey,
        createdAt: result.submission.createdAt,
      }),
      200,
    );
  })
  .openapi(submissionsRoute, async (c) => {
    const organisationId = c.get("portalOrganisationId");
    const personId = c.get("portalPersonId");
    const rows = await db
      .select({
        id: schema.submissionTable.id,
        number: schema.submissionTable.number,
        state: schema.submissionTable.state,
        workItemId: schema.submissionTable.workItemId,
        createdAt: schema.submissionTable.createdAt,
        organisationId: schema.submissionTable.organisationId,
        requesterId: schema.submissionTable.requesterId,
        requestTypeId: schema.submissionTable.requestTypeId,
        requestTypeVersionId: schema.submissionTable.requestTypeVersionId,
        formData: schema.submissionTable.formData,
        claimedBy: schema.submissionTable.claimedBy,
        claimedAt: schema.submissionTable.claimedAt,
        version: schema.submissionTable.version,
        requestTypeName: schema.requestTypeTable.name,
        workspaceId: schema.requestTypeTable.workspaceId,
        workItemKey: schema.workItemTable.key,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .leftJoin(
        schema.workItemTable,
        eq(schema.workItemTable.id, schema.submissionTable.workItemId),
      )
      .where(
        and(
          eq(schema.submissionTable.organisationId, organisationId),
          or(
            eq(schema.submissionTable.requesterId, personId),
            eq(schema.submissionTable.customerVisibility, "organisation"),
          ),
        ),
      )
      .orderBy(desc(schema.submissionTable.number))
      .limit(100);
    const allowed = [];
    for (const row of rows) {
      if (row.state === "draft" && row.requesterId !== personId) continue;
      if (
        !(await isFeatureEnabled("feature.customer_portal", {
          workspaceId: row.workspaceId,
        })) ||
        !(await isFeatureEnabled("feature.intake", {
          workspaceId: row.workspaceId,
        }))
      )
        continue;
      const messages = await db
        .select({
          id: schema.submissionMessageTable.id,
          actorType: schema.submissionMessageTable.actorType,
          body: schema.submissionMessageTable.body,
          createdAt: schema.submissionMessageTable.createdAt,
        })
        .from(schema.submissionMessageTable)
        .where(eq(schema.submissionMessageTable.submissionId, row.id))
        .orderBy(
          schema.submissionMessageTable.createdAt,
          schema.submissionMessageTable.id,
        );
      allowed.push({
        ...row,
        ref: `SUB-${row.number}`,
        workItemKey: row.workItemKey ?? null,
        createdAt: row.createdAt.toISOString(),
        claimedAt: row.claimedAt?.toISOString() ?? null,
        messages: messages.map((message) => ({
          ...message,
          actorType: message.actorType as "customer" | "triager",
          createdAt: message.createdAt.toISOString(),
        })),
      });
    }
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "private, no-store");
    return c.json(portalSubmissionList.parse({ items: allowed }), 200);
  })
  .openapi(submissionDetailRoute, async (c) => {
    const id = c.get("portalSubmissionId") as string;
    const [row] = await db
      .select({
        id: schema.submissionTable.id,
        number: schema.submissionTable.number,
        state: schema.submissionTable.state,
        workItemId: schema.submissionTable.workItemId,
        createdAt: schema.submissionTable.createdAt,
        organisationId: schema.submissionTable.organisationId,
        requesterId: schema.submissionTable.requesterId,
        requestTypeId: schema.submissionTable.requestTypeId,
        requestTypeVersionId: schema.submissionTable.requestTypeVersionId,
        formData: schema.submissionTable.formData,
        claimedBy: schema.submissionTable.claimedBy,
        claimedAt: schema.submissionTable.claimedAt,
        version: schema.submissionTable.version,
        requestTypeName: schema.requestTypeTable.name,
        workItemKey: schema.workItemTable.key,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .leftJoin(
        schema.workItemTable,
        eq(schema.workItemTable.id, schema.submissionTable.workItemId),
      )
      .where(eq(schema.submissionTable.id, id))
      .limit(1);
    if (!row) throw missing();
    const messages = await db
      .select({
        id: schema.submissionMessageTable.id,
        actorType: schema.submissionMessageTable.actorType,
        body: schema.submissionMessageTable.body,
        createdAt: schema.submissionMessageTable.createdAt,
      })
      .from(schema.submissionMessageTable)
      .where(eq(schema.submissionMessageTable.submissionId, id))
      .orderBy(
        schema.submissionMessageTable.createdAt,
        schema.submissionMessageTable.id,
      );
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "private, no-store");
    return c.json(
      portalSubmission.parse({
        ...row,
        ref: `SUB-${row.number}`,
        workItemKey: row.workItemKey ?? null,
        createdAt: row.createdAt.toISOString(),
        claimedAt: row.claimedAt?.toISOString() ?? null,
        messages: messages.map((message) => ({
          ...message,
          actorType: message.actorType as "customer" | "triager",
          createdAt: message.createdAt.toISOString(),
        })),
      }),
      200,
    );
  })
  .openapi(submissionMessageRoute, async (c) => {
    const id = c.get("portalSubmissionId") as string;
    const personId = c.get("portalPersonId");
    const { body } = c.req.valid("json");
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.submissionTable)
        .where(eq(schema.submissionTable.id, id))
        .for("update")
        .limit(1);
      if (!current) throw missing();
      if (current.workItemId) {
        const [workItem] = await tx
          .select({
            workspaceId: schema.workItemTable.workspaceId,
            projectId: schema.workItemTable.projectId,
            key: schema.workItemTable.key,
          })
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, current.workItemId))
          .limit(1);
        if (!workItem) throw missing();
        const commentBody = {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: body }] },
          ],
        };
        const [comment] = await tx
          .insert(schema.commentTable)
          .values({
            workspaceId: workItem.workspaceId,
            workItemId: current.workItemId,
            authorId: personId,
            actorType: "person",
            body: commentBody,
            visibility: "public",
          })
          .returning();
        if (!comment)
          throw new HTTPException(503, { message: "Submission unavailable" });
        const event = await recordWorkItemEvent(tx, {
          kind: "work_item.commented",
          workItemId: current.workItemId,
          key: workItem.key,
          workspaceId: workItem.workspaceId,
          projectId: workItem.projectId,
          actorId: personId,
          actorType: "person",
          customerVisible: true,
          payload: {
            key: workItem.key,
            commentId: comment.id,
            visibility: "public",
          },
        });
        return {
          kind: "work-item" as const,
          current,
          comment,
          event,
          workItem,
        };
      }
      if (current.state !== "new" && current.state !== "clarifying")
        throw new HTTPException(409, { message: "Submission is closed" });
      await tx.insert(schema.submissionMessageTable).values({
        id: createId(),
        submissionId: id,
        authorId: personId,
        actorType: "customer",
        body,
      });
      const [updated] = await tx
        .update(schema.submissionTable)
        .set({
          state: "new",
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.submissionTable.id, id),
            eq(schema.submissionTable.version, current.version),
          ),
        )
        .returning();
      if (!updated)
        throw new HTTPException(409, { message: "Submission changed; retry" });
      const scope = await getSubmissionEventScope(tx, updated.id);
      if (!scope) throw missing();
      await recordSubmissionEvent(tx, {
        kind: "submission.replied",
        ...scope,
        actorId: personId,
        actorType: "person",
        payload: { ref: `SUB-${updated.number}`, by: "customer" },
      });
      return { kind: "submission" as const, current: updated };
    });
    if (result.kind === "work-item") {
      await publishEvent("work_item.commented", {
        commentId: result.comment.id,
        workItemId: result.current.workItemId,
        workspaceId: result.workItem.workspaceId,
        visibility: "public",
        actorId: personId,
        actorType: "person",
      });
      await publishWorkItemHint(result.event, {
        kind: "work_item.commented",
        key: result.workItem.key,
        projectId: result.workItem.projectId,
        customerVisible: true,
      });
    } else {
      await notifySubmissionEvent({
        kind: "submission.replied",
        payload: {
          ref: `SUB-${result.current.number}`,
          by: "customer",
        },
      });
    }
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${result.current.number}`,
        state: result.current.state,
        workItemKey: result.kind === "work-item" ? result.workItem.key : null,
        createdAt: result.current.createdAt,
      }),
      200,
    );
  })
  .openapi(withdrawRoute, async (c) => {
    const id = c.get("portalSubmissionId") as string;
    const personId = c.get("portalPersonId");
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.submissionTable)
        .set({
          state: "withdrawn",
          version: sql`${schema.submissionTable.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.submissionTable.id, id),
            eq(schema.submissionTable.requesterId, personId),
            isNull(schema.submissionTable.claimedBy),
            isNull(schema.submissionTable.workItemId),
            sql`${schema.submissionTable.state} in ('new', 'clarifying')`,
          ),
        )
        .returning({
          id: schema.submissionTable.id,
          number: schema.submissionTable.number,
          state: schema.submissionTable.state,
          createdAt: schema.submissionTable.createdAt,
        });
      if (updated) {
        const scope = await getSubmissionEventScope(tx, updated.id);
        if (!scope) throw missing();
        await recordSubmissionEvent(tx, {
          kind: "submission.withdrawn",
          ...scope,
          actorId: personId,
          actorType: "person",
          payload: { ref: `SUB-${updated.number}` },
        });
      }
      return updated;
    });
    if (!row)
      throw new HTTPException(409, {
        message: "Submission can no longer be withdrawn",
      });
    await notifySubmissionEvent({
      kind: "submission.withdrawn",
      payload: { ref: `SUB-${row.number}` },
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      submissionReceiptSchema.parse({
        ref: `SUB-${row.number}`,
        state: row.state,
        workItemKey: null,
        createdAt: row.createdAt,
      }),
      200,
    );
  });

export default routes;
