import { validateReparent } from "@taskdesk/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, workItemTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { isRaiseException } from "../../utils/is-raise-exception";
import {
  type ActivityActorType,
  recordWorkItemActivity,
  resolveVisibility,
} from "../activity";
import { ancestorChain, descendantDepth } from "../hierarchy";

/**
 * `POST /api/work-items/{key}/parent` (`work_item:update`, required on both ends --
 * `relations-and-hierarchy.md` § Permissions). `require-work-item-reach.ts` has already
 * resolved `key` to a row and confirmed workspace reach on it, the same middleware
 * `update-work-item.ts` relies on; "both ends" cashes out here as ONE capability check
 * (this permission model is role-based per workspace, not a per-row ACL, and `RH-6`
 * guarantees the parent is in the SAME project -- and therefore the same workspace -- as
 * the item, so a second, separately-scoped capability check on the parent's own row would
 * assert nothing a caller who already holds `work_item:update` in this workspace doesn't
 * already have). Judgment call, matching the existing `task-relation/policy.ts`
 * precedent for "both ends" under this same single-workspace capability model.
 *
 * TWO INDEPENDENT LAYERS close `RH-7`/`RH-8`, deliberately kept as two:
 *
 * 1. APPLICATION layer (this file): `ancestorChain`/`descendantDepth` (`../hierarchy.ts`)
 *    read the two facts a graph check needs, and `@taskdesk/domain`'s `validateReparent`
 *    (a pure function, exhaustively unit-tested there) decides -- giving the caller a
 *    clean, specific 422 (`self` / `cycle` / `max_depth`) *before* any write is attempted.
 *    This is a plain, unlocked read: it can theoretically be stale by the time the
 *    `UPDATE` below runs, if another transaction reparents one of the same rows
 *    concurrently.
 * 2. DATABASE layer (migration 0056's `work_item_reject_parent_cycle` trigger, unchanged
 *    by this PR): the actual race-free authority, which takes real row locks
 *    (`FOR NO KEY UPDATE`) during its own walk. It does not enforce `RH-7`'s depth cap at
 *    all (its own migration comment says so explicitly) -- which is exactly why layer 1
 *    exists, not merely as a nicer error message for what the trigger already catches.
 *
 * The `isRaiseException` catch below is defense-in-depth for the narrow race where layer
 * 1 approved a reparent that a concurrent transaction invalidates before this route's own
 * `UPDATE` commits -- translated to a clean 409 rather than a raw Postgres error. Expected
 * to be effectively unreachable in ordinary operation, not a normal-path response (the
 * same framing `work-item/index.ts`'s own 409 doc comment uses for #261's key-collision
 * defense-in-depth).
 */
export async function setWorkItemParent(
  key: string,
  workspaceId: string,
  parentKey: string,
  actorId: string,
  actorType: ActivityActorType,
) {
  // #202 / PR #204's freeze invariant, same shape as `update-work-item.ts`.
  const projectNotDeleted = sql`EXISTS (SELECT 1 FROM ${projectTable} WHERE ${projectTable.id} = ${workItemTable.projectId} AND ${projectTable.deletedAt} IS NULL)`;

  const { updated, oldParentId } = await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
        ),
      )
      .for("update");

    if (!item) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    const [projectAlive] = await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, item.projectId),
          isNull(projectTable.deletedAt),
        ),
      );

    if (!projectAlive) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    const [parent] = await tx
      .select()
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, parentKey),
          eq(workItemTable.workspaceId, workspaceId),
        ),
      );

    if (!parent) {
      throw new HTTPException(404, { message: "Parent work item not found" });
    }

    // RH-6: parent and child must be in the same project. The composite self-FK on
    // `work_item.parent_id` (`schema.ts`) enforces this at the database layer too, but a
    // caller crossing it here would otherwise hit a raw FK-violation 500 instead of a
    // clean 400 -- same "application layer ahead of the write" discipline
    // `create-work-item.ts` documents for its own cross-workspace type check.
    if (parent.projectId !== item.projectId) {
      throw new HTTPException(400, {
        message: "Parent must be in the same project as the work item (RH-6)",
      });
    }

    const chain = await ancestorChain(tx, parent.id);
    const depth = await descendantDepth(tx, item.id);
    const result = validateReparent(item.id, parent.id, chain, depth);

    if (!result.ok) {
      const messages: Record<typeof result.reason, string> = {
        self: "A work item cannot be its own parent (RH-8)",
        cycle:
          "The proposed parent is a descendant of this work item -- rejected as a cycle (RH-8)",
        max_depth:
          "Setting this parent would exceed the maximum hierarchy depth of 5 (RH-7)",
      };
      throw new HTTPException(422, { message: messages[result.reason] });
    }

    let updatedRow: typeof workItemTable.$inferSelect | undefined;
    try {
      [updatedRow] = await tx
        .update(workItemTable)
        .set({
          parentId: parent.id,
          version: sql`${workItemTable.version} + 1`,
        })
        .where(
          and(
            eq(workItemTable.id, item.id),
            eq(workItemTable.version, item.version),
            projectNotDeleted,
          ),
        )
        .returning();
    } catch (error) {
      if (isRaiseException(error)) {
        throw new HTTPException(409, {
          message:
            "Could not set parent -- a concurrent change affected this hierarchy; reload and retry",
        });
      }
      throw error;
    }

    if (!updatedRow) {
      // The row existed and was locked moments ago; the only remaining reason the WHERE
      // can fail to match is a concurrent version bump or a soft-deleted project, in the
      // window between the lock above and this UPDATE -- same reasoning as
      // `update-work-item.ts`'s own identical branch.
      throw new HTTPException(404, { message: "Work item not found" });
    }

    // CA-7's table: "parent" is explicitly `internal` (activity.ts's transcription of
    // relations-and-hierarchy.md's own visibility rule for parent changes).
    await recordWorkItemActivity(tx, [
      {
        workspaceId: updatedRow.workspaceId,
        workItemId: updatedRow.id,
        actorId,
        actorType,
        verb: "updated",
        field: "parent",
        oldValue: item.parentId,
        newValue: updatedRow.parentId,
        visibility: "internal",
      },
    ]);

    return { updated: updatedRow, oldParentId: item.parentId };
  });

  await publishEvent("work_item.updated", {
    workItemId: updated.id,
    key: updated.key,
    workspaceId: updated.workspaceId,
    projectId: updated.projectId,
    changes: [
      {
        field: "parent",
        from: oldParentId,
        to: updated.parentId,
        visibility: resolveVisibility({
          workspaceId: updated.workspaceId,
          workItemId: updated.id,
          actorId,
          actorType,
          verb: "updated",
          field: "parent",
        }),
      },
    ],
    actorId,
    actorType,
  });

  return updated;
}

export default setWorkItemParent;
