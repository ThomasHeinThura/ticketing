/**
 * The audit hash chain and point-in-time work item reconstruction — pure functions, no
 * I/O, no ambient clock, no database. `docs/01-architecture/data-model.md` § "The audit
 * hash chain" (§11) is `canonicalRowHash`'s single source for the exact recipe, read in
 * full rather than from any paraphrase — including `AU-15`'s own summary of it in
 * `docs/03-features/audit-trail.md`, which disagrees with §11 on one point; see the note
 * directly above `canonicalRowHash`. `AU-8` and `data-model.md` §4's `activity` table are
 * the source for `reconstructAt`.
 *
 * The impure edge (`apps/api`) is everything this module deliberately does not do:
 * `pg_advisory_xact_lock`, the actual `audit_log` insert, reading the chain's current
 * head to pass as `prevHash`, `audit-verify`'s live chain walk against the database, and
 * formatting a Postgres `timestamptz` into the microsecond-precision string
 * `AuditLogRow.createdAt` requires (see that type's own doc comment in `types.ts`).
 */

import { createHash } from "node:crypto";
import type {
  ActivityRow,
  AuditLogRow,
  JsonValue,
  WorkItemSnapshot,
} from "./types.js";

// ---------------------------------------------------------------------------
// The audit hash chain (AU-15, data-model.md § "The audit hash chain").
// ---------------------------------------------------------------------------

/** The record-separator byte the hash recipe joins fields with (`\x1e`, ASCII 30). */
const FIELD_SEPARATOR = "\x1e";

/**
 * `prev_hash` of the first row in a chain (`AU-15`: "the first row chains from the zero
 * hash"; `data-model.md` §11: "`prev_hash` of the first row is the zero hash"). Neither
 * document spells out the literal value, so this module picks the one unambiguous,
 * conventional reading: 64 lowercase hex `0` characters — the same shape as any other
 * `prev_hash`/`row_hash` in this chain (a SHA-256 digest is 32 bytes, rendered as 64 hex
 * characters), but a value a real SHA-256 output can never actually produce, so it can
 * never collide with a genuine computed hash. This is the same convention Git uses for
 * its null OID and hash-chained logs generally use for a "genesis" sentinel. Recorded in
 * the decision log (2026-09-16, "The audit hash chain's zero hash is 64 hex 0 characters")
 * — any future independent chain-verification implementation must use this exact literal.
 */
export const ZERO_HASH = "0".repeat(64);

/**
 * Shape a valid `prevHash` must have: exactly 64 lowercase hex characters — a genuine
 * SHA-256 digest, or `ZERO_HASH`. Enforced by `canonicalRowHash` (Opus security review of
 * PR #175, finding S-2): `prevHash` is field 1 of the joined canonical form, and before
 * this guard existed it accepted any string at all, including one containing
 * `FIELD_SEPARATOR` itself.
 */
const PREV_HASH_PATTERN = /^[0-9a-f]{64}$/;

function textOrEmpty(value: string | null): string {
  return value ?? "";
}

/**
 * S-2 remediation (Opus security review of PR #175, "The `\x1e` join is not injective —
 * demonstrated row-hash collision"). `canonicalRowHash` joins its fifteen fields with a
 * single `FIELD_SEPARATOR` (`\x1e`); that join is only unambiguous if no individual field
 * can itself contain the separator byte. Nothing about a `text` column, a CUID2 shape, or
 * this module's own types rules that out — `\x1e` is a plain ASCII control character
 * (0x1E) — so two rows that differ only in *where* a `\x1e` falls (e.g. inside
 * `userAgent` vs sitting at the `userAgent`/`traceId` boundary) previously joined to the
 * exact same byte string and hashed identically. The reviewer demonstrated this concretely
 * with a real `userAgent`/`traceId` collision.
 *
 * Rejecting `\x1e` outright is strictly *stronger* than `data-model.md` §11's recipe, not
 * a deviation from it — §11 never says what a separator-bearing field should mean, and no
 * legitimate value in any of these columns (ids, ips, user agents, trace ids, an audit
 * action key) is ever expected to contain a raw ASCII record-separator control character.
 * `before`/`after` need no equivalent guard: RFC 8785 (via `JSON.stringify`) always
 * escapes `\x1e` as the six-character sequence `\u001e` inside a JSON string, so those two
 * fields can never place a raw `\x1e` byte into the joined form in the first place —
 * confirmed in the reviewer's own "what I confirmed clean" pass over string escaping.
 */
