import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import db from "../database";
import { personTable } from "../database/schema";
import {
  quietHoursProblem,
  quietHoursSchema,
} from "../notification-preferences/quiet-hours";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { requireSessionOnly } from "../utils/require-session-only";
import { defaultExternalPreference } from "./preferences";

const CUSTOMER_EVENTS = [
  "work_item.mentioned",
  "work_item.commented",
  "work_item.transitioned",
  "approval.requested",
  "approval.expiring",
  "approval.withdrawn",
  "submission.replied",
  "submission.accepted",
  "submission.declined",
] as const;
type CustomerEvent = (typeof CUSTOMER_EVENTS)[number];
const immediateOnly = (kind: string) =>
  kind === "work_item.mentioned" || kind === "approval.expiring";

const preferenceBaseSchema = z
  .object({
    eventKind: z.enum(CUSTOMER_EVENTS),
    channel: z.literal("notify.email"),
    scope: z.literal("global"),
    scopeId: z.null(),
    enabled: z.boolean(),
    digest: z.enum(["off", "hourly", "daily"]),
  })
  .strict();
const preferenceSchema = preferenceBaseSchema.refine(
  (value) => !immediateOnly(value.eventKind) || value.digest === "off",
  {
    message: "Urgent events are sent immediately and cannot be digested",
  },
);
const responseSchema = preferenceBaseSchema
  .extend({
    source: z.enum(["default", "global"]),
  })
  .refine(
    (value) => !immediateOnly(value.eventKind) || value.digest === "off",
    {
      message: "Urgent events are sent immediately and cannot be digested",
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
      AND event_kind IN ('work_item.mentioned', 'work_item.commented', 'work_item.transitioned', 'approval.requested', 'approval.expiring', 'approval.withdrawn', 'submission.replied', 'submission.accepted', 'submission.declined')
      AND channel = 'notify.email' AND scope = 'global' AND scope_id IS NULL`);
  const rows = result.rows as Array<{
    eventKind: CustomerEvent;
    enabled: boolean;
    digest: "off" | "hourly" | "daily";
  }>;
  const byKind = new Map(rows.map((row) => [row.eventKind, row]));
  return CUSTOMER_EVENTS.map((eventKind) => {
    const row = byKind.get(eventKind);
    return {
      eventKind,
      channel: "notify.email" as const,
      scope: "global" as const,
      scopeId: null,
      enabled:
        row?.enabled ??
        defaultExternalPreference(eventKind, "notify.email").enabled,
      digest: immediateOnly(eventKind)
        ? ("off" as const)
        : (row?.digest ?? "off"),
      source: row ? ("global" as const) : ("default" as const),
    };
  });
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

const quietHoursGetRoute = createRoute({
  method: "get",
  path: "/quiet-hours",
  operationId: "getPortalNotificationQuietHours",
  tags: ["Notification Preferences"],
  summary: "Get portal quiet hours",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse(
      "Current customer quiet hours",
      quietHoursSchema.nullable(),
    ),
    404: errorResponse("Not found"),
  },
});
const quietHoursPutRoute = createRoute({
  method: "put",
  path: "/quiet-hours",
  operationId: "updatePortalNotificationQuietHours",
  tags: ["Notification Preferences"],
  summary: "Update portal quiet hours",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ quietHours: quietHoursSchema.nullable() })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated customer quiet hours",
      quietHoursSchema.nullable(),
    ),
    400: errorResponse("Invalid quiet hours"),
    404: errorResponse("Not found"),
  },
});
async function readQuietHours(personId: string) {
  const [row] = await db
    .select({
      start: personTable.quietHoursStart,
      end: personTable.quietHoursEnd,
      timezone: personTable.quietHoursTimezone,
    })
    .from(personTable)
    .where(eq(personTable.id, personId))
    .limit(1);
  return row?.start && row.end
    ? { start: row.start, end: row.end, timezone: row.timezone ?? "UTC" }
    : null;
}

function portalEmailPreferenceRoutes(prefix: "Portal" | "PortalCanonical") {
  return apiRouter()
    .openapi(
      createRoute({
        ...getRoute,
        operationId: `get${prefix}NotificationPreferences`,
      }),
      async (c) => {
        const personId = await customerPersonId(
          c.get("userId"),
          c.req.header("host"),
          c.get("session"),
        );
        c.header("Cache-Control", "no-store");
        return c.json(await getPreferences(personId), 200);
      },
    )
    .openapi(
      createRoute({
        ...putRoute,
        operationId: `update${prefix}NotificationPreference`,
      }),
      async (c) => {
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
      },
    );
}

export const portalNotificationPreferences =
  portalEmailPreferenceRoutes("Portal");

export const portalCanonicalPreferences = apiRouter()
  .openapi(quietHoursGetRoute, async (c) => {
    const personId = await customerPersonId(
      c.get("userId"),
      c.req.header("host"),
      c.get("session"),
    );
    c.header("Cache-Control", "no-store");
    return c.json(await readQuietHours(personId), 200);
  })
  .openapi(quietHoursPutRoute, async (c) => {
    const personId = await customerPersonId(
      c.get("userId"),
      c.req.header("host"),
      c.get("session"),
    );
    const { quietHours } = c.req.valid("json");
    const problem = quietHours && quietHoursProblem(quietHours);
    if (problem) throw new HTTPException(400, { message: problem });
    await db
      .update(personTable)
      .set({
        quietHoursStart: quietHours?.start ?? null,
        quietHoursEnd: quietHours?.end ?? null,
        quietHoursTimezone: quietHours?.timezone ?? null,
      })
      .where(eq(personTable.id, personId));
    c.header("Cache-Control", "no-store");
    return c.json(await readQuietHours(personId), 200);
  })
  .route("/", portalEmailPreferenceRoutes("PortalCanonical"));

export default portalCanonicalPreferences;
