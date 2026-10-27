import db, { schema } from "../database";
import { logTaskDesk } from "../instance/observability/runtime";
import {
  type ScimAuthFailureCause,
  scimAuthFailureCause,
} from "./scim-authentication";

/** IP-24: bounded failure metadata only; no request or credential data is persisted. */

export async function recordScimAuthFailure(error: unknown): Promise<void> {
  const cause: ScimAuthFailureCause | null = scimAuthFailureCause(error);
  if (!cause) return;
  try {
    await db.insert(schema.provisioningEventTable).values({
      identityConnectionId: cause.connectionId,
      kind: "auth.failed",
      outcome: "failed",
      detail: { reason: cause.reason },
      actorType: "scim",
    });
  } catch {
    logTaskDesk({
      module: "auth",
      message: "auth.failure",
      level: "error",
      result: "degraded",
    });
  }
}

export type ScimDenialReason =
  | "rate_limited"
  | "request_too_large"
  | "request_rejected"
  | "forbidden_attribute"
  | "authorization_denied";

export async function recordScimRequestDenied(
  connectionId: string | null,
  reason: ScimDenialReason,
): Promise<void> {
  try {
    await db.insert(schema.provisioningEventTable).values({
      identityConnectionId: connectionId,
      kind: "request.denied",
      outcome: "denied",
      detail: { reason },
      actorType: "scim",
    });
  } catch {
    logTaskDesk({
      module: "auth",
      message: "auth.failure",
      level: "error",
      result: "degraded",
    });
  }
}
