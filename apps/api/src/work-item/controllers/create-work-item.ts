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
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";
import { claimWorkItemNumber } from "./claim-work-item-number";

/**
 * `work_item.created`'s `source` (`events.md` ~51: `portal|agent|api|automation|import`),
 * derived from `resolveActor`'s `actorType`. This route only ever sees a cookie-session
 * `person` or an `api_key` (`resolveActor`'s own doc comment) -- `automation`/`system`
 * throw rather than silently falling back to `"agent"`, so a future caller that reuses
 * this function for an automation/import/portal-intake path is forced to update this
 * mapping instead of getting a wrong `source` with no signal (same discipline as #399's
 * `repo.mjs` fix: fail loudly on an unexpected case, don't silently default).
 */
function eventSourceFor(actorType: ActivityActorType): "agent" | "api" {
  switch (actorType) {
    case "person":
      return "agent";
    case "api_key":
      return "api";
    case "automation":
    case "system":
      throw new Error(
        'createWorkItem: no work_item.created "source" mapping for actorType ' +
          `"${actorType}" -- this route's resolveActor never produces it today; if a ` +
          "new caller changes that, add the correct events.md source value here.",
      );
  }
}

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

  // Resolved BEFORE any database write (Opus review, #412 F1): if `actorType` is ever
  // something `eventSourceFor` doesn't map, this throws here -- a clean failure before
  // the transaction below starts -- rather than after the work item and its `created`
  // activity row have already committed, which would 500 a client that just succeeded
  // and risk a duplicate on retry.
  const source = eventSourceFor(actorType);

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
  //
  // #347: both conditions are ONE query (`id` AND `workspaceId` together), not a
  // `findFirst` by `id` alone followed by a separate `workspaceId` comparison -- the
  // two-query shape answered a distinguishable message for "no such type" (400 "Unknown
  // work item type") versus "real type, foreign workspace" (400 "...does not belong to
  // the project's workspace"), which is a cross-tenant existence oracle for
  // `work_item_type` ids -- the same class #290/#307 closed in
  // `workspace-access-middleware.ts`, and the same single-query-plus-single-message
  // pattern already used by this codebase's other "row must belong to the same parent"
  // checks (`upsert-workflow-rule.ts`'s `columnId`, `reorder-columns.ts`'s `col.id`,
  // confirmed side by side in #307's own Opus review table). A nonexistent id and a
  // real-but-foreign-workspace id now answer byte-identically.
  const type = await db.query.workItemTypeTable.findFirst({
    where: and(
      eq(workItemTypeTable.id, typeId),
      eq(workItemTypeTable.workspaceId, project.workspaceId),
    ),
  });

  if (!type) {
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
  let realtimeEvent:
    | Awaited<ReturnType<typeof recordWorkItemEvent>>
    | undefined;
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

      realtimeEvent = await recordWorkItemEvent(tx, {
        kind: "work_item.created",
        workItemId: inserted.id,
        key: inserted.key,
        workspaceId: inserted.workspaceId,
        projectId: inserted.projectId,
        actorId,
        actorType,
        customerVisible: true,
        payload: {
          key: inserted.key,
          url: `/agent/work-items/${encodeURIComponent(inserted.key)}`,
          typeId: inserted.typeId,
          stateId: inserted.stateId,
          requesterId: inserted.requesterId,
          source,
        },
      });

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
    // logging; it only stops the response itself from being opaque). Matched by the
    // EXACT constraint name Postgres actually raises on `work_item_key_claim`'s
    // unnamed PRIMARY KEY on `key` -- `work_item_key_claim_pkey` (Postgres's default
    // naming convention, confirmed live against migration 0055's schema; the trigger's
    // own `ON CONFLICT ("key", work_item_id) DO NOTHING` already absorbs the table's
    // OTHER unique constraint, `work_item_key_claim_key_work_item_id_unique`, so that
    // one is never reachable here) -- not a substring match on `"key"` (issue #269):
    // a substring would also match any future unrelated `*_key_something` constraint
    // added near this insert.
    if (isUniqueViolation(error, "work_item_key_claim_pkey")) {
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
  // row it cannot yet read back.
  //
  // S2 (issue #298, PR #292's Opus review): `source` is derived from the same
  // `actorType` `resolveActor` (`work-item/index.ts`) already computed for this
  // request, not hardcoded -- an API-key-authenticated create is `"api"`, per
  // `events.md`'s enum (`portal | agent | api | automation | import`); every other
  // actor this route ever sees is a cookie-session person (`resolveActor`'s own doc
  // comment: this route only ever sees a person or an API key, never
  // `automation`/`system`), which stays `"agent"` -- this route requires
  // `work_item:create` via workspace membership (`index.ts`'s own file comment), i.e.
  // the staff-facing create path, not a customer-portal intake flow, which does not
  // exist yet.
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
    source,
    visibility: "public",
    actorId,
    actorType,
  });
  if (realtimeEvent) {
    await publishWorkItemHint(realtimeEvent, {
      kind: "work_item.created",
      key: created.key,
      projectId: created.projectId,
      customerVisible: true,
    });
  }

  return created;
}

export default createWorkItem;
