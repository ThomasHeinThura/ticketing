import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const workItemSchema = z
  .object({
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
  })
  .openapi("WorkItem");

export const workItemListSchema = z.array(workItemSchema);

// #310: the list route additionally resolves state and assignee names server-side, so
// the client never has to make a second round trip (or ship raw ids) to render a row.
// Flat `stateName`/`stateCategory`/`assigneeName` fields alongside the existing
// `stateId`/`assigneeId`, the same "extend with a resolved display field, keep the raw
// id too" shape `task/response.ts`'s `taskWithAssigneeSchema` already uses for tasks.
//
// `stateCategory` is `state_template.group` (`data-model.md` §3: `backlog | unstarted
// | started | completed | cancelled`) -- "category" is issue #310's own word for this
// concept; `group` is the one name `data-model.md`/`rbac.md` actually define, so this
// field is that value under #310's requested name, not a second, competing vocabulary
// term.
//
// `assigneeName` resolves through `work_item.assignee_id -> person.id -> person.user_id
// -> user.name` (`person` itself carries no name column). It is `null` whenever
// `assigneeId` is `null` (unassigned), OR when the assignee is a placeholder person
// with no linked `user` row (`person.is_placeholder`, `person.user_id is null`) --
// there is no display name to resolve in that case; the row still reports its real
// `assigneeId` so the caller can tell "assigned, name unknown" apart from
// "unassigned".
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

// `GET /api/workspace/{workspaceId}/work-item-types` — the workspace's type catalogue,
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
