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
