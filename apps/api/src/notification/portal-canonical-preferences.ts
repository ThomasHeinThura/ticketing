import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import db from "../database";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { requireSessionOnly } from "../utils/require-session-only";

const preferenceBaseSchema = z
  .object({
    eventKind: z.enum(["work_item.mentioned", "work_item.commented"]),
    channel: z.literal("notify.email"),
    scope: z.literal("global"),
    scopeId: z.null(),
    enabled: z.boolean(),
    digest: z.enum(["off", "hourly", "daily"]),
  })
  .strict();
const preferenceSchema = preferenceBaseSchema.refine(
  (value) =>
    value.eventKind !== "work_item.mentioned" || value.digest === "off",
  {
    message: "Direct mentions are sent immediately and cannot be digested",
  },
);
const responseSchema = preferenceBaseSchema
  .extend({
    source: z.enum(["default", "global"]),
  })
  .refine(
    (value) =>
      value.eventKind !== "work_item.mentioned" || value.digest === "off",
    {
      message: "Direct mentions are sent immediately and cannot be digested",
    },
  );
const responseListSchema = z.array(responseSchema);

async function customerPersonId(
  userId: string,
  host: string | undefined,
  sessionValue: unknown,
) {
  const session = sessionValue as { portal?: string } | null;
  if (portalForHost(host) !== "customer" || session?.portal !== "customer")
    throw new HTTPException(404, { message: "Not found" });
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (identity?.side !== "customer")
    throw new HTTPException(404, { message: "Not found" });
  return identity.personId;
}

async function getPreferences(personId: string) {
  const result =
    await db.execute(sql`SELECT event_kind AS "eventKind", enabled, digest
    FROM notification_preference
    WHERE person_id = ${personId}
      AND event_kind IN ('work_item.mentioned', 'work_item.commented')
      AND channel = 'notify.email' AND scope = 'global' AND scope_id IS NULL`);
  const rows = result.rows as Array<{
    eventKind: "work_item.mentioned" | "work_item.commented";
    enabled: boolean;
    digest: "off" | "hourly" | "daily";
  }>;
  const byKind = new Map(rows.map((row) => [row.eventKind, row]));
  return (["work_item.mentioned", "work_item.commented"] as const).map(
    (eventKind) => {
      const row = byKind.get(eventKind);
      return {
        eventKind,
        channel: "notify.email" as const,
        scope: "global" as const,
        scopeId: null,
        enabled: row?.enabled ?? eventKind === "work_item.mentioned",
        digest:
          eventKind === "work_item.mentioned"
            ? ("off" as const)
            : (row?.digest ?? "off"),
        source: row ? ("global" as const) : ("default" as const),
      };
    },
  );
}

const getRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "getPortalCanonicalNotificationPreferences",
  tags: ["Notification Preferences"],
  summary: "Get portal email preferences",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse(
      "Current customer's canonical email preferences",
      responseListSchema,
    ),
    404: errorResponse("Not found"),
  },
});
const putRoute = createRoute({
  method: "put",
  path: "/",
  operationId: "updatePortalCanonicalNotificationPreference",
  tags: ["Notification Preferences"],
  summary: "Update a portal email preference",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: preferenceSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated customer email preferences", responseListSchema),
    400: errorResponse("Invalid request"),
    404: errorResponse("Not found"),
  },
});

export const portalCanonicalPreferences = apiRouter()
  .openapi(getRoute, async (c) => {
    const personId = await customerPersonId(
      c.get("userId"),
      c.req.header("host"),
      c.get("session"),
    );
    c.header("Cache-Control", "no-store");
    return c.json(await getPreferences(personId), 200);
  })
  .openapi(putRoute, async (c) => {
    const personId = await customerPersonId(
      c.get("userId"),
      c.req.header("host"),
      c.get("session"),
    );
    const value = preferenceSchema.parse(c.req.valid("json"));
    await db.execute(sql`INSERT INTO notification_preference
      (person_id, scope, scope_id, channel, event_kind, enabled, digest)
      VALUES (${personId}, 'global', NULL, 'notify.email', ${value.eventKind}, ${value.enabled}, ${value.digest})
      ON CONFLICT (person_id, scope, scope_id, channel, event_kind)
      DO UPDATE SET enabled = EXCLUDED.enabled, digest = EXCLUDED.digest`);
    c.header("Cache-Control", "no-store");
    return c.json(await getPreferences(personId), 200);
  });

export default portalCanonicalPreferences;
