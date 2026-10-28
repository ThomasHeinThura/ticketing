import { randomBytes } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import {
  authorityFor,
  type Capability,
  type ResolvedIdentity,
} from "@taskdesk/permissions";
import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import type { StepUpExecutor } from "../auth/repository";
import db from "../database";
import { apiKeyExtensionTable } from "../database/schema";
import { invalidatePendingActionsForCredential } from "../pending-action/credential-invalidation";
import {
  lockPendingActionLifecycle,
  reportPendingActionAuditFailures,
} from "../pending-action/lifecycle-invalidation";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  boundServiceKeyCapabilities,
  capabilitiesToPermissions,
  KeyCapabilityError,
  parseRequestedCapabilities,
  writeCapabilitiesOf,
} from "./capability-set";
import { IpAllowlistError, normalizeIpAllowlist } from "./ip-allowlist";
import {
  disableApiKey,
  findKeyForUser,
  findKeyForWorkspace,
  insertApiKey,
  listKeysForUser,
  listKeysForWorkspace,
  lockApiKey,
  lockServiceKeyAccountability,
} from "./repository";
import type { ApiKeySummary } from "./schema";
import { apiKeySelector, hashApiKeySecretArgon2id } from "./secret-hash";
import { toApiKeySummary } from "./summary";

/** AK-8: keys authenticate as `Authorization: Bearer tdk_…`. */
export const API_KEY_PREFIX = "tdk_";

/**
 * AK-2: the stored form of a key secret is an Argon2id PHC string (`secret-hash.ts`). The
 * verification path (`utils/verify-api-key.ts`) finds the row by the visible selector
 * (`apikey.start`) and also still accepts the pre-P4 unsalted SHA-256 form, rewriting it on use.
 */
export async function hashApiKeySecret(secret: string): Promise<string> {
  return hashApiKeySecretArgon2id(secret);
}

export function generateApiKeySecret(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export type KeyRequestContext = {
  userId: string;
  actorIp?: string | null;
  userAgent?: string | null;
};

export type CreatedKey = ApiKeySummary & { key: string };

async function staffIdentity(userId: string): Promise<ResolvedIdentity> {
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity) throw new HTTPException(401, { message: "Unauthorized" });
  if (identity.side !== "staff")
    throw new HTTPException(403, {
      message: "session_required: API keys are for staff accounts",
    });
  return identity;
}

function translateKeyInputError(error: unknown): never {
  if (error instanceof KeyCapabilityError) {
    throw new HTTPException(error.code === "beyond_creator" ? 403 : 400, {
      message:
        error.capabilities.length > 0
          ? `${error.message}: ${error.capabilities.join(", ")}`
          : error.message,
    });
  }
  if (error instanceof IpAllowlistError)
    throw new HTTPException(400, { message: error.message });
  throw error;
}

function expiryFrom(expiresIn: number | null | undefined): Date | null {
  return expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
}

/* ------------------------------------------------------------------ *
 * Personal keys (`/api/me/api-keys`)
 * ------------------------------------------------------------------ */

export async function listMyApiKeys(userId: string): Promise<ApiKeySummary[]> {
  return (await listKeysForUser(userId)).map(toApiKeySummary);
}

export async function createPersonalApiKey(
  context: KeyRequestContext,
  body: {
    name: string;
    expiresIn?: number | null;
    capabilities?: string[];
    isMcp?: boolean;
    ipAllowlist?: string[];
    rateLimitPerMinute?: number;
  },
): Promise<CreatedKey> {
  const identity = await staffIdentity(context.userId);
  let capabilities: Capability[];
  let ipAllowlist: string[] | null;
  try {
    // AK-9: omitted means the read-only default; a write capability is the explicit opt-in.
    capabilities = parseRequestedCapabilities(body.capabilities);
    ipAllowlist = normalizeIpAllowlist(body.ipAllowlist);
  } catch (error) {
    return translateKeyInputError(error);
  }

  const secret = generateApiKeySecret();
  const hashedKey = await hashApiKeySecret(secret);
  const id = createId();
  const expiresAt = expiryFrom(body.expiresIn);
  const isMcp = body.isMcp === true;

  const row = await db.transaction(async (tx) => {
    await insertApiKey(tx, {
      id,
      name: body.name,
      prefix: API_KEY_PREFIX,
      start: apiKeySelector(secret),
      hashedKey,
      userId: context.userId,
      permissions: capabilitiesToPermissions(capabilities),
      expiresAt,
      rateLimitPerMinute: body.rateLimitPerMinute ?? null,
      extension: {
        workspaceId: null,
        personId: identity.personId,
        createdByPersonId: identity.personId,
        capabilities: null,
        ipAllowlist,
        isMcp,
      },
    });
    await appendAuditLog(tx, {
      actorId: context.userId,
      actorType: "person",
      actorIp: context.actorIp ?? null,
      userAgent: context.userAgent ?? null,
      action: "api_key.created",
      entityType: "api_key",
      entityId: id,
      after: {
        name: body.name,
        kind: "personal",
        isMcp,
        capabilities,
        writeCapabilities: writeCapabilitiesOf(capabilities),
        expiresAt: expiresAt?.toISOString() ?? null,
        ipAllowlist,
      },
    });
    const created = await findKeyForUser(tx, id, context.userId);
    if (!created) throw new Error("Created API key could not be reloaded");
    return created;
  });
  return { ...toApiKeySummary(row), key: secret };
}

