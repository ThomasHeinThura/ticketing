import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type {
  IdentityJitPolicy,
  NormalisedEntraIdentity,
  VerifiedEntraClaims,
} from "@taskdesk/domain";
import {
  normaliseEntraClaims,
  parseIdentityClaimMapping,
  parseIdentityJitPolicy,
} from "@taskdesk/domain";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import db, { schema } from "../database";
import { logTaskDesk } from "../instance/observability/runtime";
import { ensureInternalOrganisation } from "../utils/seed-internal-organisation";
import { decryptIdentityClientSecret } from "./client-secret";
import { projectMembershipKeys } from "./membership-projection";
import {
  exchangeEntraCode,
  loadEntraDiscovery,
  loadEntraJwks,
} from "./oidc-provider";
import { validateEntraIdToken } from "./oidc-token";

const FLOW_TTL_MS = 5 * 60_000;
const STATE_COOKIE = "__Host-tdk_oidc_state";
const DEV_STATE_COOKIE = "tdk_oidc_state";
const IDENTITY_PROVIDER_PREFIX = "taskdesk-entra:";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function equalSecret(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function stateCookieName(secure: boolean) {
  return secure ? STATE_COOKIE : DEV_STATE_COOKIE;
}

function originForPortal(portal: "agent" | "customer") {
  const configured =
    portal === "agent"
      ? process.env.TASKDESK_AGENT_URL || "http://localhost:5173"
      : process.env.TASKDESK_PORTAL_URL || "http://localhost:5174";
  return new URL(configured).origin;
}

function parseFlow(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      "connectionId" in parsed &&
      typeof parsed.connectionId === "string" &&
      "portal" in parsed &&
      (parsed.portal === "agent" || parsed.portal === "customer") &&
      "nonce" in parsed &&
      typeof parsed.nonce === "string" &&
      "codeVerifier" in parsed &&
      typeof parsed.codeVerifier === "string" &&
      "redirectUri" in parsed &&
      typeof parsed.redirectUri === "string"
    )
      return parsed as {
        connectionId: string;
        portal: "agent" | "customer";
        nonce: string;
        codeVerifier: string;
        redirectUri: string;
      };
  } catch {
    // Stored flow values are untrusted; treat malformed rows as invalid.
  }
  return null;
}

function safeFailure(ctx: { redirect(url: string): unknown }): never {
  throw ctx.redirect("/auth/sign-in?identity_error=sign_in_failed");
}

const OIDC_SESSION_SOURCE_PREFIX = "oidc-session-source:";
export const OIDC_PENDING_SESSION_COOKIE = "taskdesk_oidc_pending_session";

/**
 * Bind a just-created Better Auth session to the validated connection before its
 * cookie is emitted. The parent lock serializes this tag with connection disable;
 * the caller deletes the unexposed session when the source is no longer enabled.
 */
export async function bindOidcSessionProvenance(input: {
  sessionId: string;
  userId: string;
  connectionId: string;
  portal: "agent" | "customer";
}) {
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .select({
        id: schema.identityConnectionTable.id,
        enabled: schema.identityConnectionTable.enabled,
        portalScope: schema.identityConnectionTable.portalScope,
      })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, input.connectionId))
      .for("update")
      .limit(1);
    if (!connection?.enabled || connection.portalScope !== input.portal)
      return false;

    const [identity] = await tx
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(
        and(
          eq(
            schema.externalIdentityTable.identityConnectionId,
            input.connectionId,
          ),
          eq(schema.externalIdentityTable.userId, input.userId),
          eq(schema.externalIdentityTable.active, true),
        ),
      )
      .for("update")
      .limit(1);
    if (!identity) return false;

    const [session] = await tx
      .update(schema.sessionTable)
      .set({ identityConnectionId: input.connectionId })
      .where(
        and(
          eq(schema.sessionTable.id, input.sessionId),
          eq(schema.sessionTable.userId, input.userId),
          eq(schema.sessionTable.portal, input.portal),
          gt(schema.sessionTable.expiresAt, sql`now()`),
          isNull(schema.sessionTable.identityConnectionId),
        ),
      )
      .returning({ id: schema.sessionTable.id });
    return Boolean(session);
  });
}

