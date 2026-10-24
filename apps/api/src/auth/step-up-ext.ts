import { HTTPException } from "hono/http-exception";
import { createServiceKeyBody } from "../api-key/schema";
import type db from "../database";
import { z } from "../openapi";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "../utils/require-workspace-capability";
import { WEBHOOK_EVENT_KEYS } from "../webhook/constants";
import {
  createWorkspaceRoleBody,
  transferWorkspaceOwnershipBody,
  updateWorkspaceRoleBody,
} from "../workspace/schema";
import {
  isCurrentInstanceAdminForStepUp,
  type StepUpExecutor,
  type VerifiedStepUpAuthentication,
} from "./repository";
import {
  canonicalOperationBody,
  consumeOperationProof,
  createOperationChallenge,
  issueOperationToken,
} from "./step-up-service";

/**
 * PA-15 operations added for God Mode impersonation (GM-7), the secrets re-encryption trigger
 * (GM-13) and webhook creation / destination change / secret rotation (WH-15). They share one
 * shape: a fixed route, version 1 and a server-canonical body that binds every field the proof
 * authorises. Operation keys and routes are registered in migration 0147's
 * `step_up_operation_route` CHECK and in `step-up-audit.ts`.
 */
export const IMPERSONATION_START_OPERATION = "impersonation_start" as const;
export const IMPERSONATION_START_ROUTE =
  "POST /api/instance/users/{id}/impersonate" as const;
export const SECRETS_ROTATE_OPERATION = "secrets_rotate" as const;
export const SECRETS_ROTATE_ROUTE =
  "POST /api/instance/plugins/rotate-secrets" as const;
export const WEBHOOK_CREATE_OPERATION = "webhook_create" as const;
export const WEBHOOK_CREATE_ROUTE = "POST /api/webhooks" as const;
export const WEBHOOK_UPDATE_URL_OPERATION = "webhook_update_url" as const;
export const WEBHOOK_UPDATE_URL_ROUTE = "PATCH /api/webhooks/{id}" as const;
export const WEBHOOK_ROTATE_SECRET_OPERATION = "webhook_rotate_secret" as const;
export const WEBHOOK_ROTATE_SECRET_ROUTE =
  "POST /api/webhooks/{id}/rotate-secret" as const;

export const WORKSPACE_ROLE_CREATE_OPERATION = "workspace_role_create" as const;
export const WORKSPACE_ROLE_CREATE_ROUTE =
  "POST /api/workspace/{workspaceId}/roles" as const;
export const WORKSPACE_ROLE_UPDATE_OPERATION = "workspace_role_update" as const;
export const WORKSPACE_ROLE_UPDATE_ROUTE =
  "PATCH /api/workspace/{workspaceId}/roles/{roleId}" as const;
export const SERVICE_KEY_CREATE_OPERATION = "service_key_create" as const;
export const SERVICE_KEY_CREATE_ROUTE =
  "POST /api/workspaces/{id}/api-keys" as const;
export const WORKSPACE_OWNERSHIP_TRANSFER_OPERATION =
  "workspace_ownership_transfer" as const;
export const WORKSPACE_OWNERSHIP_TRANSFER_ROUTE =
  "POST /api/workspace/{workspaceId}/transfer-ownership" as const;
/** CH-4: overriding a change freeze (feature-contracts-p5.md), bound to the change and the reason. */
export const CHANGE_FREEZE_OVERRIDE_OPERATION =
  "change_freeze_override" as const;
export const CHANGE_FREEZE_OVERRIDE_ROUTE =
  "POST /api/work-items/{key}/change/override-freeze" as const;
export const CHANGE_FREEZE_OVERRIDE_REASON_MIN = 12;
export const CHANGE_FREEZE_OVERRIDE_REASON_MAX = 500;

const id = z.string().min(1).max(128);
const url = z.string().trim().min(1).max(2048);

export const IMPERSONATION_REASON_MIN = 12;
export const IMPERSONATION_REASON_MAX = 500;

