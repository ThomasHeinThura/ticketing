import { responseTimestamp, z } from "../openapi";

const person = z.object({ id: z.string(), name: z.string().nullable() });

export const pageSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  snippet: z.string(),
  version: z.number().int(),
  updatedBy: person.nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

export const pageListSchema = z.object({
  pages: z.array(pageSummarySchema),
  canEdit: z.boolean(),
});

export const pageSchema = pageSummarySchema.extend({
  body: z.record(z.string(), z.unknown()),
  createdBy: person.nullable(),
  canEdit: z.boolean(),
});

export const pageVersionSummarySchema = z.object({
  number: z.number().int(),
  title: z.string(),
  kind: z.enum(["create", "edit", "restore"]),
  restoredFrom: z.number().int().nullable(),
  createdBy: person.nullable(),
  createdAt: responseTimestamp,
});

export const pageVersionListSchema = z.object({
  versions: z.array(pageVersionSummarySchema),
});

export const pageVersionSchema = pageVersionSummarySchema.extend({
  body: z.record(z.string(), z.unknown()),
});

/** PG-5: the 409 for a stale save names the current version and its metadata, not the body. */
export const pageConflictSchema = z.object({
  message: z.string(),
  currentVersion: z.number().int(),
  currentTitle: z.string(),
  updatedAt: responseTimestamp,
  updatedBy: person.nullable(),
});