/**
 * OIDC login can first produce a Better Auth `two_factor` challenge. Carry its
 * connection source in a short-lived verification row keyed by the signed
 * challenge identifier, then bind only the matching session after the native
 * factor endpoint succeeds. A missing marker is an ordinary local 2FA session.
 */
export async function bindTwoFactorOidcSession(input: {
  challengeId: string | null;
  sourceMarker: string | null;
  sessionId: string;
  userId: string;
  portal: "agent" | "customer";
}): Promise<"not_oidc" | "bound" | "invalid"> {
  if (!input.challengeId) return input.sourceMarker ? "invalid" : "not_oidc";
  if (input.sourceMarker && input.sourceMarker !== input.challengeId)
    return "invalid";
  const identifier = `${OIDC_SESSION_SOURCE_PREFIX}${digest(input.challengeId)}`;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.verificationTable)
      .where(eq(schema.verificationTable.identifier, identifier))
      .for("update")
      .limit(1);
    if (!row) return input.sourceMarker ? "invalid" : "not_oidc";
    await tx
      .delete(schema.verificationTable)
      .where(eq(schema.verificationTable.id, row.id));
    if (row.expiresAt <= new Date()) return "invalid";
    let source: unknown;
    try {
      source = JSON.parse(row.value) as unknown;
    } catch {
      return "invalid";
    }
    if (
      typeof source !== "object" ||
      source === null ||
      Array.isArray(source) ||
      !("connectionId" in source) ||
      typeof source.connectionId !== "string" ||
      !("portal" in source) ||
      source.portal !== input.portal ||
      !("userId" in source) ||
      source.userId !== input.userId
    )
      return "invalid";
    const [connection] = await tx
      .select({
        id: schema.identityConnectionTable.id,
        enabled: schema.identityConnectionTable.enabled,
        portalScope: schema.identityConnectionTable.portalScope,
      })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, source.connectionId))
      .for("update")
      .limit(1);
    if (!connection?.enabled || connection.portalScope !== input.portal)
      return "invalid";
    const [identity] = await tx
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(
        and(
          eq(
            schema.externalIdentityTable.identityConnectionId,
            source.connectionId,
          ),
          eq(schema.externalIdentityTable.userId, input.userId),
          eq(schema.externalIdentityTable.active, true),
        ),
      )
      .for("update")
      .limit(1);
    if (!identity) return "invalid";
    const [session] = await tx
      .update(schema.sessionTable)
      .set({ identityConnectionId: source.connectionId })
      .where(
        and(
          eq(schema.sessionTable.id, input.sessionId),
          eq(schema.sessionTable.userId, input.userId),
          eq(schema.sessionTable.portal, input.portal),
          gt(schema.sessionTable.expiresAt, sql`now()`),
          isNull(schema.sessionTable.identityConnectionId),
        ),
      )
      .returning({ id: schema.sessionTable.id });
    return session ? "bound" : "invalid";
  });
}

