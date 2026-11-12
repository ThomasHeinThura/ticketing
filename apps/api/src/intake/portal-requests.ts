import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { customerVisibleFileOf } from "../attachment/repository";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { logTaskDesk } from "../instance/observability/runtime";
import { resolveCustomerReplyRecipients } from "../notification/work-item-recipients";
import { z } from "../openapi";
import { portalCanDownloadObject } from "../storage/portal-servable";
import { dbNowUtc } from "../utils/db-time";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../work-item/assert-work-item-live";
import { resolveCommentAuthors } from "../work-item/comment-access";
import { findWorkItemMentionContext } from "../work-item/mention-access";
import {
  publishWorkItemHint,
  recordWorkItemEvent,
} from "../work-item/native-event";
import {
  recordReopenRequested,
  requestCustomerReopen,
} from "../workflow/customer-reopen";
import { appendIntakeAudit } from "./audit";
import { loadPortalCustomFields } from "./custom-field-mapping";
import { findReadableDirectCase, portalCaseSchema } from "./portal-cases";
import {
  extractDocumentText,
  loadPortalViewer,
  type PortalViewer,
  paragraphDocument,
  portalIdentity,
  portalMessageAuthors,
} from "./repository";

/**
 * A request raised by staff for a customer (`direct`, D6), opened and answered in the portal
 * (U-12, closing the D6 known gap). Served on the contract's `own_request` routes
 * (`GET /api/portal/requests/{ref}`, `POST /api/portal/requests/{ref}/comments`,
 * `POST /api/portal/requests/{ref}/attachments/presign`).
 *
 * - **Reach** is the case list's own row (`findReadableDirectCase`): the requester, a participant,
 *   or any colleague of the same organisation when the item is organisation-visible. Anything else
 *   is the constant 404 (`CP-2`).
 * - **Writes and files** are the requester's only (`CP-16`): a colleague or participant reads the
 *   request, its public conversation and status, not its files.
 * - **Only public, live comments** are returned; internal comments, assignee, claimer and internal
 *   fields never are (`CP-3`, `CP-4`). Files are customer-visible ones on the item or on a public
 *   comment (`AT-3`, `AT-4`).
 */

/**
 * A work item key: the project key, a hyphen and the item number (`SUP-12`). A segment that does
 * not end in a number (`backlog`, `export.csv`) is never a direct request.
 */
const WORK_ITEM_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}-[1-9]\d{0,9}$/u;

export const portalRequestRefParam = z.object({
  ref: z.string().max(100),
});

export const portalRequestCommentBody = z
  .object({ body: z.string().trim().min(1).max(10_000) })
  .strict();

const portalMessageSchema = z.object({
  id: z.string(),
  /** `customer` or `triager` (staff); a comment with no author is `system`. */
  actorType: z.enum(["customer", "triager", "system"]),
  /** `CP-4`: only staff who act publicly are named; always null for a customer. */
  authorName: z.string().nullable(),
  mine: z.boolean(),
  body: z.string(),
  createdAt: z.string().datetime(),
});

export const portalRequestSchema = portalCaseSchema.extend({
  description: z.string(),
  resolvedAt: z.string().datetime().nullable(),
  /** CF-11: customer-visible custom fields that hold a value (label and value only). */
  customFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      format: z.string(),
      helpText: z.string().nullable(),
      value: z.unknown(),
    }),
  ),
  /** `CP-16`: the requester replies; a colleague or participant has a read-only view. */
  canReply: z.boolean(),
  /** `CP-16`: files stay requester-only (list, download, upload). */
  canViewAttachments: z.boolean(),
  /**
   * The requester may attach files to a reply (A-08). On the filesystem storage driver the
   * upload goes through a portal-bound signed link (CP-19).
   */
  canUpload: z.boolean(),
  messages: z.array(portalMessageSchema),
});
export type PortalRequest = z.infer<typeof portalRequestSchema>;

export const portalRequestAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  state: z.string(),
  /** True for a file the viewer uploaded; false for one the team shared. */
  mine: z.boolean(),
  /**
   * The portal can serve the file's bytes: true once the file is ready (CP-19: work-item files
   * through a portal-bound signed link); false while it is still uploading.
   */
  downloadable: z.boolean(),
  createdAt: z.string().datetime(),
});

export const portalRequestReplySchema = z.object({
  ref: z.string(),
  message: portalMessageSchema,
});