function assertNoRecordSeparator(fieldName: string, value: string): void {
  if (value.includes(FIELD_SEPARATOR)) {
    throw new Error(
      `canonicalRowHash: ${fieldName} contains the record-separator byte (\\x1e, ASCII 30), ` +
        "which would make the \\x1e-joined canonical form ambiguous across a field " +
        "boundary — two different rows could join to the same byte string and collide on " +
        "row_hash. Refusing to hash rather than silently producing an ambiguous digest.",
    );
  }
}

/**
 * RFC 8785 (JCS) canonicalization of one JSON value, built entirely from
 * `JSON.stringify` and native string/array sorting — no new dependency. Object keys are
 * sorted with JS's default string comparator, which compares UTF-16 code units exactly
 * the way JCS's key-ordering rule (RFC 8785 §3.2.3) requires; string serialization is
 * delegated to `JSON.stringify`, which already implements RFC 8259 string escaping (which
 * JCS §3.2.2.2 defers to verbatim).
 *
 * **Numbers and non-plain objects are guarded explicitly, not delegated blindly** (Opus
 * security review of PR #175, findings S-1 and S-3 — this doc comment previously claimed
 * a `jsonb` column "cannot hold `NaN`/`Infinity`", which is true only of the *literal*
 * tokens. Postgres `jsonb` numbers are arbitrary-precision `numeric`, and `pg` decodes
 * them with `JSON.parse`; a `jsonb` value like `1e400` — which Postgres stores and returns
 * exactly — arrives here as the JS value `Infinity`, and `JSON.stringify(Infinity)` is the
 * *string* `"null"`, byte-identical to an actual JSON `null`. An unbounded set of distinct
 * `jsonb` numbers would otherwise collapse to one canonical form. **S-1: throw on any
 * non-finite number** (`!Number.isFinite`) rather than silently rendering it as `null` —
 * this function operates on already-persisted, already-validated audit rows (see the
 * module doc comment), so a non-finite number reaching here means something upstream
 * failed to validate before writing the row; that is a bug to surface loudly, not paper
 * over. Deliberately **not** a `Number.isSafeInteger` check: values like `1e+21`, `1e+30`
 * and `5e-324` are outside `Number.MAX_SAFE_INTEGER` but are exact, legitimate IEEE-754
 * doubles that `jsonb` can hold and round-trip losslessly through `JSON.parse` — rejecting
 * them would be a false positive, not a fix. (A `jsonb` integer that lost precision
 * *within* double range before ever reaching this function — e.g. `9007199254740993`
 * silently becoming `9007199254740992` inside the driver's own `JSON.parse` — is not
 * detectable here at all: by the time the value is a JS number, both are the same double.
 * That is an accepted residual of representing `jsonb` numbers as JS `number`, tracked as
 * a known limitation rather than something `canonicalJson` can fix after the fact.)
 *
 * **S-3: throw on any non-plain object**, rather than falling through to `Object.keys()`
 * and silently emitting `{}`. `JsonValue` forbids anything but a plain object/array/
 * primitive at the type level, but TypeScript is erased at runtime — a real caller may
 * pass an ORM row value where a `jsonb`-adjacent field is actually a `Date`, `Map` or
 * `Set` instance rather than a plain value, and two different `Date`s previously both
 * canonicalized to `{}` and hashed identically. Fail closed instead: a non-plain object is
 * a caller bug, not a value this function should silently degrade.
 */
function canonicalJson(value: JsonValue): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `canonicalJson: refusing to canonicalize a non-finite number (${String(value)}) — ` +
          "a jsonb column can hold a numeric value outside the IEEE-754 double range " +
          "(e.g. 1e400), which the driver decodes via JSON.parse into Infinity/-Infinity; " +
          'JSON.stringify(Infinity) is the string "null", indistinguishable from an actual ' +
          "jsonb null. Silently coercing would let an unbounded set of distinct values " +
          "collapse to one canonical form.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(
      "canonicalJson: refusing to canonicalize a non-plain object (prototype is " +
        `${proto?.constructor?.name ?? String(proto)}, not Object.prototype or null) — ` +
        "e.g. a Date, Map or Set reached this function instead of a plain jsonb-shaped " +
        "value. Object.keys() on such a value silently returns [], which would render as " +
        '"{}" and make every such value hash identically.',
    );
  }
  const keys = Object.keys(value).sort();
  const members = keys.map((key) => {
    // biome-ignore lint/style/noNonNullAssertion: key comes from Object.keys(value)
    const memberValue = value[key]!;
    return `${JSON.stringify(key)}:${canonicalJson(memberValue)}`;
  });
  return `{${members.join(",")}}`;
}

