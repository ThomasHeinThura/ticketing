import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import type { DbTransaction } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { lockPendingActionLifecycle } from "../pending-action/lifecycle-invalidation";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { dbNowUtc } from "../utils/db-time";
import { isUniqueViolation } from "../utils/is-unique-violation";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  type AccountLinkIntent,
  type AccountLinkOidcContext,
  accountLinkConfirmedSchema,
  accountLinkIntentIdentifier,
  accountLinkIntentResponseSchema,
  accountLinkIntentSchema,
  accountLinkListResponseSchema,
} from "./account-link-contract";
import {
  createOidcAuthorizationStart,
  oidcStateCookieName,
  oidcStateCookieOptions,
} from "./oidc-login";

type Portal = "agent" | "customer";
type SessionContext = { id: string; portal?: string | null };

const targetConnectionIdSchema = z.string().min(1).max(128);
const intentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

function requireSession(c: {
  get(key: "session"): unknown;
  get(key: "userId"): string;
}): { session: SessionContext; userId: string; portal: Portal } {
  const session = c.get("session") as SessionContext | null;
  const userId = c.get("userId");
  if (
    !session?.id ||
    !userId ||
    (session.portal !== "agent" && session.portal !== "customer")
  )
    throw new HTTPException(401, { message: "Unauthorized" });
  return { session, userId, portal: session.portal };
}

function parseStoredIntent(value: string): AccountLinkIntent | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = accountLinkIntentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function loadSourceSession(
  tx: DbTransaction,
  input: {
    sessionId: string;
    userId: string;
    portal: Portal;
    targetConnectionId?: string;
  },
) {
  // The session's source connection is read first without a row lock so A and B can then
  // be locked together in deterministic id order, matching identity-configuration writers.
  const [observedSession] = await tx
    .select({ sourceConnectionId: schema.sessionTable.identityConnectionId })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, input.sessionId),
        eq(schema.sessionTable.userId, input.userId),
      ),
    )
    .limit(1);
  if (!observedSession?.sourceConnectionId) return null;
  const ids = [
    ...new Set([
      observedSession.sourceConnectionId,
      ...(input.targetConnectionId ? [input.targetConnectionId] : []),
    ]),
  ].sort();
  const connections = await tx
    .select({
      id: schema.identityConnectionTable.id,
      displayName: schema.identityConnectionTable.displayName,
      portalScope: schema.identityConnectionTable.portalScope,
      organisationId: schema.identityConnectionTable.organisationId,
      enabled: schema.identityConnectionTable.enabled,
      providerType: schema.identityConnectionTable.providerType,
      tenantId: schema.identityConnectionTable.tenantId,
      defaultWorkspaceId: schema.identityConnectionTable.defaultWorkspaceId,
      issuer: schema.identityConnectionTable.issuer,
      clientId: schema.identityConnectionTable.clientId,
      redirectUri: schema.identityConnectionTable.redirectUri,
      scopes: schema.identityConnectionTable.scopes,
      claimMapping: schema.identityConnectionTable.claimMapping,
      jitPolicy: schema.identityConnectionTable.jitPolicy,
      configVersion: schema.identityConnectionTable.configVersion,
    })
    .from(schema.identityConnectionTable)
    .where(
      and(
        inArray(schema.identityConnectionTable.id, ids),
        isNull(schema.identityConnectionTable.deletedAt),
      ),
    )
    .orderBy(schema.identityConnectionTable.id)
    .for("update");
  const source = connections.find(
    (connection) => connection.id === observedSession.sourceConnectionId,
  );
  const target = input.targetConnectionId
    ? connections.find(
        (connection) => connection.id === input.targetConnectionId,
      )
    : undefined;
  if (
    !source ||
    !source.enabled ||
    source.portalScope !== input.portal ||
    source.providerType !== "entra" ||
    (input.targetConnectionId &&
      (!target ||
        !target.enabled ||
        target.portalScope !== input.portal ||
        target.providerType !== "entra" ||
        target.id === source.id ||
        (input.portal === "customer" &&
          (!source.organisationId ||
            source.organisationId !== target.organisationId))))
  )
    return null;

  const [session] = await tx
    .select({
      id: schema.sessionTable.id,
      userId: schema.sessionTable.userId,
      portal: schema.sessionTable.portal,
      sourceConnectionId: schema.sessionTable.identityConnectionId,
      expiresAt: schema.sessionTable.expiresAt,
      impersonatedBy: schema.sessionTable.impersonatedBy,
    })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, input.sessionId),
        eq(schema.sessionTable.userId, input.userId),
        eq(schema.sessionTable.portal, input.portal),
        eq(schema.sessionTable.identityConnectionId, source.id),
        gt(schema.sessionTable.expiresAt, dbNowUtc()),
        isNull(schema.sessionTable.impersonatedBy),
      ),
    )
    .for("update")
    .limit(1);
  if (!session) return null;

  const [person] = await tx
    .select({
      id: schema.personTable.id,
      userId: schema.personTable.userId,
      side: schema.personTable.side,
      organisationId: schema.personTable.organisationId,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, input.userId))
    .for("update")
    .limit(1);
  if (
    !person ||
    !person.active ||
    person.side !== (input.portal === "agent" ? "staff" : "customer") ||
    (input.portal === "customer" &&
      person.organisationId !== source.organisationId)
  )
    return null;

  const [sourceIdentity] = await tx
    .select({
      id: schema.externalIdentityTable.id,
      subject: schema.externalIdentityTable.subject,
      active: schema.externalIdentityTable.active,
      userId: schema.externalIdentityTable.userId,
      personId: schema.externalIdentityTable.personId,
    })
    .from(schema.externalIdentityTable)
    .where(
      and(
        eq(schema.externalIdentityTable.identityConnectionId, source.id),
        eq(schema.externalIdentityTable.issuer, source.issuer),
        eq(schema.externalIdentityTable.userId, input.userId),
        eq(schema.externalIdentityTable.personId, person.id),
      ),
    )
    .for("update")
    .limit(1);
  if (!sourceIdentity?.active) return null;
  return { source, target, session, person, sourceIdentity };
}

