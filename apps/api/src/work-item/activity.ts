import type db from "../database";
import { activityTable } from "../database/schema";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// data-model.md Conventions: "`actor_type` accompanies every `actor_id`: `person |
// automation | system | api_key`" (events.md).
export type ActivityActorType = "person" | "automation" | "system" | "api_key";

export type ActivityVisibility = "public" | "internal";

/**
 * One row this writer will insert. Mirrors `activityTable`'s columns (`schema.ts`) minus
 * the ones the writer itself supplies (`id`, `createdAt`, `seq`).
 *
 * `visibility` is optional: when omitted, `resolveVisibility` below derives it from
 * `verb`/`field` per CA-7's table (`docs/03-features/comments-and-activity.md`).
 *
 * When present, `visibility` is NOT an unconditional override — CA-7 says visibility is
 * "decided by this table and nothing else", so a caller cannot simply assert `public`.
 * `"internal"` is always honoured (a caller downgrading itself is always safe).
 * `"public"` is honoured ONLY for the two rows CA-7 makes conditional on data this module
 * cannot see by itself — `attachment.added` (public only for a customer-visible
 * attachment) and the field `custom_field` (internal unless that field is
 * `customer_visible`) — and `resolveVisibility` THROWS for any other attempt to force
 * `public` (found by PR #275's mandatory Opus 5.5 security review, S3: silently
 * downgrading instead would hide a caller's wrong assumption that its row is public when
 * it privately is not, which is the more dangerous failure mode of the two here).
 */
export type NewActivityInput = {
  workspaceId: string;
  workItemId: string;
  actorId: string | null;
  actorType: ActivityActorType;
  verb: string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  payload?: unknown;
  workflowVersionId?: string | null;
  visibility?: ActivityVisibility;
};

// CA-7: verbs that are public REGARDLESS of `field` (there is no field on these rows).
const CA7_PUBLIC_VERBS: ReadonlySet<string> = new Set([
  "created",
  "transitioned",
  "reopened",
  "resolved",
  "escalated",
]);

// CA-7: field names that are public when the verb is a plain field change (verb
// `updated`, `field` set to the field name -- CA-7's table is keyed "Verb / field" and
// resolves a field edit by field name; `events.md` ~135 resolves `work_item.field_changed`
// to `work_item.updated` the same way -- see `diffWorkItemFieldChanges` below).
const CA7_PUBLIC_FIELDS: ReadonlySet<string> = new Set([
  "priority",
  "due_date",
  "title",
  "description",
]);

// CA-7's two rows whose visibility depends on data this module cannot see by itself --
// the only two an explicit `visibility: "public"` override may legitimately claim (S3).
function isConditionalPublicOverrideAllowed(input: NewActivityInput): boolean {
  return input.verb === "attachment.added" || input.field === "custom_field";
}

/**
 * CA-7: "Activity rows have visibility too, decided by this table and nothing else. An
 * unmapped verb or field is `internal` -- adding a field later fails closed."
 *
 * Resolution order:
 * 1. `input.visibility === "internal"` is always honoured -- downgrading to internal is
 *    always safe.
 * 2. `input.visibility === "public"` is honoured ONLY for the two CA-7 conditional rows
 *    (`isConditionalPublicOverrideAllowed`); any other attempt to force `public` THROWS
 *    (S3 -- see `NewActivityInput`'s own doc comment for why a throw, not a silent
 *    downgrade).
 * 3. Otherwise, visibility is derived from `verb`/`field` alone. `CA7_PUBLIC_FIELDS` is
 *    consulted ONLY when `verb === "updated"` (S2, PR #275's mandatory Opus 5.5 review:
 *    the previous form checked `field` first regardless of `verb`, so
 *    `{verb: "custom_field.updated", field: "priority"}` resolved to `public` on the
 *    strength of a field name that happened to collide with a real public field, even
 *    though the actual verb is not `updated` at all). For any other verb, only
 *    `CA7_PUBLIC_VERBS` decides, `field` or not; an unmapped verb (or field, under
 *    `updated`) is `internal`, by construction (the `default: "internal"` on the column
 *    itself, `schema.ts`, is the same fail-closed backstop for any writer that bypasses
 *    this function entirely, e.g. a future raw-SQL migration or import path).
 */
