import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { boardColumnSchema, boardTaskSchema } from "../task/response";

export const projectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    slug: z.string().openapi({
      description: "Short prefix used in task identifiers, e.g. KAN-12.",
    }),
    icon: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    // The database stores text with authoritative CHECK constraints. Request DTOs
    // enforce the closed write vocabulary; keep response typing aligned with Drizzle.
    defaultCommentVisibility: z
      .string()
      .openapi({ enum: ["public", "internal"] }),
    kind: z.string().openapi({ enum: ["project", "managed_service"] }),
    health: z
      .string()
      .nullable()
      .openapi({ enum: ["red", "amber", "green"] }),
    supportLevel: z
      .string()
      .nullable()
      .openapi({ enum: ["L1", "L2", "L3"] }),
    serviceCalendarId: z.string().nullable(),
    slaPolicyId: z.string().nullable(),
    parentId: z.string().nullable().openapi({
      description:
        "PR-1: the parent project in the same workspace; null for a root project.",
    }),
    ownerTeamId: z.string().nullable().openapi({
      description:
        "TM-4: the team whose active members reach this project (reach only, never a capability); null when none.",
    }),
    managerId: z.string().nullable().openapi({
      description:
        "PR-6: the project manager (a person); null when none is set.",
    }),
    startDate: z.string().nullable().openapi({
      description: "PR-10: calendar date, YYYY-MM-DD.",
    }),
    endDate: z.string().nullable().openapi({
      description: "Optional calendar date, YYYY-MM-DD.",
    }),
    defaultAssigneeId: z.string().nullable().openapi({
      description:
        "AS-11: person assigned to work items created with none, when active and on the roster.",
    }),
    organisationId: z.string().nullable().openapi({
      description:
        "The customer organisation this project serves; null for an internal project.",
    }),
    createdBy: z.string().nullable().openapi({
      description:
        "The staff person who created the project; null for projects created before this was recorded.",
    }),
    createdAt: responseTimestamp,
    archivedAt: nullableResponseTimestamp.openapi({
      description:
        "Non-null once archived; archived projects are hidden by default.",
    }),
    deletedAt: nullableResponseTimestamp.openapi({
      description:
        "Non-null once soft-deleted; deleted projects are excluded everywhere in " +
        "ordinary use, independent of archivedAt.",
    }),
    purgeAfter: nullableResponseTimestamp.openapi({
      description:
        "Non-null once soft-deleted: the point after which the project becomes " +
        "eligible for purge. No purge job exists yet (#198).",
    }),
    position: z.number().openapi({ description: "Sidebar order, ascending." }),
    lastTaskNumber: z.number().openapi({
      description:
        "Highest task number issued in this project; the next task gets this plus one.",
    }),
  })
  .openapi("Project");

export const projectDetailSchema = projectSchema
  .extend({
    compositionWarnings: z.array(z.enum(["PR-6", "PR-7", "PR-10"])).openapi({
      description:
        "Warning-only composition rules the project currently violates (PR-6 no " +
        "manager, PR-7 no team member, PR-10 no start date). The save never fails " +
        "on these; the overview shows them as a banner.",
    }),
  })
  .openapi("ProjectDetail");

export const projectStatisticsSchema = z
  .object({
    completionPercentage: z.number(),
    totalTasks: z.number(),
    dueDate: nullableResponseTimestamp.openapi({
      description: "The soonest due date among the project's open tasks.",
    }),
  })
  .openapi("ProjectStatistics");

export const projectListItemSchema = projectSchema
  .extend({
    statistics: projectStatisticsSchema,
    /** PR-5: exact work-item statistics for the caller-visible project subtree. */
    descendantStatistics: projectStatisticsSchema.optional(),
    // Legacy, always empty. Fetch the board via GET /task/tasks/{id}.
    archivedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    plannedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    columns: z
      .array(boardColumnSchema)
      .openapi({ description: "Always empty." }),
  })
  .openapi("ProjectListItem");

export const projectListSchema = z.array(projectListItemSchema);

export const projectStateSchema = z
  .object({
    id: z.string(),
    stateTemplateId: z.string(),
    name: z.string(),
    group: z.enum([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]),
    position: z.number().int(),
    isDefault: z.boolean(),
  })
  .openapi("ProjectState");

export const projectStateTemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    group: z.enum([
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ]),
    inUse: z.boolean().openapi({
      description:
        "The project already has an active concrete state for this template.",
    }),
    hasOutboundTransition: z.boolean().openapi({
      description:
        "PR-17/WF-2: a workflow used by the workspace's work item types has a transition " +
        "out of this template. A state cannot be created for a template without one.",
    }),
  })
  .openapi("ProjectStateTemplate");

// Issue #25's bounded slice.
export const milestoneSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    date: responseTimestamp,
    reachedAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Milestone");

export const prerequisiteSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    title: z.string(),
    // Plain string, not `z.enum` -- the DB column is `text` with a CHECK constraint
    // (`prerequisite_owner_side_allowed`), not a narrower drizzle type; the request-side
    // schema (`createPrerequisiteBody`/`updatePrerequisiteBody`) is what actually enforces
    // `"us" | "customer" | "both"` at write time.
    ownerSide: z.string(),
    dueDate: nullableResponseTimestamp,
    isBlocking: z.boolean(),
    completedAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Prerequisite");

export const stakeholderSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    personId: z.string(),
    role: z.string(),
    escalationOrder: z.number(),
    escalationWaitMinutes: z.number(),
    active: z.boolean().openapi({
      description:
        "False once stood down (PR-12) -- never deleted, kept for history.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Stakeholder");

export const documentLinkSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    url: z.string(),
    title: z.string(),
    customerVisible: z.boolean(),
    createdAt: responseTimestamp,
  })
  .openapi("DocumentLink");

export const customerOrganisationListSchema = z
  .array(z.object({ id: z.string(), name: z.string() }))
  .openapi("ProjectCustomerOrganisationList");
