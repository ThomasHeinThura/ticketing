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

function textOrEmpty(value: string | null): string {
  return value ?? "";
}

/**
 * RFC 8785 (JCS) canonicalization of one JSON value, built entirely from
 * `JSON.stringify` and native string/array sorting — no new dependency. Object keys are
 * sorted with JS's default string comparator, which compares UTF-16 code units exactly
 * the way JCS's key-ordering rule (RFC 8785 §3.2.3) requires; number and string
 * serialization is delegated to `JSON.stringify`, which already implements ECMA-262's
 * `Number::toString` (the same algorithm JCS §3.2.2.3 specifies for numbers, including
 * `-0` rendering as `"0"`) and RFC 8259 string escaping (which JCS §3.2.2.2 defers to
 * verbatim). There is nothing left for a hand-rolled implementation to get wrong that
 * `JSON.stringify` does not already get right, for the value shapes a `jsonb` column can
 * actually hold — no `NaN`, `Infinity`, `undefined` or `BigInt`, none of which `jsonb` can
 * represent, and all of which are the only cases where JCS and `JSON.stringify` could
 * plausibly diverge. See the pull request description for this reasoning, offered instead
 * of adding a JCS library per this task's instruction to flag rather than decide silently.
 */
function canonicalJson(value: JsonValue): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
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
 */
export function canonicalRowHash(row: AuditLogRow, prevHash: string): string {
  const fields = [
    prevHash,
    row.createdAt,
    textOrEmpty(row.actorId),
    textOrEmpty(row.actorType),
    textOrEmpty(row.apiKeyId),
    textOrEmpty(row.impersonatorId),
    textOrEmpty(row.actorIp),
    textOrEmpty(row.userAgent),
    textOrEmpty(row.traceId),
    textOrEmpty(row.workspaceId),
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
 * ascending `sequence` — the tie-break this pull request's decision-log entry records
 * (insertion order, since it is the one secondary signal a database provides for free,
 * and neither `audit-trail.md` nor `data-model.md`'s `activity` table names any other
 * rule).
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