const shapes = {
  [IMPERSONATION_START_OPERATION]: {
    targetUserId: id,
    reason: z
      .string()
      .trim()
      .min(IMPERSONATION_REASON_MIN)
      .max(IMPERSONATION_REASON_MAX),
  },
  [SECRETS_ROTATE_OPERATION]: {},
  [WEBHOOK_CREATE_OPERATION]: {
    workspaceId: id,
    name: z.string().trim().min(1).max(120),
    url,
    events: z
      .array(z.enum(WEBHOOK_EVENT_KEYS))
      .min(1)
      .max(WEBHOOK_EVENT_KEYS.length),
  },
  [WEBHOOK_UPDATE_URL_OPERATION]: { workspaceId: id, webhookId: id, url },
  [WEBHOOK_ROTATE_SECRET_OPERATION]: { workspaceId: id, webhookId: id },
  // The body fields are the route's own DTO fields, so the proof binds exactly what the route
  // validates. `confirmSelfEdit` is deliberately not part of the role-update binding: it only
  // acknowledges a warning about the caller's own role and changes no authority.
  [WORKSPACE_ROLE_CREATE_OPERATION]: {
    workspaceId: id,
    ...createWorkspaceRoleBody.shape,
  },
  [WORKSPACE_ROLE_UPDATE_OPERATION]: {
    workspaceId: id,
    roleId: id,
    name: updateWorkspaceRoleBody.shape.name,
    description: updateWorkspaceRoleBody.shape.description,
    rank: updateWorkspaceRoleBody.shape.rank,
    capabilities: updateWorkspaceRoleBody.shape.capabilities,
    permission: updateWorkspaceRoleBody.shape.permission,
    expectedVersion: updateWorkspaceRoleBody.shape.expectedVersion,
  },
  [SERVICE_KEY_CREATE_OPERATION]: {
    workspaceId: id,
    ...createServiceKeyBody.shape,
  },
  [WORKSPACE_OWNERSHIP_TRANSFER_OPERATION]: {
    workspaceId: id,
    ...transferWorkspaceOwnershipBody.shape,
  },
  [CHANGE_FREEZE_OVERRIDE_OPERATION]: {
    workspaceId: id,
    workItemKey: z.string().trim().min(1).max(64),
    reason: z
      .string()
      .trim()
      .min(CHANGE_FREEZE_OVERRIDE_REASON_MIN)
      .max(CHANGE_FREEZE_OVERRIDE_REASON_MAX),
    // The optional proposed window widens what the override covers, so the proof is bound to it:
    // absent or null means "no window" and a proof minted for that cannot be spent with one.
    windowStart: z.string().datetime({ offset: true }).nullable().optional(),
    windowEnd: z.string().datetime({ offset: true }).nullable().optional(),
  },
} as const;

export type ExtOperation = keyof typeof shapes;

export const EXT_OPERATIONS = Object.keys(shapes) as ExtOperation[];

export function isExtOperation(value: unknown): value is ExtOperation {
  return typeof value === "string" && value in shapes;
}

/** One validated operation request, discriminated by `operation`. */
export type ExtInput =
  | {
      operation: typeof IMPERSONATION_START_OPERATION;
      targetUserId: string;
      reason: string;
    }
  | { operation: typeof SECRETS_ROTATE_OPERATION }
  | {
      operation: typeof WEBHOOK_CREATE_OPERATION;
      workspaceId: string;
      name: string;
      url: string;
      events: (typeof WEBHOOK_EVENT_KEYS)[number][];
    }
  | {
      operation: typeof WEBHOOK_UPDATE_URL_OPERATION;
      workspaceId: string;
      webhookId: string;
      url: string;
    }
  | {
      operation: typeof WEBHOOK_ROTATE_SECRET_OPERATION;
      workspaceId: string;
      webhookId: string;
    }
  | ({
      operation: typeof WORKSPACE_ROLE_CREATE_OPERATION;
      workspaceId: string;
    } & z.infer<typeof createWorkspaceRoleBody>)
  | ({
      operation: typeof WORKSPACE_ROLE_UPDATE_OPERATION;
      workspaceId: string;
      roleId: string;
    } & Omit<z.infer<typeof updateWorkspaceRoleBody>, "confirmSelfEdit">)
  | ({
      operation: typeof SERVICE_KEY_CREATE_OPERATION;
      workspaceId: string;
    } & z.infer<typeof createServiceKeyBody>)
  | {
      operation: typeof WORKSPACE_OWNERSHIP_TRANSFER_OPERATION;
      workspaceId: string;
      newOwnerUserId: string;
    }
  | {
      operation: typeof CHANGE_FREEZE_OVERRIDE_OPERATION;
      workspaceId: string;
      workItemKey: string;
      reason: string;
      windowStart?: string | null;
      windowEnd?: string | null;
    };

const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort();

/** `{resource: [action…]}` with sorted keys and sorted, de-duplicated action lists. */
function canonicalStatements(statements: Record<string, string[]>) {
  return Object.fromEntries(
    Object.keys(statements)
      .sort()
      .map((key) => [key, sortedUnique(statements[key] ?? [])]),
  );
}

/**
 * The single normaliser per operation: the challenge, the proof and the spending route all derive
 * the bound request through these, never by retyping fields. Absent optional fields serialise as
 * `null` on create (nothing to preserve); on a role update an absent field means "unchanged", so
 * it stays absent and a `null` description (clear it) remains distinguishable.
 */
