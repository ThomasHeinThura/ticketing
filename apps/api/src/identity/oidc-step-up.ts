import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { isFreshSignedAuthTime, readSignedAuthTime } from "../auth/step-up-sso";
import db, { schema } from "../database";
import { dbNowUtc } from "../utils/db-time";
import { decryptIdentityClientSecret } from "./client-secret";
import {
  exchangeEntraCode,
  loadEntraDiscovery,
  loadEntraJwks,
} from "./oidc-provider";
import { validateEntraIdToken } from "./oidc-token";

const STATE_PREFIX = "su1_";
const FLOW_PREFIX = "step-up-oidc-flow:";
const VERIFIED_PREFIX = "step-up-oidc-verified:";
const FLOW_TTL_MS = 5 * 60_000;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest();
}

function same(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function originForAgent() {
  return new URL(process.env.TASKDESK_AGENT_URL || "http://localhost:5173")
    .origin;
}

export function isOidcStepUpState(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith(STATE_PREFIX);
}

export function oidcStepUpStateCookieName(secure: boolean) {
  return secure ? "__Host-tdk_oidc_step_up_state" : "tdk_oidc_step_up_state";
}

export function oidcStepUpStateCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    path: secure ? "/" : "/api/auth",
    maxAge: FLOW_TTL_MS / 1000,
  };
}

