import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { portalPendingApprovalProjectIds } from "../approval";
import db, { schema } from "../database";
import { timeEntryTable } from "../database/schema-p5-time";
import {
  type CustomerPortalScope,
  customerPortalOnSql,
  customerPortalScope,
} from "../feature-flag/enforce";
import { portalCaseCountsByProject } from "../intake/portal-cases";
import type { PortalViewer } from "../intake/repository";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { resolveProjectServiceCalendarId } from "./effective-settings";
import { hourBankOf, PROJECT_STATUSES, utcToday } from "./overview-logic";
import {
  goLiveMilestoneOf,
  PORTAL_PROJECT_KEY_PATTERN,
  subscriptionPeriodOf,
} from "./portal-projects-logic";

/**
 * The customer's projects (S4c; `feature-contracts-p3.md` "Customer portal API"):
 *
 * - `GET /api/portal/projects` (`own_organisation`): the live projects of the caller's own
 *   organisation where the customer portal is on, with per-project "action required" and
 *   "outstanding" counts.
 * - `GET /api/portal/projects/{key}` (`own_organisation`): one of those projects. Any other key
 *   (another organisation's, archived, deleted, portal off, unknown) is the same 404 (`CP-2`).
 *
 * What a customer sees is listed field by field in the response schemas below; nothing is spread
 * from a staff row. Never returned: the assignee or default assignee (`CP-4`), the internal
 * status note, the SLA policy, individual time entries, rates or the people who logged time.
 * Named staff are the project's designated key contacts only (`CP-4`): the manager and active
 * staff stakeholders. D3 (Thomas, 31 Oct 2026) allows the contract period and the hours used and
 * remaining.
 *
 * The per-project counts use the same case rules as the portal dashboard (S4b,
 * `GET /api/portal/home?project=KEY`): the readable submissions (`CP-16`) plus requests raised by
 * staff for the organisation (D6), the customer status derived as `portalCustomerStatus` does
 * (an open `waiting_customer` pause is `need_more_info`), outstanding = received, need more
 * information or in progress, and action required = every readable case that needs more
 * information (a clarifying submission or an open `waiting_customer` pause on its item, whoever
 * raised it) plus pending customer approvals addressed to the caller. Both halves come from the
 * code the dashboard uses (`portalCaseCountsByProject`, `portalPendingApprovalProjectIds`), so
 * the figures cannot drift.
 */

type PortalProjectVariables = BaseVariables & {
  portalPredicateSatisfied: boolean;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
  portalViewer: { personId: string; organisationId: string };
};

const NOT_FOUND_MESSAGE = "Project not found";
const notFound = () => new HTTPException(404, { message: NOT_FOUND_MESSAGE });

async function portalScopeMiddleware(
  c: Context<{ Variables: PortalProjectVariables }>,
  next: Next,
) {
  const [person] = await db
    .select({
      id: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, c.get("userId")),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!person?.organisationId)
    throw new HTTPException(404, { message: "Portal account not found" });
  c.set("portalViewer", {
    personId: person.id,
    organisationId: person.organisationId,
  });
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", person.organisationId);
  c.set("policyOrganisationIdSource", "row");
  await next();
}

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

const kindSchema = z.string().openapi({ enum: ["project", "managed_service"] });
const statusSchema = z.string().openapi({ enum: [...PROJECT_STATUSES] });
const healthSchema = z
  .string()
  .nullable()
  .openapi({ enum: ["red", "amber", "green"] });

const countsSchema = z.object({
  actionRequired: z.number().int().openapi({
    description:
      "Readable requests in this project that need more information (a clarifying submission or an open waiting_customer pause on its item, including colleagues' requests and requests raised by staff), plus pending customer approvals addressed to the caller.",
  }),
  outstanding: z.number().int().openapi({
    description:
      "Readable requests in this project that are received, need more information or in progress.",
  }),
});

export const portalProjectSummarySchema = z
  .object({
    key: z.string(),
    name: z.string(),
    kind: kindSchema,
    status: statusSchema,
    health: healthSchema,
    counts: countsSchema,
  })
  .openapi("PortalProjectSummary");

export const portalProjectListSchema = z
  .object({ data: z.array(portalProjectSummarySchema) })
  .openapi("PortalProjectList");

const contactSchema = z.object({
  kind: z.enum(["manager", "stakeholder"]),
  role: z.string().nullable().openapi({
    description: "The stakeholder's role; null for the project manager.",
  }),
  name: z.string().nullable(),
  email: z.string().nullable(),
});

