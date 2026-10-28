import { randomUUID } from "node:crypto";
import type { JsonValue } from "@taskdesk/domain";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { AuditRequestContext } from "../../audit/request-context";
import db from "../../database";
import {
  commentTable,
  personTable,
  watcherTable,
  workItemTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { appendAuditSavepoint } from "../../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import { enqueueNotificationEvent } from "../../notification/fanout";
import { resolveMentionEventRecipient } from "../../notification/recipient-resolvers";
import { resolveCommentEventRecipients } from "../../notification/work-item-recipients";
import type { ApiKey } from "../../openapi";
import { dbNowUtc } from "../../utils/db-time";
import { parseNativeMentionPersonIds } from "../../utils/parse-native-mentions";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "../../utils/require-workspace-capability";
import type { ActivityActorType } from "../activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../assert-work-item-live";
import { loadCommentCaller, requireCommentPerson } from "../comment-access";
import {
  classifyWorkItemMentionPeople,
  findWorkItemMentionContext,
} from "../mention-access";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";

export type CreateCommentInput = {
  body: unknown;
  visibility: "public" | "internal";
};

/**
 * `POST /api/work-items/{key}/comments` (`docs/03-features/comments-and-activity.md`).
 * `CA-1`: visibility is chosen explicitly at composition -- there is no default here, and
 * none in `createCommentBody` either (`comment-schema.ts`). The required capability
 * depends on that choice (rbac.md § Comments): `comment:create` for `public`,
 * `comment:create_internal` for `internal` -- so, like `PATCH /api/work-items/{key}`'s
 * `work_item:set_priority` branch, the check runs in the handler, after body validation,
 * not as route `middleware` (the body does not exist yet when `middleware` runs --
 * `openapi.ts`'s own comment).
 *
 * `SLA-7`: the first public comment from a staff-side person other than the requester
 * sets `work_item.first_response_at` in this same transaction. Internal comments and
 * requester comments never stop the metric.
 */
export async function createComment(
  workItemId: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  input: CreateCommentInput,
  apiKey?: ApiKey,
  audit?: Partial<AuditRequestContext>,
) {
  let auditFailed = false;
  const requiredCapability =
    input.visibility === "public"
      ? "comment:create"
      : "comment:create_internal";

  const mentionIds = parseNativeMentionPersonIds(input.body);
  // Issue #493: this route had NO in-transaction liveness re-check at all --
  // The work-item row is locked FOR UPDATE because a qualifying comment also sets its
  // first-response fact. This serializes concurrent first responses and keeps the
  // reach-check-to-write protection for soft-delete/archive.
  const { created, realtimeEvent, projectId, key } = await db.transaction(
    async (tx) => {
      const [locked] = await tx
        .select({
          projectId: workItemTable.projectId,
          key: workItemTable.key,
          requesterId: workItemTable.requesterId,
          firstResponseAt: workItemTable.firstResponseAt,
          deletedAt: workItemTable.deletedAt,
          archivedAt: workItemTable.archivedAt,
        })
        .from(workItemTable)
        .where(eq(workItemTable.id, workItemId))
        .for("update");
      assertWorkItemStillLive(locked);
      await assertProjectStillLive(tx, locked.projectId);
      const mentionContext = await findWorkItemMentionContext(tx, workItemId);
      if (!mentionContext || mentionContext.workspaceId !== workspaceId) {
        throw new HTTPException(404, { message: "Work item not found" });
      }

      // Check the owner's live workspace capability and the authenticated key's frozen
      // capability subset before inserting the comment or any mention side effects.
      // Keeping this in the write transaction ensures a denied key cannot leave a
      // comment, watcher, notification event, or outbox row behind.
      await assertCallerHasCapability(
        workspaceId,
        actorId,
        requiredCapability,
        capabilityCredential(apiKey),
        tx,
      );

      const authorPersonId = requireCommentPerson(
        await loadCommentCaller(
          tx,
          { userId: actorId, apiKey },
          { workspaceId, projectId: locked.projectId, workItemId },
        ),
      );
      const [row] = await tx
        .insert(commentTable)
        .values({
          workspaceId,
          workItemId,
          authorId: authorPersonId,
          actorType,
          body: input.body,
          visibility: input.visibility,
          // `comment.created_at` is a UTC wall clock in a `timestamp without time zone`
          // column, read back as UTC and compared with the 15-minute edit window (CA-17). Its
          // `DEFAULT now()` would store the session's local wall clock (#631).
          createdAt: dbNowUtc(),
          updatedAt: dbNowUtc(),
        })
        .returning();

      if (!row)
        return {
          created: row,
          realtimeEvent: undefined,
          projectId: locked.projectId,
          key: locked.key,
        };

      if (input.visibility === "public" && locked.firstResponseAt === null) {
        const [author] = await tx
          .select({ id: personTable.id, side: personTable.side })
          .from(personTable)
          .where(eq(personTable.userId, actorId))
          .limit(1);
        if (author?.side === "staff" && author.id !== locked.requesterId) {
          await tx
            .update(workItemTable)
            .set({ firstResponseAt: row.createdAt })
            .where(
              and(
                eq(workItemTable.id, workItemId),
                isNull(workItemTable.firstResponseAt),
              ),
            );
        }
      }

      const mentionCandidates = await classifyWorkItemMentionPeople(
        tx,
        mentionContext,
        mentionIds,
        input.visibility,
        { includeUnreachableCustomers: true },
      );
      const reachableMentionedPeople = mentionCandidates.filter(
        (candidate) => candidate.reachable && candidate.userId !== actorId,
      );
      // AU-14: a failed audit append never fails the comment, and is never silent.
      auditFailed = await appendAuditSavepoint(tx, {
        actorIp: audit?.actorIp ?? null,
        userAgent: audit?.userAgent ?? null,
        traceId: audit?.traceId ?? null,
        actorId,
        actorType,
        apiKeyId: apiKey?.id ?? audit?.apiKeyId ?? null,
        workspaceId,
        projectId: locked.projectId,
        action: "work_item.commented",
        entityType: "comment",
        entityId: row.id,
        before: null,
        after: {
          workItemId,
          visibility: row.visibility,
          body: (row.body ?? null) as JsonValue,
          ...(apiKey?.isMcp === true ? { origin: "mcp" as const } : {}),
        },
      });

      const realtimeEvent = await recordWorkItemEvent(tx, {
        kind: "work_item.commented",
        workItemId,
        key: locked.key,
        workspaceId,
        organisationId: mentionContext.organisationId ?? undefined,
        projectId: locked.projectId,
        actorId,
        actorType,
        customerVisible: row.visibility === "public",
        payload: {
          key: locked.key,
          workItemId,
          url: `/agent/work-items/${encodeURIComponent(locked.key)}`,
          commentId: row.id,
          visibility: row.visibility,
        },
        notify: { resolveRecipients: resolveCommentEventRecipients },
      });

      // Snapshot the comment's existing watchers before mention-only watchers are added.
      // A person made a watcher by this comment receives the direct mention event below,
      // without a second generic comment notification from the same write.
      for (const candidate of reachableMentionedPeople) {
        await tx
          .insert(watcherTable)
          .values({
            workItemId,
            personId: candidate.personId,
            source: "explicit",
            muted: false,
          })
          .onConflictDoNothing({
            target: [watcherTable.workItemId, watcherTable.personId],
          });

        const mentionEvent = {
          id: `evt_${randomUUID()}`,
          kind: "work_item.mentioned" as const,
          occurredAt: new Date().toISOString(),
          actor: {
            type: actorType === "api_key" ? "api_key" : "person",
            id: actorId,
            name: "TaskDesk actor",
          } as const,
          scope: {
            workspaceId: mentionContext.workspaceId,
            organisationId: mentionContext.organisationId ?? undefined,
            projectId: mentionContext.projectId,
          },
          payload: {
            key: mentionContext.key,
            url: `/agent/work-items/${encodeURIComponent(mentionContext.key)}`,
            workItemId: mentionContext.id,
            mentionedPersonId: candidate.personId,
            commentId: row.id,
          },
          causationId: null,
          depth: 0,
          originAutomationId: null,
        };
        await enqueueNotificationEvent(tx, mentionEvent, {
          resolveRecipients: resolveMentionEventRecipient,
        });
      }

      return {
        created: row,
        realtimeEvent,
        projectId: locked.projectId,
        key: locked.key,
      };
    },
  );

  if (auditFailed) await notifyCurrentInstanceAdminsOfAuditFailure("mutation");

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create comment" });
  }

  // `docs/01-architecture/events.md` ~56: `work_item.commented` -- "A customer never
  // receives an `internal` fan-out" (`NO-19`), so `visibility` travels on the event
  // itself, exactly as `work_item.updated`'s own `changes[].visibility` does
  // (`update-work-item.ts`). Published after the insert, matching every other
  // `publishEvent` caller's after-write placement.
  await publishEvent("work_item.commented", {
    commentId: created.id,
    workItemId,
    workspaceId,
    visibility: created.visibility,
    actorId,
    actorType,
  });
  if (realtimeEvent) {
    await publishWorkItemHint(realtimeEvent, {
      kind: "work_item.commented",
      key,
      projectId,
      customerVisible: created.visibility === "public",
    });
  }

  return created;
}

export default createComment;
