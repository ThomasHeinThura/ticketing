/**
 * The `audit_log` writer -- the impure edge `packages/domain/src/audit/audit.ts`'s own
 * doc comment names as its counterpart: `pg_advisory_xact_lock`, the actual insert,
 * reading the chain's current head to pass as `prevHash`, and formatting a Postgres
 * `timestamptz` into the microsecond-precision string `canonicalRowHash` requires.
 *
 * Issue #37, first slice: this module exists and is fully tested, but nothing in this
 * PR calls it from a real mutation yet -- that wiring is later scope, per the task that
 * produced this PR ("no routes, no UI, no wiring into mutations").
 *
 * `AU-14`: "If the audit write fails, the mutation still succeeds ... but the failure is
 * never silent." This module only provides `appendAuditLog` itself -- the caller's own
 * transaction is what decides whether an audit-write failure aborts the caller's
 * mutation or not. Making that trade (catch-and-alert vs. propagate) is the wiring
 * work's job, not this module's; it never swallows an error itself.
 */
import { createId } from "@paralleldrive/cuid2";
import { canonicalRowHash, type JsonValue, ZERO_HASH } from "@taskdesk/domain";
import { sql } from "drizzle-orm";
import type db from "../database";
import { AUDIT_ACTIONS_NOT_YET_WIRED, AUDIT_ONLY_ACTIONS } from "./actions";
import { AUDIT_CHAIN_LOCK_KEY } from "./lock";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AuditActorType = "person" | "automation" | "system" | "api_key";

/**
 * One `audit_log` row to append. Every field `data-model.md` S11 lists, minus what the
 * writer itself supplies (`id`, `created_at`, `prev_hash`, `row_hash`, `seq`).
 */
export interface AppendAuditLogInput {
  actorId: string | null;
  actorType: AuditActorType;
  apiKeyId?: string | null;
  impersonatorId?: string | null;
  actorIp?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
  workspaceId?: string | null;
  organisationId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: JsonValue | null;
  after?: JsonValue | null;
}

export interface AuditLogRowResult {
  id: string;
  createdAt: string;
  prevHash: string;
  rowHash: string;
  seq: bigint;
}

/** Edge case table: "Very large before/after payload | Truncated at 64 KB with a
 * marker; the full diff remains in `activity` for work items." The marker itself is a
 * plain JSON object so it round-trips through `canonicalJson` like any other value. */
const MAX_JSON_PAYLOAD_BYTES = 64 * 1024;

function truncateIfOversized(
  value: JsonValue | null | undefined,
): JsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  const serialised = JSON.stringify(value);
  const byteLength = Buffer.byteLength(serialised, "utf8");
  if (byteLength <= MAX_JSON_PAYLOAD_BYTES) {
    return value;
  }
  return {
    __truncated: true,
    reason: "audit_log before/after payload exceeded 64 KB",
    originalSizeBytes: byteLength,
  };
}

/**
 * `AU-2`: "Secret values are never recorded." This is fundamentally a caller
 * responsibility -- the writer cannot know what a caller's field means -- but as a
 * best-effort, fail-closed backstop this scans `before`/`after` for object keys whose
 * name suggests a raw secret (password, token, secret, api key, credential,
 * authorization header) paired with a non-empty string value, and refuses to write
 * rather than silently persist what looks like a credential. This is a heuristic, not a
 * proof: it cannot catch a secret placed under an innocuously-named key, and a caller
 * MUST NOT rely on it as the only control -- `audit-trail.md`'s own example ("a plugin
 * configuration change records which keys changed, never what they changed to") is the
 * real contract callers must uphold by construction.
 */
const SECRET_KEY_PATTERN =
  /(password|secret|token|api[_-]?key|private[_-]?key|credential|authoriz)/i;

function assertNoObviousSecret(
  value: JsonValue | null,
  fieldName: "before" | "after",
): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  const stack: JsonValue[] = [value];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: stack.length > 0 checked above
    const current = stack.pop()!;
    if (Array.isArray(current)) {
      for (const item of current) {
        if (item !== null && typeof item === "object") {
          stack.push(item);
        }
      }
      continue;
    }
    if (current === null || typeof current !== "object") {
      continue;
    }
    for (const [key, member] of Object.entries(current)) {
      if (
        SECRET_KEY_PATTERN.test(key) &&
        typeof member === "string" &&
        member.length > 0
      ) {
        throw new Error(
          `appendAuditLog: refusing to write ${fieldName} -- key "${key}" looks like a ` +
            "secret value (AU-2: secret values are never recorded). Record which keys " +
            "changed, never what they changed to.",
        );
      }
      if (member !== null && typeof member === "object") {
        stack.push(member);
      }
    }
  }
}

function validateAction(action: string): void {
  if (AUDIT_ACTIONS_NOT_YET_WIRED.has(action)) {
    throw new Error(
      `appendAuditLog: action "${action}" is not wired yet -- see apps/api/src/audit/` +
        "actions.ts's doc comment (tracked on #198).",
    );
  }
  if (!AUDIT_ONLY_ACTIONS.has(action)) {
    throw new Error(
      `appendAuditLog: unknown audit action "${action}" -- not in the audit-only ` +
        "catalogue (docs/03-features/audit-trail.md) and this writer does not yet " +
        "validate events.md-keyed domain-event actions (see actions.ts's doc comment). " +
        "This is a programmer error: add the action to its authoritative catalogue " +
        "first (AGENTS.md do-not 11), never call the writer with an unregistered key.",
    );
  }
}

