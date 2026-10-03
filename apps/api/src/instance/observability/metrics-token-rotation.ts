import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import type { LocalFactorState } from "../../auth/local-factor-service";
import { loadLocalFactorState } from "../../auth/local-factor-service";
import { appendStepUpAudit } from "../../auth/step-up-audit";
import { consumeRotationProof, sha256 } from "../../auth/step-up-service";
import db, { schema } from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { requireSessionOnly } from "../../utils/require-session-only";
import {
  isCurrentInstanceAdmin,
  notifyCurrentInstanceAdminsOfAuditFailure,
} from "./audit-failure-notifier";
import { recordAuditWriteFailure } from "./runtime";

const requestSchema = z
  .object({ version: z.number().int().positive().safe() })
  .strict();
const responseSchema = z.object({
  version: z.number().int().positive().safe(),
  token: z.string().length(43),
  metricsTokenRotatedAt: z.string().datetime(),
});

class VersionConflict extends Error {
  constructor(readonly version: number) {
    super("version_conflict");
  }
}

class StepUpPolicyDenied extends Error {}

const rotateRoute = createRoute({
  method: "post",
  operationId: "rotateMetricsToken",
  path: "/observability/metrics-token/rotate",
  tags: ["Instance"],
  summary: "Rotate the metrics scrape token",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: requestSchema } },
    },
  },
  responses: {
    200: jsonResponse("New metrics token, returned once", responseSchema),
    403: jsonResponse("Step-up unavailable", z.object({ message: z.string() })),
    409: jsonResponse(
      "Version conflict",
      z.object({
        message: z.literal("version_conflict"),
        version: z.number().int().positive().safe(),
      }),
    ),
  },
});

const routes = apiRouter().openapi(rotateRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  const session = c.get("session") as {
    id: string;
    portal?: unknown;
    impersonatedBy?: string | null;
  } | null;
  if (!session || session.portal !== "agent" || session.impersonatedBy) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "session_required" });
  }
  if (!(await isCurrentInstanceAdmin(c.get("userId")))) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Forbidden" });
  }
  const input = c.req.valid("json");
  const rawToken = randomBytes(32);
  const token = rawToken.toString("base64url");
  const tokenHash = sha256(rawToken);
  let factor: LocalFactorState;
  try {
    factor = await loadLocalFactorState(c.get("userId"));
  } catch {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  try {
    const result = await db.transaction(async (tx) => {
      const proof = await consumeRotationProof(tx, {
        token: c.req.header("X-TaskDesk-Step-Up-Token") ?? "",
        personId: factor.personId,
        sessionId: session.id,
        version: input.version,
      });
      if (!proof) {
        await appendStepUpAudit(tx, {
          action: "auth.step_up_denied",
          actorId: c.get("userId"),
          personId: factor.personId,
          operation: "metrics_token_rotate",
          traceId: c.req.header("x-request-id"),
        });
        return { kind: "denied" as const };
      }
      if (
        (proof.authMethod === "password" &&
          (factor.required || factor.enabled)) ||
        ((proof.authMethod === "totp" || proof.authMethod === "backup_code") &&
          !factor.enabled)
      ) {
        throw new StepUpPolicyDenied();
      }
      const updated = await tx
        .update(schema.instanceSettingTable)
        .set({
          metricsTokenHash: tokenHash,
          metricsTokenRotatedAt: sql`now()`,
          observabilityConfigVersion: sql`${schema.instanceSettingTable.observabilityConfigVersion} + 1`,
        })
        .where(
          and(
            eq(schema.instanceSettingTable.id, "singleton"),
            eq(
              schema.instanceSettingTable.observabilityConfigVersion,
              input.version,
            ),
          ),
        )
        .returning({
          version: schema.instanceSettingTable.observabilityConfigVersion,
          rotatedAt: schema.instanceSettingTable.metricsTokenRotatedAt,
        });
      if (!updated[0]) {
        const [current] = await tx
          .select({
            version: schema.instanceSettingTable.observabilityConfigVersion,
          })
          .from(schema.instanceSettingTable)
          .where(eq(schema.instanceSettingTable.id, "singleton"))
          .limit(1);
        throw new VersionConflict(current?.version ?? input.version);
      }
      await appendStepUpAudit(tx, {
        action: "auth.step_up_consumed",
        actorId: c.get("userId"),
        personId: factor.personId,
        operation: "metrics_token_rotate",
        traceId: c.req.header("x-request-id"),
      });
      return { kind: "success" as const, ...updated[0] };
    });
    if (result.kind === "denied") {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "step_up_unavailable" });
    }
    await appendAuditLog(db, {
      action: "instance.observability_changed",
      actorId: c.get("userId"),
      actorType: "person",
      traceId: normaliseTraceId(c.req.header("x-request-id")),
      workspaceId: null,
      entityType: "instance",
      entityId: "singleton",
      before: null,
      after: { changedKeys: ["metricsToken"] },
    }).catch(async () => {
      recordAuditWriteFailure("mutation");
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        version: result.version,
        token,
        metricsTokenRotatedAt:
          result.rotatedAt?.toISOString() ?? new Date().toISOString(),
      },
      200,
    );
  } catch (error) {
    if (error instanceof StepUpPolicyDenied) {
      await appendStepUpAudit(db, {
        action: "auth.step_up_denied",
        actorId: c.get("userId"),
        personId: factor.personId,
        operation: "metrics_token_rotate",
        traceId: c.req.header("x-request-id"),
      });
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "step_up_unavailable" });
    }
    if (error instanceof VersionConflict) {
      await appendStepUpAudit(db, {
        action: "auth.step_up_denied",
        actorId: c.get("userId"),
        personId: factor.personId,
        operation: "metrics_token_rotate",
        traceId: c.req.header("x-request-id"),
      });
      return c.json(
        { message: "version_conflict" as const, version: error.version },
        409,
      );
    }
    throw error;
  }
});

export default routes;