async function revalidateStart(input: {
  sessionId: string;
  userId: string;
  portal: Portal;
  targetConnectionId: string;
  sourceConnectionId: string;
  sourceConfigVersion: number;
  targetConfigVersion: number;
}) {
  return db.transaction(async (tx) => {
    await lockPendingActionLifecycle(tx);
    const loaded = await loadSourceSession(tx, input);
    return Boolean(
      loaded &&
        loaded.source.id === input.sourceConnectionId &&
        loaded.source.configVersion === input.sourceConfigVersion &&
        loaded.target?.configVersion === input.targetConfigVersion,
    );
  });
}

export async function storeAccountLinkCandidate(input: {
  link: AccountLinkOidcContext;
  portal: Portal;
  organisationId: string | null;
  targetConnectionId: string;
  issuer: string;
  subject: string;
  accountLabel: string | null;
  displayName: string | null;
  expiresAt: Date;
}): Promise<string | null> {
  const identifier = accountLinkIntentIdentifier(input.link.intentId);
  return db.transaction(async (tx) => {
    await lockPendingActionLifecycle(tx);
    const loaded = await loadSourceSession(tx, {
      sessionId: input.link.sessionId,
      userId: input.link.userId,
      portal: input.portal,
      targetConnectionId: input.targetConnectionId,
    });
    if (
      !loaded ||
      !loaded.target ||
      loaded.source.id !== input.link.sourceConnectionId ||
      loaded.source.configVersion !== input.link.sourceConfigVersion ||
      loaded.target.configVersion !== input.link.targetConfigVersion ||
      loaded.target.id !== input.targetConnectionId ||
      loaded.target.issuer !== input.issuer ||
      loaded.target.organisationId !== input.organisationId ||
      input.expiresAt <= new Date()
    )
      return null;
    const intent = accountLinkIntentSchema.parse({
      ...input.link,
      portal: input.portal,
      organisationId: input.organisationId,
      targetConnectionId: input.targetConnectionId,
      issuer: input.issuer,
      subject: input.subject,
      accountLabel: input.accountLabel,
      displayName: input.displayName,
      expiresAt: input.expiresAt.toISOString(),
    });
    const [existing] = await tx
      .select({ id: schema.verificationTable.id })
      .from(schema.verificationTable)
      .where(eq(schema.verificationTable.identifier, identifier))
      .limit(1);
    if (existing) return null;
    await tx.insert(schema.verificationTable).values({
      identifier,
      value: JSON.stringify(intent),
      expiresAt: input.expiresAt,
    });
    return input.link.intentId;
  });
}

