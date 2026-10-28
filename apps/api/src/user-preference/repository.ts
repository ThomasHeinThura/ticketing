import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  projectTable,
  userPreferenceTable,
  workspaceTable,
} from "../database/schema";
import { PROJECT_ROW_KEYS, SETTINGS_WRITE_LOCK_NAMESPACE } from "./whitelist";

export type SettingRowTarget = {
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
        inArray(userPreferenceTable.key, [...PROJECT_ROW_KEYS]),
      ),
    ),
  );

/** Persisted project reach is part of the read predicate; callers cannot supply authority by ID. */
export async function listLiveProjectReachFacts(
  identity: ResolvedIdentity,
  projectIds: readonly string[],
  executor: Executor = db,
) {
  if (!projectIds.length) return [];
  return executor
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      organisationId: workspaceTable.organisationId,
    })
    .from(projectTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        inArray(projectTable.id, [...projectIds]),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
}

export async function listOwnSettingRows(
  personId: string,
  executor: Executor = db,
) {
  return executor
    .select({
      scope: userPreferenceTable.scope,
      scopeId: userPreferenceTable.scopeId,
      key: userPreferenceTable.key,
      value: userPreferenceTable.value,
    })
    .from(userPreferenceTable)
    .where(ownRowsFilter(personId));
}

export async function lockOwnSettingsWrites(
  executor: Executor,
  personId: string,
): Promise<void> {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(${SETTINGS_WRITE_LOCK_NAMESPACE}, hashtext(${personId}))`,
  );
}

export async function deleteOwnSettingRow(
  executor: Executor,
  personId: string,
  target: SettingRowTarget,
): Promise<void> {
  await executor
    .delete(userPreferenceTable)
    .where(
      and(
        eq(userPreferenceTable.personId, personId),
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
  personId: string,
) {
  return executor
    .select({
      scope: userPreferenceTable.scope,
      scopeId: userPreferenceTable.scopeId,
      key: userPreferenceTable.key,
    })
    .from(userPreferenceTable)
    .where(ownRowsFilter(personId));
}

export async function upsertOwnSettingRow(
  executor: Executor,
  identity: ResolvedIdentity,
  row: {
    personId: string;
    target: SettingRowTarget;
    value: unknown;
    updatedAt: Date;
  },
) {
  const { personId, target, value, updatedAt } = row;
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
        personId,
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
  const select = executor
    .select({
      id: sql`${sql.param(createId(), userPreferenceTable.id)}`.as("id"),
      personId: sql`${sql.param(personId, userPreferenceTable.personId)}`.as(
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
        isNull(projectTable.archivedAt),
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
