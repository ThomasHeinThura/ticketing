import type { JsonValue } from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  desc,
  eq,
  exists,
  gte,
  isNull,
  like,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  currentInstanceAdminPredicate,
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";
import {
  auditLogTable,
  projectTable,
  workspaceTable,
} from "../database/schema";
import { AUDIT_CHAIN_LOCK_KEY } from "./lock";

/**
 * Query ownership for the audit log (issue #580): actor-facing list reads scope from
 * resolved identity in SQL; chain verification remains a global AU-15 integrity scan.
 * Every function awaits and returns plain rows. The append path's
 * statements all run on the writer's single transaction handle in the same order
 * (lock, head read, clock read, insert), and the transaction boundary stays in
 * `audit-writer.ts`.
 */

export type AuditQuery = {
  readonly limit: number;
  readonly action?: string | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
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
    query.entityType === undefined
      ? undefined
      : eq(auditLogTable.entityType, query.entityType),
    query.entityId === undefined
      ? undefined
      : eq(auditLogTable.entityId, query.entityId),
  ];
}

function combineFilters(filters: (SQL | undefined)[]): SQL | undefined {
  const defined = filters.filter((f): f is SQL => f !== undefined);
  return defined.length === 0 ? undefined : and(...defined);
}

/** Every audit row matching the filters, newest first (instance administrators). */
export async function listInstanceAuditRows(
  identity: ResolvedIdentity,
  query: AuditQuery,
  executor?: Executor,
) {
  const tx = executorOrDefault(executor);
  // AU-11 is explicitly instance-wide for instance administrators. The route separately
  // enforces `instance:read_audit` (including a key's stored scope); this SQL predicate
  // revalidates the current persisted administrator relation without requiring the key's
  // narrowed capability subset to contain `instance:admin`.
  const rows = await tx
    .select()
    .from(auditLogTable)
    .where(
      combineFilters([
        currentInstanceAdminPredicate(identity, tx),
        ...auditListFilters(query),
      ]),
    )
    .orderBy(desc(auditLogTable.seq))
    .limit(query.limit);
  return materializeAuditRows(rows);
}

/**
 * One workspace's audit rows, newest first. The workspace filter is unconditional; the
 * project filter is `project_id IS NULL`, plus `project_id IN (ids)` when the caller
 * reaches any project, or no project constraint for `"all"`.
 */
export async function listWorkspaceAuditRows(
  identity: ResolvedIdentity,
  workspaceId: string,
  query: AuditQuery,
  executor?: Executor,
) {
  const tx = executorOrDefault(executor);
  const auditProject = alias(projectTable, "audit_scope_project");
  const anyReachableProject = exists(
    tx
      .select({ one: sql`1` })
      .from(auditProject)
      .where(
        and(
          eq(auditProject.id, auditLogTable.projectId),
          eq(auditProject.workspaceId, workspaceId),
          currentProjectReachPredicate(
            identity,
            auditProject.id,
            auditProject.workspaceId,
            auditProject.organisationId,
            tx,
          ),
        ),
      ),
  );
  const rowReach =
    identity.side === "staff"
      ? or(isNull(auditLogTable.projectId), anyReachableProject)
      : sql`false`;
  const rows = await tx
    .select()
    .from(auditLogTable)
    .where(
      combineFilters([
        eq(auditLogTable.workspaceId, workspaceId),
        exists(
          tx
            .select({ one: sql`1` })
            .from(workspaceTable)
            .where(
              and(
                eq(workspaceTable.id, workspaceId),
                currentWorkspaceReachPredicate(identity, workspaceTable.id, tx),
              ),
            ),
        ),
        rowReach,
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
