import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  commentTable,
  personTable,
  watcherTable,
  workItemTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { enqueueNotificationEvent } from "../../notification/fanout";
import { resolveMentionEventRecipient } from "../../notification/recipient-resolvers";
import type { ApiKey } from "../../openapi";
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
) {
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

      const [row] = await tx
        .insert(commentTable)
        .values({
          workspaceId,
          workItemId,
          authorId: actorId,
          actorType,
          body: input.body,
          visibility: input.visibility,
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

      const realtimeEvent = await recordWorkItemEvent(tx, {
        kind: "work_item.commented",
        workItemId,
        key: locked.key,
        workspaceId,
        projectId: locked.projectId,
        actorId,
        actorType,
        customerVisible: row.visibility === "public",
        payload: {
          key: locked.key,
          url: `/agent/work-items/${encodeURIComponent(locked.key)}`,
          commentId: row.id,
          visibility: row.visibility,
        },
      });
      return {
        created: row,
        realtimeEvent,
        projectId: locked.projectId,
        key: locked.key,
      };
    },
  );

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
