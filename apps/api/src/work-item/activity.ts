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
 * `verb`/`field` per CA-7's table (`docs/03-features/comments-and-activity.md`). Pass it
 * explicitly only for a verb CA-7 marks as conditional on data this module cannot see —
 * today, `attachment.added` (public only for a customer-visible attachment) and
 * `custom_field` (internal unless the field itself is `customer_visible`). Omitting
 * `visibility` for either of those two resolves to `internal`, CA-7's own stated
 * fail-closed default for anything this table cannot otherwise resolve.
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

// CA-7: field names that are public when the verb is a plain field change (this writer's
// own `field_changed` verb -- see `diffWorkItemFieldChanges` below).
const CA7_PUBLIC_FIELDS: ReadonlySet<string> = new Set([
  "priority",
  "due_date",
  "title",
  "description",
]);

/**
 * CA-7: "Activity rows have visibility too, decided by this table and nothing else. An
 * unmapped verb or field is `internal` -- adding a field later fails closed."
 *
 * An explicit `input.visibility` always wins (the two conditional CA-7 rows this module
 * cannot resolve on its own). Otherwise: a known public verb, or a known public field on
 * a plain field-change row, is `public`; everything else -- including any verb or field
 * this table does not name -- is `internal`, by construction (the `default: "internal"`
 * on the column itself, `schema.ts`, is the same fail-closed backstop for any writer that
 * bypasses this function entirely, e.g. a future raw-SQL migration or import path).
 */
export function resolveVisibility(input: NewActivityInput): ActivityVisibility {
  if (input.visibility) {
    return input.visibility;
  }
  if (input.field) {
    return CA7_PUBLIC_FIELDS.has(input.field) ? "public" : "internal";
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
 * the inserted rows (including each one's server-assigned `id`/`seq`) for a caller that
 * wants to reference them (e.g. `comment.activity_id`).
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
    .returning();
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
 * JUDGMENT CALL: `field_changed` is this module's own name for the generic per-field
 * verb -- CA-6/CA-7 name the *fields* (`priority`, `due_date`, ...) and the *named*
 * verbs (`created`, `transitioned`, ...) but never name the verb a plain field edit
 * itself carries. Flagged here and in this PR's body rather than guessed silently.
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
    rows.push({
      ...context,
      verb: "field_changed",
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
      ...context,
      verb: "transitioned",
      oldValue: before.stateId ?? null,
      newValue: after.stateId ?? null,
    });
  }

  return rows;
}
