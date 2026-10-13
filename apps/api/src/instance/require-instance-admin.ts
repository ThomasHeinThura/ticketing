import {
  evaluatePolicy,
  instanceScope,
  NO_SINGLE_RESOURCE,
  normaliseRouteKey,
} from "@taskdesk/permissions";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import { isCurrentInstanceAdmin } from "./observability/audit-failure-notifier";

/**
 * Confirms current instance-admin status and applies the registered route policy to the
 * credential that actually authenticated this request. In particular, key credentials
 * remain clamped by `resolveIdentity`'s capability subset; owner role alone never grants
 * the key additional authority.
 */
export async function requireCurrentInstanceAdmin(
  c: Context,
  method: "GET" | "PATCH" | "POST",
  path: string,
): Promise<void> {
  const userId = c.get("userId") as string | undefined;
  if (!userId || !(await isCurrentInstanceAdmin(userId))) {
    throw new HTTPException(403, { message: "Forbidden" });
  }

  const apiKey = c.get("apiKey") as
    | {
        readonly id: string;
        readonly userId: string;
        readonly enabled: boolean;
      }
    | undefined;
  const session = c.get("session") as
    | { readonly impersonatedBy?: string | null }
    | null
    | undefined;
  if (session?.impersonatedBy) {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  const identity = await resolveIdentity({
    userId,
    credential: apiKey ? "api_key" : "session",
    apiKey: apiKey
      ? { enabled: apiKey.enabled, ownerUserId: apiKey.userId }
      : undefined,
  });
  const entry = policyRegistry.get(normaliseRouteKey(`${method} ${path}`));
  if (!entry || entry.kind !== "capability") {
    throw new HTTPException(403, { message: "Forbidden" });
  }
  const decision = evaluatePolicy(entry.policy, {
    identity,
    target: {},
    scope: instanceScope(),
    inReach: NO_SINGLE_RESOURCE,
  });
  if (!decision.allowed) {
    throw new HTTPException(403, { message: "Forbidden" });
  }
}
