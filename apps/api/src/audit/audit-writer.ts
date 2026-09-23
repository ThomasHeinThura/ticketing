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
 * `AU-2`: "Secret values are never recorded. A plugin configuration change records
 * which keys changed, never what they changed to." This is fundamentally a caller
 * responsibility -- the writer cannot know what a caller's field means -- but as a
 * best-effort, fail-closed backstop this scans `before`/`after`, recursively through
 * every nested object and array, for a KEY that looks like a secret's name, and refuses
 * to write rather than silently persist what a matching key maps to. This is a
 * heuristic, not a proof: it cannot catch a secret placed under an innocuously-named
 * key, and a caller MUST NOT rely on it as the only control -- `audit-trail.md`'s own
 * "which keys changed, never what they changed to" is the real contract callers must
 * uphold by construction.
 *
 * **Rewritten (Opus security review of PR #291, S6)** from a single case-insensitive
 * substring regex, which the reviewer showed was both bypassable and prone to false
 * positives that would silently drop a legitimate audit row under `AU-14`'s "the
 * mutation still succeeds" rule once wiring lands:
 * - `{password: ["hunter2"]}` bypassed the old check entirely -- it only compared
 *   `typeof member === "string"`, so an array or object VALUE under a matching key was
 *   never checked at all, only recursed into (for its OWN nested keys).
 * - `{token: 123456}` (a numeric OTP) bypassed it for the same reason -- a number is
 *   never a string.
 * - `{apiKeyId: "key_123"}`, `{secretRotatedAt: "..."}` and `{tokenExpiresAt: "..."}`
 *   were all wrongly refused -- exactly the shapes `api_key.created` and
 *   `webhook.secret_rotated`'s own catalogue entries (`actions.ts`) would need to
 *   record once wired, since the substring match saw "secret"/"token" inside a
 *   perfectly ordinary metadata field name.
 *
 * The fix: split each key into normalised segments (`apiKeyId` -> `["api","key","id"]`,
 * `secret_rotated_at` -> `["secret","rotated","at"]`) and match WHOLE segments, never
 * substrings -- `secretRotatedAt` no longer matches merely because the six characters
 * "secret" appear inside it. A key whose LAST segment is `id`, `at` or `count` is
 * exempt outright (Opus: "*Id, *At and *Count suffixes are exempt") -- those name
 * metadata ABOUT a secret (when it rotates, its identifier, how many exist), never the
 * secret's own value, and are exactly the audit action catalogue's own `after` shapes
 * for `api_key.created`/`webhook.secret_rotated`. Once past that exemption, a match on
 * ANY remaining segment (or an adjacent compound pair -- `api`+`key`, `private`+`key`,
 * and so on) refuses the write for ANY non-null value the key maps to -- a string, a
 * number, a boolean, an array or an object -- not only a non-empty string, since
 * `{token: 123456}` and `{password: ["hunter2"]}` are exactly as much a secret leak as
 * a plain string one.
 *
 * `docs/03-features/audit-trail.md`'s AU-2 does not itself name a list of secret-like
 * segments -- checked, it says only "secret values are never recorded" with the one
 * plugin-configuration example. Per this PR's own remediation instructions, the segment
 * list below is chosen conservatively (covering every case the security review actually
 * demonstrated, plus the same-shaped near-misses a reviewer would try next) and is
 * written into AU-2 itself in the same change, rather than left as an undocumented
 * implementation detail only this file knows about.
 */
const SECRET_WHOLE_SEGMENTS = new Set([
  "password",
  "secret",
  "token",
  "credential",
  "credentials",
  "pwd",
  "passphrase",
  "authorization",
  "authorisation",
]);

/** Adjacent-segment pairs that are secret-shaped together even though neither half is
 * on its own (`key` alone would false-positive on `sortKey`/`primaryKey`/`foreignKey`,
 * so it is never a whole-segment trigger by itself -- only paired with one of these). */
const SECRET_COMPOUND_SEGMENT_PAIRS = new Set([
  "api|key",
  "private|key",
  "encryption|key",
  "signing|key",
  "access|token",
  "client|secret",
]);

/** A key ending in one of these segments names metadata ABOUT a value (when it
 * happened, its own identifier, how many), never the value itself -- exempt
 * unconditionally, regardless of what any earlier segment matches. */
const EXEMPT_LAST_SEGMENTS = new Set(["id", "at", "count"]);

/** Splits a key into lowercase segments on `camelCase`, `snake_case` and `kebab-case`
 * boundaries alike -- `apiKeyId` and `api_key_id` both become `["api","key","id"]`, so
 * matching is insensitive to whichever convention a given caller's payload happens to
 * use. */
function keySegments(key: string): string[] {
  return (
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      // `.` splits a dotted path (Opus security review of PR #291, delta round: "the
      // natural shape of a plugin-configuration diff, such as smtp.password, which is
      // exactly AU-2's own example") -- `smtp.password`/`auth.password` must match
      // exactly the same way `smtp_password`/`authPassword` already do.
      .split(/[_\-.\s]+/)
      .filter((segment) => segment.length > 0)
      .map((segment) => segment.toLowerCase())
  );
}

function isSecretShapedKey(key: string): boolean {
  const segments = keySegments(key);
  if (segments.length === 0) {
    return false;
  }
  const lastSegment = segments[segments.length - 1];
  if (lastSegment !== undefined && EXEMPT_LAST_SEGMENTS.has(lastSegment)) {
    return false;
  }
  if (segments.some((segment) => SECRET_WHOLE_SEGMENTS.has(segment))) {
    return true;
  }
  for (let i = 0; i < segments.length - 1; i++) {
    if (
      SECRET_COMPOUND_SEGMENT_PAIRS.has(`${segments[i]}|${segments[i + 1]}`)
    ) {
      return true;
    }
  }
  return false;
}

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
      if (isSecretShapedKey(key) && member !== null) {
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
 * Appends one row to `audit_log`. Runs every step below inside ONE transaction on ONE
 * session: when `dbOrTx` is an already-open caller transaction, that means a nested
 * `SAVEPOINT` on the caller's own session; when `dbOrTx` is the root `db`, this
 * function deliberately opens a real transaction of its own (see the comment right
 * before `dbOrTx.transaction(...)` below for why that self-opened transaction is
 * required, not incidental). `AU-15`/`data-model.md`'s "The audit hash chain":
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

  // S7 (Opus security review of PR #291, delta round at a800c08): a residual of S2's
  // class, found after S2's own fix landed. `canonicalJson` (packages/domain) renders
  // an ARRAY HOLE (`const a = []; a[1] = 1`) as `[,1]` -- `Array.prototype.map` skips
  // holes and `join` renders one as the empty string -- while `JSON.stringify`, which
  // this writer binds for storage, renders the SAME array as `[null,1]`. The row would
  // store something other than what was hashed: an untampered row whose `row_hash`
  // could never again match what `verifyAuditChain` recomputes, on an append-only table
  // that can never be repaired, permanently hiding any real tampering after it (the
  // exact same consequence S1 and S2 both had). This is the THIRD time this class of
  // bug has appeared (a stale-Date read in an earlier draft, S2's raw-string binding,
  // now this), so the fix here is structural, not one more special case: normalise
  // `before`/`after` to their OWN round-tripped JSON form exactly once, right here, and
  // use that SAME normalised value for both the hash and the stored bytes from this
  // point on. `JSON.stringify` already collapses a hole to `null` (matching what it
  // will store either way), so after this line nothing can reach `canonicalRowHash`
  // that does not ALSO reach the INSERT below -- the whole class of "hashed one thing,
  // stored another" is closed by construction, not by enumerating more shapes.
  // `JSON.stringify` throwing on a genuinely non-serialisable value (a `BigInt` member)
  // is the same throw-before-any-SQL behaviour this function already had, preserved
  // here rather than removed.
  const normalizedBefore =
    before === null ? null : (JSON.parse(JSON.stringify(before)) as JsonValue);
  const normalizedAfter =
    after === null ? null : (JSON.parse(JSON.stringify(after)) as JsonValue);

  assertNoObviousSecret(normalizedBefore, "before");
  assertNoObviousSecret(normalizedAfter, "after");

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
        before: normalizedBefore,
        after: normalizedAfter,
        createdAt: nowRow.now_iso,
      },
      prevHash,
    );

    // Step 5. `before`/`after` are bound as EXPLICIT `JSON.stringify(...)` text, cast
    // to `::jsonb` -- never the raw JS value (Opus security review of PR #291, S2).
    // `node-postgres` only JSON-encodes a plain object/array parameter; a JS STRING is
    // sent verbatim as text and then *parsed* as JSON by the `::jsonb` cast, so a
    // top-level string like `"123"`, `"null"` or `'{"a":1}'` was silently stored as a
    // jsonb number/null/object instead of the JSON string `canonicalRowHash` actually
    // hashed -- an untampered row whose stored `row_hash` could never again match what
    // `verifyAuditChain` recomputes from it. A top-level array fared worse: drizzle's
    // `sql` template expands a JS array into a `($1, $2, ...)` parameter list, not one
    // value, so `after: [1, 2]` raised a raw SQL syntax error rather than writing
    // anything. `beforeJson`/`afterJson` below (a `null` SQL parameter for a `null`
    // `before`/`after`, `JSON.stringify(value)` otherwise) send exactly the JSON text
    // `canonicalJson`/`canonicalRowHash` computed the hash over, for every top-level
    // shape a `JsonValue` can be, not only objects.
    const id = createId();
    const beforeJson =
      normalizedBefore === null ? null : JSON.stringify(normalizedBefore);
    const afterJson =
      normalizedAfter === null ? null : JSON.stringify(normalizedAfter);
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
          ${beforeJson}::jsonb, ${afterJson}::jsonb,
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
