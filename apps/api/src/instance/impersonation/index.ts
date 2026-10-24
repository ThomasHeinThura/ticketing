import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { clientIpForContext } from "../../api-key/enforce";
import { appendAuditLog } from "../../audit/audit-writer";
import { auth } from "../../auth";
import {
  IMPERSONATION_SESSION_SECONDS,
  runSanctionedAdminCall,
} from "../../auth/impersonation-context";
import {
  IMPERSONATION_REASON_MAX,
  IMPERSONATION_REASON_MIN,
} from "../../auth/step-up-ext";
import { runWithStepUp } from "../../auth/step-up-spend";
import db, { schema } from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { requireSessionOnly } from "../../utils/require-session-only";
import { isCurrentInstanceAdmin } from "../observability/audit-failure-notifier";
import { checkImpersonationTarget } from "./eligibility";
import { findImpersonationStart, finishImpersonation } from "./finish";

const errorSchema = z.object({ message: z.string() });
const idParams = z.object({ id: z.string().min(1).max(128) });
const startBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(IMPERSONATION_REASON_MIN)
      .max(IMPERSONATION_REASON_MAX),
  })
  .strict();
const startResponse = z.object({
  expiresAt: z.string().datetime(),
  target: z.object({ id: z.string(), name: z.string(), email: z.string() }),
});
const statusResponse = z.object({
  impersonating: z.boolean(),
  impersonator: z.object({ id: z.string(), name: z.string() }).nullable(),
  target: z
    .object({ id: z.string(), name: z.string(), email: z.string() })
    .nullable(),
  startedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  reason: z.string().nullable(),
});
const endResponse = z.object({
  ended: z.literal(true),
  reason: z.enum(["exit", "cap"]),
  restored: z.boolean(),
});

const startRoute = createRoute({
  method: "post",
  operationId: "startImpersonation",
  path: "/users/{id}/impersonate",
  tags: ["Instance"],
  summary: "Start an audited, time-capped impersonation session",
  description:
    "Instance administrator only, elevated and session-only (PA-15 operation `impersonation_start`). The target must be an active staff person who is not an instance administrator. The session is capped at 30 minutes (GM-7).",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: idParams,
    headers: z.object({ "x-taskdesk-step-up-token": z.string().length(43) }),
    body: {
      required: true,
      content: { "application/json": { schema: startBody } },
    },
  },
  responses: {
    200: jsonResponse("Impersonation session started", startResponse),
    403: jsonResponse(
      "Forbidden, step-up unavailable, or target is an administrator",
      errorSchema,
    ),
    404: jsonResponse("User not found", errorSchema),
    409: jsonResponse("Target not eligible", errorSchema),
    503: jsonResponse("Audit unavailable; no session issued", errorSchema),
  },
});

const statusRoute = createRoute({
  method: "get",
  operationId: "getImpersonationStatus",
  path: "/impersonate",
  tags: ["Instance"],
  summary: "Describe the caller's impersonation session, if any",
  responses: { 200: jsonResponse("Impersonation status", statusResponse) },
});

const endRoute = createRoute({
  method: "delete",
  operationId: "endImpersonation",
  path: "/impersonate",
  tags: ["Instance"],
  summary: "End the caller's impersonation session",
  description:
    "Always allowed for an impersonation session (GM-11). Returns the administrator to their own session and records impersonation.ended.",
  responses: {
    200: jsonResponse("Impersonation ended", endResponse),
    409: jsonResponse("The session is not an impersonation", errorSchema),
  },
});

type SessionShape = {
  id: string;
  userId: string;
  portal?: string;
  impersonatedBy?: string | null;
  expiresAt?: Date | string;
} | null;

function forwardCookies(c: Context, response: Response) {
  for (const cookie of response.headers.getSetCookie())
    c.header("Set-Cookie", cookie, { append: true });
}