/**
 * AK-6: revocation is immediate; the row stays for audit (it is not a deletion, AK-11). Any
 * pending action the key requested is invalidated with `credential_revoked` (PA-9).
 */
export async function revokePersonalApiKey(
  context: KeyRequestContext,
  keyId: string,
): Promise<ApiKeySummary> {
  return revoke(
    context,
    keyId,
    (tx) => findKeyForUser(tx, keyId, context.userId),
    {
      workspaceId: null,
      kind: "personal",
    },
  );
}

/* ------------------------------------------------------------------ *
 * Workspace service keys (`/api/workspaces/{id}/api-keys`)
 * ------------------------------------------------------------------ */

export async function listWorkspaceApiKeys(
  workspaceId: string,
): Promise<ApiKeySummary[]> {
  return (await listKeysForWorkspace(workspaceId)).map(toApiKeySummary);
}

/** Acknowledges an accountability transfer without changing the credential or its subset. */
export async function reattestServiceApiKey(
  context: KeyRequestContext,
  workspaceId: string,
  keyId: string,
  expectedVersion: number,
  beforeWrite?: (tx: StepUpExecutor) => Promise<void>,
): Promise<ApiKeySummary> {
  const identity = await staffIdentity(context.userId);
  creatorAuthorityAt(identity, workspaceId);

  return db.transaction(async (tx) => {
    const current = await lockServiceKeyAccountability(tx, keyId, workspaceId);
    if (!current)
      throw new HTTPException(404, { message: "API key not found" });
    if (current.accountabilityVersion !== expectedVersion)
      throw new HTTPException(409, {
        message: "api_key_accountability_changed",
      });
    if (current.reattestationRequiredAt === null)
      throw new HTTPException(409, {
        message: "api_key_reattestation_not_required",
      });

    // The proof is bound to this key and version and spent in the same transaction as the
    // marker update. Re-attestation confirms accountability; it does not rotate the secret or
    // broaden/recompute the stored capability subset.
    await beforeWrite?.(tx);
    const now = new Date();
    const [updated] = await tx
      .update(apiKeyExtensionTable)
      .set({
        reattestationRequiredAt: null,
        reattestedAt: now,
        reattestedByPersonId: identity.personId,
        accountabilityVersion: current.accountabilityVersion + 1,
      })
      .where(
        and(
          eq(apiKeyExtensionTable.apikeyId, keyId),
          eq(apiKeyExtensionTable.workspaceId, workspaceId),
          eq(
            apiKeyExtensionTable.accountabilityVersion,
            current.accountabilityVersion,
          ),
          isNotNull(apiKeyExtensionTable.reattestationRequiredAt),
        ),
      )
      .returning({ apikeyId: apiKeyExtensionTable.apikeyId });
    if (!updated)
      throw new HTTPException(409, {
        message: "api_key_accountability_changed",
      });

    await appendAuditLog(tx, {
      actorId: context.userId,
      actorType: "person",
      actorIp: context.actorIp ?? null,
      userAgent: context.userAgent ?? null,
      workspaceId,
      action: "api_key.reattested",
      entityType: "api_key",
      entityId: keyId,
      before: {
        reattestationRequiredAt: current.reattestationRequiredAt.toISOString(),
        accountabilityVersion: current.accountabilityVersion,
        capabilities: current.capabilities,
      },
      after: {
        reattestationRequiredAt: null,
        reattestedAt: now.toISOString(),
        reattestedByPersonId: identity.personId,
        accountabilityVersion: current.accountabilityVersion + 1,
        capabilities: current.capabilities,
      },
    });
    const refreshed = await findKeyForWorkspace(tx, keyId, workspaceId);
    if (!refreshed)
      throw new Error("Re-attested API key could not be reloaded");
    return toApiKeySummary(refreshed);
  });
}

