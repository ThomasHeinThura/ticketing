import {
  type ScimAdminRequest,
  validateScimAdminRequest,
} from "@taskdesk/domain";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { auth } from "../auth";
import db, { schema } from "../database";
import {
  type IdentityConnectionConfigureRequest,
  type IdentityConnectionCreateRequest,
  identityConnectionConfigureRequestSchema,
  identityConnectionCreateRequestSchema,
} from "../identity/connection-contract";
import {
  OIDC_GROUP_MAPPING_CREATE_OPERATION,
  OIDC_GROUP_MAPPING_UPDATE_OPERATION,
  type OidcGroupMappingCreateRequest,
  type OidcGroupMappingUpdateRequest,
  oidcGroupMappingCreateRequestSchema,
  oidcGroupMappingUpdateRequestSchema,
} from "../identity/oidc-group-mapping-contract";
import { loadEntraDiscovery } from "../identity/oidc-provider";
import {
  consumeOidcStepUpEvidence,
  createOidcStepUpStart,
  getOidcStepUpStatus,
  oidcStepUpStateCookieName,
  oidcStepUpStateCookieOptions,
} from "../identity/oidc-step-up";
import {
  getOidcGroupMappingById,
  getOidcMappingAdminConnection,
  validateOidcMappingRole,
} from "../identity/repository";
import { checkImpersonationTarget } from "../instance/impersonation/eligibility";
import { isCurrentInstanceAdmin } from "../instance/observability/audit-failure-notifier";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { withEnlistedLocalFactorVerification } from "../pending-action/credential-invalidation";
import {
  isStepUpPendingDeletion,
  pendingDeletionStepUpAccess,
} from "../pending-action/deletion-targets";
import { isHardPurgePendingAction as isHardPurgeAction } from "../pending-action/hard-purge-executor";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { dbNowUtc } from "../utils/db-time";
import { requireSessionOnly } from "../utils/require-session-only";
import { findWebhookWorkspace } from "../webhook/repository";
import { getRoleWithHolderCount } from "../workspace/role.repository";
import {
  type LocalFactorState,
  loadLocalFactorState,
} from "./local-factor-service";
import {
  getActiveSessionForStepUp,
  getIdentityConfigVersion,
  getPasswordCredential,
  getPendingActionForStepUp,
  getScimConfigVersion,
  getScimConnectionDetails,
  getUserFactorEnabled,
  getUserId,
  hasLiveStepUpSession,
  isCurrentInstanceAdminForStepUp,
  type StepUpExecutor,
  type VerifiedStepUpAuthentication,
} from "./repository";
import {
  appendPendingActionStepUpAudit,
  appendStepUpAudit,
} from "./step-up-audit";
import {
  createExtChallenge,
  type ExtInput,
  type ExtOperation,
  extAuthority,
  extChallengeSchemas,
  extProveSchemas,
  extSsoProveSchemas,
  isExtOperation,
  issueExtToken,
} from "./step-up-ext";
import {
  createIdentityConnectionChallenge,
  createInstanceAdminGrantChallenge,
  createInstanceAdminSuspendChallenge,
  createMfaResetChallenge,
  createOidcGroupMappingChallenge,
  createPendingActionChallenge,
  createRotationChallenge,
  createScimAdminChallenge,
  createScimTokenChallenge,
  IDENTITY_CONNECTION_CONFIGURE_OPERATION,
  IDENTITY_CONNECTION_CREATE_OPERATION,
  issueIdentityConnectionToken,
  issueInstanceAdminGrantToken,
  issueInstanceAdminSuspendToken,
  issueMfaResetToken,
  issueOidcGroupMappingToken,
  issuePendingActionToken,
  issueRotationToken,
  issueScimAdminToken,
  issueScimTokenToken,
  STEP_UP_CHALLENGE_LIMIT,
  STEP_UP_CHALLENGE_WINDOW_MINUTES,
  StepUpAttemptLimitError,
} from "./step-up-service";
import { isFreshSignedAuthTime } from "./step-up-sso";

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
const suspendRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (
      request.reason !== undefined &&
      Array.from(request.reason).length > 500
    ) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "too_long" });
    }
  });

const ssoProofFields = {
  challengeId: z.string(),
  nonce: z.string().length(43),
  method: z.literal("sso_prompt_login"),
} as const;

const ssoCoreProveSchemas = [
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal("metrics_token_rotate"),
      version: versionSchema,
      ...ssoProofFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal("mfa_reset"),
      userId: z.string().min(1),
      verificationNote: z.string().trim().min(12).max(1000),
      ...ssoProofFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal("scim_admin_update"),
      connectionId: z.string().min(1),
      request: z.record(z.string(), z.unknown()),
      ...ssoProofFields,
    })
    .strict(),
  ...(["scim_token_rotate", "scim_token_revoke"] as const).map((operation) =>
    z
      .object({
        kind: z.literal("operation"),
        operation: z.literal(operation),
        connectionId: z.string().min(1),
        version: versionSchema,
        ...ssoProofFields,
      })
      .strict(),
  ),
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal(OIDC_GROUP_MAPPING_CREATE_OPERATION),
      connectionId: z.string().min(1).max(128),
      request: oidcGroupMappingCreateRequestSchema,
      ...ssoProofFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal(OIDC_GROUP_MAPPING_UPDATE_OPERATION),
      connectionId: z.string().min(1).max(128),
      mappingId: z.string().min(1).max(128),
      request: oidcGroupMappingUpdateRequestSchema,
      ...ssoProofFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal(IDENTITY_CONNECTION_CREATE_OPERATION),
      request: identityConnectionCreateRequestSchema,
      ...ssoProofFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal(IDENTITY_CONNECTION_CONFIGURE_OPERATION),
      connectionId: z.string().min(1).max(128),
      request: identityConnectionConfigureRequestSchema,
      ...ssoProofFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal("instance_admin_grant"),
      targetUserId: z.string().min(1),
      ...ssoProofFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal("instance_admin_suspend"),
      targetUserId: z.string().min(1),
      request: suspendRequestSchema,
      ...ssoProofFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("pending_action"),
      pendingActionId: z.string().min(1).max(64),
      ...ssoProofFields,
    })
    .strict(),
];

