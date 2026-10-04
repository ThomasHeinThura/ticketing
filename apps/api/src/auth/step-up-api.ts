import {
  type ScimAdminRequest,
  validateScimAdminRequest,
} from "@taskdesk/domain";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { auth } from "../auth";
import db, { schema } from "../database";
import {
  type IdentityConnectionConfigureRequest,
  type IdentityConnectionCreateRequest,
  identityConnectionConfigureRequestSchema,
  identityConnectionCreateRequestSchema,
} from "../identity/connection-contract";
import { loadEntraDiscovery } from "../identity/oidc-provider";
import { isCurrentInstanceAdmin } from "../instance/observability/audit-failure-notifier";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  type LocalFactorState,
  loadLocalFactorState,
} from "./local-factor-service";
import { appendStepUpAudit } from "./step-up-audit";
import {
  createIdentityConnectionChallenge,
  createMfaResetChallenge,
  createRotationChallenge,
  createScimAdminChallenge,
  createScimTokenChallenge,
  IDENTITY_CONNECTION_CONFIGURE_OPERATION,
  IDENTITY_CONNECTION_CREATE_OPERATION,
  issueIdentityConnectionToken,
  issueMfaResetToken,
  issueRotationToken,
  issueScimAdminToken,
  issueScimTokenToken,
  STEP_UP_CHALLENGE_LIMIT,
  STEP_UP_CHALLENGE_WINDOW_MINUTES,
  StepUpAttemptLimitError,
} from "./step-up-service";

const versionSchema = z.number().int().positive().safe();
const challengeResponse = z.object({
  challengeId: z.string(),
  nonce: z.string().length(43),
  expiresAt: z.string().datetime(),
});
const tokenResponse = z.object({
  token: z.string().length(43),
  expiresAt: z.string().datetime(),
});

function requireScimAdminRequest(
  request: ScimAdminRequest | undefined,
): ScimAdminRequest {
  if (!request)
    throw new HTTPException(422, {
      message: "Invalid SCIM administration request",
    });
  return request;
}

async function requireCurrentAgentSession(c: Context) {
  const session = c.get("session") as {
    id: string;
    userId: string;
    expiresAt: Date;
    portal?: unknown;
    impersonatedBy?: string | null;
  } | null;
  if (!session || session.impersonatedBy) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  if (session.portal !== "agent") {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  const [activeSession] = await db
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, session.id),
        eq(schema.sessionTable.userId, c.get("userId")),
        eq(schema.sessionTable.portal, "agent"),
        gt(schema.sessionTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!activeSession) throw new HTTPException(401, { message: "Unauthorized" });
  let factor: LocalFactorState;
  try {
    factor = await loadLocalFactorState(c.get("userId"));
  } catch {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return { session, factor };
}

const challengeRoute = createRoute({
  method: "post",
  operationId: "createOperationStepUpChallenge",
  path: "/step-up/challenges",
  tags: ["Authentication"],
  summary: "Create an operation-bound authentication challenge",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.discriminatedUnion("operation", [
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("metrics_token_rotate"),
                version: versionSchema,
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("mfa_reset"),
                userId: z.string().min(1),
                verificationNote: z.string().trim().min(12).max(1000),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("scim_admin_update"),
                connectionId: z.string().min(1),
                request: z.record(z.string(), z.unknown()),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("scim_token_rotate"),
                connectionId: z.string().min(1),
                version: versionSchema,
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("scim_token_revoke"),
                connectionId: z.string().min(1),
                version: versionSchema,
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal(IDENTITY_CONNECTION_CREATE_OPERATION),
                request: identityConnectionCreateRequestSchema,
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal(IDENTITY_CONNECTION_CONFIGURE_OPERATION),
                connectionId: z.string().min(1).max(128),
                request: identityConnectionConfigureRequestSchema,
              })
              .strict(),
          ]),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Single-use step-up challenge", challengeResponse),
    403: jsonResponse(
      "Challenge unavailable",
      z.object({ message: z.string() }),
    ),
    409: jsonResponse(
      "Configuration changed",
      z.object({
        message: z.literal("version_conflict"),
        version: versionSchema,
      }),
    ),
    429: jsonResponse(
      "Step-up attempts are temporarily limited",
      z.object({
        message: z.literal("step_up_attempt_limit"),
        limit: z.number(),
        windowMinutes: z.number(),
      }),
    ),
    422: jsonResponse(
      "Invalid operation request",
      z.object({ message: z.string() }),
    ),
  },
});

