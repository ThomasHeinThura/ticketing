import { createPublicKey, verify } from "node:crypto";

const MAX_TOKEN_BYTES = 32_768;
const CLOCK_SKEW_SECONDS = 60;

export type EntraIdTokenExpectation = {
  issuer: string;
  tenantId: string;
  clientId: string;
  nonce: string;
  nowSeconds?: number;
};

export type EntraIdTokenResult =
  | { ok: true; claims: Record<string, unknown> }
  | {
      ok: false;
      reason:
        | "malformed_token"
        | "unsupported_algorithm"
        | "unknown_signing_key"
        | "invalid_signature"
        | "issuer_mismatch"
        | "audience_mismatch"
        | "tenant_mismatch"
        | "nonce_mismatch"
        | "expired"
        | "not_yet_valid";
    };

function decodeSegment(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/u.test(segment)) throw new Error("invalid");
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.length > MAX_TOKEN_BYTES) throw new Error("invalid");
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/** Validate the Entra RS256 ID-token protocol floor before any claim is consumed. */
export function validateEntraIdToken(
  token: string,
  jwks: unknown,
  expectation: EntraIdTokenExpectation,
): EntraIdTokenResult {
  if (
    typeof token !== "string" ||
    Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES
  )
    return { ok: false, reason: "malformed_token" };
  const segments = token.split(".");
  if (segments.length !== 3) return { ok: false, reason: "malformed_token" };
  let header: unknown;
  let claims: unknown;
  let signature: Buffer;
  try {
    header = decodeSegment(segments[0] ?? "");
    claims = decodeSegment(segments[1] ?? "");
    signature = Buffer.from(segments[2] ?? "", "base64url");
  } catch {
    return { ok: false, reason: "malformed_token" };
  }
  if (!record(header) || !record(claims))
    return { ok: false, reason: "malformed_token" };
  if (header.alg !== "RS256" || typeof header.kid !== "string")
    return { ok: false, reason: "unsupported_algorithm" };
  if (!record(jwks) || !Array.isArray(jwks.keys))
    return { ok: false, reason: "unknown_signing_key" };
  const key = jwks.keys.find(
    (candidate) =>
      record(candidate) &&
      candidate.kid === header.kid &&
      candidate.kty === "RSA" &&
      candidate.use === "sig" &&
      candidate.alg === "RS256",
  );
  if (!record(key)) return { ok: false, reason: "unknown_signing_key" };
  let signatureValid = false;
  try {
    const publicKey = createPublicKey({ key, format: "jwk" });
    signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(`${segments[0]}.${segments[1]}`, "ascii"),
      publicKey,
      signature,
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, reason: "invalid_signature" };

  if (claims.iss !== expectation.issuer)
    return { ok: false, reason: "issuer_mismatch" };
  const audience = claims.aud;
  if (
    !(
      audience === expectation.clientId ||
      (Array.isArray(audience) && audience.includes(expectation.clientId))
    )
  )
    return { ok: false, reason: "audience_mismatch" };
  if (claims.tid !== expectation.tenantId)
    return { ok: false, reason: "tenant_mismatch" };
  if (claims.nonce !== expectation.nonce)
    return { ok: false, reason: "nonce_mismatch" };
  const now = expectation.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now - CLOCK_SKEW_SECONDS)
    return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf > now + CLOCK_SKEW_SECONDS)
    return { ok: false, reason: "not_yet_valid" };
  return { ok: true, claims };
}