export function resolveVisibility(input: NewActivityInput): ActivityVisibility {
  if (input.visibility === "internal") {
    return "internal";
  }
  if (input.visibility === "public") {
    if (!isConditionalPublicOverrideAllowed(input)) {
      const fieldSuffix = input.field
        ? ` / field ${JSON.stringify(input.field)}`
        : "";
      throw new Error(
        `resolveVisibility: visibility: "public" is not allowed for verb ${JSON.stringify(input.verb)}${fieldSuffix} -- ` +
          'CA-7 decides visibility for every row itself; a caller may only force "public" ' +
          'for "attachment.added" or the "custom_field" field, and may always force "internal".',
      );
    }
    return "public";
  }
  if (input.verb === "updated") {
    return input.field && CA7_PUBLIC_FIELDS.has(input.field)
      ? "public"
      : "internal";
  }
  return CA7_PUBLIC_VERBS.has(input.verb) ? "public" : "internal";
}

/**
 * Writes one or more activity rows atomically with the caller's own mutation. `dbOrTx`
 * MUST be the transaction handle the caller is already inside (the `DbOrTx` convention
 * `claim-work-item-number.ts` established) -- passing the bare `db` client here writes
 * outside the caller's transaction, which defeats the "atomic with the mutation" purpose
 * this function exists for, so callers doing a real mutation always pass `tx`, never
 * `db` directly, even though the type does not forbid it (the same trade-off
 * `claimWorkItemNumber` accepts).
 *
 * NOT wired into any work-item create/update controller yet -- issue #23's second slice
 * (PR #271) owns that call site and lands separately, per this PR's own scope. Returns
 * the inserted rows (including each one's server-assigned `id`) for a caller that wants
 * to reference them (e.g. `comment.activity_id`) -- deliberately EXCLUDING `seq`
 * (S6, PR #275's mandatory Opus 5.5 review): the decision log's own exception to
 * "surrogate ids are never sequential" rests entirely on `seq` never appearing in an API
 * response, so this writer must not be the leak that breaks that premise. Select an
 * explicit column list rather than `.returning()` (which would include every column,
 * `seq` included) precisely so a future column added to the table does not silently
 * reopen this gap.
 *
 * A CALLER OBLIGATION this function cannot enforce for you: visibility is decided PER
 * ROW, not per field inside a row's own `payload`/`old_value`/`new_value`. A `created`
 * row is `public` (`CA7_PUBLIC_VERBS`), so its `payload` must never carry a full
 * work-item snapshot (assignee, requester, or anything else CA-7 marks `internal`) --
 * that data belongs on a SEPARATE `internal` row (e.g. `verb: "updated", field:
 * "assignee"`), never folded into the public `created` row's own payload. This applies to
 * #271's create/update write paths and #27's portal read/projection alike.
 */
export async function recordWorkItemActivity(
  dbOrTx: DbOrTx,
  inputs: readonly NewActivityInput[],
) {
  if (inputs.length === 0) {
    return [];
  }

  const now = new Date();
  return dbOrTx
    .insert(activityTable)
    .values(
      inputs.map((input) => ({
        workspaceId: input.workspaceId,
        workItemId: input.workItemId,
        actorId: input.actorId,
        actorType: input.actorType,
        verb: input.verb,
        field: input.field ?? null,
        oldValue: input.oldValue ?? null,
        newValue: input.newValue ?? null,
        payload: input.payload ?? null,
        workflowVersionId: input.workflowVersionId ?? null,
        visibility: resolveVisibility(input),
        createdAt: now,
      })),
    )
    .returning({
      id: activityTable.id,
      workspaceId: activityTable.workspaceId,
      workItemId: activityTable.workItemId,
      actorId: activityTable.actorId,
      actorType: activityTable.actorType,
      verb: activityTable.verb,
      field: activityTable.field,
      oldValue: activityTable.oldValue,
      newValue: activityTable.newValue,
      payload: activityTable.payload,
      visibility: activityTable.visibility,
      workflowVersionId: activityTable.workflowVersionId,
      createdAt: activityTable.createdAt,
      // `seq` is deliberately NOT listed -- see this function's own doc comment.
    });
}