const proveRoute = createRoute({
  method: "post",
  operationId: "issueOperationStepUpToken",
  path: "/step-up",
  tags: ["Authentication"],
  summary: "Verify fresh authentication and issue a single-use token",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.union([
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("metrics_token_rotate"),
                version: versionSchema,
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("password"),
                password: z.string().min(1).max(1024),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("metrics_token_rotate"),
                version: versionSchema,
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("totp"),
                code: z.string().regex(/^\d{6}$/u),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("metrics_token_rotate"),
                version: versionSchema,
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("backup_code"),
                code: z.string().min(1).max(64),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("mfa_reset"),
                userId: z.string().min(1),
                verificationNote: z.string().trim().min(12).max(1000),
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("password"),
                password: z.string().min(1).max(1024),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("mfa_reset"),
                userId: z.string().min(1),
                verificationNote: z.string().trim().min(12).max(1000),
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("totp"),
                code: z.string().regex(/^\d{6}$/u),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("mfa_reset"),
                userId: z.string().min(1),
                verificationNote: z.string().trim().min(12).max(1000),
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("backup_code"),
                code: z.string().min(1).max(64),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("scim_admin_update"),
                connectionId: z.string().min(1),
                request: z.record(z.string(), z.unknown()),
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("password"),
                password: z.string().min(1).max(1024),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("scim_admin_update"),
                connectionId: z.string().min(1),
                request: z.record(z.string(), z.unknown()),
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("totp"),
                code: z.string().regex(/^\d{6}$/u),
              })
              .strict(),
            z
              .object({
                kind: z.literal("operation"),
                operation: z.literal("scim_admin_update"),
                connectionId: z.string().min(1),
                request: z.record(z.string(), z.unknown()),
                challengeId: z.string(),
                nonce: z.string().length(43),
                method: z.literal("backup_code"),
                code: z.string().min(1).max(64),
              })
              .strict(),
            ...(["scim_token_rotate", "scim_token_revoke"] as const).flatMap(
              (operation) => [
                z
                  .object({
                    kind: z.literal("operation"),
                    operation: z.literal(operation),
                    connectionId: z.string().min(1),
                    version: versionSchema,
                    challengeId: z.string(),
                    nonce: z.string().length(43),
                    method: z.literal("password"),
                    password: z.string().min(1).max(1024),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal("operation"),
                    operation: z.literal(operation),
                    connectionId: z.string().min(1),
                    version: versionSchema,
                    challengeId: z.string(),
                    nonce: z.string().length(43),
                    method: z.literal("totp"),
                    code: z.string().regex(/^\d{6}$/u),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal("operation"),
                    operation: z.literal(operation),
                    connectionId: z.string().min(1),
                    version: versionSchema,
                    challengeId: z.string(),
                    nonce: z.string().length(43),
                    method: z.literal("backup_code"),
                    code: z.string().min(1).max(64),
                  })
                  .strict(),
              ],
            ),
            ...(
              [
                IDENTITY_CONNECTION_CREATE_OPERATION,
                IDENTITY_CONNECTION_CONFIGURE_OPERATION,
              ] as const
            ).flatMap((operation) => {
              const requestSchema =
                operation === IDENTITY_CONNECTION_CREATE_OPERATION
                  ? identityConnectionCreateRequestSchema
                  : identityConnectionConfigureRequestSchema;
              const connection =
                operation === IDENTITY_CONNECTION_CONFIGURE_OPERATION
                  ? { connectionId: z.string().min(1).max(128) }
                  : {};
              return [
                z
                  .object({
                    kind: z.literal("operation"),
                    operation: z.literal(operation),
                    ...connection,
                    request: requestSchema,
                    challengeId: z.string(),
                    nonce: z.string().length(43),
                    method: z.literal("password"),
                    password: z.string().min(1).max(1024),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal("operation"),
                    operation: z.literal(operation),
                    ...connection,
                    request: requestSchema,
                    challengeId: z.string(),
                    nonce: z.string().length(43),
                    method: z.literal("totp"),
                    code: z.string().regex(/^\d{6}$/u),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal("operation"),
                    operation: z.literal(operation),
                    ...connection,
                    request: requestSchema,
                    challengeId: z.string(),
                    nonce: z.string().length(43),
                    method: z.literal("backup_code"),
                    code: z.string().min(1).max(64),
                  })
                  .strict(),
              ];
            }),
          ]),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Single-use operation token", tokenResponse),
    403: jsonResponse(
      "Authentication unavailable or invalid",
      z.object({ message: z.string() }),
    ),
    404: jsonResponse(
      "Connection unavailable",
      z.object({ message: z.string() }),
    ),
    409: jsonResponse(
      "Configuration changed",
      z.object({ message: z.string(), version: versionSchema }),
    ),
    422: jsonResponse(
      "Invalid operation request",
      z.object({ message: z.string() }),
    ),
  },
});

