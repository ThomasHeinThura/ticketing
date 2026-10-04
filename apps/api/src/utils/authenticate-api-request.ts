import { APIError } from "better-auth/api";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { authForHost, portalForHost } from "../auth";
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
    if (result?.session && result.session.portal !== portal) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    return result;
  } catch (error) {
    if (isAuthRejection(error)) {
      return null;
    }
    throw error;
  }
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

export async function authenticateApiRequest(c: Context): Promise<void> {
  const authorization = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("x-api-key");
  const { token } = parseBearerToken(authorization);
  if (hasInvalidExplicitCredential(authorization, apiKeyHeader)) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const normalizedApiKey = apiKeyHeader?.trim();
  if (!token && normalizedApiKey) {
    const apiKeyResult = await verifyApiKey(normalizedApiKey);
    if (!apiKeyResult?.valid || !apiKeyResult.key) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    const key = apiKeyResult.key;
    c.set("userId", key.userId);
    c.set("userEmail", "");
    c.set("user", null);
    c.set("session", null);
    c.set("apiKey", {
      id: key.id,
      userId: key.userId,
      enabled: key.enabled,
      permissions: key.permissions,
    });
    return;
  }

  if (token) {
    const apiKeyResult = await verifyApiKey(token);
    if (apiKeyResult?.valid && apiKeyResult.key) {
      const key = apiKeyResult.key;
      c.set("userId", key.userId);
      c.set("userEmail", "");
      c.set("user", null);
      c.set("session", null);
      c.set("apiKey", {
        id: key.id,
        userId: key.userId,
        enabled: key.enabled,
        permissions: key.permissions,
      });
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
    const apiKeyResult = await verifyApiKey(apiKeyHeader);
    if (apiKeyResult?.valid && apiKeyResult.key) {
      return {
        userId: apiKeyResult.key.userId,
        apiKeyId: apiKeyResult.key.id,
      };
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  if (token) {
    const apiKeyResult = await verifyApiKey(token);
    if (apiKeyResult?.valid && apiKeyResult.key) {
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
