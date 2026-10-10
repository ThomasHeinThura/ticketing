import type { SQL } from "drizzle-orm";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import db, { schema } from "../../database";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const userDirectoryProjection = {
  id: schema.userTable.id,
  name: schema.userTable.name,
  email: schema.userTable.email,
  emailVerified: schema.userTable.emailVerified,
  createdAt: schema.userTable.createdAt,
  locale: schema.userTable.locale,
  role: schema.userTable.role,
  banned: schema.userTable.banned,
  banExpires: schema.userTable.banExpires,
  twoFactorEnabled: schema.userTable.twoFactorEnabled,
  personId: schema.personTable.id,
  side: schema.personTable.side,
  organisationId: schema.personTable.organisationId,
  organisationName: schema.organisationTable.name,
  personActive: schema.personTable.active,
  isPlaceholder: schema.personTable.isPlaceholder,
};

export function listDirectoryUsers(predicates: SQL[], limit: number) {
  return db
    .select(userDirectoryProjection)
    .from(schema.userTable)
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .leftJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.personTable.organisationId),
    )
    .where(predicates.length ? and(...predicates) : undefined)
    .orderBy(desc(schema.userTable.createdAt), desc(schema.userTable.id))
    .limit(limit);
}

export function getDirectoryUser(id: string) {
  return db
    .select(userDirectoryProjection)
    .from(schema.userTable)
    .leftJoin(
      schema.personTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .leftJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.personTable.organisationId),
    )
    .where(eq(schema.userTable.id, id))
    .limit(1);
}

export function lockUserForMutation(executor: Executor, id: string) {
  return executor
    .select({ id: schema.userTable.id, banned: schema.userTable.banned })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, id))
    .for("update")
    .limit(1);
}

export function lockUserId(executor: Executor, id: string) {
  return executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, id))
    .for("update")
    .limit(1);
}

export function getPersonStatus(userId: string) {
  return db
    .select({
      personId: schema.personTable.id,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
}

export function getActiveStaffPerson(userId: string) {
  return db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.active, true),
        eq(schema.personTable.side, "staff"),
      ),
    )
    .limit(1);
}

export function lockSetupCompletion(executor: Executor) {
  return executor
    .select({ completedAt: schema.instanceSettingTable.setupCompletedAt })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .for("update")
    .limit(1);
}

export function lockGrantTarget(executor: Executor, id: string) {
  return executor
    .select({
      id: schema.userTable.id,
      role: schema.userTable.role,
      banned: schema.userTable.banned,
      anonymous: schema.userTable.isAnonymous,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, id))
    .for("update")
    .limit(1);
}

export function lockGrantTargetPeople(executor: Executor, userId: string) {
  return executor
    .select({
      id: schema.personTable.id,
      side: schema.personTable.side,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .for("update");
}

export function lockAdminUser(executor: Executor, userId: string) {
  return executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(
      and(eq(schema.userTable.id, userId), eq(schema.userTable.role, "admin")),
    )
    .for("update")
    .limit(1);
}

export function lockActiveStaffPerson(
  executor: Executor,
  personId: string,
  userId: string,
) {
  return executor
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.id, personId),
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockActiveAgentSession(
  executor: Executor,
  sessionId: string,
  userId: string,
) {
  return executor
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, sessionId),
        eq(schema.sessionTable.userId, userId),
        eq(schema.sessionTable.portal, "agent"),
        gt(schema.sessionTable.expiresAt, sql`now()`),
      ),
    )
    .for("update")
    .limit(1);
}

export function listAdminIds(executor: Executor) {
  return executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.role, "admin"));
}
