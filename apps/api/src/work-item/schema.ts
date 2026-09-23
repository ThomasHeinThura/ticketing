import { z } from "../openapi";

// `WI-3`: title is required, 1-500 characters. Everything else this slice accepts is
// optional -- custom fields (`custom-fields.md`), labels, checklists, dates, assignment
// and priority-escalation rules are all separate, later slices (see this PR's own body /
// the work-item.md "Out of scope" section for what #23's FIRST slice deliberately excludes).
export const createWorkItemBody = z.object({
  // `WI-1`: every work item has exactly one type, required on create.
  typeId: z.string().min(1),
  title: z.string().min(1).max(500),
  // `work_item.description` is `jsonb` (Tiptap document). Accepted as opaque JSON here --
  // this slice does not validate Tiptap document shape, matching how `task`'s own
  // description column is treated elsewhere in this codebase.
  description: z.unknown().optional(),
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
export const updateWorkItemBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    // Same "opaque JSON, not validated as a Tiptap document" treatment as
    // `createWorkItemBody.description` -- nullable here (unlike create) because a partial
    // update may legitimately CLEAR a description that already has a value.
    description: z.unknown().nullable().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
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
