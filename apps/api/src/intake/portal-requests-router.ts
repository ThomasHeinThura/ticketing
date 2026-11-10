import { HTTPException } from "hono/http-exception";
import completeAttachment from "../attachment/controllers/complete-attachment";
import presignAttachment from "../attachment/controllers/presign-attachment";
import { presignAttachmentResponseSchema } from "../attachment/response";
import { attachmentIdParam, presignAttachmentBody } from "../attachment/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import {
  createPortalAttachmentDownloadUrl,
  portalCanDownloadObject,
} from "../storage/portal-servable";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import { requirePublicAppOrigin } from "../utils/request-origin";
import { intakeAuditContext } from "./audit";
import {
  assertOwnPublicReply,
  auditPortalRequestDownload,
  getPortalRequest,
  listPortalRequestAttachments,
  portalDirectRequest,
  portalRequestAttachmentSchema,
  portalRequestCommentBody,
  portalRequestRefParam,
  portalRequestReplySchema,
  portalRequestSchema,
  replyToPortalRequest,
  resolvePortalRequestDownload,
} from "./portal-requests";

/**
 * U-12: the `own_request` routes for a request raised by staff (`direct`, D6). Mounted after the
 * case list router so the static `/portal/requests/backlog`, `/rank` and `/export.csv` paths keep
 * their own handlers; a `ref` that is not a work item key answers the constant 404.
 */
type Variables = BaseVariables & {
  portalPredicateSatisfied: boolean;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
  portalPersonId: string;
  portalWorkItemId: string;
  portalWorkspaceId: string;
  portalIsRequester: boolean;
};

const attachmentParams = portalRequestRefParam.extend({
  id: attachmentIdParam.shape.id,
});

const presignBody = presignAttachmentBody
  .omit({ customerVisible: true })
  .extend({
    commentId: presignAttachmentBody.shape.commentId.openapi({
      description:
        "Attach the file to this reply: a live public comment the requester wrote on this request.",
    }),
  })
  .strict();

const detailRoute = createRoute({
  method: "get",
  operationId: "getPortalRequest",
  path: "/portal/requests/{ref}",
  tags: ["Portal submissions"],
  summary: "Get a request the team raised for the customer",
  description:
    "U-12 (D6): the requester, a participant or (organisation-visible) a colleague reads the request, its status, service target and public conversation. Internal comments and fields are never returned.",
  middleware: [portalDirectRequest("read")] as const,
  request: { params: portalRequestRefParam },
  responses: {
    200: jsonResponse("Request page", portalRequestSchema),
    404: errorResponse("Request not found"),
  },
});

const commentRoute = createRoute({
  method: "post",
  operationId: "replyToPortalRequest",
  path: "/portal/requests/{ref}/comments",
  tags: ["Portal submissions"],
  summary: "Reply on a request the team raised for the customer",
  description:
    "The requester's reply becomes a public comment on the work item and notifies the team. A reply to a resolved request asks for a reopen (WF-21).",
  middleware: [intakeAuditContext, portalDirectRequest("requester")] as const,
  request: {
    params: portalRequestRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: portalRequestCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("Reply posted", portalRequestReplySchema),
    404: errorResponse("Request not found"),
  },
});

const attachmentListRoute = createRoute({
  method: "get",
  operationId: "listPortalRequestAttachments",
  path: "/portal/requests/{ref}/attachments",
  tags: ["Attachments"],
  summary: "List the request's customer-visible files",
  middleware: [portalDirectRequest("requester")] as const,
  request: { params: portalRequestRefParam },
  responses: {
    200: jsonResponse(
      "Customer-visible files",
      z.array(portalRequestAttachmentSchema),
    ),
    404: errorResponse("Request not found"),
  },
});

const presignRoute = createRoute({
  method: "post",
  operationId: "presignPortalRequestAttachment",
  path: "/portal/requests/{ref}/attachments/presign",
  tags: ["Attachments"],
  summary: "Presign the requester's upload on a request",
  description:
    "AT-3: a customer upload is customer-visible. The configured size, type and per-item limits apply; the bytes are checked at completion. On the filesystem storage driver the upload URL is a portal-bound signed PUT for this requester and a fresh key under the work item (CP-19).",
  middleware: [portalDirectRequest("requester")] as const,
  request: {
    params: portalRequestRefParam,
    body: {
      required: true,
      content: { "application/json": { schema: presignBody } },
    },
  },
  responses: {
    200: jsonResponse("The presigned upload", presignAttachmentResponseSchema),
    400: errorResponse("Invalid or disallowed file"),
    404: errorResponse("Request or comment not found"),
  },
});

