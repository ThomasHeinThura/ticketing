import {
  and,
  asc,
  count,
  eq,
  isNotNull,
  isNull,
  max,
  min,
  ne,
  sql,
} from "drizzle-orm";
import db from "../database";
import {
  documentLinkTable,
  milestoneTable,
  personTable,
  prerequisiteTable,
  projectSlugClaimTable,
  projectTable,
  serviceCalendarTable,
  stakeholderTable,
  taskTable,
  workspaceTable,
} from "../database/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export const getProjectQuery = (id: string, workspaceId: string) =>
  db.query.projectTable.findFirst({
    where: and(
      eq(projectTable.id, id),
      eq(projectTable.workspaceId, workspaceId),
      isNull(projectTable.deletedAt),
    ),
    with: { tasks: true },
  });
export const getActiveProjectIdQuery = (id: string, workspaceId: string) =>
  db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
export const getActiveProjectQuery = (
  id: string,
  workspaceId: string,
  executor: Executor = db,
) =>
  executor
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    );
export const findStakeholderPersonQuery = (
  personId: string,
  workspaceId: string,
) =>
  db
    .select({ id: personTable.id })
    .from(personTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.organisationId, personTable.organisationId),
    )
    .where(
      and(eq(personTable.id, personId), eq(workspaceTable.id, workspaceId)),
    )
    .limit(1);
export const listMilestonesQuery = (projectId: string) =>
  db
    .select()
    .from(milestoneTable)
    .where(eq(milestoneTable.projectId, projectId))
    .orderBy(asc(milestoneTable.date));
export const listPrerequisitesQuery = (projectId: string) =>
  db
    .select()
    .from(prerequisiteTable)
    .where(eq(prerequisiteTable.projectId, projectId))
    .orderBy(asc(prerequisiteTable.createdAt));
export const listDocumentLinksQuery = (projectId: string) =>
  db
    .select()
    .from(documentLinkTable)
    .where(eq(documentLinkTable.projectId, projectId))
    .orderBy(asc(documentLinkTable.createdAt));
export const listStakeholdersQuery = (projectId: string) =>
  db
    .select()
    .from(stakeholderTable)
    .where(eq(stakeholderTable.projectId, projectId))
    .orderBy(asc(stakeholderTable.escalationOrder));
export const findProjectSlugClaimQuery = (
  slug: string,
  executor: Executor = db,
) =>
  executor
    .select({ slug: projectSlugClaimTable.slug })
    .from(projectSlugClaimTable)
    .where(eq(projectSlugClaimTable.slug, slug))
    .limit(1);
export const getProjectMaxPositionQuery = (
  workspaceId: string,
  executor: Executor = db,
) =>
  executor
    .select({ maxPosition: max(projectTable.position) })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));
export const findProjectLiveSlugConflictQuery = (
  executor: Executor,
  slug: string,
  projectId: string,
) =>
  executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(and(eq(projectTable.slug, slug), ne(projectTable.id, projectId)))
    .limit(1);
export const getProjectClaimOwnerQuery = (executor: Executor, slug: string) =>
  executor
    .select({ projectId: projectSlugClaimTable.projectId })
    .from(projectSlugClaimTable)
    .where(eq(projectSlugClaimTable.slug, slug))
    .limit(1);
export const getProjectUpdateConfigQuery = (id: string, workspaceId: string) =>
  db
    .select({
      kind: projectTable.kind,
      supportLevel: projectTable.supportLevel,
      serviceCalendarId: projectTable.serviceCalendarId,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
export const getProjectStatsQuery = (
  workspaceId: string,
  includeArchived: boolean,
) =>
  db
    .select({
      projectId: taskTable.projectId,
      totalTasks: count(),
      completedTasks: count(
        sql`case when ${taskTable.status} in ('done', 'archived') then 1 end`,
      ),
      dueDate: min(taskTable.dueDate),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      includeArchived
        ? and(
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.deletedAt),
          )
        : and(
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.archivedAt),
            isNull(projectTable.deletedAt),
          ),
    )
    .groupBy(taskTable.projectId);
export const listProjectsQuery = (
  workspaceId: string,
  includeArchived: boolean,
) =>
  db.query.projectTable.findMany({
    where: includeArchived
      ? and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        )
      : and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.archivedAt),
          isNull(projectTable.deletedAt),
        ),
    orderBy: (project, { asc }) => [
      asc(project.position),
      asc(project.createdAt),
      asc(project.id),
    ],
  });
export const listProjectsForReorderQuery = (
  executor: Executor,
  workspaceId: string,
) =>
  executor
    .select({ id: projectTable.id, position: projectTable.position })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .orderBy(
      asc(projectTable.position),
      asc(projectTable.createdAt),
      asc(projectTable.id),
    );
export const getDeletedProjectForReorderQuery = (
  executor: Executor,
  id: string,
  workspaceId: string,
) =>
  executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        isNotNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
export const listProjectsAfterReorderQuery = (
  executor: Executor,
  workspaceId: string,
) =>
  executor.query.projectTable.findMany({
    where: and(
      eq(projectTable.workspaceId, workspaceId),
      isNull(projectTable.deletedAt),
    ),
    orderBy: [
      asc(projectTable.position),
      asc(projectTable.createdAt),
      asc(projectTable.id),
    ],
  });
export const getServiceCalendarByWorkspaceQuery = (
  calendarId: string,
  workspaceId: string,
) =>
  db
    .select({ id: serviceCalendarTable.id })
    .from(serviceCalendarTable)
    .where(
      and(
        eq(serviceCalendarTable.id, calendarId),
        eq(serviceCalendarTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
export const getProjectConfigurationQuery = (id: string, workspaceId: string) =>
  db
    .select({
      kind: projectTable.kind,
      supportLevel: projectTable.supportLevel,
      serviceCalendarId: projectTable.serviceCalendarId,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
