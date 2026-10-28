import type { SQL } from "drizzle-orm";
import { and, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { dbNowUtc } from "../../utils/db-time";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const userDirectoryProjection = {
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

export async function listDirectoryUsers(predicates: SQL[], limit: number) {
  return await db
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

export async function getDirectoryUser(id: string) {
  return await db
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

export async function lockUserForMutation(executor: Executor, id: string) {
  return await executor
    .select({
      id: schema.userTable.id,
      banned: schema.userTable.banned,
      role: schema.userTable.role,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, id))
    .for("update")
    .limit(1);
}

export async function lockUserId(executor: Executor, id: string) {
  return await executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, id))
    .for("update")
    .limit(1);
}

export async function getPersonStatus(userId: string) {
  return await db
    .select({
      personId: schema.personTable.id,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
}

export async function getActiveStaffPerson(userId: string) {
  return await db
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

export async function lockSetupCompletion(executor: Executor) {
  return await executor
    .select({ completedAt: schema.instanceSettingTable.setupCompletedAt })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .for("update")
    .limit(1);
}

export async function lockGrantTarget(executor: Executor, id: string) {
  return await executor
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

export async function lockGrantTargetPeople(
  executor: Executor,
  userId: string,
) {
  return await executor
    .select({
      id: schema.personTable.id,
      side: schema.personTable.side,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .for("update");
}

export async function lockAdminUser(executor: Executor, userId: string) {
  return await executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(
      and(eq(schema.userTable.id, userId), eq(schema.userTable.role, "admin")),
    )
    .for("update")
    .limit(1);
}

export async function lockActiveStaffPerson(
  executor: Executor,
  personId: string,
  userId: string,
) {
  return await executor
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

export async function lockActiveAgentSession(
  executor: Executor,
  sessionId: string,
  userId: string,
) {
  return await executor
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, sessionId),
        eq(schema.sessionTable.userId, userId),
        eq(schema.sessionTable.portal, "agent"),
        gt(schema.sessionTable.expiresAt, dbNowUtc()),
      ),
    )
    .for("update")
    .limit(1);
}

export async function listAdminIds(executor: Executor) {
  return await executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.role, "admin"));
}

/**
 * Last-administrator and self-target guard for suspend and deactivate (decision log
 * 2026-10-10). Refuses an actor targeting their own account, and refuses any action on
 * an instance administrator that would leave no active, unbanned instance administrator
 * with an active staff person. Callers hold `pg_advisory_xact_lock(2026)` (the shared
 * promotion/admin lock) so the count and the mutation are one serialized step.
 */
export async function assertAdminRemovalAllowed(
  executor: Executor,
  input: {
    actorUserId: string;
    targetUserId: string;
    targetRole: string | null;
  },
) {
  if (input.actorUserId === input.targetUserId)
    throw new HTTPException(409, { message: "self_target_refused" });
  if (input.targetRole !== "admin") return;
  const [remaining] = await executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .innerJoin(
      schema.personTable,
      and(
        eq(schema.personTable.userId, schema.userTable.id),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .where(
      and(
        eq(schema.userTable.role, "admin"),
        ne(schema.userTable.id, input.targetUserId),
        or(
          isNull(schema.userTable.banned),
          eq(schema.userTable.banned, false),
          and(
            sql`${schema.userTable.banExpires} is not null`,
            sql`${schema.userTable.banExpires} <= now()`,
          ),
        ),
      ),
    )
    .limit(1);
  if (!remaining)
    throw new HTTPException(409, { message: "last_instance_admin" });
}

export async function lockInstanceAdminSerialization(
  executor: Executor,
): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(2026)`);
}

/**
 * The same lock in SHARED mode: it waits for an instance-administrator change in flight (which holds
 * it exclusively) and makes one wait for it, but does not serialize with other shared holders. A
 * long-running writer (the import runner) takes it only for a short authority re-check in its own
 * small transaction, so a role change is never blocked for the length of a whole chunk.
 */
export async function lockInstanceAdminSerializationShared(
  executor: Executor,
): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock_shared(2026)`);
}
