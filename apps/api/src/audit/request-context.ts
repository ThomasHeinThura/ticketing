import type { Context } from "hono";
import { clientIpForContext } from "../api-key/enforce";
import { policyRequestId } from "../permissions/shadow-context";

/**
 * The request facts an audit row records beside the actor (`data-model.md` S11): the trusted-proxy
 * client address (`clientIpForContext`, the same helper the API-key and webhook audit rows use),
 * the user agent, the server-generated request id (`traceId`, never an inbound header) and the
 * authenticated API key, if any. Built once at the route and handed to the write path.
 */
export type AuditRequestContext = {
  actorIp: string | null;
  userAgent: string | null;
  traceId: string | null;
  apiKeyId: string | null;
};

const MAX_USER_AGENT = 512;

export function auditRequestContext(c: Context): AuditRequestContext {
  const apiKey = c.get("apiKey") as { id?: string } | undefined;
  const userAgent = c.req.header("user-agent");
  return {
    actorIp: clientIpForContext(c),
    userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT) : null,
    traceId: policyRequestId(c),
    apiKeyId: apiKey?.id ?? null,
  };
}
