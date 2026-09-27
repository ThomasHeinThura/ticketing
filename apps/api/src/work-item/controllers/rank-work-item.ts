import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workItemTable } from "../../database/schema";

// #23's fourth slice: `POST /api/work-items/{key}/rank` (`work_item:rank`, plus reach).
//
// `WI-11`: fractional positions, so inserting between two neighbours moves ONE row, not
// the whole list -- unlike `project`/`column`'s own integer-position reordering
// (`reorder-projects.ts`), which renumbers every row in the collection and is the wrong
// precedent for a domain this spec deliberately gave `numeric(20,10)` to avoid exactly
// that cost. `WI-12`'s rebalance-when-the-gap-shrinks job (`position-rebalance`,
// background-jobs.md) is NOT built here -- a separate background job, explicitly out of
// this route's scope, the same way `delete-work-item.ts` leaves the 30-day purge job to
// its own slice.
//
// BODY SHAPE is a judgment call (flagged in the PR body): `schema.ts` names no existing
// contract for this route, so this follows the standard drag-and-drop shape (Trello,
// Linear): `beforeId`/`afterId` name the two items that should end up immediately
// surrounding this one's NEW slot, within the SAME project+state partition this item
// already belongs to (the index this table already carries,
// `work_item_projectId_stateId_position_idx`, IS that partition) -- moving to a
// DIFFERENT state is `POST /transition` (`WI-9`), not this route. At least one of
// `beforeId`/`afterId` is required; passing neither is a 400 (there is nothing to rank
// relative to).
//
// `WI-13` (customers may re-rank only their own organisation's backlog) is NOT enforced
// here: nothing in this codebase yet resolves a live customer-portal caller identity
// (`work-item/index.ts`'s own file comment notes the same gap for every other route --
// no route anywhere assembles `packages/permissions`'s customer/organisation reach at
// runtime yet). This route gates on `work_item:rank` via `requireWorkspaceCapability`,
// same as every other route in this file, and is reachable by any workspace member
// holding that capability -- flagged in the PR body as a narrower slice than `WI-13`'s
// full wording, not a silent guess.
//
// `WI-7`'s one named exception: rank is exempt from `If-Match` and is last-write-wins --
// no version compare in the `WHERE` below. `version` is still bumped (matching
// `assign-work-item.ts`'s own choice to always bump it even though ITS write is also
// exempt from `If-Match`), so a stale `PATCH`'s own `If-Match` correctly detects that
// the row changed underneath it.
//
// No `activity` row and no domain event are written for a rank change: `CA-7`'s table
// (`activity.ts`'s own transcription) does not name `position`/rank among its public or
// internal fields, and `events.md`'s `work_item.*` catalogue declares no rank-specific
// key -- inventing either here would be a new vocabulary item this PR was not asked to
// add.

export type RankWorkItemInput = {
  beforeId?: string | null;
  afterId?: string | null;
};

export type RankedWorkItem = {
  key: string;
  position: string;
  version: number;
};

export async function rankWorkItem(
  key: string,
  workspaceId: string,
  input: RankWorkItemInput,
): Promise<RankedWorkItem> {
  if (!input.beforeId && !input.afterId) {
    throw new HTTPException(400, {
      message: "At least one of beforeId or afterId is required",
    });
  }

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
        ),
      )
      .for("update");

    if (!target || target.archivedAt || target.deletedAt) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    // Neighbours must belong to the SAME rank partition (`project_id`, `state_id`) as
    // the item being moved -- an id from another project/state/workspace is rejected as
    // a plain 400 rather than silently accepted and ranked against the wrong list.
    const neighbourIds = [input.beforeId, input.afterId].filter(
      (id): id is string => typeof id === "string",
    );
    const neighbours =
      neighbourIds.length > 0
        ? await tx
            .select({
              id: workItemTable.id,
              position: workItemTable.position,
            })
            .from(workItemTable)
            .where(
              and(
                eq(workItemTable.projectId, target.projectId),
                eq(workItemTable.stateId, target.stateId),
                isNull(workItemTable.deletedAt),
              ),
            )
        : [];
    const byId = new Map(neighbours.map((row) => [row.id, row.position]));

    for (const id of neighbourIds) {
      if (!byId.has(id)) {
        throw new HTTPException(400, {
          message: `${id} is not in the same project/state as ${key} -- it cannot be used to rank against`,
        });
      }
    }

    const beforePosition = input.beforeId
      ? Number(byId.get(input.beforeId))
      : null;
    const afterPosition = input.afterId
      ? Number(byId.get(input.afterId))
      : null;

    let newPosition: number;
    if (beforePosition !== null && afterPosition !== null) {
      newPosition = (beforePosition + afterPosition) / 2;
    } else if (beforePosition !== null) {
      // Placed at the very end: past the last-known neighbour.
      newPosition = beforePosition + 1;
    } else {
      // afterPosition !== null: placed at the very start: before the first-known
      // neighbour.
      newPosition = (afterPosition as number) - 1;
    }

    if (!Number.isFinite(newPosition)) {
      throw new HTTPException(400, {
        message: "Computed an invalid position -- check beforeId/afterId",
      });
    }

    const [updated] = await tx
      .update(workItemTable)
      .set({
        position: sql`${newPosition}`,
        version: sql`${workItemTable.version} + 1`,
      })
      .where(eq(workItemTable.id, target.id))
      .returning({
        key: workItemTable.key,
        position: workItemTable.position,
        version: workItemTable.version,
      });

    if (!updated) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    return updated;
  });
}

export default rankWorkItem;
