import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, gt, sql } from "drizzle-orm";
import db, { schema } from "../database";

export const STEP_UP_OPERATION = "metrics_token_rotate" as const;
export const STEP_UP_ROUTE =
  "POST /api/instance/observability/metrics-token/rotate" as const;
export const MFA_RESET_OPERATION = "mfa_reset" as const;
export const MFA_RESET_ROUTE =
  "POST /api/instance/users/{id}/reset-mfa" as const;
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
    const expiresAt = new Date(clock.rows[0]!.challenge_expires_at);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.operation}))`,
    );
    const [recent] = await tx
      .select({ value: count() })
      .from(schema.stepUpConfirmationTable)
      .where(
        and(
          eq(schema.stepUpConfirmationTable.personId, input.personId),
          eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
          eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
          eq(schema.stepUpConfirmationTable.operationKey, input.operation),
          gt(
            schema.stepUpConfirmationTable.createdAt,
            sql`now() - interval '15 minutes'`,
          ),
        ),
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
  const [proof] = await tx
    .select()
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.tokenHash, tokenHash),
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
        eq(schema.stepUpConfirmationTable.operationKey, input.operation),
        eq(schema.stepUpConfirmationTable.routeKey, input.route),
        eq(schema.stepUpConfirmationTable.expectedVersion, input.version),
        eq(schema.stepUpConfirmationTable.state, "issued"),
        gt(schema.stepUpConfirmationTable.tokenExpiresAt, sql`now()`),
      ),
    )
    .for("update")
    .limit(1);
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
    const [activeSession] = await tx
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable)
      .where(
        and(
          eq(schema.sessionTable.id, input.sessionId),
          eq(schema.sessionTable.userId, input.userId),
          eq(schema.sessionTable.portal, "agent"),
          gt(schema.sessionTable.expiresAt, sql`now()`),
        ),
      )
      .for("update")
      .limit(1);
    if (!activeSession) return null;
    const [challenge] = await tx
      .select()
      .from(schema.stepUpConfirmationTable)
      .where(
        and(
          eq(schema.stepUpConfirmationTable.id, input.id),
          eq(schema.stepUpConfirmationTable.personId, input.personId),
          eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
          eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
          eq(schema.stepUpConfirmationTable.operationKey, input.operation),
          eq(schema.stepUpConfirmationTable.routeKey, input.route),
          eq(schema.stepUpConfirmationTable.expectedVersion, input.version),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
          gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
        ),
      )
      .for("update")
      .limit(1);
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
    const issuedAt = new Date(clock.rows[0]!.issued_at);
    const tokenExpiresAt = new Date(clock.rows[0]!.token_expires_at);

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