export async function createOidcStepUpStart(input: {
  challengeId: string;
  nonce: string;
  sessionId: string;
  userId: string;
  personId: string;
}): Promise<{
  authorizationUrl: string;
  state: string;
  secure: boolean;
} | null> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.nonce)) return null;
  const nonceBytes = Buffer.from(input.nonce, "base64url");
  if (
    nonceBytes.length !== 32 ||
    nonceBytes.toString("base64url") !== input.nonce
  )
    return null;

  const startContext = await db.transaction(async (tx) => {
    const [challenge] = await tx
      .select({
        id: schema.stepUpConfirmationTable.id,
        sessionId: schema.stepUpConfirmationTable.sessionId,
        personId: schema.stepUpConfirmationTable.personId,
        nonceHash: schema.stepUpConfirmationTable.challengeNonceHash,
        createdAt: schema.stepUpConfirmationTable.createdAt,
        expiresAt: schema.stepUpConfirmationTable.challengeExpiresAt,
        state: schema.stepUpConfirmationTable.state,
      })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, input.challengeId))
      .for("update")
      .limit(1);
    if (
      !challenge ||
      challenge.state !== "challenge" ||
      challenge.expiresAt <= new Date() ||
      challenge.sessionId !== input.sessionId ||
      challenge.personId !== input.personId ||
      !timingSafeEqual(challenge.nonceHash, sha256(nonceBytes))
    )
      return null;

    const [row] = await tx
      .select({
        connectionId: schema.sessionTable.identityConnectionId,
        personId: schema.personTable.id,
        personActive: schema.personTable.active,
        side: schema.personTable.side,
        connectionEnabled: schema.identityConnectionTable.enabled,
        portalScope: schema.identityConnectionTable.portalScope,
        tenantId: schema.identityConnectionTable.tenantId,
        issuer: schema.identityConnectionTable.issuer,
        clientId: schema.identityConnectionTable.clientId,
        clientSecret: schema.identityConnectionTable.clientSecret,
        redirectUri: schema.identityConnectionTable.redirectUri,
        configVersion: schema.identityConnectionTable.configVersion,
        mfaUpstreamMode: schema.identityConnectionTable.mfaUpstreamMode,
        subject: schema.externalIdentityTable.subject,
      })
      .from(schema.sessionTable)
      .innerJoin(
        schema.personTable,
        and(
          eq(schema.personTable.userId, schema.sessionTable.userId),
          eq(schema.personTable.id, input.personId),
        ),
      )
      .innerJoin(
        schema.identityConnectionTable,
        eq(
          schema.identityConnectionTable.id,
          schema.sessionTable.identityConnectionId,
        ),
      )
      .innerJoin(
        schema.externalIdentityTable,
        and(
          eq(
            schema.externalIdentityTable.identityConnectionId,
            schema.identityConnectionTable.id,
          ),
          eq(schema.externalIdentityTable.userId, schema.sessionTable.userId),
          eq(schema.externalIdentityTable.personId, schema.personTable.id),
          eq(
            schema.externalIdentityTable.issuer,
            schema.identityConnectionTable.issuer,
          ),
          eq(schema.externalIdentityTable.active, true),
        ),
      )
      .where(
        and(
          eq(schema.sessionTable.id, input.sessionId),
          eq(schema.sessionTable.userId, input.userId),
          eq(schema.sessionTable.portal, "agent"),
          gt(schema.sessionTable.expiresAt, dbNowUtc()),
          isNull(schema.sessionTable.impersonatedBy),
          eq(schema.personTable.active, true),
          eq(schema.personTable.side, "staff"),
          eq(schema.identityConnectionTable.enabled, true),
          eq(schema.identityConnectionTable.portalScope, "agent"),
        ),
      )
      .limit(1);
    if (
      !row?.connectionId ||
      !row.tenantId ||
      !row.subject ||
      row.personActive !== true ||
      row.side !== "staff" ||
      !row.connectionEnabled ||
      row.mfaUpstreamMode !== "off" ||
      !row.redirectUri
    )
      return null;
    return {
      connectionId: row.connectionId,
      userId: input.userId,
      personId: input.personId,
      issuer: row.issuer,
      tenantId: row.tenantId,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      subject: row.subject,
      redirectUri: row.redirectUri,
      configVersion: row.configVersion,
      challengeCreatedAt: challenge.createdAt,
      challengeExpiresAt: challenge.expiresAt,
    };
  });
  if (!startContext) return null;

  let discovery: Awaited<ReturnType<typeof loadEntraDiscovery>>;
  try {
    discovery = await loadEntraDiscovery(startContext.tenantId);
  } catch {
    return null;
  }
  if (discovery.issuer !== startContext.issuer) return null;

  const expectedRedirect = `${originForAgent()}/api/auth/identity/${startContext.connectionId}/callback`;
  if (startContext.redirectUri !== expectedRedirect) return null;
  const state = `${STATE_PREFIX}${input.challengeId}_${randomBytes(32).toString("base64url")}`;
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = sha256(codeVerifier).toString("base64url");
  const expiresAt = new Date(
    Math.min(
      Date.now() + FLOW_TTL_MS,
      startContext.challengeExpiresAt.getTime(),
    ),
  );
  const identifier = `${FLOW_PREFIX}${input.challengeId}`;
  const createdFlow = await db.transaction(async (tx) => {
    const [challenge] = await tx
      .select({
        sessionId: schema.stepUpConfirmationTable.sessionId,
        personId: schema.stepUpConfirmationTable.personId,
        nonceHash: schema.stepUpConfirmationTable.challengeNonceHash,
        createdAt: schema.stepUpConfirmationTable.createdAt,
        expiresAt: schema.stepUpConfirmationTable.challengeExpiresAt,
        state: schema.stepUpConfirmationTable.state,
      })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, input.challengeId))
      .for("update")
      .limit(1);
    if (
      !challenge ||
      challenge.state !== "challenge" ||
      challenge.sessionId !== input.sessionId ||
      challenge.personId !== input.personId ||
      challenge.createdAt.getTime() !==
        startContext.challengeCreatedAt.getTime() ||
      challenge.expiresAt <= new Date() ||
      !timingSafeEqual(challenge.nonceHash, sha256(nonceBytes))
    )
      return false;
    const [existing] = await tx
      .select({ id: schema.verificationTable.id })
      .from(schema.verificationTable)
      .where(eq(schema.verificationTable.identifier, identifier))
      .limit(1);
    if (existing) return false;
    await tx.insert(schema.verificationTable).values({
      identifier,
      value: JSON.stringify({
        challengeId: input.challengeId,
        stateHash: sha256(state).toString("hex"),
        oidcNonce: nonce,
        codeVerifier,
        redirectUri: expectedRedirect,
        sessionId: input.sessionId,
        userId: input.userId,
        personId: input.personId,
        connectionId: startContext.connectionId,
        issuer: startContext.issuer,
        subject: startContext.subject,
        configVersion: startContext.configVersion,
        challengeCreatedAt: startContext.challengeCreatedAt.toISOString(),
        challengeExpiresAt: startContext.challengeExpiresAt.toISOString(),
      }),
      expiresAt,
    });
    return true;
  });
  if (!createdFlow) return null;

  const authorize = new URL(discovery.authorizationEndpoint);
  authorize.search = new URLSearchParams({
    client_id: startContext.clientId,
    response_type: "code",
    response_mode: "query",
    redirect_uri: expectedRedirect,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login",
  }).toString();
  return {
    authorizationUrl: authorize.toString(),
    state,
    secure: originForAgent().startsWith("https://"),
  };
}

