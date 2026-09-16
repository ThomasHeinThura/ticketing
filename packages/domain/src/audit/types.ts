/**
 * Audit hash chain and point-in-time reconstruction — pure data types.
 *
 * `AuditLogRow` mirrors exactly the ordered column list `data-model.md`'s "The audit hash
 * chain" section (§11) names as the SHA-256 input for `audit_log.row_hash` — not the full
 * `audit_log` table. `row_hash` itself is the function's own output (never an input),
 * `organisation_id` is explicitly excluded by that section ("`organisation_id` is excluded
 * from the hash, and so is every other column that can be mutated after the fact" — it is
 * `ON DELETE SET NULL`, the tombstone `multi-tenancy.md` requires), and `prev_hash` is a
 * separate parameter to `canonicalRowHash` rather than a field here, because it is the one
 * piece of the recipe that depends on chain state (the current head's `row_hash`) rather
 * than on the row being inserted — the caller (the impure edge, `apps/api`) reads it once
 * from the chain head, and this module never has to know where a "current head" comes
 * from.
 *
 * `ActivityRow` mirrors `activity`'s columns (`data-model.md` §4) reduced to what
 * `reconstructAt` (`AU-8`) actually needs — the same "reduced to what this module needs"
 * convention `workflow/types.ts` uses throughout, not a second registration of every
 * `activity` column (do-not 11's tables live in `data-model.md`).
 */

/**
 * A JSON value, exactly what a `jsonb` column decodes to. No `undefined`, no
 * `NaN`/`Infinity` — a `jsonb` column cannot hold either, which is what lets
 * `canonicalJson` (`audit.ts`) delegate safely to `JSON.stringify` for every leaf value.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The `audit_log` columns `canonicalRowHash` hashes, in the exact order `data-model.md`
 * §11's "Hash input" list gives — every column that list names **except** `prev_hash`
 * (a separate parameter, see above), `organisation_id` (excluded from the hash entirely)
 * and `row_hash` (the function's own output, never an input).
 *
 * **`createdAt` is a pre-formatted string, not a `Date`.** The recipe requires
 * microsecond-precision UTC ISO-8601 (`2026-09-05T14:03:11.123456Z`), and a native JS
 * `Date` carries only millisecond precision — silently truncating the real
 * microsecond-resolution value Postgres's `timestamptz` holds would corrupt the chain for
 * two rows written within the same millisecond, exactly the class of silent-precision-loss
 * bug this module's golden-file test exists to catch elsewhere in the recipe. Formatting
 * the column into that exact string is therefore the impure edge's job (it is the one
 * place that actually reads the `timestamptz` value), never this module's.
 *
 * Every field below that can be SQL `NULL` is typed `string | null`, deliberately even
 * where `data-model.md`'s compact table notation does not mark a particular column
 * nullable — the hash recipe itself says "every other column as its UTF-8 text; SQL `NULL`
 * is the empty string", stated once for the whole list, so this type has to be able to
 * represent that for any of them, not only the ones the table happens to flag as null.
 * `action`, `entityType` and `entityId` are the three the table does mark as always
 * present, so they stay plain `string`.
 */
export interface AuditLogRow {
  createdAt: string;
  actorId: string | null;
  actorType: string | null;
  apiKeyId: string | null;
  impersonatorId: string | null;
  actorIp: string | null;
  userAgent: string | null;
  traceId: string | null;
  workspaceId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: JsonValue | null;
  after: JsonValue | null;
}

/**
 * An `activity` row (`data-model.md` §4: `work_item_id`, `actor_id`, `actor_type`,
 * `verb`, `field`, `old_value`, `new_value`, `payload jsonb`, `visibility`,
 * `workflow_version_id`, `created_at`), reduced to what `reconstructAt` needs: which
 * field changed, to what, when, and a deterministic tie-break key. `actorId`/`actorType`/
 * `verb`/`oldValue`/`payload`/`visibility`/`workflowVersionId` are never read by the fold
 * (reconstruction only cares about the *current* value of each field, never who changed
 * it, what it displaces, or how the UI groups it) so, per this package's established
 * convention of typing a row down to exactly what a function needs, they are not part of
 * this type.
 *
 * `sequence` stands in for Postgres's real auto-increment `activity.id` — a monotonic,
 * caller-supplied surrogate key used only to break a tie when two rows share the exact
 * same `createdAt`. Decided in this pull request's decision-log entry: ascending
 * `sequence` (insertion order), the one secondary ordering signal a database provides for
 * free — see `reconstructAt`'s own doc comment in `audit.ts`. It is never interpreted as
 * meaningful data itself, only compared for ordering.
 *
 * `createdAt` is a `Date` here, unlike `AuditLogRow.createdAt`'s pre-formatted string:
 * `reconstructAt` never hashes anything, it only orders rows, and a millisecond-resolution
 * `Date` orders correctly even when it collapses two genuinely-microsecond-apart rows to
 * the same millisecond value — `sequence` (real insertion order) is the tie-break for
 * exactly that case too, not only for a true microsecond-exact tie, so no precision is
 * actually lost for the purpose this type is used for.
 */
export interface ActivityRow {
  sequence: number;
  field: string | null;
  newValue: string | null;
  createdAt: Date;
}

/**
 * A work item's field-level state at some instant, as replayed by `reconstructAt`
 * (`AU-8`) — a map of `field` name to its `new_value` as of that instant, for every field
 * an `activity` row has touched by then. A field the item has never changed (still
 * holding whatever it was created with, and never written as a field-change row) simply
 * does not appear here — `reconstructAt` folds only what `activity` actually recorded,
 * never a full row snapshot it was never given.
 */
export interface WorkItemSnapshot {
  fields: Record<string, string | null>;
}
