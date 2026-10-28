import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { z } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";

/**
 * Staff global email preferences the settings screen edits. `report.export_ready` (RP-10,
 * P5-R3-02) is the "export ready" email: it is sent at once or not at all, so it has no digest.
 */
const CANONICAL_EVENT_KINDS = [
  "work_item.mentioned",
  "work_item.commented",
  "automation.notification_sent",
  "report.export_ready",
] as const;
type CanonicalEventKind = (typeof CANONICAL_EVENT_KINDS)[number];
/** Kinds that are always sent immediately and cannot be digested. */
const IMMEDIATE_ONLY_KINDS: ReadonlySet<string> = new Set([
  "work_item.mentioned",
  "report.export_ready",
]);
/** On without a stored row: mentions (NO-1) and the export-ready email RP-10 promises. */
const DEFAULT_ON_KINDS: ReadonlySet<string> = new Set([
  "work_item.mentioned",
  "report.export_ready",
]);
/** Whether a kind's email is sent when the person has stored no preference for it. */
export const canonicalEmailDefaultEnabled = (eventKind: string): boolean =>
  DEFAULT_ON_KINDS.has(eventKind);
const canonicalPreferenceBaseSchema = z
  .object({
    eventKind: z.enum(CANONICAL_EVENT_KINDS),
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
}) => !IMMEDIATE_ONLY_KINDS.has(value.eventKind) || value.digest === "off";
export const canonicalPreferenceWriteSchema =
  canonicalPreferenceBaseSchema.refine(validateDigestCadence, {
    message:
      "Direct mentions and export-ready emails are sent immediately and cannot be digested",
  });
export const canonicalPreferenceResponseSchema = canonicalPreferenceBaseSchema
  .extend({
    source: z.enum(["default", "global"]),
  })
  .refine(validateDigestCadence, {
    message:
      "Direct mentions and export-ready emails are sent immediately and cannot be digested",
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
      AND event_kind IN ('work_item.mentioned', 'work_item.commented', 'automation.notification_sent', 'report.export_ready')
      AND channel = 'notify.email' AND scope = 'global' AND scope_id IS NULL`);
  const rows = result.rows as Array<{
    eventKind: CanonicalEventKind;
    enabled: boolean;
    digest: "off" | "hourly" | "daily";
  }>;
  const byKind = new Map(rows.map((row) => [row.eventKind, row]));
  return CANONICAL_EVENT_KINDS.map((eventKind) => {
    const row = byKind.get(eventKind);
    return {
      eventKind,
      channel: "notify.email" as const,
      scope: "global" as const,
      scopeId: null,
      // Mentions and export-ready emails default on; comments and team
      // notifications default off like the canonical event preference resolver.
      enabled: row?.enabled ?? canonicalEmailDefaultEnabled(eventKind),
      digest: IMMEDIATE_ONLY_KINDS.has(eventKind)
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
