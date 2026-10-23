import db, { schema } from "../database";
import { logTaskDesk } from "../instance/observability/runtime";
import {
  type ScimAuthFailureCause,
  scimAuthFailureCause,
} from "./scim-authentication";
import { WindowCounter } from "./scim-limits";

/**
 * `IP-24`: a failed SCIM bearer authentication writes a `provisioning_event` (`auth.failed`)
 * whenever the failure can be attributed to a connection (the credential matched a stored
 * connection that is disabled or invalid). `provisioning_event.identity_connection_id` is
 * NOT NULL, so an unknown or rotated token, which resolves to no connection, writes no row;
 * those are counted only by the anonymous-class limiter (`scim-limits.ts`).
 *
 * The row carries a bounded reason, never the token, its digest or its prefix. Writes are
 * budgeted per connection so a flood of failures cannot amplify into unbounded inserts, and
 * they run outside the request's own work so the 401 never depends on the insert.
 */
const eventBudget = new WindowCounter(10, 60_000);

export async function recordScimAuthFailure(error: unknown): Promise<void> {
  const cause: ScimAuthFailureCause | null = scimAuthFailureCause(error);
  if (!cause) return;
  if (!eventBudget.hit(cause.connectionId).allowed) return;
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
