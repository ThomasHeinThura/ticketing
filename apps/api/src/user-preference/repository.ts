import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  projectTable,
  userPreferenceTable,
  workspaceTable,
} from "../database/schema";
import { SETTINGS_WRITE_LOCK_NAMESPACE } from "./whitelist";

/**
 * Query ownership for `user_preference` (issue #580). Statements that run inside the
 * settings-write transaction take the handle as their first parameter (`Executor`);
 * the reads outside it use the shared connection. Every function awaits and returns rows.
 */

/** A settings row's address: `scopeId` is `null` for the global (`density`) row. */
export type SettingRowTarget = {
  readonly scope: string;
  readonly scopeId: string | null;
  readonly rowKey: string;
};

/** The caller's own recognised rows: global `density` and per-project `layout`. */
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

/** Live (not soft-deleted) projects among `projectIds`, with their reach facts. */
export async function listLiveProjectReachFacts(projectIds: readonly string[]) {
  return db
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
      ),
    );
}

export async function listOwnSettingRows(personId: string) {
  return db
    .select({
      scope: userPreferenceTable.scope,
      scopeId: userPreferenceTable.scopeId,
      key: userPreferenceTable.key,
      value: userPreferenceTable.value,
    })
    .from(userPreferenceTable)
    .where(ownRowsFilter(personId));
}

/** Serialises one person's settings writes for the rest of the transaction. */
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

/** The addresses of the person's stored rows, for the row cap. */
export async function listOwnSettingAddresses(
  executor: Executor,
  personId: string,
) {
  return executor
    .select({
      scope: userPreferenceTable.scope,
      scopeId: userPreferenceTable.scopeId,
    })
    .from(userPreferenceTable)
    .where(ownRowsFilter(personId));
}

export async function upsertOwnSettingRow(
  executor: Executor,
  row: {
    personId: string;
    target: SettingRowTarget;
    value: unknown;
    updatedAt: Date;
  },
): Promise<void> {
  const { personId, target, value, updatedAt } = row;
  await executor
    .insert(userPreferenceTable)
    .values({
      personId,
      scope: target.scope,
      scopeId: target.scopeId,
      key: target.rowKey,
      value,
      updatedAt,
    })
    .onConflictDoUpdate({
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
    });
}
