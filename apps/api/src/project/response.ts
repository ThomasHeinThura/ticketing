import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { boardColumnSchema, boardTaskSchema } from "../task/response";

export const projectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    organisationId: z.string().nullable(),
    slug: z.string().openapi({
      description: "Short prefix used in task identifiers, e.g. KAN-12.",
    }),
    icon: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    defaultCommentVisibility: z.enum(["public", "internal"]),
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
