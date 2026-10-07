import { and, eq, isNull, or } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { submissionRefParam } from "../intake/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { createAttachmentDownloadUrl } from "../storage";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { requireWorkItemReach } from "../work-item/require-work-item-reach";
import completeAttachment from "./controllers/complete-attachment";
import { completeSubmissionAttachment } from "./controllers/complete-submission-attachment";
import deleteAttachment from "./controllers/delete-attachment";
import downloadAttachment from "./controllers/download-attachment";
import listWorkItemAttachments from "./controllers/list-work-item-attachments";
import presignAttachment from "./controllers/presign-attachment";
import { presignSubmissionAttachment } from "./controllers/presign-submission-attachment";
import { requireAttachmentReach } from "./require-attachment-reach";
import { requireSubmissionAttachmentReach } from "./require-submission-attachment-reach";
import {
  attachmentListSchema,
  attachmentSchema,
  presignAttachmentResponseSchema,
} from "./response";
import {
  attachmentIdParam,
  presignAttachmentBody,
  workItemKeyParam,
} from "./schema";

/** `attachments.md`: work-item routes plus IQ-9 submission-parent transfer routes. */
function toAttachmentResponse(row: {
  id: string;
  workItemId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  state: string;
  customerVisible: boolean;
  uploadedBy: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}) {
  return {
    id: row.id,
    workItemId: row.workItemId ?? "",
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    state: row.state,
    customerVisible: row.customerVisible,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

function resolveActor(
  userId: string,
  apiKey: { id: string } | undefined,
): { actorId: string; actorType: "person" | "api_key" } {
  return { actorId: userId, actorType: apiKey ? "api_key" : "person" };
}

const presignAttachmentRoute = createRoute({
  method: "post",
  operationId: "presignAttachment",
  path: "/work-items/{key}/attachments/presign",
  tags: ["Attachments"],
  summary: "Presign an attachment upload",
  description:
    "AT-2: mints a presigned direct-PUT for a new attachment on this work item. The " +
    "API never proxies the bytes themselves.",
  middleware: [
    requireWorkItemReach(),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: {
    params: workItemKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: presignAttachmentBody } },
    },
  },
  responses: {
    200: jsonResponse("The presigned upload", presignAttachmentResponseSchema),
    400: errorResponse(
      "Invalid body, disallowed extension, oversized file, or per-item limit reached",
    ),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Work item not found"),
  },
});

const listWorkItemAttachmentsRoute = createRoute({
  method: "get",
  operationId: "listWorkItemAttachments",
  path: "/work-items/{key}/attachments",
  tags: ["Attachments"],
  summary: "List a work item's attachments",
  middleware: [
    requireWorkItemReach("key", { requireProjectReach: true }),
  ] as const,
  request: { params: workItemKeyParam },
  responses: {
    200: jsonResponse("The work item's attachments", attachmentListSchema),
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Work item not found"),
  },
});

