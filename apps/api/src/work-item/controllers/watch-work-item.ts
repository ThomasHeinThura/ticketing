import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  personTable,
  watcherTable,
  workItemTable,
} from "../../database/schema";
import { assertWorkItemStillLive } from "../assert-work-item-live";

// #23's fourth slice: `POST`/`DELETE /api/work-items/{key}/watch` (`work_item:read` --
// deliberate, `work-items.md` § Permissions: "WI-28 already lets anyone with read access
// watch; this is not an omission").
//
// `WI-28`: anyone with read access may watch. `WI-29`: assignee/requester are implicit
// watchers and "may opt out -- opting out sets `watcher.muted` ... rather than deleting
// the row, so an unmute later needs no new implicit watch to be recreated." So the two
// routes are NOT simple insert/delete:
//   - `POST watch` (this file's `watchWorkItem`): idempotent upsert. No existing row ->
//     insert `source: 'explicit', muted: false`. An existing row (either source) ->
//     unmute it (`muted: false`) without touching its `source` -- this is what lets an
//     implicit watcher who muted themselves start receiving notifications again without
//     a brand-new implicit row being recreated (`WI-29`'s own point).
//   - `DELETE watch` (`unwatchWorkItem`): an EXPLICIT watcher's row is deleted outright
//     (a deliberate, one-off subscription with nothing to preserve). An IMPLICIT
//     watcher's row is instead muted, never deleted -- `WI-29` verbatim. No row at all
//     is a no-op, 200, not a 404: unwatching something you were never watching is not an
//     error case worth surfacing to the caller.
//
// The caller's own `person` row is resolved from their `user_id` -- the same lookup
// `assign-work-item.ts`'s self-branch and `list-work-items.ts`'s `assignee=me` filter
// already use for "map the authenticated user to the person they act as". A caller with
// no `person` row at all cannot watch (there is nothing to record as `watcher.person_id`,
// which is `NOT NULL`) -- answered as 400, the same "not modelled yet" shape
// `list-work-items.ts`'s own comment accepts for the identical gap.

export type WorkItemWatchState = {
  workItemId: string;
  watching: boolean;
};

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Issue #493: this used to be a plain, unlocked `findFirst` checking only `deletedAt`, not
 * `archivedAt` -- and, being unlocked, it could not have closed the reach-check-to-write
 * race even if it checked both columns, since a concurrent soft-delete/archive commits
 * freely between this read and the caller's own write with nothing serialising the two.
 * Now takes `tx` and locks the row with `.for("share")` (read-only from this route's own
 * point of view -- nothing here writes to `work_item` itself), so the caller must run this
 * INSIDE the same transaction that goes on to write the `watcher` row, and a concurrent
 * soft-delete blocks on the lock until that transaction finishes.
 */
async function resolveCallerPersonAndItem(
  tx: DbOrTx,
  key: string,
  workspaceId: string,
  userId: string,
) {
  const [item] = await tx
    .select()
    .from(workItemTable)
    .where(eq(workItemTable.key, key))
    .for("share");
  if (!item || item.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Work item not found" });
  }
  assertWorkItemStillLive(item);

  const person = await tx.query.personTable.findFirst({
    where: eq(personTable.userId, userId),
  });
  if (!person) {
    throw new HTTPException(400, {
      message: "No person profile for this account -- cannot watch a work item",
    });
  }

  return { item, person };
}

export async function watchWorkItem(
  key: string,
  workspaceId: string,
  userId: string,
): Promise<WorkItemWatchState> {
  return db.transaction(async (tx) => {
    const { item, person } = await resolveCallerPersonAndItem(
      tx,
      key,
      workspaceId,
      userId,
    );

    await tx
      .insert(watcherTable)
      .values({
        workItemId: item.id,
        personId: person.id,
        source: "explicit",
        muted: false,
      })
      .onConflictDoUpdate({
        target: [watcherTable.workItemId, watcherTable.personId],
        // Unmute only -- `source` is deliberately untouched on conflict (`WI-29`).
        set: { muted: false },
      });

    return { workItemId: item.id, watching: true };
  });
}

export async function unwatchWorkItem(
  key: string,
  workspaceId: string,
  userId: string,
): Promise<WorkItemWatchState> {
  return db.transaction(async (tx) => {
    const { item, person } = await resolveCallerPersonAndItem(
      tx,
      key,
      workspaceId,
      userId,
    );

    const [existing] = await tx
      .select()
      .from(watcherTable)
      .where(
        and(
          eq(watcherTable.workItemId, item.id),
          eq(watcherTable.personId, person.id),
        ),
      )
      .limit(1);

    if (!existing) {
      // Never watching: idempotent no-op.
      return { workItemId: item.id, watching: false };
    }

    if (existing.source === "implicit") {
      // `WI-29`: opting out mutes, never deletes, so the implicit watch is not silently
      // recreated the next time this person is (re-)assigned/requests the item.
      await tx
        .update(watcherTable)
        .set({ muted: true })
        .where(eq(watcherTable.id, existing.id));
      return { workItemId: item.id, watching: false };
    }

    await tx.delete(watcherTable).where(eq(watcherTable.id, existing.id));
    return { workItemId: item.id, watching: false };
  });
}
