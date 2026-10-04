import { z } from "../openapi";
import { ALLOWED_URL_PROTOCOLS } from "../utils/assert-public-destination";
import {
  MAX_WORK_ITEM_INSTANT_MS,
  MIN_WORK_ITEM_INSTANT_MS,
} from "../work-item/date-bounds";

export const projectParam = z.object({ id: z.string() });

// S1 (Opus security review of PR #438): same NUL-byte rejection rule PR #271's Opus
// review set for `work-item/schema.ts` ("Postgres text/jsonb columns reject a NUL byte
// outright, which reached the database unvalidated and came back as a masked 500
// instead of this route's normal 400") -- mirrored here rather than imported, since
// `work-item/schema.ts` does not export its own copy.
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

/** A required, NUL-byte-safe, length-bounded text field -- the shape every string field
 * below needs (S1/S3, Opus review of PR #438). `max` defaults to 200, matching
 * `workspace/schema.ts`'s own short-label convention (`name`: 100, `role`: 100) scaled up
 * slightly for a title-like field; callers needing a different bound (a URL, a long
 * description) pass their own. */
function nulSafeText(max = 200) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE);
}

/** Same as `nulSafeText`, but for an id-shaped field that must not be empty-checked with
 * `.min(1)` beyond "not blank" and needs no content length bound beyond what a cuid2 (or
 * similar) id ever is -- matches `work-item/schema.ts`'s `projectIdParam`/`workItemKeyParam`
 * treatment of ids (NUL-byte refine only, no arbitrary max). */
const nulSafeId = z
  .string()
  .min(1)
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE);

// B2/S2 (Opus security review of PR #438, live-reproduced): `z.string().url()` alone
// accepts any URL scheme -- a `javascript:`/`data:` document link stored and later
// rendered by a client is a stored-XSS vector. Reuses `assert-public-destination.ts`'s
// own `ALLOWED_URL_PROTOCOLS` allowlist (the exact check that module already enforces
// for outbound webhook destinations) rather than a second, independently-typed scheme
// list -- but NOT that module's `assertPublicDestination` itself, which also does
// DNS/SSRF resolution appropriate for a URL this server actually FETCHES (a webhook
// destination); a document link is stored and never fetched server-side, so only the
// synchronous scheme check applies here.
const documentLinkUrl = z
  .string()
  .max(2048)
  .refine((value) => !containsNulByte(value), NO_NUL_BYTE_MESSAGE)
  .refine(
    (value) => {
      try {
        return (ALLOWED_URL_PROTOCOLS as readonly string[]).includes(
          new URL(value).protocol,
        );
      } catch {
        return false;
      }
    },
    { message: "must be an http(s) URL" },
  );

// S2 (Opus security review of PR #438, live-reproduced with 3000000000): the database
// column is a plain Postgres `integer` (max 2147483647); an out-of-range value reached
// the insert unvalidated and 500'd instead of this route's normal 400.
const PG_INTEGER_MAX = 2147483647;
const boundedNonNegativeInt = z.number().int().min(0).max(PG_INTEGER_MAX);

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

// F1 (delta Opus review of PR #438): these four path params are read directly by their
// controllers from `c.req.valid("param")`, never through `workspaceAccess.fromProject()`'s
// own NUL-byte guard (which only covers the shared `id` -- the project id -- via its
// `"project"` lookup case). `nulSafeId` closes the same gap here that `personId` (line
// ~207) already closed for a body field.
export const milestoneParam = z.object({
  id: z.string(),
  milestoneId: nulSafeId,
});

export const prerequisiteParam = z.object({
  id: z.string(),
  prerequisiteId: nulSafeId,
});

export const stakeholderParam = z.object({
  id: z.string(),
  stakeholderId: nulSafeId,
});

export const documentLinkParam = z.object({
  id: z.string(),
  documentLinkId: nulSafeId,
});

export const createMilestoneBody = z.object({
  name: nulSafeText(),
  date: projectDateTime,
});

export const updateMilestoneBody = z
  .object({
    name: nulSafeText().optional(),
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
  title: nulSafeText(),
  ownerSide: z.enum(OWNER_SIDES),
  dueDate: projectDateTime.nullable().optional(),
  isBlocking: z.boolean().optional(),
});

export const updatePrerequisiteBody = z
  .object({
    title: nulSafeText().optional(),
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
  personId: nulSafeId,
  role: nulSafeText(100),
  escalationOrder: boundedNonNegativeInt,
  escalationWaitMinutes: boundedNonNegativeInt.optional(),
});

export const updateStakeholderBody = z
  .object({
    role: nulSafeText(100).optional(),
    escalationOrder: boundedNonNegativeInt.optional(),
    escalationWaitMinutes: boundedNonNegativeInt.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

export const createDocumentLinkBody = z.object({
  url: documentLinkUrl,
  title: nulSafeText(),
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
  organisationId: z.string().nullable().optional(),
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
