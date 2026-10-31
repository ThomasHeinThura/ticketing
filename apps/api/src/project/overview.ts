import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  milestoneTable,
  organisationTable,
  personTable,
  prerequisiteTable,
  projectContractTable,
  projectTable,
  serviceCalendarTable,
  slaGoalTable,
  slaPolicyTable,
  userTable,
  workItemTable,
  workItemTypeTable,
  workspaceTable,
} from "../database/schema";
import { timeEntryTable } from "../database/schema-p5-time";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  nullableResponseTimestamp,
  z,
} from "../openapi";
import { holds } from "../time-tracking/http";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { compositionWarnings } from "./composition";
import {
  resolveProjectServiceCalendarId,
  resolveProjectSlaPolicyId,
} from "./effective-settings";
import { countProjectRosterRows } from "./hierarchy.repository";
import {
  CONTRACT_COVERAGES,
  countsFromGroups,
  daysBetween,
  deriveContractState,
  hourBankOf,
  isPastDay,
  KICKOFF_STATUSES,
  PROJECT_STATUSES,
  utcToday,
} from "./overview-logic";
import { projectParam } from "./schema";

/**
 * The project Overview (S3/S3b; decisions D1 and D2, Thomas 31 Oct 2026):
 *
 * - `GET /api/project/{id}/overview` (`project:read`): derived counts, milestones, facts and the
 *   effective service levels. Every number is computed at read time from the live tables.
 * - `PATCH /api/project/{id}/summary` (`project:update`, like health and milestones): objective,
 *   scope, success criteria, status note and the D1 lifecycle status. A dedicated PATCH rather
 *   than `PUT /api/project/{id}`: that route replaces name/icon/slug/description and would make
 *   every summary edit resend (and race) them (#767). Audited as `project.summary_updated`.
 * - `GET`/`PUT /api/project/{id}/contract` (read `project:read`, write
 *   `project:manage_settings`): the D2 contract and hour bank. Audited as `project_contract.set`.
 */

const RECENT_ENTRY_LIMIT = 5;
const MAX_CONTRACTED_MINUTES = 60_000_000;

const NUL_MESSAGE =
  "must not contain a NUL (\\u0000) byte -- Postgres text columns reject it";

/** Optional summary text: trimmed; blank clears the field (null). */
function summaryText(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => !value.includes("\u0000"), NUL_MESSAGE)
    .nullable()
    .optional();
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "must be a calendar date, YYYY-MM-DD")
  // Round-trip, not just `Date.parse`: V8 rolls 2026-02-30 over to 2 March instead of
  // returning NaN, and Postgres then rejects the value as a 500.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "must be a real calendar date");

export const updateProjectSummaryBody = z
  .object({
    objective: summaryText(4000),
    inScope: summaryText(4000),
    outOfScope: summaryText(4000),
    successCriteria: summaryText(4000),
    statusNote: summaryText(2000),
    status: z.enum(PROJECT_STATUSES).optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    "send at least one field",
  )
  .openapi("UpdateProjectSummaryBody");

export const projectSummarySchema = z
  .object({
    projectId: z.string(),
    objective: z.string().nullable(),
    inScope: z.string().nullable(),
    outOfScope: z.string().nullable(),
    successCriteria: z.string().nullable(),
    statusNote: z.string().nullable(),
    statusNoteAt: nullableResponseTimestamp.openapi({
      description: "Set by the server whenever the status note changes.",
    }),
    status: z.string().openapi({ enum: [...PROJECT_STATUSES] }),
  })
  .openapi("ProjectSummary");

const overviewMilestoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string().openapi({ format: "date-time" }),
});

