import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_SEVERITIES,
} from "../database/schema-p5-service";
import { z } from "../openapi";

const id = z.string().min(1).max(128);
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const severitySchema = z.enum(ANNOUNCEMENT_SEVERITIES);
export const audienceSchema = z.enum(ANNOUNCEMENT_AUDIENCES);

export const workspaceIdQuery = z.object({ workspaceId: id }).strict();
export const announcementIdParam = z.object({ id }).strict();

const title = z.string().trim().min(1).max(200);
const body = z.string().max(20_000);
const targetIds = z.array(id).max(100);

/** Fields shared by create and update. Audience targets are validated in the repository. */
export const createAnnouncementBody = z
  .object({
    workspaceId: id,
    title,
    body: body.default(""),
    severity: severitySchema,
    audience: audienceSchema,
    organisationIds: targetIds.default([]),
    projectIds: targetIds.default([]),
    startsAt: instant.optional(),
    endsAt: instant.nullable().optional(),
  })
  .strict();

export const updateAnnouncementBody = z
  .object({
    version: z.number().int().min(1),
    title: title.optional(),
    body: body.optional(),
    severity: severitySchema.optional(),
    audience: audienceSchema.optional(),
    organisationIds: targetIds.optional(),
    projectIds: targetIds.optional(),
    startsAt: instant.optional(),
    endsAt: instant.nullable().optional(),
  })
  .strict();

export const versionBody = z
  .object({ version: z.number().int().min(1) })
  .strict();

export const portalAnnouncementListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(512).optional(),
    /** Comma-separated severities, for example `incident,maintenance` for the shell banner. */
    severity: z
      .string()
      .max(64)
      .regex(/^(info|maintenance|incident)(,(info|maintenance|incident))*$/u)
      .optional(),
  })
  .strict();
