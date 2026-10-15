import type { JsonValue } from "@taskdesk/domain";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  auditLogTable,
  membershipTable,
  personTable,
} from "../database/schema";
import { AUDIT_CHAIN_LOCK_KEY } from "./lock";

/**
 * Query ownership for the audit log (issue #580): the two list reads and the reach facts
 * they filter by, the chain-verification read, and the five statements of the append path.
 * Moved verbatim; every function awaits and returns plain rows. The append path's
 * statements all run on the writer's single transaction handle in the same order
 * (lock, head read, clock read, insert), and the transaction boundary stays in
 * `audit-writer.ts`.
 */

export type AuditQuery = {
  readonly limit: number;
  readonly action?: string | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
};

type AuditListRow = Omit<
  typeof auditLogTable.$inferSelect,
  "before" | "after"
> & {
  before: JsonValue | null;
  after: JsonValue | null;
};

/**
 * Drizzle leaves JSONB columns as `unknown`. These fields are materialized by the
 * configured node-postgres/Drizzle JSONB path: PostgreSQL stores JSON values, pg-types
 * decodes JSONB with `JSON.parse`, and Drizzle returns the decoded value unchanged.
 * Keep the persisted value and row shape intact while exposing the existing JsonValue
 * contract to repository callers.
 */
function materializeAuditRows(
  rows: (typeof auditLogTable.$inferSelect)[],
): AuditListRow[] {
  return rows.map((row) => ({
    ...row,
    before: row.before as JsonValue | null,
    after: row.after as JsonValue | null,
  }));
}

/**
 * Shared WHERE construction for both audit list routes. The `action` filter is a
 * dotted-key PREFIX match (`auth.` selects the whole auth-lifecycle group). `%`, `_`
 * and backslash in the caller's prefix are backslash-escaped; PostgreSQL's LIKE treats
 * backslash as its default escape character, so a crafted prefix cannot become a
 * wildcard scan of every action.
 */
