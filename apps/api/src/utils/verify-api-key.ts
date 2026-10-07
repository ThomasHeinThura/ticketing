import { createHash } from "node:crypto";
import { getEnabledApiKeyByHash } from "./repository";
import { parseApiKeyPermissionScope } from "./require-api-key-permission-scope";

async function hashApiKey(key: string): Promise<string> {
  const hash = createHash("sha256").update(key).digest();
  return hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function verifyApiKey(key: string) {
  const hashedKey = await hashApiKey(key);

  const [apiKey] = await getEnabledApiKeyByHash(hashedKey, new Date());

  if (!apiKey) {
    return null;
  }

  return {
    valid: true,
    key: {
      id: apiKey.id,
      userId: apiKey.referenceId ?? apiKey.userId ?? "",
      name: apiKey.name,
      prefix: apiKey.prefix,
      start: apiKey.start,
      enabled: apiKey.enabled ?? false,
      expiresAt: apiKey.expiresAt,
      permissions: parseApiKeyPermissionScope(apiKey.permissions).permissions,
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
