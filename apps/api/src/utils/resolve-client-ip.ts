/**
 * Trusted client-IP derivation.
 *
 * kaneo configured better-auth with:
 *
 *     ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"]
 *     trustedProxies: <CIDR list, defaulting to ALL of RFC1918 + loopback>
 *
 * Two things were wrong with that, and both let a caller choose the identity
 * the rate limiter keys on.
 *
 * 1. `cf-connecting-ip` was tried FIRST. It is a single-valued header with no
 *    positional structure, so nothing can validate it. TaskDesk is not behind
 *    Cloudflare; the header simply arrives from whoever set it. better-auth's
 *    resolver returns the first non-trusted address walking right-to-left, so
 *    a one-entry header is returned verbatim. `curl -H 'cf-connecting-ip: …'`
 *    picked the bucket, and rotating it per request defeated the limiter
 *    entirely.
 *
 * 2. Trusting a CIDR SET rather than a hop COUNT. On a shared cluster every
 *    pod is inside RFC1918, so any of them could forge the chain. And it is
 *    the wrong shape for this deployment anyway: measured on the real host,
 *    the chain is CloudFront → Traefik → TaskDesk, CloudFront APPENDS the
 *    viewer address to a viewer-supplied `X-Forwarded-For` rather than
 *    replacing it, and Traefik then appends CloudFront's edge address. So the
 *    header arriving at the application looks like:
 *
 *        [ …anything the caller invented…, realClient, cloudFrontEdge ]
 *
 *    Everything left of the trusted suffix is caller-controlled. The only
 *    sound rule is to count hops from the RIGHT, which is exactly what
 *    `TASKDESK_TRUST_PROXY` is documented to mean in
 *    configuration-reference.md: "Number of trusted reverse-proxy hops, not a
 *    boolean."
 *
 * This module implements that hop count, and nothing else reads a forwarding
 * header to identify a caller.
 */

/**
 * The header this module writes and better-auth reads. It is internal: any
 * inbound copy is stripped before it is set, so a caller can never supply it.
 */
export const TRUSTED_CLIENT_IP_HEADER = "x-taskdesk-client-ip";

export const DEFAULT_TRUST_PROXY_DEPTH = 1;

/**
 * Parses TASKDESK_TRUST_PROXY. Anything that is not a non-negative integer is
 * rejected rather than coerced — a typo must not silently become "trust
 * everything".
 */
export function parseTrustProxyDepth(
  raw: string | undefined,
): { ok: true; depth: number } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, depth: DEFAULT_TRUST_PROXY_DEPTH };
  }

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      reason: `TASKDESK_TRUST_PROXY must be a non-negative integer (number of trusted proxy hops), got: ${trimmed}`,
    };
  }

  return { ok: true, depth: Number.parseInt(trimmed, 10) };
}

function isPlausibleIp(value: string): boolean {
  if (value.length === 0 || value.length > 45) return false;
  // IPv4, or IPv6 in either bare or bracketed form. Deliberately permissive on
  // shape and strict on charset: this rejects hostnames, ports and injected
  // separators without reimplementing an address parser.
  return /^[0-9a-fA-F:.[\]]+$/.test(value) && /[0-9a-fA-F]/.test(value);
}

function normalise(value: string): string {
  let ip = value.trim();
  // Strip an IPv6 bracket form, with or without a port: "[::1]:443" -> "::1".
  const bracketed = ip.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed?.[1]) return bracketed[1];
  // "::ffff:203.0.113.9" is an IPv4-mapped IPv6 address; use the IPv4 form so
  // the same client cannot occupy two different rate-limit buckets.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1]) return mapped[1];
  // A bare "host:port" for IPv4 only — an IPv6 address has many colons.
  if ((ip.match(/:/g) ?? []).length === 1 && ip.includes(".")) {
    ip = ip.split(":")[0] ?? ip;
  }
  return ip;
}

export type ResolveClientIpInput = {
  /** Raw `X-Forwarded-For`, exactly as received. */
  forwardedFor: string | null | undefined;
  /** The TCP peer address, when the runtime exposes it. */
  socketAddress: string | null | undefined;
  /** Number of trusted reverse-proxy hops. */
  trustDepth: number;
};

/**
 * Resolves the client address to attribute a request to.
 *
 * Returns null when no address can be trusted. A null is NOT a failure to be
 * papered over: the caller must treat it as "unattributable" and fall back to
 * a shared bucket, which throttles everyone rather than nobody.
 */
export function resolveClientIp(input: ResolveClientIpInput): string | null {
  const { forwardedFor, socketAddress, trustDepth } = input;

  // depth 0: no proxy is trusted, so no forwarding header is consulted at all.
  if (trustDepth <= 0) {
    if (!socketAddress) return null;
    const peer = normalise(socketAddress);
    return isPlausibleIp(peer) ? peer : null;
  }

  const chain = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // Fewer hops than configured means the request did not traverse the proxies
  // we were told about — a direct connection to the app port, or a
  // misconfiguration. Fail CLOSED to the peer rather than believing a chain
  // that is shorter than it should be.
  if (chain.length < trustDepth) {
    if (!socketAddress) return null;
    const peer = normalise(socketAddress);
    return isPlausibleIp(peer) ? peer : null;
  }

  // The rightmost `trustDepth` entries were appended by proxies we trust. The
  // entry immediately left of them was appended by the outermost trusted proxy
  // and is therefore the address IT observed — the client. Anything further
  // left is caller-supplied and is ignored entirely.
  const candidate = chain[chain.length - trustDepth];
  if (!candidate) return null;

  const ip = normalise(candidate);
  return isPlausibleIp(ip) ? ip : null;
}