function roleCreateRequest(
  input: Extract<ExtInput, { operation: "workspace_role_create" }>,
) {
  return {
    workspaceId: input.workspaceId,
    role: input.role,
    description: input.description ?? null,
    rank: input.rank ?? null,
    capabilities: input.capabilities ? sortedUnique(input.capabilities) : null,
    permission: input.permission ? canonicalStatements(input.permission) : null,
    cloneFromRoleId: input.cloneFromRoleId ?? null,
  };
}

function roleUpdateRequest(
  input: Extract<ExtInput, { operation: "workspace_role_update" }>,
) {
  return {
    workspaceId: input.workspaceId,
    roleId: input.roleId,
    name: input.name,
    description: input.description,
    rank: input.rank,
    capabilities: input.capabilities
      ? sortedUnique(input.capabilities)
      : undefined,
    permission: input.permission
      ? canonicalStatements(input.permission)
      : undefined,
    expectedVersion: input.expectedVersion,
  };
}

/** The generated secret is never bound: it does not exist before the proof is spent. */
function serviceKeyRequest(
  input: Extract<ExtInput, { operation: "service_key_create" }>,
) {
  return {
    workspaceId: input.workspaceId,
    name: input.name,
    expiresIn: input.expiresIn ?? null,
    capabilities: sortedUnique(input.capabilities),
    ipAllowlist: input.ipAllowlist ? [...input.ipAllowlist].sort() : null,
    rateLimitPerMinute: input.rateLimitPerMinute ?? null,
  };
}

/** A validated challenge request for one extension operation. */
export type ExtChallengeBody = { kind: "operation" } & ExtInput;

/** A validated proof request: the same binding plus the challenge and one authentication method. */
export type ExtProveBody = ExtChallengeBody & {
  challengeId: string;
  nonce: string;
} & (
    | { method: "password"; password: string }
    | { method: "totp" | "backup_code"; code: string }
  );

// The schemas are exported as `z.ZodType<Body>` on purpose. Each operation multiplies the
// literal object type of every other operation (and, for proofs, by three methods), and the
// generated client type (`hc<AppType>`) then exceeds what TypeScript can serialise (TS7056).
// Runtime validation and the OpenAPI document are built from the very same schema objects.
/** Challenge request variants (spread into the challenge union). */
export const extChallengeSchemas = EXT_OPERATIONS.map((operation) =>
  z
    .object({
      kind: z.literal("operation"),
      operation: z.literal(operation),
      ...shapes[operation],
    })
    .strict(),
) as unknown as z.ZodType<ExtChallengeBody>[];

/** Proof request variants: every operation with each of the three authentication methods. */
export const extProveSchemas = EXT_OPERATIONS.flatMap((operation) =>
  (["password", "totp", "backup_code"] as const).map((method) =>
    z
      .object({
        kind: z.literal("operation"),
        operation: z.literal(operation),
        ...shapes[operation],
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
) as unknown as z.ZodType<ExtProveBody>[];

/**
 * Fixed key order, only the fields the proof authorises. A webhook secret is deliberately not
 * bound: it is write-only and supplied by the same session that holds the proof; the exfiltration
 * risk WH-15 names is the destination and the event set.
 */
function binding(input: ExtInput): {
  operation: ExtOperation;
  route: string;
  body: Buffer;
} {
  switch (input.operation) {
    case IMPERSONATION_START_OPERATION:
      return {
        operation: input.operation,
        route: IMPERSONATION_START_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          IMPERSONATION_START_ROUTE,
          1,
          {
            userId: input.targetUserId,
            reason: input.reason,
          },
        ),
      };
    case SECRETS_ROTATE_OPERATION:
      return {
        operation: input.operation,
        route: SECRETS_ROTATE_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          SECRETS_ROTATE_ROUTE,
          1,
          {},
        ),
      };
    case WEBHOOK_CREATE_OPERATION:
      return {
        operation: input.operation,
        route: WEBHOOK_CREATE_ROUTE,
        body: canonicalOperationBody(input.operation, WEBHOOK_CREATE_ROUTE, 1, {
          workspaceId: input.workspaceId,
          name: input.name,
          url: input.url,
          events: [...input.events].sort(),
        }),
      };
    case WEBHOOK_UPDATE_URL_OPERATION:
      return {
        operation: input.operation,
        route: WEBHOOK_UPDATE_URL_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          WEBHOOK_UPDATE_URL_ROUTE,
          1,
          {
            workspaceId: input.workspaceId,
            webhookId: input.webhookId,
            url: input.url,
          },
        ),
      };
    case WEBHOOK_ROTATE_SECRET_OPERATION:
      return {
        operation: input.operation,
        route: WEBHOOK_ROTATE_SECRET_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          WEBHOOK_ROTATE_SECRET_ROUTE,
          1,
          { workspaceId: input.workspaceId, webhookId: input.webhookId },
        ),
      };
    case WORKSPACE_ROLE_CREATE_OPERATION:
      return {
        operation: input.operation,
        route: WORKSPACE_ROLE_CREATE_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          WORKSPACE_ROLE_CREATE_ROUTE,
          1,
          roleCreateRequest(input),
        ),
      };
    case WORKSPACE_ROLE_UPDATE_OPERATION:
      return {
        operation: input.operation,
        route: WORKSPACE_ROLE_UPDATE_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          WORKSPACE_ROLE_UPDATE_ROUTE,
          1,
          roleUpdateRequest(input),
        ),
      };
    case SERVICE_KEY_CREATE_OPERATION:
      return {
        operation: input.operation,
        route: SERVICE_KEY_CREATE_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          SERVICE_KEY_CREATE_ROUTE,
          1,
          serviceKeyRequest(input),
        ),
      };
    case WORKSPACE_OWNERSHIP_TRANSFER_OPERATION:
      return {
        operation: input.operation,
        route: WORKSPACE_OWNERSHIP_TRANSFER_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          WORKSPACE_OWNERSHIP_TRANSFER_ROUTE,
          1,
          {
            workspaceId: input.workspaceId,
            newOwnerUserId: input.newOwnerUserId,
          },
        ),
      };
    case CHANGE_FREEZE_OVERRIDE_OPERATION:
      return {
        operation: input.operation,
        route: CHANGE_FREEZE_OVERRIDE_ROUTE,
        body: canonicalOperationBody(
          input.operation,
          CHANGE_FREEZE_OVERRIDE_ROUTE,
          1,
          {
            workspaceId: input.workspaceId,
            workItemKey: input.workItemKey,
            reason: input.reason,
            windowStart: input.windowStart
              ? new Date(input.windowStart).toISOString()
              : null,
            windowEnd: input.windowEnd
              ? new Date(input.windowEnd).toISOString()
              : null,
          },
        ),
      };
  }
}

