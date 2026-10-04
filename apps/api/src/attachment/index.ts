import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { requireWorkItemReach } from "../work-item/require-work-item-reach";
import completeAttachment from "./controllers/complete-attachment";
import deleteAttachment from "./controllers/delete-attachment";
import downloadAttachment from "./controllers/download-attachment";
import listWorkItemAttachments from "./controllers/list-work-item-attachments";
import presignAttachment from "./controllers/presign-attachment";
import { requireAttachmentReach } from "./require-attachment-reach";
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

/**
 * `attachments.md`'s route table, WORK-ITEM slice only -- see `attachment/policy.ts`'s
 * own file comment for what is out of scope and why (`comment_id`/`submission_id`
 * parents; the portal-attach route; the reopen-on-upload mechanism).
 */
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
    requireWorkItemReach(),
    // B4 security-review fix (2026-09-27): this route only ever ran the reach check --
    // no capability gate at all -- even though `attachment/policy.ts` declares
    // `work_item:read` for it and the permission matrix fixture claims a caller without
    // that capability gets 403. A custom role holding only `{"workspace":["read"]}` (no
    // `work_item:read`) got 200 here while the single-attachment download route
    // correctly 403'd for the same identity.
    requireWorkspacePermission({ work_item: ["read"] }),
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
    "attachment.downloaded audit row. AT-8/AT-9 allow representation=preview only " +
    "for verified PNG/JPEG/GIF/WebP/PDF rows.",
  middleware: [
    requireAttachmentReach(),
    requireWorkspacePermission({ work_item: ["read"] }),
  ] as const,
  request: {
    params: attachmentIdParam,
    query: z.strictObject({ representation: z.enum(["preview"]).optional() }),
  },
  responses: {
    302: { description: "Redirect to the presigned download URL" },
    403: errorResponse("Missing work_item:read permission"),
    404: errorResponse("Attachment not found, or not ready"),
    415: errorResponse("This attachment type cannot be previewed"),
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

const attachment = apiRouter<
  BaseVariables & { workspaceId: string; workItemId: string }
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
    const { representation } = c.req.valid("query");
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
      representation: representation ?? "download",
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
  });

export default attachment;
