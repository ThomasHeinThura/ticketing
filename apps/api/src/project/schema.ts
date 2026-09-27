import { z } from "../openapi";
import {
  MAX_WORK_ITEM_INSTANT_MS,
  MIN_WORK_ITEM_INSTANT_MS,
} from "../work-item/date-bounds";

export const projectParam = z.object({ id: z.string() });

// Issue #25's bounded slice (stakeholders, milestones, prerequisites, document links).
// Same ISO-8601 date-time hardening `work-item/schema.ts`'s `workItemDateTime` uses
// (Postgres `timestamp` range/rollover/NUL-byte pitfalls, S3/T1/T2 of PR #271's Opus
// review) -- reusing `date-bounds.ts`'s shared instant bounds rather than a second,
// independently-typed copy of the constants, so the two never drift.
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function isRealCalendarDateTime(match: RegExpMatchArray): boolean {
  const [, y, mo, d, h, mi, s, frac] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const millis = frac ? Number(frac.slice(1, 4).padEnd(3, "0")) : 0;

  const rebuilt = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millis),
  );
  return (
    rebuilt.getUTCFullYear() === year &&
    rebuilt.getUTCMonth() === month - 1 &&
    rebuilt.getUTCDate() === day &&
    rebuilt.getUTCHours() === hour &&
    rebuilt.getUTCMinutes() === minute &&
    rebuilt.getUTCSeconds() === second
  );
}

const projectDateTime = z
  .string()
  .regex(
    ISO_DATE_TIME_PATTERN,
    'must be an ISO-8601 date-time string, e.g. "2026-01-01T00:00:00.000Z"',
  )
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "must be a valid date-time",
  })
  .refine(
    (value) => {
      const match = value.match(ISO_DATE_TIME_PATTERN);
      return match !== null && isRealCalendarDateTime(match);
    },
    {
      message:
        "must be a real calendar date-time -- no rollover (e.g. February 31, hour 24)",
    },
  )
  .refine(
    (value) => {
      const ms = new Date(value).getTime();
      return ms >= MIN_WORK_ITEM_INSTANT_MS && ms <= MAX_WORK_ITEM_INSTANT_MS;
    },
    {
      message:
        "must be between 1900-01-01T00:00:00.000Z and 9999-12-31T23:59:59.999Z, as a UTC instant",
    },
  )
  .transform((value) => new Date(value));

export const milestoneParam = z.object({
  id: z.string(),
  milestoneId: z.string(),
});

export const prerequisiteParam = z.object({
  id: z.string(),
  prerequisiteId: z.string(),
});

export const stakeholderParam = z.object({
  id: z.string(),
  stakeholderId: z.string(),
});

export const documentLinkParam = z.object({
  id: z.string(),
  documentLinkId: z.string(),
});

export const createMilestoneBody = z.object({
  name: z.string().min(1),
  date: projectDateTime,
});

export const updateMilestoneBody = z
  .object({
    name: z.string().min(1).optional(),
    date: projectDateTime.optional(),
    // Sets or clears `reachedAt`: `true` stamps it "now"; `false` clears it back to
    // not-yet-reached. Projects-and-engagements.md: "The current milestone is derived
    // as the first not yet reached" -- this is the one field that moves that pointer.
    reached: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

const OWNER_SIDES = ["us", "customer", "both"] as const;

export const createPrerequisiteBody = z.object({
  title: z.string().min(1),
  ownerSide: z.enum(OWNER_SIDES),
  dueDate: projectDateTime.nullable().optional(),
  isBlocking: z.boolean().optional(),
});

export const updatePrerequisiteBody = z
  .object({
    title: z.string().min(1).optional(),
    ownerSide: z.enum(OWNER_SIDES).optional(),
    dueDate: projectDateTime.nullable().optional(),
    isBlocking: z.boolean().optional(),
    // `PR-11`: ticking off is staff-only, structurally -- see `prerequisiteTable`'s own
    // `database/schema.ts` comment. Sets or clears `completedAt`.
    completed: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

export const createStakeholderBody = z.object({
  personId: z.string(),
  role: z.string().min(1),
  escalationOrder: z.number().int().min(0),
  escalationWaitMinutes: z.number().int().min(0).optional(),
});

export const updateStakeholderBody = z
  .object({
    role: z.string().min(1).optional(),
    escalationOrder: z.number().int().min(0).optional(),
    escalationWaitMinutes: z.number().int().min(0).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

export const createDocumentLinkBody = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  customerVisible: z.boolean().optional(),
});

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const listProjectsQuery = z.object({
  workspaceId: z.string(),
  includeArchived: z.string().optional().openapi({
    description: 'Pass "true" to include archived projects in the list.',
  }),
});

export const createProjectBody = z.object({
  name: z.string(),
  workspaceId: z.string(),
  icon: z.string(),
  slug: z.string(),
});

export const updateProjectBody = z.object({
  name: z.string(),
  icon: z.string(),
  slug: z.string(),
  description: z.string(),
});

export const reorderProjectsBody = z.object({
  // Positions express a relative order only; the controller renumbers the
  // workspace to 0..n-1, so the values just have to be sane.
  projects: z
    .array(z.object({ id: z.string(), position: z.number().int().min(0) }))
    .min(1),
});
