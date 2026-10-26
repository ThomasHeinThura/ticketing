import { APIError } from "better-auth/api";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiKeyKind } from "../api-key/credential";
import { clientIpForContext, enforceApiKeyRequest } from "../api-key/enforce";
import { loadApiKeyKind } from "../api-key/repository";
import { authForHost, hasCustomerPortalIdentity, portalForHost } from "../auth";
import { mcpFeatureEnabled } from "./mcp-feature-enabled";
import { auditMcpRequest } from "./mcp-request-audit";
import { verifyApiKey } from "./verify-api-key";

function isAuthRejection(error: unknown) {
  if (!(error instanceof APIError)) {
    return false;
  }
  const status = typeof error.statusCode === "number" ? error.statusCode : 0;
  return status >= 400 && status < 500;
}

async function getSession(headers: Headers) {
  const auth = authForHost(headers.get("host"));
  const portal = portalForHost(headers.get("host"));
  if (!auth || !portal) return null;
  try {
    const result = await auth.api.getSession({ headers });
    if (
      result?.session &&
      (result.session.portal !== portal ||
        (portal === "customer" &&
          !(await hasCustomerPortalIdentity(result.user.id))))
    ) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    return result;
  } catch (error) {
    if (isAuthRejection(error)) {
      return null;
    }
    throw error;
  }
}

/** Optional cookie-only resolution for bounded public browser handoffs; explicit keys never substitute. */
export async function resolveOptionalCookieSession(headers: Headers) {
  const cookieHeaders = new Headers(headers);
  cookieHeaders.delete("authorization");
  cookieHeaders.delete("x-api-key");
  return getSession(cookieHeaders);
}

function parseBearerToken(authHeader: string | undefined): {
  token: string | null;
  malformed: boolean;
} {
  if (!authHeader) {
    return { token: null, malformed: false };
  }

  if (!authHeader.match(/^Bearer\b/i)) {
    return { token: null, malformed: false };
  }

  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return { token: null, malformed: true };
  }

  return {
    token: match[1] ?? null,
    malformed: false,
  };
}

export function hasInvalidExplicitCredential(
  authorization: string | undefined,
  apiKeyHeader: string | undefined,
): boolean {
  const { token, malformed } = parseBearerToken(authorization);
  return (
    (authorization !== undefined && (!token || malformed)) ||
    (apiKeyHeader !== undefined && !apiKeyHeader.trim())
  );
}

/**
 * Per-request key rules (disabled, IP allowlist, `feature.mcp`, rate limit, last-used) that
 * the `api_key` extension adds on top of "the key exists and its owner is active". Returns
 * the key's kind, from which the request context carries `is_mcp` and, for a workspace service
 * key (AK-7), the workspace and stored subset its principal is built from.
 */
async function enforceKeyRules(c: Context, keyId: string): Promise<ApiKeyKind> {
  return enforceApiKeyRequest(c, keyId, { mcpFeatureEnabled });
}

/** Audit only after the bearer was verified and its stored kind was loaded. */
async function enforceVerifiedApiKey(
  c: Context,
  key: { id: string; userId: string },
): Promise<ApiKeyKind> {
  const kind = await loadApiKeyKind(key.id);
  if (kind.isMcp)
    await auditMcpRequest({ apiKeyId: key.id, ownerUserId: key.userId });
  return enforceKeyRules(c, key.id);
}

function setApiKeyContext(
  c: Context,
  key: {
    id: string;
    userId: string;
    enabled: boolean;
    permissions: Record<string, string[]> | null;
  },
  kind: ApiKeyKind,
) {
  c.set("userId", key.userId);
  c.set("userEmail", "");
  c.set("user", null);
  c.set("session", null);
  c.set("apiKey", {
    id: key.id,
    userId: key.userId,
    enabled: key.enabled,
    permissions: key.permissions,
    isMcp: kind.isMcp,
    // AK-7: a service key has no person; it is evaluated against its own stored subset in its
    // own workspace. A key row that claims `service` without a workspace is not a principal.
    ...(kind.kind === "service" && kind.workspaceId
      ? {
          service: {
            workspaceId: kind.workspaceId,
            capabilities: kind.capabilities,
          },
        }
      : {}),
  });
}

export async function authenticateApiRequest(c: Context): Promise<void> {
  const authorization = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("x-api-key");
  const { token } = parseBearerToken(authorization);
  if (hasInvalidExplicitCredential(authorization, apiKeyHeader)) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  if (
    portalForHost(c.req.header("host")) === "customer" &&
    (token !== null || apiKeyHeader !== undefined)
  ) {
    throw new HTTPException(403, { message: "session_required" });
  }

  const normalizedApiKey = apiKeyHeader?.trim();
  if (!token && normalizedApiKey) {
    const apiKeyResult = await verifyApiKey(normalizedApiKey, {
      clientIp: clientIpForContext(c),
    });
    if (!apiKeyResult?.valid || !apiKeyResult.key) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    const key = apiKeyResult.key;
    setApiKeyContext(c, key, await enforceVerifiedApiKey(c, key));
    return;
  }

  if (token) {
    const apiKeyResult = await verifyApiKey(token, {
      clientIp: clientIpForContext(c),
    });
    if (apiKeyResult?.valid && apiKeyResult.key) {
      const key = apiKeyResult.key;
      setApiKeyContext(c, key, await enforceVerifiedApiKey(c, key));
      return;
    }
    // The pinned Better Auth stack does not accept bearer session tokens here.
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const sessionResult = await getSession(c.req.raw.headers);
  c.set("user", sessionResult?.user ?? null);
  c.set("session", sessionResult?.session ?? null);
  c.set("userId", sessionResult?.user?.id ?? "");
  c.set("userEmail", sessionResult?.user?.email ?? "");

  if (!sessionResult?.user) {
    if (
      c.req.path === "/api/portal/submissions" ||
      c.req.path.startsWith("/api/portal/submissions/")
    ) {
      throw new HTTPException(404, { message: "Not found" });
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  }
}

export async function resolveAssetBearerOrCookie(c: Context): Promise<{
  userId: string;
  apiKeyId?: string;
}> {
  const authorization = c.req.header("Authorization");
  const apiKeyHeaderValue = c.req.header("x-api-key");
  const { token } = parseBearerToken(authorization);
  if (hasInvalidExplicitCredential(authorization, apiKeyHeaderValue)) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const apiKeyHeader = apiKeyHeaderValue?.trim();
  if (!token && apiKeyHeader) {
    const apiKeyResult = await verifyApiKey(apiKeyHeader, {
      clientIp: clientIpForContext(c),
    });
    if (apiKeyResult?.valid && apiKeyResult.key) {
      await enforceVerifiedApiKey(c, apiKeyResult.key);
      return {
        userId: apiKeyResult.key.userId,
        apiKeyId: apiKeyResult.key.id,
      };
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  if (token) {
    const apiKeyResult = await verifyApiKey(token, {
      clientIp: clientIpForContext(c),
    });
    if (apiKeyResult?.valid && apiKeyResult.key) {
      await enforceVerifiedApiKey(c, apiKeyResult.key);
      return {
        userId: apiKeyResult.key.userId,
        apiKeyId: apiKeyResult.key.id,
      };
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const sessionResult = await getSession(c.req.raw.headers);
  if (!sessionResult?.user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  return { userId: sessionResult.user.id };
}