export const projectOverviewSchema = z
  .object({
    projectId: z.string(),
    kind: z.string().openapi({ enum: ["project", "managed_service"] }),
    status: z.string().openapi({ enum: [...PROJECT_STATUSES] }),
    health: z
      .string()
      .nullable()
      .openapi({ enum: ["red", "amber", "green"] }),
    archived: z.boolean(),
    counts: z
      .object({
        open: z.number().int().openapi({
          description:
            "Live work items whose state group is not completed or cancelled.",
        }),
        breached: z.number().int().openapi({
          description:
            "Open work items with at least one breached SLA metric (work_item_sla_cache).",
        }),
        inProgress: z.number().int().openapi({
          description:
            "Open work items in a started state that are not waiting on the customer.",
        }),
        waiting: z.number().int().openapi({
          description:
            "Open work items with an open waiting_customer SLA pause.",
        }),
        done: z.number().int().openapi({
          description: "Live work items in a completed state.",
        }),
        total: z.number().int().openapi({
          description: "Live work items, excluding cancelled ones.",
        }),
        blockingPrerequisitesOutstanding: z.number().int(),
        prerequisites: z.number().int(),
      })
      .openapi({
        description:
          "Live means not archived and not deleted. Counts cover the whole project, not only the caller's assigned work.",
      }),
    currentMilestone: overviewMilestoneSchema.nullable().openapi({
      description: "The first milestone, by date, not yet reached.",
    }),
    overdueMilestoneIds: z.array(z.string()).openapi({
      description: "Milestones not yet reached whose date has passed.",
    }),
    compositionWarnings: z.array(z.enum(["PR-6", "PR-7", "PR-10"])),
    facts: z.object({
      customerName: z.string().nullable().openapi({
        description: "The customer organisation; null for an internal project.",
      }),
      managerName: z.string().nullable(),
      defaultAssigneeName: z.string().nullable(),
      supportLevel: z
        .string()
        .nullable()
        .openapi({ enum: ["L1", "L2", "L3"] }),
      serviceCalendarName: z.string().nullable().openapi({
        description: "The effective service calendar (inherited or set).",
      }),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
    }),
    serviceLevels: z
      .object({
        policyName: z.string().nullable(),
        source: z.enum(["project", "workspace", "none"]),
        goals: z.array(
          z.object({
            metric: z.enum(["first_response", "resolution"]),
            workItemTypeName: z.string(),
            priority: z.enum(["low", "medium", "high", "urgent"]),
            targetMinutes: z.number().int(),
          }),
        ),
      })
      .openapi({
        description:
          "The effective SLA policy's published targets, read-only. Empty goals when no policy or no published version applies.",
      }),
  })
  .openapi("ProjectOverview");

export const putProjectContractBody = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    contractedMinutes: z.number().int().min(1).max(MAX_CONTRACTED_MINUTES),
    coverage: z.enum(CONTRACT_COVERAGES),
    kickoffStatus: z.enum(KICKOFF_STATUSES),
    kickoffDate: isoDate.nullable().optional(),
  })
  .openapi("PutProjectContractBody");

export const projectContractSchema = z
  .object({
    projectId: z.string(),
    contract: z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        contractedMinutes: z.number().int(),
        coverage: z.string().openapi({ enum: [...CONTRACT_COVERAGES] }),
        kickoffStatus: z.string().openapi({ enum: [...KICKOFF_STATUSES] }),
        kickoffDate: z.string().nullable(),
        updatedAt: z.string().openapi({ format: "date-time" }),
      })
      .nullable()
      .openapi({ description: "Null when the project has no contract." }),
    state: z
      .enum(["none", "expired", "kickoff_pending", "expiring", "active"])
      .openapi({
        description:
          "Derived, in this order: none (no contract), expired (today after the end date), " +
          "kickoff_pending (kickoff not completed), expiring (30 days or fewer left), active.",
      }),
    daysRemaining: z.number().int().nullable().openapi({
      description:
        "Calendar days from today (UTC) to the end date; negative once expired.",
    }),
    hourBank: z
      .object({
        contractedMinutes: z.number().int(),
        usedMinutes: z.number().int().openapi({
          description:
            "Billable time_entry minutes on this project dated inside the contract period.",
        }),
        remainingMinutes: z.number().int().openapi({
          description: "Contracted minus used; negative when overdrawn.",
        }),
        usedPct: z.number().int(),
      })
      .nullable(),
    recentEntries: z
      .array(
        z.object({
          id: z.string(),
          date: z.string(),
          minutes: z.number().int(),
          workItemKey: z.string().nullable(),
        }),
      )
      .openapi({
        description:
          "The latest five billable entries in the period: date, minutes and work item only (no description, person or rate). " +
          "Another person's individual time is `time_entry:read_any` data, so without that capability this is always empty " +
          "(the aggregate hourBank stays, D3).",
      }),
    recentEntriesVisible: z.boolean().openapi({
      description:
        "Whether the caller holds `time_entry:read_any` and so may see recentEntries. False means the rows were withheld, not that there are none.",
    }),
  })
  .openapi("ProjectContract");