const listRoute = createRoute({
  method: "get",
  path: "/identity-links",
  operationId: "listOwnIdentityLinks",
  tags: ["Identity links"],
  summary: "List identity connections available to the current SSO account",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse(
      "Connections for the current account",
      accountLinkListResponseSchema,
    ),
    401: errorResponse("An authenticated browser session is required"),
    403: errorResponse("The current account cannot link identities"),
  },
});

const startRoute = createRoute({
  method: "post",
  path: "/identity-links/{targetConnectionId}/start",
  operationId: "startOwnIdentityLink",
  tags: ["Identity links"],
  summary: "Prove a second identity for the current SSO account",
  middleware: [requireSessionOnly()] as const,
  request: {
    params: z.object({ targetConnectionId: targetConnectionIdSchema }),
  },
  responses: {
    200: jsonResponse(
      "Identity provider authorization URL",
      z.object({ authorizationUrl: z.string().url() }),
    ),
    401: errorResponse("An authenticated browser session is required"),
    403: errorResponse("The current account cannot link identities"),
    404: errorResponse("The identity connection is unavailable"),
  },
});

const intentRoute = createRoute({
  method: "get",
  path: "/identity-links/intents/{intentId}",
  operationId: "getOwnIdentityLinkIntent",
  tags: ["Identity links"],
  summary: "Read a pending identity-link confirmation for the current session",
  middleware: [requireSessionOnly()] as const,
  request: { params: z.object({ intentId: intentIdSchema }) },
  responses: {
    200: jsonResponse("Pending identity link", accountLinkIntentResponseSchema),
    401: errorResponse("An authenticated browser session is required"),
    404: errorResponse("The identity link is unavailable"),
  },
});

const confirmRoute = createRoute({
  method: "post",
  path: "/identity-links/intents/{intentId}/confirm",
  operationId: "confirmOwnIdentityLink",
  tags: ["Identity links"],
  summary: "Confirm linking the verified identity to the current account",
  middleware: [requireSessionOnly()] as const,
  request: { params: z.object({ intentId: intentIdSchema }) },
  responses: {
    200: jsonResponse("Identity linked", accountLinkConfirmedSchema),
    401: errorResponse("An authenticated browser session is required"),
    404: errorResponse("The identity link is unavailable"),
    409: errorResponse("The identity link is no longer valid"),
  },
});

