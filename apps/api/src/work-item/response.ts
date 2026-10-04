import {
  jsonValueSchema,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../openapi";

// Plain (unregistered) shape shared by `workItemSchema` and `workItemDetailSchema`, so the
// detail schema extends this shape rather than the already-`.openapi()`-registered
// `workItemSchema`. Extending a registered schema makes zod-to-openapi emit an `allOf`
// ref, which `oasdiff breaking` diffs part-by-part -- it then reports every base `WorkItem`
// field as "removed" even though the change is purely additive (PR #326 review finding).
// Flattening into one object schema keeps the diff additive-only.
const workItemShape = z.object({
  id: z.string(),
  projectId: z.string(),
  workspaceId: z.string(),
  typeId: z.string(),
  number: z.number().openapi({
    description:
      "Per-project sequence number. The key is `{project.slug}-{number}`.",
  }),
  key: z.string().openapi({ description: "e.g. PROJ-123. Permanent." }),
  title: z.string(),
  description: jsonValueSchema.nullable().optional(),
  stateId: z.string(),
  priority: z
    .string()
    .nullable()
    .openapi({ description: "One of: low, medium, high, urgent." }),
  assigneeId: z.string().nullable(),
  requesterId: z.string().nullable(),
  parentId: z.string().nullable(),
  position: z
    .string()
    .openapi({ description: "numeric(20,10) fractional rank, as a string." }),
  customerVisibility: z
    .string()
    .openapi({ description: "One of: private, organisation." }),
  startDate: nullableResponseTimestamp,
  dueDate: nullableResponseTimestamp,
  archivedAt: nullableResponseTimestamp,
  deletedAt: nullableResponseTimestamp,
  version: z.number(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

export const workItemSchema = workItemShape.openapi("WorkItem");

// The detail route (`GET /api/work-items/{key}`) resolves display fields for its single
// item (`controllers/get-work-item.ts`'s own comment has the why and the PR #320 parity
// note): `stateName`, `stateCategory` and `assigneeName`, so the detail page renders a
// human-readable state and assignee instead of raw ids. Extends the unregistered
// `workItemShape`, not the registered `workItemSchema` -- see that const's own comment
// for why (the `allOf`/`oasdiff` finding this schema exists to avoid).
//
// NOT shared with `workItemListItemSchema` below despite having identical fields: that
// schema is already on `main` (#320) as an `allOf` extension of `workItemSchema`, with
// its own already-approved contract-drift allowlist entry for exactly that shape.
// Flattening it here to share this definition would change ITS emitted schema from
// `allOf` to a flat object relative to `main`, which `oasdiff` reports as a NEW breaking
// change (`response-property-all-of-removed`) -- confirmed by running `test:contract`
// with the shared version. So the two schemas stay separately defined, each matching
// what its own route already emits, per this task's "keep both, no behaviour change to
// either route" instruction.
export const workItemDetailSchema = workItemShape
  .extend({
    stateName: z.string(),
    stateCategory: z.string().openapi({
      description:
        "state_template.group: one of backlog, unstarted, started, completed, cancelled.",
    }),
    assigneeName: z.string().nullable(),
  })
  .openapi("WorkItemDetail");

// #310: the list route additionally resolves state and assignee names server-side, so
// the client never has to make a second round trip (or ship raw ids) to render a row.
// Flat `stateName`/`stateCategory`/`assigneeName` fields alongside the existing
// `stateId`/`assigneeId`, the same "extend with a resolved display field, keep the raw
// id too" shape `task/response.ts`'s `taskWithAssigneeSchema` already uses for tasks.
//
// `stateCategory` is `state_template.group` (`data-model.md` §3: `backlog | unstarted |
// started | completed | cancelled`) -- "category" is issue #310's own word for this
// concept; `group` is the one name `data-model.md`/`rbac.md` actually define, so this
// field is that value under #310's requested name, not a second, competing vocabulary
// term.
//
// `assigneeName` resolves through `work_item.assignee_id -> person.id -> person.user_id
// -> user.name` (`person` itself carries no name column). It is `null` whenever
// `assigneeId` is `null` (unassigned), OR when the assignee is a placeholder person with
// no linked `user` row (`person.is_placeholder`, `person.user_id is null`) -- there is no
// display name to resolve in that case; the row still reports its real `assigneeId` so
// the caller can tell "assigned, name unknown" apart from "unassigned".
//
// Extends `workItemSchema` (the REGISTERED schema), unlike `workItemDetailSchema` above
// -- unchanged from `main` (#320) on purpose: `main` already emits this schema as an
// `allOf` with an existing, already-approved allowlist entry for it. Flattening this one
// too would change its OpenAPI shape relative to `main` and trip a NEW breaking-change
// finding, even though nothing about its runtime behaviour would change.
export const workItemListItemSchema = workItemSchema
  .extend({
    stateName: z.string(),
    stateCategory: z.string().openapi({
      description:
        "state_template.group: one of backlog, unstarted, started, completed, cancelled.",
    }),
    assigneeName: z.string().nullable(),
  })
  .openapi("WorkItemListItem");

export const workItemPageSchema = z
  .object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .openapi("WorkItemPage");

// `api-design.md`'s collection envelope (`{ data, page, meta }`). `meta.total` is an
// exact count in this implementation (one extra `count(*)` query over the same
// filters, not a per-row cost) -- `api-design.md` allows it to be documented as an
// estimate for a large set, but nothing here requires degrading it to one, and an
// exact count is strictly more useful while the row counts this route serves stay in
// a normal service-desk range.
export const workItemListResponseSchema = z
  .object({
    data: z.array(workItemListItemSchema),
    page: workItemPageSchema,
    meta: z.object({ total: z.number() }),
  })
  .openapi("WorkItemListResponse");

// `GET /api/workspace/{workspaceId}/work-item-types` -- the workspace's type catalogue,
// as the create dialog's Type picker reads it (`WI-1`: one required type on create, no
// default to fall back to). Narrower than the row on purpose: see the controller's own
// comment for what is excluded and why.
export const workItemTypeSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    icon: z.string().nullable(),
    category: z.string().openapi({
      description: "One of: service, delivery (work-items.md § Default types).",
    }),
    isEpic: z.boolean(),
    isChange: z.boolean(),
  })
  .openapi("WorkItemType");

export const workItemTypeListSchema = z.array(workItemTypeSchema);

// `WI-7`: a version mismatch on `PATCH /api/work-items/{key}` returns 409 with BOTH
// versions ("the caller's asserted version and the current server version") so the UI can
// offer a resolution -- structured JSON, not the plain-text `errorResponse()` shape every
// other error in this codebase uses, because there is genuinely structured data here for
// the client to act on, not just a message to display.
export const workItemVersionConflictSchema = z
  .object({
    message: z.string(),
    assertedVersion: z
      .number()
      .openapi({ description: "The version sent in If-Match." }),
    currentVersion: z
      .number()
      .openapi({ description: "The work item's actual current version." }),
  })
  .openapi("WorkItemVersionConflict");

// `assignment.md` § API: `GET /api/projects/{id}/assignable` — the person-picker feed.
// `roleName` is the person's most privileged role on THIS project; `openWorkCount` is
// their load across projects (`state_template.group` not completed/cancelled). `name` is
// nullable: a placeholder person (import-created, no user row) has none yet.
export const assignablePersonSchema = z
  .object({
    personId: z.string(),
    name: z.string().nullable(),
    roleName: z.string(),
    openWorkCount: z.number(),
  })
  .openapi("AssignablePerson");

export const assignablePeopleSchema = z.array(assignablePersonSchema);

// `assignment.md`: the assignment as applied. Narrow on purpose -- the caller needs to know
// who holds the item now, who held it before (so an undo/notification can name them) and the
// new version (an `If-Match` read either side of an assignment must not be stale).
export const assignWorkItemResponseSchema = z
  .object({
    key: z.string(),
    assigneeId: z.string(),
    previousAssigneeId: z.string().nullable(),
    version: z.number(),
  })
  .openapi("WorkItemAssignment");

// `GET /api/work-items/{key}/tree` (`relations-and-hierarchy.md` § API/Screens): "The
// tree of parent and children renders inline, with the current item highlighted" --
// `isCurrent` is that highlight. Recursive (`children: WorkItemTreeNode[]`), so the type
// and schema are both declared as their own self-referencing values, the standard
// zod-to-openapi shape for a recursive schema (the inner `z.lazy` callback is evaluated
// once and cached, so the `.openapi("WorkItemTreeNode")` call below only ever registers
// the component once).
export type WorkItemTreeNodeResponse = {
  id: string;
  key: string;
  title: string;
  stateName: string;
  stateCategory: string;
  isCurrent: boolean;
  hasChildren: boolean;
  children: WorkItemTreeNodeResponse[];
};

export const workItemTreeNodeSchema: z.ZodType<WorkItemTreeNodeResponse> =
  z.lazy(() =>
    z
      .object({
        id: z.string(),
        key: z.string(),
        title: z.string(),
        stateName: z.string(),
        stateCategory: z.string().openapi({
          description:
            "state_template.group: one of backlog, unstarted, started, completed, cancelled.",
        }),
        isCurrent: z.boolean().openapi({
          description: "True for the requested {key} node.",
        }),
        hasChildren: z.boolean().openapi({
          description:
            "True when this node has children; request its key to load them.",
        }),
        children: z.array(workItemTreeNodeSchema),
      })
      .openapi("WorkItemTreeNode"),
  );

// Each response is one parent's bounded direct-child page. `hasMore` and
// `nextCursor` apply to that parent's children; nested nodes are loaded by key.
export const workItemTreeResponseSchema = z
  .object({
    root: workItemTreeNodeSchema,
    truncated: z.boolean().openapi({
      description:
        "True when this response omits any part of the requested item's full tree.",
    }),
    page: workItemPageSchema,
  })
  .openapi("WorkItemTree");

// The spec's conditional-write conflict: zero rows updated because someone else changed the
// assignee first. Structured like `workItemVersionConflictSchema` -- there is real data for
// the client to act on (AS-3's confirmation flow shows who actually holds it now).
export const workItemAssigneeConflictSchema = z
  .object({
    message: z.string(),
    key: z.string(),
    currentAssigneeId: z.string().nullable().openapi({
      description:
        "Who actually holds the item now; null when it is unassigned.",
    }),
  })
  .openapi("WorkItemAssigneeConflict");

// `DELETE /api/work-items/{key}` -- see `controllers/delete-work-item.ts`'s own doc
// comment for the deliberate `pending-actions.md` deviation this response shape reflects
// (a plain, immediate soft-delete, not a `202` pending action).
export const deletedWorkItemSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    workspaceId: z.string(),
    projectId: z.string(),
    deletedAt: responseTimestamp,
  })
  .openapi("DeletedWorkItem");

