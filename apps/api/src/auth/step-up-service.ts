import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type { ScimAdminRequest } from "@taskdesk/domain";
import { canonicalScimAdminRequest } from "@taskdesk/domain";
import { and, eq, gt, sql } from "drizzle-orm";
import db, { schema } from "../database";
import {
  countRecentOperationChallenges,
  countRecentPendingActionChallenges,
  lockActiveStepUpSession,
  lockOperationChallenge,
  lockOperationProof,
  lockPendingActionById,
  lockPendingActionChallenge,
  lockPendingActionForChallenge,
  lockPendingActionProof,
} from "./repository";

export const STEP_UP_OPERATION = "metrics_token_rotate" as const;
export const STEP_UP_ROUTE =
  "POST /api/instance/observability/metrics-token/rotate" as const;
export const MFA_RESET_OPERATION = "mfa_reset" as const;
export const MFA_RESET_ROUTE =
  "POST /api/instance/users/{id}/reset-mfa" as const;
export const INSTANCE_ADMIN_GRANT_OPERATION = "instance_admin_grant" as const;
export const INSTANCE_ADMIN_GRANT_ROUTE =
  "POST /api/instance/users/{id}/grant-admin" as const;
export const SCIM_ADMIN_OPERATION = "scim_admin_update" as const;
export const SCIM_ADMIN_ROUTE =
  "PATCH /api/instance/identity-connections/{id}/scim" as const;
export const SCIM_TOKEN_ROTATE_OPERATION = "scim_token_rotate" as const;
export const SCIM_TOKEN_ROTATE_ROUTE =
  "POST /api/instance/identity-connections/{id}/scim/rotate-token" as const;
export const SCIM_TOKEN_REVOKE_OPERATION = "scim_token_revoke" as const;
export const SCIM_TOKEN_REVOKE_ROUTE =
  "POST /api/instance/identity-connections/{id}/scim/revoke-token" as const;
export const IDENTITY_CONNECTION_CREATE_OPERATION =
  "identity_connection_create" as const;
export const IDENTITY_CONNECTION_CREATE_ROUTE =
  "POST /api/instance/identity-connections" as const;
export const IDENTITY_CONNECTION_CONFIGURE_OPERATION =
  "identity_connection_configure" as const;
export const IDENTITY_CONNECTION_CONFIGURE_ROUTE =
  "PATCH /api/instance/identity-connections/{id}" as const;
export class StepUpAttemptLimitError extends Error {
  constructor() {
    super("step_up_attempt_limit");
  }
}
export const STEP_UP_CHALLENGE_LIMIT = 5;
export const STEP_UP_CHALLENGE_WINDOW_MINUTES = 15;

export function canonicalRotationBody(version: number): Buffer {
  return canonicalOperationBody(STEP_UP_OPERATION, STEP_UP_ROUTE, version, {
    version,
  });
}

export function canonicalMfaResetBody(
  userId: string,
  verificationNote: string,
): Buffer {
  return canonicalOperationBody(MFA_RESET_OPERATION, MFA_RESET_ROUTE, 1, {
    userId,
    verificationNote,
  });
}

export function canonicalInstanceAdminGrantBody(userId: string): Buffer {
  return canonicalOperationBody(
    INSTANCE_ADMIN_GRANT_OPERATION,
    INSTANCE_ADMIN_GRANT_ROUTE,
    1,
    { userId },
  );
}

export function canonicalScimAdminBody(
  connectionId: string,
  request: ScimAdminRequest,
): Buffer {
  return Buffer.from(canonicalScimAdminRequest(connectionId, request), "utf8");
}

export function canonicalScimTokenBody(version: number): Buffer {
  // PA-15 stores the operation, route, version, person and session as separate
  // binding columns. The body hash is only the canonical validated request body.
  return Buffer.from(JSON.stringify({ version }), "utf8");
}

export function canonicalIdentityConnectionCreateBody(
  request: Record<string, unknown>,
): Buffer {
  return canonicalOperationBody(
    IDENTITY_CONNECTION_CREATE_OPERATION,
    IDENTITY_CONNECTION_CREATE_ROUTE,
    1,
    request,
  );
}