const router = apiRouter()
  .openapi(listRoute, async (c) => {
    const { session, userId, portal } = requireSession(c);
    if (portal !== "agent") {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    const sourceContext = await db.transaction(async (tx) => {
      await lockPendingActionLifecycle(tx);
      return loadSourceSession(tx, {
        sessionId: session.id,
        userId,
        portal,
      });
    });
    if (!sourceContext) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    const targets = await db
      .select({
        connectionId: schema.identityConnectionTable.id,
        displayName: schema.identityConnectionTable.displayName,
        linked: schema.externalIdentityTable.id,
      })
      .from(schema.identityConnectionTable)
      .leftJoin(
        schema.externalIdentityTable,
        and(
          eq(
            schema.externalIdentityTable.identityConnectionId,
            schema.identityConnectionTable.id,
          ),
          eq(schema.externalIdentityTable.personId, sourceContext.person.id),
          eq(schema.externalIdentityTable.active, true),
          isNull(schema.externalIdentityTable.orphanedAt),
        ),
      )
      .where(
        and(
          eq(schema.identityConnectionTable.enabled, true),
          eq(schema.identityConnectionTable.portalScope, portal),
          eq(schema.identityConnectionTable.providerType, "entra"),
          isNull(schema.identityConnectionTable.deletedAt),
          ne(schema.identityConnectionTable.id, sourceContext.source.id),
        ),
      )
      .orderBy(
        schema.identityConnectionTable.displayName,
        schema.identityConnectionTable.id,
      );
    c.header("Cache-Control", "no-store");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        source: {
          connectionId: sourceContext.source.id,
          displayName: sourceContext.source.displayName,
        },
        targets: targets.map((target) => ({
          connectionId: target.connectionId,
          displayName: target.displayName,
          linked: target.linked !== null,
        })),
      },
      200,
    );
  })
  .openapi(startRoute, async (c) => {
    const { session, userId, portal } = requireSession(c);
    if (portal !== "agent") {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    const { targetConnectionId } = c.req.valid("param");
    const loaded = await db.transaction(async (tx) => {
      await lockPendingActionLifecycle(tx);
      return loadSourceSession(tx, {
        sessionId: session.id,
        userId,
        portal,
        targetConnectionId,
      });
    });
    if (!loaded?.target) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(404, {
        message: "Identity connection unavailable",
      });
    }
    const target = loaded.target;
    const intentId = randomBytes(32).toString("base64url");
    const link: AccountLinkOidcContext = {
      purpose: "account_link",
      intentId,
      sourceConnectionId: loaded.source.id,
      sourceConfigVersion: loaded.source.configVersion,
      targetConfigVersion: target.configVersion,
      sessionId: session.id,
      userId,
      personId: loaded.person.id,
    };
    const start = await createOidcAuthorizationStart({
      connection: target,
      portal,
      accountLink: link,
      revalidate: () =>
        revalidateStart({
          sessionId: session.id,
          userId,
          portal,
          targetConnectionId,
          sourceConnectionId: loaded.source.id,
          sourceConfigVersion: loaded.source.configVersion,
          targetConfigVersion: target.configVersion,
        }),
    });
    if (!start) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(409, {
        message: "Identity connection unavailable",
      });
    }
    setCookie(
      c,
      oidcStateCookieName(start.secure),
      start.state,
      oidcStateCookieOptions(start.secure),
    );
    c.header("Cache-Control", "no-store");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json({ authorizationUrl: start.authorizationUrl }, 200);
  })
  .openapi(intentRoute, async (c) => {
    const { session, userId } = requireSession(c);
    const { intentId } = c.req.valid("param");
    const [row] = await db
      .select({
        value: schema.verificationTable.value,
        expiresAt: schema.verificationTable.expiresAt,
      })
      .from(schema.verificationTable)
      .where(
        and(
          eq(
            schema.verificationTable.identifier,
            accountLinkIntentIdentifier(intentId),
          ),
          gt(schema.verificationTable.expiresAt, dbNowUtc()),
        ),
      )
      .limit(1);
    const intent = row && parseStoredIntent(row.value);
    if (
      !intent ||
      intent.intentId !== intentId ||
      intent.sessionId !== session.id ||
      intent.userId !== userId
    )
      throw new HTTPException(404, { message: "Identity link unavailable" });
    const [source] = await db
      .select({ displayName: schema.identityConnectionTable.displayName })
      .from(schema.identityConnectionTable)
      .where(
        and(
          eq(schema.identityConnectionTable.id, intent.sourceConnectionId),
          isNull(schema.identityConnectionTable.deletedAt),
        ),
      )
      .limit(1);
    const [target] = await db
      .select({ displayName: schema.identityConnectionTable.displayName })
      .from(schema.identityConnectionTable)
      .where(
        and(
          eq(schema.identityConnectionTable.id, intent.targetConnectionId),
          isNull(schema.identityConnectionTable.deletedAt),
        ),
      )
      .limit(1);
    if (!source || !target)
      throw new HTTPException(404, { message: "Identity link unavailable" });
    c.header("Cache-Control", "no-store");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        intentId,
        sourceDisplayName: source.displayName,
        targetDisplayName: target.displayName,
        accountLabel: intent.accountLabel,
        displayName: intent.displayName,
        expiresAt: intent.expiresAt,
      },
      200,
    );
  })
  .openapi(confirmRoute, async (c) => {
    const { session, userId, portal } = requireSession(c);
    const { intentId } = c.req.valid("param");
    if (portal !== "agent") {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(404, { message: "Identity link unavailable" });
    }
    let outcome: Awaited<ReturnType<typeof confirmAccountLink>>;
    try {
      outcome = await confirmAccountLink({ session, userId, portal, intentId });
    } catch (error) {
      if (
        isUniqueViolation(error, "external_identity_connection_subject_unique")
      )
        throw new HTTPException(409, {
          message: "Identity link is no longer valid",
        });
      throw error;
    }
    if (outcome.kind === "not_found")
      throw new HTTPException(404, { message: "Identity link unavailable" });
    if (outcome.kind === "conflict")
      throw new HTTPException(409, {
        message: "Identity link is no longer valid",
      });
    if (outcome.kind === "linked" && outcome.auditFailure) {
      recordAuditWriteFailure("mutation");
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    }
    c.header("Cache-Control", "no-store");
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(
      {
        linked: true as const,
        alreadyLinked: outcome.kind === "already_linked",
      },
      200,
    );
  });

export { router as accountLinkApi };

