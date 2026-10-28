import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import {
  findActiveApiKeysBySelector,
  loadApiKeyKind,
  upgradeApiKeyHash,
} from "../api-key/repository";
import {
  apiKeySelector,
  hashApiKeySecretArgon2id,
  legacySha256ApiKeyHash,
  VerifiedSecretCache,
  verifyApiKeySecret,
} from "../api-key/secret-hash";
import {
  ArgonGate,
  FailureLimiter,
  looksLikeApiKey,
  VerificationOverloadedError,
  VerificationThrottledError,
} from "../api-key/verify-guard";
import {
  findActiveApiKeyByHash,
  findApiKeyOwnerStatus,
} from "./access-lookups.repository";

const verifiedSecrets = new VerifiedSecretCache();
const gate = new ArgonGate();
const failures = new FailureLimiter();

/**
 * AK-2: find the stored row for a presented key. A legacy SHA-256 row is matched by digest and
 * rewritten to Argon2id before the request continues; a current row is found by its visible
 * selector and verified in constant time (cached once verified, never across a changed hash).
 */
async function findVerifiedApiKey(key: string, clientIp: string | null) {
  const legacy = await findActiveApiKeyByHash(legacySha256ApiKeyHash(key));
  if (legacy) {
    await tryUpgrade(key, legacy.id, legacy.key);
    return legacy;
  }
  // R7-03: a string that cannot be a key never reaches the lookup or the hash.
  if (!looksLikeApiKey(key)) {
    noteFailure(clientIp);
    return undefined;
  }
  const selector = apiKeySelector(key);
  const candidates = await findActiveApiKeysBySelector(selector);
  if (candidates.length === 0) noteFailure(clientIp);
  for (const candidate of candidates) {
    // A secret already verified against this exact stored hash needs no hash and is never held
    // up by the limits below.
    if (verifiedSecrets.has(key, candidate.key)) return candidate;
    const result = await verifyGuarded(key, candidate.key, selector, clientIp);
    if (!result.valid) continue;
    verifiedSecrets.remember(key, candidate.key);
    if (result.needsRehash) await tryUpgrade(key, candidate.id, candidate.key);
    return candidate;
  }
  return undefined;
}

function noteFailure(clientIp: string | null): void {
  if (clientIp) failures.reserve(clientIp);
}

/**
 * Identical attempts in flight share one verification: a client that fires a burst of requests
 * with its own (not yet cached) key pays one Argon2id run, not one per request, and so is not
 * counted against the limits below. A flood of DISTINCT junk secrets gets no such help.
 */
const inFlightVerifications = new Map<
  string,
  Promise<Awaited<ReturnType<typeof verifyApiKeySecret>>>
>();

function verifyGuarded(
  key: string,
  stored: string,
  selector: string,
  clientIp: string | null,
) {
  const slot = `${stored}\u0000${createHash("sha256").update(key).digest("base64url")}`;
  const shared = inFlightVerifications.get(slot);
  if (shared) return shared;
  const run = verifyAdmitted(key, stored, selector, clientIp).finally(() => {
    inFlightVerifications.delete(slot);
  });
  inFlightVerifications.set(slot, run);
  return run;
}

async function verifyAdmitted(
  key: string,
  stored: string,
  selector: string,
  clientIp: string | null,
) {
  if (clientIp) {
    const wait = failures.blockedFor(clientIp);
    if (wait > 0) throw new VerificationThrottledError(wait);
    // Counted before the hash so concurrent attempts cannot all slip under the limit.
    failures.reserve(clientIp);
  }
  let release: () => void;
  try {
    release = await gate.acquire(selector);
  } catch (error) {
    if (clientIp) failures.refund(clientIp);
    throw error;
  }
  try {
    const result = await verifyApiKeySecret(key, stored);
    if (result.valid && clientIp) failures.refund(clientIp);
    return result;
  } finally {
    release();
  }
}

async function tryUpgrade(key: string, id: string, previous: string) {
  try {
    await upgradeApiKeyHash(
      id,
      previous,
      await hashApiKeySecretArgon2id(key),
      apiKeySelector(key),
    );
  } catch {
    // The credential still verified; the upgrade is retried on the next use.
  }
}

function tooMany(status: 429 | 503, message: string, retryAfter: number) {
  return new HTTPException(status, {
    message,
    res: new Response(JSON.stringify({ message }), {
      status,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.max(1, retryAfter)),
      },
    }),
  });
}

function parsePermissions(raw: string | null): Record<string, string[]> | null {
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const permissions: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(actions)) return {};
    if (actions.some((action) => typeof action !== "string")) return {};
    permissions[resource] = actions as string[];
  }
  return permissions;
}

async function apiKeyOwnerIsActive(ownerId: string): Promise<boolean> {
  if (!ownerId) return false;
  const owner = await findApiKeyOwnerStatus(ownerId);
  return (
    owner !== undefined &&
    owner.banned !== true &&
    owner.personActive === true &&
    owner.personSide === "staff"
  );
}

/** `clientIp` is the trusted-proxy client address (`clientIpForContext`), or null when unknown. */
export async function verifyApiKey(
  key: string,
  options: { clientIp?: string | null } = {},
) {
  let apiKey: Awaited<ReturnType<typeof findVerifiedApiKey>>;
  try {
    apiKey = await findVerifiedApiKey(key, options.clientIp ?? null);
  } catch (error) {
    if (error instanceof VerificationThrottledError)
      throw tooMany(429, "too_many_failed_attempts", error.retryAfterSeconds);
    if (error instanceof VerificationOverloadedError)
      throw tooMany(503, "verification_busy", error.retryAfterSeconds);
    throw error;
  }

  if (!apiKey) {
    return null;
  }

  // The shared key-verification point also checks the owner's current state, so every route
  // family (agent, project reach, instance admin, pending action, realtime, assets) refuses a
  // banned or deactivated owner's still-enabled key even when strict policy enforcement is
  // off. This is the same refusal `resolveIdentity` applies in strict mode: a missing user or
  // person, an inactive person, or a banned user has no authority, so the key gets a 401.
  //
  // A workspace service key (AK-7) is owned by the workspace, not a person: it has no owner
  // row to check, so the owner check is skipped when its `api_key` extension row carries a
  // `workspace_id`. Its own disabled/IP/rate rules run in `enforceApiKeyRequest`.
  const ownerId = apiKey.referenceId ?? apiKey.userId ?? "";
  const kind = await loadApiKeyKind(apiKey.id);
  if (kind.kind !== "service" && !(await apiKeyOwnerIsActive(ownerId))) {
    return null;
  }

  return {
    valid: true,
    key: {
      id: apiKey.id,
      kind: kind.kind,
      userId: apiKey.referenceId ?? apiKey.userId ?? "",
      name: apiKey.name,
      prefix: apiKey.prefix,
      start: apiKey.start,
      enabled: apiKey.enabled ?? false,
      expiresAt: apiKey.expiresAt,
      permissions: parsePermissions(apiKey.permissions),
      refillInterval: apiKey.refillInterval,
      refillAmount: apiKey.refillAmount,
      lastRefillAt: apiKey.lastRefillAt,
      rateLimitEnabled: apiKey.rateLimitEnabled,
      rateLimitTimeWindow: apiKey.rateLimitTimeWindow,
      rateLimitMax: apiKey.rateLimitMax,
      requestCount: apiKey.requestCount,
      remaining: apiKey.remaining,
      lastRequest: apiKey.lastRequest,
      metadata: apiKey.metadata
        ? (JSON.parse(apiKey.metadata) as Record<string, unknown>)
        : null,
    },
  };
}
