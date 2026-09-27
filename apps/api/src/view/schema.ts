import { z } from "../openapi";

export const savedViewIdParam = z.object({ id: z.string() });

export const listViewsQuery = z.object({ workspaceId: z.string().min(1) });

export const SAVED_VIEW_SCOPES = ["workspace", "project"] as const;
export const SAVED_VIEW_VISIBILITIES = [
  "private",
  "team",
  "workspace",
] as const;
export const SAVED_VIEW_LAYOUTS = [
  "board",
  "list",
  "table",
  "calendar",
  "timeline",
  "chart",
] as const;

// SV-14's envelope. Every field is optional here because a saved view can capture any
// subset of it -- `columns`/`aggregate` only make sense for a table/report layout, and a
// board layout has no `columns` at all. Kept as a permissive `record`/`array` shape
// rather than a fully-typed filter grammar -- `POST /api/work-items/search`'s structured
// filter grammar (api-design.md, SV-11/SV-12) does not exist in this codebase yet (this
// PR's own "Not done" section discloses that), so there is nothing to validate the
// `filter` shape strictly against today. Storing it opaquely now, and tightening this
// once that grammar lands, is the honest sequencing -- inventing a filter shape here
// would be guessing at a spec that isn't written down.
export const savedViewQueryEnvelope = z.object({
  entity: z.string().default("work_item"),
  filter: z.record(z.string(), z.unknown()).optional(),
  sort: z
    .array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }))
    .optional(),
  groupBy: z.string().optional(),
  columns: z.array(z.string()).optional(),
  aggregate: z.record(z.string(), z.unknown()).optional(),
});

export const createViewBody = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(200),
  scope: z.enum(SAVED_VIEW_SCOPES),
  scopeId: z.string().min(1),
  visibility: z.enum(SAVED_VIEW_VISIBILITIES).default("private"),
  sharedWithTeamId: z.string().min(1).optional(),
  layout: z.enum(SAVED_VIEW_LAYOUTS),
  query: savedViewQueryEnvelope,
});

export const updateViewBody = z.object({
  name: z.string().min(1).max(200).optional(),
  visibility: z.enum(SAVED_VIEW_VISIBILITIES).optional(),
  sharedWithTeamId: z.string().min(1).nullable().optional(),
  layout: z.enum(SAVED_VIEW_LAYOUTS).optional(),
  query: savedViewQueryEnvelope.optional(),
});