const routes = apiRouter()
  .openapi(startRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const session = c.get("session") as SessionShape;
    if (!session || session.portal !== "agent" || session.impersonatedBy) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "session_required" });
    }
    const actorUserId = c.get("userId") as string;
    if (!(await isCurrentInstanceAdmin(actorUserId))) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    const { id: targetUserId } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const refusal = await checkImpersonationTarget(actorUserId, targetUserId);
    if (refusal) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(refusal.status, { message: refusal.message });
    }
    const traceId = c.req.header("x-request-id");

    // The proof is spent in the transaction that creates the session: the session creation runs
    // inside it, so a refusal (wrong sign-in method, stale proof) or a failed creation rolls the
    // consumption back and a committed proof always has its session.
    let created: Response;
    try {
      created = await runWithStepUp(
        c,
        { operation: "impersonation_start", targetUserId, reason },
        (spend) =>
          db.transaction(async (tx) => {
            await spend(tx);
            const response = await runSanctionedAdminCall(
              "/admin/impersonate-user",
              () =>
                auth.api.impersonateUser({
                  body: { userId: targetUserId },
                  headers: c.req.raw.headers,
                  asResponse: true,
                }),
            );
            if (!response.ok) {
              throw new HTTPException(409, {
                message: "impersonation_target_not_eligible",
              });
            }
            return response;
          }),
      );
    } catch (error) {
      setShadowLegacyAuthorization(c, "denied");
      throw error;
    }
    const createdBody = (await created.clone().json()) as {
      session?: { id?: string; expiresAt?: string };
      user?: { id: string; name: string; email: string };
    };
    const sessionId = createdBody.session?.id;
    const expiresAt = createdBody.session?.expiresAt
      ? new Date(createdBody.session.expiresAt)
      : new Date(Date.now() + IMPERSONATION_SESSION_SECONDS * 1000);
    if (!sessionId || !createdBody.user)
      throw new HTTPException(503, { message: "Impersonation unavailable" });
    try {
      await appendAuditLog(db, {
        action: "impersonation.started",
        actorId: actorUserId,
        actorType: "person",
        impersonatorId: null,
        actorIp: clientIpForContext(c),
        userAgent: c.req.header("user-agent") ?? null,
        traceId: normaliseTraceId(traceId),
        workspaceId: null,
        entityType: "user",
        entityId: targetUserId,
        after: {
          sessionId,
          reason,
          expiresAt: expiresAt.toISOString(),
          capSeconds: IMPERSONATION_SESSION_SECONDS,
        },
      });
    } catch {
      // GM-7/AU-14: an impersonation that cannot be audited is not allowed to exist.
      await db
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.id, sessionId))
        .catch(() => undefined);
      throw new HTTPException(503, {
        message: "Audit unavailable; impersonation was not started",
      });
    }
    forwardCookies(c, created);
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        expiresAt: expiresAt.toISOString(),
        target: {
          id: createdBody.user.id,
          name: createdBody.user.name,
          email: createdBody.user.email,
        },
      },
      200,
    );
  })
  .openapi(statusRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const session = c.get("session") as SessionShape;
    setShadowLegacyAuthorization(c, "allowed");
    if (!session?.impersonatedBy) {
      return c.json(
        {
          impersonating: false,
          impersonator: null,
          target: null,
          startedAt: null,
          expiresAt: null,
          reason: null,
        },
        200,
      );
    }
    const [impersonator] = await db
      .select({ id: schema.userTable.id, name: schema.userTable.name })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, session.impersonatedBy))
      .limit(1);
    const [target] = await db
      .select({
        id: schema.userTable.id,
        name: schema.userTable.name,
        email: schema.userTable.email,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, session.userId))
      .limit(1);
    const start = await findImpersonationStart(session.id);
    return c.json(
      {
        impersonating: true,
        impersonator: impersonator ?? {
          id: session.impersonatedBy,
          name: session.impersonatedBy,
        },
        target: target ?? null,
        startedAt: start?.startedAt ?? null,
        expiresAt: session.expiresAt
          ? new Date(session.expiresAt).toISOString()
          : null,
        reason: start?.reason ?? null,
      },
      200,
    );
  })
  .openapi(endRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const session = c.get("session") as SessionShape;
    if (!session?.impersonatedBy) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(409, { message: "not_impersonating" });
    }
    const endReason =
      session.expiresAt &&
      new Date(session.expiresAt).getTime() - Date.now() <= 15_000
        ? ("cap" as const)
        : ("exit" as const);
    const sessionId = session.id;
    const impersonatorUserId = session.impersonatedBy;
    const targetUserId = session.userId;
    let restored = false;
    const stopped = await runSanctionedAdminCall(
      "/admin/stop-impersonating",
      () =>
        auth.api.stopImpersonating({
          headers: c.req.raw.headers,
          asResponse: true,
        }),
    ).catch(() => null);
    if (stopped?.ok) {
      restored = true;
      forwardCookies(c, stopped);
    } else {
      // The administrator's own session could not be restored (cookie lost): fail closed by
      // signing the impersonation session out; the administrator signs in again.
      const signedOut = await auth.api
        .signOut({ headers: c.req.raw.headers, asResponse: true })
        .catch(() => null);
      if (signedOut) forwardCookies(c, signedOut);
    }
    await finishImpersonation({
      sessionId,
      targetUserId,
      impersonatorUserId,
      endReason,
      traceId: normaliseTraceId(c.req.header("x-request-id")),
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ ended: true as const, reason: endReason, restored }, 200);
  });

export default routes;