type PortalRequestVariables = {
  userId: string;
  portalPredicateSatisfied: boolean;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
  portalPersonId: string;
  portalWorkItemId: string;
  portalWorkspaceId: string;
  portalIsRequester: boolean;
};

function notFound(): never {
  throw new HTTPException(404, { message: "Request not found" });
}

async function readableDirectRequest(
  viewer: PortalViewer,
  ref: string,
  withSla = true,
) {
  if (!WORK_ITEM_KEY.test(ref)) notFound();
  const found = await findReadableDirectCase(viewer, ref, { withSla });
  if (!found) notFound();
  return found;
}

/**
 * The `own_request` predicate for a direct request. `read`: anyone the case list shows it to.
 * `requester`: the requester only (reply, files), everyone else the same 404.
 */
export function portalDirectRequest(mode: "read" | "requester") {
  return async (
    c: Context<{ Variables: PortalRequestVariables }>,
    next: Next,
  ) => {
    const identity = await portalIdentity(c.get("userId"));
    const ref = c.req.param("ref") ?? "";
    const viewer = await loadPortalViewer(identity.personId);
    const found = await readableDirectRequest(viewer, ref, false);
    if (mode === "requester" && !found.item.isRequester) notFound();
    const [item] = await db
      .select({ workspaceId: schema.workItemTable.workspaceId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, found.workItemId))
      .limit(1);
    if (!item) notFound();
    c.set("portalPersonId", identity.personId);
    c.set("portalWorkItemId", found.workItemId);
    c.set("portalWorkspaceId", item.workspaceId);
    c.set("portalIsRequester", found.item.isRequester);
    c.set("portalPredicateSatisfied", true);
    c.set("policyOrganisationId", identity.organisationId);
    c.set("policyOrganisationIdSource", "row");
    await next();
  };
}

async function publicMessages(
  executor: Executor,
  workItemId: string,
  viewerPersonId: string,
) {
  const comments = await executor
    .select({
      id: schema.commentTable.id,
      authorId: schema.commentTable.authorId,
      actorType: schema.commentTable.actorType,
      body: schema.commentTable.body,
      createdAt: schema.commentTable.createdAt,
    })
    .from(schema.commentTable)
    .where(
      and(
        eq(schema.commentTable.workItemId, workItemId),
        eq(schema.commentTable.visibility, "public"),
        isNull(schema.commentTable.deletedAt),
        isNotNull(schema.commentTable.body),
      ),
    )
    .orderBy(asc(schema.commentTable.createdAt), asc(schema.commentTable.id));
  // Older comments may store the author's user id; resolve every author to a person first.
  const people = await resolveCommentAuthors(
    executor,
    comments.map((comment) => comment.authorId),
  );
  const authorPersonId = (authorId: string | null) =>
    authorId ? (people.get(authorId) ?? null) : null;
  const authorOf = await portalMessageAuthors(
    comments.map((comment) => ({
      authorId: authorPersonId(comment.authorId),
      // Staff or customer is decided from the author person's side (`CP-4`).
      actorType: "triager",
    })),
    viewerPersonId,
  );
  return comments.map((comment) => {
    const personId = authorPersonId(comment.authorId);
    return {
      id: comment.id,
      ...authorOf(personId, personId ? "triager" : "system"),
      body: extractDocumentText(comment.body),
      createdAt: comment.createdAt.toISOString(),
    };
  });
}

/** `GET /api/portal/requests/{ref}`: the direct request page. */
export async function getPortalRequest(
  personId: string,
  ref: string,
): Promise<PortalRequest> {
  const viewer = await loadPortalViewer(personId);
  const found = await readableDirectRequest(viewer, ref);
  const [item] = await db
    .select({
      id: schema.workItemTable.id,
      workspaceId: schema.workItemTable.workspaceId,
      typeId: schema.workItemTable.typeId,
      description: schema.workItemTable.description,
      resolvedAt: schema.workItemTable.resolvedAt,
    })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, found.workItemId))
    .limit(1);
  if (!item) notFound();
  const [customFields, messages] = await Promise.all([
    loadPortalCustomFields(db, item),
    publicMessages(db, item.id, personId),
  ]);
  const isRequester = found.item.isRequester;
  return {
    ...found.item,
    description: extractDocumentText(item.description),
    resolvedAt: item.resolvedAt ? item.resolvedAt.toISOString() : null,
    customFields: customFields.map((field) => ({
      key: field.key,
      label: field.label,
      format: field.format,
      helpText: field.helpText ?? null,
      value: field.value,
    })),
    canReply: isRequester,
    canViewAttachments: isRequester,
    canUpload: isRequester,
    messages,
  };
}

