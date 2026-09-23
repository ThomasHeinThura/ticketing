import { z } from "../openapi";

// S4 (independent Opus security review of PR #271): Postgres `text`/`jsonb` both reject a
// NUL byte outright (`invalid byte sequence`), which reached the database unvalidated and
// came back as a masked 500 instead of this route's normal 400 -- for a NUL in `title`
// (`text`), in a `description` (`jsonb`) STRING VALUE, or even in a `description` OBJECT
// KEY (`{"a\u0000":1}` also 500s; Postgres jsonb rejects a NUL anywhere in the document,
// not only in values). `description` is opaque, arbitrary-shape JSON (this slice does not
// validate Tiptap document shape), so the check walks the whole value recursively rather
// than only checking the top level. Deliberately NOT a depth/size bound -- that is #261's
// F3 (unbounded `description`, no body-size limit), tracked separately; this only rejects
// the one byte Postgres cannot store at all, whatever the structure's size.
function containsNulByte(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some(containsNulByte);
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, entry]) => key.includes("\u0000") || containsNulByte(entry),
    );
  }
  return false;
}

const NO_NUL_BYTE_MESSAGE =
  "must not contain a NUL (\\u0000) byte -- Postgres text/jsonb columns reject it";

const workItemTitle = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE);

// `work_item.description` is `jsonb` (Tiptap document). Accepted as opaque JSON here --
// this slice does not validate Tiptap document shape, matching how `task`'s own
// description column is treated elsewhere in this codebase.
const workItemDescription = z
  .unknown()
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE);

// `WI-3`: title is required, 1-500 characters. Everything else this slice accepts is
// optional -- custom fields (`custom-fields.md`), labels, checklists, dates, assignment
// and priority-escalation rules are all separate, later slices (see this PR's own body /
// the work-item.md "Out of scope" section for what #23's FIRST slice deliberately excludes).
export const createWorkItemBody = z.object({
  // `WI-1`: every work item has exactly one type, required on create.
  typeId: z.string().min(1),
  title: workItemTitle,
  description: workItemDescription.optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

export const projectIdParam = z.object({ projectId: z.string() });

export const workItemKeyParam = z.object({ key: z.string() });

// `PATCH /api/work-items/{key}` -- `WI-7`/`WI-8`. Every field OPTIONAL: this is a genuine
// partial update (only the fields supplied are changed), matching this codebase's own
// canonical-route convention for a PATCH body -- `workspace/schema.ts`'s
// `updateWorkspaceBody` (all-optional fields + a `.refine` requiring at least one), NOT
// `task`/`project`'s legacy full-replace PATCH controllers (`update-task.ts`,
// `update-project.ts`), which predate the canonical vocabulary and always require every
// field. `work-item/index.ts` is itself already a "canonical, non-legacy" mount (see that
// file's own comment), so this follows its own family's convention.
//
// WI-8 also names labels and custom fields as editable here -- DELIBERATELY NOT INCLUDED.
// Labels have no assignment endpoint or supporting join-table wiring anywhere in this
// codebase yet (grepped; `label`/`work_item_label` exist only as bare tables in
// data-model.md, no route touches them), and custom fields are a separate, not-yet-built
// spec (`custom-fields.md`). Both are out of scope for this slice -- flagged in the PR
// body, not guessed at. State (`WI-9`, workflow-only) and assignment (`WI-10`,
// `assignment.md`) are separate mechanisms entirely and are also not here.
// S3 (independent Opus security review of PR #271): `z.coerce.date()` accepts ANY value
// `new Date(...)` accepts -- a number (`8.64e15`, `true` as `1`, `0` as the epoch), or an
// ISO string past what Postgres's `timestamp` column can store. A JS `Date` beyond year
// 9999 serialises as an extended-year string (`+010000-...`) that Postgres rejects
// outright, and `±8.64e15` (the exact `Date` min/max in milliseconds) round-trips through
// `new Date()` without ever throwing, so both passed validation and then 500'd in the
// database instead of this route's normal 400 -- the same class of gap `ifMatchHeader`'s
// own `.refine` above closes for `If-Match`. Restricting to a plain, 4-digit-year ISO-8601
// string (never a bare number, never `true`/`false`, never the extended year format)
// closes it at the validation boundary: only what a caller could reasonably mean as a date
// is accepted, and everything else is a 400. `work_item.start_date`/`due_date` are
// Postgres `timestamp`, whose actual range (4713 BC - 294276 AD) is far wider than the
// 1-9999 window enforced here -- narrower on purpose, since nothing in `work-items.md`
// calls for a date outside a normal calendar year, and it is the same bound `If-Match`'s
// own fix uses (reject anything the domain has no real use for, rather than anything
// short of the database's own limit).
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const workItemDateTime = z
  .string()
  .regex(
    ISO_DATE_TIME_PATTERN,
    'must be an ISO-8601 date-time string, e.g. "2026-01-01T00:00:00.000Z"',
  )
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "must be a valid date-time",
  })
  .transform((value) => new Date(value));

export const updateWorkItemBody = z
  .object({
    title: workItemTitle.optional(),
    // Same "opaque JSON, not validated as a Tiptap document" treatment as
    // `createWorkItemBody.description` -- nullable here (unlike create) because a partial
    // update may legitimately CLEAR a description that already has a value.
    description: workItemDescription.nullable().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
    startDate: workItemDateTime.nullable().optional(),
    dueDate: workItemDateTime.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be supplied",
  });

// `WI-7`: "Concurrent edits use optimistic concurrency on `version`
// (`work_item.version`, `api-design.md`'s `If-Match` convention) ... every other field
// write is version-checked" -- i.e. every write this endpoint makes (rank, `WI-11`, is the
// one named exception, and rank has its own separate route). So, unlike
// `api-design.md`'s generic per-resource wording ("`PATCH` MAY send `If-Match`"), this
// domain rule makes the header REQUIRED for work-item field updates specifically, not
// optional -- a caller with no asserted version has nothing for the mandated
// compare-and-swap to check against. JUDGMENT CALL, flagged in the PR body rather than
// silently relaxed to optional.
//
// Header value is the quoted version string per `api-design.md` (`If-Match: "<version>"`,
// the same quoted-token shape as an `ETag`) -- accepted with or without the quotes since
// real HTTP clients vary, but always digits underneath.
//
// `work_item.version` is a Postgres `integer` (`database/schema.ts`), max 2147483647 --
// the regex above only shapes the string as "digits, optionally quoted", so an
// out-of-range value like `99999999999999999999` passed the regex, reached the `WHERE
// version = $assertedVersion` comparison in `update-work-item.ts`, and Postgres rejected
// the out-of-range integer literal with a 500 instead of this route's normal 400/404/409.
// The `.refine` below rejects it at the validation boundary instead, matching every other
// out-of-range/malformed-input case this route already answers with 400.
const POSTGRES_INTEGER_MAX = 2147483647;

export const ifMatchHeader = z.object({
  "if-match": z
    .string()
    .regex(
      /^"?\d+"?$/,
      'If-Match must be the work item\'s current version, e.g. "3"',
    )
    .refine(
      (value) => Number(value.replaceAll('"', "")) <= POSTGRES_INTEGER_MAX,
      `If-Match must not exceed ${POSTGRES_INTEGER_MAX} (work_item.version is a Postgres integer)`,
    ),
});