/**
 * The subset of `work_item` columns a plain field-change diff can compare. Kept narrow
 * and named for the specific fields CA-7 actually assigns a visibility to, plus
 * `assigneeId` as a representative `internal` field (CA-7: "assignee ... internal") --
 * not an exhaustive mirror of every `work_item` column. Extend this (and, if a new field
 * needs its own visibility rule, `CA7_PUBLIC_FIELDS`) as later slices need more of them;
 * CA-7's own fail-closed default means a field this map does not yet cover simply isn't
 * diffed here rather than silently mis-classified.
 */
export type WorkItemFieldSnapshot = {
  title?: string;
  description?: unknown;
  priority?: string | null;
  dueDate?: Date | string | null;
  assigneeId?: string | null;
  stateId?: string;
};

export type DiffActivityContext = {
  workspaceId: string;
  workItemId: string;
  actorId: string | null;
  actorType: ActivityActorType;
};

const DIFFABLE_FIELDS: ReadonlyArray<{
  key: keyof WorkItemFieldSnapshot;
  field: string;
}> = [
  { key: "title", field: "title" },
  { key: "description", field: "description" },
  { key: "priority", field: "priority" },
  { key: "dueDate", field: "due_date" },
  { key: "assigneeId", field: "assignee" },
];

function valuesDiffer(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (
      new Date(a as Date | string).getTime() !==
      new Date(b as Date | string).getTime()
    );
  }
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

/**
 * CA-6: "Every field change writes an `activity` row with the field, old value and new
 * value." One row per changed field named in `DIFFABLE_FIELDS`, plus a `transitioned`
 * row (verb, no `field` -- see CA-7's own listing, which names `transitioned` as a verb
 * in its own right, not a `field` value) when `stateId` moved.
 *
 * A key present in `before` but absent from `after` (or vice versa) is treated as "not
 * part of this update" and skipped, not as a change to/from `undefined` -- a caller
 * builds `after` from only the fields its own request actually touched, the same way a
 * `PATCH` only sets what it received (PR #271's `update-work-item.ts`).
 *
 * The verb for a plain field edit is `updated`, with `field` set to the field name --
 * decided (not this module's own invention): CA-7's table is keyed "Verb / field" and
 * resolves a field edit's visibility by field name, and `docs/01-architecture/events.md`
 * ~135 already resolves the automation-picker label `work_item.field_changed` to the
 * real event key `work_item.updated` the same way. This writer's `verb: "updated"` rows
 * are that same generic-field-edit shape, not a new vocabulary item.
 */
export function diffWorkItemFieldChanges(
  before: WorkItemFieldSnapshot,
  after: WorkItemFieldSnapshot,
  context: DiffActivityContext,
): NewActivityInput[] {
  const rows: NewActivityInput[] = [];

  for (const { key, field } of DIFFABLE_FIELDS) {
    if (!(key in after)) {
      continue;
    }
    const oldValue = before[key] ?? null;
    const newValue = after[key] ?? null;
    if (!valuesDiffer(oldValue, newValue)) {
      continue;
    }
    // S4, PR #275's mandatory Opus 5.5 review: built from the four NAMED context fields
    // explicitly, never `...context` -- a spread would carry any EXTRA property a wider
    // object happens to have (e.g. a `visibility` picked up from a loaded row or request
    // object) into every emitted row, and `resolveVisibility`'s override handling would
    // then have to defend against it a second time. `DiffActivityContext`'s own type only
    // declares these four, but excess-property checking is an object-LITERAL-only
    // TypeScript feature, so a caller passing a wider object here would not be a type
    // error -- explicit construction is what actually closes the gap, the type alone does
    // not.
    rows.push({
      workspaceId: context.workspaceId,
      workItemId: context.workItemId,
      actorId: context.actorId,
      actorType: context.actorType,
      verb: "updated",
      field,
      oldValue,
      newValue,
    });
  }

  if (
    "stateId" in after &&
    after.stateId !== undefined &&
    after.stateId !== before.stateId
  ) {
    rows.push({
      workspaceId: context.workspaceId,
      workItemId: context.workItemId,
      actorId: context.actorId,
      actorType: context.actorType,
      verb: "transitioned",
      oldValue: before.stateId ?? null,
      newValue: after.stateId ?? null,
    });
  }

  return rows;
}