/** `before`/`after`: "a null jsonb is the empty string" (`data-model.md` § the audit hash chain). */
function jsonFieldOrEmpty(value: JsonValue | null): string {
  return value === null ? "" : canonicalJson(value);
}

/**
 * `row_hash` — SHA-256 over the canonical form `data-model.md` §11 defines once: exactly
 * these fields, in exactly this order, each rendered as below and joined with
 * `FIELD_SEPARATOR`, digested and rendered as lowercase hex:
 *
 * `prev_hash`, `created_at`, `actor_id`, `actor_type`, `api_key_id`, `impersonator_id`,
 * `actor_ip`, `user_agent`, `trace_id`, `workspace_id`, `action`, `entity_type`,
 * `entity_id`, `before`, `after`.
 *
 * `created_at` is used exactly as supplied (already microsecond-precision UTC ISO-8601,
 * see `AuditLogRow`'s doc comment); `before`/`after` are RFC 8785 canonical JSON, or the
 * empty string when SQL `NULL`; every other listed column is its raw UTF-8 text, or the
 * empty string when SQL `NULL` — deliberately making `NULL` and `""` indistinguishable in
 * the hash for those columns, per `data-model.md`'s own note ("no audit column
 * distinguishes them semantically").
 *
 * **A discrepancy between the two specs, resolved in `data-model.md`'s favour.**
 * `audit-trail.md`'s `AU-15` prose reads "... excluded — including `prev_hash`", which
 * taken literally would exclude `prev_hash` from the hash. `data-model.md` §11's own
 * "Hash input" list is explicit and unambiguous: it names `prev_hash` as the *first*
 * field hashed, and states only `organisation_id` (plus, implicitly, `row_hash` itself,
 * the function's own output) is excluded — never `prev_hash`. Without a `prev_hash` in
 * the hash, tampering with an intermediate row's `prev_hash` pointer would be
 * undetectable while every row's own `row_hash` still verified, which would defeat the
 * chain's entire purpose, so `data-model.md` §11's explicit column list is also the only
 * one of the two readings that makes the mechanism work. This function follows §11, per
 * this task's own instruction to treat it as the single authoritative source rather than
 * a paraphrase. Flagged in the pull request description for confirmation, not silently
 * resolved.
 *
 * `prevHash` is a separate parameter rather than a field on `row` — see `AuditLogRow`'s
 * doc comment for why. Use `ZERO_HASH` for the first row in a chain.
 *
 * **Injectivity guards (Opus security review of PR #175, S-2).** The thirteen non-JSON
 * fields above (`prevHash` plus the twelve plain-text `AuditLogRow` columns) must each be
 * free of the `\x1e` separator byte for the `\x1e`-joined form to be unambiguous — see
 * `assertNoRecordSeparator`'s doc comment. `prevHash` additionally must match
 * `PREV_HASH_PATTERN` (64 lowercase hex characters): it is field 1, and an unvalidated
 * `prevHash` could otherwise smuggle a separator, or any other content, into the joined
 * string ahead of every other field. Both guards throw rather than silently hashing an
 * ambiguous input; per `data-model.md` §11, they are a corrigendum to the canonical form
 * itself, not an implementation-local choice (see the same note added there).
 */