type StepUpFlow = {
  challengeId: string;
  stateHash: string;
  oidcNonce: string;
  codeVerifier: string;
  redirectUri: string;
  sessionId: string;
  userId: string;
  personId: string;
  connectionId: string;
  issuer: string;
  subject: string;
  configVersion: number;
  challengeCreatedAt: string;
  challengeExpiresAt: string;
};

function parseFlow(value: string): StepUpFlow | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    const row = parsed as Partial<StepUpFlow>;
    if (
      typeof row.challengeId !== "string" ||
      typeof row.stateHash !== "string" ||
      typeof row.oidcNonce !== "string" ||
      typeof row.codeVerifier !== "string" ||
      typeof row.redirectUri !== "string" ||
      typeof row.sessionId !== "string" ||
      typeof row.userId !== "string" ||
      typeof row.personId !== "string" ||
      typeof row.connectionId !== "string" ||
      typeof row.issuer !== "string" ||
      typeof row.subject !== "string" ||
      typeof row.configVersion !== "number" ||
      typeof row.challengeCreatedAt !== "string" ||
      typeof row.challengeExpiresAt !== "string"
    )
      return null;
    return row as StepUpFlow;
  } catch {
    return null;
  }
}

export async function completeOidcStepUpCallback(input: {
  state: string;
  cookieState: string | undefined;
  code: string | undefined;
  providerError: string | undefined;
  connectionId: string;
  sessionId: string | undefined;
  userId: string | undefined;
}): Promise<boolean> {
  if (!isOidcStepUpState(input.state)) return false;
  const [prefix, challengeId] = input.state.split("_").slice(0, 2);
  if (prefix !== "su1" || !challengeId) return true;
  const identifier = `${FLOW_PREFIX}${challengeId}`;
  const receivedAt = new Date();
  const flow = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.verificationTable)
      .where(eq(schema.verificationTable.identifier, identifier))
      .for("update")
      .limit(1);
    if (!row || row.expiresAt <= receivedAt) return null;
    const parsed = parseFlow(row.value);
    if (!parsed) return null;
    // A callback from another signed-in session cannot invalidate this flow. Once the
    // original session reaches its callback, invalid state/cookie is a failed one-shot
    // attempt and expires its challenge.
    if (
      parsed.connectionId !== input.connectionId ||
      parsed.sessionId !== input.sessionId ||
      parsed.userId !== input.userId
    )
      return null;
    if (
      !input.cookieState ||
      !same(input.cookieState, input.state) ||
      parsed.stateHash !== sha256(input.state).toString("hex")
    ) {
      await tx
        .delete(schema.verificationTable)
        .where(eq(schema.verificationTable.id, row.id));
      await tx
        .update(schema.stepUpConfirmationTable)
        .set({ challengeExpiresAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(schema.stepUpConfirmationTable.id, parsed.challengeId),
            eq(schema.stepUpConfirmationTable.sessionId, parsed.sessionId),
            eq(schema.stepUpConfirmationTable.personId, parsed.personId),
            eq(schema.stepUpConfirmationTable.state, "challenge"),
          ),
        );
      return null;
    }
    await tx
      .delete(schema.verificationTable)
      .where(eq(schema.verificationTable.id, row.id));
    return parsed;
  });
  if (!flow) return true;

  const fail = async () => {
    await db
      .update(schema.stepUpConfirmationTable)
      .set({ challengeExpiresAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.id, flow.challengeId),
          eq(schema.stepUpConfirmationTable.sessionId, flow.sessionId),
          eq(schema.stepUpConfirmationTable.personId, flow.personId),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
        ),
      );
    return true;
  };
  if (input.providerError || !input.code) return fail();

  try {
    const [connection] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, flow.connectionId))
      .limit(1);
    if (
      !connection?.enabled ||
      connection.portalScope !== "agent" ||
      connection.mfaUpstreamMode !== "off" ||
      !connection.tenantId ||
      connection.issuer !== flow.issuer ||
      connection.clientId === "" ||
      connection.configVersion !== flow.configVersion ||
      connection.redirectUri !== flow.redirectUri
    )
      return fail();
    const secret = decryptIdentityClientSecret(
      connection.id,
      connection.clientSecret,
    );
    const discovery = await loadEntraDiscovery(connection.tenantId);
    if (discovery.issuer !== flow.issuer) return fail();
    const tokens = await exchangeEntraCode({
      tokenEndpoint: discovery.tokenEndpoint,
      clientId: connection.clientId,
      clientSecret: secret,
      code: input.code,
      codeVerifier: flow.codeVerifier,
      redirectUri: flow.redirectUri,
    });
    const jwks = await loadEntraJwks(discovery.jwksUri);
    const verified = validateEntraIdToken(tokens.idToken, jwks, {
      issuer: flow.issuer,
      tenantId: connection.tenantId,
      clientId: connection.clientId,
      nonce: flow.oidcNonce,
      nowSeconds: Math.floor(receivedAt.getTime() / 1000),
    });
    if (
      !verified.ok ||
      verified.claims.aud !== connection.clientId ||
      verified.claims.oid !== flow.subject ||
      verified.claims.tid !== connection.tenantId
    )
      return fail();
    const authTime = readSignedAuthTime(verified.claims);
    if (
      !authTime ||
      !isFreshSignedAuthTime({
        authTime,
        challengeCreatedAt: new Date(flow.challengeCreatedAt),
        callbackReceivedAt: receivedAt,
      })
    )
      return fail();

    const result = await db.transaction(async (tx) => {
      const [challenge] = await tx
        .select({
          createdAt: schema.stepUpConfirmationTable.createdAt,
          expiresAt: schema.stepUpConfirmationTable.challengeExpiresAt,
        })
        .from(schema.stepUpConfirmationTable)
        .where(
          and(
            eq(schema.stepUpConfirmationTable.id, flow.challengeId),
            eq(schema.stepUpConfirmationTable.sessionId, flow.sessionId),
            eq(schema.stepUpConfirmationTable.personId, flow.personId),
            eq(schema.stepUpConfirmationTable.state, "challenge"),
            gt(schema.stepUpConfirmationTable.challengeExpiresAt, dbNowUtc()),
          ),
        )
        .for("update")
        .limit(1);
      if (
        !challenge ||
        challenge.createdAt.getTime() !==
          new Date(flow.challengeCreatedAt).getTime() ||
        challenge.expiresAt <= receivedAt
      )
        return false;
      const [current] = await tx
        .select({
          sessionId: schema.sessionTable.id,
          connectionId: schema.sessionTable.identityConnectionId,
          userId: schema.sessionTable.userId,
          personId: schema.personTable.id,
          active: schema.personTable.active,
          subject: schema.externalIdentityTable.subject,
          identityActive: schema.externalIdentityTable.active,
          connectionEnabled: schema.identityConnectionTable.enabled,
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
            eq(schema.personTable.id, flow.personId),
          ),
        )
        .innerJoin(
          schema.identityConnectionTable,
          eq(
            schema.identityConnectionTable.id,
            schema.sessionTable.identityConnectionId,
          ),
        )
        .innerJoin(
          schema.externalIdentityTable,
          and(
            eq(
              schema.externalIdentityTable.identityConnectionId,
              schema.identityConnectionTable.id,
            ),
            eq(schema.externalIdentityTable.userId, schema.sessionTable.userId),
            eq(schema.externalIdentityTable.personId, schema.personTable.id),
            eq(schema.externalIdentityTable.issuer, flow.issuer),
            eq(schema.externalIdentityTable.subject, flow.subject),
          ),
        )
        .where(
          and(
            eq(schema.sessionTable.id, flow.sessionId),
            eq(schema.sessionTable.userId, flow.userId),
            eq(schema.sessionTable.portal, "agent"),
            gt(schema.sessionTable.expiresAt, dbNowUtc()),
            isNull(schema.sessionTable.impersonatedBy),
            eq(schema.personTable.active, true),
            eq(schema.personTable.side, "staff"),
            eq(schema.identityConnectionTable.id, flow.connectionId),
            eq(schema.identityConnectionTable.enabled, true),
            eq(
              schema.identityConnectionTable.configVersion,
              flow.configVersion,
            ),
            eq(schema.identityConnectionTable.mfaUpstreamMode, "off"),
            eq(schema.identityConnectionTable.clientId, connection.clientId),
            eq(schema.externalIdentityTable.active, true),
          ),
        )
        .for("update")
        .limit(1);
      if (
        !current ||
        current.sessionId !== flow.sessionId ||
        current.connectionId !== flow.connectionId ||
        current.userId !== flow.userId ||
        current.personId !== flow.personId ||
        current.subject !== flow.subject ||
        current.issuer !== flow.issuer ||
        !current.connectionEnabled ||
        current.mfaUpstreamMode !== "off" ||
        !current.identityActive
      )
        return false;
      await tx.insert(schema.verificationTable).values({
        identifier: `${VERIFIED_PREFIX}${flow.challengeId}`,
        value: JSON.stringify({
          challengeId: flow.challengeId,
          sessionId: flow.sessionId,
          userId: flow.userId,
          personId: flow.personId,
          connectionId: flow.connectionId,
          issuer: flow.issuer,
          subject: flow.subject,
          configVersion: flow.configVersion,
          authTime: authTime.toISOString(),
          callbackReceivedAt: receivedAt.toISOString(),
        }),
        expiresAt: challenge.expiresAt,
      });
      return true;
    });
    if (!result) return fail();
    return true;
  } catch {
    return fail();
  }
}

