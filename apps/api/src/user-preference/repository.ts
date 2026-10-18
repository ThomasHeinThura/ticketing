import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  currentProjectReachPredicate,
  currentResolvedIdentityPredicate,
} from "../database/repositories/identity-scope.repository";
import { projectTable, userPreferenceTable } from "../database/schema";
import { SETTINGS_WRITE_LOCK_NAMESPACE } from "./whitelist";

type SettingRowTarget = {
  readonly scope: string;
  readonly scopeId: string | null;
  readonly rowKey: string;
};

const ownRowsFilter = (personId: string) =>
  and(
    eq(userPreferenceTable.personId, personId),
    or(
      and(
        eq(userPreferenceTable.scope, "global"),
        isNull(userPreferenceTable.scopeId),
        eq(userPreferenceTable.key, "density"),
      ),
      and(
        eq(userPreferenceTable.scope, "project"),
        eq(userPreferenceTable.key, "layout"),
      ),
    ),
  );

/** Current persisted reach is part of the project-row predicate; IDs alone carry no authority. */
export async function listReachableProjectFacts(
  identity: ResolvedIdentity,
  projectIds: readonly string[],
) {
  if (projectIds.length === 0) return [];
  return await db
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      // Customer reach is by the project's serving organisation, not its workspace's owner.
      organisationId: projectTable.organisationId,
    })
    .from(projectTable)
    .where(
      and(
        inArray(projectTable.id, [...projectIds]),
        isNull(projectTable.deletedAt),
        currentResolvedIdentityPredicate(identity, db),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          db,
        ),
      ),
    );
}

export async function listOwnSettingRows(identity: ResolvedIdentity) {
  const rows = await db
    .select({
      scope: userPreferenceTable.scope,
      scopeId: userPreferenceTable.scopeId,
      key: userPreferenceTable.key,
      value: userPreferenceTable.value,
    })
    .from(userPreferenceTable)
    .where(
      and(
        ownRowsFilter(identity.personId),
        currentResolvedIdentityPredicate(identity, db),
      ),
    );
  type OwnSettingRow = Omit<(typeof rows)[number], "value"> & {
    value: JsonValue;
  };
  return rows.map(
    (row): OwnSettingRow => ({ ...row, value: row.value as JsonValue }),
  );
}

export async function lockOwnSettingsWrites(
  executor: Executor,
  identity: ResolvedIdentity,
): Promise<void> {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(${SETTINGS_WRITE_LOCK_NAMESPACE}, hashtext(${identity.personId}))`,
  );
}

export async function deleteOwnSettingRow(
  executor: Executor,
  identity: ResolvedIdentity,
  target: SettingRowTarget,
): Promise<void> {
  await executor
    .delete(userPreferenceTable)
    .where(
      and(
        eq(userPreferenceTable.personId, identity.personId),
        eq(userPreferenceTable.scope, target.scope),
        eq(userPreferenceTable.key, target.rowKey),
        target.scopeId === null
          ? isNull(userPreferenceTable.scopeId)
          : eq(userPreferenceTable.scopeId, target.scopeId),
      ),
    );
}

export async function listOwnSettingAddresses(
  executor: Executor,
  identity: ResolvedIdentity,
) {
  return await executor
    .select({
      scope: userPreferenceTable.scope,
      scopeId: userPreferenceTable.scopeId,
    })
    .from(userPreferenceTable)
    .where(ownRowsFilter(identity.personId));
}

export async function upsertOwnSettingRow(
  executor: Executor,
  identity: ResolvedIdentity,
  row: {
    target: SettingRowTarget;
    value: unknown;
    updatedAt: Date;
  },
) {
  const { target, value, updatedAt } = row;
  const conflict = {
    target:
      target.scopeId === null
        ? [
            userPreferenceTable.personId,
            userPreferenceTable.scope,
            userPreferenceTable.key,
          ]
        : [
            userPreferenceTable.personId,
            userPreferenceTable.scope,
            userPreferenceTable.scopeId,
            userPreferenceTable.key,
          ],
    targetWhere:
      target.scopeId === null
        ? isNull(userPreferenceTable.scopeId)
        : isNotNull(userPreferenceTable.scopeId),
    set: { value, updatedAt },
  } as const;

  if (target.scopeId === null) {
    const [row] = await executor
      .insert(userPreferenceTable)
      .values({
        personId: identity.personId,
        scope: target.scope,
        scopeId: null,
        key: target.rowKey,
        value,
        updatedAt,
      })
      .onConflictDoUpdate(conflict)
      .returning({ personId: userPreferenceTable.personId });
    return row;
  }

  // Keep the project and current identity predicate in the INSERT statement as well as the
  // preflight read. If persisted reach changes after preflight, INSERT SELECT returns no row.
  const select = executor
    .select({
      id: sql`${sql.param(createId(), userPreferenceTable.id)}`.as("id"),
      personId:
        sql`${sql.param(identity.personId, userPreferenceTable.personId)}`.as(
          "personId",
        ),
      scope: sql`${sql.param(target.scope, userPreferenceTable.scope)}`.as(
        "scope",
      ),
      scopeId: projectTable.id,
      key: sql`${sql.param(target.rowKey, userPreferenceTable.key)}`.as("key"),
      value: sql`${sql.param(value, userPreferenceTable.value)}`.as("value"),
      createdAt: sql`now()`.as("createdAt"),
      updatedAt: sql`${sql.param(updatedAt, userPreferenceTable.updatedAt)}`.as(
        "updatedAt",
      ),
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, target.scopeId),
        isNull(projectTable.deletedAt),
        currentResolvedIdentityPredicate(identity, executor),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
  const [result] = await executor
    .insert(userPreferenceTable)
    .select(select)
    .onConflictDoUpdate(conflict)
    .returning({ personId: userPreferenceTable.personId });
  return result;
}
