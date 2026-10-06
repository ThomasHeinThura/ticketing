import { and, desc, eq, type SQL } from "drizzle-orm";
import type db from "../database";
import {
  auditLogTable,
  membershipTable,
  personTable,
} from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function listAuditRows(
  executor: Executor,
  filter: SQL | undefined,
  limit: number,
) {
  return executor
    .select()
    .from(auditLogTable)
    .where(filter)
    .orderBy(desc(auditLogTable.seq))
    .limit(limit);
}

export function getPersonByUserId(executor: Executor, userId: string) {
  return executor
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
}

export function getWorkspaceSeesAllMembership(
  executor: Executor,
  personId: string,
  workspaceId: string,
) {
  return executor
    .select({ personId: membershipTable.personId })
    .from(membershipTable)
    .where(
      and(
        eq(membershipTable.personId, personId),
        eq(membershipTable.scope, "workspace"),
        eq(membershipTable.scopeId, workspaceId),
        eq(membershipTable.seesAll, true),
      ),
    )
    .limit(1);
}

export function listProjectMembershipScopeIds(
  executor: Executor,
  personId: string,
) {
  return executor
    .select({ projectId: membershipTable.scopeId })
    .from(membershipTable)
    .where(
      and(
        eq(membershipTable.personId, personId),
        eq(membershipTable.scope, "project"),
      ),
    );
}