type Actor = {
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};

async function loadProject(projectId: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Project not found" });
  return row;
}

async function personName(personId: string | null) {
  if (!personId) return null;
  const [row] = await db
    .select({
      name: sql<
        string | null
      >`coalesce(nullif(btrim(${personTable.displayName}), ''), nullif(btrim(${userTable.name}), ''))`,
    })
    .from(personTable)
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, personId))
    .limit(1);
  return row?.name ?? null;
}

const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

async function buildOverview(projectId: string, workspaceId: string) {
  const project = await loadProject(projectId, workspaceId);
  const now = new Date();

  const groupRows = await db.execute<{
    group: string;
    items: string;
    breached: string;
    waiting: string;
  }>(sql`SELECT st."group" AS "group",
      count(*) AS items,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM work_item_sla_cache c
        WHERE c.work_item_id = w.id AND c.state = 'breached')) AS breached,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM sla_pause p
        WHERE p.work_item_id = w.id AND p.ended_at IS NULL
          AND p.reason = 'waiting_customer')) AS waiting
    FROM ${workItemTable} w
    JOIN state s ON s.id = w.state_id
    JOIN state_template st ON st.id = s.state_template_id
    WHERE w.project_id = ${projectId} AND w.workspace_id = ${workspaceId}
      AND w.deleted_at IS NULL AND w.archived_at IS NULL
    GROUP BY st."group"`);
  const counts = countsFromGroups(
    groupRows.rows.map((row) => ({
      group: row.group,
      items: Number(row.items),
      breached: Number(row.breached),
      waiting: Number(row.waiting),
    })),
  );

  const [prerequisiteCounts] = await db
    .select({
      total: sql<string>`count(*)`,
      blocking: sql<string>`count(*) FILTER (WHERE ${prerequisiteTable.isBlocking} AND ${prerequisiteTable.completedAt} IS NULL)`,
    })
    .from(prerequisiteTable)
    .where(eq(prerequisiteTable.projectId, projectId));

  const milestones = await db
    .select({
      id: milestoneTable.id,
      name: milestoneTable.name,
      date: milestoneTable.date,
      reachedAt: milestoneTable.reachedAt,
    })
    .from(milestoneTable)
    .where(eq(milestoneTable.projectId, projectId))
    .orderBy(asc(milestoneTable.date), asc(milestoneTable.createdAt));
  const open = milestones.filter((milestone) => milestone.reachedAt === null);
  const current = open[0] ?? null;

  const [workspace] = await db
    .select({
      defaultSlaPolicyId: workspaceTable.defaultSlaPolicyId,
      defaultServiceCalendarId: workspaceTable.defaultServiceCalendarId,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);

  const calendarId = resolveProjectServiceCalendarId({
    mode: project.serviceCalendarMode as "inherit" | "override",
    overrideId: project.serviceCalendarId,
    workspaceDefaultId: workspace?.defaultServiceCalendarId ?? null,
  });
  const [calendar] = calendarId
    ? await db
        .select({ name: serviceCalendarTable.name })
        .from(serviceCalendarTable)
        .where(
          and(
            eq(serviceCalendarTable.id, calendarId),
            eq(serviceCalendarTable.workspaceId, workspaceId),
          ),
        )
        .limit(1)
    : [];

  const [organisation] = project.organisationId
    ? await db
        .select({ name: organisationTable.name })
        .from(organisationTable)
        .where(eq(organisationTable.id, project.organisationId))
        .limit(1)
    : [];

  const policyMode = project.slaPolicyMode as "inherit" | "override";
  const policyId = resolveProjectSlaPolicyId({
    mode: policyMode,
    overrideId: project.slaPolicyId,
    workspaceDefaultId: workspace?.defaultSlaPolicyId ?? null,
  });
  const [policy] = policyId
    ? await db
        .select({
          name: slaPolicyTable.name,
          activeVersionId: slaPolicyTable.activeVersionId,
        })
        .from(slaPolicyTable)
        .where(
          and(
            eq(slaPolicyTable.id, policyId),
            eq(slaPolicyTable.workspaceId, workspaceId),
          ),
        )
        .limit(1)
    : [];
  const goals = policy?.activeVersionId
    ? await db
        .select({
          metric: slaGoalTable.metric,
          workItemTypeName: workItemTypeTable.name,
          priority: slaGoalTable.priority,
          targetMinutes: slaGoalTable.targetMinutes,
        })
        .from(slaGoalTable)
        .innerJoin(
          workItemTypeTable,
          and(
            eq(workItemTypeTable.id, slaGoalTable.workItemTypeId),
            eq(workItemTypeTable.workspaceId, slaGoalTable.workspaceId),
          ),
        )
        .where(
          and(
            eq(slaGoalTable.versionId, policy.activeVersionId),
            eq(slaGoalTable.workspaceId, workspaceId),
          ),
        )
    : [];
  goals.sort(
    (a, b) =>
      a.workItemTypeName.localeCompare(b.workItemTypeName) ||
      PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
      a.metric.localeCompare(b.metric),
  );

  return projectOverviewSchema.parse({
    projectId,
    kind: project.kind,
    status: project.status,
    health: project.health,
    archived: project.archivedAt !== null,
    counts: {
      ...counts,
      blockingPrerequisitesOutstanding: Number(
        prerequisiteCounts?.blocking ?? 0,
      ),
      prerequisites: Number(prerequisiteCounts?.total ?? 0),
    },
    currentMilestone: current
      ? {
          id: current.id,
          name: current.name,
          date: current.date.toISOString(),
        }
      : null,
    overdueMilestoneIds: open
      .filter((milestone) => isPastDay(milestone.date, now))
      .map((milestone) => milestone.id),
    compositionWarnings: compositionWarnings({
      managerId: project.managerId,
      startDate: project.startDate,
      memberCount: await countProjectRosterRows(db, projectId),
    }),
    facts: {
      customerName: organisation?.name ?? null,
      managerName: await personName(project.managerId),
      defaultAssigneeName: await personName(project.defaultAssigneeId),
      supportLevel: project.supportLevel,
      serviceCalendarName: calendar?.name ?? null,
      startDate: project.startDate,
      endDate: project.endDate,
    },
    serviceLevels: {
      policyName: policy?.name ?? null,
      source:
        policyId === null
          ? "none"
          : policyMode === "override"
            ? "project"
            : "workspace",
      goals,
    },
  });
}

function summaryOf(project: typeof projectTable.$inferSelect) {
  return projectSummarySchema.parse({
    projectId: project.id,
    objective: project.objective,
    inScope: project.inScope,
    outOfScope: project.outOfScope,
    successCriteria: project.successCriteria,
    statusNote: project.statusNote,
    statusNoteAt: project.statusNoteAt,
    status: project.status,
  });
}

const SUMMARY_TEXT_FIELDS = [
  "objective",
  "inScope",
  "outOfScope",
  "successCriteria",
  "statusNote",
] as const;

async function updateSummary(
  projectId: string,
  workspaceId: string,
  body: z.infer<typeof updateProjectSummaryBody>,
  actor: Actor,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!current)
      throw new HTTPException(404, { message: "Project not found" });

    const next: Partial<typeof projectTable.$inferInsert> = {};
    const changedFields: string[] = [];
    for (const field of SUMMARY_TEXT_FIELDS) {
      const sent = body[field];
      if (sent === undefined) continue;
      const value = sent === null ? null : sent.trim() || null;
      if (value === current[field]) continue;
      next[field] = value;
      changedFields.push(field);
    }
    if (body.status !== undefined && body.status !== current.status) {
      next.status = body.status;
      changedFields.push("status");
    }
    if (changedFields.length === 0) return current;
    if (changedFields.includes("statusNote")) next.statusNoteAt = new Date();

    const [updated] = await tx
      .update(projectTable)
      .set(next)
      .where(eq(projectTable.id, projectId))
      .returning();
    if (!updated)
      throw new HTTPException(404, { message: "Project not found" });
    await appendAuditLog(tx, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      apiKeyId: actor.apiKeyId,
      workspaceId,
      projectId,
      action: "project.summary_updated",
      entityType: "project",
      entityId: projectId,
      before: { status: current.status },
      after: { status: updated.status, changedFields },
    });
    return updated;
  });
}

