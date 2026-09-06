import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import {
  parseTrustProxyDepth,
  resolveClientIp,
  TRUSTED_CLIENT_IP_HEADER,
} from "./resolve-client-ip";

/**
 * Every request handed to better-auth goes through here first.
 *
 * better-auth identifies a caller by reading a header name from a configured
 * list. That is only safe if the header it reads cannot be set by the caller,
 * so this normalises the request: it STRIPS any inbound copy of the internal
 * header and then sets it to the address resolved by hop count.
 *
 * The strip is the important half. Without it, `curl -H
 * 'x-taskdesk-client-ip: 1.2.3.4'` would choose its own rate-limit bucket —
 * the exact defect being fixed, just with a different header name.
 */
const trustDepthResult = parseTrustProxyDepth(process.env.TASKDESK_TRUST_PROXY);

if (!trustDepthResult.ok) {
  console.error(trustDepthResult.reason);
  process.exit(1);
}

const TRUST_DEPTH = trustDepthResult.depth;

export function trustProxyDepth(): number {
  return TRUST_DEPTH;
}

/**
 * Builds the Request better-auth should see, with a trustworthy client address.
 *
 * @param extraHeaders optional headers to merge in (one call site rewrites a
 *        bearer token into `x-api-key`); the internal IP header always wins.
 */
export function buildAuthRequest(c: Context, extraHeaders?: Headers): Request {
  const headers = new Headers(extraHeaders ?? c.req.raw.headers);

  // Never let an inbound value survive, under any casing.
  headers.delete(TRUSTED_CLIENT_IP_HEADER);

  let socketAddress: string | null = null;
  try {
    socketAddress = getConnInfo(c).remote.address ?? null;
  } catch {
    // Some runtimes (and the integration harness, which calls app.request
    // directly) expose no socket. That is not an error: resolveClientIp
    // handles a null peer and returns null rather than inventing an address.
    socketAddress = null;
  }

  const clientIp = resolveClientIp({
    forwardedFor: c.req.raw.headers.get("x-forwarded-for"),
    socketAddress,
    trustDepth: TRUST_DEPTH,
  });

  if (clientIp) {
    headers.set(TRUSTED_CLIENT_IP_HEADER, clientIp);
  }

  return new Request(c.req.raw, { headers });
}