export function identityOidcPlugin(
  portal: "agent" | "customer",
): BetterAuthPlugin {
  const start = createAuthEndpoint(
    "/identity/:connectionId/start",
    {
      method: "GET",
      query: z.object({ returnTo: z.string().max(2048).optional() }),
    },
    async (ctx: GenericEndpointContext) => {
      const connectionId = ctx.params?.connectionId;
      if (!connectionId) return safeFailure(ctx);
      const [connection] = await db
        .select({
          id: schema.identityConnectionTable.id,
          portalScope: schema.identityConnectionTable.portalScope,
          enabled: schema.identityConnectionTable.enabled,
          tenantId: schema.identityConnectionTable.tenantId,
          defaultWorkspaceId: schema.identityConnectionTable.defaultWorkspaceId,
          issuer: schema.identityConnectionTable.issuer,
          clientId: schema.identityConnectionTable.clientId,
          redirectUri: schema.identityConnectionTable.redirectUri,
          scopes: schema.identityConnectionTable.scopes,
          claimMapping: schema.identityConnectionTable.claimMapping,
          jitPolicy: schema.identityConnectionTable.jitPolicy,
        })
        .from(schema.identityConnectionTable)
        .where(eq(schema.identityConnectionTable.id, connectionId))
        .limit(1);
      const startJit = connection
        ? parseIdentityJitPolicy(connection.jitPolicy)
        : null;
      if (
        !connection ||
        connection.portalScope !== portal ||
        !connection.enabled ||
        !connection.tenantId ||
        !startJit?.ok ||
        (portal === "agent" &&
          startJit.value.enabled &&
          !connection.defaultWorkspaceId) ||
        !parseIdentityClaimMapping(connection.claimMapping).ok
      )
        return safeFailure(ctx);

      const origin = originForPortal(portal);
      const callback = `${origin}/api/auth/identity/${connectionId}/callback`;
      if (connection.redirectUri !== callback) return safeFailure(ctx);
      let discovery: Awaited<ReturnType<typeof loadEntraDiscovery>>;
      try {
        discovery = await loadEntraDiscovery(connection.tenantId);
      } catch {
        logTaskDesk({
          module: "auth",
          message: "auth.failure",
          level: "warn",
          result: "failed",
        });
        return safeFailure(ctx);
      }
      if (discovery.issuer !== connection.issuer) return safeFailure(ctx);

      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256")
        .update(verifier, "utf8")
        .digest("base64url");
      const secure = origin.startsWith("https://");
      const cookieName = stateCookieName(secure);
      ctx.setCookie(cookieName, state, {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: secure ? "/" : "/api/auth",
        maxAge: FLOW_TTL_MS / 1000,
      });
      await db.insert(schema.verificationTable).values({
        identifier: `oidc-state:${digest(state)}`,
        value: JSON.stringify({
          connectionId,
          portal,
          nonce,
          codeVerifier: verifier,
          redirectUri: callback,
        }),
        expiresAt: new Date(Date.now() + FLOW_TTL_MS),
      });
      const authorize = new URL(discovery.authorizationEndpoint);
      authorize.search = new URLSearchParams({
        client_id: connection.clientId,
        response_type: "code",
        response_mode: "query",
        redirect_uri: callback,
        scope: [
          ...new Set(["openid", "profile", "email", ...connection.scopes]),
        ].join(" "),
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return ctx.redirect(authorize.toString());
    },
  );

  const callback = createAuthEndpoint(
    "/identity/:connectionId/callback",
    {
      method: "GET",
      query: z.object({
        code: z.string().min(1).max(4096).optional(),
        state: z.string().min(1).max(128).optional(),
        error: z.string().max(128).optional(),
      }),
    },
    async (ctx: GenericEndpointContext) => {
      const connectionId = ctx.params?.connectionId;
      if (!connectionId) return safeFailure(ctx);
      const state = ctx.query.state;
      if (!state || ctx.query.error || !ctx.query.code) return safeFailure(ctx);
      const origin = originForPortal(portal);
      const secure = origin.startsWith("https://");
      const cookieName = stateCookieName(secure);
      const cookieState = ctx.getCookie(cookieName);
      ctx.setCookie(cookieName, "", {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: secure ? "/" : "/api/auth",
        maxAge: 0,
      });
      if (!cookieState || !equalSecret(cookieState, state))
        return safeFailure(ctx);

      const identifier = `oidc-state:${digest(state)}`;
      const consumed = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.verificationTable)
          .where(eq(schema.verificationTable.identifier, identifier))
          .for("update")
          .limit(1);
        if (!row || row.expiresAt <= new Date()) return null;
        await tx
          .delete(schema.verificationTable)
          .where(eq(schema.verificationTable.id, row.id));
        return parseFlow(row.value);
      });
      if (
        !consumed ||
        consumed.connectionId !== connectionId ||
        consumed.portal !== portal ||
        consumed.redirectUri !==
          `${origin}/api/auth/identity/${connectionId}/callback`
      )
        return safeFailure(ctx);

      const [connection] = await db
        .select()
        .from(schema.identityConnectionTable)
        .where(eq(schema.identityConnectionTable.id, connectionId))
        .limit(1);
      if (
        !connection?.enabled ||
        connection.portalScope !== portal ||
        !connection.tenantId ||
        connection.redirectUri !== consumed.redirectUri
      )
        return safeFailure(ctx);
      const jitPolicy = parseIdentityJitPolicy(connection.jitPolicy);
      if (!jitPolicy.ok) return safeFailure(ctx);
      const claimMapping = parseIdentityClaimMapping(connection.claimMapping);
      if (!claimMapping.ok) return safeFailure(ctx);

      try {
        const secret = decryptIdentityClientSecret(
          connection.id,
          connection.clientSecret,
        );
        const discovery = await loadEntraDiscovery(connection.tenantId);
        if (discovery.issuer !== connection.issuer) return safeFailure(ctx);
        const tokens = await exchangeEntraCode({
          tokenEndpoint: discovery.tokenEndpoint,
          clientId: connection.clientId,
          clientSecret: secret,
          code: ctx.query.code,
          codeVerifier: consumed.codeVerifier,
          redirectUri: consumed.redirectUri,
        });
        const jwks = await loadEntraJwks(discovery.jwksUri);
        const verified = validateEntraIdToken(tokens.idToken, jwks, {
          issuer: connection.issuer,
          tenantId: connection.tenantId,
          clientId: connection.clientId,
          nonce: consumed.nonce,
        });
        if (!verified.ok) return safeFailure(ctx);
        const domainOwners = await db
          .select({
            domain: sql<string>`unnest(${schema.identityConnectionTable.domainBindings})`,
            identityConnectionId: schema.identityConnectionTable.id,
          })
          .from(schema.identityConnectionTable)
          .where(eq(schema.identityConnectionTable.enabled, true));
        const normalized = normaliseEntraClaims(
          verified.claims as VerifiedEntraClaims,
          {
            identityConnectionId: connection.id,
            issuer: connection.issuer,
            tenantId: connection.tenantId,
          },
          domainOwners,
          {
            claimMapping: connection.claimMapping,
            jitPolicy: connection.jitPolicy,
          },
        );
        if (!normalized.ok) return safeFailure(ctx);
        const signedIn = await signInAdmittedIdentity({
          ctx,
          portal,
          connection,
          identity: normalized.identity,
          jitPolicy: jitPolicy.value,
        });
        if (signedIn.kind === "two_factor")
          return ctx.redirect("/auth/two-factor");
        await setSessionCookie(ctx, {
          session: signedIn.session,
          user: signedIn.user,
        });
        return ctx.redirect(portal === "agent" ? "/agent" : "/");
      } catch {
        logTaskDesk({
          module: "auth",
          message: "auth.failure",
          level: "warn",
          result: "failed",
        });
        return safeFailure(ctx);
      }
    },
  );

  return {
    id: "taskdesk-identity-oidc",
    endpoints: { identityStart: start, identityCallback: callback },
  };
}

