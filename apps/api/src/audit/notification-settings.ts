import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Transaction } from "../database/executor";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { resolveIdentity } from "../permissions/resolve-identity";
import type { AppendAuditLogInput } from "./audit-writer";
import { requestAuditActor } from "./controllers/audit-read-common";

type Actor = Pick<
  AppendAuditLogInput,
  | "actorId"
  | "actorType"
  | "apiKeyId"
  | "impersonatorId"
  | "actorIp"
  | "userAgent"
  | "traceId"
>;
export type PersonalNotificationAudit = { actor: Actor; personId: string };
export type NotificationCategory =
  | "delivery"
  | "digest"
  | "quietHours"
  | "workspaceRule";

export async function staffNotificationAuditContext(
  c: Context,
): Promise<PersonalNotificationAudit> {
  const identity = await resolveIdentity({
    userId: c.get("userId") as string,
    credential: "session",
  });
  if (identity?.side !== "staff")
    throw new HTTPException(403, { message: "Forbidden" });
  return { actor: requestAuditActor(c), personId: identity.personId };
}

export async function appendPersonalNotificationAudit(
  tx: Transaction,
  audit: PersonalNotificationAudit | undefined,
  categories: readonly NotificationCategory[],
) {
  if (!audit || !categories.length) return false;
  return appendAuditSavepoint(tx, {
    ...audit.actor,
    workspaceId: null,
    action: "notification.settings_updated",
    entityType: "notification_preference",
    entityId: audit.personId,
    after: { changedCategories: [...categories] },
  });
}

export async function notifyPersonalNotificationAuditFailure(failed: boolean) {
  if (failed) await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
}