export async function getOidcStepUpStatus(input: {
  challengeId: string;
  sessionId: string;
  userId: string;
  personId: string;
}): Promise<"pending" | "verified" | "failed"> {
  const [challenge] = await db
    .select({
      sessionId: schema.stepUpConfirmationTable.sessionId,
      personId: schema.stepUpConfirmationTable.personId,
      state: schema.stepUpConfirmationTable.state,
      expiresAt: schema.stepUpConfirmationTable.challengeExpiresAt,
      authMethod: schema.stepUpConfirmationTable.authMethod,
    })
    .from(schema.stepUpConfirmationTable)
    .where(eq(schema.stepUpConfirmationTable.id, input.challengeId))
    .limit(1);
  if (
    !challenge ||
    challenge.sessionId !== input.sessionId ||
    challenge.personId !== input.personId
  )
    return "failed";
  if (
    challenge.state === "issued" ||
    (challenge.state === "consumed" &&
      challenge.authMethod === "sso_prompt_login")
  )
    return challenge.authMethod === "sso_prompt_login" ? "verified" : "failed";
  if (challenge.state !== "challenge" || challenge.expiresAt <= new Date())
    return "failed";
  const [session] = await db
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, input.sessionId),
        eq(schema.sessionTable.userId, input.userId),
        eq(schema.sessionTable.portal, "agent"),
        gt(schema.sessionTable.expiresAt, dbNowUtc()),
      ),
    )
    .limit(1);
  if (!session) return "failed";
  const [verified] = await db
    .select({ identifier: schema.verificationTable.identifier })
    .from(schema.verificationTable)
    .where(
      and(
        eq(
          schema.verificationTable.identifier,
          `${VERIFIED_PREFIX}${input.challengeId}`,
        ),
        gt(schema.verificationTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return verified ? "verified" : "pending";
}

export async function consumeOidcStepUpEvidence(input: {
  challengeId: string;
  sessionId: string;
  userId: string;
  personId: string;
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
}): Promise<{
  connectionId: string;
  issuer: string;
  subject: string;
  configVersion: number;
  authTime: Date;
  callbackReceivedAt: Date;
} | null> {
  const [row] = await input.executor
    .select()
    .from(schema.verificationTable)
    .where(
      eq(
        schema.verificationTable.identifier,
        `${VERIFIED_PREFIX}${input.challengeId}`,
      ),
    )
    .for("update")
    .limit(1);
  if (!row || row.expiresAt <= new Date()) return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    value.challengeId !== input.challengeId ||
    value.sessionId !== input.sessionId ||
    value.userId !== input.userId ||
    value.personId !== input.personId ||
    typeof value.connectionId !== "string" ||
    typeof value.issuer !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.configVersion !== "number" ||
    typeof value.authTime !== "string" ||
    typeof value.callbackReceivedAt !== "string"
  )
    return null;
  const authTime = new Date(value.authTime);
  const callbackReceivedAt = new Date(value.callbackReceivedAt);
  if (
    Number.isNaN(authTime.getTime()) ||
    Number.isNaN(callbackReceivedAt.getTime())
  )
    return null;
  return {
    connectionId: value.connectionId,
    issuer: value.issuer,
    subject: value.subject,
    configVersion: value.configVersion,
    authTime,
    callbackReceivedAt,
  };
}

export async function deleteOidcStepUpEvidence(input: {
  challengeId: string;
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
}) {
  await input.executor
    .delete(schema.verificationTable)
    .where(
      eq(
        schema.verificationTable.identifier,
        `${VERIFIED_PREFIX}${input.challengeId}`,
      ),
    );
}