const ssoStartRoute = createRoute({
  method: "post",
  operationId: "startSsoStepUp",
  path: "/step-up/sso/start",
  tags: ["Authentication"],
  summary: "Start a session-bound SSO step-up",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              challengeId: z.string().min(1),
              nonce: z.string().length(43),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "SSO authorization URL",
      z.object({ authorizationUrl: z.string().url() }),
    ),
    403: jsonResponse(
      "SSO step-up unavailable",
      z.object({ message: z.string() }),
    ),
  },
});

const ssoStatusRoute = createRoute({
  method: "post",
  operationId: "getSsoStepUpStatus",
  path: "/step-up/sso/status",
  tags: ["Authentication"],
  summary: "Read the current session's SSO step-up status",
  middleware: [requireSessionOnly()] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ challengeId: z.string().min(1) }).strict(),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "SSO step-up status",
      z.object({ status: z.enum(["pending", "verified", "failed"]) }),
    ),
  },
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
  const [activeSession] = await getActiveSessionForStepUp(
    session.id,
    c.get("userId"),
    new Date(),
  );
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
          schema: z
            .union([
              z.discriminatedUnion("operation", [
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
                    operation: z.literal("instance_admin_grant"),
                    targetUserId: z.string().min(1),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal("operation"),
                    operation: z.literal("instance_admin_suspend"),
                    targetUserId: z.string().min(1),
                    request: suspendRequestSchema,
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
                    operation: z.literal(OIDC_GROUP_MAPPING_CREATE_OPERATION),
                    connectionId: z.string().min(1).max(128),
                    request: oidcGroupMappingCreateRequestSchema,
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal("operation"),
                    operation: z.literal(OIDC_GROUP_MAPPING_UPDATE_OPERATION),
                    connectionId: z.string().min(1).max(128),
                    mappingId: z.string().min(1).max(128),
                    request: oidcGroupMappingUpdateRequestSchema,
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
                    operation: z.literal(
                      IDENTITY_CONNECTION_CONFIGURE_OPERATION,
                    ),
                    connectionId: z.string().min(1).max(128),
                    request: identityConnectionConfigureRequestSchema,
                  })
                  .strict(),
              ]),
              z
                .object({
                  kind: z.literal("pending_action"),
                  pendingActionId: z.string().min(1).max(64),
                })
                .strict(),
              ...extChallengeSchemas,
            ])
            .openapi({}, { unionPreferredType: "oneOf" }),
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
            ...(
              [
                OIDC_GROUP_MAPPING_CREATE_OPERATION,
                OIDC_GROUP_MAPPING_UPDATE_OPERATION,
              ] as const
            ).flatMap((operation) => {
              const requestSchema =
                operation === OIDC_GROUP_MAPPING_CREATE_OPERATION
                  ? oidcGroupMappingCreateRequestSchema
                  : oidcGroupMappingUpdateRequestSchema;
              return (["password", "totp", "backup_code"] as const).map(
                (method) =>
                  z
                    .object({
                      kind: z.literal("operation"),
                      operation: z.literal(operation),
                      connectionId: z.string().min(1).max(128),
                      ...(operation === OIDC_GROUP_MAPPING_UPDATE_OPERATION
                        ? { mappingId: z.string().min(1).max(128) }
                        : {}),
                      request: requestSchema,
                      challengeId: z.string(),
                      nonce: z.string().length(43),
                      method: z.literal(method),
                      ...(method === "password"
                        ? { password: z.string().min(1).max(1024) }
                        : {
                            code:
                              method === "totp"
                                ? z.string().regex(/^\d{6}$/u)
                                : z.string().min(1).max(64),
                          }),
                    })
                    .strict(),
              );
            }),
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
            ...(["password", "totp", "backup_code"] as const).map((method) =>
              z
                .object({
                  kind: z.literal("operation"),
                  operation: z.literal("instance_admin_grant"),
                  targetUserId: z.string().min(1),
                  challengeId: z.string(),
                  nonce: z.string().length(43),
                  method: z.literal(method),
                  ...(method === "password"
                    ? { password: z.string().min(1).max(1024) }
                    : method === "totp"
                      ? { code: z.string().regex(/^\d{6}$/u) }
                      : { code: z.string().min(1).max(64) }),
                })
                .strict(),
            ),
            ...(["password", "totp", "backup_code"] as const).map((method) =>
              z
                .object({
                  kind: z.literal("operation"),
                  operation: z.literal("instance_admin_suspend"),
                  targetUserId: z.string().min(1),
                  request: suspendRequestSchema,
                  challengeId: z.string(),
                  nonce: z.string().length(43),
                  method: z.literal(method),
                  ...(method === "password"
                    ? { password: z.string().min(1).max(1024) }
                    : method === "totp"
                      ? { code: z.string().regex(/^\d{6}$/u) }
                      : { code: z.string().min(1).max(64) }),
                })
                .strict(),
            ),
            ...(["password", "totp", "backup_code"] as const).map((method) =>
              z
                .object({
                  kind: z.literal("pending_action"),
                  pendingActionId: z.string().min(1).max(64),
                  challengeId: z.string(),
                  nonce: z.string().length(43),
                  method: z.literal(method),
                  ...(method === "password"
                    ? { password: z.string().min(1).max(1024) }
                    : method === "totp"
                      ? { code: z.string().regex(/^\d{6}$/u) }
                      : { code: z.string().min(1).max(64) }),
                })
                .strict(),
            ),
            ...extProveSchemas,
            ...extSsoProveSchemas,
            ...ssoCoreProveSchemas,
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
    const input = c.req.valid("json");
    if (input.kind === "pending_action") {
      const [action] = await getPendingActionForStepUp(
        input.pendingActionId,
        actor.factor.personId,
        new Date(),
      );
      const isBulk =
        action !== undefined &&
        isStepUpPendingDeletion({
          action: action.action,
          targetType: action.targetType,
          routeKey: action.routeKey,
          confirmation: action.confirmation,
        });
      const isHardPurge =
        action !== undefined &&
        isHardPurgeAction({
          action: action.action,
          targetType: action.targetType,
          routeKey: action.routeKey,
          confirmation: action.confirmation,
        });
      if (
        !isBulk &&
        !isHardPurge &&
        (action?.action !== "delete" ||
          action.targetType !== "user" ||
          action.confirmation !== "typed_name_step_up" ||
          action.routeKey !== "POST /api/instance/users/{id}/deactivate")
      ) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(404, { message: "Pending action unavailable" });
      }
      if (
        isBulk
          ? !(await pendingDeletionStepUpAccess(
              db,
              {
                id: input.pendingActionId,
                requesterPersonId: actor.factor.personId,
                sessionId: actor.session.id,
              },
              { readOnly: true },
            ))
          : !(await isCurrentInstanceAdmin(c.get("userId")))
      ) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(403, { message: "Forbidden" });
      }
      let challenge: Awaited<ReturnType<typeof createPendingActionChallenge>>;
      try {
        challenge = await createPendingActionChallenge({
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          pendingActionId: input.pendingActionId,
        });
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendPendingActionStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            pendingActionId: input.pendingActionId,
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
      if (!challenge)
        throw new HTTPException(409, { message: "Pending action unavailable" });
      await appendPendingActionStepUpAudit(db, {
        action: "auth.step_up_issued",
        actorId: c.get("userId"),
        personId: actor.factor.personId,
        pendingActionId: input.pendingActionId,
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
    if (isExtOperation((input as { operation?: unknown }).operation)) {
      const ext = input as unknown as ExtInput;
      if (!(await extAuthority(ext, c.get("userId"), db))) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(403, { message: "Forbidden" });
      }
      if (ext.operation === "impersonation_start") {
        const refusal = await checkImpersonationTarget(
          c.get("userId"),
          ext.targetUserId,
        );
        if (refusal)
          throw new HTTPException(refusal.status, {
            message: refusal.message,
          });
      }
      if (
        ext.operation === "webhook_update_url" ||
        ext.operation === "webhook_rotate_secret"
      ) {
        const row = await findWebhookWorkspace(ext.webhookId);
        if (!row || row.workspaceId !== ext.workspaceId)
          throw new HTTPException(404, { message: "Webhook not found" });
      }
      if (ext.operation === "workspace_role_update") {
        const role = await getRoleWithHolderCount(
          db,
          ext.workspaceId,
          ext.roleId,
        );
        if (!role) throw new HTTPException(404, { message: "Role not found" });
      }
      let challenge: Awaited<ReturnType<typeof createExtChallenge>>;
      try {
        challenge = await createExtChallenge(
          { personId: actor.factor.personId, sessionId: actor.session.id },
          ext,
        );
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation: ext.operation,
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
        operation: ext.operation,
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
    if (!(await isCurrentInstanceAdmin(c.get("userId")))) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    if (input.operation === "mfa_reset") {
      const [target] = await getUserFactorEnabled(input.userId);
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
    if (input.operation === "instance_admin_suspend") {
      const [target] = await getUserId(input.targetUserId);
      if (!target) throw new HTTPException(404, { message: "User not found" });
      let challenge: Awaited<
        ReturnType<typeof createInstanceAdminSuspendChallenge>
      >;
      try {
        challenge = await createInstanceAdminSuspendChallenge({
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          userId: input.targetUserId,
          request: input.request,
        });
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation: "instance_admin_suspend",
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
        operation: "instance_admin_suspend",
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
    if (input.operation === "instance_admin_grant") {
      const [target] = await getUserId(input.targetUserId);
      if (!target) throw new HTTPException(404, { message: "User not found" });
      let challenge: Awaited<
        ReturnType<typeof createInstanceAdminGrantChallenge>
      >;
      try {
        challenge = await createInstanceAdminGrantChallenge({
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          userId: input.targetUserId,
        });
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation: "instance_admin_grant",
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
    if (
      input.operation === OIDC_GROUP_MAPPING_CREATE_OPERATION ||
      input.operation === OIDC_GROUP_MAPPING_UPDATE_OPERATION
    ) {
      const mappingInput = input as typeof input & {
        connectionId: string;
        mappingId?: string;
        request: OidcGroupMappingCreateRequest | OidcGroupMappingUpdateRequest;
      };
      if (!(await isCurrentInstanceAdmin(c.get("userId"))))
        throw new HTTPException(403, { message: "Forbidden" });
      const creating =
        mappingInput.operation === OIDC_GROUP_MAPPING_CREATE_OPERATION;
      const [connection] = await getOidcMappingAdminConnection(
        mappingInput.connectionId,
      );
      if (!connection)
        throw new HTTPException(404, { message: "Connection unavailable" });
      if (connection.configVersion !== mappingInput.request.configVersion)
        return c.json(
          {
            message: "version_conflict" as const,
            version: connection.configVersion,
          },
          409,
        );

      const [mapping] = creating
        ? []
        : await getOidcGroupMappingById(
            mappingInput.connectionId,
            mappingInput.mappingId ?? "",
          );
      if (!creating && !mapping)
        throw new HTTPException(404, { message: "Mapping unavailable" });
      const request = mappingInput.request;
      const scope = creating
        ? (request as OidcGroupMappingCreateRequest).scope
        : (mapping?.scope as "organisation" | "workspace");
      const scopeId = creating
        ? (request as OidcGroupMappingCreateRequest).scope === "organisation"
          ? (connection.organisationId ?? "")
          : (request as OidcGroupMappingCreateRequest).scopeId
        : (request.scopeId ?? mapping?.scopeId);
      const roleId = request.roleId ?? mapping?.roleId;
      const targetIsValid =
        Boolean(scopeId && roleId) &&
        !(
          connection.portalScope === "customer" &&
          !creating &&
          request.scopeId !== undefined
        ) &&
        (await db.transaction((tx) =>
          validateOidcMappingRole(tx, {
            providerType: connection.providerType,
            portalScope: connection.portalScope,
            organisationId: connection.organisationId,
            maxRoleRank: connection.maxRoleRank,
            scope,
            scopeId: scopeId ?? "",
            roleId: roleId ?? "",
          }),
        ));
      if (!targetIsValid)
        throw new HTTPException(422, {
          message: "Invalid OIDC group mapping target or role",
        });
      const operation = creating
        ? OIDC_GROUP_MAPPING_CREATE_OPERATION
        : OIDC_GROUP_MAPPING_UPDATE_OPERATION;
      let challenge: Awaited<
        ReturnType<typeof createOidcGroupMappingChallenge>
      >;
      try {
        challenge = await createOidcGroupMappingChallenge({
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          connectionId: mappingInput.connectionId,
          ...(creating ? {} : { mappingId: mappingInput.mappingId }),
          request,
          operation,
        });
      } catch (error) {
        if (error instanceof StepUpAttemptLimitError) {
          await appendStepUpAudit(db, {
            action: "auth.step_up_denied",
            actorId: c.get("userId"),
            personId: actor.factor.personId,
            operation,
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
        operation,
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
    if (input.operation === "scim_admin_update") {
      const validated = validateScimAdminRequest(input.request);
      if (!validated.ok)
        throw new HTTPException(422, {
          message: "Invalid SCIM administration request",
        });
      const [connection] = await getScimConnectionDetails(input.connectionId);
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
      const [connection] = await getScimConfigVersion(input.connectionId);
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
        const [connection] = await getIdentityConfigVersion(
          (input as typeof input & { connectionId: string }).connectionId,
        );
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
    // Every other operation was answered above; what remains is the metrics-token rotation.
    const rotationVersion = (input as unknown as { version: number }).version;
    const [setting] = await db
      .select({
        version: schema.instanceSettingTable.observabilityConfigVersion,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"))
      .limit(1);
    if (!setting)
      throw new HTTPException(503, { message: "Step-up unavailable" });
    if (setting.version !== rotationVersion) {
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
        version: rotationVersion,
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
  .openapi(ssoStartRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await requireCurrentAgentSession(c);
    if (actor.factor.enabled || actor.factor.required) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "step_up_unavailable" });
    }
    const input = c.req.valid("json");
    const start = await createOidcStepUpStart({
      challengeId: input.challengeId,
      nonce: input.nonce,
      sessionId: actor.session.id,
      userId: c.get("userId"),
      personId: actor.factor.personId,
    });
    if (!start) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "step_up_unavailable" });
    }
    setCookie(
      c,
      oidcStepUpStateCookieName(start.secure),
      start.state,
      oidcStepUpStateCookieOptions(start.secure),
    );
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ authorizationUrl: start.authorizationUrl }, 200);
  })
  .openapi(ssoStatusRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await requireCurrentAgentSession(c);
    const input = c.req.valid("json");
    const status = await getOidcStepUpStatus({
      challengeId: input.challengeId,
      sessionId: actor.session.id,
      userId: c.get("userId"),
      personId: actor.factor.personId,
    });
    setShadowLegacyAuthorization(c, status === "failed" ? "denied" : "allowed");
    return c.json({ status }, 200);
  })
  .openapi(proveRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const actor = await requireCurrentAgentSession(c);
    const input = c.req.valid("json");
    const isBulkPendingAction =
      input.kind === "pending_action" &&
      (await pendingDeletionStepUpAccess(
        db,
        {
          id: input.pendingActionId,
          requesterPersonId: actor.factor.personId,
          sessionId: actor.session.id,
        },
        { readOnly: true },
      ));
    const [stepUpAction] =
      input.kind === "pending_action"
        ? await getPendingActionForStepUp(
            input.pendingActionId,
            actor.factor.personId,
            new Date(),
          )
        : [];
    const isHardPurge =
      stepUpAction !== undefined && isHardPurgeAction(stepUpAction);
    const ext =
      input.kind === "operation" &&
      isExtOperation((input as { operation?: unknown }).operation)
        ? (input as unknown as ExtInput)
        : null;
    if (
      !isBulkPendingAction &&
      !(ext
        ? await extAuthority(ext, c.get("userId"), db)
        : await isCurrentInstanceAdmin(c.get("userId")))
    ) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "step_up_unavailable" });
    }
    const operationInput = input as Exclude<
      Extract<typeof input, { kind: "operation" }>,
      { operation: ExtOperation }
    >;
    const connectionInput = operationInput as typeof operationInput & {
      request:
        | IdentityConnectionCreateRequest
        | IdentityConnectionConfigureRequest;
    };
    if (
      operationInput.operation === IDENTITY_CONNECTION_CREATE_OPERATION ||
      operationInput.operation === IDENTITY_CONNECTION_CONFIGURE_OPERATION
    ) {
      const creating =
        operationInput.operation === IDENTITY_CONNECTION_CREATE_OPERATION;
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
        const [connection] = await getIdentityConfigVersion(
          operationInput.connectionId as string,
        );
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
    let oidcMappingBinding:
      | {
          operation:
            | typeof OIDC_GROUP_MAPPING_CREATE_OPERATION
            | typeof OIDC_GROUP_MAPPING_UPDATE_OPERATION;
          connectionId: string;
          mappingId?: string;
          request:
            | OidcGroupMappingCreateRequest
            | OidcGroupMappingUpdateRequest;
        }
      | undefined;
    if (
      operationInput.operation === OIDC_GROUP_MAPPING_CREATE_OPERATION ||
      operationInput.operation === OIDC_GROUP_MAPPING_UPDATE_OPERATION
    ) {
      const mappingInput = operationInput as typeof operationInput & {
        connectionId: string;
        mappingId?: string;
        request: OidcGroupMappingCreateRequest | OidcGroupMappingUpdateRequest;
      };
      if (!(await isCurrentInstanceAdmin(c.get("userId"))))
        throw new HTTPException(403, { message: "Forbidden" });
      const creating =
        mappingInput.operation === OIDC_GROUP_MAPPING_CREATE_OPERATION;
      const [connection] = await getOidcMappingAdminConnection(
        mappingInput.connectionId,
      );
      if (!connection)
        throw new HTTPException(404, { message: "Connection unavailable" });
      if (connection.configVersion !== mappingInput.request.configVersion)
        return c.json(
          {
            message: "version_conflict" as const,
            version: connection.configVersion,
          },
          409,
        );
      const [mapping] = creating
        ? []
        : await getOidcGroupMappingById(
            mappingInput.connectionId,
            mappingInput.mappingId ?? "",
          );
      if (!creating && !mapping)
        throw new HTTPException(404, { message: "Mapping unavailable" });
      const request = mappingInput.request;
      const scope = creating
        ? (request as OidcGroupMappingCreateRequest).scope
        : (mapping?.scope as "organisation" | "workspace");
      const scopeId = creating
        ? (request as OidcGroupMappingCreateRequest).scope === "organisation"
          ? (connection.organisationId ?? "")
          : (request as OidcGroupMappingCreateRequest).scopeId
        : (request.scopeId ?? mapping?.scopeId);
      const roleId = request.roleId ?? mapping?.roleId;
      const targetIsValid =
        Boolean(scopeId && roleId) &&
        !(
          connection.portalScope === "customer" &&
          !creating &&
          request.scopeId !== undefined
        ) &&
        (await db.transaction((tx) =>
          validateOidcMappingRole(tx, {
            providerType: connection.providerType,
            portalScope: connection.portalScope,
            organisationId: connection.organisationId,
            maxRoleRank: connection.maxRoleRank,
            scope,
            scopeId: scopeId ?? "",
            roleId: roleId ?? "",
          }),
        ));
      if (!targetIsValid)
        throw new HTTPException(422, {
          message: "Invalid OIDC group mapping target or role",
        });
      oidcMappingBinding = {
        operation: mappingInput.operation,
        connectionId: mappingInput.connectionId,
        ...(creating ? {} : { mappingId: mappingInput.mappingId }),
        request,
      };
    }
    let scimAdminRequest: ScimAdminRequest | undefined;
    if (operationInput.operation === "scim_admin_update") {
      const validated = validateScimAdminRequest(operationInput.request);
      if (!validated.ok)
        throw new HTTPException(422, {
          message: "Invalid SCIM administration request",
        });
      const [connection] = await getScimConfigVersion(
        operationInput.connectionId,
      );
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
      operationInput.operation === "scim_token_rotate" ||
      operationInput.operation === "scim_token_revoke"
    ) {
      const [connection] = await getScimConfigVersion(
        operationInput.connectionId,
      );
      if (!connection)
        throw new HTTPException(404, { message: "Connection unavailable" });
      if (connection.version !== operationInput.version)
        return c.json(
          { message: "version_conflict" as const, version: connection.version },
          409,
        );
    }
    let authenticatedPersonId = actor.factor.personId;
    const verifyAuthentication = async (
      executor: StepUpExecutor,
    ): Promise<VerifiedStepUpAuthentication | null> => {
      const proofInput = input as {
        method: "password" | "totp" | "backup_code" | "sso_prompt_login";
        password?: string;
        code?: string;
      };
      const currentFactor = await loadLocalFactorState(
        c.get("userId"),
        executor,
      );
      authenticatedPersonId = currentFactor.personId;
      if (proofInput.method === "sso_prompt_login") {
        if (
          currentFactor.required ||
          currentFactor.enabled ||
          currentFactor.personId !== actor.factor.personId
        )
          return null;
        const evidence = await consumeOidcStepUpEvidence({
          challengeId: input.challengeId,
          sessionId: actor.session.id,
          userId: c.get("userId"),
          personId: actor.factor.personId,
          executor,
        });
        if (!evidence) return null;
        return {
          authMethod: "sso_prompt_login" as const,
          authenticatedAt: evidence.authTime,
          revalidate: async (finalExecutor: StepUpExecutor) => {
            const factor = await loadLocalFactorState(
              c.get("userId"),
              finalExecutor,
            );
            const [challenge] = await finalExecutor
              .select({
                createdAt: schema.stepUpConfirmationTable.createdAt,
                expiresAt: schema.stepUpConfirmationTable.challengeExpiresAt,
              })
              .from(schema.stepUpConfirmationTable)
              .where(
                and(
                  eq(schema.stepUpConfirmationTable.id, input.challengeId),
                  eq(
                    schema.stepUpConfirmationTable.personId,
                    actor.factor.personId,
                  ),
                  eq(
                    schema.stepUpConfirmationTable.sessionId,
                    actor.session.id,
                  ),
                  eq(schema.stepUpConfirmationTable.state, "challenge"),
                  gt(
                    schema.stepUpConfirmationTable.challengeExpiresAt,
                    dbNowUtc(),
                  ),
                ),
              )
              .for("update")
              .limit(1);
            const [identity] = await finalExecutor
              .select({
                sessionId: schema.sessionTable.id,
                userId: schema.sessionTable.userId,
                connectionId: schema.sessionTable.identityConnectionId,
                personId: schema.personTable.id,
                subject: schema.externalIdentityTable.subject,
                issuer: schema.identityConnectionTable.issuer,
                clientId: schema.identityConnectionTable.clientId,
                configVersion: schema.identityConnectionTable.configVersion,
                mfaUpstreamMode: schema.identityConnectionTable.mfaUpstreamMode,
              })
              .from(schema.sessionTable)
              .innerJoin(
                schema.personTable,
                and(
                  eq(schema.personTable.userId, schema.sessionTable.userId),
                  eq(schema.personTable.id, actor.factor.personId),
                  eq(schema.personTable.active, true),
                  eq(schema.personTable.side, "staff"),
                ),
              )
              .innerJoin(
                schema.identityConnectionTable,
                and(
                  eq(
                    schema.identityConnectionTable.id,
                    schema.sessionTable.identityConnectionId,
                  ),
                  eq(schema.identityConnectionTable.enabled, true),
                  eq(schema.identityConnectionTable.portalScope, "agent"),
                ),
              )
              .innerJoin(
                schema.externalIdentityTable,
                and(
                  eq(
                    schema.externalIdentityTable.identityConnectionId,
                    schema.identityConnectionTable.id,
                  ),
                  eq(
                    schema.externalIdentityTable.userId,
                    schema.sessionTable.userId,
                  ),
                  eq(
                    schema.externalIdentityTable.personId,
                    schema.personTable.id,
                  ),
                  eq(schema.externalIdentityTable.issuer, evidence.issuer),
                  eq(schema.externalIdentityTable.subject, evidence.subject),
                  eq(schema.externalIdentityTable.active, true),
                ),
              )
              .where(
                and(
                  eq(schema.sessionTable.id, actor.session.id),
                  eq(schema.sessionTable.userId, c.get("userId")),
                  eq(schema.sessionTable.portal, "agent"),
                  gt(schema.sessionTable.expiresAt, dbNowUtc()),
                  isNull(schema.sessionTable.impersonatedBy),
                  eq(schema.identityConnectionTable.id, evidence.connectionId),
                  eq(schema.identityConnectionTable.issuer, evidence.issuer),
                  eq(
                    schema.identityConnectionTable.configVersion,
                    evidence.configVersion,
                  ),
                  eq(schema.identityConnectionTable.mfaUpstreamMode, "off"),
                ),
              )
              .for("update")
              .limit(1);
            const authorityValid =
              isBulkPendingAction && input.kind === "pending_action"
                ? await pendingDeletionStepUpAccess(finalExecutor, {
                    id: input.pendingActionId,
                    requesterPersonId: actor.factor.personId,
                    sessionId: actor.session.id,
                  })
                : ext
                  ? await extAuthority(ext, c.get("userId"), finalExecutor)
                  : await isCurrentInstanceAdminForStepUp(
                      c.get("userId"),
                      finalExecutor,
                    );
            const bound = Boolean(
              challenge &&
                challenge.expiresAt > evidence.callbackReceivedAt &&
                identity?.sessionId === actor.session.id &&
                identity.userId === c.get("userId") &&
                identity.connectionId === evidence.connectionId &&
                identity.personId === actor.factor.personId &&
                identity.subject === evidence.subject &&
                identity.issuer === evidence.issuer &&
                Boolean(identity.clientId) &&
                identity.configVersion === evidence.configVersion &&
                identity.mfaUpstreamMode === "off" &&
                factor.personId === actor.factor.personId &&
                !factor.required &&
                !factor.enabled &&
                (await hasLiveStepUpSession(
                  finalExecutor,
                  actor.session.id,
                  c.get("userId"),
                )) &&
                authorityValid &&
                isFreshSignedAuthTime({
                  authTime: evidence.authTime,
                  challengeCreatedAt: challenge.createdAt,
                  callbackReceivedAt: evidence.callbackReceivedAt,
                }),
            );
            if (!bound) return false;
            return true;
          },
        };
      }
      if (proofInput.method === "password") {
        if (currentFactor.required || currentFactor.enabled) return null;
        const [credential] = await getPasswordCredential(
          c.get("userId"),
          executor,
        );
        if (!credential?.password) return null;
        const passwordMatches = await bcrypt.compare(
          proofInput.password ?? "",
          credential.password,
        );
        if (!passwordMatches) return null;
        const verifiedPasswordHash = credential.password;
        return {
          authMethod: "password" as const,
          revalidate: async (finalExecutor: StepUpExecutor) => {
            const [currentCredential] = await getPasswordCredential(
              c.get("userId"),
              finalExecutor,
            );
            const currentPolicy = await loadLocalFactorState(
              c.get("userId"),
              finalExecutor,
            );
            return (
              currentCredential?.password === verifiedPasswordHash &&
              currentPolicy.personId === actor.factor.personId &&
              !currentPolicy.required &&
              !currentPolicy.enabled &&
              (await hasLiveStepUpSession(
                finalExecutor,
                actor.session.id,
                c.get("userId"),
              )) &&
              (isBulkPendingAction && input.kind === "pending_action"
                ? await pendingDeletionStepUpAccess(finalExecutor, {
                    id: input.pendingActionId,
                    requesterPersonId: actor.factor.personId,
                    sessionId: actor.session.id,
                  })
                : ext
                  ? await extAuthority(ext, c.get("userId"), finalExecutor)
                  : await isCurrentInstanceAdminForStepUp(
                      c.get("userId"),
                      finalExecutor,
                    ))
            );
          },
        };
      }
      if (
        currentFactor.personId !== actor.factor.personId ||
        !currentFactor.enabled
      )
        return null;
      try {
        if (proofInput.method === "totp") {
          const result = await withEnlistedLocalFactorVerification(async () =>
            auth.api.verifyTOTP({
              body: { code: proofInput.code ?? "", trustDevice: false },
              headers: c.req.raw.headers,
            }),
          );
          if (result.user.id !== c.get("userId")) return null;
        } else {
          const result = await withEnlistedLocalFactorVerification(async () =>
            auth.api.verifyBackupCode({
              body: { code: proofInput.code ?? "", disableSession: true },
              headers: c.req.raw.headers,
            }),
          );
          if (result.user.id !== c.get("userId")) return null;
        }
        const authMethod =
          proofInput.method === "totp" ? "totp" : "backup_code";
        return {
          authMethod,
          revalidate: async (finalExecutor: StepUpExecutor) => {
            const currentFactor = await loadLocalFactorState(
              c.get("userId"),
              finalExecutor,
            );
            return (
              currentFactor.personId === actor.factor.personId &&
              currentFactor.enabled &&
              (await hasLiveStepUpSession(
                finalExecutor,
                actor.session.id,
                c.get("userId"),
              )) &&
              (isBulkPendingAction && input.kind === "pending_action"
                ? await pendingDeletionStepUpAccess(finalExecutor, {
                    id: input.pendingActionId,
                    requesterPersonId: actor.factor.personId,
                    sessionId: actor.session.id,
                  })
                : ext
                  ? await extAuthority(ext, c.get("userId"), finalExecutor)
                  : await isCurrentInstanceAdminForStepUp(
                      c.get("userId"),
                      finalExecutor,
                    ))
            );
          },
        };
      } catch {
        return null;
      }
    };
    if (input.kind === "pending_action") {
      const [action] = await getPendingActionForStepUp(
        input.pendingActionId,
        actor.factor.personId,
        new Date(),
      );
      if (
        !action ||
        (!isBulkPendingAction &&
          !isHardPurge &&
          (action.action !== "delete" ||
            action.targetType !== "user" ||
            action.confirmation !== "typed_name_step_up" ||
            action.routeKey !== "POST /api/instance/users/{id}/deactivate"))
      ) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(404, { message: "Pending action unavailable" });
      }
      const token = await issuePendingActionToken(
        {
          id: input.challengeId,
          nonce: input.nonce,
          personId: actor.factor.personId,
          sessionId: actor.session.id,
          userId: c.get("userId"),
          pendingActionId: input.pendingActionId,
          expectedPendingAction: {
            action: action.action,
            targetType: action.targetType,
            confirmation: action.confirmation,
            routeKey: action.routeKey,
          },
        },
        verifyAuthentication,
      );
      if (!token) {
        await appendPendingActionStepUpAudit(db, {
          action: "auth.step_up_denied",
          actorId: c.get("userId"),
          personId: actor.factor.personId,
          pendingActionId: input.pendingActionId,
          traceId: c.req.header("x-request-id"),
        });
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(403, { message: "step_up_unavailable" });
      }
      await appendPendingActionStepUpAudit(db, {
        action: "auth.step_up_issued",
        actorId: c.get("userId"),
        personId: authenticatedPersonId,
        pendingActionId: input.pendingActionId,
        traceId: c.req.header("x-request-id"),
      });
      setShadowLegacyAuthorization(c, "allowed");
      return c.json({ token: token.token, expiresAt: token.expiresAt }, 200);
    }
    const token = ext
      ? await issueExtToken(
          {
            id: input.challengeId,
            nonce: input.nonce,
            personId: actor.factor.personId,
            sessionId: actor.session.id,
            userId: c.get("userId"),
          },
          ext,
          verifyAuthentication,
        )
      : oidcMappingBinding
        ? await issueOidcGroupMappingToken(
            {
              id: input.challengeId,
              nonce: input.nonce,
              personId: actor.factor.personId,
              sessionId: actor.session.id,
              userId: c.get("userId"),
              ...oidcMappingBinding,
            },
            verifyAuthentication,
          )
        : operationInput.operation === IDENTITY_CONNECTION_CREATE_OPERATION ||
            operationInput.operation === IDENTITY_CONNECTION_CONFIGURE_OPERATION
          ? await issueIdentityConnectionToken(
              {
                id: input.challengeId,
                nonce: input.nonce,
                personId: actor.factor.personId,
                sessionId: actor.session.id,
                userId: c.get("userId"),
                connectionId:
                  operationInput.operation ===
                  IDENTITY_CONNECTION_CONFIGURE_OPERATION
                    ? (operationInput.connectionId as string)
                    : undefined,
                request: connectionInput.request as unknown as Record<
                  string,
                  unknown
                >,
                operation: operationInput.operation,
              },
              verifyAuthentication,
            )
          : operationInput.operation === "scim_token_rotate" ||
              operationInput.operation === "scim_token_revoke"
            ? await issueScimTokenToken(
                {
                  id: input.challengeId,
                  nonce: input.nonce,
                  personId: actor.factor.personId,
                  sessionId: actor.session.id,
                  userId: c.get("userId"),
                  connectionId: operationInput.connectionId,
                  version:
                    "version" in operationInput ? operationInput.version : 1,
                  operation: operationInput.operation,
                },
                verifyAuthentication,
              )
            : operationInput.operation === "scim_admin_update"
              ? await issueScimAdminToken(
                  {
                    id: input.challengeId,
                    nonce: input.nonce,
                    personId: actor.factor.personId,
                    sessionId: actor.session.id,
                    userId: c.get("userId"),
                    connectionId: operationInput.connectionId,
                    request: requireScimAdminRequest(scimAdminRequest),
                  },
                  verifyAuthentication,
                )
              : operationInput.operation === "instance_admin_suspend"
                ? await issueInstanceAdminSuspendToken(
                    {
                      id: input.challengeId,
                      nonce: input.nonce,
                      personId: actor.factor.personId,
                      sessionId: actor.session.id,
                      userId: c.get("userId"),
                      targetUserId: operationInput.targetUserId,
                      request: operationInput.request,
                    },
                    verifyAuthentication,
                  )
                : operationInput.operation === "instance_admin_grant"
                  ? await issueInstanceAdminGrantToken(
                      {
                        id: input.challengeId,
                        nonce: input.nonce,
                        personId: actor.factor.personId,
                        sessionId: actor.session.id,
                        userId: c.get("userId"),
                        targetUserId: operationInput.targetUserId,
                      },
                      verifyAuthentication,
                    )
                  : operationInput.operation === "mfa_reset"
                    ? await issueMfaResetToken(
                        {
                          id: input.challengeId,
                          nonce: input.nonce,
                          personId: actor.factor.personId,
                          sessionId: actor.session.id,
                          userId: c.get("userId"),
                          targetUserId: operationInput.userId,
                          verificationNote: operationInput.verificationNote,
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
                          version:
                            "version" in operationInput
                              ? operationInput.version
                              : 1,
                        },
                        verifyAuthentication,
                      );
    if (!token) {
      await appendStepUpAudit(db, {
        action: "auth.step_up_denied",
        actorId: c.get("userId"),
        personId: actor.factor.personId,
        operation: operationInput.operation,
        traceId: c.req.header("x-request-id"),
      });
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "step_up_unavailable" });
    }
    await appendStepUpAudit(db, {
      action: "auth.step_up_issued",
      actorId: c.get("userId"),
      personId: authenticatedPersonId,
      operation: operationInput.operation,
      traceId: c.req.header("x-request-id"),
    });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ token: token.token, expiresAt: token.expiresAt }, 200);
  });

export default routes;
