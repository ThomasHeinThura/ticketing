import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type {
  EntraGroupClaimEvidence,
  NormalisedEntraIdentity,
  VerifiedEntraClaims,
} from "@taskdesk/domain";
import {
  canonicalEntraGroupObjectId,
  normaliseEntraClaims,
  parseIdentityClaimMapping,
  parseIdentityJitPolicy,
  validateEntraAdmission,
} from "@taskdesk/domain";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { logTaskDesk } from "../instance/observability/runtime";
import { ensureInternalOrganisation } from "../utils/seed-internal-organisation";
import { invalidateNativeAuthorization } from "../ws";
import { decryptIdentityClientSecret } from "./client-secret";
import { projectMembershipKeys } from "./membership-projection";
import {
  exchangeEntraCode,
  loadEntraDiscovery,
  loadEntraJwks,
} from "./oidc-provider";
import { validateEntraIdToken } from "./oidc-token";
import {
  findOidcEmailOwner,
  getOidcConnectionForCallback,
  getOidcConnectionForStart,
  getOidcIdentityForSignIn,
  getOidcUserFactorState,
  IdentityGrantClosureChangedError,
  listEnabledOidcDomainOwners,
  lockIdentityConnection,
  lockOidcConnection,
  lockOidcDefaultRole,
  lockOidcDefaultWorkspace,
  lockOidcExternalIdentity,
  lockOidcPerson,
  lockOidcVerification,
  lockScimGrantClosure,
  retryIdentityGrantClosure,
  validateOidcMappingRole,
} from "./repository";

const FLOW_TTL_MS = 5 * 60_000;
const STATE_COOKIE = "__Host-tdk_oidc_state";
const DEV_STATE_COOKIE = "tdk_oidc_state";
const IDENTITY_PROVIDER_PREFIX = "taskdesk-entra:";

type OidcGrantRetirementReason =
  | "claim_missing"
  | "claim_removed"
  | "claim_overage"
  | "mapping_changed";