function auditListFilters(query: AuditQuery): (SQL | undefined)[] {
  const actionFilter =
    query.action === undefined
      ? undefined
      : like(
          auditLogTable.action,
          `${query.action.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
        );
  return [
    actionFilter,
    query.since === undefined
      ? undefined
      : gte(auditLogTable.createdAt, new Date(query.since)),
    query.until === undefined
      ? undefined
      : lt(auditLogTable.createdAt, new Date(query.until)),
  ];
}

function combineFilters(filters: (SQL | undefined)[]): SQL | undefined {
  const defined = filters.filter((f): f is SQL => f !== undefined);
  return defined.length === 0 ? undefined : and(...defined);
}

/** Every audit row matching the filters, newest first (instance administrators). */
export async function listInstanceAuditRows(query: AuditQuery) {
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(combineFilters(auditListFilters(query)))
    .orderBy(desc(auditLogTable.seq))
    .limit(query.limit);
  return materializeAuditRows(rows);
}

/**
 * Which projects' audit rows a caller may see within a workspace: `"all"` (the
 * per-workspace `sees_all` grant) or the explicit reachable project ids, where an empty
 * list means non-project rows only (fail closed).
 */
export type AuditProjectReach = "all" | readonly string[];

/** The caller's person id, or `undefined`. */
export async function findPersonIdByUserId(userId: string) {
  const [person] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
  return person;
}

/** Whether the person holds `sees_all` on a workspace-scope membership of `workspaceId`. */
export async function holdsWorkspaceSeesAll(
  personId: string,
  workspaceId: string,
): Promise<boolean> {
  const [seesAll] = await db
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
  return seesAll !== undefined;
}

/** Project ids the person has a project-scope membership on. */
export async function listProjectMembershipIds(personId: string) {
  return (
    await db
      .select({ projectId: membershipTable.scopeId })
      .from(membershipTable)
      .where(
        and(
          eq(membershipTable.personId, personId),
          eq(membershipTable.scope, "project"),
        ),
      )
  ).map((row) => row.projectId);
}

/**
 * One workspace's audit rows, newest first. The workspace filter is unconditional; the
 * project filter is `project_id IS NULL`, plus `project_id IN (ids)` when the caller
 * reaches any project, or no project constraint for `"all"`.
 */
export async function listWorkspaceAuditRows(
  workspaceId: string,
  reach: AuditProjectReach,
  query: AuditQuery,
) {
  const reachFilter: SQL | undefined =
    reach === "all"
      ? undefined
      : reach.length === 0
        ? isNull(auditLogTable.projectId)
        : or(
            isNull(auditLogTable.projectId),
            inArray(auditLogTable.projectId, [...reach]),
          );
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(
      combineFilters([
        eq(auditLogTable.workspaceId, workspaceId),
        reachFilter,
        ...auditListFilters(query),
      ]),
    )
    .orderBy(desc(auditLogTable.seq))
    .limit(query.limit);
  return materializeAuditRows(rows);
}

export type AuditLogChainRow = {
  id: string;
  seq: string;
  actor_id: string | null;
  actor_type: string;
  api_key_id: string | null;
  impersonator_id: string | null;
  actor_ip: string | null;
  user_agent: string | null;
  trace_id: string | null;
  workspace_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: JsonValue | null;
  after: JsonValue | null;
  created_at_iso: string;
  prev_hash: string;
  row_hash: string;
};

/** Every row's hash inputs in `seq` order, `created_at` as the exact UTC ISO string. */
export async function listAuditChainRows(executor: Executor) {
  const result = await executor.execute<AuditLogChainRow>(
    sql`
      SELECT
        id, seq, actor_id, actor_type, api_key_id, impersonator_id, actor_ip,
        user_agent, trace_id, workspace_id, action, entity_type, entity_id,
        before, after,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
        prev_hash, row_hash
      FROM audit_log
      ORDER BY seq ASC
    `,
  );
  return result.rows;
}

/** Step 1 of an append: serialise on the single global chain lock until commit. */
export async function lockAuditChain(tx: Executor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);
}

/** Step 2: the current head's `row_hash`, or `undefined` for an empty log. */
export async function readAuditChainHeadHash(
  tx: Executor,
): Promise<string | undefined> {
  const headResult = await tx.execute<{ row_hash: string }>(
    sql`SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1`,
  );
  return headResult.rows[0]?.row_hash;
}

/** Step 3: one `now()` read in the hashable ISO form and the insertable text form. */
export async function readDatabaseNow(tx: Executor) {
  const nowResult = await tx.execute<{ now_iso: string; now_text: string }>(
    sql`SELECT
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now_iso,
        now()::text AS now_text`,
  );
  return nowResult.rows[0];
}

export type AuditRowInsert = {
  id: string;
  actorId: string | null;
  actorType: string;
  apiKeyId: string | null;
  impersonatorId: string | null;
  actorIp: string | null;
  userAgent: string | null;
  traceId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  organisationId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** `JSON.stringify` text or `null`; bound as text and cast to `jsonb`. */
  beforeJson: string | null;
  afterJson: string | null;
  /** The clock text read by `readDatabaseNow`, inserted as `timestamptz`. */
  createdAtText: string;
  prevHash: string;
  rowHash: string;
};

/** Step 5: the insert; returns the new row's id and seq. */
export async function insertAuditRow(tx: Executor, row: AuditRowInsert) {
  const insertResult = await tx.execute<{
    id: string;
    seq: string;
  }>(
    sql`
        INSERT INTO audit_log (
          id, actor_id, actor_type, api_key_id, impersonator_id, actor_ip, user_agent,
          trace_id, workspace_id, project_id, organisation_id, action, entity_type,
          entity_id, before, after, created_at, prev_hash, row_hash
        ) VALUES (
          ${row.id}, ${row.actorId}, ${row.actorType}, ${row.apiKeyId},
          ${row.impersonatorId}, ${row.actorIp},
          ${row.userAgent}, ${row.traceId},
          ${row.workspaceId}, ${row.projectId},
          ${row.organisationId},
          ${row.action}, ${row.entityType}, ${row.entityId},
          ${row.beforeJson}::jsonb, ${row.afterJson}::jsonb,
          ${row.createdAtText}::timestamptz, ${row.prevHash}, ${row.rowHash}
        )
        RETURNING id, seq
      `,
  );
  return insertResult.rows[0];
}
