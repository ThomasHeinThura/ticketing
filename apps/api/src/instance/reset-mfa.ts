import { isSmtpConfigured, sendNotificationEmail } from "@taskdesk/email";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import type { LocalFactorState } from "../auth/local-factor-service";
import { loadLocalFactorState } from "../auth/local-factor-service";
import { appendStepUpAudit } from "../auth/step-up-audit";
import { consumeMfaResetProof } from "../auth/step-up-service";
import db, { schema } from "../database";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireSessionOnly } from "../utils/require-session-only";
import { invalidateNativeAuthorization } from "../ws";
import {
  isCurrentInstanceAdmin,
  notifyCurrentInstanceAdminsOfAuditFailure,
} from "./observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "./observability/runtime";
import { getUserForMfaReset, lockUserTwoFactorEnabled } from "./repository";

const requestSchema = z
  .object({ verificationNote: z.string().trim().min(12).max(1000) })
  .strict();
const responseSchema = z.object({
  reset: z.literal(true),
  notificationEmailSent: z.boolean(),
});

class StepUpRejection extends Error {
  constructor(
    readonly status: 403 | 409,
    readonly message: string,
  ) {
    super(message);
  }
}

const resetRoute = createRoute({
  method: "post",
  operationId: "resetUserMfa",
  path: "/users/{id}/reset-mfa",
  tags: ["Instance"],
  summary: "Reset a user's local MFA factor",
  description:
    "Requires an elevated browser session and a recorded identity-verification note. Revokes the affected user's sessions and API keys.",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: requestSchema } },
    },
    headers: z.object({
      "x-taskdesk-step-up-token": z.string().min(1).max(128),
    }),
  },
  responses: {
    200: jsonResponse(
      "Factor reset; notification delivery result included",
      responseSchema,
    ),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    503: jsonResponse(
      "Required email service unavailable",
      z.object({ message: z.string() }),
    ),
  },
});

const resetMfa = apiRouter().openapi(resetRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  const session = c.get("session") as {
    portal?: string;
    impersonatedBy?: string | null;
  } | null;
  if (
    session?.portal !== "agent" ||
    session.impersonatedBy ||
    !(await isCurrentInstanceAdmin(c.get("userId")))
  ) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }
  if (!isSmtpConfigured())
    throw new HTTPException(503, {
      message: "Required notification service unavailable",
    });

  const { id } = c.req.valid("param");
  const { verificationNote } = c.req.valid("json");
  const [target] = await getUserForMfaReset(id);
  if (!target) throw new HTTPException(404, { message: "User not found" });
  let actorFactor: LocalFactorState;
  try {
    actorFactor = await loadLocalFactorState(c.get("userId"));
  } catch {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  let transactionResult:
    | { kind: "denied" }
    | { kind: "success"; wasEnabled: boolean };
  try {
    transactionResult = await db.transaction(async (tx) => {
      const proof = await consumeMfaResetProof(tx, {
        token: c.req.valid("header")["x-taskdesk-step-up-token"],
        personId: actorFactor.personId,
        sessionId: (c.get("session") as { id: string }).id,
        userId: id,
        verificationNote,
      });
      if (!proof) {
        await appendStepUpAudit(tx, {
          action: "auth.step_up_denied",
          actorId: c.get("userId"),
          personId: actorFactor.personId,
          operation: "mfa_reset",
          traceId: c.req.header("x-request-id"),
        });
        return { kind: "denied" as const };
      }
      if (
        (proof.authMethod === "password" &&
          (actorFactor.required || actorFactor.enabled)) ||
        ((proof.authMethod === "totp" || proof.authMethod === "backup_code") &&
          !actorFactor.enabled)
      ) {
        throw new StepUpRejection(403, "step_up_unavailable");
      }
      const [current] = await lockUserTwoFactorEnabled(tx, id);
      if (!current?.enabled)
        throw new StepUpRejection(409, "factor_reset_unavailable");
      await tx
        .delete(schema.twoFactorTable)
        .where(eq(schema.twoFactorTable.userId, id));
      await tx
        .update(schema.userTable)
        .set({ twoFactorEnabled: false })
        .where(eq(schema.userTable.id, id));
      await tx
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, id));
      await tx
        .delete(schema.apikeyTable)
        .where(eq(schema.apikeyTable.referenceId, id));
      await tx.insert(schema.notificationTable).values({
        userId: id,
        type: "security_alert",
        title: "Two-factor authentication reset",
        content:
          "An instance administrator reset your authenticator factor. Sign in and enroll a new factor before using protected features if instance policy requires it.",
        eventData: { kind: "mfa_reset" },
      });
      await appendStepUpAudit(tx, {
        action: "auth.step_up_consumed",
        actorId: c.get("userId"),
        personId: actorFactor.personId,
        operation: "mfa_reset",
        traceId: c.req.header("x-request-id"),
      });
      return { kind: "success" as const, wasEnabled: current.enabled === true };
    });
  } catch (error) {
    if (!(error instanceof StepUpRejection)) throw error;
    await appendStepUpAudit(db, {
      action: "auth.step_up_denied",
      actorId: c.get("userId"),
      personId: actorFactor.personId,
      operation: "mfa_reset",
      traceId: c.req.header("x-request-id"),
    });
    throw new HTTPException(error.status, { message: error.message });
  }

  if (transactionResult.kind === "denied")
    throw new HTTPException(403, { message: "step_up_unavailable" });
  const wasEnabled = transactionResult.wasEnabled;

  await invalidateNativeAuthorization({ userId: id });

  await appendAuditLog(db, {
    action: "auth.mfa_reset",
    actorId: c.get("userId"),
    actorType: "person",
    traceId: normaliseTraceId(c.req.header("x-request-id")),
    workspaceId: null,
    entityType: "person",
    entityId: id,
    before: { factorEnabled: wasEnabled },
    after: { factorEnabled: false, verificationNote },
  }).catch(async () => {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  });

  let emailSent = false;
  try {
    const result = await sendNotificationEmail(
      target.email,
      "TaskDesk security notice",
      {
        title: "Two-factor authentication reset",
        message:
          "An instance administrator reset the authenticator factor on your TaskDesk account. If you did not expect this, contact your instance administrator.",
        actionUrl: process.env.TASKDESK_AGENT_URL,
        locale: target.locale,
      },
    );
    emailSent = result.success === true;
  } catch {
    // The durable in-app notification and audit row are already committed. Do not
    // turn an SMTP failure into an API error that could imply the reset rolled back.
  }
  setShadowLegacyAuthorization(c, "allowed");
  return c.json({ reset: true, notificationEmailSent: emailSent }, 200);
});

export default resetMfa;
