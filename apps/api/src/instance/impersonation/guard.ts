import { normaliseRouteKey } from "@taskdesk/permissions";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { IMPERSONATION_SESSION_SECONDS } from "../../auth/impersonation-context";
import { attributedRoutesToClassify } from "../../permissions/shadow-middleware";
import { policyRegistry } from "../../policy-registry";
import { impersonatorStillEligible } from "./eligibility";
import { finishImpersonation } from "./finish";

/** The one route an impersonation session may always call (`GM-11`). */
export const IMPERSONATION_EXIT_ROUTE = "DELETE /api/instance/impersonate";

const APPROVAL_DECISION = [
  /^POST \/api\/approvals\/\{[^/]+\}\/decide$/u,
  /^POST \/api\/portal\/approvals\/\{[^/]+\}\/decide$/u,
  /^POST \/api\/me\/pending-actions\/\{[^/]+\}\/(approve|deny|cancel)$/u,
];
/**
 * `GM-9`, default-deny. An impersonation session may write only the ordinary day-to-day work of
 * the person it impersonates: work items, comments, attachments, time, relations and the
 * person's own notification state. Every other mutating route is closed, whatever it is called,
 * so a route added later (a team, a role, a key, a workflow publish) is refused until someone
 * decides it is ordinary work and lists it here. Reads are not restricted by this list.
 */
const ORDINARY_WRITE = [
  /^[A-Z]+ \/api\/(v2\/)?work-items\//u,
  /^POST \/api\/projects\/\{[^/]+\}\/work-items$/u,
  /^[A-Z]+ \/api\/(v2\/)?task\//u,
  /^POST \/api\/task-relation$/u,
  /^[A-Z]+ \/api\/comments?\//u,
  /^POST \/api\/activity\/(comment|create)$/u,
  /^PUT \/api\/activity\/comment$/u,
  /^POST \/api\/attachments\/\{[^/]+\}\/complete$/u,
  /^POST \/api\/time-entry(\/|$)/u,
  /^PUT \/api\/time-entry\/\{[^/]+\}$/u,
  /^(POST|PATCH) \/api\/time-entries(\/|$)/u,
  /^PUT \/api\/label\/\{[^/]+\}\/task$/u,
  /^PATCH \/api\/notification\/(read-all|\{[^/]+\}\/(read|unread))$/u,
  /^POST \/api\/views\/\{[^/]+\}\/run$/u,
];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `GM-9`: why a registered route is closed to an impersonation session, or `null` when the
 * route is an ordinary read or write. Pure, so the full matrix is unit-testable.
 */
export function impersonationRefusal(
  routeKey: string,
  elevated: boolean,
): string | null {
  if (routeKey === IMPERSONATION_EXIT_ROUTE) return null;
  const separator = routeKey.indexOf(" ");
  const method = routeKey.slice(0, separator);
  const path = routeKey.slice(separator + 1);
  if (elevated) return "elevated actions";
  if (method === "DELETE") return "deletions";
  if (APPROVAL_DECISION.some((pattern) => pattern.test(routeKey)))
    return "approval and deletion decisions";
  if (/(^|[/-])exports?(\/|$)/u.test(path)) return "data export";
  if (path.startsWith("/api/instance/") && MUTATING.has(method))
    return "instance administration";
  if (MUTATING.has(method) && !ORDINARY_WRITE.some((p) => p.test(routeKey)))
    return "creating or changing anything but ordinary work";
  return null;
}

function refuse(what: string): never {
  throw new HTTPException(403, {
    message: `impersonation: ${what} is not allowed during an impersonation session`,
  });
}

/**
 * `GM-9`/`GM-7`, mounted once in the app-wide auth guard so every route, including routes owned
 * by other features, is covered without each declaring it. Applies only to a session carrying
 * `impersonatedBy`. Also enforces the 30-minute cap from the session's creation time, as
 * defence in depth over the session's own expiry.
 */
export async function enforceImpersonationRestrictions(
  c: Context,
): Promise<void> {
  const session = c.get("session") as {
    id?: string;
    userId?: string;
    impersonatedBy?: string | null;
    createdAt?: Date | string;
  } | null;
  if (!session?.impersonatedBy) return;

  const createdAt = session.createdAt ? new Date(session.createdAt) : null;
  if (
    createdAt &&
    Date.now() - createdAt.getTime() >
      (IMPERSONATION_SESSION_SECONDS + 5) * 1000 &&
    session.id &&
    session.userId
  ) {
    await finishImpersonation({
      sessionId: session.id,
      targetUserId: session.userId,
      impersonatorUserId: session.impersonatedBy,
      endReason: "cap",
    });
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  for (const matched of attributedRoutesToClassify(c)) {
    let routeKey: string;
    try {
      routeKey = normaliseRouteKey(`${matched.method} ${matched.path}`);
    } catch {
      refuse("this route");
    }
    const entry = policyRegistry.get(routeKey) as
      | { policy?: { elevated?: boolean } }
      | undefined;
    const refusal = impersonationRefusal(
      routeKey,
      entry?.policy?.elevated === true,
    );
    if (refusal) refuse(refusal);
  }

  // P4R1-M3: the session is only as good as the administrator behind it. Re-checked on every
  // request the GM-9 rules above would serve, fail closed; a suspended or demoted
  // administrator's session ends here. A route GM-9 refuses is refused (403) either way.
  if (!(await impersonatorStillEligible(session.impersonatedBy))) {
    if (session.id && session.userId) {
      await finishImpersonation({
        sessionId: session.id,
        targetUserId: session.userId,
        impersonatorUserId: session.impersonatedBy,
        endReason: "impersonator_ineligible",
      }).catch(() => undefined);
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  }
}

/** Better Auth endpoints an impersonation session may still call (sign-out only). */
export function impersonationMayCallAuthEndpoint(
  method: string,
  path: string,
): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return true;
  return path === "/api/auth/sign-out";
}