// `POST /api/work-items/{key}/rank` (`WI-11`) -- narrow on purpose, the same "just
// enough for the client to know what happened" shape `assignWorkItemResponseSchema`
// uses: the caller already has the rest of the row from its own last read.
export const rankWorkItemResponseSchema = z
  .object({
    key: z.string(),
    position: z
      .string()
      .openapi({ description: "numeric(20,10) fractional rank, as a string." }),
    version: z.number(),
  })
  .openapi("RankedWorkItem");

// `POST`/`DELETE /api/work-items/{key}/watch` (`WI-28`/`WI-29`).
export const workItemWatchStateSchema = z
  .object({
    workItemId: z.string(),
    watching: z.boolean(),
  })
  .openapi("WorkItemWatchState");

// `POST /api/work-items/bulk` (`WI-25`: per-item results, never an all-or-nothing
// rollback).
export const bulkWorkItemsResponseSchema = z
  .object({
    succeeded: z.array(z.string()),
    failed: z.array(
      z.object({
        id: z.string(),
        reason: z.string(),
      }),
    ),
  })
  .openapi("BulkWorkItemsResult");

// `GET /api/work-items/{key}/activity` -- the read side of the already-merged
// `activity.ts` write path (`recordWorkItemActivity`). `seq` is deliberately absent,
// same reason that module's own `.returning()` column list omits it.
//
// ISSUE #452 v2 (post-CI oasdiff finding): this schema originally grew a SECOND,
// `.discriminatedUnion`-based shape here to carry posted `comment` rows alongside
// activity rows (`comments-and-activity.md`'s "one stream showing everything"). That
// version worked and passed all three rounds of Opus security review, but CI's
// `contract - OpenAPI drift` job caught something the security review never checked:
// `oasdiff breaking` flags `response-property-one-of-added` -- widening a response
// `oneOf` is treated as breaking (a strict client generated against the OLD spec, coded
// against exactly one shape, could choke on an unrecognized new variant), and
// `docs/01-architecture/api-design.md`'s Versioning section makes the reviewed-allowlist
// mechanism that used to cover exactly this case PERMANENTLY closed once a stable
// `v2.0.0`+ tag exists on origin (it does: `v2.0.1`) -- the same constraint PR #440 hit on
// the invitation route (decision log, 2026-09-28).
//
// Rather than treat this as a real breaking change needing a new path segment (there is
// no removal or narrowing here to justify one, unlike #440's case), this schema was
// redesigned to avoid the `oneOf` construct entirely: every field below is EXACTLY the
// pre-#452 `WorkItemActivityRow` shape, byte-for-byte unchanged and still fully required
// -- an activity-kind row's wire shape is untouched. `kind`/`body`/`activityId`/
// `editedAt`/`deletedAt`/`updatedAt` are NEW, OPTIONAL fields added to that SAME existing
// object schema, exactly the class of change `api-design.md`'s Versioning section already
// names as free ("Additive changes (new optional field, new endpoint, new event key) go
// out freely") -- verified empirically, not just argued: `oasdiff breaking` against this
// exact shape reports zero findings (spiked and confirmed locally before committing this
// version). `kind` is populated on EVERY row at runtime ("activity" or "comment", never
// omitted) even though the schema only requires it be present when the row is one the old
// contract never had (a comment) -- declaring it optional is what keeps the CONTRACT
// backward-compatible; actually always sending it is what keeps a NEW caller's code simple
// (no "absent means activity" inference needed). A comment-kind row's `verb` is the
// literal string `"commented"` -- a real, honest description of what happened, matching
// this table's own existing verb vocabulary (`created`, `transitioned`, `updated`, ...),
// not a fabricated placeholder -- with `field`/`oldValue`/`newValue`/`payload` all `null`
// (comments do not carry a field-level diff) and `workflowVersionId` null (not applicable).
export const workItemActivityRowSchema = z
  .object({
    id: z.string(),
    workItemId: z.string(),
    actorId: z.string().nullable(),
    actorType: z.string(),
    verb: z.string(),
    field: z.string().nullable(),
    oldValue: jsonValueSchema.nullable().optional(),
    newValue: jsonValueSchema.nullable().optional(),
    payload: jsonValueSchema.nullable().optional(),
    visibility: z.string(),
    workflowVersionId: z.string().nullable(),
    createdAt: responseTimestamp,
    kind: z
      .enum(["activity", "comment"])
      .optional()
      .openapi({
        description:
          'Always present at runtime -- "activity" for an activity-table row, ' +
          '"comment" for a posted comment. Optional in the schema (not the pre-#452 ' +
          "contract) so this remains an additive change, not a breaking one.",
      }),
    body: jsonValueSchema.nullable().optional().openapi({
      description:
        "Comment rows only: the Tiptap document, or null if deleted (CA-18).",
    }),
    activityId: z.string().nullable().optional().openapi({
      description:
        "Comment rows only: see comment.activity_id in the data model.",
    }),
    editedAt: nullableResponseTimestamp.optional().openapi({
      description: "Comment rows only (CA-17).",
    }),
    deletedAt: nullableResponseTimestamp.optional().openapi({
      description: "Comment rows only (CA-18 tombstone).",
    }),
    updatedAt: responseTimestamp.optional().openapi({
      description: "Comment rows only.",
    }),
  })
  .openapi("WorkItemActivityRow");