/**
 * The D2 contract and hour bank. `recentEntries` identifies individual people's hours on a
 * project with few loggers, so it is returned only when the caller holds `time_entry:read_any`
 * (the same rule as reports, R7-04); without it the query is not run and the list is empty.
 */
async function readContract(
  executor: Executor,
  projectId: string,
  includeEntries: boolean,
  now = new Date(),
) {
  const [contract] = await executor
    .select()
    .from(projectContractTable)
    .where(eq(projectContractTable.projectId, projectId))
    .limit(1);
  const today = utcToday(now);
  if (!contract) {
    return projectContractSchema.parse({
      projectId,
      contract: null,
      state: "none",
      daysRemaining: null,
      hourBank: null,
      recentEntries: [],
      recentEntriesVisible: includeEntries,
    });
  }
  const inPeriod = and(
    eq(timeEntryTable.projectId, projectId),
    eq(timeEntryTable.billable, true),
    gte(timeEntryTable.date, contract.startDate),
    lte(timeEntryTable.date, contract.endDate),
  );
  const [used] = await executor
    .select({
      minutes: sql<string>`coalesce(sum(${timeEntryTable.minutes}), 0)`,
    })
    .from(timeEntryTable)
    .where(inPeriod);
  const recent = !includeEntries
    ? []
    : await executor
        .select({
          id: timeEntryTable.id,
          date: timeEntryTable.date,
          minutes: timeEntryTable.minutes,
          workItemKey: workItemTable.key,
        })
        .from(timeEntryTable)
        .leftJoin(
          workItemTable,
          and(
            eq(workItemTable.id, timeEntryTable.workItemId),
            eq(workItemTable.projectId, projectId),
            isNull(workItemTable.deletedAt),
          ),
        )
        .where(inPeriod)
        .orderBy(desc(timeEntryTable.date), desc(timeEntryTable.createdAt))
        .limit(RECENT_ENTRY_LIMIT);
  return projectContractSchema.parse({
    projectId,
    contract: {
      startDate: contract.startDate,
      endDate: contract.endDate,
      contractedMinutes: contract.contractedMinutes,
      coverage: contract.coverage,
      kickoffStatus: contract.kickoffStatus,
      kickoffDate: contract.kickoffDate,
      updatedAt: contract.updatedAt.toISOString(),
    },
    state: deriveContractState(contract, today),
    daysRemaining: daysBetween(today, contract.endDate),
    hourBank: hourBankOf(
      contract.contractedMinutes,
      Number(used?.minutes ?? 0),
    ),
    recentEntries: recent,
    recentEntriesVisible: includeEntries,
  });
}

