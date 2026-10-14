import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { markReach } from "../utils/reach-mark";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { checkWebSocketOrigin } from "./origin-policy";
import {
  authorizeProjectSocketRead,
  type ProjectSocketCredential,
} from "./project-read-authorization";

/** The socket credential the legacy route holds for this request (session or API key). */
export function legacySocketCredential(
  c: Context,
  userId: string,
): ProjectSocketCredential {
  const apiKey = c.get("apiKey") as
    | {
        id?: string;
        userId?: string;
        enabled?: boolean;
        permissions?: Record<string, string[]> | null;
      }
    | undefined;
  const session = c.get("session") as
    | { impersonatedBy?: string | null }
    | null
    | undefined;
  return {
    userId,
    apiKeyId: apiKey?.id,
    apiKeyEnabled: apiKey?.enabled,
    apiKeyOwnerUserId: apiKey?.userId,
    apiKeyPermissions: apiKey?.permissions,
    impersonated: Boolean(session?.impersonatedBy),
  };
}

/**
 * Whether the caller may hold a legacy project subscription (`/api/ws/{projectId}`) for this
 * project. The decision is `authorizeProjectSocketRead`, the same function the native socket's
 * `project:{id}` topic uses (#748): project reach, the `project:read` capability, API-key
 * scope, the project's own customer organisation and the archived/deleted exclusions.
 *
 * Every refusal returns `false`; callers must answer all of them identically. Used at upgrade
 * time and again on every re-authorisation, so a socket cannot outlive what it was opened with.
 */
export async function callerReachesLegacySocketProject(
  c: Context,
  userId: string,
  projectId: string,
): Promise<boolean> {
  return (
    (await authorizeProjectSocketRead(
      legacySocketCredential(c, userId),
      projectId,
    )) !== null
  );
}

/**
 * Upgrade-time gate for `GET /api/ws/{projectId}`: the origin policy, then PROJECT reach.
 * Origin is decided first, so a foreign page cannot use the status to learn what a victim
 * reaches. A project the caller cannot reach, one in another workspace and an unknown one all
 * answer the same 401 before any upgrade, so no subscription is created for any of them.
 * The reach mark is what the route guard requires of a delegated project socket route.
 */
export const requireLegacySocketProjectReach = markReach(
  async (c: Context, next: Next) => {
    const session = c.get("session") as { portal?: unknown } | null | undefined;
    const origin = checkWebSocketOrigin({
      host: c.req.header("Host") ?? null,
      origin: c.req.header("Origin") ?? null,
      sessionPortal: session?.portal,
      hasSession: c.get("session") !== null,
    });
    if (!origin.allowed) {
      throw new HTTPException(origin.status, { message: "Forbidden" });
    }
    const projectId = c.req.param("projectId") ?? "";
    // #281 sweep: this id reaches a raw `eq(projectTable.id, ...)` query, unvalidated -- a NUL
    // byte would otherwise 500 instead of a clean 400.
    rejectNulByte(projectId, "Project id");
    // #317 S1/S4: existence and reach are one lookup, so a foreign project and an unknown one
    // cost the same single project-table round trip.
    if (
      !(await callerReachesLegacySocketProject(c, c.get("userId"), projectId))
    ) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    await next();
  },
  { projectReach: true, resources: ["project"] },
);