/**
 * Appends one row to `audit_log`, inside the caller's own transaction (`dbOrTx`) --
 * never opens its own. `AU-15`/`data-model.md`'s "The audit hash chain":
 *
 *   1. Take `pg_advisory_xact_lock(AUDIT_CHAIN_LOCK_KEY)` first, in this transaction --
 *      serialises every concurrent `audit_log` insert across the whole instance.
 *   2. Read the current chain head's `row_hash` (`ORDER BY seq DESC LIMIT 1`; `ZERO_HASH`
 *      if the table is empty).
 *   3. Read `now()` once, formatted as the exact microsecond-precision UTC ISO-8601
 *      string the hash recipe requires (bypassing `node-postgres`'s default
 *      `timestamptz` -> JS `Date` parsing, which is only millisecond-precision).
 *   4. Compute this row's `row_hash` via `canonicalRowHash` (the pure function
 *      `packages/domain` already owns), passing the head's hash as `prevHash`.
 *   5. Insert using that SAME `now()` value (never a second, independent `now()` call,
 *      which could tick over to a different microsecond between steps 3 and 5) --
 *      so what was hashed and what is stored can never diverge.
 *
 * Throws (a programmer error, not a recoverable condition) for an unknown/not-yet-wired
 * action, an obvious secret in `before`/`after`, or a record-separator byte
 * `canonicalRowHash` itself refuses. `AU-14` -- whether a caller lets that abort its own
 * mutation or catches it and alerts instead -- is the caller's decision, not this
 * function's.
 */
export async function appendAuditLog(
  dbOrTx: DbOrTx,
  input: AppendAuditLogInput,
): Promise<AuditLogRowResult> {
  validateAction(input.action);

  const before = truncateIfOversized(input.before);
  const after = truncateIfOversized(input.after);
  assertNoObviousSecret(before, "before");
  assertNoObviousSecret(after, "after");

  // Everything below runs inside ONE transaction, on ONE session -- load-bearing, not
  // a style choice. `pg_advisory_xact_lock` is scoped to the session/transaction that
  // takes it; if steps 1-5 below ran as independent statements against a plain `db`
  // (a connection POOL), each could be dispatched to a different pooled connection,
  // in which case the lock would protect nothing at all (proven live: without this
  // wrapper, ten concurrent `appendAuditLog(db, ...)` calls produced a forked chain --
  // duplicate `prev_hash` values -- exactly this bug, caught by this module's own
  // concurrent-append test). `dbOrTx.transaction(...)` is correct whether `dbOrTx` is
  // the root `db` (opens a real `BEGIN`/`COMMIT` on one pooled connection) or an
  // already-open caller transaction (`PgTransaction.transaction` opens a `SAVEPOINT`
  // on that SAME session) -- either way, every statement below shares one session.
  return dbOrTx.transaction(async (tx) => {
    // Step 1: serialise. Single global key -- the chain is per-instance, not
    // per-tenant (data-model.md: "the chain is per-instance and strictly serial").
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`,
    );

    // Step 2: read the current head. `seq` (not `created_at`) is the tie-break-free
    // ordering signal -- see schema.ts's comment on `auditLogTable.seq`.
    const headResult = await tx.execute<{ row_hash: string }>(
      sql`SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1`,
    );
    const prevHash = headResult.rows[0]?.row_hash ?? ZERO_HASH;

    // Step 3: one `now()` read, in both forms this function needs -- the hashable
    // ISO string, and the raw text this same instant will be inserted as (so the
    // INSERT below never calls `now()` again).
    const nowResult = await tx.execute<{ now_iso: string; now_text: string }>(
      sql`SELECT
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now_iso,
        now()::text AS now_text`,
    );
    const nowRow = nowResult.rows[0];
    if (!nowRow) {
      throw new Error(
        "appendAuditLog: could not read the current timestamp from Postgres",
      );
    }

    // Step 4.
    const rowHash = canonicalRowHash(
      {
        actorId: input.actorId,
        actorType: input.actorType,
        apiKeyId: input.apiKeyId ?? null,
        impersonatorId: input.impersonatorId ?? null,
        actorIp: input.actorIp ?? null,
        userAgent: input.userAgent ?? null,
        traceId: input.traceId ?? null,
        workspaceId: input.workspaceId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before,
        after,
        createdAt: nowRow.now_iso,
      },
      prevHash,
    );

    // Step 5. `before`/`after` are bound as plain JS values with an explicit
    // `::jsonb` cast -- `pg` (node-postgres) JSON.stringifies a plain object/array
    // parameter automatically, so no manual string-escaping is needed or attempted
    // here.
    const id = createId();
    const insertResult = await tx.execute<{
      id: string;
      seq: string;
    }>(
      sql`
        INSERT INTO audit_log (
          id, actor_id, actor_type, api_key_id, impersonator_id, actor_ip, user_agent,
          trace_id, workspace_id, organisation_id, action, entity_type, entity_id,
          before, after, created_at, prev_hash, row_hash
        ) VALUES (
          ${id}, ${input.actorId}, ${input.actorType}, ${input.apiKeyId ?? null},
          ${input.impersonatorId ?? null}, ${input.actorIp ?? null},
          ${input.userAgent ?? null}, ${input.traceId ?? null},
          ${input.workspaceId ?? null}, ${input.organisationId ?? null},
          ${input.action}, ${input.entityType}, ${input.entityId},
          ${before}::jsonb, ${after}::jsonb,
          ${nowRow.now_text}::timestamptz, ${prevHash}, ${rowHash}
        )
        RETURNING id, seq
      `,
    );

    const row = insertResult.rows[0];
    if (!row) {
      throw new Error("appendAuditLog: insert into audit_log returned no row");
    }
    return {
      id: row.id,
      createdAt: nowRow.now_iso,
      prevHash,
      rowHash,
      seq: BigInt(row.seq),
    };
  });
}