const routes = apiRouter()
  .openapi(challengeRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await requireCurrentAgentSession(c);
    if (!(await isCurrentInstanceAdmin(c.get("userId")))) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    const input = c.req.valid("json");
    if (input.operation === "mfa_reset") {
      const [target] = await db
        .select({ enabled: schema.userTable.twoFactorEnabled })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, input.userId))
        .limit(1);
      if (!target?.enabled) {
        await appendStepUpAudit(db, {
          action: "auth.step_up_denied",
          actorId: c.get("userId"),
          personId: actor.factor.personId,
          operation: "mfa_reset",
          traceId: c.req.header("x-request-id"),
        });
        throw new HTTPException(409, { message: "factor_reset_unavailable" });
      }
      let challenge: Awaited<ReturnType<typeof createMfaResetChallenge>>;
      try {
        challenge = await createMfaResetChallenge({
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          userId: input.userId,
          verificationNote: input.verificationNote,
        });
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation: "mfa_reset",
            traceId: c.req.header("x-request-id"),
          });
          return c.json(
            {
              message: "step_up_attempt_limit" as const,
              limit: STEP_UP_CHALLENGE_LIMIT,
              windowMinutes: STEP_UP_CHALLENGE_WINDOW_MINUTES,
            },
            429,
          );
        }
        throw error;
      }
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(
        {
          challengeId: challenge.id,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
        },
        200,
      );
    }
    if (input.operation === "scim_admin_update") {
      const validated = validateScimAdminRequest(input.request);
      if (!validated.ok)
        throw new HTTPException(422, {
          message: "Invalid SCIM administration request",
        });
      const [connection] = await db
        .select({
          version: schema.identityConnectionTable.configVersion,
          childId: schema.scimConnectionTable.identityConnectionId,
        })
        .from(schema.identityConnectionTable)
        .innerJoin(
          schema.scimConnectionTable,
          eq(
            schema.scimConnectionTable.identityConnectionId,
            schema.identityConnectionTable.id,
          ),
        )
        .where(eq(schema.identityConnectionTable.id, input.connectionId))
        .limit(1);
      if (!connection)
        throw new HTTPException(404, { message: "SCIM connection not found" });
      if (connection.version !== validated.value.configVersion)
        return c.json(
          { message: "version_conflict" as const, version: connection.version },
          409,
        );
      let challenge: Awaited<ReturnType<typeof createScimAdminChallenge>>;
      try {
        challenge = await createScimAdminChallenge({
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          connectionId: input.connectionId,
          request: validated.value,
        });
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation: "scim_admin_update",
            traceId: c.req.header("x-request-id"),
          });
          return c.json(
            {
              message: "step_up_attempt_limit" as const,
              limit: STEP_UP_CHALLENGE_LIMIT,
              windowMinutes: STEP_UP_CHALLENGE_WINDOW_MINUTES,
            },
            429,
          );
        }
        throw error;
      }
      await appendStepUpAudit(db, {
        action: "auth.step_up_issued",
        actorId: c.get("userId"),
        personId: actor.factor.personId,
        operation: "scim_admin_update",
        traceId: c.req.header("x-request-id"),
      });
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(
        {
          challengeId: challenge.id,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
        },
        200,
      );
    }
    if (
      input.operation === "scim_token_rotate" ||
      input.operation === "scim_token_revoke"
    ) {
      const [connection] = await db
        .select({ version: schema.identityConnectionTable.configVersion })
        .from(schema.identityConnectionTable)
        .innerJoin(
          schema.scimConnectionTable,
          eq(
            schema.scimConnectionTable.identityConnectionId,
            schema.identityConnectionTable.id,
          ),
        )
        .where(eq(schema.identityConnectionTable.id, input.connectionId))
        .limit(1);
      if (!connection)
        throw new HTTPException(404, { message: "SCIM connection not found" });
      if (connection.version !== input.version)
        return c.json(
          { message: "version_conflict" as const, version: connection.version },
          409,
        );
      let challenge: Awaited<ReturnType<typeof createScimTokenChallenge>>;
      try {
        challenge = await createScimTokenChallenge({
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          connectionId: input.connectionId,
          version: input.version,
          operation: input.operation,
        });
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation: input.operation,
            traceId: c.req.header("x-request-id"),
          });
          return c.json(
            {
              message: "step_up_attempt_limit" as const,
              limit: STEP_UP_CHALLENGE_LIMIT,
              windowMinutes: STEP_UP_CHALLENGE_WINDOW_MINUTES,
            },
            429,
          );
        }
        throw error;
      }
      await appendStepUpAudit(db, {
        action: "auth.step_up_issued",
        actorId: c.get("userId"),
        personId: actor.factor.personId,
        operation: input.operation,
        traceId: c.req.header("x-request-id"),
      });
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(
        {
          challengeId: challenge.id,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
        },
        200,
      );
    }
    if (
      input.operation === IDENTITY_CONNECTION_CREATE_OPERATION ||
      input.operation === IDENTITY_CONNECTION_CONFIGURE_OPERATION
    ) {
      const connectionInput = input as typeof input & {
        request:
          | IdentityConnectionCreateRequest
          | IdentityConnectionConfigureRequest;
      };
      const creating = input.operation === IDENTITY_CONNECTION_CREATE_OPERATION;
      if (creating) {
        try {
          await loadEntraDiscovery(
            (connectionInput.request as IdentityConnectionCreateRequest)
              .tenantId,
          );
        } catch {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation: input.operation,
            traceId: c.req.header("x-request-id"),
          });
          throw new HTTPException(422, {
            message: "Identity provider configuration is invalid",
          });
        }
      } else {
        const [connection] = await db
          .select({ version: schema.identityConnectionTable.configVersion })
          .from(schema.identityConnectionTable)
          .where(
            eq(
              schema.identityConnectionTable.id,
              (input as typeof input & { connectionId: string }).connectionId,
            ),
          )
          .limit(1);
        if (!connection)
          throw new HTTPException(404, { message: "Connection unavailable" });
        if (
          connection.version !==
          (connectionInput.request as IdentityConnectionConfigureRequest)
            .configVersion
        )
          return c.json(
            {
              message: "version_conflict" as const,
              version: connection.version,
            },
            409,
          );
      }
      let challenge: Awaited<
        ReturnType<typeof createIdentityConnectionChallenge>
      >;
      try {
        challenge = await createIdentityConnectionChallenge({
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          connectionId: creating
            ? undefined
            : (input as typeof input & { connectionId: string }).connectionId,
          request: connectionInput.request as unknown as Record<
            string,
            unknown
          >,
          operation: input.operation,
        });
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation: input.operation,
            traceId: c.req.header("x-request-id"),
          });
          return c.json(
            {
              message: "step_up_attempt_limit" as const,
              limit: STEP_UP_CHALLENGE_LIMIT,
              windowMinutes: STEP_UP_CHALLENGE_WINDOW_MINUTES,
            },
            429,
          );
        }
        throw error;
      }
      await appendStepUpAudit(db, {
        action: "auth.step_up_issued",
        actorId: c.get("userId"),
        personId: actor.factor.personId,
        operation: input.operation,
        traceId: c.req.header("x-request-id"),
      });
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(
        {
          challengeId: challenge.id,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
        },
        200,
      );
    }
    const [setting] = await db
      .select({
        version: schema.instanceSettingTable.observabilityConfigVersion,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"))
      .limit(1);
    if (!setting)
      throw new HTTPException(503, { message: "Step-up unavailable" });
    if (setting.version !== input.version) {
      await appendStepUpAudit(db, {
        action: "auth.step_up_denied",
        actorId: c.get("userId"),
        personId: actor.factor.personId,
        operation: "metrics_token_rotate",
        traceId: c.req.header("x-request-id"),
      });
      return c.json(
        { message: "version_conflict" as const, version: setting.version },
        409,
      );
    }
    if (actor.factor.required || actor.factor.enabled) {
      // The challenge may still be issued, but password proof is never a fallback for a
      // factor-protected account. The subsequent proof endpoint accepts only real factor.
    }
    let challenge: Awaited<ReturnType<typeof createRotationChallenge>>;
    try {
      challenge = await createRotationChallenge({
        personId: actor.factor.personId,
        sessionId: actor.session.id,
        version: input.version,
      });
    } catch (error) {
      if (error instanceof StepUpAttemptLimitError) {
        await appendStepUpAudit(db, {
          action: "auth.step_up_denied",
          actorId: c.get("userId"),
          personId: actor.factor.personId,
          operation: "metrics_token_rotate",
          traceId: c.req.header("x-request-id"),
        });
        return c.json(
          {
            message: "step_up_attempt_limit" as const,
            limit: STEP_UP_CHALLENGE_LIMIT,
            windowMinutes: STEP_UP_CHALLENGE_WINDOW_MINUTES,
          },
          429,
        );
      }
      throw error;
    }
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        challengeId: challenge.id,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
      },
      200,
    );
  })
  .openapi(proveRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await requireCurrentAgentSession(c);
    if (!(await isCurrentInstanceAdmin(c.get("userId")))) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "step_up_unavailable" });
    }
    const input = c.req.valid("json");
    const connectionInput = input as typeof input & {
      request:
        | IdentityConnectionCreateRequest
        | IdentityConnectionConfigureRequest;
    };
    if (
      input.operation === IDENTITY_CONNECTION_CREATE_OPERATION ||
      input.operation === IDENTITY_CONNECTION_CONFIGURE_OPERATION
    ) {
      const creating = input.operation === IDENTITY_CONNECTION_CREATE_OPERATION;
      if (creating) {
        try {
          await loadEntraDiscovery(
            (connectionInput.request as IdentityConnectionCreateRequest)
              .tenantId,
          );
        } catch {
          throw new HTTPException(422, {
            message: "Identity provider configuration is invalid",
          });
        }
      } else {
        const [connection] = await db
          .select({ version: schema.identityConnectionTable.configVersion })
          .from(schema.identityConnectionTable)
          .where(
            eq(
              schema.identityConnectionTable.id,
              (input as typeof input & { connectionId: string }).connectionId,
            ),
          )
          .limit(1);
        if (!connection)
          throw new HTTPException(404, { message: "Connection unavailable" });
        if (
          connection.version !==
          (connectionInput.request as IdentityConnectionConfigureRequest)
            .configVersion
        )
          return c.json(
            {
              message: "version_conflict" as const,
              version: connection.version,
            },
            409,
          );
      }
    }
    let scimAdminRequest: ScimAdminRequest | undefined;
    if (input.operation === "scim_admin_update") {
      const validated = validateScimAdminRequest(input.request);
      if (!validated.ok)
        throw new HTTPException(422, {
          message: "Invalid SCIM administration request",
        });
      const [connection] = await db
        .select({ version: schema.identityConnectionTable.configVersion })
        .from(schema.identityConnectionTable)
        .innerJoin(
          schema.scimConnectionTable,
          eq(
            schema.scimConnectionTable.identityConnectionId,
            schema.identityConnectionTable.id,
          ),
        )
        .where(eq(schema.identityConnectionTable.id, input.connectionId))
        .limit(1);
      if (!connection)
        throw new HTTPException(404, { message: "SCIM connection not found" });
      if (connection.version !== validated.value.configVersion)
        return c.json(
          { message: "version_conflict" as const, version: connection.version },
          409,
        );
      scimAdminRequest = validated.value;
    }
    if (
      input.operation === "scim_token_rotate" ||
      input.operation === "scim_token_revoke"
    ) {
      const [connection] = await db
        .select({ version: schema.identityConnectionTable.configVersion })
        .from(schema.identityConnectionTable)
        .innerJoin(
          schema.scimConnectionTable,
          eq(
            schema.scimConnectionTable.identityConnectionId,
            schema.identityConnectionTable.id,
          ),
        )
        .where(eq(schema.identityConnectionTable.id, input.connectionId))
        .limit(1);
      if (!connection)
        throw new HTTPException(404, { message: "Connection unavailable" });
      if (connection.version !== input.version)
        return c.json(
          { message: "version_conflict" as const, version: connection.version },
          409,
        );
    }
    let authenticatedPersonId = actor.factor.personId;
    const verifyAuthentication = async () => {
      const currentFactor = await loadLocalFactorState(c.get("userId"));
      authenticatedPersonId = currentFactor.personId;
      if (input.method === "password") {
        if (currentFactor.required || currentFactor.enabled) return null;
        const [credential] = await db
          .select({ password: schema.accountTable.password })
          .from(schema.accountTable)
          .where(
            and(
              eq(schema.accountTable.userId, c.get("userId")),
              eq(schema.accountTable.providerId, "credential"),
            ),
          )
          .limit(1);
        if (!credential?.password) return null;
        return (await bcrypt.compare(input.password, credential.password))
          ? ("password" as const)
          : null;
      }
      if (
        currentFactor.personId !== actor.factor.personId ||
        !currentFactor.enabled
      )
        return null;
      try {
        if (input.method === "totp") {
          const result = await auth.api.verifyTOTP({
            body: { code: input.code, trustDevice: false },
            headers: c.req.raw.headers,
          });
          return result.user.id === c.get("userId") ? ("totp" as const) : null;
        }
        const result = await auth.api.verifyBackupCode({
          body: { code: input.code, disableSession: true },
          headers: c.req.raw.headers,
        });
        return result.user.id === c.get("userId")
          ? ("backup_code" as const)
          : null;
      } catch {
        return null;
      }
    };
    const token =
      input.operation === IDENTITY_CONNECTION_CREATE_OPERATION ||
      input.operation === IDENTITY_CONNECTION_CONFIGURE_OPERATION
        ? await issueIdentityConnectionToken(
            {
              id: input.challengeId,
              nonce: input.nonce,
              personId: actor.factor.personId,
              sessionId: actor.session.id,
              userId: c.get("userId"),
              connectionId:
                input.operation === IDENTITY_CONNECTION_CONFIGURE_OPERATION
                  ? (input as typeof input & { connectionId: string })
                      .connectionId
                  : undefined,
              request: connectionInput.request as unknown as Record<
                string,
                unknown
              >,
              operation: input.operation,
            },
            verifyAuthentication,
          )
        : input.operation === "scim_token_rotate" ||
            input.operation === "scim_token_revoke"
          ? await issueScimTokenToken(
              {
                id: input.challengeId,
                nonce: input.nonce,
                personId: actor.factor.personId,
                sessionId: actor.session.id,
                userId: c.get("userId"),
                connectionId: input.connectionId,
                version: "version" in input ? input.version : 1,
                operation: input.operation,
              },
              verifyAuthentication,
            )
          : input.operation === "scim_admin_update"
            ? await issueScimAdminToken(
                {
                  id: input.challengeId,
                  nonce: input.nonce,
                  personId: actor.factor.personId,
                  sessionId: actor.session.id,
                  userId: c.get("userId"),
                  connectionId: input.connectionId,
                  request: requireScimAdminRequest(scimAdminRequest),
                },
                verifyAuthentication,
              )
            : input.operation === "mfa_reset"
              ? await issueMfaResetToken(
                  {
                    id: input.challengeId,
                    nonce: input.nonce,
                    personId: actor.factor.personId,
                    sessionId: actor.session.id,
                    userId: c.get("userId"),
                    targetUserId: input.userId,
                    verificationNote: input.verificationNote,
                  },
                  verifyAuthentication,
                )
              : await issueRotationToken(
                  {
                    id: input.challengeId,
                    nonce: input.nonce,
                    personId: actor.factor.personId,
                    sessionId: actor.session.id,
                    userId: c.get("userId"),
                    version: "version" in input ? input.version : 1,
                  },
                  verifyAuthentication,
                );
    if (!token) {
      await appendStepUpAudit(db, {
        action: "auth.step_up_denied",
        actorId: c.get("userId"),
        personId: actor.factor.personId,
        operation: input.operation,
        traceId: c.req.header("x-request-id"),
      });
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "step_up_unavailable" });
    }
    await appendStepUpAudit(db, {
      action: "auth.step_up_issued",
      actorId: c.get("userId"),
      personId: authenticatedPersonId,
      operation: input.operation,
      traceId: c.req.header("x-request-id"),
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ token: token.token, expiresAt: token.expiresAt }, 200);
  });

export default routes;