/** `api_key:manage` held by this identity at this workspace, or 403. */
export function creatorAuthorityAt(
  identity: ResolvedIdentity,
  workspaceId: string,
): Set<Capability> {
  const held = authorityFor(identity, "workspace", { workspaceId });
  if (!held.has("api_key:manage"))
    throw new HTTPException(403, { message: "Insufficient permissions" });
  return held;
}

export async function createServiceApiKey(
  context: KeyRequestContext,
  workspaceId: string,
  body: {
    name: string;
    expiresIn?: number | null;
    capabilities: string[];
    ipAllowlist?: string[];
    rateLimitPerMinute?: number;
  },
  /** Spends the creator's step-up proof in the creating transaction, right before the insert. */
  beforeWrite?: (tx: StepUpExecutor) => Promise<void>,
): Promise<CreatedKey> {
  const identity = await staffIdentity(context.userId);
  const held = creatorAuthorityAt(identity, workspaceId);
  let frozen: Capability[];
  let ipAllowlist: string[] | null;
  try {
    // AK-7: bounded by the creator's authority now (expanded closure, like a role grant);
    // the exact frozen set is what is stored and audited.
    frozen = boundServiceKeyCapabilities(
      parseRequestedCapabilities(body.capabilities),
      held,
    );
    ipAllowlist = normalizeIpAllowlist(body.ipAllowlist);
  } catch (error) {
    return translateKeyInputError(error);
  }

  const secret = generateApiKeySecret();
  const hashedKey = await hashApiKeySecret(secret);
  const id = createId();
  const expiresAt = expiryFrom(body.expiresIn);

  const row = await db.transaction(async (tx) => {
    await beforeWrite?.(tx);
    await insertApiKey(tx, {
      id,
      name: body.name,
      prefix: API_KEY_PREFIX,
      start: apiKeySelector(secret),
      hashedKey,
      userId: null,
      permissions: capabilitiesToPermissions(frozen),
      expiresAt,
      rateLimitPerMinute: body.rateLimitPerMinute ?? null,
      extension: {
        workspaceId,
        personId: null,
        createdByPersonId: identity.personId,
        capabilities: frozen,
        ipAllowlist,
        isMcp: false,
      },
    });
    await appendAuditLog(tx, {
      actorId: context.userId,
      actorType: "person",
      actorIp: context.actorIp ?? null,
      userAgent: context.userAgent ?? null,
      workspaceId,
      action: "api_key.created",
      entityType: "api_key",
      entityId: id,
      after: {
        name: body.name,
        kind: "service",
        // The exact set granted (AK-7).
        capabilities: frozen,
        expiresAt: expiresAt?.toISOString() ?? null,
        ipAllowlist,
      },
    });
    const created = await findKeyForWorkspace(tx, id, workspaceId);
    if (!created) throw new Error("Created service key could not be reloaded");
    return created;
  });
  return { ...toApiKeySummary(row), key: secret };
}

export async function revokeServiceApiKey(
  context: KeyRequestContext,
  workspaceId: string,
  keyId: string,
): Promise<ApiKeySummary> {
  return revoke(
    context,
    keyId,
    (tx) => findKeyForWorkspace(tx, keyId, workspaceId),
    { workspaceId, kind: "service" },
  );
}

async function revoke(
  context: KeyRequestContext,
  keyId: string,
  find: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => ReturnType<typeof findKeyForUser>,
  scope: { workspaceId: string | null; kind: "personal" | "service" },
): Promise<ApiKeySummary> {
  let invalidationAuditFailures = 0;
  const row = await db.transaction(async (tx) => {
    await lockPendingActionLifecycle(tx);
    await lockApiKey(tx, keyId);
    const existing = await find(tx);
    if (!existing)
      throw new HTTPException(404, { message: "API key not found" });
    if (existing.enabled) {
      await disableApiKey(tx, keyId, "revoked");
      invalidationAuditFailures = await invalidatePendingActionsForCredential(
        tx,
        { type: "api_key", id: keyId },
      );
      await appendAuditLog(tx, {
        actorId: context.userId,
        actorType: "person",
        actorIp: context.actorIp ?? null,
        userAgent: context.userAgent ?? null,
        workspaceId: scope.workspaceId,
        action: "api_key.revoked",
        entityType: "api_key",
        entityId: keyId,
        before: { enabled: true },
        after: { enabled: false, kind: scope.kind },
      });
    }
    const refreshed = await find(tx);
    if (!refreshed) throw new Error("Revoked API key could not be reloaded");
    return refreshed;
  });
  await reportPendingActionAuditFailures(invalidationAuditFailures);
  return toApiKeySummary(row);
}
