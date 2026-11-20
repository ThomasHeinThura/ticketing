import { and, desc, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../auth";
import db from "../database";
import {
  auditLogTable,
  personTable,
  sessionTable,
  userTable,
} from "../database/schema";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { dbNowUtc } from "../utils/db-time";
import { requireSessionOnly } from "../utils/require-session-only";
import { writeAuditRead } from "./controllers/audit-read-common";
import { safePreferenceAuditFields } from "./settings-history";

const PROFILE_FIELDS = new Set(["name", "locale", "image"]);
const NOTIFICATION_CATEGORIES = new Set([
  "delivery",
  "digest",
  "quietHours",
  "workspaceRule",
]);
const profileSection = z.enum([
  "profile",
  "preferences",
  "notifications",
  "security",
  "apiKeys",
]);
const portalSection = z.enum(["profile", "notifications", "security"]);
export const personalSettingsHistoryResponseSchema = z.strictObject({
  section: profileSection,
  lastChanged: z
    .strictObject({ at: z.string(), actor: z.literal("you") })
    .nullable(),
  rows: z.array(
    z.strictObject({
      at: z.string(),
      actor: z.literal("you"),
      changedFields: z
        .array(
          z.enum([
            "name",
            "locale",
            "image",
            "density",
            "layout",
            "listGroups",
            "columns",
            "columnWidths",
          ]),
        )
        .optional(),
      changedCategories: z
        .array(
          z.enum([
            "delivery",
            "digest",
            "quietHours",
            "workspaceRule",
            "password",
            "mfa",
            "personalKey",
          ]),
        )
        .optional(),
    }),
  ),
});

export function safePersonalHistoryFields(action: string, after: unknown) {
  if (action === "auth.password_changed")
    return { changedCategories: ["password"] };
  if (action === "auth.mfa_enrolled") return { changedCategories: ["mfa"] };
  if (action === "api_key.created" || action === "api_key.revoked")
    return { changedCategories: ["personalKey"] };
  if (action === "user_preference.updated")
    return { changedFields: safePreferenceAuditFields(after) };
  const data =
    after && typeof after === "object"
      ? (after as Record<string, unknown>)
      : {};
  const values =
    action === "notification.settings_updated"
      ? data.changedCategories
      : data.changedFields;
  const allowed =
    action === "notification.settings_updated"
      ? NOTIFICATION_CATEGORIES
      : PROFILE_FIELDS;
  const names = Array.isArray(values)
    ? [
        ...new Set(
          values.filter(
            (value): value is string =>
              typeof value === "string" && allowed.has(value),
          ),
        ),
      ]
    : [];
  return action === "notification.settings_updated"
    ? { changedCategories: names }
    : { changedFields: names };
}

const staffRoute = createRoute({
  method: "get",
  operationId: "getOwnSettingsHistory",
  path: "/me/settings/history",
  tags: ["Audit"],
  summary: "Read the current staff person's settings metadata",
  middleware: [requireSessionOnly()] as const,
  request: { query: z.strictObject({ section: profileSection }) },
  responses: {
    200: jsonResponse(
      "Closed personal settings history",
      personalSettingsHistoryResponseSchema,
    ),
    403: errorResponse("Session required"),
    404: errorResponse("Not found"),
  },
});
const portalRoute = createRoute({
  method: "get",
  operationId: "getPortalOwnSettingsHistory",
  path: "/portal/account/settings-history",
  tags: ["Audit"],
  summary: "Read the current customer's settings metadata",
  middleware: [requireSessionOnly()] as const,
  request: { query: z.strictObject({ section: portalSection }) },
  responses: {
    200: jsonResponse(
      "Closed personal settings history",
      personalSettingsHistoryResponseSchema,
    ),
    403: errorResponse("Session required"),
    404: errorResponse("Not found"),
  },
});

async function read(
  c: Context,
  section: "profile" | "preferences" | "notifications" | "security" | "apiKeys",
  side: "staff" | "customer",
) {
  const session = c.get("session") as {
    id?: string;
    portal?: string;
    impersonatedBy?: string | null;
  } | null;
  const host = portalForHost(c.req.header("host"));
  if (
    host !== (side === "staff" ? "agent" : "customer") ||
    !session?.id ||
    session?.portal !== (side === "staff" ? "agent" : "customer") ||
    session?.impersonatedBy ||
    c.get("apiKey")
  )
    throw new HTTPException(404, { message: "Not found" });
  const userId = c.get("userId") as string;
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity || identity.side !== side)
    throw new HTTPException(404, { message: "Not found" });
  const action =
    section === "profile"
      ? "user.profile_updated"
      : section === "preferences"
        ? "user_preference.updated"
        : section === "notifications"
          ? "notification.settings_updated"
          : null;
  const entityType =
    section === "profile"
      ? "user_profile"
      : section === "preferences"
        ? "user_preference"
        : section === "notifications"
          ? "notification_preference"
          : section === "security"
            ? "person"
            : "api_key";
  const selfSession = alias(sessionTable, "history_self_session");
  const selfUser = alias(userTable, "history_self_user");
  const selfPerson = alias(personTable, "history_self_person");
  const currentSelf = exists(
    db
      .select({ one: sql`1` })
      .from(selfSession)
      .innerJoin(selfUser, eq(selfUser.id, selfSession.userId))
      .innerJoin(selfPerson, eq(selfPerson.userId, selfUser.id))
      .where(
        and(
          eq(selfSession.id, session.id),
          eq(selfSession.userId, userId),
          eq(selfSession.portal, side === "staff" ? "agent" : "customer"),
          isNull(selfSession.impersonatedBy),
          sql`${selfSession.expiresAt} > ${dbNowUtc()}`,
          sql`${selfUser.banned} is not true`,
          eq(selfPerson.id, identity.personId),
          eq(selfPerson.side, side),
          eq(selfPerson.active, true),
        ),
      ),
  );
  const records = await db
    .select({
      createdAt: auditLogTable.createdAt,
      action: auditLogTable.action,
      after: auditLogTable.after,
    })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actorId, userId),
        eq(auditLogTable.actorType, "person"),
        eq(auditLogTable.entityType, entityType),
        section === "apiKeys"
          ? undefined
          : eq(
              auditLogTable.entityId,
              section === "security" ? userId : identity.personId,
            ),
        section === "security"
          ? inArray(
              auditLogTable.action,
              side === "staff"
                ? ["auth.password_changed", "auth.mfa_enrolled"]
                : ["auth.password_changed"],
            )
          : section === "apiKeys"
            ? inArray(auditLogTable.action, [
                "api_key.created",
                "api_key.revoked",
              ])
            : eq(auditLogTable.action, action as string),
        section === "apiKeys"
          ? sql`${auditLogTable.after} ->> 'kind' = ${"personal"}`
          : undefined,
        section === "security" || section === "apiKeys"
          ? isNull(auditLogTable.impersonatorId)
          : undefined,
        currentSelf,
        isNull(auditLogTable.workspaceId),
        isNull(auditLogTable.projectId),
      ),
    )
    .orderBy(desc(auditLogTable.seq))
    .limit(200);
  await writeAuditRead(c, { workspaceId: null });
  setShadowLegacyAuthorization(c, "allowed");
  c.header("Cache-Control", "no-store");
  const rows = records.map((row) => ({
    at: row.createdAt.toISOString(),
    actor: "you" as const,
    ...safePersonalHistoryFields(row.action, row.after),
  }));
  return {
    section,
    lastChanged: rows[0] ? { at: rows[0].at, actor: "you" as const } : null,
    rows,
  };
}

export const personalSettingsHistory = apiRouter()
  .openapi(staffRoute, async (c) =>
    c.json(
      personalSettingsHistoryResponseSchema.parse(
        await read(c, c.req.valid("query").section, "staff"),
      ),
      200,
    ),
  )
  .openapi(portalRoute, async (c) =>
    c.json(
      personalSettingsHistoryResponseSchema.parse(
        await read(c, c.req.valid("query").section, "customer"),
      ),
      200,
    ),
  );
