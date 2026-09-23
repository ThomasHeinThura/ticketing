/**
 * `audit-verify` -- `AU-15`: "walks the chain, so alteration by a database-level actor
 * is detectable even though the application role holds no UPDATE/DELETE on the table."
 *
 * Issue #37, first slice: only the on-demand walk itself. `audit-purge`/`audit_chain_
 * anchor` do not exist yet (tracked separately, per `data-model.md`'s "Purging" section
 * and `background-jobs.md`'s `audit-purge` row) -- this function always starts from the
 * zero hash, which is correct today (nothing has ever purged) and will need a real
 * anchor lookup added when `audit-purge` lands, not before.
 */
import { canonicalRowHash, type JsonValue, ZERO_HASH } from "@taskdesk/domain";
import { sql } from "drizzle-orm";
import type db from "../database";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AuditChainBreak {
  id: string;
  seq: bigint;
  expectedPrevHash: string;
  actualPrevHash: string;
  reason: "prev_hash_mismatch" | "row_hash_mismatch" | "sequence_gap";
}

export interface VerifyAuditChainResult {
  ok: boolean;
  rowsChecked: number;
  firstBreak: AuditChainBreak | null;
}

interface AuditLogChainRow {
  [key: string]: unknown;
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
}

/**
 * Walks `audit_log` in `seq` order and recomputes every row's `row_hash` from its own
 * stored columns, using exactly the same recipe `appendAuditLog` used to write it
 * (`canonicalRowHash`, `created_at` read back via the same `to_char(... AT TIME ZONE
 * 'UTC', ...)` expression -- never through the lossy `timestamptz` -> `Date` driver
 * path). Returns the first row where either:
 *
 *   - this row's stored `prev_hash` does not equal the previous row's `row_hash` (or
 *     `ZERO_HASH` for the first row) -- the chain pointer was altered or a row is
 *     missing/reordered; or
 *   - this row's stored `row_hash` does not equal the hash recomputed from its own
 *     content -- the row's own data was altered after being written.
 *
 * A gap in `seq` (a row deleted -- which the `audit_log_append_only` trigger should
 * make impossible through the API, but this function must still detect it if it
 * somehow happens, e.g. a superuser bypassing the trigger) is reported as its own break
 * reason rather than silently reindexing around the hole, since a missing row breaks
 * the very `prev_hash` pointer it was in the middle of.
 */
export async function verifyAuditChain(
  dbOrTx: DbOrTx,
): Promise<VerifyAuditChainResult> {
  const result = await dbOrTx.execute<AuditLogChainRow>(
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

  let expectedPrevHash = ZERO_HASH;
  let expectedSeq: bigint | null = null;
  let rowsChecked = 0;

  for (const row of result.rows) {
    const seq = BigInt(row.seq);

    if (expectedSeq !== null && seq !== expectedSeq) {
      return {
        ok: false,
        rowsChecked,
        firstBreak: {
          id: row.id,
          seq,
          expectedPrevHash,
          actualPrevHash: row.prev_hash,
          reason: "sequence_gap",
        },
      };
    }

    if (row.prev_hash !== expectedPrevHash) {
      return {
        ok: false,
        rowsChecked,
        firstBreak: {
          id: row.id,
          seq,
          expectedPrevHash,
          actualPrevHash: row.prev_hash,
          reason: "prev_hash_mismatch",
        },
      };
    }

    const recomputed = canonicalRowHash(
      {
        actorId: row.actor_id,
        actorType: row.actor_type,
        apiKeyId: row.api_key_id,
        impersonatorId: row.impersonator_id,
        actorIp: row.actor_ip,
        userAgent: row.user_agent,
        traceId: row.trace_id,
        workspaceId: row.workspace_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        before: row.before,
        after: row.after,
        createdAt: row.created_at_iso,
      },
      row.prev_hash,
    );

    rowsChecked += 1;

    if (recomputed !== row.row_hash) {
      return {
        ok: false,
        rowsChecked,
        firstBreak: {
          id: row.id,
          seq,
          expectedPrevHash: row.prev_hash,
          actualPrevHash: row.row_hash,
          reason: "row_hash_mismatch",
        },
      };
    }

    expectedPrevHash = row.row_hash;
    expectedSeq = seq + 1n;
  }

  return { ok: true, rowsChecked, firstBreak: null };
}
