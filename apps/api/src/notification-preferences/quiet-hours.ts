import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { personTable } from "../database/schema";
import { parseClockMinutes } from "../notification/quiet-hours";
import { z } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";

/**
 * `NO-3` quiet hours, the person's own write path. The window is `HH:MM`..`HH:MM` (24-hour,
 * local) in an IANA time zone, stored on the person row (`quiet_hours_*`) that the external
 * delivery drain already reads at drain time, so a change applies to already-queued deliveries.
 *
 * Staff only (a customer has no agent preferences page), written for the caller's own person and
 * nobody else's. Both times and the zone are required together; `null` clears the window. The
 * zone is checked against the platform's IANA database, never a free string.
 */
export const quietHoursSchema = z
  .object({
    start: z.string().openapi({
      description: "Local start time, HH:MM (24-hour).",
      example: "22:00",
    }),
    end: z.string().openapi({
      description:
        "Local end time, HH:MM (24-hour). An end earlier than the start crosses midnight.",
      example: "07:00",
    }),
    timezone: z.string().openapi({
      description: "IANA time zone the two times are read in.",
      example: "Europe/Berlin",
    }),
  })
  .strict()
  .openapi("QuietHours");
export type QuietHours = z.infer<typeof quietHoursSchema>;

export function isIanaTimeZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > 64 || zone.includes("\0"))
    return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
  } catch {
    return false;
  }
  // The platform also accepts aliases such as "utc" and offsets; require a canonical name.
  return (
    zone === "UTC" ||
    (Intl.supportedValuesOf("timeZone") as string[]).includes(zone)
  );
}

/** Pure validation: the problem for an unusable window, or `null`. */
export function quietHoursProblem(value: QuietHours): string | null {
  const start = parseClockMinutes(value.start);
  const end = parseClockMinutes(value.end);
  if (start === null || end === null)
    return "start and end must be HH:MM, 00:00 to 23:59";
  if (start === end) return "start and end must differ";
  if (!isIanaTimeZone(value.timezone)) return "timezone must be an IANA name";
  return null;
}

async function staffPerson(userId: string) {
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (identity?.side !== "staff")
    throw new HTTPException(403, { message: "Forbidden" });
  return identity.personId;
}

export async function getQuietHours(
  userId: string,
): Promise<QuietHours | null> {
  const personId = await staffPerson(userId);
  const [row] = await db
    .select({
      start: personTable.quietHoursStart,
      end: personTable.quietHoursEnd,
      timezone: personTable.quietHoursTimezone,
    })
    .from(personTable)
    .where(eq(personTable.id, personId))
    .limit(1);
  if (!row?.start || !row.end) return null;
  return {
    start: row.start,
    end: row.end,
    timezone: row.timezone ?? "UTC",
  };
}

export async function saveQuietHours(
  userId: string,
  value: QuietHours | null,
): Promise<void> {
  const personId = await staffPerson(userId);
  if (value !== null) {
    const problem = quietHoursProblem(value);
    if (problem) throw new HTTPException(400, { message: problem });
  }
  await db
    .update(personTable)
    .set({
      quietHoursStart: value?.start ?? null,
      quietHoursEnd: value?.end ?? null,
      quietHoursTimezone: value?.timezone ?? null,
    })
    .where(eq(personTable.id, personId));
}