async function signInAdmittedIdentity(input: {
  ctx: GenericEndpointContext;
  portal: "agent" | "customer";
  connection: typeof schema.identityConnectionTable.$inferSelect;
  identity: NormalisedEntraIdentity;
  jitPolicy: IdentityJitPolicy;
}) {
  const { ctx, portal, connection, identity, jitPolicy } = input;
  const now = new Date();
  const subject = identity.subject.oid;
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: schema.externalIdentityTable.id,
        personId: schema.externalIdentityTable.personId,
        userId: schema.externalIdentityTable.userId,
        active: schema.externalIdentityTable.active,
        personActive: schema.personTable.active,
        side: schema.personTable.side,
        organisationId: schema.personTable.organisationId,
        personUserId: schema.personTable.userId,
      })
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .where(
        and(
          eq(schema.externalIdentityTable.identityConnectionId, connection.id),
          eq(schema.externalIdentityTable.issuer, connection.issuer),
          eq(schema.externalIdentityTable.subject, subject),
        ),
      )
      .for("update", { of: schema.externalIdentityTable })
      .limit(1);

    let personId = existing?.personId;
    let userId = existing?.userId ?? existing?.personUserId ?? null;
    let externalIdentityId = existing?.id;
    if (existing) {
      if (
        !existing.active ||
        !existing.personActive ||
        existing.side !== (portal === "agent" ? "staff" : "customer") ||
        (portal === "customer" &&
          existing.organisationId !== connection.organisationId) ||
        (existing.userId &&
          existing.personUserId &&
          existing.userId !== existing.personUserId)
      )
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
    } else {
      if (!jitPolicy.enabled)
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      const [emailOwner] = await tx
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.email, identity.address))
        .limit(1);
      if (emailOwner)
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      const [role] = await tx
        .select({
          id: schema.roleTable.id,
          scope: schema.roleTable.scope,
          rank: schema.roleTable.rank,
          key: schema.roleTable.key,
          workspaceId: schema.roleTable.workspaceId,
          capabilities: schema.roleTable.capabilities,
        })
        .from(schema.roleTable)
        .where(eq(schema.roleTable.id, jitPolicy.default_role_id ?? ""))
        .for("update")
        .limit(1);
      const roleScope = portal === "agent" ? "workspace" : "organisation";
      if (
        !role ||
        role.scope !== roleScope ||
        role.rank < 0 ||
        (portal === "agent" &&
          (connection.maxRoleRank === null ||
            role.rank > connection.maxRoleRank ||
            !connection.defaultWorkspaceId ||
            role.workspaceId !== connection.defaultWorkspaceId ||
            role.key === "admin" ||
            role.key === "owner" ||
            !hasSafeRoleCapabilities(role.capabilities))) ||
        (portal === "customer" &&
          (role.key !== "customer" || role.workspaceId !== null))
      )
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      const internal =
        portal === "agent" ? await ensureInternalOrganisation(tx) : null;
      const organisationId =
        portal === "agent" ? internal?.id : connection.organisationId;
      if (!organisationId)
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      const scopeId =
        roleScope === "workspace"
          ? connection.defaultWorkspaceId
          : organisationId;
      if (!scopeId)
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      if (roleScope === "workspace") {
        const [target] = await tx
          .select({ id: schema.workspaceTable.id })
          .from(schema.workspaceTable)
          .innerJoin(
            schema.organisationTable,
            eq(
              schema.organisationTable.id,
              schema.workspaceTable.organisationId,
            ),
          )
          .where(
            and(
              eq(schema.workspaceTable.id, scopeId),
              isNull(schema.workspaceTable.deletedAt),
              eq(schema.organisationTable.isInternal, true),
              isNull(schema.organisationTable.deletedAt),
            ),
          )
          .for("update", { of: schema.workspaceTable })
          .limit(1);
        if (!target)
          throw new APIError("UNAUTHORIZED", {
            message: "Identity sign-in failed",
          });
      }
      const user = {
        id: createId(),
        name: identity.displayName ?? identity.address,
        email: identity.address,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(schema.userTable).values(user);
      personId = createId();
      externalIdentityId = createId();
      userId = user.id;
      await tx.insert(schema.personTable).values({
        id: personId,
        userId,
        organisationId,
        side: portal === "agent" ? "staff" : "customer",
        displayName: identity.displayName ?? null,
        active: true,
        isPlaceholder: false,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.accountTable).values({
        id: createId(),
        accountId: `${connection.issuer}\0${subject}`,
        providerId: `${IDENTITY_PROVIDER_PREFIX}${connection.id}`,
        userId,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.externalIdentityTable).values({
        id: externalIdentityId,
        identityConnectionId: connection.id,
        personId,
        userId,
        issuer: connection.issuer,
        subject,
        userNameSnapshot: identity.address,
        emailSnapshot: identity.address,
        active: true,
        provisionedVia: "jit",
        firstSeenAt: now,
        lastLoginAt: now,
      });
      await tx.insert(schema.membershipGrantTable).values({
        personId,
        scope: roleScope,
        scopeId,
        roleId: role.id,
        sourceKind: "jit_default",
        externalIdentityId,
        identityConnectionId: connection.id,
        seesAll: false,
        createdAt: now,
        updatedAt: now,
        lastConfirmedAt: now,
      });
      await tx.insert(schema.provisioningEventTable).values({
        identityConnectionId: connection.id,
        externalIdentityId,
        kind: "user.created",
        outcome: "success",
        detail: { source: "jit", portal },
        actorType: "oidc",
        createdAt: now,
      });
      await projectMembershipKeys(tx, [
        { personId, scope: roleScope, scopeId },
      ]);
    }
    if (!personId || !userId || !externalIdentityId)
      throw new APIError("UNAUTHORIZED", {
        message: "Identity sign-in failed",
      });
    const [person] = await tx
      .select({ id: schema.personTable.id, userId: schema.personTable.userId })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, personId))
      .for("update")
      .limit(1);
    if (!person)
      throw new APIError("UNAUTHORIZED", {
        message: "Identity sign-in failed",
      });
    if (!person.userId)
      await tx
        .update(schema.personTable)
        .set({ userId, updatedAt: now })
        .where(eq(schema.personTable.id, personId));
    await tx
      .update(schema.externalIdentityTable)
      .set({ userId, lastLoginAt: now })
      .where(eq(schema.externalIdentityTable.id, externalIdentityId));
    if (identity.displayName)
      await tx
        .update(schema.personTable)
        .set({ displayName: identity.displayName, updatedAt: now })
        .where(eq(schema.personTable.id, personId));
    return { userId };
  });
  const user = await ctx.context.internalAdapter.findUserById(result.userId);
  if (!user)
    throw new APIError("UNAUTHORIZED", { message: "Identity sign-in failed" });
  const [factorState] = await db
    .select({ enabled: schema.userTable.twoFactorEnabled })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, user.id))
    .limit(1);
  if (factorState?.enabled) {
    const maxAge = 600;
    const cookie = ctx.context.createAuthCookie("two_factor", { maxAge });
    const identifier = `2fa-${randomBytes(20).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + maxAge * 1000);
    await ctx.context.internalAdapter.createVerificationValue({
      identifier,
      value: user.id,
      expiresAt,
    });
    await ctx.context.internalAdapter.createVerificationValue({
      identifier: `2fa-attempts-${identifier}`,
      value: "0",
      expiresAt,
    });
    await ctx.context.internalAdapter.createVerificationValue({
      identifier: `${OIDC_SESSION_SOURCE_PREFIX}${digest(identifier)}`,
      value: JSON.stringify({
        connectionId: connection.id,
        portal,
        userId: user.id,
      }),
      expiresAt,
    });
    await ctx.setSignedCookie(
      cookie.name,
      identifier,
      ctx.context.secret,
      cookie.attributes,
    );
    const sourceCookie = ctx.context.createAuthCookie(
      OIDC_PENDING_SESSION_COOKIE,
      { maxAge },
    );
    await ctx.setSignedCookie(
      sourceCookie.name,
      identifier,
      ctx.context.secret,
      sourceCookie.attributes,
    );
    return { kind: "two_factor" as const };
  }
  const session = await ctx.context.internalAdapter.createSession(
    user.id,
    false,
    { portal },
  );
  if (
    !session ||
    !(await bindOidcSessionProvenance({
      sessionId: session.id,
      userId: user.id,
      connectionId: connection.id,
      portal,
    }))
  ) {
    if (session) await ctx.context.internalAdapter.deleteSession(session.token);
    return safeFailure(ctx);
  }
  return { kind: "session" as const, session, user };
}

function hasSafeRoleCapabilities(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every((item) => item !== "instance:admin" && item !== "sees_all")
  );
}