function contractAuditShape(
  contract: typeof projectContractTable.$inferSelect | undefined,
) {
  return contract
    ? {
        startDate: contract.startDate,
        endDate: contract.endDate,
        contractedMinutes: contract.contractedMinutes,
        coverage: contract.coverage,
        kickoffStatus: contract.kickoffStatus,
        kickoffDate: contract.kickoffDate,
      }
    : null;
}

async function putContract(
  projectId: string,
  workspaceId: string,
  body: z.infer<typeof putProjectContractBody>,
  actor: Actor,
  includeEntries: boolean,
) {
  if (body.endDate < body.startDate)
    throw new HTTPException(422, { message: "end_date_before_start_date" });
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    const [before] = await tx
      .select()
      .from(projectContractTable)
      .where(eq(projectContractTable.projectId, projectId))
      .limit(1);
    const values = {
      startDate: body.startDate,
      endDate: body.endDate,
      contractedMinutes: body.contractedMinutes,
      coverage: body.coverage,
      kickoffStatus: body.kickoffStatus,
      kickoffDate: body.kickoffDate ?? null,
    };
    const [after] = await tx
      .insert(projectContractTable)
      .values({ projectId, ...values })
      .onConflictDoUpdate({
        target: projectContractTable.projectId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    await appendAuditLog(tx, {
      actorId: actor.actorId,
      actorType: actor.actorType,
      apiKeyId: actor.apiKeyId,
      workspaceId,
      projectId,
      action: "project_contract.set",
      entityType: "project_contract",
      entityId: projectId,
      before: contractAuditShape(before),
      after: { ...contractAuditShape(after), created: before === undefined },
    });
    return readContract(tx, projectId, includeEntries);
  });
}