/**
 * `POST /api/portal/requests/{ref}/comments`: the requester's reply, stored as a public comment
 * on the work item. Staff are told through the comment notification (`NO-19`: assignee and
 * watchers) plus whoever last handled the request (`NO-21`: the latest public staff commenter,
 * else the project leads), so an unassigned request still reaches the team. A reply to a resolved request asks for a reopen (`WF-21`), exactly as a reply on an
 * accepted submission does.
 */
export async function replyToPortalRequest(input: {
  userId: string;
  personId: string;
  workItemId: string;
  workspaceId: string;
  ref: string;
  body: string;
}) {
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        key: schema.workItemTable.key,
        projectId: schema.workItemTable.projectId,
        requesterId: schema.workItemTable.requesterId,
        resolvedAt: schema.workItemTable.resolvedAt,
        deletedAt: schema.workItemTable.deletedAt,
        archivedAt: schema.workItemTable.archivedAt,
      })
      .from(schema.workItemTable)
      .where(
        and(
          eq(schema.workItemTable.id, input.workItemId),
          eq(schema.workItemTable.workspaceId, input.workspaceId),
        ),
      )
      .for("update");
    assertWorkItemStillLive(locked, "Request not found");
    // The requester may have changed since the reach check; the lock makes this final.
    if (locked.requesterId !== input.personId || locked.key !== input.ref)
      notFound();
    await assertProjectStillLive(tx, locked.projectId);
    const context = await findWorkItemMentionContext(tx, input.workItemId);
    if (!context || !context.organisationId) notFound();
    const [hasAccess] = await tx
      .select({ projectId: schema.customerProjectAccessTable.projectId })
      .from(schema.customerProjectAccessTable)
      .where(
        and(
          eq(schema.customerProjectAccessTable.personId, input.personId),
          eq(schema.customerProjectAccessTable.projectId, locked.projectId),
        ),
      )
      .limit(1);
    if (!hasAccess) notFound();
    const [comment] = await tx
      .insert(schema.commentTable)
      .values({
        workspaceId: input.workspaceId,
        workItemId: input.workItemId,
        authorId: input.personId,
        actorType: "person",
        body: paragraphDocument(input.body),
        visibility: "public",
        createdAt: dbNowUtc(),
        updatedAt: dbNowUtc(),
      })
      .returning();
    if (!comment)
      throw new HTTPException(500, { message: "Could not post the reply" });
    await appendIntakeAudit(tx, {
      actorId: input.userId,
      actorType: "person",
      workspaceId: input.workspaceId,
      projectId: locked.projectId,
      action: "work_item.commented",
      entityType: "comment",
      entityId: comment.id,
      after: {
        workItemId: input.workItemId,
        visibility: "public",
        by: "customer",
      },
    });
    const event = await recordWorkItemEvent(tx, {
      kind: "work_item.commented",
      workItemId: input.workItemId,
      key: locked.key,
      workspaceId: input.workspaceId,
      organisationId: context.organisationId ?? undefined,
      projectId: locked.projectId,
      // The auth user, so the comment notification never goes back to its own author.
      actorId: input.userId,
      actorType: "person",
      actorName: "Customer",
      customerVisible: true,
      payload: {
        key: locked.key,
        workItemId: input.workItemId,
        url: `/agent/work-items/${encodeURIComponent(locked.key)}`,
        commentId: comment.id,
        visibility: "public",
      },
      notify: { resolveRecipients: resolveCustomerReplyRecipients },
    });
    if (locked.resolvedAt)
      await recordReopenRequested(tx, {
        workspaceId: input.workspaceId,
        workItemId: input.workItemId,
        source: "reply",
      });
    return {
      comment,
      event,
      key: locked.key,
      projectId: locked.projectId,
      reopen: locked.resolvedAt !== null,
    };
  });
  await publishWorkItemHint(result.event, {
    kind: "work_item.commented",
    key: result.key,
    projectId: result.projectId,
    customerVisible: true,
  });
  if (result.reopen) {
    // WF-21: the reopen request is already durable (`reopen_received`); a failure here never
    // fails the committed reply, and it is logged.
    try {
      await requestCustomerReopen({
        workItemId: input.workItemId,
        source: "reply",
      });
    } catch {
      logTaskDesk({
        module: "jobs",
        message: "jobs.failure",
        level: "error",
        result: "degraded",
      });
    }
  }
  return {
    ref: input.ref,
    message: {
      id: result.comment.id,
      actorType: "customer" as const,
      authorName: null,
      mine: true,
      body: extractDocumentText(result.comment.body),
      createdAt: result.comment.createdAt.toISOString(),
    },
  };
}

