import { sendNotificationEmail } from "@taskdesk/email";
import { eq, sql } from "drizzle-orm";
import { appendAuditLog } from "../../audit/audit-writer";
import db, { schema } from "../../database";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../observability/runtime";

export type ImpersonationEndReason = "exit" | "cap";

type StartedRow = {
  startedAt: string;
  reason: string | null;
  sessionId: string;
  expiresAt: string | null;
};

/** The recorded start of an impersonation session (GM-7), read back from the audit trail. */
export async function findImpersonationStart(
  sessionId: string,
): Promise<StartedRow | null> {
  const result = await db.execute(
    sql`SELECT created_at, after FROM audit_log
        WHERE action = 'impersonation.started' AND after->>'sessionId' = ${sessionId}
        ORDER BY seq DESC LIMIT 1`,
  );
  const row = result.rows[0] as
    | { created_at: string | Date; after: Record<string, unknown> | null }
    | undefined;
  if (!row) return null;
  const after = row.after ?? {};
  return {
    startedAt: new Date(row.created_at).toISOString(),
    reason: typeof after.reason === "string" ? after.reason : null,
    sessionId,
    expiresAt: typeof after.expiresAt === "string" ? after.expiresAt : null,
  };
}

/**
 * `GM-9` / `GM-11`: records `impersonation.ended` once per session and tells the impersonated
 * person, in-app and by email, when the session ended, with the start and end times and the
 * reason recorded at start. Idempotent per session (exit, cap sweep and a racing request all
 * converge on one row): the check and the insert run under a per-session advisory lock.
 */
export async function finishImpersonation(input: {
  sessionId: string;
  targetUserId: string;
  impersonatorUserId: string;
  endReason: ImpersonationEndReason;
  traceId?: string | null;
}): Promise<{ recorded: boolean }> {
  const start = await findImpersonationStart(input.sessionId);
  const endedAt = new Date();
  const recorded = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`impersonation-end:${input.sessionId}`}))`,
    );
    const existing = await tx.execute(
      sql`SELECT 1 FROM audit_log
          WHERE action = 'impersonation.ended' AND after->>'sessionId' = ${input.sessionId}
          LIMIT 1`,
    );
    if (existing.rows.length > 0) return false;
    await appendAuditLog(tx, {
      action: "impersonation.ended",
      actorId: input.impersonatorUserId,
      actorType: "person",
      impersonatorId: null,
      traceId: input.traceId ?? null,
      workspaceId: null,
      entityType: "user",
      entityId: input.targetUserId,
      after: {
        sessionId: input.sessionId,
        reason: input.endReason,
        startedAt: start?.startedAt ?? null,
        endedAt: endedAt.toISOString(),
      },
    });
    return true;
  });
  if (!recorded) return { recorded: false };

  await db
    .delete(schema.sessionTable)
    .where(eq(schema.sessionTable.id, input.sessionId))
    .catch(() => undefined);

  const [target] = await db
    .select({
      email: schema.userTable.email,
      locale: schema.userTable.locale,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, input.targetUserId))
    .limit(1);
  const [impersonator] = await db
    .select({ name: schema.userTable.name })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, input.impersonatorUserId))
    .limit(1);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, input.targetUserId))
    .limit(1);
  const startedText = start?.startedAt ?? "an unrecorded time";
  const endedText = endedAt.toISOString();
  const reasonText = start?.reason ?? "no reason was recorded";
  const message = `An instance administrator (${
    impersonator?.name ?? "unknown"
  }) viewed TaskDesk as you from ${startedText} to ${endedText}. Reason recorded: ${reasonText}. If you did not expect this, contact your instance administrator.`;
  await db
    .insert(schema.notificationTable)
    .values({
      userId: input.targetUserId,
      personId: person?.id ?? null,
      type: "security_alert",
      title: "An administrator viewed your account",
      content: message,
      eventData: {
        kind: "impersonation_ended",
        startedAt: start?.startedAt ?? null,
        endedAt: endedText,
        reason: start?.reason ?? null,
        endReason: input.endReason,
      },
      resourceId: input.sessionId,
      resourceType: "impersonation",
    })
    .catch(async () => {
      recordAuditWriteFailure("mutation");
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    });
  if (target?.email) {
    try {
      await sendNotificationEmail(target.email, "TaskDesk security notice", {
        title: "An administrator viewed your account",
        message,
        actionUrl: process.env.TASKDESK_AGENT_URL,
        locale: target.locale,
      });
    } catch {
      // The in-app notification and audit row are durable; SMTP failure must not undo the end.
    }
  }
  return { recorded: true };
}

/**
 * Ends every impersonation session whose recorded cap has passed without an `ended` row
 * (administrator closed the tab, or the request-time check never ran). Driven by the audit
 * rows, not the session table, so it still works after session cleanup removed the row.
 */
export async function sweepExpiredImpersonations(limit = 50): Promise<number> {
  const result = await db.execute(
    sql`SELECT s.entity_id AS target_user_id, s.actor_id AS impersonator_id,
               s.after->>'sessionId' AS session_id
        FROM audit_log s
        WHERE s.action = 'impersonation.started'
          AND s.created_at > now() - interval '3 days'
          AND (s.after->>'expiresAt')::timestamptz < now()
          AND NOT EXISTS (
            SELECT 1 FROM audit_log e
            WHERE e.action = 'impersonation.ended'
              AND e.after->>'sessionId' = s.after->>'sessionId'
          )
        ORDER BY s.seq ASC
        LIMIT ${limit}`,
  );
  let ended = 0;
  for (const row of result.rows as {
    target_user_id: string;
    impersonator_id: string;
    session_id: string;
  }[]) {
    const outcome = await finishImpersonation({
      sessionId: row.session_id,
      targetUserId: row.target_user_id,
      impersonatorUserId: row.impersonator_id,
      endReason: "cap",
    });
    if (outcome.recorded) ended += 1;
  }
  return ended;
}