export function canonicalIdentityConnectionConfigureBody(
  connectionId: string,
  request: Record<string, unknown>,
): Buffer {
  return canonicalOperationBody(
    IDENTITY_CONNECTION_CONFIGURE_OPERATION,
    IDENTITY_CONNECTION_CONFIGURE_ROUTE,
    Number(request.configVersion),
    { connectionId, request },
  );
}

export function createIdentityConnectionChallenge(input: {
  personId: string;
  sessionId: string;
  connectionId?: string;
  request: Record<string, unknown>;
  operation:
    | typeof IDENTITY_CONNECTION_CREATE_OPERATION
    | typeof IDENTITY_CONNECTION_CONFIGURE_OPERATION;
}) {
  const creating = input.operation === IDENTITY_CONNECTION_CREATE_OPERATION;
  return createOperationChallenge({
    personId: input.personId,
    sessionId: input.sessionId,
    operation: input.operation,
    route: creating
      ? IDENTITY_CONNECTION_CREATE_ROUTE
      : IDENTITY_CONNECTION_CONFIGURE_ROUTE,
    version: creating ? 1 : Number(input.request.configVersion),
    body: creating
      ? canonicalIdentityConnectionCreateBody(input.request)
      : canonicalIdentityConnectionConfigureBody(
          input.connectionId ?? "",
          input.request,
        ),
  });
}

export function createScimAdminChallenge(input: {
  personId: string;
  sessionId: string;
  connectionId: string;
  request: ScimAdminRequest;
}) {
  return createOperationChallenge({
    personId: input.personId,
    sessionId: input.sessionId,
    operation: SCIM_ADMIN_OPERATION,
    route: SCIM_ADMIN_ROUTE,
    version: input.request.configVersion,
    body: canonicalScimAdminBody(input.connectionId, input.request),
  });
}

export function createScimTokenChallenge(input: {
  personId: string;
  sessionId: string;
  connectionId: string;
  version: number;
  operation:
    | typeof SCIM_TOKEN_ROTATE_OPERATION
    | typeof SCIM_TOKEN_REVOKE_OPERATION;
}) {
  const route =
    input.operation === SCIM_TOKEN_ROTATE_OPERATION
      ? SCIM_TOKEN_ROTATE_ROUTE
      : SCIM_TOKEN_REVOKE_ROUTE;
  return createOperationChallenge({
    personId: input.personId,
    sessionId: input.sessionId,
    operation: input.operation,
    route,
    version: input.version,
    body: canonicalScimTokenBody(input.version),
  });
}

function canonicalOperationBody(
  operation: string,
  route: string,
  version: number,
  request: Record<string, unknown>,
): Buffer {
  return Buffer.from(
    JSON.stringify({ operation, route, version, request }),
    "utf8",
  );
}

export function sha256(value: Buffer | string): Buffer {
  return createHash("sha256").update(value).digest();
}

export async function createRotationChallenge(input: {
  personId: string;
  sessionId: string;
  version: number;
}) {
  return createOperationChallenge({
    ...input,
    operation: STEP_UP_OPERATION,
    route: STEP_UP_ROUTE,
    body: canonicalRotationBody(input.version),
  });
}

export async function createMfaResetChallenge(input: {
  personId: string;
  sessionId: string;
  userId: string;
  verificationNote: string;
}) {
  return createOperationChallenge({
    personId: input.personId,
    sessionId: input.sessionId,
    userId: input.userId,
    operation: MFA_RESET_OPERATION,
    route: MFA_RESET_ROUTE,
    version: 1,
    body: canonicalMfaResetBody(input.userId, input.verificationNote),
  });
}

export async function createInstanceAdminGrantChallenge(input: {
  personId: string;
  sessionId: string;
  userId: string;
}) {
  return createOperationChallenge({
    ...input,
    operation: INSTANCE_ADMIN_GRANT_OPERATION,
    route: INSTANCE_ADMIN_GRANT_ROUTE,
    version: 1,
    body: canonicalInstanceAdminGrantBody(input.userId),
  });
}

