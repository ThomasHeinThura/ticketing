import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { z } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";

/** First integrated external journey: explicit staff global mention email preferences. */
export const canonicalPreferenceWriteSchema = z
  .object({
    eventKind: z.literal("work_item.mentioned"),
    channel: z.literal("notify.email"),
    scope: z.literal("global"),
    scopeId: z.null(),
    enabled: z.boolean(),
    digest: z.literal("off"),
  })
  .strict();
export const canonicalPreferenceResponseSchema =
  canonicalPreferenceWriteSchema.extend({
    source: z.enum(["default", "global"]),
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
    await db.execute(sql`SELECT enabled FROM notification_preference
    WHERE person_id = ${personId} AND event_kind = 'work_item.mentioned' AND channel = 'notify.email' AND scope = 'global' AND scope_id IS NULL`);
  const row = result.rows[0] as { enabled: boolean } | undefined;
  return [
    {
      eventKind: "work_item.mentioned" as const,
      channel: "notify.email" as const,
      scope: "global" as const,
      scopeId: null,
      enabled: row?.enabled ?? true,
      digest: "off" as const,
      source: row ? ("global" as const) : ("default" as const),
    },
  ];
}
export async function saveCanonicalPreference(
  userId: string,
  input: CanonicalPreferenceWrite,
) {
  const personId = await staffPersonId(userId);
  const value = canonicalPreferenceWriteSchema.parse(input);
  await db.execute(sql`INSERT INTO notification_preference
    (person_id, scope, scope_id, channel, event_kind, enabled, digest)
    VALUES (${personId}, 'global', NULL, 'notify.email', 'work_item.mentioned', ${value.enabled}, 'off')
    ON CONFLICT (person_id, scope, scope_id, channel, event_kind) DO UPDATE SET enabled = EXCLUDED.enabled, digest = EXCLUDED.digest`);
}
