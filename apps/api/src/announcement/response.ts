import { z } from "../openapi";
import { audienceSchema, severitySchema } from "./schema";

const named = z.object({ id: z.string(), name: z.string() });

/** The stored row with its audience targets (audit and reach checks use it). */
const announcementRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  body: z.string(),
  severity: severitySchema,
  audience: audienceSchema,
  organisations: z.array(named),
  projects: z.array(named),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AnnouncementView = z.infer<typeof announcementRecordSchema>;

/** Staff view: the row with the targets inside the caller's reach. */
export const announcementSchema = announcementRecordSchema.extend({
  /**
   * Whether the caller reaches every customer this notice addresses: no target is outside their
   * reach, and a workspace-wide notice needs reach to every customer project. Without it the
   * caller cannot publish the notice, or edit, unpublish or delete it once published (422).
   */
  reachesAudience: z.boolean(),
});
export type StaffAnnouncement = z.infer<typeof announcementSchema>;

export const announcementListSchema = z.object({
  data: z.array(announcementSchema),
});

/** The organisations and projects an announcement in this workspace may address. */
export const announcementAudienceOptionsSchema = z.object({
  /** Whether the caller reaches every live customer project, so may address all customers. */
  canAddressWorkspace: z.boolean(),
  organisations: z.array(named),
  projects: z.array(
    named.extend({ organisationId: z.string(), organisationName: z.string() }),
  ),
});

export const announcementVersionConflictSchema = z.object({
  message: z.string(),
  currentVersion: z.number().int(),
});

/** Customer view: no audience, authorship or version. */
export const portalAnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  severity: severitySchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime(),
});
export type PortalAnnouncement = z.infer<typeof portalAnnouncementSchema>;

export const portalAnnouncementListSchema = z.object({
  data: z.array(portalAnnouncementSchema),
  nextCursor: z.string().nullable(),
});