export async function createPendingActionChallenge(input: {
  personId: string;
  sessionId: string;
  pendingActionId: string;
}) {
  const id = createId();
  const nonce = randomBytes(32);
  const challengeExpiresAt = await db.transaction(async (tx) => {
    const [action] = await lockPendingActionForChallenge(
      tx,
      input.pendingActionId,
      input.personId,
    );
    if (!action?.confirmation.endsWith("_step_up")) return null;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.pendingActionId}))`,
    );
    const [recent] = await countRecentPendingActionChallenges(
      tx,
      input.personId,
      input.sessionId,
      input.pendingActionId,
    );
    if ((recent?.value ?? 0) >= STEP_UP_CHALLENGE_LIMIT)
      throw new StepUpAttemptLimitError();
    await tx
      .update(schema.stepUpConfirmationTable)
      .set({ challengeExpiresAt: sql`now()` })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.personId, input.personId),
          eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
          eq(schema.stepUpConfirmationTable.bindingKind, "pending_action"),
          eq(
            schema.stepUpConfirmationTable.pendingActionId,
            input.pendingActionId,
          ),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
          gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
        ),
      );
    await tx
      .update(schema.stepUpConfirmationTable)
      .set({ tokenExpiresAt: sql`now()` })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.personId, input.personId),
          eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
          eq(schema.stepUpConfirmationTable.bindingKind, "pending_action"),
          eq(
            schema.stepUpConfirmationTable.pendingActionId,
            input.pendingActionId,
          ),
          eq(schema.stepUpConfirmationTable.state, "issued"),
          gt(schema.stepUpConfirmationTable.tokenExpiresAt, sql`now()`),
        ),
      );
    const clock = await tx.execute<{ challenge_expires_at: string }>(
      sql`SELECT (now() + interval '5 minutes')::text AS challenge_expires_at`,
    );
    const clockRow = clock.rows[0];
    if (!clockRow) throw new Error("Database time is unavailable");
    const expiresAt = new Date(clockRow.challenge_expires_at);
    await tx.insert(schema.stepUpConfirmationTable).values({
      id,
      personId: input.personId,
      sessionId: input.sessionId,
      bindingKind: "pending_action",
      pendingActionId: input.pendingActionId,
      operationKey: null,
      routeKey: null,
      expectedVersion: null,
      bodyHash: null,
      challengeNonceHash: sha256(nonce),
      state: "challenge",
      challengeExpiresAt: expiresAt,
    });
    return expiresAt;
  });
  if (!challengeExpiresAt) return null;
  return {
    id,
    nonce: nonce.toString("base64url"),
    expiresAt: challengeExpiresAt.toISOString(),
  };
}

async function createOperationChallenge(input: {
  personId: string;
  sessionId: string;
  userId?: string;
  operation: string;
  route: string;
  version: number;
  body: Buffer;
}) {
  const id = createId();
  const nonce = randomBytes(32);
  const bodyHash = sha256(input.body);
  const challengeExpiresAt = await db.transaction(async (tx) => {
    const clock = await tx.execute<{ challenge_expires_at: string }>(
      sql`SELECT (now() + interval '5 minutes')::text AS challenge_expires_at`,
    );
    const clockRow = clock.rows[0];
    if (!clockRow) throw new Error("Unable to read database challenge time");
    const expiresAt = new Date(clockRow.challenge_expires_at);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.operation}))`,
    );
    const [recent] = await countRecentOperationChallenges(
      tx,
      input.personId,
      input.sessionId,
      input.operation,
    );
    if ((recent?.value ?? 0) >= STEP_UP_CHALLENGE_LIMIT)
      throw new StepUpAttemptLimitError();
    await tx
      .update(schema.stepUpConfirmationTable)
      .set({ challengeExpiresAt: sql`now()` })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.personId, input.personId),
          eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
          eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
          eq(schema.stepUpConfirmationTable.operationKey, input.operation),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
          gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
        ),
      );
    await tx
      .update(schema.stepUpConfirmationTable)
      .set({ state: "consumed", consumedAt: new Date() })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.personId, input.personId),
          eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
          eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
          eq(schema.stepUpConfirmationTable.operationKey, input.operation),
          eq(schema.stepUpConfirmationTable.state, "issued"),
        ),
      );
    await tx.insert(schema.stepUpConfirmationTable).values({
      id,
      personId: input.personId,
      sessionId: input.sessionId,
      bindingKind: "operation",
      pendingActionId: null,
      operationKey: input.operation,
      routeKey: input.route,
      expectedVersion: input.version,
      bodyHash,
      challengeNonceHash: sha256(nonce),
      state: "challenge",
      challengeExpiresAt: expiresAt,
    });
    return expiresAt;
  });

  return {
    id,
    nonce: nonce.toString("base64url"),
    expiresAt: challengeExpiresAt.toISOString(),
  };
}

type StepUpTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function consumeRotationProof(
  tx: StepUpTransaction,
  input: {
    token: string;
    personId: string;
    sessionId: string;
    version: number;
  },
): Promise<{ authMethod: "password" | "totp" | "backup_code" } | null> {
  return consumeOperationProof(tx, {
    ...input,
    operation: STEP_UP_OPERATION,
    route: STEP_UP_ROUTE,
    body: canonicalRotationBody(input.version),
  });
}

export async function consumeMfaResetProof(
  tx: StepUpTransaction,
  input: {
    token: string;
    personId: string;
    sessionId: string;
    userId: string;
    verificationNote: string;
  },
): Promise<{ authMethod: "password" | "totp" | "backup_code" } | null> {
  return consumeOperationProof(tx, {
    ...input,
    version: 1,
    operation: MFA_RESET_OPERATION,
    route: MFA_RESET_ROUTE,
    body: canonicalMfaResetBody(input.userId, input.verificationNote),
  });
}

export async function consumeInstanceAdminGrantProof(
  tx: StepUpTransaction,
  input: { token: string; personId: string; sessionId: string; userId: string },
): Promise<{ authMethod: "password" | "totp" | "backup_code" } | null> {
  return consumeOperationProof(tx, {
    ...input,
    version: 1,
    operation: INSTANCE_ADMIN_GRANT_OPERATION,
    route: INSTANCE_ADMIN_GRANT_ROUTE,
    body: canonicalInstanceAdminGrantBody(input.userId),
  });
}

export async function consumePendingActionProof(
  tx: StepUpTransaction,
  input: {
    token: string;
    personId: string;
    sessionId: string;
    pendingActionId: string;
  },
): Promise<{ id: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.token)) return null;
  const raw = Buffer.from(input.token, "base64url");
  if (raw.length !== 32 || raw.toString("base64url") !== input.token)
    return null;
  const tokenHash = sha256(raw);
  const [proof] = await lockPendingActionProof(tx, {
    tokenHash,
    personId: input.personId,
    sessionId: input.sessionId,
    pendingActionId: input.pendingActionId,
  });
  if (!proof) return null;
  const consumed = await tx
    .update(schema.stepUpConfirmationTable)
    .set({ state: "consumed", consumedAt: sql`now()` })
    .where(
      and(
        eq(schema.stepUpConfirmationTable.id, proof.id),
        eq(schema.stepUpConfirmationTable.state, "issued"),
        gt(schema.stepUpConfirmationTable.tokenExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: schema.stepUpConfirmationTable.id });
  return consumed.length === 1 ? { id: proof.id } : null;
}

export async function consumeScimAdminProof(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    token: string;
    personId: string;
    sessionId: string;
    connectionId: string;
    request: ScimAdminRequest;
  },
) {
  return consumeOperationProof(tx, {
    ...input,
    version: input.request.configVersion,
    operation: SCIM_ADMIN_OPERATION,
    route: SCIM_ADMIN_ROUTE,
    body: canonicalScimAdminBody(input.connectionId, input.request),
  });
}

export async function consumeIdentityConnectionProof(
  tx: StepUpTransaction,
  input: {
    token: string;
    personId: string;
    sessionId: string;
    connectionId?: string;
    request: Record<string, unknown>;
    operation:
      | typeof IDENTITY_CONNECTION_CREATE_OPERATION
      | typeof IDENTITY_CONNECTION_CONFIGURE_OPERATION;
  },
) {
  const creating = input.operation === IDENTITY_CONNECTION_CREATE_OPERATION;
  return consumeOperationProof(tx, {
    ...input,
    version: creating ? 1 : Number(input.request.configVersion),
    route: creating
      ? IDENTITY_CONNECTION_CREATE_ROUTE
      : IDENTITY_CONNECTION_CONFIGURE_ROUTE,
    body: creating
      ? canonicalIdentityConnectionCreateBody(input.request)
      : canonicalIdentityConnectionConfigureBody(
          input.connectionId ?? "",
          input.request,
        ),
  });
}