const completeAttachmentRoute = createRoute({
  method: "post",
  operationId: "completeAttachment",
  path: "/attachments/{id}/complete",
  tags: ["Attachments"],
  summary: "Complete an attachment upload",
  description:
    "AT-2's edge case: rejects a declared MIME that does not match the uploaded " +
    "bytes' own magic bytes, deleting the object.",
  middleware: [
    requireAttachmentReach(),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: { params: attachmentIdParam },
  responses: {
    200: jsonResponse("The completed attachment", attachmentSchema),
    400: errorResponse(
      "Upload missing, or content does not match declared type",
    ),
    403: errorResponse("Missing work_item:update permission"),
    404: errorResponse("Attachment not found"),
    409: errorResponse("Attachment is not pending"),
  },
});

const downloadAttachmentRoute = createRoute({
  method: "get",
  operationId: "downloadAttachment",
  path: "/attachments/{id}",
  tags: ["Attachments"],
  summary: "Download an attachment",
  description:
    "AT-5/AT-6: redirects to a five-minute presigned download URL and writes an " +
    "attachment.downloaded audit row.",
  middleware: [
    requireAttachmentReach("id", { requireProjectReach: true }),
  ] as const,
  request: { params: attachmentIdParam },
  responses: {
    302: { description: "Redirect to the presigned download URL" },
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Attachment not found, or not ready"),
  },
});

const deleteAttachmentRoute = createRoute({
  method: "delete",
  operationId: "deleteAttachment",
  path: "/attachments/{id}",
  tags: ["Attachments"],
  summary: "Delete an attachment",
  description:
    "AT-7: soft delete. Only the attachment's own uploader may do this.",
  middleware: [
    requireAttachmentReach(),
    requireWorkspacePermission({ work_item: ["update"] }),
  ] as const,
  request: { params: attachmentIdParam },
  responses: {
    200: jsonResponse("The deleted attachment", attachmentSchema),
    403: errorResponse(
      "Not the uploader, or missing work_item:update permission",
    ),
    404: errorResponse("Attachment not found"),
  },
});

const portalSubmissionPresignBody = presignAttachmentBody
  .extend({ fieldKey: z.string().min(1).max(100).optional() })
  .strict();
const portalSubmissionPresignRoute = createRoute({
  method: "post",
  operationId: "presignPortalSubmissionAttachment",
  path: "/portal/submissions/{ref}/attachments/presign",
  tags: ["Attachments"],
  summary: "Presign a customer attachment upload",
  middleware: [requireSubmissionAttachmentReach("portal_upload")] as const,
  request: {
    params: submissionRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: portalSubmissionPresignBody } },
    },
  },
  responses: {
    200: jsonResponse("The presigned upload", presignAttachmentResponseSchema),
    400: errorResponse("Invalid or disallowed file"),
    404: errorResponse("Submission not found"),
  },
});
const portalSubmissionCompleteRoute = createRoute({
  method: "post",
  operationId: "completePortalSubmissionAttachment",
  path: "/portal/submissions/{ref}/attachments/{id}/complete",
  tags: ["Attachments"],
  summary: "Verify and complete a customer attachment upload",
  middleware: [requireSubmissionAttachmentReach("portal_complete")] as const,
  request: {
    params: submissionRefParam.extend({ id: attachmentIdParam.shape.id }),
  },
  responses: {
    200: jsonResponse(
      "Completed submission attachment",
      attachmentSchema.extend({
        workItemId: attachmentSchema.shape.workItemId.nullable(),
        submissionId: z.string().nullable(),
      }),
    ),
    400: errorResponse("Upload bytes are invalid"),
    404: errorResponse("Attachment not found"),
    409: errorResponse("Attachment is no longer pending"),
  },
});
const portalSubmissionListRoute = createRoute({
  method: "get",
  operationId: "listPortalSubmissionAttachments",
  path: "/portal/submissions/{ref}/attachments",
  tags: ["Attachments"],
  summary: "List visible submission attachments",
  middleware: [requireSubmissionAttachmentReach("portal_upload")] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse(
      "Customer-visible attachments",
      z.array(
        z.object({
          id: z.string(),
          filename: z.string(),
          mimeType: z.string(),
          size: z.number(),
          submissionFieldKey: z.string().nullable(),
          state: z.string(),
          createdAt: z.date(),
        }),
      ),
    ),
  },
});
const portalSubmissionDownloadRoute = createRoute({
  method: "get",
  operationId: "downloadPortalSubmissionAttachment",
  path: "/portal/submissions/{ref}/attachments/{id}",
  tags: ["Attachments"],
  summary: "Download a visible submission attachment",
  middleware: [requireSubmissionAttachmentReach("portal_download")] as const,
  request: {
    params: submissionRefParam.extend({ id: attachmentIdParam.shape.id }),
  },
  responses: {
    302: { description: "Redirect to the presigned download URL" },
    404: errorResponse("Attachment not found"),
  },
});
const staffSubmissionListRoute = createRoute({
  method: "get",
  operationId: "listSubmissionAttachments",
  path: "/submissions/{ref}/attachments",
  tags: ["Attachments"],
  summary: "List attachments for triage",
  middleware: [
    requireSubmissionAttachmentReach("staff_list"),
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: { params: submissionRefParam },
  responses: {
    200: jsonResponse(
      "Submission attachments",
      z.array(
        z.object({
          id: z.string(),
          filename: z.string(),
          mimeType: z.string(),
          size: z.number(),
          submissionFieldKey: z.string().nullable(),
          state: z.string(),
          customerVisible: z.boolean(),
          createdAt: z.date(),
        }),
      ),
    ),
    403: errorResponse("Missing triage permission"),
    404: errorResponse("Submission not found"),
  },
});
const staffSubmissionDownloadRoute = createRoute({
  method: "get",
  operationId: "downloadSubmissionAttachment",
  path: "/submissions/{ref}/attachments/{id}",
  tags: ["Attachments"],
  summary: "Download an attachment during triage",
  middleware: [
    requireSubmissionAttachmentReach("staff_download"),
    requireApiKeyPermissionScope({ intake: ["triage"] }),
    requireWorkspaceCapability("intake:triage"),
  ] as const,
  request: {
    params: submissionRefParam.extend({ id: attachmentIdParam.shape.id }),
  },
  responses: {
    302: { description: "Redirect to the presigned download URL" },
    403: errorResponse("Missing triage permission"),
    404: errorResponse("Attachment not found"),
  },
});

const attachment = apiRouter<
  BaseVariables & {
    workspaceId: string;
    workItemId: string;
    submissionId: string;
    submissionWorkItemId: string | null;
    requesterId: string;
    attachmentId?: string;
    policyOrganisationId: string;
    policyOrganisationIdSource: "row";
    portalPredicateSatisfied: boolean;
  }
>()
  .openapi(presignAttachmentRoute, async (c) => {
    const body = c.req.valid("json");
    const workItemId = c.get("workItemId") as string;
    const workspaceId = c.get("workspaceId") as string;

    const result = await presignAttachment({
      workItemId,
      workspaceId,
      filename: body.filename,
      contentType: body.contentType,
      size: body.size,
      customerVisible: body.customerVisible ?? false,
      userId: c.get("userId"),
      apiBaseUrl: new URL(c.req.url).origin,
    });

    return c.json(result, 200);
  })
  .openapi(listWorkItemAttachmentsRoute, async (c) => {
    const workItemId = c.get("workItemId") as string;
    const rows = await listWorkItemAttachments(workItemId);
    return c.json(rows.map(toAttachmentResponse), 200);
  })
  .openapi(completeAttachmentRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workItemId = c.get("workItemId") as string;
    const workspaceId = c.get("workspaceId") as string;
    const { actorId, actorType } = resolveActor(
      c.get("userId"),
      c.get("apiKey"),
    );

    const result = await completeAttachment({
      attachmentId: id,
      workspaceId,
      workItemId,
      actorId,
      actorType,
    });
    return c.json(toAttachmentResponse(result), 200);
  })
  .openapi(downloadAttachmentRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workItemId = c.get("workItemId") as string;
    const workspaceId = c.get("workspaceId") as string;
    const apiKey = c.get("apiKey");
    const { actorId, actorType } = resolveActor(c.get("userId"), apiKey);

    const { downloadUrl } = await downloadAttachment({
      attachmentId: id,
      workspaceId,
      workItemId,
      actorId,
      actorType,
      apiKeyId: apiKey?.id ?? null,
      apiBaseUrl: new URL(c.req.url).origin,
    });

    return c.redirect(downloadUrl, 302);
  })
  .openapi(deleteAttachmentRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workItemId = c.get("workItemId") as string;
    const workspaceId = c.get("workspaceId") as string;
    const userId = c.get("userId");
    const { actorId, actorType } = resolveActor(userId, c.get("apiKey"));

    const result = await deleteAttachment({
      attachmentId: id,
      workspaceId,
      workItemId,
      userId,
      actorId,
      actorType,
    });
    return c.json(toAttachmentResponse(result), 200);
  })
  .openapi(portalSubmissionPresignRoute, async (c) =>
    c.json(
      await presignSubmissionAttachment({
        submissionId: c.get("submissionId"),
        requesterId: c.get("requesterId"),
        workspaceId: c.get("workspaceId"),
        fieldKey: c.req.valid("json").fieldKey,
        filename: c.req.valid("json").filename,
        contentType: c.req.valid("json").contentType,
        size: c.req.valid("json").size,
        apiBaseUrl: new URL(c.req.url).origin,
      }),
      200,
    ),
  )
  .openapi(portalSubmissionCompleteRoute, async (c) =>
    c.json(
      await completeSubmissionAttachment({
        attachmentId: c.req.valid("param").id,
        submissionId: c.get("submissionId"),
        submissionWorkItemId: c.get("submissionWorkItemId"),
        requesterId: c.get("requesterId"),
        workspaceId: c.get("workspaceId"),
      }),
      200,
    ),
  )
  .openapi(portalSubmissionListRoute, async (c) => {
    const parents = [
      eq(schema.attachmentTable.submissionId, c.get("submissionId")),
      ...(c.get("submissionWorkItemId")
        ? [
            eq(
              schema.attachmentTable.workItemId,
              c.get("submissionWorkItemId") as string,
            ),
          ]
        : []),
    ];
    const rows = await db
      .select({
        id: schema.attachmentTable.id,
        filename: schema.attachmentTable.filename,
        mimeType: schema.attachmentTable.mimeType,
        size: schema.attachmentTable.size,
        submissionFieldKey: schema.attachmentTable.submissionFieldKey,
        state: schema.attachmentTable.state,
        createdAt: schema.attachmentTable.createdAt,
      })
      .from(schema.attachmentTable)
      .where(
        and(
          or(...parents),
          eq(schema.attachmentTable.customerVisible, true),
          isNull(schema.attachmentTable.deletedAt),
        ),
      )
      .orderBy(schema.attachmentTable.createdAt);
    return c.json(rows, 200);
  })
  .openapi(portalSubmissionDownloadRoute, async (c) => {
    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, c.req.valid("param").id))
      .limit(1);
    if (!row) throw new Error("Authorized submission attachment disappeared");
    const downloadUrl = await createAttachmentDownloadUrl(
      row.objectKey,
      row.filename,
      new URL(c.req.url).origin,
    );
    await appendAuditLog(db, {
      actorId: c.get("requesterId"),
      actorType: "person",
      workspaceId: c.get("workspaceId"),
      action: "attachment.downloaded",
      entityType: "attachment",
      entityId: row.id,
    });
    return c.redirect(downloadUrl, 302);
  })
  .openapi(staffSubmissionListRoute, async (c) => {
    const parents = [
      eq(schema.attachmentTable.submissionId, c.get("submissionId")),
      ...(c.get("submissionWorkItemId")
        ? [
            eq(
              schema.attachmentTable.workItemId,
              c.get("submissionWorkItemId") as string,
            ),
          ]
        : []),
    ];
    const rows = await db
      .select({
        id: schema.attachmentTable.id,
        filename: schema.attachmentTable.filename,
        mimeType: schema.attachmentTable.mimeType,
        size: schema.attachmentTable.size,
        submissionFieldKey: schema.attachmentTable.submissionFieldKey,
        state: schema.attachmentTable.state,
        customerVisible: schema.attachmentTable.customerVisible,
        createdAt: schema.attachmentTable.createdAt,
      })
      .from(schema.attachmentTable)
      .where(and(or(...parents), isNull(schema.attachmentTable.deletedAt)))
      .orderBy(schema.attachmentTable.createdAt);
    return c.json(rows, 200);
  })
  .openapi(staffSubmissionDownloadRoute, async (c) => {
    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, c.req.valid("param").id))
      .limit(1);
    if (!row) throw new Error("Authorized submission attachment disappeared");
    const downloadUrl = await createAttachmentDownloadUrl(
      row.objectKey,
      row.filename,
      new URL(c.req.url).origin,
    );
    await appendAuditLog(db, {
      actorId: c.get("userId"),
      actorType: c.get("apiKey") ? "api_key" : "person",
      apiKeyId: c.get("apiKey")?.id ?? null,
      workspaceId: c.get("workspaceId"),
      action: "attachment.downloaded",
      entityType: "attachment",
      entityId: row.id,
    });
    return c.redirect(downloadUrl, 302);
  });

export default attachment;