/** The requester's view of the request's files: customer-visible, and pending only when theirs. */
export async function listPortalRequestAttachments(input: {
  workItemId: string;
  personId: string;
}) {
  const rows = await db
    .select({
      id: schema.attachmentTable.id,
      filename: schema.attachmentTable.filename,
      mimeType: schema.attachmentTable.mimeType,
      size: schema.attachmentTable.size,
      state: schema.attachmentTable.state,
      uploadedBy: schema.attachmentTable.uploadedBy,
      objectKey: schema.attachmentTable.objectKey,
      createdAt: schema.attachmentTable.createdAt,
    })
    .from(schema.attachmentTable)
    .where(
      and(
        customerVisibleFileOf(input.workItemId),
        or(
          eq(schema.attachmentTable.state, "ready"),
          and(
            eq(schema.attachmentTable.state, "pending"),
            eq(schema.attachmentTable.uploadedBy, input.personId),
          ),
        ),
      ),
    )
    .orderBy(
      asc(schema.attachmentTable.createdAt),
      asc(schema.attachmentTable.id),
    );
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    state: row.state,
    mine: row.uploadedBy === input.personId,
    downloadable:
      row.state === "ready" && portalCanDownloadObject(row.objectKey),
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Resolve the requester and attachment from current portal reach. */
export async function resolvePortalRequestDownload(
  personId: string,
  ref: string,
  id: string,
) {
  const viewer = await loadPortalViewer(personId);
  const found = await readableDirectRequest(viewer, ref, false);
  if (!found.item.isRequester) notFound();
  const [item] = await db
    .select({ workspaceId: schema.workItemTable.workspaceId })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, found.workItemId))
    .limit(1);
  if (!item) notFound();
  return findPortalRequestDownload({
    id,
    workItemId: found.workItemId,
    workspaceId: item.workspaceId,
  });
}

/** A ready, customer-visible file of this request, for download (`AT-5`). */
export async function findPortalRequestDownload(input: {
  id: string;
  workItemId: string;
  workspaceId: string;
}) {
  const [row] = await db
    .select({
      id: schema.attachmentTable.id,
      objectKey: schema.attachmentTable.objectKey,
      filename: schema.attachmentTable.filename,
      mimeType: schema.attachmentTable.mimeType,
      size: schema.attachmentTable.size,
    })
    .from(schema.attachmentTable)
    .where(
      and(
        eq(schema.attachmentTable.id, input.id),
        eq(schema.attachmentTable.workspaceId, input.workspaceId),
        eq(schema.attachmentTable.state, "ready"),
        customerVisibleFileOf(input.workItemId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** `AT-6`: every portal download writes an audit row, attributed to the customer person. */
export async function auditPortalRequestDownload(input: {
  personId: string;
  workspaceId: string;
  attachmentId: string;
}) {
  await appendAuditLog(db, {
    actorId: input.personId,
    actorType: "person",
    workspaceId: input.workspaceId,
    action: "attachment.downloaded",
    entityType: "attachment",
    entityId: input.attachmentId,
  });
}

/**
 * The requester's reply may carry files: they attach to the reply comment, which must be a live
 * public comment the requester wrote on this request.
 */
export async function assertOwnPublicReply(input: {
  commentId: string;
  workItemId: string;
  personId: string;
}) {
  const [row] = await db
    .select({ id: schema.commentTable.id })
    .from(schema.commentTable)
    .where(
      and(
        eq(schema.commentTable.id, input.commentId),
        eq(schema.commentTable.workItemId, input.workItemId),
        eq(schema.commentTable.authorId, input.personId),
        eq(schema.commentTable.visibility, "public"),
        isNull(schema.commentTable.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Comment not found" });
}