function classifyOidcGrantRetirementReason(input: {
  evidence: EntraGroupClaimEvidence;
  grant: {
    roleId: string;
    scope: string;
    scopeId: string;
    lastConfirmedAt: Date | null;
    oidcGroupMappingId: string | null;
  };
  mapping: typeof schema.oidcGroupMappingTable.$inferSelect | undefined;
  eligibleMappingIds: ReadonlySet<string>;
}): OidcGrantRetirementReason {
  const { evidence, grant, mapping, eligibleMappingIds } = input;
  if (evidence.kind === "overage") return "claim_overage";
  if (evidence.kind === "missing" || evidence.kind === "malformed")
    return "claim_missing";
  if (
    !mapping ||
    !grant.oidcGroupMappingId ||
    mapping.id !== grant.oidcGroupMappingId ||
    !eligibleMappingIds.has(mapping.id) ||
    mapping.roleId !== grant.roleId ||
    mapping.scope !== grant.scope ||
    mapping.scopeId !== grant.scopeId ||
    !grant.lastConfirmedAt ||
    mapping.updatedAt > grant.lastConfirmedAt
  ) {
    return "mapping_changed";
  }
  return "claim_removed";
}

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
    const [connection] = await lockOidcConnection(tx, input.connectionId);
    if (!connection?.enabled || connection.portalScope !== input.portal)
      return false;

    const [identity] = await lockOidcExternalIdentity(
      tx,
      input.connectionId,
      input.userId,
    );
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
    const [row] = await lockOidcVerification(tx, identifier);
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
    const [connection] = await lockOidcConnection(tx, source.connectionId);
    if (!connection?.enabled || connection.portalScope !== input.portal)
      return "invalid";
    const [identity] = await lockOidcExternalIdentity(
      tx,
      source.connectionId,
      input.userId,
    );
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
      const [connection] = await getOidcConnectionForStart(connectionId);
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
        const [row] = await lockOidcVerification(tx, identifier);
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

      const [connection] = await getOidcConnectionForCallback(connectionId);
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
        const domainOwners = await listEnabledOidcDomainOwners();
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
            enforceAdmission: false,
          },
        );
        if (!normalized.ok) return safeFailure(ctx);
        const signedIn = await signInAdmittedIdentity({
          ctx,
          portal,
          connection,
          identity: normalized.identity,
          claims: verified.claims as VerifiedEntraClaims,
        });
        if (signedIn.kind === "denied") return safeFailure(ctx);
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
  claims: VerifiedEntraClaims;
}) {
  const { ctx, portal, connection, identity, claims } = input;
  const now = new Date();
  const subject = identity.subject.oid;
  const result = await retryIdentityGrantClosure(() =>
    db.transaction(async (tx) => {
      const [observedConnection] = await tx
        .select()
        .from(schema.identityConnectionTable)
        .where(eq(schema.identityConnectionTable.id, connection.id))
        .limit(1);
      if (
        !observedConnection ||
        !observedConnection.enabled ||
        observedConnection.providerType !== "entra" ||
        observedConnection.portalScope !== portal ||
        observedConnection.issuer !== connection.issuer ||
        observedConnection.tenantId !== connection.tenantId ||
        observedConnection.clientId !== connection.clientId
      )
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      const [observedIdentity] = await tx
        .select({
          id: schema.externalIdentityTable.id,
          personId: schema.externalIdentityTable.personId,
        })
        .from(schema.externalIdentityTable)
        .where(
          and(
            eq(
              schema.externalIdentityTable.identityConnectionId,
              connection.id,
            ),
            eq(schema.externalIdentityTable.issuer, connection.issuer),
            eq(schema.externalIdentityTable.subject, subject),
          ),
        )
        .limit(1);
      const observedJit = parseIdentityJitPolicy(observedConnection.jitPolicy);
      if (!observedJit.ok)
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      await lockScimGrantClosure(tx, {
        connectionId: connection.id,
        sourceKinds: ["jit_default", "oidc_group"],
        ...(observedIdentity
          ? {
              additionalIdentityIds: [observedIdentity.id],
              additionalPersonIds: [observedIdentity.personId],
            }
          : {}),
        proposedRoleId: observedJit.value.default_role_id ?? undefined,
        proposedScope: portal === "agent" ? "workspace" : "organisation",
        proposedScopeId:
          portal === "agent"
            ? (observedConnection.defaultWorkspaceId ?? undefined)
            : (observedConnection.organisationId ?? undefined),
        proposedOrganisationId: observedConnection.organisationId ?? undefined,
      });
      const [currentConnection] = await lockIdentityConnection(
        tx,
        connection.id,
      );
      if (
        !currentConnection ||
        !currentConnection.enabled ||
        currentConnection.providerType !== "entra" ||
        currentConnection.portalScope !== portal ||
        currentConnection.issuer !== connection.issuer ||
        currentConnection.tenantId !== connection.tenantId ||
        currentConnection.clientId !== connection.clientId ||
        currentConnection.configVersion !== observedConnection.configVersion
      )
        throw new IdentityGrantClosureChangedError();
      const currentJit = parseIdentityJitPolicy(currentConnection.jitPolicy);
      if (!currentJit.ok)
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      const jitPolicy = currentJit.value;
      const [existing] = await getOidcIdentityForSignIn(tx, {
        connectionId: connection.id,
        issuer: connection.issuer,
        subject,
      });
      if (
        observedIdentity &&
        (!existing ||
          existing.id !== observedIdentity.id ||
          existing.personId !== observedIdentity.personId)
      )
        throw new IdentityGrantClosureChangedError();
      const admission = validateEntraAdmission(
        claims,
        currentConnection.jitPolicy,
      );
      if (!admission.ok) {
        if (
          admission.reason !== "missing_app_role" &&
          admission.reason !== "guest_account"
        )
          throw new APIError("UNAUTHORIZED", {
            message: "Identity sign-in failed",
          });
        const denialKeys: Array<{
          personId: string;
          scope: "workspace" | "organisation";
          scopeId: string;
        }> = [];
        if (existing) {
          const removed = await tx
            .select({
              id: schema.membershipGrantTable.id,
              scope: schema.membershipGrantTable.scope,
              scopeId: schema.membershipGrantTable.scopeId,
              sourceKind: schema.membershipGrantTable.sourceKind,
            })
            .from(schema.membershipGrantTable)
            .where(
              and(
                eq(schema.membershipGrantTable.personId, existing.personId),
                eq(schema.membershipGrantTable.externalIdentityId, existing.id),
                eq(
                  schema.membershipGrantTable.identityConnectionId,
                  connection.id,
                ),
                inArray(schema.membershipGrantTable.sourceKind, [
                  "jit_default",
                  "oidc_group",
                ]),
                isNull(schema.membershipGrantTable.revokedAt),
              ),
            )
            .orderBy(schema.membershipGrantTable.id)
            .for("update");
          for (const grant of removed) {
            await tx
              .update(schema.membershipGrantTable)
              .set({
                revokedAt: now,
                revocationReason: "admission_failed",
                updatedAt: now,
                membershipId: null,
              })
              .where(eq(schema.membershipGrantTable.id, grant.id));
            denialKeys.push({
              personId: existing.personId,
              scope: grant.scope as "workspace" | "organisation",
              scopeId: grant.scopeId,
            });
            await tx.insert(schema.provisioningEventTable).values({
              identityConnectionId: connection.id,
              externalIdentityId: existing.id,
              kind: "group.member_removed",
              outcome: "success",
              detail: {
                source: grant.sourceKind,
                reason: "admission_failed",
                scope: grant.scope,
                scopeId: grant.scopeId,
              },
              actorType: "oidc",
              createdAt: now,
            });
          }
        }
        await projectMembershipKeys(tx, denialKeys);
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: connection.id,
          ...(existing ? { externalIdentityId: existing.id } : {}),
          kind: "auth.failed",
          outcome: "failed",
          detail: { reason: "admission_failed" },
          actorType: "oidc",
          createdAt: now,
        });
        if (denialKeys.length && existing) {
          try {
            await tx.transaction(async (auditTx) =>
              appendAuditLog(auditTx, {
                action: "membership.changed",
                actorId: null,
                actorType: "system",
                organisationId: existing.organisationId,
                workspaceId: null,
                entityType: "membership",
                entityId: existing.personId,
                after: {
                  source: "oidc",
                  reason: "admission_failed",
                  grantChanges: denialKeys.length,
                  scopes: [
                    ...new Set(
                      denialKeys.map((key) => `${key.scope}:${key.scopeId}`),
                    ),
                  ],
                },
              }),
            );
          } catch {
            logTaskDesk({
              module: "auth",
              message: "auth.failure",
              level: "warn",
              result: "failed",
            });
          }
        }
        return {
          denied: true as const,
          userId: existing?.userId ?? existing?.personUserId ?? undefined,
          changed: denialKeys.length > 0,
          workspaceIds: [
            ...new Set(
              denialKeys
                .filter((key) => key.scope === "workspace")
                .map((key) => key.scopeId),
            ),
          ],
        };
      }
      if (!observedIdentity && existing)
        throw new IdentityGrantClosureChangedError();

      let personId = existing?.personId;
      let userId = existing?.userId ?? existing?.personUserId ?? null;
      let externalIdentityId = existing?.id;
      if (existing) {
        if (
          !existing.active ||
          !existing.personActive ||
          existing.side !== (portal === "agent" ? "staff" : "customer") ||
          (portal === "customer" &&
            existing.organisationId !== currentConnection.organisationId) ||
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
        const [emailOwner] = await findOidcEmailOwner(tx, identity.address);
        if (emailOwner)
          throw new APIError("UNAUTHORIZED", {
            message: "Identity sign-in failed",
          });
        const [role] = await lockOidcDefaultRole(
          tx,
          jitPolicy.default_role_id ?? "",
        );
        const roleScope = portal === "agent" ? "workspace" : "organisation";
        if (
          !role ||
          role.scope !== roleScope ||
          role.rank < 0 ||
          (portal === "agent" &&
            (currentConnection.maxRoleRank === null ||
              role.rank > currentConnection.maxRoleRank ||
              !currentConnection.defaultWorkspaceId ||
              role.workspaceId !== currentConnection.defaultWorkspaceId ||
              role.key === "admin" ||
              role.key === "owner" ||
              !Array.isArray(role.capabilities))) ||
          (portal === "customer" &&
            (role.key !== "customer" || role.workspaceId !== null))
        )
          throw new APIError("UNAUTHORIZED", {
            message: "Identity sign-in failed",
          });
        const internal =
          portal === "agent" ? await ensureInternalOrganisation(tx) : null;
        const organisationId =
          portal === "agent" ? internal?.id : currentConnection.organisationId;
        if (!organisationId)
          throw new APIError("UNAUTHORIZED", {
            message: "Identity sign-in failed",
          });
        const scopeId =
          roleScope === "workspace"
            ? currentConnection.defaultWorkspaceId
            : organisationId;
        if (!scopeId)
          throw new APIError("UNAUTHORIZED", {
            message: "Identity sign-in failed",
          });
        if (
          !(await validateOidcMappingRole(tx, {
            providerType: currentConnection.providerType,
            portalScope: portal,
            organisationId,
            maxRoleRank: currentConnection.maxRoleRank,
            scope: roleScope,
            scopeId,
            roleId: role.id,
          }))
        )
          throw new APIError("UNAUTHORIZED", {
            message: "Identity sign-in failed",
          });
        if (roleScope === "workspace") {
          const [target] = await lockOidcDefaultWorkspace(tx, scopeId);
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
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: connection.id,
          externalIdentityId,
          kind: "user.created",
          outcome: "success",
          detail: { source: "jit", portal },
          actorType: "oidc",
          createdAt: now,
        });
      }
      if (!personId || !userId || !externalIdentityId)
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });
      const [person] = await lockOidcPerson(tx, personId);
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
      const [currentPerson] = await tx
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.id, personId))
        .limit(1);
      if (
        !currentPerson ||
        !currentPerson.active ||
        currentPerson.side !== (portal === "agent" ? "staff" : "customer") ||
        (portal === "customer" &&
          currentPerson.organisationId !== currentConnection.organisationId)
      )
        throw new APIError("UNAUTHORIZED", {
          message: "Identity sign-in failed",
        });

      const roleScope = portal === "agent" ? "workspace" : "organisation";
      const roleScopeId =
        portal === "agent"
          ? currentConnection.defaultWorkspaceId
          : currentConnection.organisationId;
      const projectionKeys: Array<{
        personId: string;
        scope: "workspace" | "organisation";
        scopeId: string;
      }> = [];
      const activeSources = await tx
        .select({
          id: schema.membershipGrantTable.id,
          roleId: schema.membershipGrantTable.roleId,
          scope: schema.membershipGrantTable.scope,
          scopeId: schema.membershipGrantTable.scopeId,
          lastConfirmedAt: schema.membershipGrantTable.lastConfirmedAt,
          sourceKind: schema.membershipGrantTable.sourceKind,
          oidcGroupMappingId: schema.membershipGrantTable.oidcGroupMappingId,
        })
        .from(schema.membershipGrantTable)
        .where(
          and(
            eq(schema.membershipGrantTable.personId, personId),
            eq(schema.membershipGrantTable.identityConnectionId, connection.id),
            eq(
              schema.membershipGrantTable.externalIdentityId,
              externalIdentityId,
            ),
            inArray(schema.membershipGrantTable.sourceKind, [
              "jit_default",
              "oidc_group",
            ]),
            isNull(schema.membershipGrantTable.revokedAt),
          ),
        )
        .orderBy(schema.membershipGrantTable.id)
        .for("update");

      const mappings = await tx
        .select()
        .from(schema.oidcGroupMappingTable)
        .where(
          eq(schema.oidcGroupMappingTable.identityConnectionId, connection.id),
        )
        .orderBy(schema.oidcGroupMappingTable.id);
      const validMappings = [] as typeof mappings;
      const eligibleMappings = [] as typeof mappings;
      const groupIds = new Set(
        identity.groupObjectIds.kind === "complete"
          ? identity.groupObjectIds.objectIds
          : [],
      );
      for (const mapping of mappings) {
        if (
          !mapping.enabled ||
          !canonicalEntraGroupObjectId(mapping.externalGroupId) ||
          (mapping.scope !== "workspace" && mapping.scope !== "organisation")
        )
          continue;
        const valid = await validateOidcMappingRole(tx, {
          providerType: currentConnection.providerType,
          portalScope: currentConnection.portalScope,
          organisationId: currentConnection.organisationId,
          maxRoleRank: currentConnection.maxRoleRank,
          scope: mapping.scope,
          scopeId: mapping.scopeId,
          roleId: mapping.roleId,
        });
        if (!valid) continue;
        eligibleMappings.push(mapping);
        const mappingGroupId = canonicalEntraGroupObjectId(
          mapping.externalGroupId,
        );
        if (mappingGroupId && groupIds.has(mappingGroupId))
          validMappings.push(mapping);
      }
      const allowedMappingIds = new Set(
        validMappings.map((mapping) => mapping.id),
      );
      const eligibleMappingIds = new Set(
        eligibleMappings.map((mapping) => mapping.id),
      );
      const wantedJit = currentJit.value.enabled && Boolean(roleScopeId);
      const [jitRole] = wantedJit
        ? await tx
            .select()
            .from(schema.roleTable)
            .where(
              eq(schema.roleTable.id, currentJit.value.default_role_id ?? ""),
            )
            .limit(1)
        : [];
      const validJit = Boolean(
        jitRole &&
          roleScopeId &&
          (await validateOidcMappingRole(tx, {
            providerType: currentConnection.providerType,
            portalScope: currentConnection.portalScope,
            organisationId: currentConnection.organisationId,
            maxRoleRank: currentConnection.maxRoleRank,
            scope: roleScope,
            scopeId: roleScopeId,
            roleId: jitRole.id,
          })),
      );
      const keptMappingIds = new Set<string>();
      let keptJit = false;
      const retirementReasons: Partial<
        Record<OidcGrantRetirementReason, number>
      > = {};
      for (const grant of activeSources) {
        const matchedMapping = grant.oidcGroupMappingId
          ? validMappings.find(
              (mapping) => mapping.id === grant.oidcGroupMappingId,
            )
          : undefined;
        const keep =
          grant.sourceKind === "jit_default"
            ? validJit &&
              !keptJit &&
              jitRole?.id === grant.roleId &&
              grant.scope === roleScope &&
              grant.scopeId === roleScopeId
            : Boolean(
                matchedMapping &&
                  matchedMapping.roleId === grant.roleId &&
                  matchedMapping.scope === grant.scope &&
                  matchedMapping.scopeId === grant.scopeId &&
                  allowedMappingIds.has(matchedMapping.id) &&
                  !keptMappingIds.has(matchedMapping.id),
              );
        if (keep) {
          await tx
            .update(schema.membershipGrantTable)
            .set({
              updatedAt: now,
              lastConfirmedAt: now,
            })
            .where(eq(schema.membershipGrantTable.id, grant.id));
          if (grant.sourceKind === "jit_default") keptJit = true;
          else if (grant.oidcGroupMappingId)
            keptMappingIds.add(grant.oidcGroupMappingId);
          continue;
        }
        const retirementReason =
          grant.sourceKind === "jit_default"
            ? "mapping_changed"
            : classifyOidcGrantRetirementReason({
                evidence: identity.groupObjectIds,
                grant,
                mapping: mappings.find(
                  (candidate) => candidate.id === grant.oidcGroupMappingId,
                ),
                eligibleMappingIds,
              });
        retirementReasons[retirementReason] =
          (retirementReasons[retirementReason] ?? 0) + 1;
        await tx
          .update(schema.membershipGrantTable)
          .set({
            revokedAt: now,
            revocationReason: retirementReason,
            updatedAt: now,
            membershipId: null,
          })
          .where(eq(schema.membershipGrantTable.id, grant.id));
        projectionKeys.push({
          personId,
          scope: grant.scope as "workspace" | "organisation",
          scopeId: grant.scopeId,
        });
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: connection.id,
          externalIdentityId,
          kind: "group.member_removed",
          outcome: "success",
          detail: {
            source: grant.sourceKind,
            reason: retirementReason,
            scope: grant.scope,
            scopeId: grant.scopeId,
          },
          actorType: "oidc",
          createdAt: now,
        });
      }
      if (validJit && !keptJit && jitRole && roleScopeId) {
        await tx.insert(schema.membershipGrantTable).values({
          personId,
          scope: roleScope,
          scopeId: roleScopeId,
          roleId: jitRole.id,
          sourceKind: "jit_default",
          externalIdentityId,
          identityConnectionId: connection.id,
          seesAll: false,
          createdAt: now,
          updatedAt: now,
          lastConfirmedAt: now,
        });
        projectionKeys.push({
          personId,
          scope: roleScope,
          scopeId: roleScopeId,
        });
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: connection.id,
          externalIdentityId,
          kind: "group.member_added",
          outcome: "success",
          detail: {
            source: "jit_default",
            scope: roleScope,
            scopeId: roleScopeId,
          },
          actorType: "oidc",
          createdAt: now,
        });
      }
      for (const mapping of validMappings) {
        if (keptMappingIds.has(mapping.id)) continue;
        await tx.insert(schema.membershipGrantTable).values({
          personId,
          scope: mapping.scope,
          scopeId: mapping.scopeId,
          roleId: mapping.roleId,
          sourceKind: "oidc_group",
          externalIdentityId,
          identityConnectionId: connection.id,
          oidcGroupMappingId: mapping.id,
          seesAll: false,
          createdAt: now,
          updatedAt: now,
          lastConfirmedAt: now,
        });
        projectionKeys.push({
          personId,
          scope: mapping.scope as "workspace" | "organisation",
          scopeId: mapping.scopeId,
        });
        await tx.insert(schema.provisioningEventTable).values({
          identityConnectionId: connection.id,
          externalIdentityId,
          kind: "group.member_added",
          outcome: "success",
          detail: {
            source: "oidc_group",
            mappingId: mapping.id,
            scope: mapping.scope,
            scopeId: mapping.scopeId,
          },
          actorType: "oidc",
          createdAt: now,
        });
      }
      await projectMembershipKeys(tx, projectionKeys);
      if (projectionKeys.length) {
        try {
          await tx.transaction(async (auditTx) =>
            appendAuditLog(auditTx, {
              action: "membership.changed",
              actorId: null,
              actorType: "system",
              organisationId: currentPerson.organisationId,
              workspaceId: null,
              entityType: "membership",
              entityId: personId,
              after: {
                source: "oidc",
                grantChanges: projectionKeys.length,
                revocationReasons: retirementReasons,
                scopes: [
                  ...new Set(
                    projectionKeys.map((key) => `${key.scope}:${key.scopeId}`),
                  ),
                ],
              },
            }),
          );
        } catch {
          logTaskDesk({
            module: "auth",
            message: "auth.failure",
            level: "warn",
            result: "failed",
          });
        }
      }
      return {
        denied: false as const,
        userId,
        changed: projectionKeys.length > 0,
        workspaceIds: [
          ...new Set(
            projectionKeys
              .filter((key) => key.scope === "workspace")
              .map((key) => key.scopeId),
          ),
        ],
      };
    }),
  );
  if (result.denied) {
    if (result.changed) {
      if (result.userId)
        await invalidateNativeAuthorization({ userId: result.userId });
      for (const workspaceId of result.workspaceIds)
        await invalidateNativeAuthorization({ workspaceId });
    }
    return { kind: "denied" as const };
  }
  if (result.changed) {
    await invalidateNativeAuthorization({ userId: result.userId });
    for (const workspaceId of result.workspaceIds)
      await invalidateNativeAuthorization({ workspaceId });
  }
  const user = await ctx.context.internalAdapter.findUserById(result.userId);
  if (!user)
    throw new APIError("UNAUTHORIZED", { message: "Identity sign-in failed" });
  const [factorState] = await getOidcUserFactorState(user.id);
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
