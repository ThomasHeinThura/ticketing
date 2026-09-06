import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUST_PROXY_DEPTH,
  parseTrustProxyDepth,
  resolveClientIp,
} from "../../../apps/api/src/utils/resolve-client-ip";

/**
 * Spoofing guards for the rate-limit identity.
 *
 * kaneo trusted `cf-connecting-ip` first and matched a CIDR SET rather than
 * counting hops, so a caller could choose the address the limiter keys on and
 * rotate it per request. These tests exist so that can never come back.
 *
 * The chain shape is taken from measurement on the real host, not from a
 * diagram: CloudFront appends the viewer address to a viewer-supplied
 * X-Forwarded-For (it does not replace it), then Traefik appends CloudFront's
 * edge address. So the application receives
 *
 *     [ …caller-supplied…, realClient, cloudFrontEdge ]
 *
 * with two trusted hops.
 */
const CLOUDFRONT_EDGE = "15.158.222.75";
const REAL_CLIENT = "47.131.106.150";
const PEER = "10.0.1.69";

describe("resolveClientIp", () => {
  describe("the measured CloudFront -> Traefik -> TaskDesk chain (depth 2)", () => {
    it("selects the client the outermost trusted proxy observed", () => {
      const ip = resolveClientIp({
        forwardedFor: `${REAL_CLIENT}, ${CLOUDFRONT_EDGE}`,
        socketAddress: PEER,
        trustDepth: 2,
      });

      expect(ip).toBe(REAL_CLIENT);
    });

    it("IGNORES an address the caller prepended", () => {
      const ip = resolveClientIp({
        forwardedFor: `203.0.113.99, ${REAL_CLIENT}, ${CLOUDFRONT_EDGE}`,
        socketAddress: PEER,
        trustDepth: 2,
      });

      expect(ip).toBe(REAL_CLIENT);
      expect(ip).not.toBe("203.0.113.99");
    });

    it("ignores an arbitrarily long forged prefix, so the key cannot be rotated", () => {
      const forged = Array.from({ length: 50 }, (_, i) => `198.51.100.${i}`);
      const seen = new Set<string | null>();

      for (const _ of forged) {
        seen.add(
          resolveClientIp({
            forwardedFor: `${forged.join(", ")}, ${REAL_CLIENT}, ${CLOUDFRONT_EDGE}`,
            socketAddress: PEER,
            trustDepth: 2,
          }),
        );
      }

      // One stable bucket, no matter what the caller sends.
      expect([...seen]).toEqual([REAL_CLIENT]);
    });
  });

  describe("failing closed", () => {
    it("falls back to the peer when the chain is SHORTER than the configured depth", () => {
      // A direct hit on the app port, or a misconfigured proxy count. Believing
      // a too-short chain would mean believing the caller.
      const ip = resolveClientIp({
        forwardedFor: "203.0.113.99",
        socketAddress: PEER,
        trustDepth: 2,
      });

      expect(ip).toBe(PEER);
    });

    it("ignores forwarding headers entirely at depth 0", () => {
      const ip = resolveClientIp({
        forwardedFor: `203.0.113.99, ${REAL_CLIENT}, ${CLOUDFRONT_EDGE}`,
        socketAddress: PEER,
        trustDepth: 0,
      });

      expect(ip).toBe(PEER);
    });

    it("returns null rather than a guess when there is no header and no peer", () => {
      expect(
        resolveClientIp({
          forwardedFor: null,
          socketAddress: null,
          trustDepth: 1,
        }),
      ).toBeNull();
    });

    it("rejects a non-address value instead of using it as a key", () => {
      expect(
        resolveClientIp({
          forwardedFor: "not-an-ip, evil.example",
          socketAddress: null,
          trustDepth: 1,
        }),
      ).toBeNull();
    });
  });

  describe("normalisation, so one client cannot occupy two buckets", () => {
    it("folds an IPv4-mapped IPv6 address to its IPv4 form", () => {
      expect(
        resolveClientIp({
          forwardedFor: `::ffff:${REAL_CLIENT}`,
          socketAddress: null,
          trustDepth: 1,
        }),
      ).toBe(REAL_CLIENT);
    });

    it("strips brackets and a port from an IPv6 peer", () => {
      expect(
        resolveClientIp({
          forwardedFor: null,
          socketAddress: "[2001:db8::1]:44321",
          trustDepth: 0,
        }),
      ).toBe("2001:db8::1");
    });

    it("strips a port from an IPv4 peer", () => {
      expect(
        resolveClientIp({
          forwardedFor: null,
          socketAddress: `${PEER}:44321`,
          trustDepth: 0,
        }),
      ).toBe(PEER);
    });
  });

  describe("depth 1 — the shipped compose, Traefik directly in front", () => {
    it("takes the entry Traefik appended, not one the caller prepended", () => {
      const ip = resolveClientIp({
        forwardedFor: `203.0.113.99, ${REAL_CLIENT}`,
        socketAddress: PEER,
        trustDepth: 1,
      });

      expect(ip).toBe(REAL_CLIENT);
    });
  });
});

describe("parseTrustProxyDepth", () => {
  it("defaults to one hop when unset", () => {
    expect(parseTrustProxyDepth(undefined)).toEqual({
      ok: true,
      depth: DEFAULT_TRUST_PROXY_DEPTH,
    });
    expect(parseTrustProxyDepth("  ")).toEqual({
      ok: true,
      depth: DEFAULT_TRUST_PROXY_DEPTH,
    });
  });

  it("accepts an explicit hop count, including zero", () => {
    expect(parseTrustProxyDepth("0")).toEqual({ ok: true, depth: 0 });
    expect(parseTrustProxyDepth("2")).toEqual({ ok: true, depth: 2 });
  });

  it("REFUSES a boolean-ish value rather than coercing it", () => {
    // "true" used to be a plausible thing to write here. Coercing it to 1 —
    // or worse to "trust everything" — is how a typo becomes a vulnerability.
    for (const bad of ["true", "false", "yes", "-1", "1.5", "one"]) {
      const result = parseTrustProxyDepth(bad);
      expect(result.ok).toBe(false);
    }
  });
});