const completeRoute = createRoute({
  method: "post",
  operationId: "completePortalRequestAttachment",
  path: "/portal/requests/{ref}/attachments/{id}/complete",
  tags: ["Attachments"],
  summary: "Verify and complete the requester's upload",
  middleware: [portalDirectRequest("requester")] as const,
  request: { params: attachmentParams },
  responses: {
    200: jsonResponse("Completed file", portalRequestAttachmentSchema),
    400: errorResponse("Upload missing, too large or of the wrong type"),
    404: errorResponse("Attachment not found"),
    409: errorResponse("Attachment is no longer pending"),
  },
});

const downloadRoute = createRoute({
  method: "get",
  operationId: "downloadPortalRequestAttachment",
  path: "/portal/requests/{ref}/attachments/{id}",
  tags: ["Attachments"],
  summary: "Download a customer-visible file of the request",
  description:
    "302 to a five-minute person-bound portal URL; current reach is checked again when bytes are requested.",
  middleware: [portalDirectRequest("requester")] as const,
  request: { params: attachmentParams },
  responses: {
    302: { description: "Redirect to the presigned download URL" },
    404: errorResponse("Attachment not found"),
  },
});

const portalRequestsRouter = apiRouter<Variables>()
  .openapi(detailRoute, async (c) =>
    c.json(
      await getPortalRequest(c.get("portalPersonId"), c.req.valid("param").ref),
      200,
    ),
  )
  .openapi(commentRoute, async (c) =>
    c.json(
      await replyToPortalRequest({
        userId: c.get("userId"),
        personId: c.get("portalPersonId"),
        workItemId: c.get("portalWorkItemId"),
        workspaceId: c.get("portalWorkspaceId"),
        ref: c.req.valid("param").ref,
        body: c.req.valid("json").body,
      }),
      200,
    ),
  )
  .openapi(attachmentListRoute, async (c) =>
    c.json(
      await listPortalRequestAttachments({
        workItemId: c.get("portalWorkItemId"),
        personId: c.get("portalPersonId"),
      }),
      200,
    ),
  )
  .openapi(presignRoute, async (c) => {
    const body = c.req.valid("json");
    if (body.commentId)
      await assertOwnPublicReply({
        commentId: body.commentId,
        workItemId: c.get("portalWorkItemId"),
        personId: c.get("portalPersonId"),
      });
    return c.json(
      await presignAttachment({
        workItemId: c.get("portalWorkItemId"),
        workspaceId: c.get("portalWorkspaceId"),
        filename: body.filename,
        contentType: body.contentType,
        size: body.size,
        // AT-3: customer uploads are customer-visible (a reply is always public).
        customerVisible: true,
        ...(body.commentId ? { commentId: body.commentId } : {}),
        userId: c.get("userId"),
        apiBaseUrl: requirePublicAppOrigin(c.get("appPublicOrigin")),
        // CP-19: on the filesystem driver, a PUT the portal host admits only for this person.
        portalPersonId: c.get("portalPersonId"),
      }),
      200,
    );
  })
  .openapi(completeRoute, async (c) => {
    const completed = await completeAttachment({
      attachmentId: c.req.valid("param").id,
      workspaceId: c.get("portalWorkspaceId"),
      workItemId: c.get("portalWorkItemId"),
      actorId: c.get("userId"),
      actorType: "person",
      identity: await resolveCallerIdentity(c, c.get("userId")),
      portal: true,
    });
    // Customer-facing: the declared shape only, never the storage key.
    return c.json(
      {
        id: completed.id,
        filename: completed.filename,
        mimeType: completed.mimeType,
        size: completed.size,
        state: completed.state,
        mine: true,
        downloadable:
          completed.state === "ready" &&
          portalCanDownloadObject(completed.objectKey),
        createdAt: completed.createdAt.toISOString(),
      },
      200,
    );
  })
  .openapi(downloadRoute, async (c) => {
    const row = await resolvePortalRequestDownload(
      c.get("portalPersonId"),
      c.req.valid("param").ref,
      c.req.valid("param").id,
    );
    // Never redirect to, or audit, a download the portal host would refuse.
    if (!row || !portalCanDownloadObject(row.objectKey))
      throw new HTTPException(404, { message: "Attachment not found" });
    const downloadUrl = await createPortalAttachmentDownloadUrl({
      scope: "request",
      ref: c.req.valid("param").ref,
      id: row.id,
      personId: c.get("portalPersonId"),
      apiBaseUrl: requirePublicAppOrigin(c.get("appPublicOrigin")),
    });
    await auditPortalRequestDownload({
      personId: c.get("portalPersonId"),
      workspaceId: c.get("portalWorkspaceId"),
      attachmentId: row.id,
    });
    return c.redirect(downloadUrl, 302);
  });

export default portalRequestsRouter;
