import {
  CHANGE_RISK_LEVELS,
  RELEASE_STATUSES,
  SERVICE_STATUSES,
  SUPPORT_LEVELS,
} from "@taskdesk/domain";
import { z } from "../openapi";

const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(160);
const text = z.string().trim().max(10_000);

export const workspaceIdQuery = z.object({ workspaceId: id });
export const idParam = z.object({ id: id });
export const keyParam = z.object({ key: z.string().min(1).max(64) });

export const serviceLinkInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("documentation"),
    url: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value), "Use an http(s) URL"),
    label: z.string().trim().max(160).nullish(),
  }),
  z.object({ kind: z.literal("project"), projectId: id }),
  z.object({ kind: z.literal("kb_article"), kbArticleId: id }),
]);
export type ServiceLinkInput = z.infer<typeof serviceLinkInput>;

const checklist = z.array(z.string().trim().min(1).max(300)).max(50);

export const createServiceBody = z.object({
  workspaceId: id,
  name,
  description: text.nullish(),
  category: z.string().trim().max(80).nullish(),
  ownerTeamId: id.nullish(),
  supportLevel: z.enum(SUPPORT_LEVELS).optional(),
  serviceCalendarId: id.nullish(),
  links: z.array(serviceLinkInput).max(50).optional(),
  dependsOnServiceIds: z.array(id).max(100).optional(),
  releaseChecklist: checklist.optional(),
});

export const updateServiceBody = z
  .object({
    name: name.optional(),
    description: text.nullable().optional(),
    category: z.string().trim().max(80).nullable().optional(),
    ownerTeamId: id.nullable().optional(),
    supportLevel: z.enum(SUPPORT_LEVELS).optional(),
    serviceCalendarId: id.nullable().optional(),
    /** Replaces the whole set. */
    links: z.array(serviceLinkInput).max(50).optional(),
    /** Replaces the whole set. A cycle is permitted but flagged in the response. */
    dependsOnServiceIds: z.array(id).max(100).optional(),
    /** Replaces the release checklist definition (REL-3). */
    releaseChecklist: checklist.optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const setServiceStatusBody = z.object({
  status: z.enum(SERVICE_STATUSES),
  note: z.string().trim().max(500).nullish(),
});

export const serviceListQuery = workspaceIdQuery.extend({
  q: z.string().trim().max(120).optional(),
});

const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const calendarQuery = workspaceIdQuery.extend({
  from: instant,
  to: instant,
});

export const patchChangeBody = z
  .object({
    risk: z.enum(CHANGE_RISK_LEVELS).nullable().optional(),
    windowStart: instant.nullable().optional(),
    windowEnd: instant.nullable().optional(),
    rollbackPlan: z.string().trim().max(10_000).nullable().optional(),
    serviceIds: z.array(id).max(50).optional(),
    releaseId: id.nullable().optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const freezeOverrideBody = z
  .object({
    reason: z.string().trim().min(12).max(500),
    /**
     * Optional PROPOSED deployment window: the override then also covers the freezes covering it,
     * so a change can be cleared for a future freeze before it is planned into it. The step-up
     * proof is bound to the operation, change key, reason and this window (none when absent).
     */
    windowStart: instant.optional(),
    windowEnd: instant.optional(),
  })
  .refine(
    (value) =>
      (value.windowStart === undefined) === (value.windowEnd === undefined),
    {
      message: "Set both the proposed window start and end, or neither",
    },
  )
  .refine(
    (value) =>
      value.windowStart === undefined ||
      value.windowEnd === undefined ||
      value.windowEnd > value.windowStart,
    { message: "The window must end after it starts" },
  );

export const createFreezeBody = z
  .object({
    workspaceId: id,
    name,
    reason: z.string().trim().max(1000).nullish(),
    startsAt: instant,
    endsAt: instant,
  })
  .refine((value) => value.endsAt > value.startsAt, {
    message: "The freeze must end after it starts",
  });

export const updateFreezeBody = z
  .object({
    name: name.optional(),
    reason: z.string().trim().max(1000).nullable().optional(),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    cancel: z.literal(true).optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const freezeListQuery = workspaceIdQuery.extend({
  includeCancelled: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const releaseListQuery = workspaceIdQuery.extend({
  serviceId: id.optional(),
});

export const createReleaseBody = z.object({
  workspaceId: id,
  name,
  serviceId: id,
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  /** Work item keys of changes to associate (REL-2). */
  changeKeys: z.array(z.string().min(1).max(64)).max(200).optional(),
});

export const updateReleaseBody = z
  .object({
    name: name.optional(),
    plannedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    status: z.enum(RELEASE_STATUSES).optional(),
    /** Replaces the associated change set. */
    changeKeys: z.array(z.string().min(1).max(64)).max(200).optional(),
    publishToPortal: z.boolean().optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const releaseNotesBody = z
  .object({
    /** The edited notes. Omit together with `regenerate` to leave them as they are. */
    notes: z.string().max(50_000).optional(),
    /** Rebuild the notes from the associated changes, discarding edits. */
    regenerate: z.literal(true).optional(),
  })
  .refine((value) => value.notes !== undefined || value.regenerate === true, {
    message: "Provide notes or regenerate",
  });

export const releaseChecklistParam = z.object({
  id: id,
  itemId: id,
});
export const toggleChecklistBody = z.object({ done: z.boolean() });

export const setWorkItemServiceBody = z.object({ serviceId: id.nullable() });

/** `CH-2` opt-in template: the projects that adopt the Approved state. */
export const applyCabTemplateBody = z.object({
  workspaceId: id,
  projectIds: z.array(id).min(1).max(200),
});
