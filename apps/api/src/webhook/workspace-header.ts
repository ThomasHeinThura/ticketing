import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

/**
 * Resolves the workspace for `scopeSource: "request"` routes whose workspace travels in the
 * `X-Workspace-Id` header (`feature-contracts-p4.md` webhook API). The shared
 * `workspaceAccess.*` helpers read a query, body or path value only, so this is the header
 * counterpart: the same `validateWorkspaceAccess` membership and key check, and the same context
 * variables, with no fallback to any other caller-supplied location.
 */
export async function workspaceFromHeader(c: Context, next: Next) {
  markShadowLegacyAuthorizationUnknown(c);
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const raw = c.req.header("x-workspace-id");
  if (!raw || raw.trim() === "") {
    throw new HTTPException(400, {
      message: "X-Workspace-Id header is required",
    });
  }
  rejectNulByte(raw, "X-Workspace-Id");
  try {
    await validateWorkspaceAccess(userId, raw, c.get("apiKey")?.id);
    setShadowLegacyAuthorization(c, "allowed");
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      setShadowLegacyAuthorization(c, "denied");
    }
    throw error;
  }
  c.set("workspaceId", raw);
  c.set("workspaceIdSource", "request");
  await next();
}
