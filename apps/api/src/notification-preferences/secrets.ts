import { createDecipheriv, createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import {
  currentEncryptionKeyId,
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
} from "../identity/client-secret";

/**
 * Text-column secrets (notification tokens, webhook signing secrets, signed cursors).
 *
 * `enc:v2:` carries the key-id-aware `TDK1` envelope shared with identity client secrets and
 * plugin secrets, so it survives `TASKDESK_ENCRYPTION_KEY` rotation (current and previous key
 * are both read) and is covered by the secrets-rekey job and the Health check. `enc:v1:` is the
 * legacy single-key format: it is still readable (current, then previous key) and is rewritten
 * to v2 by the rekey job.
 */
const LEGACY_PREFIX = "enc:v1:";
const SECRET_PREFIX = "enc:v2:";
const SECRET_AAD = "taskdesk:text-secret:v2";
const LEGACY_ALGORITHM = "aes-256-gcm";

export const TEXT_SECRET_V2_PREFIX = SECRET_PREFIX;
export const TEXT_SECRET_LEGACY_PREFIX = LEGACY_PREFIX;

function legacyKeys(): Buffer[] {
  return [
    process.env.TASKDESK_ENCRYPTION_KEY,
    process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS,
  ]
    .map((raw) => raw?.trim())
    .filter((raw): raw is string => !!raw)
    .map((raw) => createHash("sha256").update(raw).digest());
}

function requireCurrentKey() {
  if (!currentEncryptionKeyId()) {
    throw new HTTPException(500, {
      message:
        "TASKDESK_ENCRYPTION_KEY is required to store encrypted notification secrets",
    });
  }
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return (
    typeof value === "string" &&
    (value.startsWith(SECRET_PREFIX) || value.startsWith(LEGACY_PREFIX))
  );
}

function isValidEncryptedSecret(value: string): boolean {
  try {
    decryptSecret(value);
    return true;
  } catch {
    return false;
  }
}

/** Encrypts under the current key as `enc:v2:`. An already valid envelope is kept as is. */
export function encryptSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null || value === "") {
    return value;
  }

  if (isEncryptedSecret(value) && isValidEncryptedSecret(value)) {
    return value;
  }

  requireCurrentKey();
  return `${SECRET_PREFIX}${encryptIdentityClientSecret(SECRET_AAD, value).toString("base64url")}`;
}

/**
 * Whether a stored value can be read with the CURRENT key alone, that is without
 * `TASKDESK_ENCRYPTION_KEY_PREVIOUS`. A legacy `enc:v1:` value under the current key qualifies (it
 * only awaits the format upgrade); a v2 value under another key id, or a v1 value under the
 * previous key, does not.
 */
export function readableWithoutPreviousKey(value: string): boolean {
  if (value.startsWith(SECRET_PREFIX)) {
    const keyId = currentEncryptionKeyId();
    if (!keyId) return false;
    const envelope = Buffer.from(
      value.slice(SECRET_PREFIX.length),
      "base64url",
    );
    return (
      envelope.length > 12 && envelope.subarray(4, 12).toString("hex") === keyId
    );
  }
  if (!value.startsWith(LEGACY_PREFIX)) return true;
  const current = process.env.TASKDESK_ENCRYPTION_KEY?.trim();
  if (!current) return false;
  const [iv, authTag, encrypted] = value.slice(LEGACY_PREFIX.length).split(".");
  if (!iv || !authTag || !encrypted) return false;
  try {
    const decipher = createDecipheriv(
      LEGACY_ALGORITHM,
      createHash("sha256").update(current).digest(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    decipher.update(Buffer.from(encrypted, "base64url"));
    decipher.final();
    return true;
  } catch {
    return false;
  }
}

/** Rewrites a readable envelope (v1 or v2, either key) under the current key as v2. */
export function reencryptSecret(value: string): string {
  const plaintext = decryptSecret(value);
  if (typeof plaintext !== "string" || plaintext === "")
    throw new Error("Secret is unavailable");
  requireCurrentKey();
  return `${SECRET_PREFIX}${encryptIdentityClientSecret(SECRET_AAD, plaintext).toString("base64url")}`;
}

function decryptLegacy(value: string): string {
  const [iv, authTag, encrypted] = value.slice(LEGACY_PREFIX.length).split(".");
  if (!iv || !authTag || !encrypted) {
    throw new HTTPException(500, {
      message: "Invalid encrypted notification secret payload",
    });
  }
  for (const key of legacyKeys()) {
    try {
      const decipher = createDecipheriv(
        LEGACY_ALGORITHM,
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(authTag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // try the next configured key
    }
  }
  throw new HTTPException(500, {
    message: "Failed to decrypt notification secret",
  });
}

export function decryptSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null || !isEncryptedSecret(value)) {
    return value;
  }
  if (value.startsWith(LEGACY_PREFIX)) return decryptLegacy(value);

  try {
    return decryptIdentityClientSecret(
      SECRET_AAD,
      Buffer.from(value.slice(SECRET_PREFIX.length), "base64url"),
    );
  } catch {
    throw new HTTPException(500, {
      message: "Failed to decrypt notification secret",
    });
  }
}