export async function consumeScimTokenProof(
  tx: StepUpTransaction,
  input: {
    token: string;
    personId: string;
    sessionId: string;
    connectionId: string;
    version: number;
    operation:
      | typeof SCIM_TOKEN_ROTATE_OPERATION
      | typeof SCIM_TOKEN_REVOKE_OPERATION;
  },
) {
  const route =
    input.operation === SCIM_TOKEN_ROTATE_OPERATION
      ? SCIM_TOKEN_ROTATE_ROUTE
      : SCIM_TOKEN_REVOKE_ROUTE;
  return consumeOperationProof(tx, {
    ...input,
    route,
    body: canonicalScimTokenBody(input.version),
  });
}

async function consumeOperationProof(
  tx: StepUpTransaction,
  input: {
    token: string;
    personId: string;
    sessionId: string;
    userId?: string;
    version: number;
    operation: string;
    route: string;
    body: Buffer;
  },
): Promise<{ authMethod: "password" | "totp" | "backup_code" } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.token)) return null;
  const raw = Buffer.from(input.token, "base64url");
  if (raw.length !== 32 || raw.toString("base64url") !== input.token)
    return null;
  const tokenHash = sha256(raw);
  const bodyHash = sha256(input.body);
  const [proof] = await lockOperationProof(tx, {
    tokenHash,
    personId: input.personId,
    sessionId: input.sessionId,
    operation: input.operation,
    route: input.route,
    version: input.version,
  });
  if (!proof?.bodyHash || !proof.authMethod) return null;
  if (!timingSafeEqual(proof.bodyHash, bodyHash)) return null;
  const consumed = await tx
    .update(schema.stepUpConfirmationTable)
    .set({ state: "consumed", consumedAt: sql`now()` })
    .where(
      and(
        eq(schema.stepUpConfirmationTable.id, proof.id),
        eq(schema.stepUpConfirmationTable.state, "issued"),
        gt(schema.stepUpConfirmationTable.tokenExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: schema.stepUpConfirmationTable.id });
  if (consumed.length !== 1) return null;
  if (
    proof.authMethod !== "password" &&
    proof.authMethod !== "totp" &&
    proof.authMethod !== "backup_code"
  ) {
    return null;
  }
  return { authMethod: proof.authMethod };
}

export async function issueRotationToken(
  input: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    userId: string;
    version: number;
  },
  verifyAuthentication: () => Promise<
    "password" | "totp" | "backup_code" | null
  >,
) {
  return issueOperationToken(
    {
      ...input,
      operation: STEP_UP_OPERATION,
      route: STEP_UP_ROUTE,
      body: canonicalRotationBody(input.version),
    },
    verifyAuthentication,
  );
}

export async function issueMfaResetToken(
  input: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    /** Acting administrator, used to recheck the live session. */
    userId: string;
    /** Reset target, used only in the canonical operation binding. */
    targetUserId: string;
    verificationNote: string;
  },
  verifyAuthentication: () => Promise<
    "password" | "totp" | "backup_code" | null
  >,
) {
  return issueOperationToken(
    {
      ...input,
      version: 1,
      operation: MFA_RESET_OPERATION,
      route: MFA_RESET_ROUTE,
      body: canonicalMfaResetBody(input.targetUserId, input.verificationNote),
    },
    verifyAuthentication,
  );
}

export async function issueInstanceAdminGrantToken(
  input: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    userId: string;
    targetUserId: string;
  },
  verifyAuthentication: () => Promise<
    "password" | "totp" | "backup_code" | null
  >,
) {
  return issueOperationToken(
    {
      ...input,
      version: 1,
      operation: INSTANCE_ADMIN_GRANT_OPERATION,
      route: INSTANCE_ADMIN_GRANT_ROUTE,
      body: canonicalInstanceAdminGrantBody(input.targetUserId),
    },
    verifyAuthentication,
  );
}