export const portalProjectDetailSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    kind: kindSchema,
    status: statusSchema,
    health: healthSchema,
    description: z.string().nullable(),
    createdAt: z.string().openapi({ format: "date-time" }),
    supportLevel: z
      .string()
      .nullable()
      .openapi({ enum: ["L1", "L2", "L3"] }),
    serviceCalendarName: z.string().nullable(),
    summary: z.object({
      objective: z.string().nullable(),
      inScope: z.string().nullable(),
      outOfScope: z.string().nullable(),
      successCriteria: z.string().nullable(),
    }),
    goLive: z
      .object({
        name: z.string(),
        date: z.string().openapi({ format: "date-time" }),
        reached: z.boolean(),
      })
      .nullable()
      .openapi({ description: "The last milestone by date; null when none." }),
    milestones: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        date: z.string().openapi({ format: "date-time" }),
        reachedAt: z.string().nullable().openapi({ format: "date-time" }),
      }),
    ),
    prerequisites: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          dueDate: z.string().nullable().openapi({ format: "date-time" }),
          completedAt: z.string().nullable().openapi({ format: "date-time" }),
        }),
      )
      .openapi({
        description:
          "Blocking prerequisites the customer owns (owner side customer or both), read-only.",
      }),
    documents: z
      .array(z.object({ id: z.string(), title: z.string(), url: z.string() }))
      .openapi({ description: "Customer-visible document links only." }),
    contacts: z.array(contactSchema).openapi({
      description:
        "The project's designated key contacts (CP-4): the manager and active staff stakeholders.",
    }),
    contract: z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        period: z.object({
          state: z.enum(["upcoming", "active", "ended"]),
          totalDays: z.number().int(),
          elapsedDays: z.number().int(),
          daysRemaining: z.number().int(),
          elapsedPct: z.number().int(),
        }),
        hours: z.object({
          contractedMinutes: z.number().int(),
          usedMinutes: z.number().int().openapi({
            description:
              "Billable minutes logged on the project inside the contract period (aggregate only).",
          }),
          remainingMinutes: z.number().int().openapi({
            description: "Contracted minus used; negative when overdrawn.",
          }),
          usedPct: z.number().int(),
        }),
      })
      .nullable()
      .openapi({ description: "Null when the project has no contract (D2)." }),
    counts: countsSchema,
  })
  .openapi("PortalProjectDetail");

export type PortalProjectDetail = z.infer<typeof portalProjectDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------------------------