async function confirmAccountLink(input: {
  session: SessionContext;
  userId: string;
  portal: Portal;
  intentId: string;
}) {
  return db.transaction(async (tx) => {
    await lockPendingActionLifecycle(tx);
    const identifier = accountLinkIntentIdentifier(input.intentId);
    const [row] = await tx
      .select()
      .from(schema.verificationTable)
      .where(
        and(
          eq(schema.verificationTable.identifier, identifier),
          gt(schema.verificationTable.expiresAt, dbNowUtc()),
        ),
      )
      .for("update")
      .limit(1);
    const intent = row && parseStoredIntent(row.value);
    if (
      !row ||
      !intent ||
      intent.intentId !== input.intentId ||
      intent.sessionId !== input.session.id ||
      intent.userId !== input.userId ||
      intent.portal !== input.portal
    )
      return { kind: "not_found" as const };
    const loaded = await loadSourceSession(tx, {
      sessionId: input.session.id,
      userId: input.userId,
      portal: input.portal,
      targetConnectionId: intent.targetConnectionId,
    });
    if (
      !loaded?.target ||
      loaded.source.id !== intent.sourceConnectionId ||
      loaded.source.configVersion !== intent.sourceConfigVersion ||
      loaded.target.configVersion !== intent.targetConfigVersion ||
      loaded.person.id !== intent.personId ||
      loaded.target.issuer !== intent.issuer ||
      loaded.target.organisationId !== intent.organisationId
    )
      return { kind: "conflict" as const };

    const [existing] = await tx
      .select({
        id: schema.externalIdentityTable.id,
        personId: schema.externalIdentityTable.personId,
        userId: schema.externalIdentityTable.userId,
        active: schema.externalIdentityTable.active,
      })
      .from(schema.externalIdentityTable)
      .where(
        and(
          eq(
            schema.externalIdentityTable.identityConnectionId,
            intent.targetConnectionId,
          ),
          eq(schema.externalIdentityTable.issuer, intent.issuer),
          eq(schema.externalIdentityTable.subject, intent.subject),
        ),
      )
      .for("update")
      .limit(1);
    if (existing) {
      if (
        !existing.active ||
        existing.personId !== intent.personId ||
        existing.userId !== input.userId
      )
        return { kind: "conflict" as const };
      await tx
        .delete(schema.verificationTable)
        .where(eq(schema.verificationTable.id, row.id));
      return { kind: "already_linked" as const, identityId: existing.id };
    }

    const accountId = `${encodeURIComponent(intent.issuer)}:${encodeURIComponent(intent.subject)}`;
    const providerId = `taskdesk-entra:${intent.targetConnectionId}`;
    const [existingAccount] = await tx
      .select({
        id: schema.accountTable.id,
        userId: schema.accountTable.userId,
      })
      .from(schema.accountTable)
      .where(
        and(
          eq(schema.accountTable.providerId, providerId),
          eq(schema.accountTable.accountId, accountId),
        ),
      )
      .for("update")
      .limit(1);
    if (existingAccount && existingAccount.userId !== input.userId)
      return { kind: "conflict" as const };
    if (!existingAccount) {
      await tx.insert(schema.accountTable).values({
        accountId,
        providerId,
        userId: input.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const [linked] = await tx
      .insert(schema.externalIdentityTable)
      .values({
        identityConnectionId: intent.targetConnectionId,
        personId: intent.personId,
        userId: input.userId,
        issuer: intent.issuer,
        subject: intent.subject,
        userNameSnapshot: intent.accountLabel,
        emailSnapshot: intent.accountLabel,
        active: true,
        provisionedVia: "linked",
        firstSeenAt: new Date(),
        lastLoginAt: null,
      })
      .returning({ id: schema.externalIdentityTable.id });
    if (!linked) return { kind: "conflict" as const };

    let auditFailure = false;
    try {
      await tx.transaction(async (auditTx) =>
        appendAuditLog(auditTx, {
          action: "identity.linked",
          actorId: input.userId,
          actorType: "person",
          organisationId: intent.organisationId,
          workspaceId: null,
          entityType: "external_identity",
          entityId: linked.id,
          after: {
            sourceConnectionId: intent.sourceConnectionId,
            targetConnectionId: intent.targetConnectionId,
            personId: intent.personId,
            provisionedVia: "linked",
          },
        }),
      );
    } catch {
      auditFailure = true;
    }
    await tx
      .delete(schema.verificationTable)
      .where(eq(schema.verificationTable.id, row.id));
    return { kind: "linked" as const, identityId: linked.id, auditFailure };
  });
}
