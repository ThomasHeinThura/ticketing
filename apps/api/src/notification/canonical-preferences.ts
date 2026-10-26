import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { z } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";

/** First integrated external journey: explicit staff global mention email preferences. */
const canonicalPreferenceBaseSchema = z
  .object({
    eventKind: z.enum([
      "work_item.mentioned",
      "work_item.commented",
      "automation.notification_sent",
    ]),
    channel: z.literal("notify.email"),
    scope: z.literal("global"),
    scopeId: z.null(),
    enabled: z.boolean(),
    digest: z.enum(["off", "hourly", "daily"]),
  })
  .strict();
const validateDigestCadence = (value: {
  eventKind: string;
  digest: string;
  enabled: boolean;
}) => value.eventKind !== "work_item.mentioned" || value.digest === "off";
export const canonicalPreferenceWriteSchema =
  canonicalPreferenceBaseSchema.refine(validateDigestCadence, {
    message: "Direct mentions are sent immediately and cannot be digested",
  });
export const canonicalPreferenceResponseSchema = canonicalPreferenceBaseSchema
  .extend({
    source: z.enum(["default", "global"]),
  })
  .refine(validateDigestCadence, {
    message: "Direct mentions are sent immediately and cannot be digested",
  });
export type CanonicalPreferenceWrite = z.infer<
  typeof canonicalPreferenceWriteSchema
>;
async function staffPersonId(userId: string): Promise<string> {
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (identity?.side !== "staff")
    throw new HTTPException(403, { message: "Forbidden" });
  return identity.personId;
}
export async function getCanonicalPreferences(userId: string) {
  const personId = await staffPersonId(userId);
  const result =
    await db.execute(sql`SELECT event_kind AS "eventKind", enabled, digest
    FROM notification_preference
    WHERE person_id = ${personId}
      AND event_kind IN ('work_item.mentioned', 'work_item.commented', 'automation.notification_sent')
      AND channel = 'notify.email' AND scope = 'global' AND scope_id IS NULL`);
  const rows = result.rows as Array<{
    eventKind:
      | "work_item.mentioned"
      | "work_item.commented"
      | "automation.notification_sent";
    enabled: boolean;
    digest: "off" | "hourly" | "daily";
  }>;
  const byKind = new Map(rows.map((row) => [row.eventKind, row]));
  return (
    [
      "work_item.mentioned",
      "work_item.commented",
      "automation.notification_sent",
    ] as const
  ).map((eventKind) => {
    const row = byKind.get(eventKind);
    return {
      eventKind,
      channel: "notify.email" as const,
      scope: "global" as const,
      scopeId: null,
      // Preserve the existing mention default; comments default off like the
      // canonical event preference resolver.
      enabled: row?.enabled ?? eventKind === "work_item.mentioned",
      digest:
        eventKind === "work_item.mentioned"
          ? ("off" as const)
          : (row?.digest ?? "off"),
      source: row ? ("global" as const) : ("default" as const),
    };
  });
}
export async function saveCanonicalPreference(
  userId: string,
  input: CanonicalPreferenceWrite,
) {
  const personId = await staffPersonId(userId);
  const value = canonicalPreferenceWriteSchema.parse(input);
  await db.execute(sql`INSERT INTO notification_preference
    (person_id, scope, scope_id, channel, event_kind, enabled, digest)
    VALUES (${personId}, 'global', NULL, 'notify.email', ${value.eventKind}, ${value.enabled}, ${value.digest})
    ON CONFLICT (person_id, scope, scope_id, channel, event_kind) DO UPDATE SET enabled = EXCLUDED.enabled, digest = EXCLUDED.digest`);
}