const getProjectOverviewRoute = createRoute({
  method: "get",
  operationId: "getProjectOverview",
  path: "/{id}/overview",
  tags: ["Projects"],
  summary: "Get a project's overview",
  description:
    "Derived counts (open, breached, in progress, waiting, done/total, outstanding blocking " +
    "prerequisites), the current and overdue milestones, composition warnings, facts and the " +
    "effective service levels. Needs project:read.",
  middleware: [
    workspaceAccess.fromProject("id", { requireProjectReach: true }),
    requireWorkspaceCapability("project:read"),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("Project overview", projectOverviewSchema),
    400: errorResponse("Malformed project ID (including a NUL byte)"),
    403: errorResponse("Missing project:read capability"),
    404: errorResponse("Project not found or out of reach"),
  },
});

const updateProjectSummaryRoute = createRoute({
  method: "patch",
  operationId: "updateProjectSummary",
  path: "/{id}/summary",
  tags: ["Projects"],
  summary: "Update a project's summary and status",
  description:
    "Partial update of objective, inScope, outOfScope, successCriteria, statusNote and the " +
    "lifecycle status (planning, active, on_hold, closed). Blank text clears a field. " +
    "statusNoteAt is set by the server when the note changes. Needs project:update; audited " +
    "as project.summary_updated.",
  middleware: [
    workspaceAccess.fromProject("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateProjectSummaryBody } },
    },
  },
  responses: {
    200: jsonResponse("The project summary", projectSummarySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing project:update permission"),
    404: errorResponse("Project not found or out of reach"),
  },
});

const getProjectContractRoute = createRoute({
  method: "get",
  operationId: "getProjectContract",
  path: "/{id}/contract",
  tags: ["Projects"],
  summary: "Get a project's contract and hour bank",
  description:
    "The contract period, coverage and kickoff, its derived state and the hour bank (billable " +
    "time in the period). contract is null when none is recorded. Needs project:read.",
  middleware: [
    workspaceAccess.fromProject("id", { requireProjectReach: true }),
    requireWorkspaceCapability("project:read"),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("Project contract", projectContractSchema),
    400: errorResponse("Malformed project ID (including a NUL byte)"),
    403: errorResponse("Missing project:read capability"),
    404: errorResponse("Project not found or out of reach"),
  },
});

const putProjectContractRoute = createRoute({
  method: "put",
  operationId: "putProjectContract",
  path: "/{id}/contract",
  tags: ["Projects"],
  summary: "Create or replace a project's contract",
  description:
    "Upsert the project's one contract. Needs project:manage_settings; audited as " +
    "project_contract.set.",
  middleware: [
    workspaceAccess.fromProject("id", { requireProjectReach: true }),
    requireWorkspaceCapability("project:manage_settings"),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: putProjectContractBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved contract", projectContractSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing project:manage_settings capability"),
    404: errorResponse("Project not found or out of reach"),
    422: errorResponse("End date before start date"),
  },
});

function actorOf(c: {
  get(key: "userId"): string;
  get(key: "apiKey"): { id: string } | undefined;
}): Actor {
  const apiKey = c.get("apiKey");
  return {
    actorId: c.get("userId"),
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}

export const projectOverviewApi = apiRouter<
  BaseVariables & { workspaceId: string }
>()
  .openapi(getProjectOverviewRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await buildOverview(id, c.get("workspaceId")), 200);
  })
  .openapi(updateProjectSummaryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const updated = await updateSummary(
      id,
      c.get("workspaceId"),
      c.req.valid("json"),
      actorOf(c),
    );
    return c.json(summaryOf(updated), 200);
  })
  .openapi(getProjectContractRoute, async (c) => {
    const { id } = c.req.valid("param");
    await loadProject(id, c.get("workspaceId"));
    const includeEntries = await holds(c, "time_entry:read_any");
    return c.json(await readContract(db, id, includeEntries), 200);
  })
  .openapi(putProjectContractRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(
      await putContract(
        id,
        c.get("workspaceId"),
        c.req.valid("json"),
        actorOf(c),
        await holds(c, "time_entry:read_any"),
      ),
      200,
    );
  });