/** The organisation's live projects with the customer portal on. */
function visibleProjects(
  organisationId: string,
  scope: CustomerPortalScope | null,
) {
  return and(
    eq(schema.projectTable.organisationId, organisationId),
    isNull(schema.projectTable.deletedAt),
    isNull(schema.projectTable.archivedAt),
    customerPortalOnSql(
      scope,
      schema.projectTable.workspaceId,
      schema.projectTable.id,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Counts (S4b's case source and approval list; see the file comment)
// ---------------------------------------------------------------------------------------------

type Viewer = PortalViewer;
type ProjectCounts = { actionRequired: number; outstanding: number };

/** Action required and outstanding for each of `projectIds` (absent ids count zero). */
async function countsByProject(
  userId: string,
  viewer: Viewer,
  projectIds: readonly string[],
): Promise<Map<string, ProjectCounts>> {
  const counts = new Map<string, ProjectCounts>(
    projectIds.map((id) => [id, { actionRequired: 0, outstanding: 0 }]),
  );
  if (projectIds.length === 0) return counts;
  const [cases, approvals] = await Promise.all([
    portalCaseCountsByProject(viewer, projectIds),
    portalPendingApprovalProjectIds(userId),
  ]);
  for (const [projectId, figures] of cases) {
    const entry = counts.get(projectId);
    if (!entry) continue;
    entry.outstanding = figures.outstanding;
    entry.actionRequired += figures.needMoreInfo;
  }
  for (const projectId of approvals) {
    const entry = counts.get(projectId);
    if (entry) entry.actionRequired += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export async function listPortalProjects(userId: string, viewer: Viewer) {
  const portalScope = await customerPortalScope();
  const rows = await db
    .select({
      id: schema.projectTable.id,
      key: schema.projectTable.slug,
      name: schema.projectTable.name,
      kind: schema.projectTable.kind,
      status: schema.projectTable.status,
      health: schema.projectTable.health,
    })
    .from(schema.projectTable)
    .where(visibleProjects(viewer.organisationId, portalScope))
    .orderBy(asc(schema.projectTable.name), asc(schema.projectTable.slug));
  const counts = await countsByProject(
    userId,
    viewer,
    rows.map((row) => row.id),
  );
  return portalProjectListSchema.parse({
    data: rows.map(({ id, ...row }) => ({
      ...row,
      counts: counts.get(id) ?? { actionRequired: 0, outstanding: 0 },
    })),
  });
}

/** The active staff person's display name and sign-in email; null when not a key contact. */
async function staffContacts(personIds: readonly string[]) {
  if (personIds.length === 0)
    return new Map<string, { name: string | null; email: string | null }>();
  const rows = await db
    .select({
      id: schema.personTable.id,
      name: sql<
        string | null
      >`coalesce(nullif(btrim(${schema.personTable.displayName}), ''), nullif(btrim(${schema.userTable.name}), ''))`,
      email: schema.userTable.email,
    })
    .from(schema.personTable)
    .leftJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(
      and(
        inArray(schema.personTable.id, [...personIds]),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    );
  return new Map(
    rows.map((row) => [row.id, { name: row.name, email: row.email ?? null }]),
  );
}

export async function getPortalProject(
  userId: string,
  viewer: Viewer,
  key: string,
  now = new Date(),
): Promise<PortalProjectDetail> {
  if (!PORTAL_PROJECT_KEY_PATTERN.test(key)) throw notFound();
  const portalScope = await customerPortalScope();
  const [project] = await db
    .select()
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.slug, key),
        visibleProjects(viewer.organisationId, portalScope),
      ),
    )
    .limit(1);
  if (!project) throw notFound();
  const projectId = project.id;

  const [
    milestones,
    prerequisites,
    documents,
    stakeholders,
    contractRows,
    workspaceRows,
  ] = await Promise.all([
    db
      .select({
        id: schema.milestoneTable.id,
        name: schema.milestoneTable.name,
        date: schema.milestoneTable.date,
        reachedAt: schema.milestoneTable.reachedAt,
        createdAt: schema.milestoneTable.createdAt,
      })
      .from(schema.milestoneTable)
      .where(eq(schema.milestoneTable.projectId, projectId))
      .orderBy(
        asc(schema.milestoneTable.date),
        asc(schema.milestoneTable.createdAt),
      ),
    db
      .select({
        id: schema.prerequisiteTable.id,
        title: schema.prerequisiteTable.title,
        dueDate: schema.prerequisiteTable.dueDate,
        completedAt: schema.prerequisiteTable.completedAt,
      })
      .from(schema.prerequisiteTable)
      .where(
        and(
          eq(schema.prerequisiteTable.projectId, projectId),
          eq(schema.prerequisiteTable.isBlocking, true),
          inArray(schema.prerequisiteTable.ownerSide, ["customer", "both"]),
        ),
      )
      .orderBy(
        sql`${schema.prerequisiteTable.completedAt} IS NOT NULL`,
        sql`${schema.prerequisiteTable.dueDate} ASC NULLS LAST`,
        asc(schema.prerequisiteTable.createdAt),
      ),
    db
      .select({
        id: schema.documentLinkTable.id,
        title: schema.documentLinkTable.title,
        url: schema.documentLinkTable.url,
      })
      .from(schema.documentLinkTable)
      .where(
        and(
          eq(schema.documentLinkTable.projectId, projectId),
          eq(schema.documentLinkTable.customerVisible, true),
        ),
      )
      .orderBy(
        asc(schema.documentLinkTable.title),
        asc(schema.documentLinkTable.createdAt),
      ),
    db
      .select({
        personId: schema.stakeholderTable.personId,
        role: schema.stakeholderTable.role,
      })
      .from(schema.stakeholderTable)
      .where(
        and(
          eq(schema.stakeholderTable.projectId, projectId),
          eq(schema.stakeholderTable.active, true),
        ),
      )
      .orderBy(
        asc(schema.stakeholderTable.escalationOrder),
        asc(schema.stakeholderTable.createdAt),
      ),
    db
      .select()
      .from(schema.projectContractTable)
      .where(eq(schema.projectContractTable.projectId, projectId))
      .limit(1),
    db
      .select({
        defaultServiceCalendarId:
          schema.workspaceTable.defaultServiceCalendarId,
      })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, project.workspaceId))
      .limit(1),
  ]);

  const calendarId = resolveProjectServiceCalendarId({
    mode: project.serviceCalendarMode as "inherit" | "override",
    overrideId: project.serviceCalendarId,
    workspaceDefaultId: workspaceRows[0]?.defaultServiceCalendarId ?? null,
  });
  const [calendar] = calendarId
    ? await db
        .select({ name: schema.serviceCalendarTable.name })
        .from(schema.serviceCalendarTable)
        .where(
          and(
            eq(schema.serviceCalendarTable.id, calendarId),
            eq(schema.serviceCalendarTable.workspaceId, project.workspaceId),
          ),
        )
        .limit(1)
    : [];

  const people = await staffContacts([
    ...(project.managerId ? [project.managerId] : []),
    ...stakeholders.map((row) => row.personId),
  ]);
  const contacts: z.infer<typeof contactSchema>[] = [];
  const manager = project.managerId ? people.get(project.managerId) : undefined;
  if (manager) contacts.push({ kind: "manager", role: null, ...manager });
  for (const stakeholder of stakeholders) {
    const person = people.get(stakeholder.personId);
    if (person)
      contacts.push({ kind: "stakeholder", role: stakeholder.role, ...person });
  }

  const contract = contractRows[0];
  let contractView: PortalProjectDetail["contract"] = null;
  if (contract) {
    const [used] = await db
      .select({
        minutes: sql<string>`coalesce(sum(${timeEntryTable.minutes}), 0)`,
      })
      .from(timeEntryTable)
      .where(
        and(
          eq(timeEntryTable.projectId, projectId),
          eq(timeEntryTable.billable, true),
          gte(timeEntryTable.date, contract.startDate),
          lte(timeEntryTable.date, contract.endDate),
        ),
      );
    contractView = {
      startDate: contract.startDate,
      endDate: contract.endDate,
      period: subscriptionPeriodOf(
        contract.startDate,
        contract.endDate,
        utcToday(now),
      ),
      hours: hourBankOf(contract.contractedMinutes, Number(used?.minutes ?? 0)),
    };
  }

  const counts = await countsByProject(userId, viewer, [projectId]);
  const goLive = goLiveMilestoneOf(milestones);
  return portalProjectDetailSchema.parse({
    key: project.slug,
    name: project.name,
    kind: project.kind,
    status: project.status,
    health: project.health,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    supportLevel: project.supportLevel,
    serviceCalendarName: calendar?.name ?? null,
    summary: {
      objective: project.objective,
      inScope: project.inScope,
      outOfScope: project.outOfScope,
      successCriteria: project.successCriteria,
    },
    goLive: goLive
      ? {
          name: goLive.name,
          date: goLive.date.toISOString(),
          reached: goLive.reachedAt !== null,
        }
      : null,
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      date: milestone.date.toISOString(),
      reachedAt: milestone.reachedAt?.toISOString() ?? null,
    })),
    prerequisites: prerequisites.map((row) => ({
      id: row.id,
      title: row.title,
      dueDate: row.dueDate?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    documents,
    contacts,
    contract: contractView,
    counts: counts.get(projectId) ?? { actionRequired: 0, outstanding: 0 },
  });
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

const portalProjectKeyParam = z
  .object({ key: z.string().min(1).max(64) })
  .strict();

const listRoute = createRoute({
  method: "get",
  path: "/projects",
  operationId: "listPortalProjects",
  tags: ["Portal projects"],
  summary: "List the customer organisation's projects",
  description:
    "Live, non-archived projects of the caller's organisation with the customer portal on, " +
    "ordered by name, with action-required and outstanding request counts.",
  middleware: [portalScopeMiddleware] as const,
  responses: {
    200: jsonResponse("The organisation's projects", portalProjectListSchema),
    404: errorResponse("Portal account unavailable"),
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/projects/{key}",
  operationId: "getPortalProject",
  tags: ["Portal projects"],
  summary: "Read one of the customer organisation's projects",
  description:
    "Project information, summary, milestones, the customer's blocking prerequisites, " +
    "customer-visible documents, key contacts and the contract period with hours used and " +
    "remaining. Another organisation's, archived or unknown key is 404 (CP-2).",
  middleware: [portalScopeMiddleware] as const,
  request: { params: portalProjectKeyParam },
  responses: {
    200: jsonResponse("The project", portalProjectDetailSchema),
    404: errorResponse("Project not found"),
  },
});

export const portalProjectRouter = apiRouter<PortalProjectVariables>()
  .openapi(listRoute, async (c) =>
    c.json(
      await listPortalProjects(c.get("userId"), c.get("portalViewer")),
      200,
    ),
  )
  .openapi(detailRoute, async (c) =>
    c.json(
      await getPortalProject(
        c.get("userId"),
        c.get("portalViewer"),
        c.req.valid("param").key,
      ),
      200,
    ),
  );
