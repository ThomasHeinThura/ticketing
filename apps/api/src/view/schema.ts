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

// SV-14's storage envelope. The work-item search endpoint owns the filter grammar and
// validates it when a saved view runs; keeping this envelope forward-compatible allows
// layouts that P1 does not yet execute to be stored and round-tripped without claiming
// support for their grouping, aggregation, or presentation semantics.
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