export function canonicalRowHash(row: AuditLogRow, prevHash: string): string {
  if (!PREV_HASH_PATTERN.test(prevHash)) {
    throw new Error(
      "canonicalRowHash: prevHash must be exactly 64 lowercase hex characters (a SHA-256 " +
        "digest, or ZERO_HASH for the first row in a chain) — refusing to hash an " +
        "unvalidated prevHash, since it is field 1 of the joined canonical form.",
    );
  }

  const actorId = textOrEmpty(row.actorId);
  const actorType = textOrEmpty(row.actorType);
  const apiKeyId = textOrEmpty(row.apiKeyId);
  const impersonatorId = textOrEmpty(row.impersonatorId);
  const actorIp = textOrEmpty(row.actorIp);
  const userAgent = textOrEmpty(row.userAgent);
  const traceId = textOrEmpty(row.traceId);
  const workspaceId = textOrEmpty(row.workspaceId);

  assertNoRecordSeparator("createdAt", row.createdAt);
  assertNoRecordSeparator("actorId", actorId);
  assertNoRecordSeparator("actorType", actorType);
  assertNoRecordSeparator("apiKeyId", apiKeyId);
  assertNoRecordSeparator("impersonatorId", impersonatorId);
  assertNoRecordSeparator("actorIp", actorIp);
  assertNoRecordSeparator("userAgent", userAgent);
  assertNoRecordSeparator("traceId", traceId);
  assertNoRecordSeparator("workspaceId", workspaceId);
  assertNoRecordSeparator("action", row.action);
  assertNoRecordSeparator("entityType", row.entityType);
  assertNoRecordSeparator("entityId", row.entityId);

  const fields = [
    prevHash,
    row.createdAt,
    actorId,
    actorType,
    apiKeyId,
    impersonatorId,
    actorIp,
    userAgent,
    traceId,
    workspaceId,
    row.action,
    row.entityType,
    row.entityId,
    jsonFieldOrEmpty(row.before),
    jsonFieldOrEmpty(row.after),
  ];
  return createHash("sha256")
    .update(fields.join(FIELD_SEPARATOR), "utf8")
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Point-in-time reconstruction (AU-8, AU-9).
// ---------------------------------------------------------------------------

/**
 * Chronological order for `reconstructAt`'s fold: ascending `createdAt`, ties broken by
 * ascending `sequence` — an opaque, caller-supplied monotonic key, compared only for
 * ordering and never interpreted as meaningful data. This function does not care where
 * `sequence` comes from, only that it is a real total order over rows sharing one
 * `createdAt` instant.
 *
 * **What `sequence` may actually be backed by, corrected (Opus security review of PR
 * #175, S-4).** The decision-log entry this replaced described `sequence` as standing in
 * for "Postgres's real auto-increment `activity.id`" — but `data-model.md`'s own
 * Conventions rule is explicit: "Primary keys are CUID2 text. Primary keys and surrogate
 * ids are never sequential", and `activity`'s column list (§4) names no auto-increment
 * column. There is no such thing in this schema for `sequence` to stand in for. Nor can a
 * CUID2 `id` substitute: this codebase's `createId()` (`@paralleldrive/cuid2`) derives
 * each id from `sha3-512(timestamp + salt + counter + fingerprint)` — a cryptographic
 * hash, deliberately chosen (per the library's own documented design goal, "k-sortable =
 * insecure") so the output carries no correlation to insertion order at all. See the
 * decision log's superseding entry for what a real ordering signal for this tie-break
 * would have to be, since neither of those two candidates works.
 */
function compareActivityRows(a: ActivityRow, b: ActivityRow): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  return a.sequence - b.sequence;
}

/**
 * A work item's field-level state at `at`, folded from `activityRows` (`AU-8`:
 * "Reconstruction is a domain function over activity rows, not a stored snapshot" — "a
 * pure fold over a list, `at` supplied explicitly", never computed internally as "now").
 *
 * Rows are sorted by `createdAt`, ties broken by `sequence` (`compareActivityRows`), then
 * folded in that order: each row with a non-null `field` overwrites that field's value
 * with its `newValue`, up to and including `at`. A `type_id` change (work item type
 * change) or a `project_id` change (project move) is folded exactly like any other field
 * change — `data-model.md` and `audit-trail.md` name neither as a special case when read
 * against this function's contract, and none is needed: the reconstructed state for a
 * field is simply whatever the last field-change row at or before `at` says it held.
 *
 * **Before creation: `null`, not a thrown error.** Neither spec pins this down; this is
 * this module's documented choice. "Creation" is, for this function, defined
 * operationally as the earliest `createdAt` among the rows the caller supplies — callers
 * are expected to pass every `activity` row for one work item, including its initial
 * `created` row, so this coincides with the item's real creation instant in practice; the
 * function itself never looks for a `created` verb, because `ActivityRow` does not carry
 * `verb` (see `types.ts`). An empty `activityRows` list also returns `null`, for the same
 * reason: with no rows at all, `at` is trivially before whatever creation instant would
 * exist. `null` (not `undefined`, not a thrown `Error`) matches this package's existing
 * convention for "no computable result" (`nextWindowOpening` in `calendar.ts` returns
 * `Date | null` for the same shape of question).
 */
export function reconstructAt(
  activityRows: ActivityRow[],
  at: Date,
): WorkItemSnapshot | null {
  if (activityRows.length === 0) {
    return null;
  }

  const sorted = [...activityRows].sort(compareActivityRows);
  // biome-ignore lint/style/noNonNullAssertion: sorted has activityRows' length, checked non-empty above
  const earliest = sorted[0]!;

  if (at.getTime() < earliest.createdAt.getTime()) {
    return null;
  }

  const fields: Record<string, string | null> = {};
  for (const row of sorted) {
    if (row.createdAt.getTime() > at.getTime()) {
      // Sorted ascending — nothing from here on can be <= at either.
      break;
    }
    if (row.field !== null) {
      fields[row.field] = row.newValue;
    }
  }

  return { fields };
}
