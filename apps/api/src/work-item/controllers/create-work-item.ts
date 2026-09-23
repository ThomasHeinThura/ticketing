import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  stateTable,
  workItemTable,
  workItemTypeTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { type ActivityActorType, recordWorkItemActivity } from "../activity";
import { claimWorkItemNumber } from "./claim-work-item-number";

type CreateWorkItemInput = {
  projectId: string;
  workspaceId: string;
  typeId: string;
  title: string;
  description?: unknown;
  priority?: "low" | "medium" | "high" | "urgent";
  /** The person making the request -- `c.get("userId")` at the route (WI-6, CA-9). */
  actorId: string;
  actorType: ActivityActorType;
};

/**
 * `WI-1`..`WI-4` (`docs/03-features/work-items.md`) -- the first write to `work_item`.
 * Every validation below is deliberately at the APPLICATION layer, ahead of the INSERT,
 * so a caller gets a clean 4xx rather than a raw Postgres constraint-violation error --
 * the DB-level composite FKs (#192) are the backstop, not the primary control a caller
 * ever sees.
 */
export async function createWorkItem(input: CreateWorkItemInput) {
  const {
    projectId,
    workspaceId,
    typeId,
    title,
    description,
    priority,
    actorId,
    actorType,
  } = input;

  // `workspaceId` here is the one the route's own middleware already resolved (the
  // project's true workspace, from a DB lookup) -- re-checking it against the freshly
  // loaded project row below closes the same TOCTOU-adjacent class of gap
  // `get-project.ts` closes for reads: the row loaded for the INSERT is scoped by BOTH
  // its id and the workspace the caller was actually authorized against.
  const project = await db.query.projectTable.findFirst({
    where: and(
      eq(projectTable.id, projectId),
      eq(projectTable.workspaceId, workspaceId),
      isNull(projectTable.deletedAt),
    ),
  });

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  // `WI-1`: the type must exist AND belong to the SAME workspace as the project --
  // exactly the boundary #192's composite FK (`work_item.workspace_id, type_id ->
  // work_item_type.workspace_id, id`) enforces at the DB level. Checked here first so a
  // cross-workspace pairing is a clean 400, not a raw FK-violation 500.
  const type = await db.query.workItemTypeTable.findFirst({
    where: eq(workItemTypeTable.id, typeId),
  });

  if (!type) {
    throw new HTTPException(400, { message: "Unknown work item type" });
  }

  if (type.workspaceId !== project.workspaceId) {
    throw new HTTPException(400, {
      message: "Work item type does not belong to the project's workspace",
    });
  }

  // `WI-4`: initial state is the project's own default state (`state.is_default`).
  //
  // NOT VALIDATED HERE, AND DELIBERATELY FLAGGED RATHER THAN GUESSED: WI-4 also requires
  // the default state be "a state the type's workflow can leave". No `workflow` or
  // `workflow_transition` table exists in this schema yet -- `work_item_type.workflow_id`
  // is a plain nullable column with NO foreign key ("P2/P5 scope and does not exist in
  // this schema yet", `schema.ts`'s own comment), and `workflows.md` (P2, a later stage)
  // defines no "leaveable" predicate this code could check against. There is nothing to
  // query. This is a TODO for the workflow-engine slice, not an omission in this one.
  const defaultState = await db.query.stateTable.findFirst({
    where: and(
      eq(stateTable.projectId, project.id),
      eq(stateTable.isDefault, true),
    ),
  });

  if (!defaultState) {
    throw new HTTPException(400, {
      message: "Project has no default state configured",
    });
  }

  // `WI-2`: the key is `{project.key}-{number}`, `number` from an atomic increment in the
  // SAME transaction as the insert -- see `claim-work-item-number.ts` for the full
  // concurrency analysis and the `project.key` naming judgment call (this codebase's
  // live column is `project.slug`, which already plays exactly that role --
  // `project/index.ts`: "The slug becomes the prefix of its task identifiers").
  let created: typeof workItemTable.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const number = await claimWorkItemNumber(project.id, tx);
      const key = `${project.slug}-${number}`;

      const [inserted] = await tx
        .insert(workItemTable)
        .values({
          projectId: project.id,
          workspaceId: project.workspaceId,
          typeId: type.id,
          number,
          key,
          title,
          description: description ?? null,
          stateId: defaultState.id,
          priority: priority ?? null,
        })
        .returning();

      if (!inserted) {
        throw new HTTPException(500, {
          message: "Failed to create work item",
        });
      }

      // WI-6/CA-6: one `created` row, in the SAME transaction as the insert -- if the
      // activity insert fails, the whole create rolls back (no work item without its
      // journal entry). Verb `created` has no `field` (`resolveVisibility`'s
      // `PUBLIC_PAIRS` has `(created, null)`), so this is `public` by CA-7's table --
      // its `payload` is therefore deliberately narrow (key/title only, per this
      // module's own "CALLER OBLIGATION" doc comment on `recordWorkItemActivity`):
      // never the assignee, requester, or anything else CA-7 marks `internal`.
      await recordWorkItemActivity(tx, [
        {
          workspaceId: inserted.workspaceId,
          workItemId: inserted.id,
          actorId,
          actorType,
          verb: "created",
          payload: { key: inserted.key, title: inserted.title },
        },
      ]);

      return inserted;
    });
  } catch (error) {
    // #23's mandatory Opus security review of PR #261, F1's delta-confirmation (D1,
    // 2026-09-22, "what would close it" #2): defence in depth. `project_slug_claim`
    // (see `create-project.ts`/`update-project.ts`) is meant to stop a poisoned key
    // range from ever being reachable, but this is the failure mode if it is ever wrong,
    // bypassed, or if a pre-existing poisoned range predates that fix (migration 0065's
    // own backfill cannot see a slug freed before it ran -- see that migration's
    // comment). `work_item_claim_key()`'s trigger (migration 0055) inserts into
    // `work_item_key_claim` BEFORE this INSERT and raises a genuine `unique_violation` on
    // its PRIMARY KEY when the SAME key string was already claimed by a DIFFERENT work
    // item -- previously an unhandled raw `{"message":"Internal Server Error"}` 500 with
    // nothing in the response to act on. Mapped here to a clean, understandable 409
    // instead (`app.onError`'s handling of a >=500 `HTTPException` is a pre-existing,
    // separately-scoped gap -- its own `if` block is empty -- so this alone does not add
    // logging; it only stops the response itself from being opaque).
    if (isUniqueViolation(error, "key")) {
      throw new HTTPException(409, {
        message:
          "This work item's key is already claimed by another work item; the project's key range may be poisoned by a retired slug -- contact an administrator",
      });
    }
    throw error;
  }

  // `docs/01-architecture/events.md` ~51: `work_item.created`'s declared payload,
  // beyond key + url, is `typeId`, `stateId`, `requesterId`, `source`. Emitted AFTER
  // the transaction above has committed -- matching every existing `publishEvent`
  // caller's own after-commit placement (`create-task.ts`, `create-comment.ts`) -- so a
  // subscriber (webhook delivery, an automation trigger) never observes an event for a
  // row it cannot yet read back. `source` is hardcoded `"agent"`: this route requires
  // `work_item:create` via workspace membership (`index.ts`'s own file comment), i.e.
  // the staff-facing create path, not a customer-portal intake flow, which does not
  // exist yet -- flagged as a judgment call in this PR's body, since `events.md`'s
  // `source` enum has no "this is the only creation surface today" case.
  // `visibility: "public"` is fixed, not derived per-request: `resolveVisibility`'s
  // `PUBLIC_PAIRS` has `(created, null)` unconditionally (`activity.ts`), so a
  // `work_item.created` event -- one per row, always verb `created`, no field -- is
  // always public, the same way its `activity` row always is.
  await publishEvent("work_item.created", {
    workItemId: created.id,
    key: created.key,
    workspaceId: created.workspaceId,
    projectId: created.projectId,
    typeId: created.typeId,
    stateId: created.stateId,
    requesterId: created.requesterId,
    source: "agent",
    visibility: "public",
    actorId,
    actorType,
  });

  return created;
}

export default createWorkItem;
