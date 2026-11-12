import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import { rejectNulByte } from "./reject-nul-byte";
import { assertCallerHasCapability } from "./require-workspace-capability";

/**
 * Admission gate for invitation link copy endpoints (`member:invite` at request time —
 * owner decision D-N, contract CP-23). A caller who does not currently hold `member:invite`
 * in the workspace always receives `403` without revealing whether the invitation or
 * organisation exists.
 */
export function requireInvitationCopyAccess(options: {
  scope: "customer" | "staff";
  idParam: string;
}) {
  return async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    const workspaceId = c.get("workspaceId") as string | undefined;
    const userId = c.get("userId") as string | undefined;
    const invitationId = c.req.param(options.idParam);
    const organisationId =
      options.scope === "customer" ? c.req.param("organisationId") : undefined;

    if (!workspaceId || !userId || !invitationId) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    rejectNulByte(invitationId, "Invitation id");
    if (organisationId !== undefined) {
      rejectNulByte(organisationId, "Organisation id");
    }

    try {
      await assertCallerHasCapability(workspaceId, userId, "member:invite", {
        kind: "session",
      });
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        setShadowLegacyAuthorization(c, "denied");
      }
      throw error;
    }

    setShadowLegacyAuthorization(c, "allowed");
    return next();
  };
}
