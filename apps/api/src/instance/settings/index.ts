import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { AUDIT_ONLY_ACTIONS } from "../../audit/actions";
import { appendAuditLog } from "../../audit/audit-writer";
import db, { schema } from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../observability/runtime";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";
import {
  patchSettingsBody,
  type SettingsChanges,
  type SettingsResponse,
  settingsResponseSchema,
} from "./schema";

const errorSchema = z.object({ message: z.string() });
const conflictSchema = z.object({
  message: z.literal("version_conflict"),
  updatedAt: z.string().datetime(),
});

/** Audit action for a General/Storage settings change; see the coordinator diff note. */
const SETTINGS_AUDIT_ACTION = "instance.settings_changed";

const T = schema.instanceSettingTable;
const columns = {
  approvalDefaultExpiryDays: T.approvalDefaultExpiryDays,
  clarificationWindowDays: T.clarificationWindowDays,
  reopenWindowDays: T.reopenWindowDays,
  notificationRetentionDays: T.notificationRetentionDays,
  timezone: T.timezone,
  attachmentMaxBytes: T.attachmentMaxBytes,
  attachmentMaxPerItem: T.attachmentMaxPerItem,
  attachmentAllowedExtensions: T.attachmentAllowedExtensions,
  updatedAt: T.updatedAt,
};

async function readSettings(): Promise<SettingsResponse> {
  const [row] = await db
    .select(columns)
    .from(T)
    .where(sql`${T.id} = 'singleton'`)
    .limit(1);
  if (!row)
    throw new HTTPException(503, { message: "Instance settings unavailable" });
  const { updatedAt, ...settings } = row;
  return { updatedAt: updatedAt.toISOString(), settings };
}

const getRoute = createRoute({
  method: "get",
  operationId: "getInstanceSettings",
  path: "/settings",
  tags: ["Instance"],
  summary: "Get instance settings",
  responses: {
    200: jsonResponse("General and storage settings", settingsResponseSchema),
    403: jsonResponse("Forbidden", errorSchema),
    503: jsonResponse("Settings unavailable", errorSchema),
  },
});

const patchRoute = createRoute({
  method: "patch",
  operationId: "patchInstanceSettings",
  path: "/settings",
  tags: ["Instance"],
  summary: "Update instance settings",
  description:
    "Partial update with optimistic concurrency: `expectedUpdatedAt` must equal the stored value or the answer is 409. Every change is audited with the changed key names only.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: patchSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated settings", settingsResponseSchema),
    403: jsonResponse("Forbidden", errorSchema),
    409: jsonResponse("Changed by someone else", conflictSchema),
    503: jsonResponse("Settings unavailable", errorSchema),
  },
});

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/settings");
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(await readSettings(), 200);
  })
  .openapi(patchRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "PATCH", "/api/instance/settings");
    c.header("Cache-Control", "no-store");
    const { expectedUpdatedAt, changes } = c.req.valid("json");
    const changedKeys = Object.keys(changes) as Array<keyof SettingsChanges>;
    const updated = await db
      .update(T)
      .set(changes)
      .where(
        sql`${T.id} = 'singleton' AND date_trunc('milliseconds', ${T.updatedAt}) = (${expectedUpdatedAt}::timestamptz AT TIME ZONE 'UTC')`,
      )
      .returning({ id: T.id });
    if (updated.length === 0) {
      const current = await readSettings();
      return c.json(
        { message: "version_conflict" as const, updatedAt: current.updatedAt },
        409,
      );
    }
    if (AUDIT_ONLY_ACTIONS.has(SETTINGS_AUDIT_ACTION)) {
      try {
        await appendAuditLog(db, {
          action: SETTINGS_AUDIT_ACTION,
          actorId: c.get("userId"),
          actorType: "person",
          traceId: normaliseTraceId(c.req.header("x-request-id")),
          workspaceId: null,
          entityType: "instance",
          entityId: "singleton",
          before: null,
          after: { changedKeys },
        });
      } catch {
        recordAuditWriteFailure("mutation");
        await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
      }
    }
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(await readSettings(), 200);
  });

export default routes;
