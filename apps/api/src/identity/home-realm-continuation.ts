import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const HOME_REALM_CONTINUATION_COOKIE =
  "__Host-tdk_home_realm_continuation";
export const HOME_REALM_CONTINUATION_TTL_SECONDS = 120;

const AAD = Buffer.from("taskdesk:portal:home-realm:v1", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type HomeRealmContinuation = {
  connectionId: string;
  domain: string;
  invitationId?: string;
  expiresAt: number;
};

function encryptionKey(): Buffer {
  const value = process.env.TASKDESK_ENCRYPTION_KEY?.trim();
  if (!value || !/^[a-f0-9]{64}$/iu.test(value))
    throw new Error("Configured encryption key is unavailable");
  return Buffer.from(value, "hex");
}

function validPayload(value: unknown): value is HomeRealmContinuation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === 1 &&
    typeof payload.connectionId === "string" &&
    payload.connectionId.length > 0 &&
    payload.connectionId.length <= 128 &&
    typeof payload.domain === "string" &&
    payload.domain.length <= 253 &&
    (payload.invitationId === undefined ||
      (typeof payload.invitationId === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/u.test(payload.invitationId))) &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(
      payload.domain,
    ) &&
    typeof payload.expiresAt === "number" &&
    Number.isSafeInteger(payload.expiresAt)
  );
}

/** Encrypts only the server-selected connection and canonical domain for the fixed portal start. */
export function sealHomeRealmContinuation(
  input: Omit<HomeRealmContinuation, "expiresAt">,
  now = Date.now(),
): string {
  const payload = {
    version: 1,
    connectionId: input.connectionId,
    domain: input.domain,
    ...(input.invitationId ? { invitationId: input.invitationId } : {}),
    expiresAt: now + HOME_REALM_CONTINUATION_TTL_SECONDS * 1000,
  };
  if (!validPayload(payload))
    throw new Error("Home realm continuation is invalid");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

/** Authenticates and expires the opaque cookie before any connection lookup. */
export function openHomeRealmContinuation(
  token: string,
  now = Date.now(),
): HomeRealmContinuation | null {
  if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(token)) return null;
  const envelope = Buffer.from(token, "base64url");
  if (envelope.toString("base64url") !== token) return null;
  if (envelope.length <= IV_BYTES + TAG_BYTES) return null;

  try {
    const iv = envelope.subarray(0, IV_BYTES);
    const tag = envelope.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = envelope.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const value: unknown = JSON.parse(plaintext);
    if (!validPayload(value) || value.expiresAt <= now) return null;
    return {
      connectionId: value.connectionId,
      domain: value.domain,
      ...(value.invitationId ? { invitationId: value.invitationId } : {}),
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}
