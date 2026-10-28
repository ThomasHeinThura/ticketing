import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { trustProxyDepth } from "../utils/auth-request";
import { resolveClientIp } from "../utils/resolve-client-ip";
import type { ApiKeyKind } from "./credential";
import { isClientIpAllowed } from "./ip-allowlist";
import { classifyRequest, type RateLimitClass } from "./rate-limit";
import {
  consumeApiKeyRateLimit,
  type SharedRateLimitDecision,
} from "./rate-limit-store";
import {
  loadApiKeyBurstThreshold,
  loadApiKeyKind,
  loadMcpWriteCeilingPerMinute,
  recordApiKeyUse,
} from "./repository";

/**
 * The per-request rules the `api_key` extension adds on top of "the key exists and its owner
 * is active": disabled keys (AK-6), the IP allowlist (AK-4), the `feature.mcp` 404 for
 * `is_mcp` keys (MC-14) and the per-key rate limit (AK-4, MC-10, MC-22).
 *
 * Pure decision first, so every rule is unit-tested without a database; the wrapper below is
 * what the authentication layer calls once it has verified a key.
 */
export type KeyRequestFacts = {
  key: ApiKeyKind;
  clientIp: string | null;
  mcpFeatureEnabled: boolean;
};

export type KeyRequestDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404; message: string };

export function evaluateKeyRequest(facts: KeyRequestFacts): KeyRequestDecision {
  if (facts.key.disabledAt)
    return { ok: false, status: 401, message: "Unauthorized" };
  if (facts.key.isMcp && !facts.mcpFeatureEnabled)
    return { ok: false, status: 404, message: "Not found" };
  if (!isClientIpAllowed(facts.key.ipAllowlist, facts.clientIp))
    return {
      ok: false,
      status: 403,
      message: "ip_not_allowed: this key is not allowed from this address",
    };
  return { ok: true };
}

export function clientIpForContext(c: Context): string | null {
  let socketAddress: string | null = null;
  try {
    socketAddress = getConnInfo(c).remote.address ?? null;
  } catch {
    socketAddress = null;
  }
  return resolveClientIp({
    forwardedFor: c.req.raw.headers.get("x-forwarded-for"),
    socketAddress,
    trustDepth: trustProxyDepth(),
  });
}

export type EnforceApiKeyRequestOptions = {
  /** Reads `feature.mcp` for the instance; supplied by the caller (feature-flag owner). */
  mcpFeatureEnabled: () => Promise<boolean>;
  /** Optional test/config override; production reads the current persisted instance setting. */
  mcpWriteCeilingPerMinute?: number;
  /** Optional test/config override; production reads the current persisted instance setting. */
  apiKeyBurstThreshold?: number;
  /** A write that touches many items (MC-10); defaults from the route, not the caller. */
  bulk?: boolean;
};

/**
 * Called by the authentication layer after `verifyApiKey` succeeds. Throws the refusal,
 * otherwise records last-used time and IP (AK-5) and returns the key's kind so the caller can
 * set `is_mcp` / service facts on the request context.
 */
export async function enforceApiKeyRequest(
  c: Context,
  keyId: string,
  options: EnforceApiKeyRequestOptions,
): Promise<ApiKeyKind> {
  const key = await loadApiKeyKind(keyId);
  const clientIp = clientIpForContext(c);
  const decision = evaluateKeyRequest({
    key,
    clientIp,
    mcpFeatureEnabled: key.isMcp ? await options.mcpFeatureEnabled() : true,
  });
  if (!decision.ok)
    throw new HTTPException(decision.status, { message: decision.message });

  const requestClass: RateLimitClass = classifyRequest(c.req.method, {
    bulk: options.bulk,
    path: c.req.path,
  });
  let mcpWriteCeilingPerMinute = options.mcpWriteCeilingPerMinute;
  let apiKeyBurstThreshold = options.apiKeyBurstThreshold;
  if (
    key.isMcp &&
    requestClass !== "read" &&
    (mcpWriteCeilingPerMinute === undefined ||
      apiKeyBurstThreshold === undefined)
  ) {
    try {
      const [storedCeiling, storedBurstThreshold] = await Promise.all([
        mcpWriteCeilingPerMinute === undefined
          ? loadMcpWriteCeilingPerMinute()
          : Promise.resolve(mcpWriteCeilingPerMinute),
        apiKeyBurstThreshold === undefined
          ? loadApiKeyBurstThreshold()
          : Promise.resolve(apiKeyBurstThreshold),
      ]);
      mcpWriteCeilingPerMinute = storedCeiling;
      apiKeyBurstThreshold = storedBurstThreshold;
    } catch {
      throw new HTTPException(503, { message: "rate_limit_unavailable" });
    }
  }
  let rate: SharedRateLimitDecision;
  try {
    rate = await consumeApiKeyRateLimit({
      apiKeyId: keyId,
      isMcp: key.isMcp,
      keyLimitPerMinute: key.rateLimitPerMinute,
      ...(mcpWriteCeilingPerMinute === undefined
        ? {}
        : { mcpWriteCeilingPerMinute }),
      ...(apiKeyBurstThreshold === undefined ? {} : { apiKeyBurstThreshold }),
      requestClass,
    });
  } catch {
    throw new HTTPException(503, { message: "rate_limit_unavailable" });
  }
  if (!rate.allowed) {
    if ("disabled" in rate)
      throw new HTTPException(401, { message: "Unauthorized" });
    c.header("Retry-After", String(rate.retryAfterSeconds));
    throw new HTTPException(429, {
      message: `rate_limited: this key may make ${rate.limit} ${requestClass} requests per minute; retry in ${rate.retryAfterSeconds}s`,
    });
  }

  await recordApiKeyUse(keyId, clientIp);
  return key;
}