export async function issuePendingActionToken(
  input: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    userId: string;
    pendingActionId: string;
  },
  verifyAuthentication: () => Promise<
    "password" | "totp" | "backup_code" | null
  >,
) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.nonce)) return null;
  const nonce = Buffer.from(input.nonce, "base64url");
  if (nonce.length !== 32 || nonce.toString("base64url") !== input.nonce)
    return null;
  const token = randomBytes(32);
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.pendingActionId}))`,
    );
    const [activeSession] = await lockActiveStepUpSession(
      tx,
      input.sessionId,
      input.userId,
    );
    if (!activeSession) return null;
    const [action] = await lockPendingActionById(
      tx,
      input.pendingActionId,
      input.personId,
    );
    if (!action) return null;
    const [challenge] = await lockPendingActionChallenge(tx, input);
    if (!challenge) return null;
    const nonceHash = sha256(nonce);
    if (!timingSafeEqual(challenge.challengeNonceHash, nonceHash)) {
      await tx
        .update(schema.stepUpConfirmationTable)
        .set({ challengeExpiresAt: sql`now()` })
        .where(
          and(
            eq(schema.stepUpConfirmationTable.id, input.id),
            eq(schema.stepUpConfirmationTable.state, "challenge"),
          ),
        );
      return null;
    }
    const authMethod = await verifyAuthentication();
    if (!authMethod) {
      await tx
        .update(schema.stepUpConfirmationTable)
        .set({ challengeExpiresAt: sql`now()` })
        .where(
          and(
            eq(schema.stepUpConfirmationTable.id, input.id),
            eq(schema.stepUpConfirmationTable.state, "challenge"),
          ),
        );
      return null;
    }
    const clock = await tx.execute<{
      issued_at: string;
      token_expires_at: string;
    }>(
      sql`SELECT now()::text AS issued_at, (now() + interval '5 minutes')::text AS token_expires_at`,
    );
    const clockRow = clock.rows[0];
    if (!clockRow) throw new Error("Database time is unavailable");
    const issuedAt = new Date(clockRow.issued_at);
    const tokenExpiresAt = new Date(clockRow.token_expires_at);
    const updated = await tx
      .update(schema.stepUpConfirmationTable)
      .set({
        state: "issued",
        tokenHash: sha256(token),
        authMethod,
        authenticatedAt: issuedAt,
        issuedAt,
        tokenExpiresAt,
      })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.id, input.id),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
          gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
        ),
      )
      .returning({ id: schema.stepUpConfirmationTable.id });
    return updated.length === 1 ? { authMethod, tokenExpiresAt } : null;
  });
  return result
    ? {
        token: token.toString("base64url"),
        expiresAt: result.tokenExpiresAt.toISOString(),
        authMethod: result.authMethod,
      }
    : null;
}

export async function issueScimAdminToken(
  input: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    userId: string;
    connectionId: string;
    request: ScimAdminRequest;
  },
  verifyAuthentication: () => Promise<
    "password" | "totp" | "backup_code" | null
  >,
) {
  return issueOperationToken(
    {
      ...input,
      version: input.request.configVersion,
      operation: SCIM_ADMIN_OPERATION,
      route: SCIM_ADMIN_ROUTE,
      body: canonicalScimAdminBody(input.connectionId, input.request),
    },
    verifyAuthentication,
  );
}

export async function issueIdentityConnectionToken(
  input: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    userId: string;
    connectionId?: string;
    request: Record<string, unknown>;
    operation:
      | typeof IDENTITY_CONNECTION_CREATE_OPERATION
      | typeof IDENTITY_CONNECTION_CONFIGURE_OPERATION;
  },
  verifyAuthentication: () => Promise<
    "password" | "totp" | "backup_code" | null
  >,
) {
  const creating = input.operation === IDENTITY_CONNECTION_CREATE_OPERATION;
  return issueOperationToken(
    {
      ...input,
      version: creating ? 1 : Number(input.request.configVersion),
      route: creating
        ? IDENTITY_CONNECTION_CREATE_ROUTE
        : IDENTITY_CONNECTION_CONFIGURE_ROUTE,
      body: creating
        ? canonicalIdentityConnectionCreateBody(input.request)
        : canonicalIdentityConnectionConfigureBody(
            input.connectionId ?? "",
            input.request,
          ),
    },
    verifyAuthentication,
  );
}

export async function issueScimTokenToken(
  input: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    userId: string;
    connectionId: string;
    version: number;
    operation:
      | typeof SCIM_TOKEN_ROTATE_OPERATION
      | typeof SCIM_TOKEN_REVOKE_OPERATION;
  },
  verifyAuthentication: () => Promise<
    "password" | "totp" | "backup_code" | null
  >,
) {
  const route =
    input.operation === SCIM_TOKEN_ROTATE_OPERATION
      ? SCIM_TOKEN_ROTATE_ROUTE
      : SCIM_TOKEN_REVOKE_ROUTE;
  return issueOperationToken(
    {
      ...input,
      route,
      body: canonicalScimTokenBody(input.version),
    },
    verifyAuthentication,
  );
}

async function issueOperationToken(
  input: {
    id: string;
    nonce: string;
    personId: string;
    sessionId: string;
    userId: string;
    version: number;
    operation: string;
    route: string;
    body: Buffer;
  },
  verifyAuthentication: () => Promise<
    "password" | "totp" | "backup_code" | null
  >,
) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.nonce)) return null;
  const nonce = Buffer.from(input.nonce, "base64url");
  if (nonce.length !== 32 || nonce.toString("base64url") !== input.nonce) {
    return null;
  }
  const bodyHash = sha256(input.body);
  const token = randomBytes(32);
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.operation}))`,
    );
    const [activeSession] = await lockActiveStepUpSession(
      tx,
      input.sessionId,
      input.userId,
    );
    if (!activeSession) return null;
    const [challenge] = await lockOperationChallenge(tx, input);
    if (!challenge?.bodyHash || !challenge.challengeNonceHash) return null;
    if (!timingSafeEqual(challenge.bodyHash, bodyHash)) return null;
    const nonceHash = sha256(nonce);
    if (!timingSafeEqual(challenge.challengeNonceHash, nonceHash)) {
      // A challenge authorizes exactly one verifier attempt. Burning it on a nonce
      // mismatch keeps custom credential checks bounded independently of Better Auth's
      // HTTP limiter while leaving unrelated/missing challenge ids untouched.
      await tx
        .update(schema.stepUpConfirmationTable)
        .set({ challengeExpiresAt: sql`now()` })
        .where(
          and(
            eq(schema.stepUpConfirmationTable.id, input.id),
            eq(schema.stepUpConfirmationTable.state, "challenge"),
          ),
        );
      return null;
    }
    const authMethod = await verifyAuthentication();
    if (!authMethod) {
      await tx
        .update(schema.stepUpConfirmationTable)
        .set({ challengeExpiresAt: sql`now()` })
        .where(
          and(
            eq(schema.stepUpConfirmationTable.id, input.id),
            eq(schema.stepUpConfirmationTable.state, "challenge"),
          ),
        );
      return null;
    }
    const clock = await tx.execute<{
      issued_at: string;
      token_expires_at: string;
    }>(
      sql`SELECT now()::text AS issued_at, (now() + interval '5 minutes')::text AS token_expires_at`,
    );
    const clockRow = clock.rows[0];
    if (!clockRow) throw new Error("Unable to read database token time");
    const issuedAt = new Date(clockRow.issued_at);
    const tokenExpiresAt = new Date(clockRow.token_expires_at);

    const updated = await tx
      .update(schema.stepUpConfirmationTable)
      .set({
        state: "issued",
        tokenHash: sha256(token),
        authMethod,
        authenticatedAt: issuedAt,
        issuedAt,
        tokenExpiresAt,
      })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.id, input.id),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
          gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
        ),
      )
      .returning({ id: schema.stepUpConfirmationTable.id });
    return updated.length === 1
      ? { authMethod, issuedAt, tokenExpiresAt }
      : null;
  });

  return result
    ? {
        token: token.toString("base64url"),
        expiresAt: result.tokenExpiresAt.toISOString(),
        authMethod: result.authMethod,
      }
    : null;
}
