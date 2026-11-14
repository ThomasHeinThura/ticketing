import { and, eq, isNull, max, or, sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import {
  columnTable,
  organisationTable,
  projectSlugClaimTable,
  projectTable,
  workspaceTable,
} from "../database/schema";
import { dbClockUtc } from "../utils/db-time";

export async function isServableCustomerOrganisation(
  executor: Executor,
  workspaceId: string,
  organisationId: string,
) {
  const [organisation] = await executor
    .select({ id: organisationTable.id })
    .from(organisationTable)
    .where(
      and(
        eq(organisationTable.id, organisationId),
        eq(organisationTable.active, true),
        eq(organisationTable.isInternal, false),
        isNull(organisationTable.deletedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!organisation) return false;

  const [workspaceOwner] = await executor
    .select({ isInternal: organisationTable.isInternal })
    .from(workspaceTable)
    .innerJoin(
      organisationTable,
      eq(organisationTable.id, workspaceTable.organisationId),
    )
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  return workspaceOwner?.isInternal === true;
}

export function projectServesCustomer() {
  return or(
    isNull(projectTable.deletedAt),
    sql`${projectTable.purgeAfter} > ${dbClockUtc()}`,
  );
}

export async function workspaceServesOrganisation(
  executor: Executor,
  workspaceId: string,
  organisationId: string,
  lock = true,
) {
  const query = executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        eq(projectTable.organisationId, organisationId),
        projectServesCustomer(),
      ),
    );
  const [project] = await (lock ? query.for("share") : query).limit(1);
  return project !== undefined;
}

export async function lockProjectOrdering(
  executor: Executor,
  workspaceId: string,
) {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(1524, hashtext(${workspaceId}))`,
  );
}

export async function hasProjectSlugClaim(executor: Executor, slug: string) {
  const [claim] = await executor
    .select({ slug: projectSlugClaimTable.slug })
    .from(projectSlugClaimTable)
    .where(eq(projectSlugClaimTable.slug, slug))
    .limit(1);
  return claim !== undefined;
}

export async function getMaxProjectPosition(
  executor: Executor,
  workspaceId: string,
) {
  const [{ maxPosition } = { maxPosition: null }] = await executor
    .select({ maxPosition: max(projectTable.position) })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));
  return maxPosition;
}

export async function insertProject(
  executor: Executor,
  values: typeof projectTable.$inferInsert,
) {
  const [project] = await executor
    .insert(projectTable)
    .values(values)
    .returning();
  return project;
}

export async function claimProjectSlug(
  executor: Executor,
  values: typeof projectSlugClaimTable.$inferInsert,
) {
  await executor.insert(projectSlugClaimTable).values(values);
}

export async function insertProjectColumn(
  executor: Executor,
  values: typeof columnTable.$inferInsert,
) {
  await executor.insert(columnTable).values(values);
}