export function createExtChallenge(
  actor: { personId: string; sessionId: string },
  input: ExtInput,
) {
  const bound = binding(input);
  return createOperationChallenge({
    personId: actor.personId,
    sessionId: actor.sessionId,
    operation: bound.operation,
    route: bound.route,
    version: 1,
    body: bound.body,
  });
}

export function issueExtToken(
  actor: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    userId: string;
  },
  input: ExtInput,
  verifyAuthentication: (
    executor: StepUpExecutor,
  ) => Promise<VerifiedStepUpAuthentication | null>,
) {
  const bound = binding(input);
  return issueOperationToken(
    {
      ...actor,
      operation: bound.operation,
      route: bound.route,
      version: 1,
      body: bound.body,
    },
    verifyAuthentication,
  );
}

export function consumeExtProof(
  tx: StepUpExecutor,
  actor: { token: string; personId: string; sessionId: string },
  input: ExtInput,
) {
  const bound = binding(input);
  return consumeOperationProof(tx, {
    ...actor,
    operation: bound.operation,
    route: bound.route,
    version: 1,
    body: bound.body,
  });
}

/** The workspace capability that gates obtaining a proof for each workspace-scoped operation. */
const EXT_OPERATION_CAPABILITY = {
  [WEBHOOK_CREATE_OPERATION]: "webhook:manage",
  [WEBHOOK_UPDATE_URL_OPERATION]: "webhook:manage",
  [WEBHOOK_ROTATE_SECRET_OPERATION]: "webhook:manage",
  [WORKSPACE_ROLE_CREATE_OPERATION]: "workspace:manage_roles",
  [WORKSPACE_ROLE_UPDATE_OPERATION]: "workspace:manage_roles",
  [SERVICE_KEY_CREATE_OPERATION]: "api_key:manage",
  [WORKSPACE_OWNERSHIP_TRANSFER_OPERATION]: "workspace:transfer_ownership",
  [CHANGE_FREEZE_OVERRIDE_OPERATION]: "change:manage",
} as const;

/**
 * Who may obtain and spend a proof for the operation. Impersonation and secret re-encryption are
 * instance-administrator actions; every other operation requires its own capability in the bound
 * workspace (see `EXT_OPERATION_CAPABILITY`). The workspace on the route is server-resolved, so a proof bound to another
 * workspace's id fails the body-hash comparison at consumption.
 */
export async function extAuthority(
  input: ExtInput,
  userId: string,
  executor: typeof db | StepUpExecutor,
): Promise<boolean> {
  if (
    input.operation === IMPERSONATION_START_OPERATION ||
    input.operation === SECRETS_ROTATE_OPERATION
  )
    return isCurrentInstanceAdminForStepUp(userId, executor);
  try {
    await assertCallerHasCapability(
      input.workspaceId,
      userId,
      EXT_OPERATION_CAPABILITY[input.operation],
      capabilityCredential(undefined),
      executor as never,
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException) return false;
    throw error;
  }
}
