import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

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
  description: z.unknown().nullable(),
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