export const workItemActivityListResponseSchema = z
  .object({
    data: z.array(workItemActivityRowSchema),
    page: workItemPageSchema,
  })
  .openapi("WorkItemActivityListResponse");

// `assignment.md` § API: `DELETE /api/work-items/{key}/assign`. The assignment as
// cleared. `assigneeId` is null BY TYPE -- a client cannot mistake "cleared" for "field
// missing" -- and `previousAssigneeId` still names who to notify (`AS-17`) or to show in
// an activity feed.
export const unassignWorkItemResponseSchema = z
  .object({
    key: z.string(),
    assigneeId: z.null(),
    previousAssigneeId: z.string().nullable(),
    version: z.number(),
  })
  .openapi("WorkItemUnassignment");

// Issue #442. One stable reason a blocked transition is not currently available
// (`WF-16`): `kind` names which gate ("guard" | "approval" | "cab" | "note"), `reasonCode`
// is the stable code (`guard.<type>`, `approval.pending`, `cab.pending`, `note.required`)
// -- never free text, so a client can render an explanation without parsing prose.
export const workItemBlockReasonSchema = z
  .object({
    kind: z.string(),
    reasonCode: z.string(),
  })
  .openapi("WorkItemTransitionBlockReason");

// `GET /api/work-items/{key}/transitions` (`workflows.md` § "The state select"): exactly
// what the actor may do now, with reasons for anything blocked. An illegal transition
// (wrong role/state, CAB-gated on a non-change type, or no concrete state in this
// project) is simply absent from this array -- never returned with `available: false`.
export const workItemTransitionOfferSchema = z
  .object({
    transitionId: z.string(),
    toStateTemplateId: z.string(),
    toStateName: z.string(),
    toStateId: z.string(),
    notePolicy: z.enum(["none", "optional", "required"]),
    noteVisibility: z.enum(["public", "internal"]),
    requiresApproval: z.boolean(),
    requiresCab: z.boolean(),
    isReopen: z.boolean(),
    available: z.boolean(),
    blockedBy: z.array(workItemBlockReasonSchema),
  })
  .openapi("WorkItemTransitionOffer");

export const workItemTransitionsResponseSchema = z.array(
  workItemTransitionOfferSchema,
);

// `POST /api/work-items/{key}/transition`. The work item's own new state, exactly the
// facts this route's own effects can change -- `assigneeId`/`resolvedAt` only move when
// the executed transition actually carries a `set_assignee`/`clear_assignee` effect or
// crosses the `completed` group boundary (`WF-17`/`WF-18`).
export const transitionedWorkItemSchema = z
  .object({
    key: z.string(),
    stateId: z.string(),
    assigneeId: z.string().nullable(),
    resolvedAt: nullableResponseTimestamp,
    version: z.number(),
  })
  .openapi("TransitionedWorkItem");

// The 422 "not currently available" response: the matched transition is legal, but
// blocked by a guard, the (interim, always-unsatisfied) approval/CAB gate, or a missing
// required note.
export const workItemTransitionBlockedSchema = z
  .object({
    message: z.string(),
    blockedBy: z.array(workItemBlockReasonSchema),
  })
  .openapi("WorkItemTransitionBlocked");
